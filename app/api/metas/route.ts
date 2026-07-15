import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  withSocioOrFuncionarioAdmin,
} from "@/lib/auth/guards";
import { detectMonthRegime } from "@/lib/cmsMonthly";

// ============================================================
// FRENTE C — API da tela /metas.
// GET  ?year=&month=&companyId= -> linhas de meta + producao + escala.
// POST { action: 'meta_upsert' | 'repasse_upsert', ... } -> edicao inline.
//
// Metas em valor vivem em monthly_targets (fonte unica do motor).
// Escala de % vive em promoter_goal_repasse (competencia = 1o dia do mes).
// Producao atual = promoter_monthly_results.production_value (ultimo recalc).
// ============================================================

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function competenciaOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

type Faixa = "BASE" | "META1" | "META2";

function faixaAtingida(
  production: number,
  bonus1: number,
  bonus2: number
): Faixa {
  if (bonus2 > 0 && production >= bonus2) return "META2";
  if (bonus1 > 0 && production >= bonus1) return "META1";
  return "BASE";
}

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAdmin();
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));
    const companyId = searchParams.get("companyId") || null;

    if (!year || !month) {
      return NextResponse.json(
        { error: "Informe year e month." },
        { status: 400 }
      );
    }
    const competencia = competenciaOf(year, month);

    // REGIME da competencia: decide QUAIS sources do PMR entram na producao, para
    // nao misturar linhas de origens diferentes (o mesmo criterio do dre.ts). open
    // -> 'daily' (mes vivo); cms -> 'cms' (jan-mai seed); fechamento -> RR+ADS
    // consolidados ('fechamento','bbts'). Sem isto a query puxaria qualquer source.
    const regime = await detectMonthRegime(supabase, year, month).catch(() => "open" as const);
    const regimeSources =
      regime === "cms" ? ["cms"] : regime === "open" ? ["daily"] : ["fechamento", "bbts"];

    const [
      { data: companies },
      { data: promotersData },
      { data: targets },
      { data: repasses },
      { data: results },
    ] = await Promise.all([
      supabase.from("companies").select("id, name, cnpj, group_code"),
      supabase.from("promoters").select("id, name, company_id, active"),
      (() => {
        let q = supabase
          .from("monthly_targets")
          .select("promoter_id, company_id, meta, meta_1, meta_2")
          .eq("year", year)
          .eq("month", month);
        if (companyId) q = q.eq("company_id", companyId);
        return q;
      })(),
      supabase
        .from("promoter_goal_repasse")
        .select("promoter_id, pct_base, pct_meta1, pct_meta2")
        .eq("competencia", competencia),
      (() => {
        let q = supabase
          .from("promoter_monthly_results")
          .select("promoter_id, production_value")
          .eq("year", year)
          .eq("month", month)
          .in("source", regimeSources);
        if (companyId) q = q.eq("company_id", companyId);
        return q;
      })(),
    ]);

    const companyMap = new Map(
      (companies || []).map((c: any) => [c.id, c])
    );
    const promoterMap = new Map(
      (promotersData || []).map((p: any) => [p.id, p])
    );
    // A META e DO PROMOTOR (decisao de negocio): promotor com linha RR + linha ADS
    // tem meta e producao SOMADAS, e a faixa/repasse (Frente C) saem do consolidado.
    // Por isso agregamos SOMANDO por promoter_id, em vez do Map-overwrite antigo
    // (new Map(rows.map(r => [promoter_id, r])), onde a ultima linha vencia e
    // truncava a outra empresa). No modo "1 empresa" (companyId passado) cada
    // promotor tem 1 linha, entao a soma == a propria linha: no-op.
    const targetMap = new Map<string, { meta: number; meta_1: number; meta_2: number }>();
    for (const t of (targets || []) as any[]) {
      const cur = targetMap.get(t.promoter_id) || { meta: 0, meta_1: 0, meta_2: 0 };
      cur.meta += toNumber(t.meta);
      cur.meta_1 += toNumber(t.meta_1);
      cur.meta_2 += toNumber(t.meta_2);
      targetMap.set(t.promoter_id, cur);
    }
    const repasseMap = new Map(
      (repasses || []).map((r: any) => [r.promoter_id, r])
    );
    const resultMap = new Map<string, { production_value: number }>();
    for (const r of (results || []) as any[]) {
      const cur = resultMap.get(r.promoter_id) || { production_value: 0 };
      cur.production_value += toNumber(r.production_value);
      resultMap.set(r.promoter_id, cur);
    }

    // Universo de linhas: promotores com meta, escala ou producao na competencia.
    const ids = new Set<string>([
      ...(targets || []).map((t: any) => t.promoter_id),
      ...(repasses || []).map((r: any) => r.promoter_id),
      ...(results || []).map((r: any) => r.promoter_id),
    ]);

    const rows = Array.from(ids)
      .map((promoterId) => {
        const promoter = promoterMap.get(promoterId);
        if (!promoter) return null;
        if (companyId && promoter.company_id !== companyId) return null;
        const company = promoter.company_id
          ? companyMap.get(promoter.company_id)
          : null;
        const target = targetMap.get(promoterId);
        const repasse = repasseMap.get(promoterId);
        const result = resultMap.get(promoterId);

        const meta = toNumber(target?.meta);
        const bonus1 = toNumber(target?.meta_1);
        const bonus2 = toNumber(target?.meta_2);
        const production = toNumber(result?.production_value);
        const faixa = faixaAtingida(production, bonus1, bonus2);
        const pct =
          repasse == null
            ? null
            : faixa === "META2"
            ? repasse.pct_meta2 ?? repasse.pct_base
            : faixa === "META1"
            ? repasse.pct_meta1 ?? repasse.pct_base
            : repasse.pct_base;

        return {
          promoter_id: promoterId,
          promoter_name: promoter.name,
          company_id: promoter.company_id,
          company_name: company?.name ?? "—",
          company_cnpj: company?.cnpj ?? "",
          estado: company?.group_code ?? "—",
          meta,
          bonus1,
          bonus2,
          production,
          falta_meta: Math.max(0, meta - production),
          faixa,
          pct_vigente: pct == null ? null : toNumber(pct),
          pct_base: repasse ? toNumber(repasse.pct_base) : null,
          pct_meta1: repasse?.pct_meta1 == null ? null : toNumber(repasse.pct_meta1),
          pct_meta2: repasse?.pct_meta2 == null ? null : toNumber(repasse.pct_meta2),
          has_repasse: repasse != null,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) =>
        a.promoter_name.localeCompare(b.promoter_name, "pt-BR")
      );

    const companyOptions = (companies || [])
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        cnpj: c.cnpj,
        estado: c.group_code,
      }))
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "pt-BR"));

    return NextResponse.json({ competencia, rows, companies: companyOptions });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAdmin();
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const promoterId = body?.promoterId ? String(body.promoterId) : "";
    const year = Number(body?.year);
    const month = Number(body?.month);

    if (!promoterId || !year || !month) {
      return NextResponse.json(
        { error: "Informe promotor e competencia." },
        { status: 400 }
      );
    }

    if (action === "meta_upsert") {
      const { error } = await supabase.from("monthly_targets").upsert(
        {
          promoter_id: promoterId,
          company_id: body?.companyId ? String(body.companyId) : null,
          year,
          month,
          meta: toNumber(body?.meta),
          meta_1: toNumber(body?.bonus1),
          meta_2: toNumber(body?.bonus2),
        },
        { onConflict: "promoter_id,year,month" }
      );
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === "repasse_upsert") {
      const pctBase = toNumber(body?.pct_base);
      if (!(pctBase > 0)) {
        return NextResponse.json(
          { error: "pct_base obrigatorio e maior que zero." },
          { status: 400 }
        );
      }
      const { error } = await supabase.from("promoter_goal_repasse").upsert(
        {
          promoter_id: promoterId,
          competencia: competenciaOf(year, month),
          pct_base: pctBase,
          pct_meta1:
            body?.pct_meta1 === null || body?.pct_meta1 === undefined || body?.pct_meta1 === ""
              ? null
              : toNumber(body.pct_meta1),
          pct_meta2:
            body?.pct_meta2 === null || body?.pct_meta2 === undefined || body?.pct_meta2 === ""
              ? null
              : toNumber(body.pct_meta2),
        },
        { onConflict: "promoter_id,competencia" }
      );
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
