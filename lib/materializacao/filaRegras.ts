// ============================================================
// filaRegras — AS REGRAS DA FILA DE MATERIALIZACAO, SEM BANCO.
//
// POR QUE ESTE ARQUIVO EXISTE
// ---------------------------
// A materializacao da carteira PRT deixou de ser chamada pela rota e virou uma
// FILA (migration 20260903_000002): a rota INSERE uma linha e um job pg_cron
// roda as duas funcoes DENTRO do banco, onde o statement_timeout de 8s do
// `authenticator` nao vale. Medido: as duas funcoes queimam 38-51s por uma porta
// que corta em 8s, e por isso a materializacao esteve morta de 2026-07-07 a
// 2026-09-02.
//
// TROCAR SINCRONO POR ASSINCRONO TEM UM PRECO, E ELE E O SILENCIO. Antes, a
// falha era imediata e (depois do conserto de 03/09) ficava em import_pos_diag.
// Com fila, "enfileirei" NAO e "funcionou": se o job do cron nunca rodar, a
// linha fica PENDENTE para sempre e a carteira envelhece sem que ninguem veja.
// E por isso que `diagnosticoFila` existe e que o bloco do pos-import olha a
// fila INTEIRA, e nao so o insert que acabou de fazer. Sem isso esta frente
// teria trocado um defeito visivel por um invisivel.
//
// O SEGUNDO PONTO: A COMPETENCIA DO CONGELAMENTO.
// `congelarPrevisao` e TypeScript (buildPrtAgenda + buildAvistaProducao) e nao
// pode rodar dentro do banco. Ele passa a rodar em CATCH-UP — no import seguinte
// ou por chamada explicita — lendo desta fila QUAL competencia esta devendo.
// Antes ele tirava a competencia do max(competencia) de carteira_contrato, e foi
// exatamente isso que deixou o vintage de 2026-07 inalcancavel: quando a
// carteira foi finalmente materializada (02/09), o max ja era 2026-08 e julho
// nunca mais teve como ser congelado. A competencia agora vem de PARAMETRO.
//
// Este modulo e PURO de proposito: quem fala com o banco e lib/materializacao/
// fila.ts. Assim o portao (scripts/gate_materializacao_fila.cjs) pode MUTA-LO
// sem banco, do jeito que scripts/_mutanteTs.cjs exige (modulo sem import).
// ============================================================

/** Tabela da fila (migration 20260903_000002). */
export const TABELA_FILA = "materializacao_fila";

/** Nome do job pg_cron que processa a fila. */
export const JOB_CRON = "materializacao_fila";

export type StatusFila = "PENDENTE" | "RODANDO" | "OK" | "ERRO";

/**
 * A partir de quanto tempo uma linha que ainda nao terminou deixa de ser
 * "recem-enfileirada" e passa a ser "o worker nao rodou".
 *
 * O job e de 1 minuto e a materializacao mede 38-51s; 10 minutos da uma ordem de
 * grandeza de folga sobre o pior caso e ainda denuncia no MESMO dia. Numero
 * frouxo de proposito: a pergunta que ele responde e "o agendador esta vivo?",
 * nao "quanto tempo levou?" (esse numero e o `ms` da propria linha).
 */
export const ATRASO_FILA_MS = 10 * 60 * 1000;

/** Uma linha da fila, como ela sai do banco. */
export interface LinhaFila {
  id: string;
  origem: string;
  import_id?: string | null;
  year: number | null;
  month: number | null;
  status: StatusFila | string;
  tentativas?: number | null;
  congelamento_pendente: boolean;
  congelado_em?: string | null;
  erro?: string | null;
  ms?: number | null;
  linhas_producao?: number | null;
  linhas_carteira?: number | null;
  carteira_competencia_max?: string | null;
  criado_em: string;
  iniciado_em?: string | null;
  terminado_em?: string | null;
}

/** Bloco do pos-import (mesmo shape de lib/diagnostico/posImportDiag.ts). */
export interface BlocoFila {
  nome: string;
  ok: boolean;
  ms: number;
  erro?: string;
  extra?: Record<string, unknown>;
}

