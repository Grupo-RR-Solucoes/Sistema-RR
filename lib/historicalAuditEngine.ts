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
