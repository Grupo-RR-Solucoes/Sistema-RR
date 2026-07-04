// ============================================================
// RECEBIVEIS — sub-PR 1: CONGELAMENTO (snapshot) da previsão vigente.
//
// Congela, no momento do fechamento, a CURVA FORWARD que a projeção previu
// (buildPrtAgenda + buildAvistaProducao), para permitir depois o confronto
// "previsto ENTÃO vs recebido DEPOIS". Sem isto, o previsto é sempre re-derivado
// e o histórico de previsão é irrecuperável.
//
// Idempotente: ON CONFLICT (competencia_snapshot, competencia_alvo) DO NOTHING —
// o PRIMEIRO congelamento vence (re-importar o mesmo fechamento não sobrescreve a
// previsão autêntica). READ da projeção + WRITE só em previsao_snapshot; NÃO altera
// nada existente.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildPrtAgenda } from "./prtAgenda.ts";
import { buildAvistaProducao } from "./avistaProducao.ts";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CongelarPrevisaoResult {
  /** Competência do snapshot (vintage) usado neste congelamento. */
  competenciaSnapshot: string;
  /** Linhas efetivamente inseridas (novas) — 0 se tudo já existia (idempotência). */
  linhasGravadas: number;
  /** Linhas da curva forward (inseridas OU já existentes). */
  linhasProjetadas: number;
}

/**
 * Congela a projeção de recebíveis vigente em `previsao_snapshot`.
 * `horizonteMeses` = quantos meses à frente congelar (default 12).
 */
export async function congelarPrevisao(
  supabase: SupabaseClient,
  options: { horizonteMeses?: number } = {},
): Promise<CongelarPrevisaoResult> {
  const horizonteMeses = options.horizonteMeses ?? 12;

  const [agenda, avista] = await Promise.all([
    buildPrtAgenda(supabase, { horizonteMeses }),
    buildAvistaProducao(supabase, {}),
  ]);

  const competenciaSnapshot = agenda.snapshot.competencia;

  // previsto PRT por competência-alvo: base do snapshot (h=0) + a série forward.
  const previstoPrtByAlvo = new Map<string, number>();
  previstoPrtByAlvo.set(agenda.snapshot.competencia, agenda.baseComissao);
  for (const p of agenda.serie) previstoPrtByAlvo.set(p.competencia, p.previsto);

  // à-vista previsto só existe na competência da produção aberta.
  const rows = Array.from(previstoPrtByAlvo.entries()).map(([alvo, previstoPrt]) => {
    const ehProducaoAberta = avista.competenciaProducao === alvo;
    return {
      competencia_snapshot: competenciaSnapshot,
      competencia_alvo: alvo,
      previsto_prt: round2(previstoPrt),
      previsto_avista: ehProducaoAberta ? round2(avista.avistaPrevisto) : null,
      previsto_diferido: null as number | null, // sub-PR 2
      base_snapshot_prt: agenda.snapshot.competencia,
      contratos_avista_fallback:
        ehProducaoAberta && avista.competenciaFallback ? avista.contratosFallback : null,
    };
  });

  // ON CONFLICT (competencia_snapshot, competencia_alvo) DO NOTHING.
  // ignoreDuplicates:true -> só insere o que não existe; .select() devolve apenas
  // as linhas realmente inseridas (2ª rodada = 0 linhas => idempotência provada).
  const { data, error } = await supabase
    .from("previsao_snapshot")
    .upsert(rows, {
      onConflict: "competencia_snapshot,competencia_alvo",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw new Error(error.message);

  return {
    competenciaSnapshot,
    linhasGravadas: (data ?? []).length,
    linhasProjetadas: rows.length,
  };
}
