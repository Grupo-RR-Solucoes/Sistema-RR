import * as XLSX from "xlsx";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// CMS-IMPORT.A2 — import do cms (PRODUCAO_GERAL_RR) como GROUND TRUTH da comissao
// do promotor. Le SO as abas por promotor (col COMISSAO PROMOTOR / COMISSAO
// SEGURO preenchidas), pula a GERAL, mapeia promotor por CHAVE J (fallback nome
// da aba) e grava o repasse pronto. Ref: SPEC_IMPORT_CMS.md.
//
// IMPORTANTE: o layout de colunas do cms VARIA por mes (ex.: MARCO/2026 tem a
// coluna AGENCIA que ABRIL/2026 nao tem, deslocando todos os indices). Por isso
// o mapeamento e por NOME DE CABECALHO, nunca por indice fixo. O cabecalho
// tambem nem sempre esta na linha 0 (algumas abas tem um banner "META ATINGIDA"
// antes), entao a linha de cabecalho e detectada dinamicamente.

// ---------------------------------------------------------------------------
// Helpers de texto / numero (espelham lib/monthlyClosingImport.ts)
// ---------------------------------------------------------------------------

export function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

export function parseNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = String(value).trim().replace(/\s/g, "").replace("R$", "");

  let normalized = raw;

  if (raw.includes(",") && raw.includes(".")) {
    normalized =
      raw.lastIndexOf(",") > raw.lastIndexOf(".")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "");
  } else if (raw.includes(",")) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  }

  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getActualSheetRange(sheet: XLSX.WorkSheet) {
  let minRow = Number.POSITIVE_INFINITY;
  let minColumn = Number.POSITIVE_INFINITY;
  let maxRow = 0;
  let maxColumn = 0;

  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = XLSX.utils.decode_cell(address);
    minRow = Math.min(minRow, cell.r);
    minColumn = Math.min(minColumn, cell.c);
    maxRow = Math.max(maxRow, cell.r);
    maxColumn = Math.max(maxColumn, cell.c);
  }

  if (!Number.isFinite(minRow) || !Number.isFinite(minColumn)) {
    return sheet["!ref"];
  }

  return XLSX.utils.encode_range({
    s: { r: minRow, c: minColumn },
    e: { r: maxRow, c: maxColumn },
  });
}

function sheetToMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    range: getActualSheetRange(sheet),
  });
}

// ---------------------------------------------------------------------------
// Competencia / empresa a partir do nome do arquivo
// ---------------------------------------------------------------------------

const MONTHS_PT: Record<string, number> = {
  JANEIRO: 1,
  FEVEREIRO: 2,
  MARCO: 3,
  ABRIL: 4,
  MAIO: 5,
  JUNHO: 6,
  JULHO: 7,
  AGOSTO: 8,
  SETEMBRO: 9,
  OUTUBRO: 10,
  NOVEMBRO: 11,
  DEZEMBRO: 12,
};

export type CompanyToken = "AL1" | "AL2" | "AL3" | "PE";

// token do arquivo -> trecho do NOME da empresa no banco (robusto a CNPJ).
const TOKEN_TO_COMPANY_NAME: Record<CompanyToken, string> = {
  AL1: "ALAGOAS 1",
  AL2: "ALAGOAS 2",
  AL3: "ALAGOAS 3",
  PE: "PERNAMBUCO",
};

export function extractCompanyToken(fileName: string): CompanyToken | null {
  // normaliza e cola "AL 1" -> "AL1". O nome do cms varia por mes:
  //   ABRIL "AL 1" | MARCO "AL1" | JANEIRO nome completo "ALAGOAS 1" / "PERNAMBUCO".
  const compact = normalizeText(fileName).replace(/AL\s+(\d)/g, "AL$1");
  if (/(^|[^A-Z0-9])AL1([^A-Z0-9]|$)/.test(compact) || /ALAGOAS\s*1/.test(compact)) return "AL1";
  if (/(^|[^A-Z0-9])AL2([^A-Z0-9]|$)/.test(compact) || /ALAGOAS\s*2/.test(compact)) return "AL2";
  if (/(^|[^A-Z0-9])AL3([^A-Z0-9]|$)/.test(compact) || /ALAGOAS\s*3/.test(compact)) return "AL3";
  if (/(^|[^A-Z0-9])PE([^A-Z0-9]|$)/.test(compact) || /PERNAMBUCO/.test(compact)) return "PE";
  return null;
}

