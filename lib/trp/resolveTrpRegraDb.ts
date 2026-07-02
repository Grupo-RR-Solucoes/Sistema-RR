/**
 * lib/trp/resolveTrpRegraDb.ts — resolvedor da regra de crédito da TRP a partir
 * do BANCO (trp_rule_versions), atrás da flag TRP_SOURCE (ver trpSource.ts).
 *
 * FASE 2 (TRP self-service): esta função CRIA o caminho DB e o deixa pronto,
 * mas NÃO é plugada no motor. Com a flag default (json) nada a exercita — só o
 * script de paridade da Fase 3 a chama para comparar contra o JSON. O flip da
 * fonte (motor lendo daqui) é a Fase 4.
 *
 * O QUE FAZ:
 *   1. Resolve a competência-alvo (por competência explícita OU por contract_date
 *      via janela de vigência holiday-aware — competenciaDaData).
 *   2. Busca a VERSÃO ATIVA daquela competência (is_active = true).
 *   3. FALLBACK em cascata: se a competência-alvo não tem versão ativa, usa a
 *      competência ANTERIOR mais recente que tenha (isFallback = true). A
 *      vigência retornada é SEMPRE a da competência-ALVO (não a da fornecedora).
 *   4. valid_from/valid_until vêm do util de vigência (lib/trp/vigencia.ts),
 *      NUNCA cravados.
 *
 * regra_json é o RegraMes canônico (mesmo shape do JSON estático) — por isso o
 * consumidor (F3/F4) usa lookupPctInRegra sem adaptação.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { RegraMes } from "@/lib/regrasData";
import {
  competenciaDaData,
  competenciaFirstDay,
  competenciaKey,
  vigenciaDaCompetencia,
} from "@/lib/trp/vigencia";

/** Entrada do resolvedor: competência explícita OU data do contrato (uma das duas). */
export interface ResolveTrpRegraDbParams {
  /** "YYYY-MM" (ou "YYYY-MM-DD"). Tem precedência sobre contractDate. */
  competencia?: string;
  /** "YYYY-MM-DD" — mapeada para competência via janela de vigência holiday-aware. */
  contractDate?: string;
}

export interface TrpRegraDbResolved {
  /** RegraMes canônico (== JSON estático) da versão ativa encontrada. */
  regra: RegraMes;
  /** Competência pedida (YYYY-MM). */
  competenciaAlvo: string;
  /** Competência cuja versão foi de fato usada (== alvo, salvo fallback). */
  competenciaFornecedora: string;
  /** true quando a regra veio de uma competência anterior (cascata). */
  isFallback: boolean;
  /** Vigência holiday-aware da competência-ALVO (ISO YYYY-MM-DD). */
  validFrom: string;
  validUntil: string;
  /** id/version_no da linha trp_rule_versions usada. */
  versionId: string;
  versionNo: number;
}

/** Colunas lidas de trp_rule_versions. */
interface RuleVersionRow {
  id: string;
  competencia: string; // "YYYY-MM-DD" (1º dia do mês)
  version_no: number;
  regra_json: RegraMes;
}

const SELECT_COLS = "id, competencia, version_no, regra_json";

function resolveClient(client?: SupabaseClient): SupabaseClient {
  return client ?? (getSupabaseAdmin() as unknown as SupabaseClient);
}

/**
 * Resolve a regra da TRP a partir do banco. Retorna null quando NEM a
 * competência-alvo NEM qualquer competência anterior têm versão ativa.
 *
 * @param params  { competencia? } tem precedência sobre { contractDate? }.
 * @param client  SupabaseClient opcional (default: service-role admin).
 */
