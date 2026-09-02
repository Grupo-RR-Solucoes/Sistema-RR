// ============================================================================
// F6b sub-fase 1 — montagem do DRAFT + validações automáticas (backend puro).
//
// Roda parseTrpPdf (F6a, unpdf) no servidor e monta um RegraMes DRAFT + _meta +
// metadados de confiança (provado = os 195 pct que o parser garante; conferir =
// estrutura best-effort a verificar na revisão). NÃO grava nada, NÃO lê banco.
// A leitura da TRP anterior (diff) e a gravação são responsabilidade da rota /
// sub-fases seguintes.
//
// Falha do parser / validação absurda -> LANÇA erro tipado (a rota converte em
// resposta de erro visível; princípio TrpInfraError — nada de meia-regra).
// ============================================================================

import {
  extractLinesFromPdf,
  parseMatrix,
  parseConvenios,
  parseSec5,
  parseEscalares,
  parsePrazoCategoria,
  type ProdutoExtraido,
  type EscalaresCategoria,
} from "@/lib/trp/parseTrpPdf";
import { PCT_NUM_SRC, pctToDec, TrpPctError } from "@/lib/trp/pctTrp";
import { vigenciaDaCompetencia, competenciaKey } from "@/lib/trp/vigencia";

export const PARSER_VERSION = "f6a-unpdf-1";

/** Os 11 produtos que uma TRP VOLUME_5_FAIXAS deve conter. */
export const EXPECTED_PRODUCTS = [
  "INSS_NOVO", "INSS_RENOV", "CONSIG_PUBLICO", "SIAPE", "CONSIG_SP_MG",
  "CONSIG_PRIVADO", "PORTAB_PUBLICO", "PORTAB_PRIVADO", "NAO_CONSIGNADO",
  "ADIANTAMENTO_13", "FGTS",
] as const;

/** Teto à-vista da EMPRESA (cap aplicado no cálculo, NÃO teto da matriz). */
const TETO_AVISTA = 0.06;
/** Limite de plausibilidade da matriz (a matriz PODE passar de 6% -> diferido;
 *  o maior pct legítimo nos canônicos é 9,89%). Acima disso = leitura errada. */
const MAX_PLAUSIVEL = 0.15;
const MIN_COMPETENCIA = "2022-12";
const MAX_COMPETENCIA = "2030-12";

/** Falha de PARSE (PDF ilegível/inesperado/extração incompleta). */
export class TrpParseError extends Error {
  constructor(message: string, readonly detalhe?: string) {
    super(message);
    this.name = "TrpParseError";
  }
}
/** Falha de VALIDAÇÃO (extraiu, mas o conteúdo é absurdo -> lido errado). */
export class TrpValidationError extends Error {
  constructor(message: string, readonly detalhe?: string) {
    super(message);
    this.name = "TrpValidationError";
  }
}

// --- parsing best-effort de faixas de taxa/prazo a partir do token ------------
//
// SEPARADOR DECIMAL: a FORMA do percentual vem de PCT_NUM_SRC e a conversao de
// pctToDec (lib/trp/pctTrp.ts) — nenhum separador cravado a mao aqui. As tres
// regexes abaixo sao montadas da mesma fonte que o parseMatrix usa, entao "aceitar
// ponto" nao pode entrar por uma porta e faltar na outra.

// String.raw NAO e decoracao. Em template literal cru, `\s` avalia para "s" —
// as duas regexes viram `%s*as*%` e param de casar EM SILENCIO. Aconteceu na
// primeira versao deste conserto (02/09/2026): `celulas_taxa_prazo` virou
// `celulas_prazo` e o `tx_juros_min` sumiu das 5 TRPs antigas. O tsc ficou
// verde e o olho nao pegou; quem pegou foi a medicao de nao-regressao sobre os
// PDFs. O bloco 7 do trp_pct_separador_gate.cjs assere isto direto, para a
// regressao nao voltar calada — e e por isso que as duas sao EXPORTADAS.