export function extractCompetencia(
  fileName: string
): { prodYear: number; prodMonth: number } | null {
  const text = normalizeText(fileName);
  let prodMonth = 0;
  for (const [name, value] of Object.entries(MONTHS_PT)) {
    if (text.includes(name)) {
      prodMonth = value;
      break;
    }
  }
  const yearMatch = text.match(/(20\d{2})/);
  const prodYear = yearMatch ? Number(yearMatch[1]) : 0;
  if (!prodMonth || !prodYear) return null;
  return { prodYear, prodMonth };
}

// ---------------------------------------------------------------------------
// Parsing puro do workbook (sem DB)
// ---------------------------------------------------------------------------

// j_keys que nunca devem entrar no cms (exclusao por seguranca). VAZIO desde
// 04/06: a 552710 (antes excluida) deixou de ser excluida — ver isColetivaJKey.
export const EXCLUDED_JKEYS = new Set<string>([]);

// CHAVE COLETIVA 552710 (Diego 04/06): grafias JJ552710 (duplo-J) e JJJ552710
// (triplo-J) sao a MESMA chave coletiva. Nao e mais excluida: o credito ENTRA
// no PMR da promotora DONA DA ABA onde a linha aparece, e conta nos totais. So
// a identificacao (contrato/data/chave J) e ocultada na tela de detalhe do
// promotor — marcacao derivada da propria chave (sem coluna nova).
export function isColetivaJKey(jKey: unknown): boolean {
  return /^J+552710$/.test(
    String(jKey ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase()
  );
}

export type CmsParsedEntry = {
  sheetName: string;
  jKey: string | null;
  promoterNameSheet: string | null;
  contractNumber: string | null;
  productDescription: string | null;
  grossValue: number;
  netValue: number;
  avistaPercent: number | null;
  companyCommission: number;
  promoterCredit: number;
  promoterInsurance: number;
  insurancePremium: number;
  penetration: number | null;
  metaAtingida: boolean; // banner "META ATINGIDA" da aba (informativo)
  isColetiva: boolean; // chave 552710 — atribuida a dona da aba, identificacao oculta na tela de detalhe
  rawPayload: Record<string, unknown>;
};

export type CmsParseResult = {
  token: CompanyToken | null;
  prodYear: number | null;
  prodMonth: number | null;
  entries: CmsParsedEntry[];
  skippedSheets: string[]; // GERAL e abas sem cabecalho
  excludedRows: number; // linhas em EXCLUDED_JKEYS puladas (hoje vazio)
  totalRows: number; // linhas de contrato lidas (antes da exclusao)
};

type HeaderMap = {
  headerRow: number;
  idxContrato: number;
  idxBruto: number;
  idxLiquido: number;
  idxChaveJ: number;
  idxPromotor: number;
  idxDescricao: number;
  idxAvista: number;
  idxComissaoPf: number;
  idxValorSeguro: number;
  idxPenetracao: number;
  idxComissaoPromotor: number;
  idxComissaoSeguroLast: number; // ultima col COMISSAO SEGURO = repasse seguro
  metaAtingida: boolean; // banner "META ATINGIDA" acima do cabecalho
  header: string[];
};

function findHeaderMap(matrix: unknown[][]): HeaderMap | null {
  for (let r = 0; r < Math.min(matrix.length, 12); r++) {
    const cells = (matrix[r] || []).map(normalizeText);
    if (cells.includes("CONTRATO") && cells.includes("CHAVE J")) {
      // banner "META ATINGIDA": qualquer celula acima do cabecalho com esse
      // texto sinaliza que o promotor bateu a meta (informativo).
      let metaAtingida = false;
      for (let p = 0; p < r; p++) {
        for (const c of (matrix[p] || []).map(normalizeText)) {
          if (c === "META ATINGIDA") metaAtingida = true;
        }
      }
      // ultima ocorrencia de COMISSAO SEGURO (a 1a e a do seguro EMPRESA, a
      // ultima coluna e o repasse do PROMOTOR). Cobre "COMISSAO SEGURO" e
      // "COMISSAO SEGURO2".
      let idxSeguroLast = -1;
      cells.forEach((c, i) => {
        if (c === "COMISSAO SEGURO" || c === "COMISSAO SEGURO2") idxSeguroLast = i;
      });
      return {
        headerRow: r,
        idxContrato: cells.indexOf("CONTRATO"),
        idxBruto: cells.indexOf("VALOR BRUTO"),
        idxLiquido: cells.indexOf("VALOR LIQUIDO"),
        idxChaveJ: cells.indexOf("CHAVE J"),
        idxPromotor: cells.indexOf("PROMOTOR(A)"),
        idxDescricao: cells.indexOf("DESCRICAO DO PRODUTO"),
        idxAvista: cells.indexOf("% A VISTA"),
        idxComissaoPf: cells.indexOf("COMISSAO PF"),
        idxValorSeguro: cells.indexOf("VALOR SEGURO"),
        idxPenetracao: cells.indexOf("% PENETRACAO"),
        idxComissaoPromotor: cells.indexOf("COMISSAO PROMOTOR"),
        idxComissaoSeguroLast: idxSeguroLast,
        metaAtingida,
        header: cells,
      };
    }
  }
  return null;
}

function cell(row: unknown[], idx: number): unknown {
  return idx >= 0 ? row[idx] : "";
}

function textOrNull(value: unknown): string | null {
  const t = String(value ?? "").trim();
  return t || null;
}

export function parseCmsWorkbook(input: {
  buffer: Buffer;
  fileName: string;
}): CmsParseResult {
  const workbook = XLSX.read(input.buffer, { type: "buffer" });
  const token = extractCompanyToken(input.fileName);
  const competencia = extractCompetencia(input.fileName);

  const entries: CmsParsedEntry[] = [];
  const skippedSheets: string[] = [];
  let excludedRows = 0;
  let totalRows = 0;

  for (const sheetName of workbook.SheetNames) {
    // pula a GERAL (repasse vazio; somar empresa+aba misturaria bases).
    if (normalizeText(sheetName) === "GERAL") {
      skippedSheets.push(sheetName);
      continue;
    }

    const matrix = sheetToMatrix(workbook.Sheets[sheetName]);
    const hmap = findHeaderMap(matrix);
    if (!hmap || hmap.idxComissaoPromotor < 0 || hmap.idxComissaoSeguroLast < 0) {
      // aba sem o cabecalho esperado: nao da pra extrair repasse com seguranca.
      skippedSheets.push(sheetName);
      continue;
    }

    for (let r = hmap.headerRow + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const contrato = String(cell(row, hmap.idxContrato) ?? "").trim();
      // pula linhas TOTAL / CANCELAMENTO / ADIANTAMENTO (CONTRATO nao numerico).
      if (!/^\d+$/.test(contrato)) continue;

      totalRows += 1;

      const jKey = textOrNull(cell(row, hmap.idxChaveJ));
      if (jKey && EXCLUDED_JKEYS.has(jKey.toUpperCase())) {
        excludedRows += 1;
        continue;
      }

      const rawPayload: Record<string, unknown> = {};
      hmap.header.forEach((h, i) => {
        if (h) rawPayload[h] = row[i] ?? "";
      });

      entries.push({
        sheetName,
        jKey,
        promoterNameSheet: textOrNull(cell(row, hmap.idxPromotor)) || sheetName,
        contractNumber: contrato,
        productDescription: textOrNull(cell(row, hmap.idxDescricao)),
        grossValue: parseNumber(cell(row, hmap.idxBruto)),
        netValue: parseNumber(cell(row, hmap.idxLiquido)),
        avistaPercent:
          hmap.idxAvista >= 0 ? parseNumber(cell(row, hmap.idxAvista)) : null,
        companyCommission: parseNumber(cell(row, hmap.idxComissaoPf)),
        promoterCredit: parseNumber(cell(row, hmap.idxComissaoPromotor)),
        promoterInsurance: parseNumber(cell(row, hmap.idxComissaoSeguroLast)),
        insurancePremium: parseNumber(cell(row, hmap.idxValorSeguro)),
        penetration:
          hmap.idxPenetracao >= 0
            ? parseNumber(cell(row, hmap.idxPenetracao))
            : null,
        metaAtingida: hmap.metaAtingida,
        isColetiva: isColetivaJKey(jKey),
        rawPayload,
      });
    }
  }

  return {
    token,
    prodYear: competencia?.prodYear ?? null,
    prodMonth: competencia?.prodMonth ?? null,
    entries,
    skippedSheets,
    excludedRows,
    totalRows,
  };
}

// ---------------------------------------------------------------------------
// Resolucao de empresa / promotor contra o banco
// ---------------------------------------------------------------------------

export type CompanyRow = { id: string; name: string; cnpj: string };
export type JKeyRow = { j_key: string; promoter_id: string | null; key_type: string | null };
export type PromoterRow = { id: string; name: string };

export type CmsResolutionMaps = {
  companies: CompanyRow[];
  jKeyToPromoter: Map<string, string>; // CHAVE J (upper) -> promoter_id
  promoterByName: Map<string, string>; // nome normalizado -> promoter_id (so 1:1)
  masterJKeys: Set<string>; // CHAVE J (upper) com key_type=MASTER
};

// aliases de variacao de acento/grafia citados na SPEC (sheet -> canonical).
const SHEET_NAME_ALIASES: Record<string, string> = {
  MONALIZA: "MONALISA",
  JARLLES: "JARLES",
};

function applySheetAliases(name: string): string {
  return name
    .split(/\s+/)
    .map((tok) => SHEET_NAME_ALIASES[tok] ?? tok)
    .join(" ");
}

export async function loadCmsResolutionMaps(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>
): Promise<CmsResolutionMaps> {
  const [companiesRes, jKeysRes, promotersRes] = await Promise.all([
    supabaseAdmin.from("companies").select("id, name, cnpj").order("name"),
    supabaseAdmin.from("j_keys").select("j_key, promoter_id, key_type"),
    supabaseAdmin.from("promoters").select("id, name"),
  ]);

  if (companiesRes.error) throw new Error(companiesRes.error.message);
  if (jKeysRes.error) throw new Error(jKeysRes.error.message);
  if (promotersRes.error) throw new Error(promotersRes.error.message);

  const jKeyToPromoter = new Map<string, string>();
  const masterJKeys = new Set<string>();
  for (const k of (jKeysRes.data || []) as JKeyRow[]) {
    if (!k.j_key) continue;
    const key = k.j_key.trim().toUpperCase();
    if (k.promoter_id) jKeyToPromoter.set(key, k.promoter_id);
    if (normalizeText(k.key_type) === "MASTER") masterJKeys.add(key);
  }

  // nome normalizado -> promoter_id, mas so quando o nome e UNICO (evita match
  // ambiguo no fallback). Nomes repetidos sao removidos do indice.
  const nameCount = new Map<string, number>();
  const nameToId = new Map<string, string>();
  for (const p of (promotersRes.data || []) as PromoterRow[]) {
    const key = normalizeText(p.name);
    if (!key) continue;
    nameCount.set(key, (nameCount.get(key) || 0) + 1);
    nameToId.set(key, p.id);
  }
  const promoterByName = new Map<string, string>();
  for (const [key, id] of nameToId) {
    if (nameCount.get(key) === 1) promoterByName.set(key, id);
  }

  return {
    companies: (companiesRes.data || []) as CompanyRow[],
    jKeyToPromoter,
    promoterByName,
    masterJKeys,
  };
}

export function resolveCompanyByToken(
  token: CompanyToken | null,
  companies: CompanyRow[]
): CompanyRow | null {
  if (!token) return null;
  const needle = TOKEN_TO_COMPANY_NAME[token];
  return (
    companies.find((c) => normalizeText(c.name).includes(needle)) || null
  );
}

// fallback por nome da aba: match exato (1:1) ou startsWith do nome completo.
function resolvePromoterBySheetName(
  sheetName: string,
  promoterByName: CmsResolutionMaps["promoterByName"]
): string | null {
  const norm = applySheetAliases(normalizeText(sheetName));
  const exact = promoterByName.get(norm);
  if (exact) return exact;

  // o nome no cadastro costuma ser mais completo que a aba (ex.: "THAYNARA
  // TAVARES" vs "THAYNARA TAVARES CORREIA COSTA"). Aceita um unico promotor
  // cujo nome comece pelo nome da aba.
  const matches: string[] = [];
  for (const [name, id] of promoterByName) {
    if (name === norm || name.startsWith(norm + " ")) matches.push(id);
  }
  const unique = Array.from(new Set(matches));
  return unique.length === 1 ? unique[0] : null;
}

export type CmsResolvedEntry = CmsParsedEntry & {
  companyId: string | null;
  promoterId: string | null;
  promoterSource: "J_KEY" | "SHEET_NAME" | "COLETIVA_SHEET" | null;
  isMaster: boolean; // CHAVE J e key_type=MASTER em j_keys
};

export type CmsUnmappedRow = {
  sheet: string;
  jKey: string | null;
  contract: string | null;
  reason: string;
};

export type CmsResolution = {
  company: CompanyRow | null;
  entries: CmsResolvedEntry[];
  unmapped: CmsUnmappedRow[];
};

export function resolveCmsEntries(
  parsed: CmsParseResult,
  maps: CmsResolutionMaps
): CmsResolution {
  const company = resolveCompanyByToken(parsed.token, maps.companies);
  const entries: CmsResolvedEntry[] = [];
  const unmapped: CmsUnmappedRow[] = [];
  const sheetFallback = new Map<string, string | null>(); // cache por aba

  for (const e of parsed.entries) {
    let promoterId: string | null = null;
    let promoterSource: CmsResolvedEntry["promoterSource"] = null;

    // CHAVE J direta (nao vale p/ coletiva 552710, que nao tem dono proprio).
    if (e.jKey && !e.isColetiva) {
      const byKey = maps.jKeyToPromoter.get(e.jKey.toUpperCase());
      if (byKey) {
        promoterId = byKey;
        promoterSource = "J_KEY";
      }
    }

    // DONA DA ABA por nome (tambem resolve a coletiva 552710: vai p/ a promotora
    // dona da aba onde aparece). NAO chuta master/dominante — se a dona nao for
    // promotora cadastrada (ex.: novata de maio), fica nao-mapeada p/ decisao.
    if (!promoterId) {
      if (!sheetFallback.has(e.sheetName)) {
        sheetFallback.set(
          e.sheetName,
          resolvePromoterBySheetName(e.sheetName, maps.promoterByName)
        );
      }
      const byName = sheetFallback.get(e.sheetName) || null;
      if (byName) {
        promoterId = byName;
        promoterSource = e.isColetiva ? "COLETIVA_SHEET" : "SHEET_NAME";
      }
    }

    if (!promoterId) {
      unmapped.push({
        sheet: e.sheetName,
        jKey: e.jKey,
        contract: e.contractNumber,
        reason: e.isColetiva
          ? `CHAVE COLETIVA ${e.jKey} — dona da aba "${e.sheetName}" sem promotora cadastrada`
          : e.jKey
          ? `CHAVE J ${e.jKey} sem promotor e nome da aba sem match 1:1`
          : "linha sem CHAVE J e nome da aba sem match 1:1",
      });
    }

    entries.push({
      ...e,
      companyId: company?.id ?? null,
      promoterId,
      promoterSource,
      isMaster: e.jKey ? maps.masterJKeys.has(e.jKey.toUpperCase()) : false,
    });
  }

  return { company, entries, unmapped };
}

// ---------------------------------------------------------------------------
// Writer DB (espelha lib/monthlyClosingImport.ts) — usado pela rota /api
// ---------------------------------------------------------------------------

const ENTRIES_INSERT_CHUNK_SIZE = 500;

function isTransientError(err: any): boolean {
  const message = String(err?.message || err || "");
  return (
    message.includes("fetch failed") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("EAI_AGAIN")
  );
}

async function supabaseRetry<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
  maxRetries = 3
): Promise<{ data: T | null; error: any }> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (!result.error) return result;
      lastError = result.error;
      if (!isTransientError(result.error) || attempt === maxRetries) {
        return result;
      }
    } catch (err: any) {
      lastError = err;
      if (!isTransientError(err) || attempt === maxRetries) throw err;
    }
    const delayMs = 1000 * Math.pow(2, attempt - 1);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { data: null, error: lastError };
}

