import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  withSocioOrFuncionarioAnon,
} from "@/lib/auth/guards";

/**
 * GET /api/commissions/proposals/distinct-values
 *
 * Retorna valores distintos de uma coluna para alimentar o filtro
 * "estilo Excel" da UI 4.4.2 (checkboxes por valor distinto). Filtros
 * ja aplicados em outras colunas restringem o conjunto, mantendo a
 * semantica de filtro multi-coluna do Excel.
 *
 * Query params:
 *   - year (number, obrigatorio)
 *   - month (number, obrigatorio)
 *   - column (string, obrigatorio — whitelisted)
 *   - filters (JSON string, opcional) — { col: [values...] }
 *
 * Colunas suportadas (whitelist explicita):
 *   - assigned_promoter_id  (label via promoters.name)
 *   - company_id            (label via companies.name)
 *   - product_description
 *   - promoter_commission_percent  (% A VISTA — Promotiva default)
 *   - commission_percent           (% REPASSE — override via JOIN)
 *
 * Limite: 1000 valores distintos no response.
 */

type ColumnKey =
  | "assigned_promoter_id"
  | "company_id"
  | "product_description"
  | "promoter_commission_percent"
  | "commission_percent";

const COLUMN_WHITELIST: ColumnKey[] = [
  "assigned_promoter_id",
  "company_id",
  "product_description",
  "promoter_commission_percent",
  "commission_percent",
];

const MAX_DISTINCT = 1000;

function getMonthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAnon();
    const { searchParams } = new URL(req.url);

    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));
    const columnParam = searchParams.get("column") ?? "";
    const filtersParam = searchParams.get("filters");

    if (!year || !month) {
      return NextResponse.json(
        { error: "Informe year e month." },
        { status: 400 }
      );
    }

    if (!(COLUMN_WHITELIST as string[]).includes(columnParam)) {
      return NextResponse.json(
        { error: `Coluna invalida. Aceitas: ${COLUMN_WHITELIST.join(", ")}.` },
        { status: 400 }
      );
    }
    const column = columnParam as ColumnKey;

    let filters: Record<string, unknown[]> = {};
    if (filtersParam) {
      try {
        const parsed = JSON.parse(filtersParam);
        if (parsed && typeof parsed === "object") {
          filters = parsed as Record<string, unknown[]>;
        }
      } catch {
        return NextResponse.json(
          { error: "filters deve ser JSON valido." },
          { status: 400 }
        );
      }
    }

    const { start, end } = getMonthRange(year, month);

    // Para % REPASSE precisamos do JOIN com promoter_proposal_commissions.
    // Demais colunas vivem em daily_production_records direto.
    const needsCommissionJoin = column === "commission_percent";

    const selectColumns: string[] = [
      "id",
      "assigned_promoter_id",
      "company_id",
      "product_description",
      "promoter_commission_percent",
    ];
    if (needsCommissionJoin) {
      selectColumns.push(
        "promoter_proposal_commissions!promoter_proposal_commissions_daily_production_record_id_fkey(commission_percent, active)"
      );
    }

    let query = supabase
      .from("daily_production_records")
      .select(selectColumns.join(", "))
      .gte("movement_date", start)
      .lt("movement_date", end)
      .not("assigned_promoter_id", "is", null);

    // Aplica filtros em outras colunas (semantica Excel — filtros se
    // acumulam restringindo). Whitelist garante coluna valida.
    for (const [filterCol, values] of Object.entries(filters)) {
      if (filterCol === column) continue; // nao filtra na propria coluna
      if (!(COLUMN_WHITELIST as string[]).includes(filterCol)) continue;
      if (!Array.isArray(values) || values.length === 0) continue;
      if (filterCol === "commission_percent") continue; // join — filtro pos-query
      query = query.in(filterCol, values as (string | number)[]);
    }

    const { data, error } = await query.limit(5000);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Supabase JS infere o type do select() como Generic narrow demais
    // quando a string e dinamica + tem embed. Cast via unknown e ok porque
    // o whitelist garante as colunas reais.
    const records = (data ?? []) as unknown as Array<Record<string, unknown>>;

    // Extrai o valor da coluna requisitada. Para commission_percent
    // o valor vem do nested join (pegando linha active=true).
    const distinctMap = new Map<string, { value: unknown; label?: string }>();
    for (const rec of records) {
      let value: unknown = null;
      if (column === "commission_percent") {
        const joins = rec[
          "promoter_proposal_commissions"
        ] as Array<{ commission_percent: number | null; active: boolean | null }> | null;
        const active = (joins ?? []).find((j) => j.active !== false);
        value = active?.commission_percent ?? null;
      } else {
        value = rec[column];
      }
      if (value === null || value === undefined) continue;
      const key = String(value);
      if (!distinctMap.has(key)) {
        distinctMap.set(key, { value });
      }
      if (distinctMap.size >= MAX_DISTINCT) break;
    }

    // Resolve labels para colunas FK
    if (column === "assigned_promoter_id") {
      const ids = Array.from(distinctMap.keys());
      if (ids.length > 0) {
        const { data: promoters } = await supabase
          .from("promoters")
          .select("id, name")
          .in("id", ids);
        for (const p of promoters ?? []) {
          const entry = distinctMap.get(p.id);
          if (entry) entry.label = p.name ?? undefined;
        }
      }
    } else if (column === "company_id") {
      const ids = Array.from(distinctMap.keys());
      if (ids.length > 0) {
        const { data: companies } = await supabase
          .from("companies")
          .select("id, name")
          .in("id", ids);
        for (const c of companies ?? []) {
          const entry = distinctMap.get(c.id);
          if (entry) entry.label = c.name ?? undefined;
        }
      }
    }

    const values = Array.from(distinctMap.values()).map((entry) => ({
      value: entry.value,
      label: entry.label ?? String(entry.value),
    }));

    // Sort: numerico se aplicavel, senao string
    const isNumericColumn =
      column === "promoter_commission_percent" || column === "commission_percent";
    values.sort((a, b) => {
      if (isNumericColumn) {
        return Number(a.value) - Number(b.value);
      }
      return String(a.label).localeCompare(String(b.label), "pt-BR");
    });

    return NextResponse.json({ column, values });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
