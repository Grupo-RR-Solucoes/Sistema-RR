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
 *   MULTI_VERSAO   NOVO em 01/09/2026 (Fase 3 bloco 1 da vigencia intra-mes):
 *                  trp_multi_versao === true. A competencia tinha 2+ reguas
 *                  ATIVAS e a linha veio de mais de uma, entao trp_version_id e
 *                  NULL DE PROPOSITO. NAO e DESCONHECIDO (foi calculada COM
 *                  rastreamento) e NAO e stale.
 *
 * FALLBACK: trp_fallback=true e informativo (competencia sem TRP propria, usando
 * a de outra), NAO e stale. Se antes usava fallback e agora subiram a regua
 * propria, o versionId muda -> STALE (o detector pega, corretamente).
 *
 * ============================================================================
 * DIVIDA (ii) — NOMEADA EM VOZ ALTA, porque ninguem vai ser lembrado dela
 * ============================================================================
 * STALENESS DE COMPETENCIA PARTIDA NAO E DETECTAVEL POR ESTA CAMADA. Nem hoje,
 * nem depois: e consequencia direta da decisao (b) do Diego (31/08/2026), e o
 * preco dela foi aceito de olhos abertos.
 *
 * POR QUE. O PMR guarda UM id (trp_version_id). Uma competencia partida foi
 * produzida por N reguas. Numa linha assim o id e NULL por honestidade — e a
 * comparacao "id gravado x id vigente", que E a Camada 1 inteira, deixa de ter
 * os dois lados.
 *
 * O QUE ISSO CUSTA, concretamente: se alguem subir uma TRP39 v3 corrigida, o PMR
 * de agosto/2026 fica desalinhado e NADA acusa. Todas as linhas sao MULTI_VERSAO
 * -> has_stale = false -> detectTrpStaleAfetadasPorVersao NAO devolve agosto ->
 * o commit da regua NAO oferece reconsolidar. Nao havera empurrao automatico
 * para uma competencia partida. NUNCA. Quem reconsolidar agosto reconsolida A
 * MAO, porque decidiu, nao porque o sistema pediu.
 *
 * O CONSERTO, se um dia a vigencia partida deixar de ser evento unico: gravar
 * trp_version_ids uuid[] (o CONJUNTO das fatias que produziram a linha) no lugar
 * do NULL, e comparar conjunto com conjunto. E coluna nova, migration nova, 2
 * escritores (lib/trp/carimboPmr.ts e seus 2 chamadores) e 3 leitores. NAO foi
 * feito porque agosto/2026 e, ate agora, o unico caso da historia.
 * ============================================================================
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { detectMonthRegime } from "@/lib/cmsMonthly";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveTrpRegraDb } from "@/lib/trp/resolveTrpRegraDb";

export type TrpStaleState =
  | "OK"
  | "STALE"
  | "DESCONHECIDO"
  | "NAO_APLICAVEL"
  | "MULTI_VERSAO";

/** Sources que RECALCULAM pela TRP (logo, obsoletaveis pela Camada 1). */
const TRP_SOURCES = new Set(["bbts", "daily"]);

export interface TrpDetectorRow {
  promoter_id: string;
  company_id: string | null;
  source: string;
  stored_version_id: string | null;
  trp_fallback: boolean | null;
  /** trp_multi_versao da linha. NULL = desconhecido (linha anterior a coluna). */
  multi_versao: boolean | null;
  state: TrpStaleState;
}

