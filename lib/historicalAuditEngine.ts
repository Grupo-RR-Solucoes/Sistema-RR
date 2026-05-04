import {
  resolvePromotivaCashPolicy,
  type ResolvedCashPolicy,
} from "./promotivaCashPolicy.ts";
import { KNOWN_COMPANIES_BY_CNPJ } from "./knownCompanies.ts";
import { fetchAllRows } from "./queryHelpers.ts";
import { getSupabaseAdmin } from "./supabaseAdmin.ts";

// ---- Constantes de regime --------------------------------------------------

// Janelas (yearMonth como número AAAAMM) onde a Promotiva opera no regime META
// (4 tabelas: 5,40 / 5,60 / 5,80 / 6,00 conforme atingimento de meta).
// Detectar WRONG_BRACKET nessas janelas exige input externo (atingimento), o
// que ainda não está disponível — esta sub-etapa registra a faixa esperada
// como conservadora (Tab 1 = 5,40%) e se limita a sinalizar
// `INTERNAL_DIVERGENCE` quando o pct pago foge da lista permitida.
const META_RANGES: Array<{ from: number; to: number }> = [
  { from: 202307, to: 202412 }, // jul/23 a dez/24
  { from: 202501, to: 202506 }, // jan/25 a jun/25
];

const META_AUDIT_PERCENTS = [0.054, 0.056, 0.058, 0.06];

const PERCENT_TOLERANCE = 0.0001;

// ---- Helpers --------------------------------------------------------------

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const cleaned = value
      .replace(/R\$/gi, "")
      .replace(/%/g, "")
      .replace(/\s/g, "")
      .trim();
    const normalized = cleaned.includes(",")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned;
    const parsed = Number(normalized || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

function normalizePercent(value: unknown): number {
  const parsed = toNumber(value);
  if (parsed <= 0) return 0;
  return parsed > 1 ? parsed / 100 : parsed;
}

function getMetadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  aliases: string[]
): number {
  if (!metadata) return 0;

  const wantedSet = new Set(aliases.map((alias) => normalizeText(alias)));

  for (const [key, value] of Object.entries(metadata)) {
    if (wantedSet.has(normalizeText(key))) {
      const parsed = toNumber(value);
      if (parsed !== 0 || value === 0 || value === "0") {
        return parsed;
      }
    }
  }

  return 0;
}

function getMetadataText(
  metadata: Record<string, unknown> | null | undefined,
  aliases: string[]
): string {
  if (!metadata) return "";

  const wantedSet = new Set(aliases.map((alias) => normalizeText(alias)));

  for (const [key, value] of Object.entries(metadata)) {
    if (wantedSet.has(normalizeText(key))) {
      return normalizeText(value);
    }
  }

  return "";
}

function isSrccRestricted(metadata: Record<string, unknown> | null | undefined): boolean {
  const restr = getMetadataText(metadata, [
    "RESTRICAO SRCC",
    "RESTRIÇÃO SRCC",
  ]);

  if (!restr) return false;
  if (restr === "SIM") return true;
  if (restr.includes("RESTRIT")) return true;
  return false;
}

function getYearMonthCode(year: number, month: number): number {
  return year * 100 + month;
}

