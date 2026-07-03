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
  type ProdutoExtraido,
} from "@/lib/trp/parseTrpPdf";
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

function pctToDec(tok: string): number {
  return Number((parseFloat(tok.replace(",", ".")) / 100).toFixed(6));
}

// --- parsing best-effort de faixas de taxa/prazo a partir do token ------------

function parseTxRange(token: string): { tx_min: number; tx_max: number } | null {
  let m = token.match(/(\d+,\d+)%\s*a\s*(\d+,\d+)%/i);
  if (m) return { tx_min: pctToDec(m[1]), tx_max: pctToDec(m[2]) };
  m = token.match(/A partir de\s*(\d+,\d+)%/i);
  if (m) return { tx_min: pctToDec(m[1]), tx_max: 999 };
  return null;
}

function parsePrazoRange(token: string): { prazo_min: number; prazo_max: number } | null {
  // remove tokens de taxa (%) para não confundir números
  const t = token.replace(/\d+,\d+%/g, " ");
  let m = t.match(/(\d+)\s*a\s*(\d+)/);
  if (m) return { prazo_min: Number(m[1]), prazo_max: Number(m[2]) };
  m = t.match(/Acima de\s*(\d+)/i);
  if (m) return { prazo_min: Number(m[1]) + 1, prazo_max: 999 };
  m = t.match(/A partir de\s*(\d+)(?!\s*,)/i);
  if (m) return { prazo_min: Number(m[1]), prazo_max: 999 };
  return null;
}

const FAIXA_LABELS = ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5"];

// --- estruturas de saída ------------------------------------------------------

export interface ConferirItem {
  produto: string;
  campo: string;
  valorLido: string | null;
  motivo: string;
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
    conferir.push({
      produto: key,
      campo: "prazo por célula",
      valorLido: null,
      motivo: "a Promotiva popula o prazo por célula à mão (observação do TRP); confira célula a célula no PDF",
    });
  }
  return { [cellType]: cells };
}

/**
 * Monta o draft + valida. Lança TrpParseError / TrpValidationError em falha
 * (a rota converte em resposta de erro visível). NÃO grava, NÃO lê banco.
 */
export async function buildTrpDraft(pdfBytes: Uint8Array, opts: BuildTrpDraftOptions): Promise<TrpDraftResult> {
  validarCompetencia(opts.competencia); // valida o RAW (formato/mês/faixa) antes de normalizar
  const competencia = competenciaKey(opts.competencia);

  let lines: string[];
  try {
    lines = await extractLinesFromPdf(pdfBytes);
  } catch (e) {
    throw new TrpParseError("não consegui ler o PDF", e instanceof Error ? e.message : String(e));
  }
  if (lines.length === 0) {
    throw new TrpParseError("PDF sem texto extraível", "extração vazia (PDF escaneado/imagem?)");
  }

  const produtos = parseMatrix(lines);
  validarProdutos(produtos);

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
    regraDraft[k] = montarProdutoDraft(k, produtos[k], conferir);
    provadoProdutos[k] = produtos[k].rows;
    totalPct += produtos[k].rows.flat().length;
  }

  // itens estruturais que o parser não prova (conferir na revisão)
  conferir.push({ produto: "_meta", campo: "observacoes", valorLido: null, motivo: "não extraídas do PDF; adicione na revisão se desejado" });
  conferir.push({ produto: "_meta", campo: "limites_categoria (prod_min/teto)", valorLido: null, motivo: "confira a tabela 'Perfil de Produção' do PDF" });

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
