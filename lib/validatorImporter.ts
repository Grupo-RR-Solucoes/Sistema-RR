/**
 * Leitor da aba Validador / Resumo dos arquivos mensais Promotiva.
 *
 * Layouts suportados:
 *
 * 1) FORMATO NOVO (a partir de Ago/2024) — aba "Validador" (1 linha de header
 *    + 1 linha de dados; 14 colunas):
 *       CÓD. GRUPO | GRUPO | PRODUÇÃO BRUTA | PRODUÇÃO LÍQUIDA |
 *       PRODUÇÃO LÍQUIDA INSS | META PF | DESAFIO | % META | % DESAFIO |
 *       % CRÉDITO NOVO | TABELA | BÔNUS INSS | OBS | % PENETRAÇÃO
 *
 * 2) FORMATO ANTIGO (Dez/2022 a Jul/2024) — aba "Resumo" com linhas
 *    rotuladas: "Produção do Grupo Crédito PF", "Meta", "% Meta Atingida",
 *    "% Penetração Prestamista" (presente a partir de Set/2023), "Resultado".
 *
 * Tolerância:
 *   - cabeçalhos case-insensitive, sem diferenciar acento, espaços extras.
 *   - várias variações ortográficas conhecidas ("MetaAtingida", "% META").
 *
 * Falha hard se:
 *   - arquivo é encontrado mas a aba esperada está ausente em ambos os
 *     formatos.
 *   - o formato esperado existe mas falta um campo obrigatório (ex.: META PF).
 *
 * NÃO carrega arquivos em massa — leia mês a mês via `lerValidadorMes`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";

/** Resultado da leitura de um arquivo mensal. */
export interface ValidatorSnapshot {
  year: number;
  month: number;
  /** Em R$. Vem de `META PF` (novo) ou `Meta` (antigo). 0 indica regime VOLUME (sem meta nominal). */
  meta_pf: number | null;
  /** Em R$. Vem de `PRODUÇÃO LÍQUIDA` (novo) ou `Produção do Grupo Crédito PF` (antigo). */
  volume_liquido_atingido: number | null;
  /** Decimal — 1.0 = 100%. Vem de `% META` (novo) ou `% Meta Atingida` (antigo). */
  pct_meta: number | null;
  /** Em R$. Apenas no formato novo (não há campo equivalente no antigo). */
  volume_prestamista: number | null;
  /** Decimal — 1.0 = 100%. Pode ser null em meses Dez/2022–Ago/2023 do formato antigo. */
  pct_penetracao: number | null;
  /** Categoria que a Promotiva aplicou (ex.: "TABELA 1", "TABELA 2", "RUBI", "FAIXA 3"). */
  cat_aplicada: string | null;
  /** Caminho relativo (sob ROOT_REPORTS) do XLSX usado. */
  source_file: string;
  /** Layout usado: "validador" (novo) ou "resumo" (antigo). */
  formato: "validador" | "resumo";
  /** Dump bruto da aba para auditoria futura — JSON. */
  raw_data: Record<string, unknown>;
}

/** Configuração de paths. Ajustar caso Diego mova as pastas. */
export const ROOT_REPORTS =
  "C:\\Users\\diego\\Downloads\\RRCRED\\Relatório de Produção";
export const REPORT_FOLDERS = [
  "ALAGOAS",
  "ALAGOAS 2",
  "ALAGOAS 3",
  "PERNAMBUCO",
  "Nova pasta",
];

// ---------------------------------------------------------------------------
// Helpers — case+acento insensitive
// ---------------------------------------------------------------------------

function normLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove combining diacritical marks (acentos)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.replace(/R\$/gi, "").replace(/%/g, "").replace(/\s/g, "").trim();
    if (s === "") return null;
    const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// ---------------------------------------------------------------------------
// Procura de arquivos por mês
// ---------------------------------------------------------------------------

const MONTHS_PT: Record<number, string> = {
  1: "01", 2: "02", 3: "03", 4: "04", 5: "05", 6: "06",
  7: "07", 8: "08", 9: "09", 10: "10", 11: "11", 12: "12",
};

interface CandidateFile {
  fullPath: string;
  relPath: string;
  /** Número Cxxxx (formato novo) — usado para preferir o mais recente. */
  cVersion: number;
  /** True se o arquivo é do "novo" padrão Cxxxx_*. */
  isNewFormat: boolean;
  /** True se é um arquivo "Todos" (ignora "BB Consórcio" e similares). */
  isTodos: boolean;
}

/**
 * Lista candidatos para (year, month) em todas as pastas conhecidas. Mantém
 * só "Todos" / formato antigo principal (não os anexos de Consórcio etc).
 */