/** "1,75% a 1,77%" / "1.75% a 1.77%" — a faixa fechada de taxa. */
export const TX_FAIXA_RE = new RegExp(String.raw`(${PCT_NUM_SRC})%\s*a\s*(${PCT_NUM_SRC})%`, "i");
/** "A partir de 2,48%" / "A partir de 2.48%" — a faixa aberta de taxa. */
export const TX_ABERTA_RE = new RegExp(String.raw`A partir de\s*(${PCT_NUM_SRC})%`, "i");
/** Mascara: apaga do token TODO percentual (qualquer separador) antes de ler
 *  prazo. Se ela nao enxergar a forma com ponto, o "1.90%" sobrevive e o
 *  `A partir de (\d+)` la embaixo le prazo_min = 1. */
const PCT_MASCARA_RE = new RegExp(`${PCT_NUM_SRC}%`, "g");

function parseTxRange(token: string): { tx_min: number; tx_max: number } | null {
  let m = token.match(TX_FAIXA_RE);
  if (m) return { tx_min: pctToDec(m[1]), tx_max: pctToDec(m[2]) };
  m = token.match(TX_ABERTA_RE);
  if (m) return { tx_min: pctToDec(m[1]), tx_max: 999 };
  return null;
}

function parsePrazoRange(token: string): { prazo_min: number; prazo_max: number } | null {
  // remove tokens de taxa (%) para não confundir números
  const t = token.replace(PCT_MASCARA_RE, " ");
  let m = t.match(/(\d+)\s*a\s*(\d+)/);
  if (m) return { prazo_min: Number(m[1]), prazo_max: Number(m[2]) };
  m = t.match(/Acima de\s*(\d+)/i);
  if (m) return { prazo_min: Number(m[1]) + 1, prazo_max: 999 };
  // 2a rede do separador: prazo e INTEIRO. Um numero seguido de ponto OU virgula
  // e decimal que escapou da mascara — nao e prazo. (O lookahead so olhava a
  // virgula; com o ponto aceito, "A partir de 1.90%" daria prazo_min = 1.)
  m = t.match(/A partir de\s*(\d+)(?!\s*[.,])/i);
  if (m) return { prazo_min: Number(m[1]), prazo_max: 999 };
  return null;
}

const FAIXA_LABELS = ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5"];

/** Piso de plausibilidade do tiquete: (0, 10.000]. Fora disso = leitura errada
 *  (ex.: FGTS "1 mil" lido como "1") -> OMITE, o motor cai na rede getMinimumTicket.
 *  Melhor AUSENTE que ERRADO: ausente cai no fallback correto; um "R$ 1" faria o
 *  gate sumir e o motor pagar FGTS que devia zerar (erro silencioso). */
const TIQUETE_MIN_PLAUSIVEL = 0;
const TIQUETE_MAX_PLAUSIVEL = 10000;

// --- estruturas de saída ------------------------------------------------------

export interface ConferirItem {
  produto: string;
  campo: string;
  valorLido: string | null;
  motivo: string;
  /** "conferir" (âmbar — pode afetar o cálculo, revise) | "informativo" (não
   *  afeta cálculo, opcional). Ausente = "conferir" (default; não mexe nos
   *  itens existentes). */
  severidade?: "conferir" | "informativo";
}

export interface TrpDraftMeta {
  competencia: string;
  regime: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  source_filename: string | null;
  sha256: string | null;
  parser_version: string;
  n_lines: number;
}

export interface TrpDraftResult {
  /** RegraMes DRAFT — pct provados + estrutura best-effort (conferir na revisão). */
  regraDraft: Record<string, unknown>;
  meta: TrpDraftMeta;
  confianca: {
    provado: { totalPct: number; produtos: Record<string, number[][]> };
    conferir: ConferirItem[];
  };
}

export interface BuildTrpDraftOptions {
  competencia: string; // "YYYY-MM"
  sourceFilename?: string | null;
  sha256?: string | null;
}

// --- validações ---------------------------------------------------------------

