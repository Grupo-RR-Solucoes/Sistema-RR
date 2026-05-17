import type { SupabaseClient } from "@supabase/supabase-js";

import { calcularOperacao } from "@/lib/motor";
import { getCompanyDisplayIdentity } from "@/lib/knownCompanies";
import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import { fetchAllRows } from "@/lib/queryHelpers";

const MONTH_NAMES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

type CompanyRow = {
  id: string;
  cnpj: string;
  name: string;
};

type ActualClosingRow = {
  empresa_cnpj: string;
  ano: number;
  mes: number;
  valor_avista?: number | null;
  valor_diferido?: number | null;
  valor_seguro?: number | null;
  valor_estorno?: number | null;
  valor_renovacao?: number | null;
  valor_liquido?: number | null;
  operacoes?: number | null;
};

type StoredExpectedRow = {
  company_id: string;
  year: number;
  month: number;
  gross_production?: number | null;
  net_valid_production?: number | null;
  expected_cash_commission?: number | null;
  expected_insurance_commission?: number | null;
  expected_prt_commission?: number | null;
  expected_total?: number | null;
};

type ProductionRow = {
  company_id?: string | null;
  status?: string | null;
  product_code?: string | null;
  product_description?: string | null;
  convenio_code?: string | null;
  convenio_type?: string | null;
  convenio_segment?: string | null;
  net_value?: number | null;
  gross_value?: number | null;
  insurance_value?: number | null;
  insurance_type?: string | null;
  insurance_commission_amount?: number | null;
  company_received_percent?: number | null;
  interest_rate?: number | null;
  term_months?: number | null;
  installments?: number | null;
  has_insurance?: boolean | null;
  is_srcc_restricted?: boolean | null;
  movement_date?: string | null;
  contract_date?: string | null;
  proposal_date?: string | null;
};

type DeferredOperationRow = {
  empresa_cnpj?: string | null;
  data_referencia?: string | null;
};

type DeferredRow = {
  valor?: number | null;
  status?: string | null;
  data_prevista?: string | null;
  operacao?: DeferredOperationRow | DeferredOperationRow[] | null;
};

type HistoricalPrtEntryRow = {
  company_cnpj?: string | null;
  year: number;
  month: number;
  operation_number?: string | null;
  contract_number?: string | null;
  commission_value?: number | null;
  metadata?: Record<string, unknown> | null;
};

type HistoricalCashEntryRow = {
  company_cnpj?: string | null;
  year: number;
  month: number;
  operation_number?: string | null;
  contract_number?: string | null;
  commission_value?: number | null;
  net_value?: number | null;
  metadata?: Record<string, unknown> | null;
};

type HistoricalAdjustmentEntryRow = {
  company_cnpj?: string | null;
  year: number;
  month: number;
  operation_number?: string | null;
  contract_number?: string | null;
  metadata?: Record<string, unknown> | null;
};

type DeferredPortfolioRow = {
  companyId?: string;
  cnpj: string;
  year: number;
  month: number;
  amount: number;
  status: string;
};

// Regra Promotiva/RR: producao contratada em fevereiro paga a vista em marco
// e inicia o PRT em abril, parcelado pelo prazo total do contrato.
const PRT_FIRST_PAYMENT_MONTH_OFFSET = 2;
const FALLBACK_PRT_CARRY_FORWARD_MONTHS = 120;

type ComputedExpectedAccumulator = {
  companyId: string;
  year: number;
  month: number;
  grossProduction: number;
  validProduction: number;
  insuredGrossProduction: number;
  operations: number;
  expectedCash: number;
  expectedPrt: number;
  expectedInsurance: number;
  expectedTotal: number;
  forecastedOperations: number;
  fullForecastOperations: number;
};

type MergedExpectedTotals = {
  grossProduction: number;
  validProduction: number;
  operations: number;
  insuredGrossProduction: number;
  forecastCoveragePercent: number;
  fullForecastCoveragePercent: number;
  expectedCash: number;
  expectedPrt: number;
  expectedInsurance: number;
  expectedTotal: number;
};

export type ClosingPeriodOption = {
  key: string;
  label: string;
  year: number;
  month: number;
};

export type ClosingCompanyAuditRow = {
  companyId?: string;
  empresa_cnpj: string;
  empresa_nome: string;
  year: number;
  month: number;
  grossProduction: number;
  validProduction: number;
  operations: number;
  insurancePenetrationPercent: number;
  forecastCoveragePercent: number;
  fullForecastCoveragePercent: number;
  expectedCash: number;
  expectedGeneratedPrt: number;
  expectedPrt: number;
  expectedInsurance: number;
  expectedTotal: number;
  actualCash: number;
  actualPrt: number;
  actualInsurance: number;
  actualEstorno: number;
  actualRenewal: number;
  actualNet: number;
  deltaCash: number;
  deltaPrt: number;
  deltaInsurance: number;
  deltaTotal: number;
};

export type ClosingSummary = {
  periodLabel: string;
  expectedCash: number;
  generatedPrt: number;
  expectedPrt: number;
  expectedInsurance: number;
  expectedTotal: number;
  actualCash: number;
  actualPrt: number;
  actualInsurance: number;
  actualEstorno: number;
  actualRenewal: number;
  actualNet: number;
  deltaTotal: number;
  grossProduction: number;
  validProduction: number;
  operations: number;
  companiesCount: number;
  insurancePenetrationPercent: number;
  forecastCoveragePercent: number;
  fullForecastCoveragePercent: number;
  futureDeferredBalance: number;
};

export type ClosingTrendPoint = {
  key: string;
  label: string;
  year: number;
  month: number;
  expectedTotal: number;
  actualNet: number;
  deltaTotal: number;
  expectedPrt: number;
  actualPrt: number;
};

export type ClosingHighlight = {
  empresa_nome: string;
  empresa_cnpj: string;
  deltaTotal: number;
  expectedTotal: number;
  actualNet: number;
};

export type ClosingAnalyticsPayload = {
  periods: ClosingPeriodOption[];
  selectedPeriod: ClosingPeriodOption | null;
  summary: ClosingSummary;
  companyRows: ClosingCompanyAuditRow[];
  trend: ClosingTrendPoint[];
  highlights: ClosingHighlight[];
  alerts: string[];
};

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const cleaned = value
      .replace(/R\$/gi, "")
      .replace(/%/g, "")
      .replace(/\s/g, "")
      .trim();
    const normalized =
      cleaned.includes(",")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned;
    const parsed = Number(normalized || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizePercent(value: unknown) {
  const parsed = toNumber(value);
  if (parsed <= 0) return 0;
  return parsed > 1 ? parsed / 100 : parsed;
}

function isValidProductionStatus(status: unknown) {
  const normalized = normalizeText(status);
  return normalized === "PRODUCAO" || normalized === "PRODUCTION";
}

function extractYearMonth(value: unknown) {
  if (!value) return null;

  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})/);

  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
    };
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function getPeriodKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getPeriodLabel(year: number, month: number) {
  return `${MONTH_NAMES[month - 1]}/${String(year).slice(-2)}`;
}

