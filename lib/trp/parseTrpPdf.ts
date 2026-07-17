// ============================================================================
// F6a — Parser de TRP em Node (roda no servidor Vercel; auxiliar sobe o PDF de
// qualquer máquina, só navegador). Porta o parse_trp.py (pdfplumber.extract_text
// + regex âncora-em-rótulo) para Node/TypeScript usando `unpdf` (build serverless
// do pdf.js, JS puro, sem binário nativo).
//
// A reconstrução de linha por coordenada (agrupar por y, ordenar por x) reproduz
// EXATAMENTE o extract_text() do pdfplumber (provado: 36/36 linhas de matriz nos
// 3 PDFs). Os VALORES de pct extraídos batem 195/195 × 3 com os JSONs canônicos.
//
// Escopo (gate F6a): extração fiel da MATRIZ (produtos → faixas/pct) + _meta
// mecânico (competência, vigência holiday-aware, regime). A estrutura curada à
// mão da Etapa 2 (prazo por célula do CONSIG_PRIVADO, nomes de array, observações)
// NÃO é reproduzida aqui — é finalizada no passo de revisão/diff da tela (F6b).
// ============================================================================

import { getDocumentProxy } from "unpdf";

import { competenciaDaData, vigenciaDaCompetencia, competenciaKey } from "@/lib/trp/vigencia";

// Regime canônico por competência — espelho da tabela de getRegime() (spec v9 §9),
// inline para o parser NÃO puxar regrasLoader/regrasData (43 JSONs) e ficar leve
// no bundle serverless. É só decoração de _meta; a fonte canônica segue getRegime.
function regimeForCompetencia(mes: string): string {
  if (mes >= "2022-12" && mes <= "2023-05") return "META_2_NIVEIS_MATRIZ_TAXA_PRAZO";
  if (mes >= "2023-06" && mes <= "2024-12") return "META_2_NIVEIS";
  if (mes >= "2025-01" && mes <= "2025-06") return "META_4_NIVEIS";
  if (mes >= "2025-07" && mes <= "2025-12") return "VOLUME_6_PERFIS";
  if (mes >= "2026-01" && mes <= "2026-03") return "VOLUME_3_PERFIS";
  if (mes >= "2026-04") return "VOLUME_5_FAIXAS";
  return "META_2_NIVEIS_MATRIZ_TAXA_PRAZO";
}

// ---------------------------------------------------------------------------
// Extração de texto por coordenada (equivalente ao pdfplumber.extract_text)
// ---------------------------------------------------------------------------

/**
 * Reconstrói as linhas de texto do PDF a partir das posições dos itens (unpdf/
 * pdf.js): agrupa por y (tolerância 2.0), ordena por x, insere espaço quando há
 * gap horizontal. Reproduz o agrupamento linha-a-linha do pdfplumber.
 */