/**
 * Competencia "YYYY-MM" da linha, ou null quando a linha nao tem par
 * (year, month).
 *
 * null e RESPOSTA, nao falha: linha sem competencia (um `origem='manual'` de
 * emergencia, por exemplo) nao tem congelamento a dever, e inventar uma
 * competencia aqui congelaria o vintage errado. Quem consome trata o null como
 * "nao ha o que congelar".
 */
export function competenciaDaLinha(
  linha: Pick<LinhaFila, "year" | "month">,
): string | null {
  const y = Number(linha?.year);
  const m = Number(linha?.month);
  if (!Number.isInteger(y) || !Number.isInteger(m)) return null;
  if (y < 2000 || y > 2999 || m < 1 || m > 12) return null;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * As competencias cujo congelamento esta devendo, MAIS ANTIGA PRIMEIRO.
 *
 * DUAS CONDICOES, e as duas importam:
 *   - `status === "OK"`: congelar em cima de uma materializacao que nao terminou
 *     le a carteira VELHA. E pior que nao congelar, porque previsao_snapshot e
 *     write-once (ON CONFLICT DO NOTHING): o vintage errado gravado hoje nao
 *     pode ser corrigido depois. Foi assim que jun/2026 ficou com
 *     previsto_diferido NULL para sempre.
 *   - `congelamento_pendente === true`, comparacao ESTRITA. `!== false` daria
 *     verdadeiro para null/undefined e mandaria recongelar o historico inteiro a
 *     cada import (mesma armadilha do trp_multi_versao e do piso_zerou).
 *
 * A ORDEM e parte da regra: julho antes de agosto. Congelar agosto primeiro nao
 * "perde" julho (a competencia agora vem de parametro), mas grava os vintages em
 * ordem invertida no tempo, e a leitura "previsto ENTAO" fica mentindo sobre
 * qual foi o primeiro.
 */
export function congelamentosPendentes(
  linhas: LinhaFila[],
): Array<{ id: string; competencia: string }> {
  const alvo: Array<{ id: string; competencia: string; criado_em: string }> = [];
  for (const l of linhas || []) {
    if (l?.status !== "OK") continue;
    if (l?.congelamento_pendente !== true) continue;
    const comp = competenciaDaLinha(l);
    if (!comp) continue;
    alvo.push({ id: String(l.id), competencia: comp, criado_em: String(l.criado_em || "") });
  }
  alvo.sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : 0));
  // Uma competencia por vez: dois imports da mesma competencia (reimportacao)
  // deixam duas linhas OK, e o 2o congelamento seria descartado pelo write-once
  // com um aviso falso de "vintage ja existia".
  const vistas = new Set<string>();
  const saida: Array<{ id: string; competencia: string }> = [];
  for (const a of alvo) {
    if (vistas.has(a.competencia)) continue;
    vistas.add(a.competencia);
    saida.push({ id: a.id, competencia: a.competencia });
  }
  return saida;
}

export interface DiagnosticoFila {
  /** Linhas que nao terminaram e ja passaram de ATRASO_FILA_MS. */
  atrasadas: LinhaFila[];
  /** Linhas com status ERRO (a mensagem crua esta em `erro`). */
  comErro: LinhaFila[];
  pendentes: number;
  rodando: number;
  ok: number;
  /** false quando ha atraso ou erro — e o que faz o bloco do pos-import falhar. */
  saudavel: boolean;
  /** Texto legivel do problema, ou null quando saudavel. */
  mensagem: string | null;
}

/**
 * O que a fila denuncia AGORA.
 *
 * ESTA E A DEFESA CONTRA O SILENCIO DO ASSINCRONO. "Enfileirei com sucesso" nao
 * e resposta: se o job pg_cron nao existir, nao estiver ativo ou estiver
 * falhando, o insert continua dando 200 e a carteira envelhece calada — que e
 * exatamente o defeito de 2026-07-07, so mudado de lugar. Ao olhar a fila
 * INTEIRA (e nao a linha que acabou de inserir), o import seguinte carrega a
 * denuncia do anterior para import_pos_diag.
 */
