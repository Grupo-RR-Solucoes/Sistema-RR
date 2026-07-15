/**
 * lib/rulesFingerprint.ts — DETECTOR de regua obsoleta, CAMADA 2 (hash de conteudo).
 *
 * A Camada 1 (trp_version_id) cobre a TRP — a unica regua com id de versao
 * estavel. Esta Camada 2 cobre as reguas MUTAVEIS SEM VERSAO que tambem
 * obsoletam o PMR (share profile, goal_repasse, metas, j_keys, empresas RR, e a
 * fonte). Um UPDATE nelas muda o passado SEM RASTRO, e o updated_at NAO serve de
 * detector (medido: goal_repasse 19/19 congelado; 6/10 tabelas sem a coluna;
 * zero trigger). Logo: hash de CONTEUDO, calculado no BANCO por uma RPC unica
 * (compute_rules_fingerprint) que GRAVA e COMPARA — sem drift JS/PG.
 *
 * READ-ONLY do lado do detector: detectRulesStale() so recomputa e confronta com
 * o baseline gravado. Quem GRAVA e o consolidador (persistRulesFingerprint),
 * chamado dentro de reconsolidarCompetenciaFechada.
 *
 * Ver supabase/migrations/20260715_000001_pmr_rules_fingerprint_camada2.sql para
 * o conjunto EXATO (dentro/fora) e as LIMITACOES documentadas (agregado da fonte;
 * share_scale/tier fora ate a escala entrante entrar em uso).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/** Versao do algoritmo de serializacao/hash. Bump = todos viram STALE (proposital). */
export const RULES_FP_ALGO = "md5-canon-v1";

/** Grupos de source com conjunto de reguas proprio. Hoje so 'fechado'. */
export type RulesSourceGroup = "fechado";

export type RulesStaleState = "OK" | "STALE" | "DESCONHECIDO";

export interface RulesStaleRow {
  year: number;
  month: number;
  source_group: string;
  stored_fp: string | null;
  current_fp: string | null;
  state: RulesStaleState;
}

export interface RulesStaleResult {
  /** Buckets SEPARADOS — nunca somar num numero so. */
  counts: { ok: number; stale: number; desconhecido: number };
  /** Competencias STALE (regua mudou desde o calculo). */
  alteradas: Array<{ year: number; month: number }>;
  /** Competencias DESCONHECIDAS (fechadas antes desta Camada; sem baseline). */
  desconhecidas: Array<{ year: number; month: number }>;
  /** Detalhe por competencia. */
  competencias: RulesStaleRow[];
}

/**
 * Grava (upsert) o baseline do fingerprint das reguas que produziram o PMR
 * FECHADO desta competencia. Chamada pelo consolidador apos reescrever o PMR.
 *
 * MICRO-RACE documentada: os consolidadores leem as reguas em T (dentro de
 * consolidateMonthlyGroup) e a RPC le de novo em T+e. Se uma regua mudar nesse
 * intervalo, o baseline gravado nao corresponde ao PMR calculado. Aceitavel —
 * reconsolidacao e manual e rara. Registrado.
 */
export async function persistRulesFingerprint(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  year: number,
  month: number,
  group: RulesSourceGroup = "fechado",
): Promise<{ fingerprint: string }> {
  const { data, error } = await supabase.rpc("compute_rules_fingerprint", {
    p_year: year,
    p_month: month,
    p_grp: group,
  });
  if (error) throw error;
  const fingerprint = data as unknown as string;

  const { error: upErr } = await supabase
    .from("pmr_rules_fingerprint")
    .upsert(
      {
        year,
        month,
        source_group: group,
        fingerprint,
        algo: RULES_FP_ALGO,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "year,month,source_group" },
    );
  if (upErr) throw upErr;

  return { fingerprint };
}

/**
 * Varre todas as competencias com PMR fechado e classifica cada uma em
 * OK / STALE / DESCONHECIDO, recomputando o fingerprint e confrontando com o
 * baseline. READ-ONLY. DESCONHECIDO e STALE sao buckets SEPARADOS.
 */
export async function detectRulesStale(
  client?: SupabaseClient,
): Promise<RulesStaleResult> {
  const sb = client ?? (getSupabaseAdmin() as unknown as SupabaseClient);

  const { data, error } = await sb.rpc("detect_rules_stale");
  if (error) throw error;

  const rows = ((data as RulesStaleRow[]) || []).map((r) => ({
    year: Number(r.year),
    month: Number(r.month),
    source_group: r.source_group,
    stored_fp: r.stored_fp ?? null,
    current_fp: r.current_fp ?? null,
    state: r.state as RulesStaleState,
  }));

  const counts = { ok: 0, stale: 0, desconhecido: 0 };
  const alteradas: Array<{ year: number; month: number }> = [];
  const desconhecidas: Array<{ year: number; month: number }> = [];
  for (const r of rows) {
    if (r.state === "OK") counts.ok += 1;
    else if (r.state === "STALE") {
      counts.stale += 1;
      alteradas.push({ year: r.year, month: r.month });
    } else {
      counts.desconhecido += 1;
      desconhecidas.push({ year: r.year, month: r.month });
    }
  }

  return { counts, alteradas, desconhecidas, competencias: rows };
}