function validarCompetencia(competencia: unknown): void {
  if (typeof competencia !== "string" || !/^\d{4}-\d{2}$/.test(competencia)) {
    throw new TrpValidationError("competência inválida", `formato esperado YYYY-MM, recebido '${String(competencia)}'`);
  }
  const mes = Number(competencia.slice(5, 7));
  if (mes < 1 || mes > 12) {
    throw new TrpValidationError("mês inválido na competência", `'${competencia}' — mês deve ser 01..12`);
  }
  if (competencia < MIN_COMPETENCIA || competencia > MAX_COMPETENCIA) {
    throw new TrpValidationError("competência fora de faixa", `'${competencia}' fora de ${MIN_COMPETENCIA}..${MAX_COMPETENCIA}`);
  }
}

function validarProdutos(produtos: Record<string, ProdutoExtraido>): void {
  const faltando = EXPECTED_PRODUCTS.filter((k) => !produtos[k] || produtos[k].rows.length === 0);
  if (faltando.length > 0) {
    throw new TrpParseError(
      "o PDF parece ter sido lido errado: produtos ausentes/vazios",
      `sem matriz para: ${faltando.join(", ")} (achei ${Object.keys(produtos).length}/${EXPECTED_PRODUCTS.length})`,
    );
  }
  for (const k of EXPECTED_PRODUCTS) {
    const p = produtos[k];
    const ncols = p.kind === "faixa" ? 5 : 1;
    for (let i = 0; i < p.rows.length; i++) {
      if (p.rows[i].length !== ncols) {
        throw new TrpValidationError(
          "o PDF parece ter sido lido errado: faixas incompletas",
          `${k} linha ${i}: ${p.rows[i].length} valores (esperado ${ncols})`,
        );
      }
      for (const v of p.rows[i]) {
        if (!Number.isFinite(v) || v <= 0 || v > MAX_PLAUSIVEL) {
          throw new TrpValidationError(
            "o PDF parece ter sido lido errado: percentual implausível",
            `${k} linha ${i}: valor ${v} fora de (0, ${MAX_PLAUSIVEL}]`,
          );
        }
      }
    }
  }
}

// --- A1: herança semântica-GUARDADA de prazo (SÓ CONSIG_PRIVADO) --------------
// A célula de prazo mesclada "A partir de N" cobre um bloco de linhas, mas o texto
// cai só no centro (ord3), deixando topo/base (ord2/ord4) sem prazo. Herança: a
// linha SEM prazo cuja taxa é CONTÍGUA ao bloco de prazo ABERTO ("A partir de N")
// herda esse prazo. É PROPOSTA — só grava se passar nos 3 guards; senão o produto
// fica como hoje (prazo parcial + âmbar), NUNCA herança não-validada. Não há número
// quebrado (RAW ≡ FIXED p/ prazo≥18): é higiene (tirar o SQL manual mensal).

const PRAZO_ABERTO = 999;
/** Contíguo = adjacente em taxa (um passo ~0.0001), sem overlap. */
function txContiguo(prev: Record<string, unknown>, next: Record<string, unknown>): boolean {
  const gap = (next.tx_min as number) - (prev.tx_max as number);
  return gap > 0 && gap < 0.0002;
}
function temPrazoCell(c: Record<string, unknown>): boolean {
  return typeof c.prazo_min === "number";
}

export interface HerancaPrazoResult {
  ok: boolean;
  razao?: string;
}

/**
 * Resolve o prazo faltante do CONSIG_PRIVADO por herança semântica-GUARDADA.
 * Muta `cells` (preenche prazo nas herdeiras) SOMENTE se os 3 guards passarem;
 * caso contrário deixa `cells` intacto e devolve { ok:false, razao }.
 * Exportado para teste headless do guard sintético.
 */