export function findCandidatesForMonth(year: number, month: number): CandidateFile[] {
  const out: CandidateFile[] = [];
  const mm = MONTHS_PT[month];
  const yr = String(year);
  const newFormatRx = new RegExp(
    // Cxxxx_<CNPJ>_Todos_<m>_<yyyy>.xlsx (m sem zero à esquerda)
    `^C(\\d+)_\\d+_Todos_${month}_${yr}\\.xlsx$`,
    "i"
  );
  // Formato antigo: aceitar tanto "MM.YYYY" quanto "MM-YYYY"
  // ex.: "98250 - RR SOLUCOES LTDA 12-2022.xlsx" ou "01.2024.xlsx"
  const oldFormatRx = new RegExp(
    `\\b${mm}[.\\-]${yr}\\b.*\\.xlsx$`,
    "i"
  );
  // Ignorar arquivos que tenham descritor especializado no nome.
  const denyRx = /(BB\s*Cons[oó]rcio|CONS[OÓ]RCIO|BRASILCAP)/i;

  for (const folder of REPORT_FOLDERS) {
    const dir = path.join(ROOT_REPORTS, folder);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (denyRx.test(entry)) continue;
      let mNew = entry.match(newFormatRx);
      let isNewFormat = false;
      let cVersion = 0;
      let isTodos = false;
      if (mNew) {
        isNewFormat = true;
        cVersion = parseInt(mNew[1], 10);
        isTodos = true;
      } else if (oldFormatRx.test(entry)) {
        // Garantir que é um arquivo "principal" (não "07.2024 2.xlsx" como
        // a 2ª versão revisada). Mas o "2.xlsx" também pode ser versão
        // mais nova — vamos considerar e deixar a estratégia de tie-break
        // levar em conta.
        isNewFormat = false;
        isTodos = true;
      } else {
        continue;
      }
      out.push({
        fullPath: path.join(dir, entry),
        relPath: path.join(folder, entry),
        cVersion,
        isNewFormat,
        isTodos,
      });
    }
  }
  // Preferência: novo formato com MENOR Cxxxx (arquivo primário consolidado;
  // Cxxxx maior na mesma competência são reissues incrementais que vêm com
  // apenas o header do Validador, sem linha de dados — viram noise se
  // escolhidos erroneamente). Antigo "MM.YYYY 2.xlsx" é tipicamente uma
  // revisão posterior do mesmo mês — preferir esse sobre o "MM.YYYY.xlsx".
  out.sort((a, b) => {
    if (a.isNewFormat !== b.isNewFormat) return a.isNewFormat ? -1 : 1;
    if (a.isNewFormat) return a.cVersion - b.cVersion;
    const aRev = / 2\.xlsx$/i.test(a.relPath) ? 1 : 0;
    const bRev = / 2\.xlsx$/i.test(b.relPath) ? 1 : 0;
    return bRev - aRev;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Parser: aba "Validador" (formato novo)
// ---------------------------------------------------------------------------

const VALIDADOR_HEADERS = {
  meta_pf: ["meta pf", "metapf"],
  volume_liquido_atingido: ["producao liquida", "producao liquida total"],
  pct_meta: ["% meta"],
  volume_prestamista: [], // não há coluna direta — derivamos de pct_pen × prod_liquida
  pct_penetracao: ["% penetracao"],
  cat_aplicada: ["tabela"],
};

function parseValidadorTab(
  ws: XLSX.WorkSheet
): {
  meta_pf: number | null;
  volume_liquido_atingido: number | null;
  pct_meta: number | null;
  volume_prestamista: number | null;
  pct_penetracao: number | null;
  cat_aplicada: string | null;
  raw_data: Record<string, unknown>;
} {
  if (!ws["!ref"]) throw new Error("Aba Validador vazia");
  const all = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });
  if (all.length < 2) throw new Error("Aba Validador sem header+dados (mínimo 2 linhas)");
  const headers = (all[0] as unknown[]).map((h) => normLabel(String(h ?? "")));
  // Procura linha de dados — na prática é a 1ª (índice 1). Mas alguns arquivos
  // podem ter linhas em branco ou comentário; varremos até achar uma linha com
  // GRUPO RR.
  let dataRow: unknown[] | null = null;
  for (let i = 1; i < all.length; i += 1) {
    const r = all[i] as unknown[];
    if (!r || r.length === 0) continue;
    const text = r.map((v) => (v == null ? "" : String(v))).join(" ");
    if (/GRUPO\s+RR/i.test(text)) {
      dataRow = r;
      break;
    }
  }
  if (!dataRow) {
    // Fallback: usa a 2ª linha
    dataRow = all[1] as unknown[];
  }

  const findIdx = (variants: string[]): number => {
    for (let i = 0; i < headers.length; i += 1) {
      const h = headers[i];
      if (variants.some((v) => h === v)) return i;
    }
    return -1;
  };
  const get = (variants: string[]): unknown => {
    const idx = findIdx(variants);
    return idx === -1 ? null : dataRow![idx];
  };

  const idxMetaPf = findIdx(VALIDADOR_HEADERS.meta_pf);
  if (idxMetaPf === -1) {
    throw new Error(
      "Validador sem coluna META PF — headers encontrados: " + headers.join(" | ")
    );
  }
  const idxProdLiq = findIdx(VALIDADOR_HEADERS.volume_liquido_atingido);
  if (idxProdLiq === -1) {
    throw new Error(
      "Validador sem coluna PRODUÇÃO LÍQUIDA — headers encontrados: " + headers.join(" | ")
    );
  }
  const idxPctMeta = findIdx(VALIDADOR_HEADERS.pct_meta);
  if (idxPctMeta === -1) {
    throw new Error(
      "Validador sem coluna % META — headers encontrados: " + headers.join(" | ")
    );
  }
  const idxTabela = findIdx(VALIDADOR_HEADERS.cat_aplicada);
  if (idxTabela === -1) {
    throw new Error(
      "Validador sem coluna TABELA — headers encontrados: " + headers.join(" | ")
    );
  }

  const meta_pf = toNum(dataRow[idxMetaPf]);
  const volume_liquido_atingido = toNum(dataRow[idxProdLiq]);
  const pct_meta = toNum(dataRow[idxPctMeta]);
  const pct_penetracao = toNum(get(VALIDADOR_HEADERS.pct_penetracao));
  const cat_aplicada = toStr(dataRow[idxTabela]);
  const volume_prestamista =
    pct_penetracao != null && volume_liquido_atingido != null
      ? Math.round(pct_penetracao * volume_liquido_atingido * 100) / 100
      : null;

  // raw_data: dump por header normalizado para auditoria
  const raw_data: Record<string, unknown> = {};
  headers.forEach((h, i) => {
    if (h) raw_data[h] = dataRow![i] ?? null;
  });

  return {
    meta_pf,
    volume_liquido_atingido,
    pct_meta,
    volume_prestamista,
    pct_penetracao,
    cat_aplicada,
    raw_data,
  };
}