function comparePeriods(a: { year: number; month: number }, b: { year: number; month: number }) {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function getInsurancePercentByTerm(term: number) {
  if (term <= 36) return 0.0015;
  if (term <= 60) return 0.0025;
  if (term <= 84) return 0.004;
  return 0.0055;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function getCompanyPeriodKey(
  companyId: string | undefined,
  cnpj: string,
  year: number,
  month: number
) {
  return `${companyId || cnpj}::${getPeriodKey(year, month)}`;
}

function getProductionPeriod(row: ProductionRow) {
  return (
    getProductionPeriodFromValue(row.movement_date) ||
    getProductionPeriodFromValue(row.contract_date) ||
    getProductionPeriodFromValue(row.proposal_date)
  );
}

function isEligibleProductionRow(row: ProductionRow) {
  return isValidProductionStatus(row.status) && row.is_srcc_restricted !== true;
}

function getOperationTerm(row: ProductionRow) {
  return Math.max(
    Math.round(toNumber(row.term_months)),
    Math.round(toNumber(row.installments))
  );
}

function addMonthsToPeriod(year: number, month: number, monthsToAdd: number) {
  const date = new Date(Date.UTC(year, month - 1 + monthsToAdd, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function getDeferredOperation(row: DeferredRow) {
  if (Array.isArray(row.operacao)) {
    return row.operacao[0] || null;
  }

  return row.operacao || null;
}

function buildSyntheticDeferredPortfolioRows(params: {
  companyId: string;
  cnpj: string;
  year: number;
  month: number;
  expectedPrt: number;
  term: number;
}) {
  const { companyId, cnpj, year, month, expectedPrt, term } = params;

  if (!companyId || expectedPrt <= 0 || term <= 0) {
    return [] as DeferredPortfolioRow[];
  }

  const rows: DeferredPortfolioRow[] = [];
  const baseInstallment = roundMoney(expectedPrt / term);
  let allocated = 0;

  for (let index = 0; index < term; index += 1) {
    const duePeriod = addMonthsToPeriod(
      year,
      month,
      index + PRT_FIRST_PAYMENT_MONTH_OFFSET
    );
    const amount =
      index === term - 1
        ? roundMoney(Math.max(expectedPrt - allocated, 0))
        : baseInstallment;

    if (amount <= 0) {
      continue;
    }

    allocated += amount;

    rows.push({
      companyId,
      cnpj,
      year: duePeriod.year,
      month: duePeriod.month,
      amount,
      status: "ESTIMADO_PRT_PRODUCAO",
    });
  }

  return rows;
}

function buildDeferredPortfolioMap(rows: DeferredPortfolioRow[]) {
  const grouped = new Map<
    string,
    {
      fallback: number;
      detailed: number;
      generated: number;
    }
  >();

  for (const row of rows) {
    const key = getCompanyPeriodKey(row.companyId, row.cnpj, row.year, row.month);
    const current = grouped.get(key) || {
      fallback: 0,
      detailed: 0,
      generated: 0,
    };

    if (normalizeText(row.status) === "ESTIMADO_FECHAMENTO") {
      current.fallback += toNumber(row.amount);
    } else if (
      ["ESTIMADO_PRT_PRODUCAO", "ESTIMADO_PRT_AVISTA_FECHAMENTO"].includes(
        normalizeText(row.status)
      )
    ) {
      current.generated += toNumber(row.amount);
    } else {
      current.detailed += toNumber(row.amount);
    }

    grouped.set(key, current);
  }

  const map = new Map<string, number>();

  for (const [key, amounts] of grouped) {
    map.set(
      key,
      roundMoney(Math.max(amounts.fallback, amounts.detailed) + amounts.generated)
    );
  }

  return map;
}

function buildFallbackDeferredPortfolioRowsFromActualClosings(params: {
  rows: ActualClosingRow[];
  companyByCnpj: Map<string, CompanyRow>;
  companyByCanonicalCnpj: Map<string, CompanyRow>;
}) {
  const grouped = new Map<
    string,
    Array<{
      companyId?: string;
      cnpj: string;
      year: number;
      month: number;
      amount: number;
    }>
  >();

  for (const row of params.rows) {
    const amount = roundMoney(toNumber(row.valor_diferido));

    if (amount <= 0) {
      continue;
    }

    const identity = getCompanyDisplayIdentity({ cnpj: row.empresa_cnpj });
    const canonicalCnpj = identity.empresaCnpj || row.empresa_cnpj;
    const company =
      params.companyByCnpj.get(row.empresa_cnpj) ||
      params.companyByCanonicalCnpj.get(canonicalCnpj);
    const key = company?.id || canonicalCnpj;
    const bucket = grouped.get(key) || [];

    bucket.push({
      companyId: company?.id,
      cnpj: canonicalCnpj,
      year: row.ano,
      month: row.mes,
      amount,
    });
    grouped.set(key, bucket);
  }

  const rows: DeferredPortfolioRow[] = [];

  for (const bucket of grouped.values()) {
    const timeline = [...bucket].sort(comparePeriods);

    for (let index = 0; index < timeline.length; index += 1) {
      const current = timeline[index];
      const next = timeline[index + 1];

      for (
        let offset = 1;
        offset <= FALLBACK_PRT_CARRY_FORWARD_MONTHS;
        offset += 1
      ) {
        const duePeriod = addMonthsToPeriod(current.year, current.month, offset);

        if (
          next &&
          comparePeriods(duePeriod, { year: next.year, month: next.month }) >= 0
        ) {
          break;
        }

        rows.push({
          companyId: current.companyId,
          cnpj: current.cnpj,
          year: duePeriod.year,
          month: duePeriod.month,
          amount: current.amount,
          status: "ESTIMADO_FECHAMENTO",
        });
      }
    }
  }

  return rows;
}

function normalizeOperationId(value: unknown) {
  return normalizeText(value).replace(/\s+/g, "");
}

function getMetadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  aliases: string[]
) {
  if (!metadata) return 0;

  for (const alias of aliases) {
    const wanted = normalizeText(alias);
    const found = Object.entries(metadata).find(
      ([key]) => normalizeText(key) === wanted
    );

    if (found) {
      return toNumber(found[1]);
    }
  }

  return 0;
}

function getMetadataText(
  metadata: Record<string, unknown> | null | undefined,
  aliases: string[]
) {
  if (!metadata) return "";

  for (const alias of aliases) {
    const wanted = normalizeText(alias);
    const found = Object.entries(metadata).find(
      ([key]) => normalizeText(key) === wanted
    );

    if (found) {
      return normalizeText(found[1]);
    }
  }

  return "";
}

function getHistoricalCashEntryNetValue(row: HistoricalCashEntryRow) {
  return (
    toNumber(row.net_value) ||
    getMetadataNumber(row.metadata, [
      "VALOR LIQUIDO",
      "VALOR LÍQUIDO",
      "VALOR FINANCIADO LIQUIDO",
      "VALOR FINANCIADO LÍQUIDO",
    ])
  );
}

function getHistoricalCashEntryTerm(row: HistoricalCashEntryRow) {
  return Math.max(
    Math.round(
      getMetadataNumber(row.metadata, [
        "PARCELA",
        "PRAZO",
        "QTD PARCELAS TOTAL",
        "QTD PARCELAS TOTAIS",
      ])
    ),
    0
  );
}

function isHistoricalCashEntryEligible(row: HistoricalCashEntryRow) {
  const status = getMetadataText(row.metadata, [
    "STATUS COMISSAO PF",
    "STATUS COMISSÃO PF",
    "STATUS",
  ]);
  const srcc = getMetadataText(row.metadata, [
    "RESTRICAO SRCC",
    "RESTRIÇÃO SRCC",
  ]);

  if (status && !status.includes("FATURAR")) {
    return false;
  }

  return srcc !== "SIM";
}

function getHistoricalCashEntryDeferredTotal(row: HistoricalCashEntryRow) {
  const netValue = getHistoricalCashEntryNetValue(row);
  const totalPercent = normalizePercent(
    getMetadataNumber(row.metadata, [
      "% TABELA OPP",
      "PERCENTUAL TABELA OPP",
      "% TABELA",
    ])
  );
  const bonusPercent = normalizePercent(
    getMetadataNumber(row.metadata, ["% BONUS", "% BÔNUS", "% BONUS OPP"])
  );
  const cashPercent = normalizePercent(
    getMetadataNumber(row.metadata, [
      "% A VISTA",
      "% À VISTA",
      "% AVISTA",
      "PERCENTUAL A VISTA",
    ])
  );

  return roundMoney(netValue * Math.max(totalPercent + bonusPercent - cashPercent, 0));
}

function buildHistoricalDeferredPortfolioRowsFromCashEntries(params: {
  rows: HistoricalCashEntryRow[];
  companyByCnpj: Map<string, CompanyRow>;
  companyByCanonicalCnpj: Map<string, CompanyRow>;
  productionValueByCompanyPeriod: Map<string, number>;
}) {
  const aggregated = new Map<
    string,
    {
      companyId?: string;
      cnpj: string;
      year: number;
      month: number;
      amount: number;
    }
  >();

  for (const row of params.rows) {
    const rawCnpj = String(row.company_cnpj || "").trim();
    const identity = getCompanyDisplayIdentity({ cnpj: rawCnpj });
    const canonicalCnpj = identity.empresaCnpj || rawCnpj;
    const company =
      params.companyByCnpj.get(rawCnpj) ||
      params.companyByCanonicalCnpj.get(canonicalCnpj);
    const productionKey = `${company?.id || canonicalCnpj}::${getPeriodKey(
      row.year,
      row.month
    )}`;

    if (
      !canonicalCnpj ||
      !isHistoricalCashEntryEligible(row) ||
      params.productionValueByCompanyPeriod.has(productionKey)
    ) {
      continue;
    }

    const term = getHistoricalCashEntryTerm(row);
    const deferredTotal = getHistoricalCashEntryDeferredTotal(row);

    if (term <= 0 || deferredTotal <= 0) {
      continue;
    }

    const baseInstallment = roundMoney(deferredTotal / term);
    let allocated = 0;

    for (let index = 0; index < term; index += 1) {
      const duePeriod = addMonthsToPeriod(
        row.year,
        row.month,
        index + PRT_FIRST_PAYMENT_MONTH_OFFSET
      );
      const amount =
        index === term - 1
          ? roundMoney(Math.max(deferredTotal - allocated, 0))
          : baseInstallment;

      if (amount <= 0) {
        continue;
      }

      allocated += amount;

      const key = getCompanyPeriodKey(
        company?.id,
        canonicalCnpj,
        duePeriod.year,
        duePeriod.month
      );
      const current = aggregated.get(key) || {
        companyId: company?.id,
        cnpj: canonicalCnpj,
        year: duePeriod.year,
        month: duePeriod.month,
        amount: 0,
      };

      current.amount = roundMoney(current.amount + amount);
      aggregated.set(key, current);
    }
  }

  return Array.from(aggregated.values()).map((row) => ({
    ...row,
    status: "ESTIMADO_PRT_AVISTA_FECHAMENTO",
  })) satisfies DeferredPortfolioRow[];
}

function buildHistoricalDeferredPortfolioRowsFromPrtEntries(params: {
  rows: HistoricalPrtEntryRow[];
  companyByCnpj: Map<string, CompanyRow>;
  companyByCanonicalCnpj: Map<string, CompanyRow>;
  stopPeriodByOperation: Map<string, { year: number; month: number }>;
}) {
  const grouped = new Map<
    string,
    Array<{
      companyId?: string;
      cnpj: string;
      operationId: string;
      year: number;
      month: number;
      amount: number;
      paidInstallments: number;
      totalInstallments: number;
    }>
  >();

  for (const row of params.rows) {
    const rawCnpj = String(row.company_cnpj || "").trim();
    const identity = getCompanyDisplayIdentity({ cnpj: rawCnpj });
    const canonicalCnpj = identity.empresaCnpj || rawCnpj;
    const company =
      params.companyByCnpj.get(rawCnpj) ||
      params.companyByCanonicalCnpj.get(canonicalCnpj);
    const operationId = normalizeOperationId(
      row.operation_number || row.contract_number
    );
    const amount = roundMoney(toNumber(row.commission_value));
    const paidInstallments = Math.max(
      0,
      Math.round(
        getMetadataNumber(row.metadata, [
          "QTD PARCELAS PGS",
          "QTD PARCELAS PAGAS",
          "PARCELAS PAGAS",
        ])
      )
    );
    const totalInstallments = Math.max(
      0,
      Math.round(
        getMetadataNumber(row.metadata, [
          "QTD PARCELAS TOTAL",
          "QTD PARCELAS TOTAIS",
          "PARCELAS TOTAL",
          "PARCELAS TOTAIS",
        ])
      )
    );

    if (!canonicalCnpj || !operationId || amount <= 0 || totalInstallments <= 0) {
      continue;
    }

    const key = `${canonicalCnpj}::${operationId}`;
    const bucket = grouped.get(key) || [];
    bucket.push({
      companyId: company?.id,
      cnpj: canonicalCnpj,
      operationId,
      year: row.year,
      month: row.month,
      amount,
      paidInstallments,
      totalInstallments,
    });
    grouped.set(key, bucket);
  }

  const rows: DeferredPortfolioRow[] = [];

  for (const bucket of grouped.values()) {
    const timeline = [...bucket].sort(comparePeriods);

    for (let index = 0; index < timeline.length; index += 1) {
      const current = timeline[index];
      const next = timeline[index + 1];
      const paid = Math.max(current.paidInstallments, 1);
      const remainingInstallments = Math.max(
        current.totalInstallments - paid,
        0
      );

      for (let offset = 1; offset <= remainingInstallments; offset += 1) {
        const duePeriod = addMonthsToPeriod(current.year, current.month, offset);
        const stopPeriod = params.stopPeriodByOperation.get(
          `${current.cnpj}::${normalizeOperationId(current.operationId)}`
        );

        if (
          next &&
          comparePeriods(duePeriod, { year: next.year, month: next.month }) >= 0
        ) {
          break;
        }

        if (
          stopPeriod &&
          comparePeriods(duePeriod, {
            year: stopPeriod.year,
            month: stopPeriod.month,
          }) >= 0
        ) {
          break;
        }

        rows.push({
          companyId: current.companyId,
          cnpj: current.cnpj,
          year: duePeriod.year,
          month: duePeriod.month,
          amount: current.amount,
          status: "ESTIMADO_PRT_PARCELAS",
        });
      }
    }
  }

  return rows;
}

function extractOperationIdFromAdjustment(row: HistoricalAdjustmentEntryRow) {
  const direct = normalizeOperationId(row.operation_number || row.contract_number);
  if (direct) {
    return direct;
  }

  const metadata = row.metadata || {};
  const combined = [
    metadata["DESCRIÇÃO"],
    metadata["DESCRICAO"],
    metadata["HISTÓRICO"],
    metadata["HISTORICO"],
    metadata["PRODUTO"],
    metadata["TIPO"],
  ]
    .filter(Boolean)
    .join(" ");

  const match = String(combined).match(/\b\d{6,}\b/);
  return normalizeOperationId(match?.[0] || "");
}

function buildStopPeriodByOperation(params: {
  rows: HistoricalAdjustmentEntryRow[];
}) {
  const stopMap = new Map<string, { year: number; month: number }>();

  for (const row of params.rows) {
    const rawCnpj = String(row.company_cnpj || "").trim();
    const identity = getCompanyDisplayIdentity({ cnpj: rawCnpj });
    const canonicalCnpj = identity.empresaCnpj || rawCnpj;
    const operationId = extractOperationIdFromAdjustment(row);

    if (!canonicalCnpj || !operationId) {
      continue;
    }

    const key = `${canonicalCnpj}::${operationId}`;
    const current = stopMap.get(key);
    const next = { year: row.year, month: row.month };

    if (!current || comparePeriods(next, current) < 0) {
      stopMap.set(key, next);
    }
  }

  return stopMap;
}

function estimateRow(row: ProductionRow, productionValue: number) {
  const netValue = toNumber(row.net_value);
  const grossValue = Math.max(toNumber(row.gross_value), netValue);
  const insuranceValue = toNumber(row.insurance_value);
  const insuranceCommissionAmount = toNumber(row.insurance_commission_amount);
  const term = getOperationTerm(row);
  const rate = toNumber(row.interest_rate);
  const hasInsurance = Boolean(row.has_insurance) || insuranceValue > 0;

  let expectedCash = 0;
  let expectedPrt = 0;
  let expectedInsurance = 0;
  let hasAnyForecast = false;
  let hasFullForecast = false;

  if (netValue > 0 && rate > 0 && term > 0) {
    const result = calcularOperacao({
      valor_liquido: netValue,
      valor_bruto: grossValue,
      valor_seguro: insuranceValue,
      taxa_juros: rate,
      prazo: term,
      tem_seguro: hasInsurance,
      product_code: row.product_code,
      product_description: row.product_description,
      convenio_code: row.convenio_code,
      convenio_type: row.convenio_type,
      convenio_segment: row.convenio_segment,
      company_cash_percent: row.company_received_percent,
      production_value: productionValue,
      insurance_type: row.insurance_type,
      movement_date: row.movement_date,
      contract_date: row.contract_date,
      proposal_date: row.proposal_date,
    });

    expectedCash = toNumber(result.credito.avista_empresa);
    expectedPrt = toNumber(result.credito.diferido);
    hasAnyForecast = expectedCash > 0 || expectedPrt > 0;
    hasFullForecast = hasAnyForecast;
  }

  if (insuranceCommissionAmount > 0) {
    expectedInsurance = insuranceCommissionAmount;
    hasAnyForecast = true;
  } else if (hasInsurance && grossValue > 0 && term > 0) {
    expectedInsurance = grossValue * getInsurancePercentByTerm(term);
    hasAnyForecast = true;
  }

  return {
    grossValue,
    netValue,
    hasInsurance,
    expectedCash: roundMoney(expectedCash),
    expectedPrt: roundMoney(expectedPrt),
    expectedInsurance: roundMoney(expectedInsurance),
    expectedTotal: roundMoney(expectedCash + expectedPrt + expectedInsurance),
    hasAnyForecast,
    hasFullForecast,
  };
}

function mergeExpectedTotals(
  companyId: string | undefined,
  year: number,
  month: number,
  computedMap: Map<string, ComputedExpectedAccumulator>,
  storedMap: Map<string, StoredExpectedRow>
): MergedExpectedTotals {
  if (!companyId) {
    return {
      grossProduction: 0,
      validProduction: 0,
      operations: 0,
      insuredGrossProduction: 0,
      forecastCoveragePercent: 0,
      fullForecastCoveragePercent: 0,
      expectedCash: 0,
      expectedPrt: 0,
      expectedInsurance: 0,
      expectedTotal: 0,
    };
  }

  const key = `${companyId}::${getPeriodKey(year, month)}`;
  const computed = computedMap.get(key);
  const stored = storedMap.get(key);
  const operations = computed?.operations || 0;
  const forecastedOperations = computed?.forecastedOperations || 0;
  const fullForecastOperations = computed?.fullForecastOperations || 0;
  const storedExpectedCash = toNumber(stored?.expected_cash_commission);
  const storedExpectedPrt = toNumber(stored?.expected_prt_commission);
  const storedExpectedInsurance = toNumber(stored?.expected_insurance_commission);
  const computedExpectedCash = toNumber(computed?.expectedCash);
  const computedExpectedPrt = toNumber(computed?.expectedPrt);
  const computedExpectedInsurance = toNumber(computed?.expectedInsurance);
  const expectedCash =
    storedExpectedCash > 0 || computedExpectedCash <= 0
      ? storedExpectedCash
      : computedExpectedCash;
  const expectedPrt =
    storedExpectedPrt > 0 || computedExpectedPrt <= 0
      ? storedExpectedPrt
      : computedExpectedPrt;
  const expectedInsurance =
    storedExpectedInsurance > 0 || computedExpectedInsurance <= 0
      ? storedExpectedInsurance
      : computedExpectedInsurance;

  return {
    grossProduction: toNumber(stored?.gross_production ?? computed?.grossProduction),
    validProduction: toNumber(stored?.net_valid_production ?? computed?.validProduction),
    operations,
    insuredGrossProduction: toNumber(computed?.insuredGrossProduction),
    forecastCoveragePercent:
      operations > 0 ? (forecastedOperations / operations) * 100 : 0,
    fullForecastCoveragePercent:
      operations > 0 ? (fullForecastOperations / operations) * 100 : 0,
    expectedCash: roundMoney(expectedCash),
    expectedPrt: roundMoney(expectedPrt),
    expectedInsurance: roundMoney(expectedInsurance),
    expectedTotal: roundMoney(
      toNumber(
        stored?.expected_total ??
          computed?.expectedTotal ??
          expectedCash +
            expectedPrt +
            expectedInsurance
      )
    ),
  };
}

export async function buildClosingAnalytics(
  supabase: SupabaseClient,
  filters?: {
    year?: number;
    month?: number;
    fastDashboardMode?: boolean;
  }
): Promise<ClosingAnalyticsPayload> {
  const supabaseAdmin = supabase;

  const [
    companies,
    actualRows,
    storedExpectedRows,
    productionRows,
    deferredRows,
  ] =
    await Promise.all([
      fetchAllRows<CompanyRow>(() =>
        supabaseAdmin.from("companies").select("id, cnpj, name").order("name", {
          ascending: true,
        })
      ),
      fetchAllRows<ActualClosingRow>(() =>
        supabaseAdmin
          .from("fechamento_mensal_empresa")
          .select(
            "empresa_cnpj, ano, mes, valor_avista, valor_diferido, valor_seguro, valor_estorno, valor_renovacao, valor_liquido, operacoes"
          )
          .order("ano", { ascending: true })
          .order("mes", { ascending: true })
          .order("empresa_cnpj", { ascending: true })
      ),
      fetchAllRows<StoredExpectedRow>(() =>
        supabaseAdmin
          .from("monthly_expected_closings")
          .select(
            "company_id, year, month, gross_production, net_valid_production, expected_cash_commission, expected_insurance_commission, expected_prt_commission, expected_total"
          )
          .order("year", { ascending: true })
          .order("month", { ascending: true })
          .order("company_id", { ascending: true })
      ),
      fetchAllRows<ProductionRow>(() =>
        supabaseAdmin
          .from("daily_production_records")
          .select(
            "company_id, status, product_code, product_description, convenio_code, convenio_type, convenio_segment, net_value, gross_value, insurance_value, insurance_type, insurance_commission_amount, company_received_percent, interest_rate, term_months, installments, has_insurance, is_srcc_restricted, movement_date, contract_date, proposal_date"
          )
          .order("id", { ascending: true })
      ),
      fetchAllRows<DeferredRow>(() =>
        supabaseAdmin
          .from("diferido_parcelas")
          .select("valor, status, data_prevista")
          .order("data_prevista", { ascending: true })
      ),
    ]);

  const historicalCompanyCnpjs = Array.from(
    new Set(
      actualRows
        .map((row) => String(row.empresa_cnpj || "").trim())
        .filter(Boolean)
    )
  );

  // FASE 2.5 — quando o caller nao informa year/month (carga inicial),
  // usa o ultimo periodo presente em actualRows como filtro implicito,
  // evitando timeout em monthly_closing_entries (~280k linhas).
  let implicitYear: number | undefined = filters?.year;
  let implicitMonth: number | undefined = filters?.month;
  if ((!implicitYear || !implicitMonth) && actualRows.length > 0) {
    let maxYear = 0;
    let maxMonth = 0;
    for (const row of actualRows) {
      if (
        row.ano > maxYear ||
        (row.ano === maxYear && row.mes > maxMonth)
      ) {
        maxYear = row.ano;
        maxMonth = row.mes;
      }
    }
    if (maxYear > 0 && maxMonth > 0) {
      implicitYear = maxYear;
      implicitMonth = maxMonth;
    }
  }

  const [historicalPrtEntryRows, historicalCashEntryRows, historicalAdjustmentRows] =
    !filters?.fastDashboardMode && historicalCompanyCnpjs.length > 0
      ? await Promise.all([
          fetchAllRows<HistoricalPrtEntryRow>(() => {
            let query = supabaseAdmin
              .from("monthly_closing_entries")
              .select(
                "company_cnpj, year, month, operation_number, contract_number, commission_value, metadata"
              )
              .in("company_cnpj", historicalCompanyCnpjs)
              .eq("entry_type", "PRT")
              .gt("commission_value", 0);
            if (implicitYear && implicitMonth) {
              query = query.eq("year", implicitYear).eq("month", implicitMonth);
            }
            return query;
          }),
          fetchAllRows<HistoricalCashEntryRow>(() => {
            let query = supabaseAdmin
              .from("monthly_closing_entries")
              .select(
                "company_cnpj, year, month, operation_number, contract_number, commission_value, net_value, metadata"
              )
              .in("company_cnpj", historicalCompanyCnpjs)
              .eq("entry_type", "CASH")
              .gt("commission_value", 0);
            if (implicitYear && implicitMonth) {
              query = query.eq("year", implicitYear).eq("month", implicitMonth);
            }
            return query;
          }),
          fetchAllRows<HistoricalAdjustmentEntryRow>(() => {
            let query = supabaseAdmin
              .from("monthly_closing_entries")
              .select(
                "company_cnpj, year, month, operation_number, contract_number, metadata"
              )
              .in("company_cnpj", historicalCompanyCnpjs)
              .eq("entry_type", "DEBIT");
            if (implicitYear && implicitMonth) {
              query = query.eq("year", implicitYear).eq("month", implicitMonth);
            }
            return query;
          }),
        ])
      : [[], [], []];

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const companyByCnpj = new Map(companies.map((company) => [company.cnpj, company]));
  const companyByCanonicalCnpj = new Map(
    companies.map((company) => {
      const identity = getCompanyDisplayIdentity({
        cnpj: company.cnpj,
        name: company.name,
      });
      return [identity.empresaCnpj || company.cnpj, company] as const;
    })
  );
  const companyPeriodRefs = new Map<
    string,
    {
      year: number;
      month: number;
      companyId?: string;
      cnpj: string;
    }
  >();

  const actualByCompanyPeriod = new Map<string, ActualClosingRow>();

  for (const row of actualRows) {
    const periodKey = getPeriodKey(row.ano, row.mes);
    const identity = getCompanyDisplayIdentity({ cnpj: row.empresa_cnpj });
    const canonicalCnpj = identity.empresaCnpj || row.empresa_cnpj;
    const company =
      companyByCnpj.get(row.empresa_cnpj) ||
      companyByCanonicalCnpj.get(canonicalCnpj);
    const refKey = `${periodKey}::${company?.id || canonicalCnpj}`;
    companyPeriodRefs.set(refKey, {
      year: row.ano,
      month: row.mes,
      companyId: company?.id,
      cnpj: canonicalCnpj,
    });
    actualByCompanyPeriod.set(`${canonicalCnpj}::${periodKey}`, row);
  }

  const stopPeriodByOperation = filters?.fastDashboardMode
    ? new Map<string, { year: number; month: number }>()
    : buildStopPeriodByOperation({
        rows: historicalAdjustmentRows,
      });
  const historicalDeferredPortfolioRows = filters?.fastDashboardMode
    ? []
    : buildHistoricalDeferredPortfolioRowsFromPrtEntries({
        rows: historicalPrtEntryRows,
        companyByCnpj,
        companyByCanonicalCnpj,
        stopPeriodByOperation,
      });
  const fallbackHistoricalDeferredPortfolioRows =
    buildFallbackDeferredPortfolioRowsFromActualClosings({
      rows: actualRows,
      companyByCnpj,
      companyByCanonicalCnpj,
    });
  const activeHistoricalDeferredPortfolioRows = [
    ...fallbackHistoricalDeferredPortfolioRows,
    ...historicalDeferredPortfolioRows,
  ];

  const storedExpectedByCompanyPeriod = new Map<string, StoredExpectedRow>();

  for (const row of storedExpectedRows) {
    const company = companyById.get(row.company_id);
    if (!company) continue;
    const identity = getCompanyDisplayIdentity({
      cnpj: company.cnpj,
      name: company.name,
    });
    const canonicalCnpj = identity.empresaCnpj || company.cnpj;

    const periodKey = getPeriodKey(row.year, row.month);
    const refKey = `${periodKey}::${row.company_id}`;

    companyPeriodRefs.set(refKey, {
      year: row.year,
      month: row.month,
      companyId: row.company_id,
      cnpj: canonicalCnpj,
    });

    storedExpectedByCompanyPeriod.set(`${row.company_id}::${periodKey}`, row);
  }

  const computedExpectedByCompanyPeriod = new Map<string, ComputedExpectedAccumulator>();
  const syntheticDeferredPortfolioRows: DeferredPortfolioRow[] = [];
  const productionValueByCompanyPeriod = new Map<string, number>();
  // CORREÇÃO A — Produção CONSOLIDADA do grupo por período.
  // A regra Promotiva enquadra na faixa pelo somatório do GRUPO empresarial,
  // nao por CNPJ isolado. Este mapa agrega todos os CNPJs num unico totalizador.
  const groupProductionByPeriod = new Map<string, number>();

  for (const row of productionRows) {
    if (!row.company_id || !isEligibleProductionRow(row)) {
      continue;
    }

    const period = getProductionPeriod(row);

    if (!period) {
      continue;
    }

    const periodKey = getPeriodKey(period.year, period.month);
    const mapKey = `${row.company_id}::${periodKey}`;
    const netValue = toNumber(row.net_value);
    productionValueByCompanyPeriod.set(
      mapKey,
      roundMoney((productionValueByCompanyPeriod.get(mapKey) || 0) + netValue)
    );
    groupProductionByPeriod.set(
      periodKey,
      roundMoney((groupProductionByPeriod.get(periodKey) || 0) + netValue)
    );
  }

  // CORREÇÃO A — Tambem agregar a produção dos fechamentos historicos
  // (A Vista do mes-x) no totalizador do grupo, para que mesmo periodos
  // sem diaria carregada tenham a faixa consolidada calculada corretamente.
  for (const row of historicalCashEntryRows) {
    if (!row || !isHistoricalCashEntryEligible(row)) continue;
    const periodKey = getPeriodKey(row.year, row.month);
    const netValue = getHistoricalCashEntryNetValue(row);
    if (netValue <= 0) continue;
    groupProductionByPeriod.set(
      periodKey,
      roundMoney((groupProductionByPeriod.get(periodKey) || 0) + netValue)
    );
  }

  const historicalCashDeferredPortfolioRows = filters?.fastDashboardMode
    ? []
    : buildHistoricalDeferredPortfolioRowsFromCashEntries({
        rows: historicalCashEntryRows,
        companyByCnpj,
        companyByCanonicalCnpj,
        productionValueByCompanyPeriod,
      });

  for (const row of productionRows) {
    if (!row.company_id || !isEligibleProductionRow(row)) {
      continue;
    }

    const period = getProductionPeriod(row);

    if (!period) {
      continue;
    }

    const company = companyById.get(row.company_id);
    if (!company) {
      continue;
    }
    const identity = getCompanyDisplayIdentity({
      cnpj: company.cnpj,
      name: company.name,
    });
    const canonicalCnpj = identity.empresaCnpj || company.cnpj;

    const periodKey = getPeriodKey(period.year, period.month);
    const mapKey = `${row.company_id}::${periodKey}`;
    const current =
      computedExpectedByCompanyPeriod.get(mapKey) || {
        companyId: row.company_id,
        year: period.year,
        month: period.month,
        grossProduction: 0,
        validProduction: 0,
        insuredGrossProduction: 0,
        operations: 0,
        expectedCash: 0,
        expectedPrt: 0,
        expectedInsurance: 0,
        expectedTotal: 0,
        forecastedOperations: 0,
        fullForecastOperations: 0,
      };

    // CORREÇÃO A — passar a produção CONSOLIDADA do grupo para o motor,
    // nao apenas a do CNPJ corrente. A regra Promotiva enquadra na faixa
    // pelo somatorio do grupo empresarial.
    const estimation = estimateRow(
      row,
      groupProductionByPeriod.get(periodKey) || 0
    );
    const term = getOperationTerm(row);

    current.grossProduction += estimation.grossValue;
    current.validProduction += estimation.netValue;
    current.operations += 1;
    current.expectedCash += estimation.expectedCash;
    current.expectedPrt += estimation.expectedPrt;
    current.expectedInsurance += estimation.expectedInsurance;
    current.expectedTotal += estimation.expectedTotal;

    if (estimation.hasInsurance) {
      current.insuredGrossProduction += estimation.grossValue;
    }

    if (estimation.hasAnyForecast) {
      current.forecastedOperations += 1;
    }

    if (estimation.hasFullForecast) {
      current.fullForecastOperations += 1;
    }

    computedExpectedByCompanyPeriod.set(mapKey, current);
    companyPeriodRefs.set(`${periodKey}::${row.company_id}`, {
      year: period.year,
      month: period.month,
      companyId: row.company_id,
      cnpj: canonicalCnpj,
    });

    for (const deferredRow of buildSyntheticDeferredPortfolioRows({
      companyId: row.company_id,
      cnpj: canonicalCnpj,
      year: period.year,
      month: period.month,
      expectedPrt: estimation.expectedPrt,
      term,
    })) {
      syntheticDeferredPortfolioRows.push(deferredRow);
    }
  }

  const persistedDeferredPortfolioRows: DeferredPortfolioRow[] = [];

  for (const row of deferredRows) {
    const period = extractYearMonth(row.data_prevista);
    const operation = getDeferredOperation(row);
    const rawCnpj = String(operation?.empresa_cnpj || "").trim();
    const identity = getCompanyDisplayIdentity({ cnpj: rawCnpj });
    const cnpj = identity.empresaCnpj || rawCnpj;
    const amount = roundMoney(toNumber(row.valor));

    if (!period || !cnpj || amount <= 0) {
      continue;
    }

    const company =
      companyByCnpj.get(rawCnpj) ||
      companyByCanonicalCnpj.get(cnpj);

    persistedDeferredPortfolioRows.push({
      companyId: company?.id,
      cnpj,
      year: period.year,
      month: period.month,
      amount,
      status: normalizeText(row.status),
    });
  }

  const hasPersistedDeferredPortfolio = persistedDeferredPortfolioRows.length > 0;
  const activeDeferredPortfolioRows = hasPersistedDeferredPortfolio
    ? persistedDeferredPortfolioRows
    : [
        ...activeHistoricalDeferredPortfolioRows,
        ...historicalCashDeferredPortfolioRows,
        ...syntheticDeferredPortfolioRows,
      ];

  if (filters?.year && filters?.month) {
    const filteredPeriodKey = getPeriodKey(filters.year, filters.month);

    for (const row of activeDeferredPortfolioRows) {
      if (row.year !== filters.year || row.month !== filters.month) {
        continue;
      }

      const key = `${filteredPeriodKey}::${row.companyId || row.cnpj}`;
      companyPeriodRefs.set(key, {
        year: row.year,
        month: row.month,
        companyId: row.companyId,
        cnpj: row.cnpj,
      });
    }
  }

  const expectedPrtByCompanyPeriod = buildDeferredPortfolioMap(
    activeDeferredPortfolioRows
  );

  const allCompanyRows = Array.from(companyPeriodRefs.values())
    .map((ref) => {
      const company =
        (ref.companyId && companyById.get(ref.companyId)) ||
        companyByCnpj.get(ref.cnpj) ||
        companyByCanonicalCnpj.get(ref.cnpj);
      const identity = getCompanyDisplayIdentity({
        cnpj: ref.cnpj,
        name: company?.name,
      });
      const expected = mergeExpectedTotals(
        ref.companyId || company?.id,
        ref.year,
        ref.month,
        computedExpectedByCompanyPeriod,
        storedExpectedByCompanyPeriod
      );
      const actual =
        actualByCompanyPeriod.get(`${ref.cnpj}::${getPeriodKey(ref.year, ref.month)}`) || null;
      const actualCash = roundMoney(toNumber(actual?.valor_avista));
      const actualPrt = roundMoney(toNumber(actual?.valor_diferido));
      const actualInsurance = roundMoney(toNumber(actual?.valor_seguro));
      const actualEstorno = roundMoney(toNumber(actual?.valor_estorno));
      const actualRenewal = roundMoney(toNumber(actual?.valor_renovacao));
      const actualNet = roundMoney(
        toNumber(actual?.valor_liquido) ||
          actualCash + actualPrt + actualInsurance - actualEstorno - actualRenewal
      );
      const expectedGeneratedPrt = roundMoney(expected.expectedPrt);
      const expectedPrt = roundMoney(
        expectedPrtByCompanyPeriod.get(
          getCompanyPeriodKey(ref.companyId || company?.id, ref.cnpj, ref.year, ref.month)
        ) || 0
      );
      const expectedTotal = roundMoney(
        expected.expectedCash + expectedPrt + expected.expectedInsurance
      );

      return {
        companyId: ref.companyId || company?.id,
        empresa_cnpj: identity.empresaCnpj || ref.cnpj,
        empresa_nome: identity.empresaNome || company?.name || ref.cnpj,
        year: ref.year,
        month: ref.month,
        grossProduction: roundMoney(expected.grossProduction),
        validProduction: roundMoney(expected.validProduction),
        operations: expected.operations || Number(actual?.operacoes || 0),
        insurancePenetrationPercent:
          expected.grossProduction > 0
            ? (expected.insuredGrossProduction / expected.grossProduction) * 100
            : 0,
        forecastCoveragePercent: expected.forecastCoveragePercent,
        fullForecastCoveragePercent: expected.fullForecastCoveragePercent,
        expectedCash: expected.expectedCash,
        expectedGeneratedPrt,
        expectedPrt,
        expectedInsurance: expected.expectedInsurance,
        expectedTotal,
        actualCash,
        actualPrt,
        actualInsurance,
        actualEstorno,
        actualRenewal,
        actualNet,
        deltaCash: roundMoney(actualCash - expected.expectedCash),
        deltaPrt: roundMoney(actualPrt - expectedPrt),
        deltaInsurance: roundMoney(actualInsurance - expected.expectedInsurance),
        deltaTotal: roundMoney(actualNet - expectedTotal),
      } satisfies ClosingCompanyAuditRow;
    })
    .sort((a, b) => comparePeriods(a, b) || b.expectedTotal - a.expectedTotal);

  const periods = Array.from(
    new Map(
      allCompanyRows.map((row) => [
        getPeriodKey(row.year, row.month),
        {
          key: getPeriodKey(row.year, row.month),
          label: getPeriodLabel(row.year, row.month),
          year: row.year,
          month: row.month,
        },
      ])
    ).values()
  ).sort((a, b) => comparePeriods(a, b));

  const selectedPeriod =
    periods.find(
      (period) => period.year === filters?.year && period.month === filters?.month
    ) || periods.at(-1) || null;

  const selectedRows = selectedPeriod
    ? allCompanyRows
        .filter(
          (row) =>
            row.year === selectedPeriod.year && row.month === selectedPeriod.month
        )
        .sort((a, b) => Math.abs(b.deltaTotal) - Math.abs(a.deltaTotal))
    : [];

  const summary = selectedRows.reduce<ClosingSummary>(
    (acc, row) => {
      acc.expectedCash += row.expectedCash;
      acc.generatedPrt += row.expectedGeneratedPrt;
      acc.expectedPrt += row.expectedPrt;
      acc.expectedInsurance += row.expectedInsurance;
      acc.expectedTotal += row.expectedTotal;
      acc.actualCash += row.actualCash;
      acc.actualPrt += row.actualPrt;
      acc.actualInsurance += row.actualInsurance;
      acc.actualEstorno += row.actualEstorno;
      acc.actualRenewal += row.actualRenewal;
      acc.actualNet += row.actualNet;
      acc.deltaTotal += row.deltaTotal;
      acc.grossProduction += row.grossProduction;
      acc.validProduction += row.validProduction;
      acc.operations += row.operations;
      acc.companiesCount += 1;
      acc.insurancePenetrationPercent += row.grossProduction
        ? row.insurancePenetrationPercent * row.grossProduction
        : 0;
      acc.forecastCoveragePercent += row.operations
        ? row.forecastCoveragePercent * row.operations
        : 0;
      acc.fullForecastCoveragePercent += row.operations
        ? row.fullForecastCoveragePercent * row.operations
        : 0;
      return acc;
    },
    {
      periodLabel: selectedPeriod?.label || "sem competencia",
      expectedCash: 0,
      generatedPrt: 0,
      expectedPrt: 0,
      expectedInsurance: 0,
      expectedTotal: 0,
      actualCash: 0,
      actualPrt: 0,
      actualInsurance: 0,
      actualEstorno: 0,
      actualRenewal: 0,
      actualNet: 0,
      deltaTotal: 0,
      grossProduction: 0,
      validProduction: 0,
      operations: 0,
      companiesCount: 0,
      insurancePenetrationPercent: 0,
      forecastCoveragePercent: 0,
      fullForecastCoveragePercent: 0,
      futureDeferredBalance: 0,
    }
  );

  summary.insurancePenetrationPercent =
    summary.grossProduction > 0
      ? summary.insurancePenetrationPercent / summary.grossProduction
      : 0;
  summary.forecastCoveragePercent =
    summary.operations > 0
      ? summary.forecastCoveragePercent / summary.operations
      : 0;
  summary.fullForecastCoveragePercent =
    summary.operations > 0
      ? summary.fullForecastCoveragePercent / summary.operations
      : 0;

  if (selectedPeriod) {
    summary.futureDeferredBalance = roundMoney(
      activeDeferredPortfolioRows.reduce((sum, row) => {
        if (normalizeText(row.status) === "ESTIMADO_FECHAMENTO") {
          return sum;
        }

        if (
          hasPersistedDeferredPortfolio &&
          normalizeText(row.status) === "PAGO"
        ) {
          return sum;
        }

        if (
          comparePeriods(
            { year: row.year, month: row.month },
            { year: selectedPeriod.year, month: selectedPeriod.month }
          ) <= 0
        ) {
          return sum;
        }

        return sum + toNumber(row.amount);
      }, 0)
    );
  }

  const trend = periods
    .slice(-6)
    .map((period) => {
      const periodRows = allCompanyRows.filter(
        (row) => row.year === period.year && row.month === period.month
      );

      const totals = periodRows.reduce(
        (acc, row) => {
          acc.expectedTotal += row.expectedTotal;
          acc.actualNet += row.actualNet;
          acc.expectedPrt += row.expectedPrt;
          acc.actualPrt += row.actualPrt;
          return acc;
        },
        { expectedTotal: 0, actualNet: 0, expectedPrt: 0, actualPrt: 0 }
      );

      return {
        key: period.key,
        label: period.label,
        year: period.year,
        month: period.month,
        expectedTotal: roundMoney(totals.expectedTotal),
        actualNet: roundMoney(totals.actualNet),
        deltaTotal: roundMoney(totals.actualNet - totals.expectedTotal),
        expectedPrt: roundMoney(totals.expectedPrt),
        actualPrt: roundMoney(totals.actualPrt),
      } satisfies ClosingTrendPoint;
    })
    .sort(comparePeriods);

  const highlights = [...selectedRows]
    .sort((a, b) => Math.abs(b.deltaTotal) - Math.abs(a.deltaTotal))
    .slice(0, 5)
    .map((row) => ({
      empresa_nome: row.empresa_nome,
      empresa_cnpj: row.empresa_cnpj,
      deltaTotal: row.deltaTotal,
      expectedTotal: row.expectedTotal,
      actualNet: row.actualNet,
    }));

  const alerts: string[] = [];

  if (!selectedPeriod) {
    alerts.push(
      "Ainda nao existem competencias suficientes para montar o fechamento mensal."
    );
  } else {
    if (!hasPersistedDeferredPortfolio && syntheticDeferredPortfolioRows.length === 0) {
      alerts.push(
        "Ainda nao existe carteira diferida parametrizada no sistema. Por isso, o PRT do fechamento nao consegue ser auditado por vencimento mensal."
      );
    } else if (
      !hasPersistedDeferredPortfolio &&
      historicalDeferredPortfolioRows.length > 0
    ) {
      alerts.push(
        "O PRT desta tela esta sendo estimado com base nos fechamentos mensais anteriores, porque a carteira parcelada detalhada ainda nao foi gravada no banco."
      );
    } else if (!hasPersistedDeferredPortfolio && syntheticDeferredPortfolioRows.length > 0) {
      alerts.push(
        "O PRT desta tela esta sendo estimado pela producao carregada, porque a carteira parcelada ainda nao foi gravada no banco."
      );
    }

    if (selectedRows.every((row) => row.actualNet === 0)) {
      alerts.push(
        "Ainda nao existe fechamento real importado para esta competencia. A leitura atual mostra apenas previsao."
      );
    }

    if (summary.actualPrt > 0 && summary.expectedPrt === 0) {
      alerts.push(
        "Existe recebimento real de PRT nesta competencia, mas a carteira vencendo no mes ainda nao foi carregada ou nao pode ser reconstruida pela base atual."
      );
    }

    if (summary.fullForecastCoveragePercent > 0 && summary.fullForecastCoveragePercent < 100) {
      alerts.push(
        "Parte da previsao da producao ainda depende de taxa e prazo na base diaria. Onde esses campos nao existem, a leitura fica parcial."
      );
    }

    if (summary.forecastCoveragePercent === 0 && summary.validProduction > 0) {
      alerts.push(
        "A producao valida existe, mas ainda faltam campos suficientes para projetar a comissao desta competencia."
      );
    }
  }

  return {
    periods: periods.sort((a, b) => comparePeriods(b, a)),
    selectedPeriod,
    summary,
    companyRows: selectedRows,
    trend,
    highlights,
    alerts,
  };
}