export function resolverPrazoSemanticoConsigPrivado(
  cells: Record<string, unknown>[],
): HerancaPrazoResult {
  // Precisa de taxa em todas as células para raciocinar contiguidade.
  if (cells.some((c) => typeof c.tx_min !== "number" || typeof c.tx_max !== "number")) {
    return { ok: false, razao: "célula sem faixa de taxa — herança de prazo não aplicável" };
  }
  const abertas = cells.filter((c) => temPrazoCell(c) && c.prazo_max === PRAZO_ABERTO);
  if (abertas.length !== 1) {
    return { ok: false, razao: `esperava 1 bloco de prazo aberto ("A partir de N"), achei ${abertas.length}` };
  }
  const aberta = abertas[0];
  const pMin = aberta.prazo_min as number;
  const pMax = aberta.prazo_max as number;

  // Bloco aberto = célula aberta + células SEM prazo, contíguas em taxa. Exclui as
  // com prazo fechado próprio (ex.: ord1 "18-35", cuja taxa aberta sobrepõe o bloco).
  const elegiveis = cells.filter((c) => c === aberta || !temPrazoCell(c));
  const ordenadas = [...elegiveis].sort((a, b) => (a.tx_min as number) - (b.tx_min as number));
  const oi = ordenadas.indexOf(aberta);
  const bloco = new Set<Record<string, unknown>>([aberta]);
  for (let i = oi - 1; i >= 0; i--) {
    if (txContiguo(ordenadas[i], ordenadas[i + 1])) bloco.add(ordenadas[i]);
    else break;
  }
  for (let i = oi + 1; i < ordenadas.length; i++) {
    if (txContiguo(ordenadas[i - 1], ordenadas[i])) bloco.add(ordenadas[i]);
    else break;
  }

  // Proposta: células SEM prazo dentro do bloco herdam o prazo aberto.
  const proposta = new Map<Record<string, unknown>, { prazo_min: number; prazo_max: number }>();
  for (const c of cells) {
    if (!temPrazoCell(c) && bloco.has(c)) proposta.set(c, { prazo_min: pMin, prazo_max: pMax });
  }

  // GUARD (a) COBERTURA: toda célula fica com prazo (própria ou herdada).
  for (const c of cells) {
    if (!temPrazoCell(c) && !proposta.has(c)) {
      return { ok: false, razao: "prazo não resolvido em alguma célula (fora do bloco contíguo) — confira" };
    }
  }

  const prazoFinal = (c: Record<string, unknown>) =>
    temPrazoCell(c)
      ? { prazo_min: c.prazo_min as number, prazo_max: c.prazo_max as number }
      : (proposta.get(c) as { prazo_min: number; prazo_max: number });

  // GUARD (b) PARTIÇÃO DE TAXA: dentro de cada grupo de prazo, taxas contíguas (sem gap/overlap).
  const grupos = new Map<string, Record<string, unknown>[]>();
  for (const c of cells) {
    const pf = prazoFinal(c);
    const k = `${pf.prazo_min}-${pf.prazo_max}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(c);
  }
  for (const [k, grp] of grupos) {
    const s = [...grp].sort((a, b) => (a.tx_min as number) - (b.tx_min as number));
    for (let i = 1; i < s.length; i++) {
      if (!txContiguo(s[i - 1], s[i])) {
        return { ok: false, razao: `faixas de taxa não particionam dentro da célula de prazo ${k} — herança rejeitada` };
      }
    }
  }

  // GUARD (c) CROSS-CHECK COM O TEXTO: o herdado == prazo (texto) da célula aberta;
  // células com prazo do texto NÃO entram na proposta (ficam byte-idênticas).
  for (const [, pr] of proposta) {
    if (pr.prazo_min !== pMin || pr.prazo_max !== pMax) {
      return { ok: false, razao: `herança diverge do texto (herdado=${pr.prazo_min}-${pr.prazo_max}, texto=${pMin}-${pMax})` };
    }
  }

  // Todos os guards passaram → aplica a herança (só nas células propostas).
  for (const [c, pr] of proposta) {
    c.prazo_min = pr.prazo_min;
    c.prazo_max = pr.prazo_max;
  }
  return { ok: true };
}

// --- montagem do draft --------------------------------------------------------

function montarProdutoDraft(key: string, p: ProdutoExtraido, conferir: ConferirItem[]): Record<string, unknown> {
  const cells: Record<string, unknown>[] = [];
  let temTx = false, temPrazo = false;
  for (let i = 0; i < p.rows.length; i++) {
    const token = p.tokens[i] ?? "";
    const tx = parseTxRange(token);
    const prazo = parsePrazoRange(token);
    if (tx) temTx = true;
    if (prazo) temPrazo = true;
    const cell: Record<string, unknown> = {};
    if (tx) { cell.tx_min = tx.tx_min; cell.tx_max = tx.tx_max; }
    if (prazo) { cell.prazo_min = prazo.prazo_min; cell.prazo_max = prazo.prazo_max; }
    if (p.kind === "faixa") {
      p.rows[i].forEach((v, fi) => { cell[FAIXA_LABELS[fi]] = v; });
    } else {
      cell.pct_geral = p.rows[i][0];
    }
    cells.push(cell);
  }
  // tipo de array inferido (best-effort — conferir)
  const cellType = temTx && temPrazo ? "celulas_taxa_prazo" : temTx ? "celulas_taxa" : "celulas_prazo";
  conferir.push({
    produto: key,
    campo: "estrutura de célula",
    valorLido: cellType,
    motivo: `tipo/faixas de tx/prazo inferidos dos tokens (${JSON.stringify(p.tokens)}); confira contra o PDF`,
  });
  if (key === "CONSIG_PRIVADO") {
    // A1: tenta resolver o prazo faltante (célula mesclada) por herança guardada.
    // Só grava se passar nos 3 guards; senão volta ao comportamento de hoje (âmbar).
    const h = resolverPrazoSemanticoConsigPrivado(cells);
    if (!h.ok) {
      conferir.push({
        produto: key,
        campo: "prazo por célula",
        valorLido: null,
        motivo: `herança de prazo NÃO validada (${h.razao}); prazo parcial — confira célula a célula no PDF`,
      });
    }
    // h.ok => prazo resolvido e validado; não empurra âmbar (fica silencioso/resolvido).
  }
  return { [cellType]: cells };
}

/**
 * Monta os escalares de categoria (tiquete_min, custo_processamento) que o
 * parseEscalares leu do PDF. Regra de ouro: NUNCA "provado" — o tiquete nasce
 * "conferir" (âmbar) e, se ausente/implausível, é OMITIDO para o motor cair na
 * rede (getMinimumTicket). custo_processamento é informativo (não entra no cálculo).
 */
function montarEscalaresDraft(
  key: string,
  esc: EscalaresCategoria | undefined,
  conferir: ConferirItem[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const tiq = esc?.tiquete_min;
  if (
    typeof tiq === "number" &&
    Number.isFinite(tiq) &&
    tiq > TIQUETE_MIN_PLAUSIVEL &&
    tiq <= TIQUETE_MAX_PLAUSIVEL
  ) {
    out.tiquete_min = tiq;
    conferir.push({
      produto: key,
      campo: "tiquete_min",
      valorLido: `R$ ${tiq}`,
      motivo: "lido da linha 'Tíquete:' do PDF; confira contra a tabela vigente antes de gravar",
      severidade: "conferir",
    });
  } else {
    // ausente ou implausível -> OMITE. Melhor ausente que errado: o motor usa a rede.
    conferir.push({
      produto: key,
      campo: "tiquete_min",
      valorLido: tiq != null ? String(tiq) : null,
      motivo:
        "tíquete mínimo não capturado com confiança; OMITIDO — o motor usa a rede (getMinimumTicket) até a revisão preencher",
      severidade: "conferir",
    });
  }

  const custo = esc?.custo_processamento;
  if (typeof custo === "string" && custo.trim()) {
    out.custo_processamento = custo.trim();
    conferir.push({
      produto: key,
      campo: "custo_processamento",
      valorLido: custo.trim(),
      motivo: "lido cru do PDF; normalize (número ou texto) na revisão — não entra no cálculo",
      severidade: "informativo",
    });
  }

  return out;
}

/**
 * Deriva o tx_juros_min de CATEGORIA das células — NÃO captura (o parseTxRange já
 * lê o piso da matriz "A partir de X%" como tx_min de célula). O tx_juros_min de
 * CATEGORIA é o piso da categoria INTEIRA, checado ANTES do lookup de célula
 * (motor gate B + lookupPctInRegra, TODAS as categorias desde a Fase 4.4).
 *
 * Coincide com o tx_min de célula quando há 1 célula (ADIANTAMENTO_13) ou quando
 * todas carregam o mesmo tx_min; DIVERGE quando alguma célula NÃO tem tx_min
 * (INSS_RENOV: só a 61-84 declara "A partir de 1,00%") — é por esse caso multi-célula
 * que derivamos: sem o piso de categoria, as células 48-60 e 85-999 ficariam sem piso.
 *
 * REGRA (isola FLOOR de PARTIÇÃO): deriva só quando há UM tx_min distinto E
 * (célula única OU alguma célula sem tx_min). Uma PARTIÇÃO de taxa (CONSIG_PUBLICO,
 * SIAPE: vários tx bands distintos) NÃO é floor -> omite. Quando todas as células
 * carregam o MESMO tx (CONSIG_PRIVADO, PORTAB), o curador modelou no nível da célula
 * -> omite (as células já enforçam idêntico). Reproduz 11/11 os JSONs curados de
 * abr/jun; NÃO inventa o campo nas 9 categorias que nunca o tiveram.
 */
function derivarTxJurosMin(cells: Record<string, unknown>[]): number | undefined {
  return derivarPisoDeCelulas(cells, "tx_min");
}

/**
 * Discriminador FLOOR × PARTIÇÃO genérico (o mesmo do tx_juros_min, agora reusado
 * pelo prazo_min — NÃO duplicado). Deriva o PISO ÚNICO da categoria a partir de um
 * campo de célula (`tx_min` ou `prazo_min`): só quando há UM valor distinto E
 * (célula única OU alguma célula sem o campo). Uma PARTIÇÃO (vários valores
 * distintos: INSS_NOVO por prazo, CONSIG_PUBLICO por taxa) NÃO é floor → undefined.
 * Quando todas as células carregam o MESMO valor, o curador modelou no nível da
 * célula → undefined (as células já enforçam). NÃO inventa (0 células com o campo →
 * undefined).
 */
function derivarPisoDeCelulas(
  cells: Record<string, unknown>[],
  campo: "tx_min" | "prazo_min",
): number | undefined {
  const vals = cells
    .map((c) => c[campo])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) return undefined;
  const distintos = [...new Set(vals)];
  const algumaSem = cells.some((c) => typeof c[campo] !== "number");
  if (distintos.length === 1 && (cells.length === 1 || algumaSem)) {
    return distintos[0];
  }
  return undefined;
}

/** Converte a recusa do sítio do percentual (TrpPctError) no erro de validação
 *  que a rota já sabe renderizar (422). Não engole nada: só troca o rótulo. */
function comoErroDeRegua<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof TrpPctError) {
      throw new TrpValidationError(
        `o PDF traz um percentual que não posso ler com segurança: ${e.message}`,
        e.detalhe,
      );
    }
    throw e;
  }
}

/**
 * Monta o draft + valida. Lança TrpParseError / TrpValidationError em falha
 * (a rota converte em resposta de erro visível). NÃO grava, NÃO lê banco.
 */
export async function buildTrpDraft(pdfBytes: Uint8Array, opts: BuildTrpDraftOptions): Promise<TrpDraftResult> {
  validarCompetencia(opts.competencia); // valida o RAW (formato/mês/faixa) antes de normalizar

  let lines: string[];
  try {
    lines = await extractLinesFromPdf(pdfBytes);
  } catch (e) {
    throw new TrpParseError("não consegui ler o PDF", e instanceof Error ? e.message : String(e));
  }
  if (lines.length === 0) {
    throw new TrpParseError("PDF sem texto extraível", "extração vazia (PDF escaneado/imagem?)");
  }
  return buildTrpDraftFromLines(lines, opts);
}

/**
 * O MESMO montador, a partir das LINHAS já extraídas. Existe separado por um
 * motivo só: o portão do separador decimal precisa de fixture SINTÉTICA (os PDFs
 * da TRP não estão no repo — ele é público), e uma fixture de LINHAS exercita o
 * caminho inteiro (matriz + taxa + prazo + escalares + validações) em vez de só
 * a regex da matriz. buildTrpDraft = extrair + delegar; nada de lógica
 * duplicada nem de ramo "de teste".
 */
export function buildTrpDraftFromLines(lines: string[], opts: BuildTrpDraftOptions): TrpDraftResult {
  validarCompetencia(opts.competencia);
  const competencia = competenciaKey(opts.competencia);

  // Um percentual ilegivel (forma ambigua de milhar, ou leitura >= 100) LANCA
  // TrpPctError no sitio. Aqui ele vira TrpValidationError — o mesmo canal do
  // resto: 422 com erro VISIVEL, nada de meia-regra e nada de valor adivinhado.
  const produtos = comoErroDeRegua(() => parseMatrix(lines));
  validarProdutos(produtos);
  const escalares = comoErroDeRegua(() => parseEscalares(lines));
  // prazo_min de categoria que vem numa LINHA ISOLADA (PORTAB/NAO_CONSIGNADO), que o
  // parseMatrix pula — o derivador não alcança (célula sem prazo). Capturado à parte.
  const prazoCategoriaCapturado = comoErroDeRegua(() => parsePrazoCategoria(lines));

  const vig = vigenciaDaCompetencia(competencia);
  const conferir: ConferirItem[] = [];

  const regraDraft: Record<string, unknown> = {
    _meta: {
      competencia,
      regime: "VOLUME_5_FAIXAS",
      vigencia_inicio: vig.validFrom,
      vigencia_fim: vig.validUntil,
      categorias: [...FAIXA_LABELS],
    },
  };
  const provadoProdutos: Record<string, number[][]> = {};
  let totalPct = 0;
  for (const k of EXPECTED_PRODUCTS) {
    const produtoDraft = comoErroDeRegua(() => montarProdutoDraft(k, produtos[k], conferir));
    // RESTAURADO em 29/08/2026. As duas linhas abaixo saíram por colateral em
    // `7ad20fc` (17/07/2026, tx_juros_min derivado) e nunca voltaram: `totalPct`
    // ficava declarado e NUNCA escrito, e `confianca.provado` viajava {0, {}} até
    // a tela de revisão do sócio — que passou a dizer "0 provados" com 195
    // provados. Não corrompe régua nem gravação (o commit não lê `confianca`),
    // mas subnotificou a confiança de todo upload de TRP por 43 dias. Quem pegou
    // foi `scripts/trp_parse_route_test.cjs`, órfão do runner — ninguém o roda.
    if (produtos[k]) {
      provadoProdutos[k] = produtos[k].rows;
      totalPct += produtos[k].rows.flat().length;
    }
    // tx_juros_min de CATEGORIA: DERIVADO das células (não capturado). Reproduz o
    // piso que o curado punha à mão; cobre o gate B do ADIANTAMENTO_13 e o buraco
    // multi-célula do INSS_RENOV. Só nas categorias-floor; as 9 de partição ficam sem.
    const cellsArr = (Object.values(produtoDraft).find(Array.isArray) as
      | Record<string, unknown>[]
      | undefined) ?? [];
    const txJurosMin = derivarTxJurosMin(cellsArr);
    // prazo_min de CATEGORIA: DERIVADO das células (piso único) quando o prazo vem
    // INLINE na matriz (CONSIG_PUBLICO/SIAPE/…); senão CAPTURADO da linha isolada
    // "A partir de N" (PORTAB/NAO_CONSIGNADO). É PISO DE ELEGIBILIDADE (TRP pág.3:
    // "é imprescindível que … prazo … estejam previstos"); prazo < piso = FORA_DA_TABELA.
    const prazoMinDerivado = derivarPisoDeCelulas(cellsArr, "prazo_min");
    const prazoMin = prazoMinDerivado ?? prazoCategoriaCapturado[k];
    const prazoMinCapturado = prazoMinDerivado === undefined && prazoMin !== undefined;
    const algumaCelComPrazo = cellsArr.some((c) => typeof c.prazo_min === "number");
    // escalares primeiro (tiquete_min/custo/tx_juros_min/prazo_min) + a matriz — ordem do curado.
    regraDraft[k] = {
      ...montarEscalaresDraft(k, escalares[k], conferir),
      ...(txJurosMin !== undefined ? { tx_juros_min: txJurosMin } : {}),
      ...(prazoMin !== undefined ? { prazo_min: prazoMin } : {}),
      ...produtoDraft,
    };
    if (txJurosMin !== undefined) {
      conferir.push({
        produto: k,
        campo: "tx_juros_min",
        valorLido: String(txJurosMin),
        motivo:
          "DERIVADO das células (menor tx_min, piso único da categoria) — o PDF declara 'A partir de X%' na matriz; confira contra o PDF",
        severidade: "conferir",
      });
    }
    if (prazoMin !== undefined) {
      conferir.push({
        produto: k,
        campo: "prazo_min",
        valorLido: String(prazoMin),
        motivo: prazoMinCapturado
          ? "CAPTURADO da linha isolada 'A partir de N' da seção (piso de elegibilidade); confira contra o PDF"
          : "DERIVADO das células (piso único de prazo); confira contra o PDF",
        severidade: "conferir",
      });
    } else if (!algumaCelComPrazo && cellsArr.length > 0) {
      // PERIGO: sem piso de categoria E sem prazo em NENHUMA célula -> qualquer prazo
      // casa -> contratos ABAIXO DO PISO seriam PAGOS. Omitir aqui NÃO é seguro (ao
      // contrário do tíquete, que tinha o hardcode como rede). Alarme explícito.
      conferir.push({
        produto: k,
        campo: "prazo_min",
        valorLido: null,
        motivo:
          "ALERTA: prazo_min de categoria AUSENTE e NENHUMA célula tem prazo — contratos ABAIXO DO PISO serão PAGOS (deveriam zerar). Reveja o PDF/parser ANTES de gravar.",
        severidade: "conferir",
      });
    }
  }

  // itens estruturais que o parser não prova (conferir na revisão)
  // _meta NÃO CONSUMIDO por cálculo (faixa vem de BAND_THRESHOLDS/FAIXA_GRUPO_RR
  // fixos no motor; observacoes sem match de cálculo) → severidade informativa,
  // não âmbar. É só rótulo: o parser e o cálculo seguem iguais.
  conferir.push({ produto: "_meta", campo: "observacoes", valorLido: null, motivo: "não extraídas do PDF; adicione na revisão se desejado", severidade: "informativo" });
  conferir.push({ produto: "_meta", campo: "limites_categoria (prod_min/teto)", valorLido: null, motivo: "confira a tabela 'Perfil de Produção' do PDF", severidade: "informativo" });

  return {
    regraDraft,
    meta: {
      competencia,
      regime: "VOLUME_5_FAIXAS",
      vigencia_inicio: vig.validFrom,
      vigencia_fim: vig.validUntil,
      source_filename: opts.sourceFilename ?? null,
      sha256: opts.sha256 ?? null,
      parser_version: PARSER_VERSION,
      n_lines: lines.length,
    },
    confianca: {
      provado: { totalPct, produtos: provadoProdutos },
      conferir,
    },
  };
}

// evita "unused" do import parseConvenios/parseSec5 caso não usados aqui; a rota/
// sub-fases podem consumi-los. Mantidos disponíveis via re-export.
// validarCompetencia exportado para reuso no commit (F6b.3, defesa em profundidade).
export { parseConvenios, parseSec5, TETO_AVISTA, MAX_PLAUSIVEL, validarCompetencia };
