// ============================================================================
// RÉGUA ÚNICA DO PERCENTUAL DO PDF DA TRP — separador decimal.
//
// DECISÃO DO DIEGO (02/09/2026): o documento pode escrever o percentual com
// VÍRGULA ("2,44%") ou com PONTO ("10.23%"), e o sistema tem de ler os dois.
// NÃO é caso especial da TRP40 (onde o defeito apareceu: as colunas de faixa do
// CONSIG_PUBLICO, CONSIG_SP_MG e NAO_CONSIGNADO vieram com ponto enquanto a
// coluna de taxa da MESMA linha veio com vírgula) — é o formato que o documento
// pode usar.
//
// Este arquivo é o SÍTIO ÚNICO da decisão. Todo lugar que lê percentual do PDF
// da TRP monta a sua regex a partir de PCT_NUM_SRC e converte por pctToDec —
// ninguém reimplementa a forma nem a conversão. (Antes daqui havia DUAS cópias
// de pctToDec, em parseTrpPdf.ts e parseTrpDraft.ts, e quatro regexes com o
// separador cravado à mão.)
//
// ---------------------------------------------------------------------------
// A AMBIGUIDADE DO MILHAR — como é decidida, e por que assim
// ---------------------------------------------------------------------------
// Aceitar o ponto reabre a dúvida: "10.23" é dez vírgula vinte e três, ou é um
// separador de milhar? A régua tem três degraus, todos BARULHENTOS — o parser
// nunca adivinha em silêncio:
//
//   (a) TETO SEMÂNTICO. Percentual de TRP nunca chega a 100. Qualquer leitura
//       que resulte em >= 100 é RECUSADA (lança), NUNCA "normalizada" tirando o
//       separador. Normalizar seria silencioso e gravaria régua errada: um
//       "1.234,56%" mal lido viraria 1.234,56% ou 123.456% sem ninguém ver.
//       Recusar é barulhento e o sócio corrige antes de gravar.
//
//   (b) FORMA AMBÍGUA -> LANÇA. "1.234" é milhar-válido (1..3 dígitos, ponto,
//       exatamente 3 dígitos) E decimal-plausível ao mesmo tempo: as duas
//       leituras (1,234 e 1234) são defensáveis e escolher uma seria chute.
//       Lança. "10.23" NÃO é ambíguo: 2 casas não formam grupo de milhar, então
//       só a leitura decimal existe — e ela passa em (a) com folga.
//
//   (c) DUAS FORMAS NO MESMO TOKEN ("1.234,56") não é percentual de TRP — seria
//       > 1000. Não casa a forma canônica e lança por forma não reconhecida.
//
// O degrau (a) é o que faz o (b) ser conservador em vez de tímido: mesmo que um
// dia a régua de (b) deixasse passar uma leitura de milhar, o teto de 100 a
// pegaria. São duas redes, não uma.
//
// O QUE ISTO **NÃO** AFROUXA: a lição dos três layouts da BBTS vale aqui —
// aceitar mais forma de VALOR não aceita mais forma de LINHA. As âncoras de
// produto (PROD_ANCHORS), o STOP, o HDR e as validações de plausibilidade da
// matriz (MAX_PLAUSIVEL, faixas completas, 11 produtos) continuam exatamente
// como estavam. Nada aqui os toca.
// ============================================================================

/** Falha de LEITURA de percentual (forma não reconhecida, ambígua ou recusada).
 *  Lançada pelo sítio; quem monta o draft converte em erro visível (422). */
export class TrpPctError extends Error {
  constructor(message: string, readonly detalhe?: string) {
    super(message);
    this.name = "TrpPctError";
  }
}

/** Forma do NÚMERO de um percentual no PDF da TRP: dígitos, UM separador
 *  decimal (ponto OU vírgula), dígitos. Fonte única — toda regex que procura
 *  percentual no texto do PDF é montada a partir daqui. */
export const PCT_NUM_SRC = String.raw`\d+[.,]\d+`;

/** Forma do TOKEN completo com o sinal de %, já com grupo de captura. */
export const PCT_TOKEN_SRC = `(${PCT_NUM_SRC})%`;

/** Teto semântico do percentual de TRP — decisão (a). Exclusivo. */
export const PCT_MAX_EXCLUSIVO = 100;

/** Forma milhar-válida com ponto: 1..3 dígitos + ponto + EXATAMENTE 3 dígitos
 *  ("1.234", "10.234"). É a única forma em que decimal e milhar são as duas
 *  defensáveis — decisão (b): lança. */
const MILHAR_AMBIGUO = /^\d{1,3}\.\d{3}$/;

const NUM_CANONICO = new RegExp(`^${PCT_NUM_SRC}$`);

/**
 * "2,44" -> 0.0244 ; "10.23" -> 0.1023. Round 6 (igual ao round(x/100, 6) do
 * Python original — a paridade dos 195 valores × 3 PDFs depende disso).
 *
 * LANÇA TrpPctError em vez de adivinhar: forma não reconhecida, forma ambígua
 * de milhar (b), ou resultado >= 100 (a). Ver o cabeçalho do arquivo.
 */
export function pctToDec(tok: string): number {
  const t = String(tok).trim();
  if (!NUM_CANONICO.test(t)) {
    throw new TrpPctError(
      "percentual em forma não reconhecida",
      `token '${tok}' — esperado dígitos + UM separador decimal (',' ou '.') + dígitos`,
    );
  }
  if (MILHAR_AMBIGUO.test(t)) {
    throw new TrpPctError(
      "percentual ambíguo: ponto seguido de exatamente 3 casas",
      `token '${tok}' — decimal (${t}) e separador de milhar (${t.replace(".", "")}) são ambas ` +
        `leituras defensáveis; o parser NÃO adivinha. Confira o PDF antes de gravar.`,
    );
  }
  const n = parseFloat(t.replace(",", "."));
  if (!Number.isFinite(n)) {
    throw new TrpPctError("percentual não numérico", `token '${tok}'`);
  }
  if (n >= PCT_MAX_EXCLUSIVO) {
    throw new TrpPctError(
      `percentual >= ${PCT_MAX_EXCLUSIVO} — leitura RECUSADA`,
      `token '${tok}' -> ${n}. Percentual de TRP nunca chega a ${PCT_MAX_EXCLUSIVO}; ` +
        `a leitura é recusada, NUNCA normalizada tirando o separador.`,
    );
  }
  return Number((n / 100).toFixed(6));
}

/** Regex NOVA (stateful com /g — nunca compartilhe a instância) que casa um
 *  token de percentual no texto do PDF. Fábrica, não constante, para não vazar
 *  lastIndex entre chamadas. */
export function pctTokenRegex(flags = "g"): RegExp {
  return new RegExp(PCT_TOKEN_SRC, flags);
}
