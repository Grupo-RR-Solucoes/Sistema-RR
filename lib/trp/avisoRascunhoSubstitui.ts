// ============================================================================
// lib/trp/avisoRascunhoSubstitui.ts — QUANDO avisar que confirmar este rascunho
// vai SUBSTITUIR a régua ativa em vez de PARTIR a competência.
//
// Item 2 da frente de dívidas (02/09/2026). A armadilha que este aviso fecha:
// no fluxo DELEGADO (rascunho aberto pela caixa) o campo de override é
// SÓ-LEITURA — de propósito, porque o servidor lê a data da LINHA do staging e
// um campo editável ali faria a tela divergir do que é gravado. Só que o botão
// "Salvar rascunho" também não existe com um rascunho aberto. Consequência: um
// rascunho salvo SEM override **não tem como receber a data** e, confirmado
// assim, cai na SAÍDA 1 do RPC (SUBSTITUI) — desativando a fatia ativa e pondo a
// régua nova valendo o mês inteiro. É o desenho 5b, que o Diego RECUSOU.
//
// Aconteceu em 01/09/2026 e foi pego na conferência, não pelo sistema: nada
// avisava. Este módulo é o aviso.
//
// A CONDIÇÃO TEM TRÊS PERNAS, e a terceira é a que evita ruído:
//   1. estamos no fluxo DELEGADO (há rascunho aberto);
//   2. o rascunho NÃO tem override;
//   3. a competência JÁ TEM régua ativa.
//
// Sem a (3) o aviso apareceria em todo primeiro upload de todo mês — onde
// confirmar sem override é exatamente o caminho normal e correto. Aviso que
// aparece quando não há o que avisar treina a ignorar o aviso, e aí ele não
// serve para o dia em que importa.
// ============================================================================

/** Fatia ATIVA da competência, no shape que a tela recebe do staging. */
export interface FatiaAtiva {
  version_no: number;
  valid_from: string;
  valid_until: string;
}

export interface AvisoSubstituicaoInput {
  /** true quando há rascunho aberto da caixa (fluxo delegado). */
  delegado: boolean;
  /** valid_from_override do rascunho — null/"" = sem override. */
  overrideDoRascunho: string | null | undefined;
  /** Fatias ATIVAS da competência do rascunho, como o servidor as leu. */
  fatiasAtivas: FatiaAtiva[] | null | undefined;
}

/**
 * PURA. true = a tela tem de interromper com o aviso de substituição.
 *
 * As três pernas com `&&`: tirar qualquer uma produz um aviso errado — e as duas
 * primeiras erram para o lado PERIGOSO (avisar onde não deve, ou calar onde
 * deve). O portão gate_trp_override_vigencia mata as três mutações.
 */
export function deveAvisarSubstituicao(input: AvisoSubstituicaoInput): boolean {
  const temOverride = !!(input.overrideDoRascunho && String(input.overrideDoRascunho).trim());
  const temReguaAtiva = (input.fatiasAtivas?.length ?? 0) > 0;
  return input.delegado && !temOverride && temReguaAtiva;
}

/**
 * A fatia que seria DESATIVADA pela substituição: a de maior valid_from, que é
 * contra quem o RPC decide (`order by valid_from desc limit 1`).
 *
 * MÁXIMO CALCULADO AQUI, não `[0]` — a lista vem de uma query cuja ordem pode
 * mudar, e nomear a fatia errada num aviso é pior que não nomear nenhuma. É a
 * mesma lição do anteparo do buraco (commitVersion.ts).
 */
export function fatiaQueSeriaSubstituida(fatias: FatiaAtiva[] | null | undefined): FatiaAtiva | null {
  if (!fatias || fatias.length === 0) return null;
  return fatias.reduce((a, b) => (b.valid_from > a.valid_from ? b : a));
}