export function diagnosticoFila(linhas: LinhaFila[], agoraMs: number): DiagnosticoFila {
  const lista = linhas || [];
  const atrasadas: LinhaFila[] = [];
  const comErro: LinhaFila[] = [];
  let pendentes = 0;
  let rodando = 0;
  let ok = 0;

  for (const l of lista) {
    if (l?.status === "ERRO") comErro.push(l);
    if (l?.status === "OK") ok += 1;
    if (l?.status === "PENDENTE") pendentes += 1;
    if (l?.status === "RODANDO") rodando += 1;
    if (l?.status !== "PENDENTE" && l?.status !== "RODANDO") continue;
    const nascida = Date.parse(String(l?.criado_em || ""));
    if (!Number.isFinite(nascida)) continue;
    if (agoraMs - nascida > ATRASO_FILA_MS) atrasadas.push(l);
  }

  const partes: string[] = [];
  if (atrasadas.length > 0) {
    const min = Math.round(ATRASO_FILA_MS / 60000);
    partes.push(
      `${atrasadas.length} linha(s) da fila ${TABELA_FILA} sem terminar ha mais de ` +
        `${min} min (a mais antiga: ${atrasadas[0].criado_em}). O job pg_cron ` +
        `'${JOB_CRON}' provavelmente nao esta rodando — confira com ` +
        `fn_diag_materializacao_cron(). A carteira PRT esta envelhecendo.`,
    );
  }
  if (comErro.length > 0) {
    partes.push(
      `${comErro.length} linha(s) da fila com status ERRO. Mensagem crua da mais ` +
        `recente: ${comErro[0].erro || "(erro sem mensagem)"}`,
    );
  }

  return {
    atrasadas,
    comErro,
    pendentes,
    rodando,
    ok,
    saudavel: atrasadas.length === 0 && comErro.length === 0,
    mensagem: partes.length > 0 ? partes.join(" | ") : null,
  };
}

/**
 * Bloco do pos-import da etapa de ENFILEIRAMENTO.
 *
 * ok=true exige AS DUAS coisas: o insert passou (tem `jobId`) E a fila esta
 * saudavel. So a primeira seria o silencio de volta; so a segunda deixaria um
 * insert falhado passar por verde quando a fila antiga estivesse limpa.
 */
export function blocoEnfileiramento(params: {
  jobId?: string | null;
  ms: number;
  erro?: string | null;
  diagnostico?: DiagnosticoFila | null;
  puladoPorFileType?: boolean;
}): BlocoFila {
  const jobId = params.jobId || null;
  const erroInsert = params.erro && String(params.erro).trim() !== "" ? String(params.erro) : null;
  const diag = params.diagnostico || null;
  const enfileirou = !!jobId && !erroInsert;
  const okFila = diag ? diag.saudavel === true : true;

  const bloco: BlocoFila = {
    nome: "materializacao_carteira_prt",
    ok: enfileirou && okFila,
    ms: Number(params.ms) || 0,
    extra: {
      via: "fila",
      job_id: jobId,
      pulado_por_filetype: params.puladoPorFileType === true,
      fila_pendentes: diag ? diag.pendentes : null,
      fila_rodando: diag ? diag.rodando : null,
      fila_ok: diag ? diag.ok : null,
      fila_atrasadas: diag ? diag.atrasadas.length : null,
      fila_com_erro: diag ? diag.comErro.length : null,
    },
  };

  if (!bloco.ok) {
    // A mensagem crua do insert vem primeiro (e a causa mais proxima); a denuncia
    // da fila vem junto porque as duas podem ser verdade ao mesmo tempo.
    const msgs = [erroInsert, diag ? diag.mensagem : null].filter(
      (m): m is string => !!m && m.trim() !== "",
    );
    bloco.erro = msgs.length > 0 ? msgs.join(" | ") : "(erro sem mensagem)";
  }

  return bloco;
}