export async function resolveTrpRegraDb(
  params: ResolveTrpRegraDbParams,
  client?: SupabaseClient
): Promise<TrpRegraDbResolved | null> {
  const competenciaAlvo = resolveCompetenciaAlvo(params);
  const { validFrom, validUntil } = vigenciaDaCompetencia(competenciaAlvo);
  const firstDayAlvo = competenciaFirstDay(competenciaAlvo);
  const sb = resolveClient(client);

  // 1) Versão ATIVA da competência-alvo.
  const exact = await sb
    .from("trp_rule_versions")
    .select(SELECT_COLS)
    .eq("competencia", firstDayAlvo)
    .eq("is_active", true)
    .maybeSingle();
  if (exact.error) {
    throw new Error(`resolveTrpRegraDb: erro ao buscar competência ${competenciaAlvo}: ${exact.error.message}`);
  }
  if (exact.data) {
    const row = exact.data as RuleVersionRow;
    return {
      regra: row.regra_json,
      competenciaAlvo,
      competenciaFornecedora: competenciaAlvo,
      isFallback: false,
      validFrom,
      validUntil,
      versionId: row.id,
      versionNo: row.version_no,
    };
  }

  // 2) FALLBACK em cascata: competência anterior ativa mais recente.
  const prev = await sb
    .from("trp_rule_versions")
    .select(SELECT_COLS)
    .lt("competencia", firstDayAlvo)
    .eq("is_active", true)
    .order("competencia", { ascending: false })
    .limit(1);
  if (prev.error) {
    throw new Error(`resolveTrpRegraDb: erro no fallback de ${competenciaAlvo}: ${prev.error.message}`);
  }
  const fallbackRow = (prev.data && prev.data[0]) as RuleVersionRow | undefined;
  if (!fallbackRow) return null;

  return {
    regra: fallbackRow.regra_json,
    competenciaAlvo,
    competenciaFornecedora: competenciaKey(fallbackRow.competencia),
    isFallback: true,
    validFrom,
    validUntil,
    versionId: fallbackRow.id,
    versionNo: fallbackRow.version_no,
  };
}

function resolveCompetenciaAlvo(params: ResolveTrpRegraDbParams): string {
  if (params.competencia) return competenciaKey(params.competencia);
  if (params.contractDate) return competenciaDaData(params.contractDate);
  throw new Error("resolveTrpRegraDb: informe competencia OU contractDate");
}

// ---------------------------------------------------------------------------
// Preload por request — lookup SÍNCRONO sobre versões carregadas 1x (async).
// ---------------------------------------------------------------------------
//
// getRegra (JSON) é síncrono; o banco é async. Este preloader resolve as
// competências necessárias UMA vez (async) para um Map competência→resolvido,
// e depois o consumidor faz o lookup SÍNCRONO. Deixado pronto para a F3/F4;
// NÃO está ligado ao motor nesta fase.

export interface TrpRegraDbPreloader {
  /** Resolve e memoiza as competências dadas (YYYY-MM). Idempotente. */
  preload(competencias: string[]): Promise<void>;
  /** Lookup SÍNCRONO do resolvido (null se não pré-carregado ou sem versão). */
  getResolvedSync(competencia: string): TrpRegraDbResolved | null;
  /** Lookup SÍNCRONO só da RegraMes (null se não pré-carregado ou sem versão). */
  getRegraSync(competencia: string): RegraMes | null;
  /** true se a competência já passou por preload (mesmo que sem versão). */
  hasLoaded(competencia: string): boolean;
}

export function createTrpRegraDbPreloader(client?: SupabaseClient): TrpRegraDbPreloader {
  const sb = resolveClient(client);
  const cache = new Map<string, TrpRegraDbResolved | null>();

  return {
    async preload(competencias: string[]): Promise<void> {
      const alvos = Array.from(new Set(competencias.map((c) => competenciaKey(c))));
      const pendentes = alvos.filter((c) => !cache.has(c));
      await Promise.all(
        pendentes.map(async (comp) => {
          const resolved = await resolveTrpRegraDb({ competencia: comp }, sb);
          cache.set(comp, resolved);
        })
      );
    },
    getResolvedSync(competencia: string): TrpRegraDbResolved | null {
      return cache.get(competenciaKey(competencia)) ?? null;
    },
    getRegraSync(competencia: string): RegraMes | null {
      return cache.get(competenciaKey(competencia))?.regra ?? null;
    },
    hasLoaded(competencia: string): boolean {
      return cache.has(competenciaKey(competencia));
    },
  };
}
