// ============================================================
// posImportDiag — O FIM DO SILÊNCIO DOS EFEITOS COLATERAIS DO IMPORT.
//
// POR QUE ESTE ARQUIVO EXISTE
// ---------------------------
// O import de fechamento roda 4 blocos best-effort depois de gravar o ledger
// (materializar carteira PRT -> congelar previsão -> monitor de inadimplência ->
// carteira do consórcio). Cada um tem `catch` próprio para NÃO derrubar o
// import — o que está certo. O defeito era o destino do erro: `console.error`.
// Num deploy serverless isso morre no log da invocação e ninguém lê.
//
// CUSTO MEDIDO DESSE SILÊNCIO: a materialização da carteira PRT falhava desde
// 2026-07-07. Foram DOIS fechamentos inteiros (julho e agosto) com
// producao_contrato e carteira_contrato parados em 2026-06, e — por tabela — o
// congelamento da previsão recalculando sempre o vintage 2026-06 e descartando
// tudo no write-once. Descoberto só em 02/09/2026, e por varredura manual.
//
// POR QUE COLUNA EM monthly_closing_imports, E NÃO ITEM NO ledgerHealth
// --------------------------------------------------------------------
// O ledgerHealth é DERIVADO: ele consegue no máximo INFERIR "a carteira está
// atrasada" comparando max(competencia) de carteira_contrato com a última
// competência fechada. Isso avisa que algo quebrou, mas nunca diz O QUÊ — e foi
// exatamente o "o quê" que custou dois meses. A mensagem crua do erro só existe
// no instante da chamada; ou é gravada ali, ou se perde. A coluna guarda o texto
// do erro colado ao import que o causou, sem query extra (é um UPDATE numa linha
// que o import já está escrevendo).
//
// O `ms` de cada bloco NÃO é enfeite: foi cronometrando o bloco (2) em 5,5s
// contra uma janela observada de 43-57s que se descobriu que o bloco (1) queima
// ~38-51 segundos ANTES de falhar — ou seja, execução longa que morre, e não
// erro imediato. Sem o tempo, esse diagnóstico não existe.
//
// Este módulo é PURO de propósito: quem grava é a rota. Assim o portão
// (scripts/gate_pos_import_diag.cjs) pode mutá-lo sem banco.
// ============================================================

/** Um bloco best-effort do pós-import. `erro` só existe quando ok=false. */
export interface BlocoPosImport {
  /** Identificador estável do bloco (não traduzir: é chave de busca no log). */
  nome: string;
  ok: boolean;
  /** Duração em milissegundos — o que distingue "falhou rápido" de "morreu longo". */
  ms: number;
  /** Mensagem CRUA do erro. Nunca resumir, nunca traduzir. */
  erro?: string;
  /** Números úteis do bloco (linhas gravadas, itens detectados…). */
  extra?: Record<string, unknown>;
}

export interface PosImportDiag {
  gerado_em: string;
  /** true se QUALQUER bloco falhou. É por este campo que uma query encontra os imports quebrados. */
  houve_falha: boolean;
  /** Nomes dos blocos que falharam, para a busca não precisar abrir o array. */
  falharam: string[];
  ms_total: number;
  blocos: BlocoPosImport[];
}

/**
 * Monta o rastro dos blocos best-effort.
 *
 * TRÊS INVARIANTES, e o portão muta exatamente estas três:
 *   1. NENHUM bloco é descartado — o diagnóstico mostra o que rodou, inclusive
 *      o que rodou bem (sem isso não dá para saber se o bloco foi sequer
 *      alcançado, que é diferente de ter falhado);
 *   2. bloco com ok=false PRESERVA a mensagem crua em `erro` — perder o texto
 *      reproduz o defeito que este arquivo existe para consertar;
 *   3. `houve_falha` é DERIVADO dos blocos, nunca passado de fora.
 */
export function montarPosImportDiag(
  blocos: BlocoPosImport[],
  agoraIso?: string
): PosImportDiag {
  const lista = (blocos || []).map((b) => {
    const ok = b.ok === true; // === true: `undefined` não vira sucesso por descuido
    const saida: BlocoPosImport = { nome: b.nome, ok, ms: Number(b.ms) || 0 };
    if (!ok) {
      // Invariante 2. Falha SEM texto é pior que falha com texto ruim: registra
      // o placeholder em vez de omitir o campo, para o leitor saber que o bloco
      // quebrou sem dizer por quê (isso é, em si, um achado).
      saida.erro = b.erro && String(b.erro).trim() !== "" ? String(b.erro) : "(erro sem mensagem)";
    }
    if (b.extra && Object.keys(b.extra).length > 0) saida.extra = b.extra;
    return saida;
  });

  return {
    gerado_em: agoraIso || new Date().toISOString(),
    houve_falha: lista.some((b) => !b.ok),
    falharam: lista.filter((b) => !b.ok).map((b) => b.nome),
    ms_total: lista.reduce((s, b) => s + b.ms, 0),
    blocos: lista,
  };
}

/** Nome da coluna que guarda o diagnóstico (migration 20260902_000001). */
export const COLUNA_POS_IMPORT_DIAG = "pos_import_diag";