// ---------------------------------------------------------------------------
// Parser: aba "Resumo" (formato antigo)
// ---------------------------------------------------------------------------

const RESUMO_LABELS = {
  prod_grupo: ["producao do grupo credito pf"],
  meta: ["meta"],
  pct_meta: ["% meta atingida"],
  pct_pen: ["% penetracao prestamista"],
  resultado: ["resultado"],
};

function parseResumoTab(
  ws: XLSX.WorkSheet
): {
  meta_pf: number | null;
  volume_liquido_atingido: number | null;
  pct_meta: number | null;
  volume_prestamista: number | null;
  pct_penetracao: number | null;
  cat_aplicada: string | null;
  raw_data: Record<string, unknown>;
} {
  if (!ws["!ref"]) throw new Error("Aba Resumo vazia");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });

  // Para cada linha, primeira célula com label, próxima célula não-nula = valor.
  function findValueByLabel(variants: string[]): unknown {
    for (const r of rows) {
      if (!r || r.length === 0) continue;
      for (let j = 0; j < r.length; j += 1) {
        const cell = r[j];
        if (typeof cell !== "string") continue;
        const lab = normLabel(cell);
        if (!variants.some((v) => lab === v)) continue;
        // valor é a próxima célula não-nula
        for (let k = j + 1; k < r.length; k += 1) {
          if (r[k] != null && r[k] !== "") return r[k];
        }
        return null;
      }
    }
    return null;
  }

  const prodRaw = findValueByLabel(RESUMO_LABELS.prod_grupo);
  const metaRaw = findValueByLabel(RESUMO_LABELS.meta);
  const pctMetaRaw = findValueByLabel(RESUMO_LABELS.pct_meta);
  const pctPenRaw = findValueByLabel(RESUMO_LABELS.pct_pen);
  const resultadoRaw = findValueByLabel(RESUMO_LABELS.resultado);

  if (metaRaw == null && pctMetaRaw == null && resultadoRaw == null) {
    throw new Error(
      "Aba Resumo sem campos esperados (Meta / % Meta Atingida / Resultado)"
    );
  }

  const meta_pf = toNum(metaRaw);
  const volume_liquido_atingido = toNum(prodRaw);
  const pct_meta = toNum(pctMetaRaw);
  const pct_penetracao = toNum(pctPenRaw); // null em pré-Set/2023
  const cat_aplicada = toStr(resultadoRaw);
  const volume_prestamista =
    pct_penetracao != null && volume_liquido_atingido != null
      ? Math.round(pct_penetracao * volume_liquido_atingido * 100) / 100
      : null;

  const raw_data: Record<string, unknown> = {
    "producao do grupo credito pf": prodRaw ?? null,
    meta: metaRaw ?? null,
    "% meta atingida": pctMetaRaw ?? null,
    "% penetracao prestamista": pctPenRaw ?? null,
    resultado: resultadoRaw ?? null,
  };

  return {
    meta_pf,
    volume_liquido_atingido,
    pct_meta,
    volume_prestamista,
    pct_penetracao,
    cat_aplicada,
    raw_data,
  };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** True se o snapshot tem dado mínimo (linha de validador com cat_aplicada ou meta_pf). */
