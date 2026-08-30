// ============================================================================
// Auditoria ADS/BBTS — 1A: parser da TABELA DE PAGAMENTO da BBTS (PDF -> RegraBbts).
//
// REUSO: a extração de texto por coordenada (extractLinesFromPdf) vem INTACTA do
// parser da TRP (lib/trp/parseTrpPdf.ts) — ela é agnóstica de documento (agrupa
// itens por y, ordena por x, reconstrói a linha). O que muda aqui é o vocabulário:
// âncoras nos rótulos dos grupos da BBTS e uma gramática de célula própria.
//
// TÉCNICA (mesma da TRP): âncora-em-rótulo + "as N ÚLTIMAS % da linha são as
// faixas". Isso é o que blinda contra os percentuais que aparecem no MEIO da linha
// (a faixa de juros: "1,72% a 1,79% ... 1,12% 1,20% ..."). O resto da linha (o que
// sobra depois de tirar as N últimas %) é o insumo de tx/prazo/tíquete.
//
// PARTICULARIDADES DA BBTS que a TRP não tem:
//   - BONIFICADO: a célula tem DOIS números e o PDF os quebra em 3 linhas:
//         "0,63% 0,67% 0,72% 0,76% 0,81%"        <- base (5 faixas, sem texto)
//         "1,70% a 1,77% A partir de 36"          <- a faixa de juros/prazo
//         "+0,35% +0,37% +0,40% +0,42% +0,45%"    <- o adicional (5 faixas)
//     O montador trata isso como uma máquina de estados (base -> tx -> adicional).
//   - REDUZIDOS: a faixa de juros e as 5 faixas vêm na MESMA linha e o "A partir de
//     36" cai na linha SEGUINTE (sem %). Tratado como "prazo órfão" da última célula.
//   - INSS: a coluna de juros é uma célula MESCLADA no PDF — o "1,85%" pousa só na
//     linha do meio. Herdado para as demais linhas do grupo (marcado em "conferir").
//   - BB ENERGIA: coluna ÚNICA (não varia por faixa) e "2,35 %" com espaço antes do %.
//
// Este módulo só EXTRAI (cru). O gate de sanidade e a montagem do RegraBbts estão
// em buildBbtsDraft.ts. Nada aqui escreve no banco.
// ============================================================================

import { extractLinesFromPdf } from "@/lib/trp/parseTrpPdf";
import { casaRotuloFragmentado } from "@/lib/bbts/normalizarTextoPdf";
import {
  BbtsParseError,
  FAIXA_LABELS,
  FAIXA_UNICA,
  GRUPOS_FAIXA_UNICA,
  type CelulaBbts,
  type FaixaEnquadramento,
  type PctCelulaBbts,
  type SeguroBbts,
} from "@/lib/bbts/regraBbts";

export { extractLinesFromPdf };

