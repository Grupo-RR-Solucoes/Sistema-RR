// FRENTE DE PRODUTO — Movimento 2b: PAYOUT do gestor de consorcio (10%).
//
// O gestor recebe 10% de TODA a comissao-empresa do consorcio, de TODAS as empresas.
// NAO depende da atribuicao ao promotor (e sobre o total). Calculado no reconsolidar e
// gravado em consorcio_gestor_payout (SEPARADO da PMR). Idempotente: upsert por
// (competencia, company_id) -> recomputar nao paga o gestor 2x.
import type { SupabaseClient } from "@supabase/supabase-js";
import { FATOR_REPASSE_GESTOR_CONSORCIO } from "./trp210.ts";
import { fetchConsorcioEntries, isRegular, type ConsorcioEntry } from "./fila.ts";

type SupabaseLike = SupabaseClient;

const round2 = (v: number) => Math.round(v * 100) / 100;

export type GestorPayoutLinha = {
  company_id: string | null;
  base_comissao_empresa: number;
  gestor_10: number;
};

// Base por empresa (PURA): Sigma comissao-empresa consorcio das parcelas regulares.
export function computeGestorBaseByCompany(entries: ConsorcioEntry[]): GestorPayoutLinha[] {
  const base = new Map<string, number>();
  for (const e of entries.filter(isRegular)) {
    const k = e.company_id ?? "NULL";
    base.set(k, (base.get(k) || 0) + Number(e.commission_value || 0));
  }
  return [...base.entries()].map(([k, v]) => ({
    company_id: k === "NULL" ? null : k,
    base_comissao_empresa: round2(v),
    gestor_10: round2(v * FATOR_REPASSE_GESTOR_CONSORCIO),
  }));
}

// Resolve o gestor vigente da competencia (consorcio_gestor). null quando nao cadastrado.
async function gestorVigente(
  supabase: SupabaseLike,
  competencia: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("consorcio_gestor")
    .select("app_user_id")
    .eq("competencia", competencia)
    .eq("ativo", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.app_user_id ?? null;
}

export async function computeConsorcioGestorPayout(
  supabase: SupabaseLike,
  params: { year: number; month: number; dryRun?: boolean }
): Promise<{ competencia: string; gestor_user_id: string | null; total_10: number; linhas: GestorPayoutLinha[] }> {
  const { year, month } = params;
  const dryRun = params.dryRun === true;
  const competencia = `${year}-${String(month).padStart(2, "0")}`;

  const entries = await fetchConsorcioEntries(supabase, { year, month });
  const linhas = computeGestorBaseByCompany(entries);
  const total_10 = round2(linhas.reduce((s, l) => s + l.gestor_10, 0));
  const gestor_user_id = await gestorVigente(supabase, competencia);

  if (!dryRun && linhas.length > 0) {
    const payload = linhas.map((l) => ({
      competencia,
      company_id: l.company_id,
      gestor_user_id,
      base_comissao_empresa: l.base_comissao_empresa,
      gestor_10: l.gestor_10,
      updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase
        .from("consorcio_gestor_payout")
        .upsert(payload.slice(i, i + 500), { onConflict: "competencia,company_id" });
      if (error) throw new Error(error.message);
    }
  }
  return { competencia, gestor_user_id, total_10, linhas };
}
