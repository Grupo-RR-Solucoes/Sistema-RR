import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllRows } from "@/lib/queryHelpers";

// ============================================================
// CICLO PRT (card "Ciclo PRT — previsto vs recebido") — métrica AUTOMÁTICA do
// fechamento, NÃO cumulativa, de UM mês. É separada da auditoria oficial curada
// (audit_v9_avista). Usa só campos LIMPOS do monthly_closing_entries (aba "PRT"):
// `COD EST` (1 = pago/veio; 2/99 = listado-não-pago) + a comissão listada.
//
// Validado (2026-06-05): o "recebido" (Σ cod_est=1) reconcilia EXATO com o
// fechamento_mensal_empresa.valor_diferido do mês (abr 52.132,43; mai 51.933,17).
// Sem ruído de classificação de produto (diferente do à vista, que foi dropado).
// READ-ONLY — não toca PMR, não roda calculate/monthly.
// ============================================================

const PRT_SHEET = "PRT";

function toNumberBR(value: unknown): number {
  if (value == null || value === "") return 0;
  const s = String(value).trim();
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : 0;
}

function metaGet(meta: Record<string, unknown> | null, keys: string[]): unknown {
  if (!meta) return null;
  const wanted = keys.map((k) => k.trim().toUpperCase());
  for (const [k, v] of Object.entries(meta)) {
    if (v == null || v === "") continue;
    if (wanted.includes(k.trim().toUpperCase())) return v;
  }
  return null;
}

type PrtRow = { commission_value: number | null; metadata: Record<string, unknown> | null };

export type PrtCicloResult = {
  year: number;
  month: number;
  entradas: number;
  // Previsto = Σ comissão listada de TODAS as entradas PRT do mês (o que deveria
  // vir no ciclo). Recebido = Σ das entradas com cod_est=1 (o que veio). NaoPago =
  // previsto − recebido (cod_est 2/99 — estorno/listado-não-pago do ciclo).
  previsto: number;
  recebido: number;
  naoPago: number;
  porCodEst: Array<{ codEst: number; entradas: number; comissao: number }>;
};

export async function buildPrtCiclo(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<PrtCicloResult> {
  const rows = await fetchAllRows<PrtRow>(() =>
    supabase
      .from("monthly_closing_entries")
      .select("commission_value, metadata")
      .eq("year", year)
      .eq("month", month)
      .eq("sheet_name", PRT_SHEET)
  );

  const byCod = new Map<number, { entradas: number; comissao: number }>();
  let previsto = 0;
  let recebido = 0;
  for (const r of rows) {
    const cod = Math.trunc(toNumberBR(metaGet(r.metadata, ["COD EST", "CODIGO EST", "CODIGO ESTORNO"])));
    const comissao =
      toNumberBR(metaGet(r.metadata, ["COMISSAO", "COMISSÃO"])) || toNumberBR(r.commission_value);
    previsto += comissao;
    if (cod === 1) recebido += comissao;
    const acc = byCod.get(cod) || { entradas: 0, comissao: 0 };
    acc.entradas += 1;
    acc.comissao += comissao;
    byCod.set(cod, acc);
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    year,
    month,
    entradas: rows.length,
    previsto: round(previsto),
    recebido: round(recebido),
    naoPago: round(previsto - recebido),
    porCodEst: Array.from(byCod.entries())
      .map(([codEst, v]) => ({ codEst, entradas: v.entradas, comissao: round(v.comissao) }))
      .sort((a, b) => a.codEst - b.codEst),
  };
}
