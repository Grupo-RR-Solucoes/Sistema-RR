// ============================================================
// fila — O LADO IO DA FILA DE MATERIALIZACAO.
//
// As REGRAS estao em ./filaRegras.ts, que e puro de proposito (o portao muta o
// fonte real e _mutanteTs.cjs nao resolve imports). Aqui ficam so as chamadas ao
// banco.
//
// NADA AQUI CHAMA fn_materializar_*. Esse e o ponto da frente: a materializacao
// e disparada por INSERT na fila e executada pelo job pg_cron
// `materializacao_fila`, dentro do banco, onde o statement_timeout de 8s do
// `authenticator` nao vale. Ver supabase/migrations/20260903_000002.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { TABELA_FILA, type LinhaFila } from "./filaRegras.ts";

/** Quantas linhas da fila o diagnostico olha. */
const JANELA_FILA = 25;

const COLUNAS_FILA =
  "id, origem, import_id, year, month, status, tentativas, congelamento_pendente, " +
  "congelado_em, erro, ms, linhas_producao, linhas_carteira, carteira_competencia_max, " +
  "criado_em, iniciado_em, terminado_em";

/**
 * Enfileira a materializacao. UM INSERT — cabe folgado nos 8s do authenticator,
 * que era o teto que a chamada direta das RPCs estourava.
 *
 * LANCA em erro de banco (a rota tem `catch` proprio e registra o bloco com a
 * mensagem crua). Engolir aqui devolveria "enfileirei" sem linha na fila, e ai
 * nem o diagnostico do import seguinte teria o que denunciar.
 */
export async function enfileirarMaterializacao(
  supabase: SupabaseClient,
  params: {
    origem: "closing_rr" | "closing_ads" | "manual";
    importId?: string | null;
    year: number;
    month: number;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from(TABELA_FILA)
    .insert({
      origem: params.origem,
      import_id: params.importId ?? null,
      year: params.year,
      month: params.month,
    })
    .select("id")
    .single();
  if (error) throw new Error(`${error.code || ""} ${error.message}`.trim());
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error("insert na fila nao devolveu id");
  return String(id);
}

/**
 * As ultimas linhas da fila (mais nova primeiro). E a materia-prima do
 * diagnostico E da lista de congelamentos devidos — uma leitura, dois usos.
 */
export async function lerFilaRecente(
  supabase: SupabaseClient,
  limite: number = JANELA_FILA,
): Promise<LinhaFila[]> {
  const { data, error } = await supabase
    .from(TABELA_FILA)
    .select(COLUNAS_FILA)
    .order("criado_em", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`${error.code || ""} ${error.message}`.trim());
  return (data ?? []) as unknown as LinhaFila[];
}

/**
 * Baixa a divida do congelamento de UMA linha.
 *
 * So e chamado DEPOIS de congelarPrevisao ter retornado sem lancar. Baixar antes
 * (ou num `finally`) esconderia um congelamento que falhou: a linha ficaria como
 * paga e aquela competencia nunca mais entraria no catch-up.
 */
export async function marcarCongelamentoFeito(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from(TABELA_FILA)
    .update({ congelamento_pendente: false, congelado_em: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`${error.code || ""} ${error.message}`.trim());
}

/**
 * Janela so-leitura sobre o agendador (cron.job, cron.job_run_details e os
 * timeouts por role). Existe porque o PostgREST desta instancia expoe apenas
 * `public` e `graphql_public`: sem esta RPC nao ha como provar de fora que o job
 * esta vivo — e o portao precisa dessa prova, senao passa por vacuidade.
 */
export async function lerDiagCron(
  supabase: SupabaseClient,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("fn_diag_materializacao_cron");
  if (error) throw new Error(`${error.code || ""} ${error.message}`.trim());
  return (data ?? {}) as Record<string, unknown>;
}