function isMetaRegime(year: number, month: number): boolean {
  const code = getYearMonthCode(year, month);
  return META_RANGES.some((range) => code >= range.from && code <= range.to);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---- Tipos públicos -------------------------------------------------------

export type CashAuditDivergence =
  | "NONE"
  | "INTERNAL_DIVERGENCE"
  | "PROBABLY_WRONG_BRACKET"
  | "WRONG_BRACKET"
  | "OTHER";

export type CashAuditResult = {
  contractNumber: string;
  companyCnpj: string;
  year: number;
  month: number;
  valorLiquido: number;
  valorBruto: number;
  pctTabelaOpp: number;
  pctAVistaPago: number;
  pctAVistaEsperado: number;
  capRegime: number;
  comissaoPaga: number;
  comissaoEsperada: number;
  divergence: CashAuditDivergence;
  recuperavel: number;
  note?: string;
};

export type CashAuditSummary = {
  totalContracts: number;
  totalSrccExcluded: number;
  totalRecuperavel: number;
  productionValue: number;
  byDivergence: Record<CashAuditDivergence, number>;
  recuperavelByDivergence: Record<CashAuditDivergence, number>;
  policy: ResolvedCashPolicy;
  isMetaRegime: boolean;
};

export type CashAuditPayload = {
  year: number;
  month: number;
  results: CashAuditResult[];
  summary: CashAuditSummary;
};

type CashEntryRow = {
  id: string;
  company_cnpj: string;
  year: number;
  month: number;
  contract_number: string | null;
  net_value: number | null;
  gross_value: number | null;
  commission_value: number | null;
  metadata: Record<string, unknown> | null;
};

// ---- Núcleo do motor ------------------------------------------------------

export type AuditCashEntryContext = {
  year: number;
  month: number;
  productionValue: number;
  policy: ResolvedCashPolicy;
};

export function auditCashEntry(
  entry: CashEntryRow,
  context: AuditCashEntryContext
): CashAuditResult {
  const metadata = entry.metadata || {};
  const valorLiquido = toNumber(entry.net_value);
  const valorBruto = toNumber(entry.gross_value);
  const comissaoPaga = toNumber(entry.commission_value);
  const pctAVistaPago = normalizePercent(
    getMetadataNumber(metadata, ["% A VISTA", "% AVISTA", "PERCENTUAL A VISTA"])
  );
  const pctTabelaOpp = normalizePercent(
    getMetadataNumber(metadata, [
      "% TABELA OPP",
      "PERCENTUAL TABELA OPP",
      "% TABELA",
    ])
  );

  const baseResult: CashAuditResult = {
    contractNumber: String(entry.contract_number || "").trim(),
    companyCnpj: String(entry.company_cnpj || "").trim(),
    year: entry.year,
    month: entry.month,
    valorLiquido,
    valorBruto,
    pctTabelaOpp,
    pctAVistaPago,
    pctAVistaEsperado: 0,
    capRegime: context.policy.percent,
    comissaoPaga,
    comissaoEsperada: 0,
    divergence: "NONE",
    recuperavel: 0,
  };

  if (isSrccRestricted(metadata)) {
    return {
      ...baseResult,
      pctAVistaEsperado: pctAVistaPago,
      comissaoEsperada: comissaoPaga,
      divergence: "NONE",
      recuperavel: 0,
      note: "SRCC excluida",
    };
  }

  if (valorLiquido <= 0) {
    return {
      ...baseResult,
      divergence: "OTHER",
      recuperavel: 0,
      note: "valor_liquido <= 0",
    };
  }

  const cap = context.policy.percent;
  const pctAVistaEsperado =
    pctTabelaOpp > 0 ? Math.min(pctTabelaOpp, cap) : cap;

  const comissaoEsperada = roundMoney(valorLiquido * pctAVistaEsperado);
  const recuperavel = roundMoney(comissaoEsperada - comissaoPaga);

  let divergence: CashAuditDivergence = "NONE";
  let note: string | undefined;

  if (Math.abs(pctAVistaPago - pctAVistaEsperado) < PERCENT_TOLERANCE) {
    divergence = "NONE";
  } else if (isMetaRegime(entry.year, entry.month)) {
    const inAuditList = META_AUDIT_PERCENTS.some(
      (allowed) => Math.abs(pctAVistaPago - allowed) < PERCENT_TOLERANCE
    );

    if (!inAuditList) {
      divergence = "INTERNAL_DIVERGENCE";
      note =
        "META: pct_a_vista fora das tabelas permitidas (5,40 / 5,60 / 5,80 / 6,00)";
    } else {
      divergence = "PROBABLY_WRONG_BRACKET";
      note =
        "META: pct_a_vista bate com alguma tabela do regime, mas nao com a esperada (3.2.A.2 ira refinar)";
    }
  } else {
    divergence = "INTERNAL_DIVERGENCE";
    note = `pct_a_vista (${pctAVistaPago}) != esperado (${pctAVistaEsperado})`;
  }

  return {
    ...baseResult,
    pctAVistaEsperado,
    comissaoEsperada,
    divergence,
    recuperavel,
    note,
  };
}

// ---- Loader e orquestrador -----------------------------------------------

function emptyDivergenceMap(): Record<CashAuditDivergence, number> {
  return {
    NONE: 0,
    INTERNAL_DIVERGENCE: 0,
    PROBABLY_WRONG_BRACKET: 0,
    WRONG_BRACKET: 0,
    OTHER: 0,
  };
}

export async function auditCashEntriesForMonth(
  year: number,
  month: number
): Promise<CashAuditPayload> {
  const supabaseAdmin = getSupabaseAdmin();
  const knownCnpjSet = new Set<string>();
  for (const company of Object.values(KNOWN_COMPANIES_BY_CNPJ)) {
    knownCnpjSet.add(company.empresaCnpj);
    knownCnpjSet.add(`TEMP-${company.mci}-${company.coban}`);
  }

  // Não filtramos company_cnpj na query — a base só carrega os 4 CNPJs do
  // grupo, e usar `.in()` aqui derruba o índice (year, month) e dá timeout.
  // A filtragem por CNPJ conhecido é feita localmente.
  const rawRows = await fetchAllRows<CashEntryRow>(() =>
    supabaseAdmin
      .from("monthly_closing_entries")
      .select(
        "id, company_cnpj, year, month, contract_number, net_value, gross_value, commission_value, metadata"
      )
      .eq("entry_type", "CASH")
      .eq("year", year)
      .eq("month", month)
      .order("id", { ascending: true })
  );

  const rows = rawRows.filter((row) =>
    knownCnpjSet.has(String(row.company_cnpj || "").trim())
  );

  let productionValue = 0;
  let totalSrccExcluded = 0;

  for (const row of rows) {
    if (isSrccRestricted(row.metadata)) {
      totalSrccExcluded += 1;
      continue;
    }
    productionValue += toNumber(row.net_value);
  }

  productionValue = roundMoney(productionValue);

  const policy = resolvePromotivaCashPolicy({
    productionValue,
    reference_date: `${year}-${String(month).padStart(2, "0")}-01`,
  });

  const context: AuditCashEntryContext = {
    year,
    month,
    productionValue,
    policy,
  };

  const results = rows.map((row) => auditCashEntry(row, context));

  const byDivergence = emptyDivergenceMap();
  const recuperavelByDivergence = emptyDivergenceMap();
  let totalRecuperavel = 0;
  let totalContracts = 0;

  for (const result of results) {
    if (result.note === "SRCC excluida") continue;

    totalContracts += 1;
    byDivergence[result.divergence] += 1;
    recuperavelByDivergence[result.divergence] = roundMoney(
      recuperavelByDivergence[result.divergence] + result.recuperavel
    );
    totalRecuperavel += result.recuperavel;
  }

  totalRecuperavel = roundMoney(totalRecuperavel);

  return {
    year,
    month,
    results,
    summary: {
      totalContracts,
      totalSrccExcluded,
      totalRecuperavel,
      productionValue,
      byDivergence,
      recuperavelByDivergence,
      policy,
      isMetaRegime: isMetaRegime(year, month),
    },
  };
}

// ===========================================================================
// AUDITORIA PRT — sub-etapa 3.2.A.3
// ===========================================================================

const SUSPICIOUS_AGE_THRESHOLD_MONTHS = 12;

// ---- Tipos públicos PRT ---------------------------------------------------

export type DebitType = "LIQUIDACAO" | "CANCELAMENTO" | "RENOVACAO" | "OUTRO";

export type ParsedDebitDescription = {
  tipo: DebitType;
  operationNumber: string | null;
};

export type DebitInfo = {
  tipo: DebitType;
  year: number;
  month: number;
};

export type PrtEntryStatus = "PAID" | "LISTED_NOT_PAID";

export type PrtEntryAudit = {
  operationNumber: string;
  companyCnpj: string;
  year: number;
  month: number;
  comissaoPaga: number;
  comissaoListada: number;
  codEst: number;
  parcelasPagas: number;
  parcelasTotal: number;
  status: PrtEntryStatus;
};

export type ContractPrtStatus =
  | "OK"
  | "OK_DEBITADO"
  | "INTERROMPIDO_SUSPEITO"
  | "INTERROMPIDO_LEGITIMO"
  | "NUNCA_PAGO"
  | "AUSENTE";

export type ContractPrtAudit = {
  operationNumber: string;
  companyCnpj: string;
  dataContratacao: Date | null;
  parcelasTotal: number;
  parcelasPagas: number;
  primeiroMesPago: { year: number; month: number } | null;
  ultimoMesPago: { year: number; month: number } | null;
  ultimoMesListado: { year: number; month: number } | null;
  status: ContractPrtStatus;
  debitInfo: DebitInfo | null;
  idadeAteUltimoMesPago: number;
  totalPago: number;
  totalListadoNaoPago: number;
  recuperavelEstimado: number;
  observations: string[];
};

type PrtRow = {
  id: string;
  company_cnpj: string;
  year: number;
  month: number;
  operation_number: string | null;
  contract_number: string | null;
  commission_value: number | null;
  metadata: Record<string, unknown> | null;
};

type DebitRow = {
  id: string;
  company_cnpj: string;
  year: number;
  month: number;
  metadata: Record<string, unknown> | null;
};

// ---- Helpers PRT ----------------------------------------------------------

function parseBrazilianDate(value: unknown): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }
  const m2 = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) {
    return new Date(Date.UTC(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3])));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  // Excel epoch 1899-12-30 (compensa o bug do 1900 sendo bissexto)
  const ms = (serial - 25569) * 86400 * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffInMonths(from: Date, to: Date): number {
  const years = to.getUTCFullYear() - from.getUTCFullYear();
  const months = to.getUTCMonth() - from.getUTCMonth();
  return years * 12 + months;
}