export interface TrpDetectorResult {
  competencia: string; // "YYYY-MM"
  /** Versao da TRP vigente HOJE para a competencia (null = sem versao no DB). */
  current_version_id: string | null;
  current_is_fallback: boolean | null;
  counts: {
    ok: number;
    stale: number;
    desconhecido: number;
    nao_aplicavel: number;
    multi_versao: number;
  };
  /** Ha ao menos uma linha bbts/daily divergente da regua vigente. */
  has_stale: boolean;
  /** Ha ao menos uma linha bbts/daily sem versao rastreada (historico). */
  has_desconhecido: boolean;
  /**
   * Ha ao menos uma linha de competencia PARTIDA (trp_multi_versao === true).
   * NAO e pendencia: e informativo. Ver a DIVIDA (ii) no topo do arquivo — numa
   * competencia assim a Camada 1 nao consegue dizer se esta stale.
   */
  has_multi_versao: boolean;
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
  /**
   * promoter_monthly_results.trp_multi_versao. Parametro OPCIONAL de proposito:
   * o historico inteiro do PMR esta NULL (medido em 01/09/2026: 0 linhas
   * nao-nulas no banco), e "ausente" tem de se comportar EXATAMENTE como antes.
   */
  multiVersao?: boolean | null,
): TrpStaleState {
  if (!TRP_SOURCES.has(source)) return "NAO_APLICAVEL";
  // `=== true`, NUNCA `!multiVersao` nem truthiness: com `!multiVersao` todo o
  // historico (NULL) viraria MULTI_VERSAO e o detector inteiro se apagaria em
  // silencio. O portao gate_trp_carimbo_multi_versao mata essa mutacao.
  if (multiVersao === true) return "MULTI_VERSAO";
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
    .select("promoter_id, company_id, source, trp_version_id, trp_fallback, trp_multi_versao")
    .eq("year", year)
    .eq("month", month);
  if (error) throw error;

  const rows: TrpDetectorRow[] = [];
  const counts = { ok: 0, stale: 0, desconhecido: 0, nao_aplicavel: 0, multi_versao: 0 };
  for (const r of data || []) {
    const multiVersao = (r as { trp_multi_versao?: boolean | null }).trp_multi_versao ?? null;
    const state = classify(r.source, r.trp_version_id ?? null, currentVersionId, multiVersao);
    if (state === "OK") counts.ok += 1;
    else if (state === "STALE") counts.stale += 1;
    else if (state === "DESCONHECIDO") counts.desconhecido += 1;
    else if (state === "MULTI_VERSAO") counts.multi_versao += 1;
    else counts.nao_aplicavel += 1;
    rows.push({
      promoter_id: r.promoter_id,
      company_id: r.company_id ?? null,
      source: r.source,
      stored_version_id: r.trp_version_id ?? null,
      trp_fallback: r.trp_fallback ?? null,
      multi_versao: multiVersao,
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
    has_multi_versao: counts.multi_versao > 0,
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

const ordenaCompDesc = (
  a: { year: number; month: number },
  b: { year: number; month: number },
) => b.year * 12 + b.month - (a.year * 12 + a.month);

/**
 * Competencias FECHADAS (>= piso) presentes no PMR. Fonte unica de enumeracao das
 * duas varreduras TRP cross (evita duplicar). READ-ONLY. Reusa detectMonthRegime
 * (mes aberto recalcula sozinho -> nao entra). Uma competencia sem PMR nao tem o
 * que ficar obsoleto, por isso partimos do PMR (onde vive trp_version_id).
 */
async function enumerarCompetenciasFechadas(
  sb: SupabaseClient,
): Promise<Array<{ year: number; month: number }>> {
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

  const fechadas: Array<{ year: number; month: number }> = [];
  for (const c of comps.values()) {
    const regime = await detectMonthRegime(sb, c.year, c.month);
    if (regime !== "open") fechadas.push(c);
  }
  return fechadas;
}

export interface TrpStaleCrossResult {
  /** Buckets SEPARADOS — nunca somar num numero so (igual a Camada 2). */
  counts: { ok: number; stale: number; desconhecido: number; multi_versao: number };
  /** Competencias STALE (regua TRP mudou desde o calculo). */
  alteradas: Array<{ year: number; month: number }>;
  /** Competencias DESCONHECIDAS (bbts/daily fechado sem trp_version_id rastreado). */
  desconhecidas: Array<{ year: number; month: number }>;
  /**
   * Competencias de VIGENCIA PARTIDA (agosto/2026 e a primeira). NAO sao
   * pendencia e NAO entram em alteradas/desconhecidas: o NULL delas e
   * deliberado. Bucket proprio para que nao sumam da tela — sem ele, uma
   * competencia partida nao apareceria em bucket NENHUM e o operador leria
   * "nada pendente" onde o certo e "aqui a Camada 1 nao sabe responder".
   * Ver a DIVIDA (ii) no topo do arquivo.
   */
  partidas: Array<{ year: number; month: number }>;
}

/**
 * Varre as competencias FECHADAS com PMR e classifica cada uma quanto a TRP,
 * reusando detectTrpStaleForCompetencia. READ-ONLY. STALE tem precedencia sobre
 * DESCONHECIDO (reconsolidar resolve os dois), e os dois tem precedencia sobre
 * MULTI_VERSAO — que e informativo e vem por ULTIMO justamente porque nao e
 * pendencia: uma competencia partida com linhas TAMBEM stale continua sendo
 * reportada como stale, que e o que pede acao. Espelho cross-competencia da
 * Camada 1, no shape da Camada 2.
 */
export async function detectTrpStaleCrossFechadas(
  client?: SupabaseClient,
): Promise<TrpStaleCrossResult> {
  const sb = client ?? (getSupabaseAdmin() as unknown as SupabaseClient);
  const fechadas = await enumerarCompetenciasFechadas(sb);

  const counts = { ok: 0, stale: 0, desconhecido: 0, multi_versao: 0 };
  const alteradas: Array<{ year: number; month: number }> = [];
  const desconhecidas: Array<{ year: number; month: number }> = [];
  const partidas: Array<{ year: number; month: number }> = [];

  for (const { year, month } of fechadas) {
    const res = await detectTrpStaleForCompetencia({ year, month }, sb);
    if (res.has_stale) {
      counts.stale += 1;
      alteradas.push({ year, month });
    } else if (res.has_desconhecido) {
      counts.desconhecido += 1;
      desconhecidas.push({ year, month });
    } else if (res.has_multi_versao) {
      // PARTIDA e nao stale/desconhecida: informativo, bucket proprio.
      counts.multi_versao += 1;
      partidas.push({ year, month });
    } else if (res.counts.ok > 0) {
      counts.ok += 1;
    }
    // else: todas NAO_APLICAVEL (competencia sem linha bbts) — nao entra em bucket.
  }

  alteradas.sort(ordenaCompDesc);
  desconhecidas.sort(ordenaCompDesc);
  partidas.sort(ordenaCompDesc);
  return { counts, alteradas, desconhecidas, partidas };
}

/**
 * Competencias FECHADAS que ficaram STALE por resolverem para a versao `versionId`
 * (Peca 4 do elo TRP->recalculo: o empurrao no commit). O CONJUNTO AFETADO = a
 * competencia da regua subida + as que caiam em fallback pra ela.
 *
 * COMO determino o fallback SEM reimplementar a cascata: uma competencia resolve
 * para `versionId` sse detectTrpStaleForCompetencia(...).current_version_id ===
 * versionId — e current_version_id vem de resolveTrpRegraDb, que JA aplica a
 * cascata para tras (competencia sem versao propria herda a anterior). Logo o
 * filtro por versionId captura X e os fallbacks-pra-X, e NENHUMA competencia com
 * versao propria diferente (nem stale pre-existente de outra regua). So devolve as
 * que TAMBEM estao STALE (PMR atras da versao vigente). READ-ONLY.
 *
 * ATENCAO — COMPETENCIA PARTIDA NUNCA SAI DAQUI, e isso e por construcao, nao
 * por esquecimento. Numa competencia partida toda linha bbts/daily e
 * MULTI_VERSAO (trp_version_id NULL de proposito), logo has_stale e sempre
 * false e ela JAMAIS entra em `afetadas`. Consequencia pratica: subir uma
 * TRP39 v3 corrigida NAO vai oferecer reconsolidar agosto/2026 — nem agora nem
 * nunca. Quem reconsolidar agosto faz isso a mao. Esta funcao NAO foi alterada
 * na Fase 3 de proposito; ver a DIVIDA (ii) no topo do arquivo, com o conserto
 * (trp_version_ids uuid[]) escrito la para quando o caso deixar de ser unico.
 */
export async function detectTrpStaleAfetadasPorVersao(
  versionId: string,
  client?: SupabaseClient,
): Promise<Array<{ year: number; month: number }>> {
  const sb = client ?? (getSupabaseAdmin() as unknown as SupabaseClient);
  const fechadas = await enumerarCompetenciasFechadas(sb);

  const afetadas: Array<{ year: number; month: number }> = [];
  for (const { year, month } of fechadas) {
    const res = await detectTrpStaleForCompetencia({ year, month }, sb);
    if (res.current_version_id === versionId && res.has_stale) {
      afetadas.push({ year, month });
    }
  }
  afetadas.sort(ordenaCompDesc);
  return afetadas;
}