export async function extractLinesFromPdf(data: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(data);
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows: { y: number; items: { x: number; w: number; str: string }[] }[] = [];
    for (const it of tc.items as Array<{ str?: string; transform: number[]; width?: number }>) {
      if (it.str === undefined) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 2.0);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x, w: it.width || 0, str: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let line = "";
      let lastEnd: number | null = null;
      for (const it of r.items) {
        if (lastEnd !== null && it.x - lastEnd > 1.0 && !line.endsWith(" ")) line += " ";
        line += it.str;
        lastEnd = it.x + it.w;
      }
      line = line.replace(/\s+/g, " ").trim();
      if (line) out.push(line);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parsing da matriz — porta fiel de parse_trp.py
// ---------------------------------------------------------------------------

function deacc(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const PCT = /(\d+,\d+)%/g;

/** "2,44" -> 0.0244 (round 6, igual ao Python round(x/100, 6)). */
function pctToDec(tok: string): number {
  return Number((parseFloat(tok.replace(",", ".")) / 100).toFixed(6));
}

type Kind = "faixa" | "geral";
const PROD_ANCHORS: [RegExp, string, Kind][] = [
  [/^1\.2\b.*INSS Novo/i, "INSS_NOVO", "faixa"],
  [/^1\.3\b.*INSS Renova/i, "INSS_RENOV", "faixa"],
  [/^1\.4\b.*Geral/i, "CONSIG_PUBLICO", "faixa"],
  [/^1\.5\b.*SIAPE/i, "SIAPE", "faixa"],
  [/^1\.6\b.*SP e MG/i, "CONSIG_SP_MG", "faixa"],
  [/^1\.7\b.*Privado/i, "CONSIG_PRIVADO", "faixa"],
  [/^2\.2\b.*P.blico/i, "PORTAB_PUBLICO", "geral"],
  [/^2\.2\b.*Privado/i, "PORTAB_PRIVADO", "geral"],
  [/^3\.2\b.*Autom/i, "NAO_CONSIGNADO", "faixa"],
  [/^3\.3\b.*Adiantamento/i, "ADIANTAMENTO_13", "faixa"],
  [/^3\.4\b.*FGTS/i, "FGTS", "geral"],
];
const STOP = /^(Condi..es de uso|Tabela:|T.quete:|Custo de|C.digo conv.nio|Classifica..o|\d - Cr.dito|4 - Lista|2 - Cr.dito|3 - Cr.dito|1 - Cr.dito)/i;
const HDR = /Taxa de Juros\s+(T.quete\s+)?Prazo/i;

/** Percentuais (\d+,\d+) presentes numa linha. */
function pctsIn(line: string): string[] {
  return (line.match(PCT) || []).map((m) => m.slice(0, -1));
}

export interface ProdutoExtraido {
  kind: Kind;
  /** cada linha da matriz = array de N pcts (5 faixas ou 1 geral), em decimal. */
  rows: number[][];
  /** parte não-% de cada linha (taxa/prazo bruto) — insumo do transform/revisão. */
  tokens: string[];
}

/** Porta de parse_matrix(): âncora no rótulo do produto, coleta as N últimas %. */
export function parseMatrix(lines: string[]): Record<string, ProdutoExtraido> {
  const prods: Record<string, ProdutoExtraido> = {};
  let cur: string | null = null;
  let ncols = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = deacc(lines[i]).trim();
    let matched: [string, Kind] | null = null;
    for (const [rx, key, kind] of PROD_ANCHORS) {
      if (rx.test(ln)) {
        matched = [key, kind];
        break;
      }
    }
    if (matched) {
      cur = matched[0];
      ncols = matched[1] === "faixa" ? 5 : 1;
      prods[cur] = { kind: matched[1], rows: [], tokens: [] };
      continue;
    }
    if (cur) {
      if (STOP.test(ln)) {
        cur = null;
        continue;
      }
      if (HDR.test(ln)) continue;
      const pcts = pctsIn(lines[i]);
      if (pcts.length >= ncols) {
        const faixas = pcts.slice(pcts.length - ncols).map(pctToDec);
        let non = lines[i];
        for (const p of pcts.slice(pcts.length - ncols)) {
          non = non.replace(p + "%", "");
        }
        prods[cur].rows.push(faixas);
        prods[cur].tokens.push(deacc(non).trim());
      }
    }
  }
  return prods;
}

export interface ConvenioExtraido {
  linha: string;
  codigo: string;
  nome: string;
}

/** Porta de parse_convenios() — seção 4. */
export function parseConvenios(lines: string[]): ConvenioExtraido[] {
  const out: ConvenioExtraido[] = [];
  let inseg = false;
  for (const raw of lines) {
    const ln = deacc(raw).trim();
    if (/^4 - Lista de conv/i.test(ln)) {
      inseg = true;
      continue;
    }
    if (inseg) {
      if (/^5 -/.test(ln) || /^Classifica/.test(ln)) {
        if (/^5 -/.test(ln)) break;
        continue;
      }
      const m = ln.match(/^(CONSIGNADO\s+\w+|CONSIGNADO\s+SP|CONSIGNADO\s+MG)\s+(\d+)\s+(.*)$/);
      if (m) out.push({ linha: m[1].trim(), codigo: m[2], nome: m[3].trim() });
    }
  }
  return out;
}

/** Porta de parse_sec5() — seção 5 (códigos). */
export function parseSec5(lines: string[]): string[] {
  const codes: string[] = [];
  let inseg = false;
  for (const raw of lines) {
    const ln = deacc(raw).trim();
    if (/^5 -/.test(ln)) {
      inseg = true;
      continue;
    }
    if (inseg) {
      const m = ln.match(/^(\d{3,})\b/);
      if (m) codes.push(m[1]);
    }
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Escalares de categoria (tiquete_min, custo_processamento) — F6a-escalares.
//
// A linha "Condicoes de uso da tabela: / Tabela: X, Y / Tiquete: ... / Custo: ..."
// que o parseMatrix JA DETECTA como STOP TRAZ o tiquete minimo. Os 47 JSONs
// historicos foram DIGITADOS A MAO lendo esta mesma linha (build_opp*.py tem os
// literais) — a informacao esta no PDF; era lacuna de escopo, nao dado externo.
// Aqui a lemos em vez de so descartar. Reusa PROD_ANCHORS (fonte unica do mapa
// N.M -> categoria), NAO duplica.
//
// FGTS foge do padrao: nao tem bloco "Tabela:" proprio; o tiquete vem na linha da
// matriz ">= R$ 1 mil". Regex separada + normalizacao "N mil" -> N*1000, e SO
// aceita match UNICO — o PDF tem iscas "Varejo Abaixo R$ 999 mil" na secao de
// producao, que NAO casam por nao terem ">=" antes do "R$".
// ---------------------------------------------------------------------------

export interface EscalaresCategoria {
  tiquete_min?: number;
  /** cru do PDF (string); a normalizacao numero/texto e passo de revisao. */
  custo_processamento?: string;
}

/** N.M ("1.7") -> [categorias], derivado dos PROD_ANCHORS (nao duplica o mapa).
 *  A colisao proposital do 2.2 (Publico + Privado) faz "Tabela: 2.2, 2.3" cobrir
 *  as DUAS portabilidades mesmo sem ancora explicita para o 2.3. */
function numeroTabelaToCategorias(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [rx, key] of PROD_ANCHORS) {
    const mm = rx.source.match(/\^(\d+)\\\.(\d+)/);
    if (!mm) continue;
    const num = `${mm[1]}.${mm[2]}`;
    if (!m.has(num)) m.set(num, []);
    m.get(num)!.push(key);
  }
  return m;
}

const TIQ_BLOCO = /a partir de\s*R\$\s*([\d.,]+)/i;
const TIQ_FGTS = /(?:>=|≥)\s*R\$\s*(\d+)\s*mil/i;
const CUSTO_RE = /Custo de Processamento:\s*(.+)$/i;

/** "2.000,00"->2000 ; "100,00"->100 ; "1 mil"->1000. null se nao-numerico. */
function tiqueteToNumber(tok: string): number | null {
  if (/mil/i.test(tok)) {
    const n = parseInt(tok, 10);
    return Number.isFinite(n) ? n * 1000 : null;
  }
  const n = parseFloat(tok.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Extrai os escalares de categoria (tiquete_min, custo_processamento) das linhas
 * "Tabela: ... / Tiquete: ... / Custo: ..." + o caso especial do FGTS na matriz.
 * NAO valida plausibilidade nem grava — quem consome (buildTrpDraft) decide: o
 * tiquete nasce "conferir" e, em duvida, e OMITIDO (o motor cai no getMinimumTicket,
 * a rede). custo_processamento vem CRU (string do PDF).
 */
export function parseEscalares(lines: string[]): Record<string, EscalaresCategoria> {
  const map = numeroTabelaToCategorias();
  const out: Record<string, EscalaresCategoria> = {};
  const set = (cat: string, patch: Partial<EscalaresCategoria>) => {
    out[cat] = { ...(out[cat] ?? {}), ...patch };
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = deacc(lines[i]).trim();
    const mTab = /^Tabela:\s*(.+)$/i.exec(ln);
    if (!mTab) continue;
    const nums = mTab[1].match(/\d+\.\d+/g) ?? [];
    const cats = [...new Set(nums.flatMap((n) => map.get(n) ?? []))];
    if (cats.length === 0) continue;
    // O bloco vem logo abaixo do "Tabela:"; para nas fronteiras (proximo Tabela/
    // Condicoes/ancora de produto). Janela curta para nao vazar p/ a matriz seguinte.
    let tiq: number | null = null;
    let custo: string | null = null;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const ljd = deacc(lines[j]).trim();
      if (/^Tabela:|^Condi..es de uso|^\d\.\d\b/i.test(ljd)) break;
      const mt = TIQ_BLOCO.exec(ljd);
      if (mt && tiq === null) tiq = tiqueteToNumber(mt[1]);
      const mc = CUSTO_RE.exec(lines[j]);
      if (mc && custo === null) custo = mc[1].trim();
    }
    for (const c of cats) {
      if (tiq !== null) set(c, { tiquete_min: tiq });
      if (custo !== null) set(c, { custo_processamento: custo });
    }
  }

  // FGTS: tiquete na propria matriz (">= R$ N mil"). So aceita match UNICO (evita
  // as iscas "Varejo Abaixo R$ 999 mil"); ambiguo/ausente -> nao grava (fallback).
  const fgts = lines
    .map((l) => TIQ_FGTS.exec(deacc(l)))
    .filter((m): m is RegExpExecArray => m !== null);
  if (fgts.length === 1) {
    set("FGTS", { tiquete_min: parseInt(fgts[0][1], 10) * 1000 });
  }

  return out;
}

/** Linha de prazo PURO: "A partir de 48" (int isolado). Ancorada no ^...$ para NAO
 *  casar taxa ("A partir de 1,90%": tem % e virgula) nem tiquete ("a partir de R$
 *  100,00": tem R$) nem prazo INLINE numa linha de dados ("... A partir de 5 2,35%":
 *  tem mais tokens). So o prazo isolado das secoes geral. */
const PRAZO_ISOLADO = /^A partir de\s+(\d+)\s*$/i;

/**
 * Captura o prazo_min de CATEGORIA das secoes onde ele vem numa LINHA ISOLADA
 * "A partir de N" (sem % nem R$) — que o parseMatrix PULA por nao ter %. Isso ocorre
 * nas categorias "geral" (PORTAB_PUBLICO 48, PORTAB_PRIVADO 36) e no NAO_CONSIGNADO
 * (13): o prazo aparece sozinho logo apos o cabecalho "Taxa de Juros | Prazo | Geral",
 * antes da linha de dados. Nas demais (CONSIG_PUBLICO/SIAPE/ADIANTAMENTO_13/FGTS) o
 * prazo vem INLINE na linha de % -> vira cell.prazo_min e e DERIVADO, nao capturado.
 *
 * Ancorado no CONTEXTO da secao (PROD_ANCHORS + STOP, iguais ao parseMatrix) e exige
 * ter visto o cabecalho (HDR) da secao antes de capturar — assim ignora o indice/TOC
 * (que repete "2.2 Convenio Publico" sem cabecalho de matriz). 1 por categoria.
 */
export function parsePrazoCategoria(lines: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  let cur: string | null = null;
  let hdrVisto = false;
  for (const raw of lines) {
    const ln = deacc(raw).trim();
    let matched: string | null = null;
    for (const [rx, key] of PROD_ANCHORS) {
      if (rx.test(ln)) { matched = key; break; }
    }
    if (matched) { cur = matched; hdrVisto = false; continue; }
    if (!cur) continue;
    if (STOP.test(ln)) { cur = null; continue; }
    if (HDR.test(ln)) { hdrVisto = true; continue; }
    const m = PRAZO_ISOLADO.exec(ln);
    if (m && hdrVisto && !(cur in out)) out[cur] = Number(m[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resultado do parser + _meta mecânico
// ---------------------------------------------------------------------------

export interface TrpParseResult {
  produtos: Record<string, ProdutoExtraido>;
  convenios_sec4: ConvenioExtraido[];
  codigos_sec5: string[];
  _meta: {
    competencia: string; // "YYYY-MM"
    regime: string;
    vigencia_inicio: string; // ISO holiday-aware
    vigencia_fim: string;
    n_lines: number;
  };
}

export interface ParseTrpOptions {
  /** competência-alvo "YYYY-MM"; se ausente e houver contractDate/refDate, deriva. */
  competencia?: string;
  /** data de referência p/ derivar a competência via vigência (fallback). */
  refDate?: string;
}

/**
 * Parseia o PDF da TRP no servidor: extrai a matriz de produtos/faixas + seções
 * 4/5 + _meta mecânico (competência, regime, vigência holiday-aware). É a
 * FUNDAÇÃO da tela de upload (F6b): a estrutura canônica final (células com
 * prazo/tx, decorações) é montada/confirmada na revisão.
 */
export async function parseTrpPdf(data: Uint8Array, opts: ParseTrpOptions = {}): Promise<TrpParseResult> {
  const lines = await extractLinesFromPdf(data);
  const competencia = opts.competencia
    ? competenciaKey(opts.competencia)
    : opts.refDate
      ? competenciaDaData(opts.refDate)
      : "";
  const vig = competencia ? vigenciaDaCompetencia(competencia) : { validFrom: "", validUntil: "" };
  return {
    produtos: parseMatrix(lines),
    convenios_sec4: parseConvenios(lines),
    codigos_sec5: parseSec5(lines),
    _meta: {
      competencia,
      regime: competencia ? regimeForCompetencia(competencia) : "",
      vigencia_inicio: vig.validFrom,
      vigencia_fim: vig.validUntil,
      n_lines: lines.length,
    },
  };
}
