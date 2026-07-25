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

import { detectMonthRegime } from "@/lib/cmsMonthly";
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

// ---------------------------------------------------------------------------
// CROSS-COMPETENCIA (Peca 1 do elo TRP->recalculo) — ESPELHO de detectRulesStale
// (Camada 2, lib/rulesFingerprint.ts). Devolve o MESMO shape que o
// PmrReconsolidarCard ja renderiza para a Camada 2 (counts + alteradas[] +
// desconhecidas[]). NAO reimplementa a maquina de estados: reusa
// detectTrpStaleForCompetencia por competencia e detectMonthRegime para o regime.
//
// SO competencias FECHADAS: 'open' e pulado (mes aberto ja recalcula do daily a
// cada import — a OFERTA de reconsolidacao e so para o que nao recalcula sozinho).
// PISO em 2026-01: MESMA decisao de escopo do ledgerHealth (o ledger de promotor
// nasce no seed cms de jan/2026; 2025 esta fora de escopo).
//
// BLAST RADIUS: em mes fechado so linhas source='bbts' (ADS) usam TRP —
// 'fechamento' (RR) e NAO_APLICAVEL (comissao vem pronta do arquivo) e 'daily'
// nao existe no fechado. Uma competencia sem NENHUMA linha bbts fica com todas
// NAO_APLICAVEL -> NAO entra em bucket nenhum. Logo a lista so mostra ADS. Se
// aparecer uma competencia RR-pura como STALE, ha algo errado na classify.
// ---------------------------------------------------------------------------

/** Piso de escopo (jan/2026) — a MESMA decisao documentada em lib/diagnostico/ledgerHealth.ts. */
const PISO_KEY_TRP = 2026 * 12 + 1;

export interface TrpStaleCrossResult {
  /** Buckets SEPARADOS — nunca somar num numero so (igual a Camada 2). */
  counts: { ok: number; stale: number; desconhecido: number };
  /** Competencias STALE (regua TRP mudou desde o calculo). */
  alteradas: Array<{ year: number; month: number }>;
  /** Competencias DESCONHECIDAS (bbts/daily fechado sem trp_version_id rastreado). */
  desconhecidas: Array<{ year: number; month: number }>;
}

/**
 * Varre as competencias FECHADAS com PMR e classifica cada uma quanto a TRP,
 * reusando detectTrpStaleForCompetencia. READ-ONLY. STALE tem precedencia sobre
 * DESCONHECIDO (reconsolidar resolve os dois). Espelho cross-competencia da
 * Camada 1, no shape da Camada 2.
 */
export async function detectTrpStaleCrossFechadas(
  client?: SupabaseClient,
): Promise<TrpStaleCrossResult> {
  const sb = client ?? (getSupabaseAdmin() as unknown as SupabaseClient);

  // Competencias distintas presentes no PMR (>= piso). E onde vive trp_version_id;
  // uma competencia sem PMR nao tem o que ficar obsoleto.
  const { data, error } = await sb
    .from("promoter_monthly_results")
    .select("year, month");
  if (error) throw error;

  const comps = new Map<string, { year: number; month: number }>();
  for (const r of data || []) {
    const year = Number(r.year);
    const month = Number(r.month);
    if (year * 12 + month >= PISO_KEY_TRP) comps.set(`${year}-${month}`, { year, month });
  }

  const counts = { ok: 0, stale: 0, desconhecido: 0 };
  const alteradas: Array<{ year: number; month: number }> = [];
  const desconhecidas: Array<{ year: number; month: number }> = [];

  for (const { year, month } of comps.values()) {
    const regime = await detectMonthRegime(sb, year, month);
    if (regime === "open") continue; // mes aberto recalcula sozinho — nao e OFERTA

    const res = await detectTrpStaleForCompetencia({ year, month }, sb);
    if (res.has_stale) {
      counts.stale += 1;
      alteradas.push({ year, month });
    } else if (res.has_desconhecido) {
      counts.desconhecido += 1;
      desconhecidas.push({ year, month });
    } else if (res.counts.ok > 0) {
      counts.ok += 1;
    }
    // else: todas NAO_APLICAVEL (competencia sem linha bbts) — nao entra em bucket.
  }

  const ordena = (a: { year: number; month: number }, b: { year: number; month: number }) =>
    b.year * 12 + b.month - (a.year * 12 + a.month);
  alteradas.sort(ordena);
  desconhecidas.sort(ordena);

  return { counts, alteradas, desconhecidas };
}
