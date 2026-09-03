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

/** Tabela que guarda o diagnóstico (migration 20260903_000001). */
export const TABELA_POS_IMPORT_DIAG = "import_pos_diag";

/**
 * De onde veio o import. Texto, não enum — as duas rotas de fechamento
 * registram em tabelas diferentes (`monthly_closing_imports` para a RR,
 * `daily_imports` para a ADS) e a terceira rota que vier não deve exigir
 * migration nova só para se nomear.
 */
export type OrigemImport = "closing_rr" | "closing_ads";

interface SupabaseLike {
  from: (t: string) => any;
}

/**
 * Grava o rastro. NUNCA lança — um import que já escreveu o ledger não pode cair
 * por causa do próprio diagnóstico.
 *
 * MAS a falha daqui não é aceitável em silêncio, e é o que separa esta função de
 * "mais um best-effort": se a tabela não existir (migration 20260903_000001 não
 * aplicada no Studio), o console diz isso com todas as letras, o conteúdo
 * perdido vai junto para o log, E o portão scripts/gate_pos_import_diag.cjs
 * reprova. Verde sem a tabela seria a mesma mentira que este módulo veio
 * desfazer.
 */
export async function registrarPosImportDiag(
  supabase: SupabaseLike,
  params: {
    origem: OrigemImport;
    importId?: string | null;
    year: number;
    month: number;
    diag: PosImportDiag;
  }
): Promise<boolean> {
  const comp = `${params.year}-${String(params.month).padStart(2, "0")}`;
  try {
    const { error } = await supabase.from(TABELA_POS_IMPORT_DIAG).insert({
      origem: params.origem,
      import_id: params.importId ?? null,
      year: params.year,
      month: params.month,
      houve_falha: params.diag.houve_falha,
      falharam: params.diag.falharam,
      ms_total: Math.round(params.diag.ms_total),
      blocos: params.diag.blocos,
    });
    if (error) throw new Error(`${error.code || ""} ${error.message}`.trim());
    if (params.diag.houve_falha) {
      console.error(
        `[pos-import ${params.origem} ${comp}] falha em: ${params.diag.falharam.join(", ")} ` +
          `— rastro em ${TABELA_POS_IMPORT_DIAG} (import ${params.importId ?? "?"}).`
      );
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[pos-import ${params.origem} ${comp}] NAO FOI POSSIVEL GRAVAR o rastro dos efeitos ` +
        `colaterais — ele voltou a ser invisivel. Se o erro for de tabela inexistente, aplique ` +
        `supabase/migrations/20260903_000001_import_pos_diag.sql no Studio. Detalhe: ${msg}`
    );
    console.error(
      `[pos-import ${params.origem} ${comp}] conteudo perdido: ${JSON.stringify(params.diag)}`
    );
    return false;
  }
}