function hasUsableData(s: {
  cat_aplicada: string | null;
  meta_pf: number | null;
  pct_meta: number | null;
}): boolean {
  if (s.cat_aplicada && s.cat_aplicada.trim() !== "") return true;
  if (s.meta_pf != null && s.meta_pf > 0) return true;
  if (s.pct_meta != null && s.pct_meta > 0) return true;
  return false;
}

/**
 * Lê o arquivo Promotiva primário para (year, month) e extrai dados do
 * Validador (formato novo) ou Resumo (formato antigo). Itera os candidatos
 * em ordem de preferência e retorna o primeiro com dados utilizáveis.
 *
 * Retorna null se nenhum arquivo for encontrado para o mês.
 *
 * Lança Error se TODOS os candidatos falham por aba ausente / mal-formada
 * (FAIL HARD por design).
 */
export function lerValidadorMes(
  year: number,
  month: number
): ValidatorSnapshot | null {
  const candidates = findCandidatesForMonth(year, month);
  if (candidates.length === 0) return null;
  const errs: string[] = [];
  let firstWithoutData: ValidatorSnapshot | null = null;
  for (const chosen of candidates) {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.readFile(chosen.fullPath, { dense: true, cellDates: false });
    } catch (e) {
      errs.push(`${chosen.relPath}: leitura falhou (${(e as Error).message})`);
      continue;
    }
    const sheetNames = wb.SheetNames;
    const validador = sheetNames.find((n) => /^valida/i.test(normLabel(n)));
    if (validador) {
      try {
        const data = parseValidadorTab(wb.Sheets[validador]);
        const snap: ValidatorSnapshot = {
          year, month, ...data,
          source_file: chosen.relPath,
          formato: "validador",
        };
        if (hasUsableData(snap)) return snap;
        firstWithoutData = firstWithoutData ?? snap;
        continue;
      } catch (e) {
        errs.push(`${chosen.relPath} (Validador): ${(e as Error).message}`);
        continue;
      }
    }
    const resumo = sheetNames.find((n) => normLabel(n) === "resumo");
    if (resumo) {
      try {
        const data = parseResumoTab(wb.Sheets[resumo]);
        const snap: ValidatorSnapshot = {
          year, month, ...data,
          source_file: chosen.relPath,
          formato: "resumo",
        };
        if (hasUsableData(snap)) return snap;
        firstWithoutData = firstWithoutData ?? snap;
        continue;
      } catch (e) {
        errs.push(`${chosen.relPath} (Resumo): ${(e as Error).message}`);
        continue;
      }
    }
    errs.push(
      `${chosen.relPath}: sem aba Validador nem Resumo — abas: ${sheetNames.join(" | ")}`
    );
  }
  if (firstWithoutData) {
    // Houve um Validador encontrado mas sem linha de dados (possivelmente
    // arquivo de revisão que não foi preenchido). Devolve o snapshot com
    // campos null em vez de erro — Camada 1 vai cair em SEM_DADOS.
    return firstWithoutData;
  }
  throw new Error(
    `Nenhum candidato leu Validador/Resumo para ${year}-${String(month).padStart(2, "0")}: ` +
      errs.join(" ; ")
  );
}

/**
 * Itera entre dois meses inclusive e lê cada um. Retorna mapa
 * `YYYY-MM → snapshot | null` (null = arquivo não encontrado para o mês).
 *
 * Erros de parsing em meses individuais são propagados como
 * `{ ym, error }` no array `failures` em vez de interromper a iteração.
 */
export function lerIntervalo(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): {
  snapshots: Record<string, ValidatorSnapshot | null>;
  failures: { ym: string; error: string }[];
} {
  const snapshots: Record<string, ValidatorSnapshot | null> = {};
  const failures: { ym: string; error: string }[] = [];
  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    try {
      snapshots[ym] = lerValidadorMes(y, m);
    } catch (e) {
      failures.push({ ym, error: (e as Error).message });
      snapshots[ym] = null;
    }
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return { snapshots, failures };
}
