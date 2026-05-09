/**
 * GET /api/auditoria/avista
 *
 * Modos:
 *   ?year=2024&month=9         → 1 mês (AvistaMesPayload)
 *   ?from=2022-12&to=2026-04   → intervalo (AvistaMesPayload[])
 *   (sem params)               → todos os 41 meses (Dez/2022 → Abr/2026)
 *
 * Esta rota é READ-ONLY. Não escreve em audit_v9_avista. A tabela é
 * populada via scripts/seed_v9.cjs (Fase 4.1) e é IMUTÁVEL nesta fase.
 *
 * Não substitui /api/auditoria/historico (motor v8 ainda em produção). É a
 * Camada 2 v9 (status_fase2 + diferenca + bloco), simétrica com
 * /api/auditoria/enquadramento (Camada 1 — Fase 4.2).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  auditAvistaMes,
  auditAvistaPeriodo,
  consolidarPeriodo,
} from "@/lib/auditoriaAvistaBatch";

function parseYearMonth(s: string | null): { year: number; month: number } | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export async function GET(req: NextRequest) {
  const startMs = Date.now();
  const { searchParams } = new URL(req.url);
  const yearStr = searchParams.get("year");
  const monthStr = searchParams.get("month");
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const includeRows = searchParams.get("include_rows") !== "false"; // default true

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "supabase env" }, { status: 500 });
  }

  try {
    // Modo 1: mês único
    if (yearStr && monthStr) {
      const year = Number.parseInt(yearStr, 10);
      const month = Number.parseInt(monthStr, 10);
      if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return NextResponse.json(
          { error: "year e month obrigatórios e válidos (month: 1-12)" },
          { status: 400 }
        );
      }
      const payload = await auditAvistaMes(supabase, year, month);
      return NextResponse.json({
        meta: {
          mode: "single",
          year,
          month,
          totalMs: Date.now() - startMs,
          totalContratos: payload.resumo.totalContratos,
        },
        result: includeRows
          ? payload
          : { ...payload, resultados: [] },
      });
    }

    // Modo 2: intervalo
    const fromYm = parseYearMonth(fromStr);
    const toYm = parseYearMonth(toStr);
    const start = fromYm ?? { year: 2022, month: 12 };
    const end = toYm ?? { year: 2026, month: 4 };

    if (
      end.year < start.year ||
      (end.year === start.year && end.month < start.month)
    ) {
      return NextResponse.json(
        { error: "intervalo inválido: from > to" },
        { status: 400 }
      );
    }

    const results = await auditAvistaPeriodo(
      supabase,
      start.year,
      start.month,
      end.year,
      end.month
    );
    const consolidado = consolidarPeriodo(results);

    return NextResponse.json({
      meta: {
        mode: "range",
        from: `${start.year}-${String(start.month).padStart(2, "0")}`,
        to: `${end.year}-${String(end.month).padStart(2, "0")}`,
        totalMonths: results.length,
        totalMs: Date.now() - startMs,
        consolidado,
      },
      results: includeRows
        ? results
        : results.map((p) => ({ ...p, resultados: [] })),
    });
  } catch (err: any) {
    console.error("[/api/auditoria/avista] error:", err);
    return NextResponse.json(
      { error: err?.message || "Erro ao processar Camada 2 À Vista" },
      { status: 500 }
    );
  }
}