export type CmsImportResult = {
  success: boolean;
  importId: string;
  company: { id: string; name: string; cnpj: string };
  prodYear: number;
  prodMonth: number;
  processedEntries: number;
  mappedEntries: number;
  unmappedEntries: number;
  excludedRows: number;
  skippedSheets: string[];
  totals: { promoterCredit: number; promoterInsurance: number; companyCommission: number };
  unmapped: CmsUnmappedRow[];
};

export async function importCmsWorkbook(input: {
  fileBase64: string;
  fileName: string;
  createdBy?: string | null;
}): Promise<CmsImportResult> {
  const supabaseAdmin = getSupabaseAdmin();

  const parsed = parseCmsWorkbook({
    buffer: Buffer.from(input.fileBase64, "base64"),
    fileName: input.fileName,
  });

  if (!parsed.token || !parsed.prodYear || !parsed.prodMonth) {
    throw new Error(
      `Nao foi possivel extrair empresa (AL1/AL2/AL3/PE) e/ou competencia (mes/ano) do nome "${input.fileName}".`
    );
  }

  const maps = await loadCmsResolutionMaps(supabaseAdmin);
  const resolution = resolveCmsEntries(parsed, maps);

  if (!resolution.company) {
    throw new Error(
      `Empresa do token ${parsed.token} nao encontrada no cadastro (companies).`
    );
  }
  const company = resolution.company;

  const { data: importLog, error: importLogError } = await supabaseAdmin
    .from("cms_imports")
    .insert({
      company_id: company.id,
      prod_year: parsed.prodYear,
      prod_month: parsed.prodMonth,
      file_name: input.fileName,
      status: "PROCESSING",
    })
    .select("id")
    .single();

  if (importLogError || !importLog) {
    throw new Error(importLogError?.message || "Falha ao registrar o import do cms.");
  }

  try {
    return await runCmsImportPipeline({
      supabaseAdmin,
      importId: importLog.id,
      company,
      parsed,
      resolution,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erro desconhecido durante o import do cms.";
    const stack = err instanceof Error && err.stack ? err.stack : "";
    try {
      await supabaseAdmin
        .from("cms_imports")
        .update({
          status: "FAILED",
          error_message: `${message}\n${stack.slice(0, 2000)}`.trim(),
          error_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        })
        .eq("id", importLog.id);
    } catch {
      // silencioso
    }
    throw err;
  }
}

async function runCmsImportPipeline(ctx: {
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  importId: string;
  company: CompanyRow;
  parsed: CmsParseResult;
  resolution: CmsResolution;
}): Promise<CmsImportResult> {
  const { supabaseAdmin, importId, company, parsed, resolution } = ctx;
  const prodYear = parsed.prodYear as number;
  const prodMonth = parsed.prodMonth as number;

  const totals = { promoterCredit: 0, promoterInsurance: 0, companyCommission: 0 };
  let mappedEntries = 0;

  const rowsToInsert = resolution.entries.map((e) => {
    totals.promoterCredit += e.promoterCredit;
    totals.promoterInsurance += e.promoterInsurance;
    totals.companyCommission += e.companyCommission;
    if (e.promoterId) mappedEntries += 1;

    return {
      cms_import_id: importId,
      company_id: company.id,
      company_cnpj: company.cnpj,
      prod_year: prodYear,
      prod_month: prodMonth,
      j_key: e.jKey,
      promoter_id: e.promoterId,
      promoter_name_sheet: e.promoterNameSheet,
      contract_number: e.contractNumber,
      product_description: e.productDescription,
      net_value: e.netValue,
      gross_value: e.grossValue,
      avista_percent: e.avistaPercent,
      company_commission: e.companyCommission,
      promoter_credit: e.promoterCredit,
      promoter_insurance: e.promoterInsurance,
      insurance_premium: e.insurancePremium,
      penetration: e.penetration,
      meta_atingida: e.metaAtingida,
      is_master: e.isMaster,
      source_sheet: e.sheetName,
      raw_payload: e.rawPayload,
    };
  });

  // idempotente: re-import da mesma competencia/empresa substitui as entries.
  const { error: deleteError } = await supabaseRetry(async () =>
    supabaseAdmin
      .from("cms_promoter_entries")
      .delete()
      .eq("company_id", company.id)
      .eq("prod_year", prodYear)
      .eq("prod_month", prodMonth)
  );
  if (deleteError) throw new Error(deleteError.message);

  for (let i = 0; i < rowsToInsert.length; i += ENTRIES_INSERT_CHUNK_SIZE) {
    const slice = rowsToInsert.slice(i, i + ENTRIES_INSERT_CHUNK_SIZE);
    const { error: chunkError } = await supabaseRetry(async () =>
      supabaseAdmin.from("cms_promoter_entries").insert(slice)
    );
    if (chunkError) {
      throw new Error(
        `Falha ao inserir chunk ${i}-${i + slice.length} de ${rowsToInsert.length}: ${chunkError.message}`
      );
    }
  }

  const { error: finishError } = await supabaseRetry(async () =>
    supabaseAdmin
      .from("cms_imports")
      .update({
        status: "COMPLETED",
        finished_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", importId)
  );
  if (finishError) throw new Error(finishError.message);

  return {
    success: true,
    importId,
    company: { id: company.id, name: company.name, cnpj: company.cnpj },
    prodYear,
    prodMonth,
    processedEntries: rowsToInsert.length,
    mappedEntries,
    unmappedEntries: rowsToInsert.length - mappedEntries,
    excludedRows: parsed.excludedRows,
    skippedSheets: parsed.skippedSheets,
    totals,
    unmapped: resolution.unmapped,
  };
}
