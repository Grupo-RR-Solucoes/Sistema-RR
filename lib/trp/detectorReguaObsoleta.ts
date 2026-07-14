/**
 * lib/trp/detectorReguaObsoleta.ts — DETECTOR de regua obsoleta, CAMADA 1 (TRP).
 *
 * READ-ONLY: nao grava, nao recalcula. So COMPARA a versao da TRP que produziu
 * cada linha do PMR (promoter_monthly_results.trp_version_id) com a versao
 * VIGENTE HOJE para aquela competencia (resolveTrpRegraDb). O objetivo e tornar
 * VISIVEL a divergencia "o PMR foi calculado com a regua velha" — que sem isto
 * e invisivel por construcao. A DECISAO de recalcular fica com o operador (esta
 * frente so DETECTA e mostra; auto-recalculo e outra fase).
 *
 * ESTADOS por linha (nunca colapsar DESCONHECIDO em OK):
 *   NAO_APLICAVEL  source fechamento/cms — nao usa TRP (comissao vem pronta do
 *                  arquivo). trp_version_id NULL aqui e legitimo, nao e falta.
 *   DESCONHECIDO   source bbts/daily com trp_version_id NULL — calculado ANTES
 *                  do detector (historico). Nao da para afirmar que esta ok.
 *   OK             trp_version_id == versao vigente hoje.
 *   STALE          trp_version_id != versao vigente hoje (regua mudou desde o
 *                  calculo; reconsolidar para alinhar).
 *
 * FALLBACK: trp_fallback=true e informativo (competencia sem TRP propria, usando
 * a de outra), NAO e stale. Se antes usava fallback e agora subiram a regua
 * propria, o versionId muda -> STALE (o detector pega, corretamente).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveTrpRegraDb } from "@/lib/trp/resolveTrpRegraDb";

export type TrpStaleState = "OK" | "STALE" | "DESCONHECIDO" | "NAO_APLICAVEL";

/** Sources que RECALCULAM pela TRP (logo, obsoletaveis pela Camada 1). */
const TRP_SOURCES = new Set(["bbts", "daily"]);

export interface TrpDetectorRow {
  promoter_id: string;
  company_id: string | null;
  source: string;
  stored_version_id: string | null;
  trp_fallback: boolean | null;
  state: TrpStaleState;
}

export interface TrpDetectorResult {
  competencia: string; // "YYYY-MM"
  /** Versao da TRP vigente HOJE para a competencia (null = sem versao no DB). */
  current_version_id: string | null;
  current_is_fallback: boolean | null;
  counts: { ok: number; stale: number; desconhecido: number; nao_aplicavel: number };
  /** Ha ao menos uma linha bbts/daily divergente da regua vigente. */
  has_stale: boolean;
  /** Ha ao menos uma linha bbts/daily sem versao rastreada (historico). */
  has_desconhecido: boolean;
  rows: TrpDetectorRow[];
}

/**
 * Maquina de estados do detector (pura, testavel). NUNCA colapsa DESCONHECIDO
 * em OK: uma linha bbts/daily sem versao gravada e DESCONHECIDO, jamais OK.
 */
export function classify(
  source: string,
  storedVersionId: string | null,
  currentVersionId: string | null,
): TrpStaleState {
  if (!TRP_SOURCES.has(source)) return "NAO_APLICAVEL";
  if (storedVersionId == null) return "DESCONHECIDO";
  return storedVersionId === currentVersionId ? "OK" : "STALE";
}

/**
 * Detecta o estado da TRP das linhas do PMR de uma competencia. READ-ONLY.
 *
 * @param client SupabaseClient (default: service_role admin — le PMR e
 *   trp_rule_versions, esta ultima RLS default-deny).
 */
export async function detectTrpStaleForCompetencia(
  params: { year: number; month: number },
  client?: SupabaseClient,
): Promise<TrpDetectorResult> {
  const { year, month } = params;
  const competencia = `${year}-${String(month).padStart(2, "0")}`;
  const sb = client ?? (getSupabaseAdmin() as unknown as SupabaseClient);

  // 1) Versao VIGENTE hoje para a competencia (com fallback resolvido). Propaga
  //    erro de infra (nao engole como "sem regua"): resolveTrpRegraDb lanca
  //    TrpInfraError em permission denied/conexao.
  const currentResolved = await resolveTrpRegraDb({ competencia }, sb);
  const currentVersionId = currentResolved?.versionId ?? null;
  const currentIsFallback = currentResolved ? currentResolved.isFallback : null;

  // 2) Linhas do PMR da competencia.
  const { data, error } = await sb
    .from("promoter_monthly_results")
    .select("promoter_id, company_id, source, trp_version_id, trp_fallback")
    .eq("year", year)
    .eq("month", month);
  if (error) throw error;

  const rows: TrpDetectorRow[] = [];
  const counts = { ok: 0, stale: 0, desconhecido: 0, nao_aplicavel: 0 };
  for (const r of data || []) {
    const state = classify(r.source, r.trp_version_id ?? null, currentVersionId);
    if (state === "OK") counts.ok += 1;
    else if (state === "STALE") counts.stale += 1;
    else if (state === "DESCONHECIDO") counts.desconhecido += 1;
    else counts.nao_aplicavel += 1;
    rows.push({
      promoter_id: r.promoter_id,
      company_id: r.company_id ?? null,
      source: r.source,
      stored_version_id: r.trp_version_id ?? null,
      trp_fallback: r.trp_fallback ?? null,
      state,
    });
  }

  return {
    competencia,
    current_version_id: currentVersionId,
    current_is_fallback: currentIsFallback,
    counts,
    has_stale: counts.stale > 0,
    has_desconhecido: counts.desconhecido > 0,
    rows,
  };
}