function periodToCode(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function codeToPeriod(code: number): { year: number; month: number } {
  return {
    year: Math.floor(code / 12),
    month: (code % 12) + 1,
  };
}

function comparePeriod(
  a: { year: number; month: number },
  b: { year: number; month: number }
): number {
  return periodToCode(a.year, a.month) - periodToCode(b.year, b.month);
}

// ---- Função 1: parseDebitDescription -------------------------------------

export function parseDebitDescription(descricao: string): ParsedDebitDescription {
  const text = String(descricao || "").trim();
  if (!text) {
    return { tipo: "OUTRO", operationNumber: null };
  }

  const norm = normalizeText(text);

  let tipo: DebitType = "OUTRO";
  if (norm.includes("LIQUIDAC")) {
    tipo = "LIQUIDACAO";
  } else if (norm.includes("CANCELAMENT") || norm.includes("CANCEL")) {
    tipo = "CANCELAMENTO";
  } else if (norm.includes("RENOVAC")) {
    tipo = "RENOVACAO";
  }

  // Extrai primeiro número com pelo menos 8 dígitos
  const match = text.match(/\b(\d{8,})\b/);
  const operationNumber = match ? match[1] : null;

  return { tipo, operationNumber };
}

// ---- Função 2: auditPrtEntry ---------------------------------------------

export function auditPrtEntry(entry: PrtRow): PrtEntryAudit {
  const metadata = entry.metadata || {};
  const codEst = Math.trunc(
    getMetadataNumber(metadata, ["COD EST", "CODIGO EST", "CODIGO ESTORNO"])
  );
  const parcelasPagas = Math.trunc(
    getMetadataNumber(metadata, [
      "QTD PARCELAS PGS",
      "QTD PARCELAS PAGAS",
      "PARCELAS PAGAS",
    ])
  );
  const parcelasTotal = Math.trunc(
    getMetadataNumber(metadata, [
      "QTD PARCELAS TOTAL",
      "QTD PARCELAS TOTAIS",
      "PARCELAS TOTAL",
      "PARCELAS TOTAIS",
    ])
  );
  const comissaoListada = toNumber(
    getMetadataNumber(metadata, ["COMISSAO", "COMISSÃO"]) ||
      entry.commission_value
  );

  const isPaid = codEst === 1;

  return {
    operationNumber: String(entry.operation_number || "").trim(),
    companyCnpj: String(entry.company_cnpj || "").trim(),
    year: entry.year,
    month: entry.month,
    comissaoPaga: isPaid ? comissaoListada : 0,
    comissaoListada,
    codEst,
    parcelasPagas,
    parcelasTotal,
    status: isPaid ? "PAID" : "LISTED_NOT_PAID",
  };
}

// ---- Função 3: auditPrtForContract ---------------------------------------

type CashContractContext = {
  dataContratacao: Date | null;
  valorBruto: number;
  parcelasTotal: number;
};

function readContractDate(meta: Record<string, unknown>): Date | null {
  // 1) Tenta string DD/MM/AAAA / ISO via getMetadataText
  const txt = getMetadataText(meta, ["DATA CONTRATACAO", "DATA CONTRATAÇÃO"]);
  if (txt) {
    const fromText = parseBrazilianDate(txt);
    if (fromText && !Number.isNaN(fromText.getTime())) {
      // Sanity: ano entre 2000-2100
      const y = fromText.getUTCFullYear();
      if (y >= 2000 && y <= 2100) return fromText;
    }
  }
  // 2) Tenta valor numérico (Excel serial) lendo direto sem normalização
  for (const [k, v] of Object.entries(meta)) {
    const nk = normalizeText(k);
    if (nk === "DATA CONTRATACAO") {
      if (typeof v === "number") {
        const d = excelSerialToDate(v);
        if (d) {
          const y = d.getUTCFullYear();
          if (y >= 2000 && y <= 2100) return d;
        }
      }
    }
  }
  return null;
}

function getCashContractContext(
  cashEntry: CashEntryRow | null
): CashContractContext {
  if (!cashEntry) {
    return { dataContratacao: null, valorBruto: 0, parcelasTotal: 0 };
  }
  const meta = cashEntry.metadata || {};
  const dt =
    readContractDate(meta) ||
    parseBrazilianDate((cashEntry as any).operation_date);
  const valorBruto =
    toNumber(cashEntry.gross_value) ||
    getMetadataNumber(meta, ["VALOR BRUTO"]);
  const parcelas = Math.trunc(
    getMetadataNumber(meta, ["PARCELA", "PARCELAS", "QTD PARCELAS"])
  );
  return {
    dataContratacao: dt,
    valorBruto,
    parcelasTotal: parcelas,
  };
}

export function auditPrtForContract(
  operationNumber: string,
  companyCnpj: string,
  allEntriesOfContract: PrtRow[],
  cashEntry: CashEntryRow | null,
  debitMap: Map<string, DebitInfo>,
  refPeriod: { year: number; month: number }
): ContractPrtAudit {
  const observations: string[] = [];
  const cash = getCashContractContext(cashEntry);
  const audits = allEntriesOfContract.map(auditPrtEntry);

  // ordena por (year, month)
  const sorted = [...audits].sort((a, b) =>
    comparePeriod({ year: a.year, month: a.month }, { year: b.year, month: b.month })
  );

  const paid = sorted.filter((a) => a.status === "PAID");
  const listedNotPaid = sorted.filter((a) => a.status === "LISTED_NOT_PAID");

  const primeiroMesPago = paid[0]
    ? { year: paid[0].year, month: paid[0].month }
    : null;
  const ultimoMesPago = paid.length
    ? { year: paid[paid.length - 1].year, month: paid[paid.length - 1].month }
    : null;
  const ultimoMesListado = sorted.length
    ? {
        year: sorted[sorted.length - 1].year,
        month: sorted[sorted.length - 1].month,
      }
    : null;

  const totalPago = paid.reduce((s, a) => s + a.comissaoPaga, 0);
  const totalListadoNaoPago = listedNotPaid.reduce(
    (s, a) => s + a.comissaoListada,
    0
  );

  const parcelasTotal =
    Math.max(...sorted.map((a) => a.parcelasTotal), cash.parcelasTotal) || 0;
  const parcelasPagas = paid.length;

  // Idade até o último mês pago (em meses, a partir de dataContratacao se houver)
  let idadeAteUltimoMesPago = 0;
  if (cash.dataContratacao && ultimoMesPago) {
    const ultimoDate = new Date(
      Date.UTC(ultimoMesPago.year, ultimoMesPago.month - 1, 1)
    );
    idadeAteUltimoMesPago = Math.max(
      diffInMonths(cash.dataContratacao, ultimoDate),
      0
    );
  } else if (paid.length >= 1 && primeiroMesPago && ultimoMesPago) {
    // fallback: distancia entre primeiro e último mês pago
    idadeAteUltimoMesPago = diffInMonths(
      new Date(Date.UTC(primeiroMesPago.year, primeiroMesPago.month - 1, 1)),
      new Date(Date.UTC(ultimoMesPago.year, ultimoMesPago.month - 1, 1))
    );
  }

  // ---- Detecta status preliminar ----
  let status: ContractPrtStatus = "OK";

  // Idade do contrato até o refPeriod (em meses) — AUSENTE só se >= 2 meses
  // (PRT começa no 2º mês após CASH; menos do que isso, contrato é "novo").
  let idadeAteRef = 0;
  if (cash.dataContratacao) {
    const refDate = new Date(Date.UTC(refPeriod.year, refPeriod.month - 1, 1));
    idadeAteRef = Math.max(diffInMonths(cash.dataContratacao, refDate), 0);
  }

  if (sorted.length === 0) {
    // Nenhuma PRT entry — só CASH. AUSENTE só se contrato já deveria estar pagando.
    if (cash.parcelasTotal > 1 && idadeAteRef >= 2) {
      status = "AUSENTE";
    } else {
      status = "OK";
    }
  } else if (paid.length === 0) {
    // Tem entries mas nenhuma com cod_est=1
    status = "NUNCA_PAGO";
  } else {
    // Tem pagamentos. Verifica se interrompido antes do prazo.
    const expectedTotal = parcelasTotal > 0 ? parcelasTotal : 0;
    const interrupted =
      expectedTotal > 0 && parcelasPagas < expectedTotal && ultimoMesPago
        ? // Se ultimoMesPago < refPeriod — 1 (parou de pagar antes do mês de referência)
          comparePeriod(ultimoMesPago, refPeriod) < 0 &&
          // não conta como interrupção se o ultimoMesPago é do mês corrente
          parcelasPagas < expectedTotal
        : false;

    if (interrupted) {
      // Quantos meses esperaríamos ter pago até refPeriod?
      // Idade do contrato até último mês pago vs prazo total
      if (idadeAteUltimoMesPago < SUSPICIOUS_AGE_THRESHOLD_MONTHS) {
        status = "INTERROMPIDO_SUSPEITO";
      } else {
        status = "INTERROMPIDO_LEGITIMO";
      }
    } else {
      status = "OK";
    }
  }

  // ---- Cruzamento com débito (apenas para INTERROMPIDO_SUSPEITO ou AUSENTE) ----
  let debitInfo: DebitInfo | null = null;
  const debitFromMap = debitMap.get(`${companyCnpj}::${operationNumber}`) ||
    debitMap.get(operationNumber) ||
    null;

  if (
    debitFromMap &&
    (status === "INTERROMPIDO_SUSPEITO" || status === "AUSENTE")
  ) {
    debitInfo = debitFromMap;
    status = "OK_DEBITADO";
    observations.push(
      `Justificado por débito ${debitFromMap.tipo} em ${String(
        debitFromMap.month
      ).padStart(2, "0")}/${debitFromMap.year}`
    );
  } else if (debitFromMap) {
    // Anexa info pra rastreabilidade mas não muda status
    debitInfo = debitFromMap;
    observations.push(
      `Débito ${debitFromMap.tipo} encontrado em ${String(
        debitFromMap.month
      ).padStart(2, "0")}/${debitFromMap.year} (não reclassifica ${status})`
    );
  }

  // ---- Recuperável estimado ----
  let recuperavelEstimado = 0;
  if (status === "INTERROMPIDO_SUSPEITO") {
    const comissaoMedia = paid.length > 0 ? totalPago / paid.length : 0;
    const mesesRestantes = Math.max(parcelasTotal - parcelasPagas, 0);
    recuperavelEstimado = roundMoney(comissaoMedia * mesesRestantes);
  } else if (status === "NUNCA_PAGO") {
    recuperavelEstimado = roundMoney(totalListadoNaoPago);
  } else if (status === "AUSENTE") {
    // valorBruto * (mesesEsperados / mesesTotal) com fator conservador 0.001
    // (sem comissão média histórica, usa fração proporcional sobre comissão de
    // referência conservadora). Para não inventar — se cash valor_bruto>0 e
    // parcelas>0, estimamos um piso baseado em 0.1% do valor_bruto * meses
    // contados como "não pagos" até refPeriod.
    if (cash.dataContratacao && cash.valorBruto > 0 && parcelasTotal > 0) {
      const refDate = new Date(
        Date.UTC(refPeriod.year, refPeriod.month - 1, 1)
      );
      const mesesDecorridos = Math.max(
        Math.min(
          diffInMonths(cash.dataContratacao, refDate),
          parcelasTotal
        ),
        0
      );
      // Fração da comissão estimada (proporcional a mesesDecorridos/parcelasTotal)
      // Sem histórico de comissão, estimativa baseada em 0.1% do bruto por parcela.
      const estimativaPorParcela = cash.valorBruto * 0.001;
      recuperavelEstimado = roundMoney(estimativaPorParcela * mesesDecorridos);
    }
  } else if (status === "INTERROMPIDO_LEGITIMO") {
    recuperavelEstimado = 0;
  }

  return {
    operationNumber,
    companyCnpj,
    dataContratacao: cash.dataContratacao,
    parcelasTotal,
    parcelasPagas,
    primeiroMesPago,
    ultimoMesPago,
    ultimoMesListado,
    status,
    debitInfo,
    idadeAteUltimoMesPago,
    totalPago: roundMoney(totalPago),
    totalListadoNaoPago: roundMoney(totalListadoNaoPago),
    recuperavelEstimado,
    observations,
  };
}

// ---- Função 4: auditPrtForMonth ------------------------------------------

export type PrtMonthSummary = {
  totalContractsAuditados: number;
  byStatus: Record<ContractPrtStatus, number>;
  recuperavelByStatus: Record<ContractPrtStatus, number>;
  totalRecuperavel: number;
  debitsApplied: number;
  totalDebitsParsed: number;
};

export type PrtMonthPayload = {
  year: number;
  month: number;
  results: ContractPrtAudit[];
  summary: PrtMonthSummary;
};

function emptyStatusMap(): Record<ContractPrtStatus, number> {
  return {
    OK: 0,
    OK_DEBITADO: 0,
    INTERROMPIDO_SUSPEITO: 0,
    INTERROMPIDO_LEGITIMO: 0,
    NUNCA_PAGO: 0,
    AUSENTE: 0,
  };
}

function knownCnpjFilterSet(): Set<string> {
  const set = new Set<string>();
  for (const company of Object.values(KNOWN_COMPANIES_BY_CNPJ)) {
    set.add(company.empresaCnpj);
    set.add(`TEMP-${company.mci}-${company.coban}`);
  }
  return set;
}

export async function auditPrtForMonth(
  year: number,
  month: number
): Promise<PrtMonthPayload> {
  const supabaseAdmin = getSupabaseAdmin();
  const knownSet = knownCnpjFilterSet();

  const refPeriod = { year, month };
  const refCode = year * 12 + (month - 1);
  const startCode = 2022 * 12 + (12 - 1); // dez/22

  // ----- Helpers de carga paralela mês-a-mês -----
  const monthCodes: Array<{ y: number; m: number }> = [];
  for (let code = startCode; code <= refCode; code++) {
    monthCodes.push({ y: Math.floor(code / 12), m: (code % 12) + 1 });
  }

  async function loadAllMonths<T>(
    builder: (y: number, m: number) => any
  ): Promise<T[]> {
    const all: T[] = [];
    const concurrency = 2;
    async function loadOne(y: number, m: number, retries = 4): Promise<T[]> {
      try {
        return await fetchAllRows<T>(() => builder(y, m));
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (
          retries > 0 &&
          (msg.includes("statement timeout") ||
            msg.includes("canceling statement") ||
            msg.includes("ECONNRESET"))
        ) {
          // Backoff progressivo: 2s, 4s, 6s, 8s
          const delay = (5 - retries) * 2000;
          await new Promise((res) => setTimeout(res, delay));
          return loadOne(y, m, retries - 1);
        }
        throw e;
      }
    }
    for (let i = 0; i < monthCodes.length; i += concurrency) {
      const batch = monthCodes.slice(i, i + concurrency);
      const chunks = await Promise.all(
        batch.map(({ y, m }) => loadOne(y, m))
      );
      for (const c of chunks) all.push(...c);
    }
    return all;
  }

  // ----- 1) PRT histórico completo (todos meses até ref), filtrado por CNPJ -----
  const prtRowsAllRaw = await loadAllMonths<PrtRow>((y, m) =>
    supabaseAdmin
      .from("monthly_closing_entries")
      .select(
        "id, company_cnpj, year, month, operation_number, contract_number, commission_value, metadata"
      )
      .eq("entry_type", "PRT")
      .eq("year", y)
      .eq("month", m)
      .order("id", { ascending: true })
  );
  const prtRowsAll = prtRowsAllRaw.filter((r) =>
    knownSet.has(String(r.company_cnpj || "").trim())
  );

  // Conjunto de operation_numbers que aparecem em PRT no mês ref (driver do escopo)
  const opsInRefMonth = new Set<string>();
  for (const r of prtRowsAll) {
    if (r.year !== year || r.month !== month) continue;
    const op = String(r.operation_number || "").trim();
    if (op) opsInRefMonth.add(op);
  }

  // ----- 2) CASH histórico completo (todos meses até ref), filtrado por CNPJ -----
  const cashRowsAllRaw = await loadAllMonths<CashEntryRow>((y, m) =>
    supabaseAdmin
      .from("monthly_closing_entries")
      .select(
        "id, company_cnpj, year, month, contract_number, net_value, gross_value, commission_value, metadata"
      )
      .eq("entry_type", "CASH")
      .eq("year", y)
      .eq("month", m)
      .order("id", { ascending: true })
  );
  const cashRowsAll = cashRowsAllRaw.filter((r) =>
    knownSet.has(String(r.company_cnpj || "").trim())
  );

  // Mapa cnpj::contract_number -> CASH (versão mais antiga vence)
  const cashByContract = new Map<string, CashEntryRow>();
  for (const c of cashRowsAll) {
    const cnpj = String(c.company_cnpj || "").trim();
    const ct = String(c.contract_number || "").trim();
    if (!ct) continue;
    const key = `${cnpj}::${ct}`;
    const prev = cashByContract.get(key);
    if (!prev) {
      cashByContract.set(key, c);
    } else if (
      comparePeriod(
        { year: c.year, month: c.month },
        { year: prev.year, month: prev.month }
      ) < 0
    ) {
      cashByContract.set(key, c);
    }
  }

  // CASH do mês ref (recém-contratados — entrarão no escopo como OK ou AUSENTE>=2m)
  const cashRowsRefMonth = cashRowsAll.filter(
    (c) => c.year === year && c.month === month
  );

  // ----- 3) DEBIT histórico (todos meses até ref) -----
  const debitRowsAllRaw = await loadAllMonths<DebitRow>((y, m) =>
    supabaseAdmin
      .from("monthly_closing_entries")
      .select("id, company_cnpj, year, month, metadata")
      .eq("entry_type", "DEBIT")
      .eq("year", y)
      .eq("month", m)
      .order("id", { ascending: true })
  );
  const debitMap = new Map<string, DebitInfo>();
  let totalDebitsParsed = 0;
  for (const r of debitRowsAllRaw) {
    const cnpj = String(r.company_cnpj || "").trim();
    if (!knownSet.has(cnpj)) continue;
    const desc = getMetadataText(r.metadata, [
      "DESCRICAO",
      "DESCRIÇÃO",
      "DESC",
      "HISTORICO",
      "HISTÓRICO",
    ]);
    if (!desc) continue;
    const parsed = parseDebitDescription(desc);
    totalDebitsParsed += 1;
    if (
      parsed.operationNumber &&
      (parsed.tipo === "LIQUIDACAO" ||
        parsed.tipo === "CANCELAMENTO" ||
        parsed.tipo === "RENOVACAO")
    ) {
      const keyCnpj = `${cnpj}::${parsed.operationNumber}`;
      const debitInfo = { tipo: parsed.tipo, year: r.year, month: r.month };
      const prevCnpj = debitMap.get(keyCnpj);
      if (
        !prevCnpj ||
        comparePeriod(
          { year: r.year, month: r.month },
          { year: prevCnpj.year, month: prevCnpj.month }
        ) < 0
      ) {
        debitMap.set(keyCnpj, debitInfo);
      }
      const prevOp = debitMap.get(parsed.operationNumber);
      if (
        !prevOp ||
        comparePeriod(
          { year: r.year, month: r.month },
          { year: prevOp.year, month: prevOp.month }
        ) < 0
      ) {
        debitMap.set(parsed.operationNumber, debitInfo);
      }
    }
  }

  // ----- 4) Agrupa PRT por (cnpj::op) -----
  const prtByContract = new Map<string, PrtRow[]>();
  for (const r of prtRowsAll) {
    const key = `${String(r.company_cnpj || "").trim()}::${String(
      r.operation_number || ""
    ).trim()}`;
    const bucket = prtByContract.get(key) || [];
    bucket.push(r);
    prtByContract.set(key, bucket);
  }

  // ----- 5) Define escopo de auditoria -----
  // Driver: união de
  //  (a) cnpj::op com PRT no mês ref
  //  (b) cnpj::contract_number com CASH no mês ref
  //  (c) cnpj::op com débito no mês ref
  const scopeKeys = new Set<string>();

  for (const r of prtRowsAll) {
    if (r.year !== year || r.month !== month) continue;
    const cnpj = String(r.company_cnpj || "").trim();
    const op = String(r.operation_number || "").trim();
    if (op) scopeKeys.add(`${cnpj}::${op}`);
  }
  for (const c of cashRowsRefMonth) {
    const cnpj = String(c.company_cnpj || "").trim();
    const op = String(c.contract_number || "").trim();
    if (op) scopeKeys.add(`${cnpj}::${op}`);
  }
  for (const r of debitRowsAllRaw) {
    if (r.year !== year || r.month !== month) continue;
    const cnpj = String(r.company_cnpj || "").trim();
    if (!knownSet.has(cnpj)) continue;
    const desc = getMetadataText(r.metadata, [
      "DESCRICAO",
      "DESCRIÇÃO",
      "DESC",
      "HISTORICO",
      "HISTÓRICO",
    ]);
    const parsed = parseDebitDescription(desc);
    if (parsed.operationNumber) {
      scopeKeys.add(`${cnpj}::${parsed.operationNumber}`);
    }
  }

  // ----- 6) Audita cada contrato no escopo -----
  const results: ContractPrtAudit[] = [];
  for (const key of scopeKeys) {
    const [cnpj, op] = key.split("::");
    if (!op) continue;
    const entries = prtByContract.get(key) || [];
    const cash = cashByContract.get(key) || null;
    const audit = auditPrtForContract(
      op,
      cnpj,
      entries,
      cash,
      debitMap,
      refPeriod
    );
    results.push(audit);
  }

  // ----- 7) Filtra "atividade no mês" -----
  const filtered = results.filter((r) => {
    // PRT entry no mês?
    const hasPrtInMonth =
      r.ultimoMesListado &&
      r.ultimoMesListado.year === year &&
      r.ultimoMesListado.month === month;
    // Débito do mês?
    const debitInMonth =
      r.debitInfo && r.debitInfo.year === year && r.debitInfo.month === month;
    // Problema afetando o mês
    const hasProblem =
      r.status === "INTERROMPIDO_SUSPEITO" ||
      r.status === "INTERROMPIDO_LEGITIMO" ||
      r.status === "NUNCA_PAGO" ||
      r.status === "AUSENTE" ||
      r.status === "OK_DEBITADO";
    return hasPrtInMonth || debitInMonth || hasProblem || r.status === "OK";
  });

  // Sumariza
  const byStatus = emptyStatusMap();
  const recuperavelByStatus = emptyStatusMap();
  let totalRecuperavel = 0;
  let debitsApplied = 0;
  for (const r of filtered) {
    byStatus[r.status] += 1;
    recuperavelByStatus[r.status] = roundMoney(
      recuperavelByStatus[r.status] + r.recuperavelEstimado
    );
    totalRecuperavel += r.recuperavelEstimado;
    if (r.status === "OK_DEBITADO") debitsApplied += 1;
  }
  totalRecuperavel = roundMoney(totalRecuperavel);

  return {
    year,
    month,
    results: filtered,
    summary: {
      totalContractsAuditados: filtered.length,
      byStatus,
      recuperavelByStatus,
      totalRecuperavel,
      debitsApplied,
      totalDebitsParsed,
    },
  };
}

// re-export para satisfazer dynamic import na validação
export { excelSerialToDate as __excelSerialToDate };