function deacc(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Aceita "2,44%", "2,175%", "6 %" (espaço) e "+0,35%". */
const PCT_RE = /(\+?)(\d+(?:,\d+)?)\s*%/g;

/** "2,44" -> 0.0244 (6 casas, igual ao parser da TRP). */
function pctToDec(tok: string): number {
  return Number((parseFloat(tok.replace(",", ".")) / 100).toFixed(6));
}

interface PctHit {
  /** valor em decimal */
  dec: number;
  /** true quando o token vinha com "+" (adicional/bonificação) */
  plus: boolean;
  start: number;
  end: number;
}

function pctsIn(line: string): PctHit[] {
  const out: PctHit[] = [];
  PCT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PCT_RE.exec(line)) !== null) {
    out.push({
      dec: pctToDec(m[2]),
      plus: m[1] === "+",
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** Remove do texto os N últimos percentuais (por índice — não por replace cego). */
function stripHits(line: string, hits: PctHit[]): string {
  let out = "";
  let cursor = 0;
  for (const h of hits) {
    out += line.slice(cursor, h.start);
    cursor = h.end;
  }
  out += line.slice(cursor);
  return out.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Âncoras dos grupos (linha deaccentuada). O "$" onde existe é ESSENCIAL: sem ele,
// o cabeçalho da LISTA DE CONVÊNIOS ("Demais Convenios Publicos - ... e Gov. MG,
// Gov e Pref. Sao Paulo -") casaria como se fosse a matriz de Demais Públicos.
// ---------------------------------------------------------------------------
const GROUP_ANCHORS: [RegExp, string][] = [
  [/^INSS-\s*Credito Consignado Novo$/i, "INSS_NOVO"],
  [/^INSS-\s*Credito Consignado Renovacao$/i, "INSS_RENOV"],
  [/^SIAPE-\s*Credito Consignado Novo e Renovacao$/i, "SIAPE"],
  [/^Grupamento Gov\. MG.*\(Reduzidos\)\*?$/i, "GRUPAMENTO_MG_SP_REDUZIDOS"],
  [/^Grupamento Gov\. MG.*Renovacao$/i, "GRUPAMENTO_MG_SP"],
  [/^Demais Convenios Publicos.*\(Bonificado\)\*?$/i, "PUBLICO_DEMAIS_BONIFICADO"],
  [/^Demais Convenios Publicos.*\(Reduzidos\)\*?$/i, "PUBLICO_DEMAIS_REDUZIDOS"],
  [/^Demais Convenios Publicos - Credito Consignado Novo e Renovacao$/i, "PUBLICO_DEMAIS"],
  [/^Convenios Privados - Credito Consignado Novo e Renovacao$/i, "PRIVADO"],
  [/^Convenios Privados - Consignado Portabilidade Compra/i, "PORTAB_PRIVADO"],
  [/^Convenios Publicos - Consignado Portabilidade Compra/i, "PORTAB_PUBLICO"],
  [/^Nao Consignado - Automatico, Salario e Beneficio/i, "NAO_CONSIGNADO"],
  [/^Nao Consignado - 13. Salario/i, "NAO_CONSIGNADO_13"],
  [/^Nao Consignado - CDC FGTS/i, "CDC_FGTS"],
  [/^Financiamento . BB Energia Renovavel/i, "BB_ENERGIA"],
];

/** Rodapé/cabeçalho de página: PULA (não encerra o grupo — grupos cruzam páginas). */
const SKIP =
  /^(#interna|www\.bbts|Brasilia\/DF|Taxas? de Juros|Valor\b|Minimo|Prazo \(meses\)|Prazo Faixa|Parcelas Faixa|\(R\$\)|\(a\.m\.\)|Faixa 1 Faixa 2)/i;

/** Encerra o grupo corrente (fim da matriz). */
const STOP =
  /^(Informacoes [Aa]dicionais|Novidades:|Obs\.:|Faixas de enquadramento|SEGURO PRESTAMISTA|Conta Corrente|Portabilidade de|Demais Convenios Publicos - Credito Consignado Novo e Renovacao e Gov|•|Recebimento a vista)/i;

/** Uma célula crua, ainda sem validação. */
export interface CelulaCrua extends CelulaBbts {
  /** avisos de leitura desta célula (herança de juros, tx órfã etc.). */
  _conferir?: string[];
}

export interface GrupoCru {
  titulo: string;
  celulas: CelulaCrua[];
}

export interface MatrizCrua {
  grupos: Record<string, GrupoCru>;
  /** códigos de convênio listados no PDF (só as EXCEÇÕES) -> grupo. */
  convenios: Record<string, { grupo: string; nome: string }>;
  faixasEnquadramento: FaixaEnquadramento[];
  avtTeto: number | null;
  prtRegra: string | null;
  seguro: SeguroBbts | null;
  vigenciaPdf: string | null;
}

// ---------------------------------------------------------------------------
// Gramática de tx / prazo / tíquete a partir do texto que sobrou da linha.
// ---------------------------------------------------------------------------

/** "1,72% a 1,79%" | "A partir de 2,50%" | "1,85%" -> {tx_min, tx_max}. */
function parseTx(resto: string): { tx_min: number | null; tx_max: number | null } | null {
  const hits = pctsIn(resto);
  if (hits.length === 0) return null;
  if (hits.length >= 2) return { tx_min: hits[0].dec, tx_max: hits[1].dec };
  // um só: "A partir de X" / "X%" (piso) — teto aberto.
  return { tx_min: hits[0].dec, tx_max: null };
}

/** "48 a 60" | "A partir de 36" | "Acima de 84" | "36 a 84" -> {prazo_min, prazo_max}. */
function parsePrazo(resto: string): { prazo_min: number | null; prazo_max: number | null } | null {
  const t = deacc(resto).toLowerCase();
  let m = t.match(/(\d+)\s*a\s*(\d+)/);
  if (m) return { prazo_min: Number(m[1]), prazo_max: Number(m[2]) };
  m = t.match(/acima de\s*(\d+)/);
  if (m) return { prazo_min: Number(m[1]) + 1, prazo_max: null };
  m = t.match(/a partir de\s*(\d+)/);
  if (m) return { prazo_min: Number(m[1]), prazo_max: null };
  return null;
}

/** ">= 2,5 mil" / ">= 1,0 mil" / "> = R$ 2 mil" -> valor em reais. */
function parseValorMin(resto: string): number | null {
  const t = deacc(resto).toLowerCase().replace(/r\$/g, "");
  const m = t.match(/>\s*=?\s*([\d.,]+)\s*mil/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
}

// ---------------------------------------------------------------------------
// Montagem das células de UM grupo (máquina de estados: base -> tx -> adicional)
// ---------------------------------------------------------------------------
function montarCelulas(key: string, linhas: string[]): CelulaCrua[] {
  const unica = GRUPOS_FAIXA_UNICA.includes(key);
  const ncols = unica ? 1 : FAIXA_LABELS.length;
  const labels: readonly string[] = unica ? [FAIXA_UNICA] : FAIXA_LABELS;

  const celulas: CelulaCrua[] = [];
  const soltos: string[] = []; // fragmentos sem % (tx quebrada, tíquete, "A partir de")

  for (const raw of linhas) {
    const hits = pctsIn(raw);

    // (a) linha do ADICIONAL: todos os N últimos vêm com "+".
    if (hits.length >= ncols && hits.slice(-ncols).every((h) => h.plus)) {
      const alvo = celulas[celulas.length - 1];
      if (!alvo) {
        throw new BbtsParseError(
          `${key}: linha de bonificação sem célula base à frente`,
          raw,
        );
      }
      const add = hits.slice(-ncols);
      labels.forEach((lab, i) => {
        const cel = alvo.faixas[lab];
        if (cel) cel.adicional = add[i].dec;
      });
      continue;
    }

    // (b) linha de CÉLULA: tem pelo menos as N faixas. As N ÚLTIMAS são as faixas.
    if (hits.length >= ncols) {
      const faixaHits = hits.slice(-ncols);
      const resto = stripHits(raw, faixaHits);
      const faixas: Record<string, PctCelulaBbts> = {};
      labels.forEach((lab, i) => {
        faixas[lab] = { base: faixaHits[i].dec };
      });

      const cel: CelulaCrua = { faixas, _origem: raw.trim() };
      const tx = parseTx(resto);
      if (tx) {
        cel.tx_min = tx.tx_min;
        cel.tx_max = tx.tx_max;
      }
      // prazo/tíquete: do texto SEM os percentuais da faixa de juros.
      const restoSemPct = stripHits(resto, pctsIn(resto));
      const prazo = parsePrazo(restoSemPct);
      if (prazo) {
        cel.prazo_min = prazo.prazo_min;
        cel.prazo_max = prazo.prazo_max;
      }
      const vmin = parseValorMin(resto);
      if (vmin !== null) cel.valor_min = vmin;

      celulas.push(cel);
      continue;
    }

    // (c) linha SEM as N faixas: fragmento. Pode ser o prazo órfão do layout
    //     "Reduzidos" ("A partir de 36" sozinho), a faixa de juros do BONIFICADO
    //     (que vem ENTRE a base e o adicional), ou tíquete/tx quebrada.
    const alvo = celulas[celulas.length - 1];
    const restoSemPct = stripHits(raw, hits);
    if (alvo) {
      const tx = parseTx(raw);
      if (tx && alvo.tx_min == null) {
        alvo.tx_min = tx.tx_min;
        alvo.tx_max = tx.tx_max;
      }
      const prazo = parsePrazo(restoSemPct);
      if (prazo && alvo.prazo_min == null) {
        alvo.prazo_min = prazo.prazo_min;
        alvo.prazo_max = prazo.prazo_max;
      }
      const vmin = parseValorMin(raw);
      if (vmin !== null && alvo.valor_min == null) alvo.valor_min = vmin;
      if (!tx && !prazo && vmin === null && raw.trim()) soltos.push(raw.trim());
    } else if (raw.trim()) {
      soltos.push(raw.trim());
    }
  }

  // (d) HERANÇA da faixa de juros dentro do grupo (INSS: célula mesclada no PDF —
  //     o "1,85%" pousa só na linha do meio). Se o grupo tem UMA única tx e há
  //     linhas sem tx, a tx do grupo vale para todas — mas fica marcado "conferir".
  const comTx = celulas.filter((c) => c.tx_min != null);
  const semTx = celulas.filter((c) => c.tx_min == null);
  if (semTx.length > 0 && comTx.length === 1) {
    for (const c of semTx) {
      c.tx_min = comTx[0].tx_min;
      c.tx_max = comTx[0].tx_max;
      c._conferir = [
        ...(c._conferir ?? []),
        "faixa de juros herdada do grupo (no PDF a coluna de juros e uma celula mesclada)",
      ];
    }
  } else if (semTx.length > 0) {
    for (const c of semTx) {
      c._conferir = [...(c._conferir ?? []), "faixa de juros NAO lida (quebrada no PDF) — conferir"];
    }
  }

  // (e) tíquete do grupo: quando o PDF põe ">=2,5 mil" numa linha solta, ele vale
  //     para o grupo inteiro (Portabilidade). Propaga e marca.
  const comValor = celulas.find((c) => c.valor_min != null);
  if (comValor) {
    for (const c of celulas) {
      if (c.valor_min == null) {
        c.valor_min = comValor.valor_min;
        c._conferir = [...(c._conferir ?? []), "tiquete minimo herdado do grupo"];
      }
    }
  }

  if (soltos.length > 0) {
    const alvo = celulas[celulas.length - 1];
    if (alvo) {
      alvo._conferir = [
        ...(alvo._conferir ?? []),
        `fragmentos nao aproveitados no grupo: ${soltos.join(" | ")}`,
      ];
    }
  }

  return celulas;
}

// ---------------------------------------------------------------------------
// Seções auxiliares: convênios (exceções), faixas de enquadramento, AVT/PRT, seguro
// ---------------------------------------------------------------------------

/** "• 140.274 TJSC TRIBUNAL DE JUSTICA..." -> { codigo: "140274", nome: "TJSC ..." } */
const BULLET_RE = /^[•\-•]\s*([\d.]+)\s+(.*)$/;

function parseConveniosBbts(lines: string[]): Record<string, { grupo: string; nome: string }> {
  const out: Record<string, { grupo: string; nome: string }> = {};
  let grupoAtual: string | null = null;
  for (const raw of lines) {
    const ln = deacc(raw).trim();
    // cabeçalhos das LISTAS de exceção (não são matrizes — são listas de convênios).
    if (/\(Bonificado\)/i.test(ln) && /Demais Convenios Publicos/i.test(ln) && /^Novidades:/i.test(ln)) {
      grupoAtual = "PUBLICO_DEMAIS_BONIFICADO";
      continue;
    }
    if (/^Demais Convenios Publicos.*Gov\. MG.*$/i.test(ln) || /ou nao estrategicos no periodo/i.test(ln)) {
      grupoAtual = "PUBLICO_DEMAIS_REDUZIDOS";
      continue;
    }
    const m = ln.match(BULLET_RE);
    if (m && grupoAtual) {
      const codigo = m[1].replace(/\./g, "");
      if (!out[codigo]) out[codigo] = { grupo: grupoAtual, nome: m[2].trim() };
    }
  }
  return out;
}

/** Pág. 8: "Faixa 1 Producao ate R$ 1 milhao" ... "Faixa 5 Producao acima de R$ 5 milhoes". */
function parseFaixasEnquadramento(lines: string[]): FaixaEnquadramento[] {
  const out: FaixaEnquadramento[] = [];
  const num = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", ".").trim());
  for (const raw of lines) {
    const ln = deacc(raw).trim();
    const m = ln.match(/^Faixa (\d)\s+Producao\s+(.*)$/i);
    if (!m) continue;
    const faixa = `Faixa ${m[1]}`;
    const desc = m[2].toLowerCase();
    let prodMin = 0;
    let prodMax: number | null = null;
    const ate = desc.match(/ate r\$\s*([\d.,]+)\s*(milhao|milhoes|mil)?/);
    const intervalo = desc.match(/r\$\s*([\d.,]+)\s*ate r\$\s*([\d.,]+)\s*(milhao|milhoes|mil)?/);
    const acima = desc.match(/acima de r\$\s*([\d.,]+)\s*(milhao|milhoes|mil)?/);
    const mult = (u?: string) => (u && u.startsWith("milh") ? 1_000_000 : u === "mil" ? 1_000 : 1);
    if (intervalo) {
      prodMin = num(intervalo[1]);
      prodMax = num(intervalo[2]) * mult(intervalo[3]);
    } else if (acima) {
      prodMin = num(acima[1]) * mult(acima[2]);
      prodMax = null;
    } else if (ate) {
      prodMin = 0;
      prodMax = num(ate[1]) * mult(ate[2]);
    } else {
      continue;
    }
    out.push({ faixa, prod_min: prodMin, prod_max: prodMax });
  }
  return out;
}

function parseSeguro(lines: string[]): SeguroBbts | null {
  let prazoHdr: string[] | null = null;
  let slip: number[] | null = null;
  let estoque: number | null = null;
  for (const raw of lines) {
    const ln = deacc(raw).trim();
    const mPrazo = ln.match(/^Prazo\s+((?:\d+-\d+\s*|\d+\+\s*)+)$/i);
    if (mPrazo) {
      prazoHdr = mPrazo[1].trim().split(/\s+/);
      continue;
    }
    if (/^Slip\s/i.test(ln)) slip = pctsIn(ln).map((h) => h.dec);
    if (/^Estoque\s/i.test(ln)) {
      const hits = pctsIn(ln);
      if (hits.length > 0) estoque = hits[0].dec;
    }
  }
  if (!prazoHdr || !slip || estoque === null || prazoHdr.length !== slip.length) return null;
  const faixas = prazoHdr.map((tok, i) => {
    const m = tok.match(/^(\d+)-(\d+)$/);
    if (m) return { prazo_min: Number(m[1]), prazo_max: Number(m[2]), pct: slip![i] };
    const mPlus = tok.match(/^(\d+)\+$/);
    return {
      prazo_min: mPlus ? Number(mPlus[1]) : 0,
      prazo_max: null as number | null,
      pct: slip![i],
    };
  });
  return { slip: faixas, estoque: { pct: estoque } };
}

// ---------------------------------------------------------------------------
// Parse principal
// ---------------------------------------------------------------------------
/**
 * Uma âncora só vale se for o título de uma MATRIZ — não da prosa.
 *
 * A seção "Informações adicionais" repete títulos IDÊNTICOS aos das matrizes
 * (ex.: "Não Consignado - Automático, Salário e Benefício" aparece na pág. 5 como
 * matriz e na pág. 7 como prosa, com "Prazo/Tíquete/Taxa" embaixo). Sem esta
 * guarda, a prosa reabriria o grupo e poderia contaminá-lo. Discriminador: um
 * título de matriz é seguido, em até 3 linhas, pelo cabeçalho de colunas
 * ("... Faixa 1 Faixa 2 ..." ou "Faixa Única").
 */
function ancoraDeMatriz(lines: string[], i: number): boolean {
  for (let k = i + 1; k <= i + 3 && k < lines.length; k++) {
    if (/Faixa\s*(1|Unica)/i.test(deacc(lines[k]))) return true;
  }
  return false;
}

export function parseMatrizBbts(lines: string[]): MatrizCrua {
  const buckets: Record<string, { titulo: string; linhas: string[] }> = {};
  let cur: string | null = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const ln = deacc(raw).trim();
    if (!ln) continue;

    let matched: string | null = null;
    for (const [rx, key] of GROUP_ANCHORS) {
      // casaRotuloFragmentado, nao rx.test: o gerador de PDF da BBTS as vezes
      // quebra a palavra com espaco ("Ren ovavel", "B eneficio"). Com rx.test
      // puro o grupo inteiro sumia da regua SEM ERRO — a regua saia menor e a
      // recusa vinha depois, no validador, culpando o DOCUMENTO por um defeito
      // de LEITURA. Trata o SITIO (todas as ancoras), nao o caso do BB Energia.
      if (casaRotuloFragmentado(ln, rx) && ancoraDeMatriz(lines, idx)) {
        matched = key;
        break;
      }
    }
    if (matched) {
      cur = matched;
      if (!buckets[cur]) buckets[cur] = { titulo: raw.trim(), linhas: [] };
      continue;
    }
    if (!cur) continue;
    if (SKIP.test(ln)) continue; // rodapé/cabeçalho: grupo CONTINUA (cruza página)
    if (STOP.test(ln)) {
      cur = null;
      continue;
    }
    buckets[cur].linhas.push(raw);
  }

  const grupos: Record<string, GrupoCru> = {};
  for (const [key, b] of Object.entries(buckets)) {
    grupos[key] = { titulo: b.titulo, celulas: montarCelulas(key, b.linhas) };
  }

  // vigência declarada no PDF: "(Vigência a partir de 30/06/2026)"
  let vigenciaPdf: string | null = null;
  for (const raw of lines) {
    const m = deacc(raw).match(/Vigencia a partir de\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (m) {
      vigenciaPdf = `${m[3]}-${m[2]}-${m[1]}`;
      break; // a PRIMEIRA é a do crédito (a 2a, pág. 9, é a do seguro)
    }
  }

  // modelo de pagamento (pág. 8)
  let avtTeto: number | null = null;
  let prtRegra: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = deacc(lines[i]).trim();
    if (/^Recebimento a vista/i.test(ln)) {
      const hits = pctsIn(ln);
      if (hits.length > 0) avtTeto = hits[hits.length - 1].dec;
    }
    // O PDF quebra a frase do PRT em volta do rótulo:
    //   "Diferença percentual a receber dividido pelo prazo da" / "PRT (a prazo)" / "operação"
    if (/^PRT \(a prazo\)/i.test(ln)) {
      prtRegra = [lines[i - 1], lines[i + 1]].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    }
  }

  return {
    grupos,
    convenios: parseConveniosBbts(lines),
    faixasEnquadramento: parseFaixasEnquadramento(lines),
    avtTeto,
    prtRegra,
    seguro: parseSeguro(lines),
    vigenciaPdf,
  };
}

/** Lê o PDF e devolve a matriz crua. Lança BbtsParseError se o PDF não tiver texto. */
export async function parseBbtsPdf(pdfBytes: Uint8Array): Promise<MatrizCrua> {
  const lines = await extractLinesFromPdf(pdfBytes);
  if (lines.length === 0) {
    throw new BbtsParseError("PDF sem texto (imagem/escaneado?) — extração abortada.");
  }
  return parseMatrizBbts(lines);
}
