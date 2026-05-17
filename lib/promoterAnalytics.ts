import type { SupabaseClient } from "@supabase/supabase-js";

import { calcularOperacao } from "@/lib/motor";
import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import { fetchAllRows } from "@/lib/queryHelpers";

type CompanyRow = {
  id: string;
  name: string;
  cnpj: string;
};

type PromoterRow = {
  id: string;
  company_id?: string | null;
  name: string;
  status?: string | null;
  active?: boolean | null;
};

type JKeyRow = {
  id: string;
  promoter_id?: string | null;
};

type TargetRow = {
  promoter_id: string;
  company_id?: string | null;
  year: number;
  month: number;
  meta?: number | null;
  meta_1?: number | null;
  meta_2?: number | null;
};

type MonthlyResultRow = {
  promoter_id: string;
  company_id?: string | null;
  year: number;
  month: number;
  production_value?: number | null;
  proposal_count?: number | null;
  insured_proposal_count?: number | null;
  insured_production_value?: number | null;
  insurance_penetration_percent?: number | null;
  production_commission_value?: number | null;
  insurance_commission_value?: number | null;
  agreement_adjustment_value?: number | null;
  final_commission_value?: number | null;
  discount_value?: number | null;
  target_status?: string | null;
};

type DiscountRow = {
  id: string;
  promoter_id?: string | null;
  company_id?: string | null;
  daily_production_record_id?: string | null;
  year: number;
  month: number;
  discount_type?: string | null;
  amount?: number | null;
  installments?: number | null;
  installment_number?: number | null;
  apply_to_company?: boolean | null;
  notes?: string | null;
};

type AgreementRow = {
  id: string;
  promoter_id: string;
  company_id?: string | null;
  year: number;
  month: number;
  agreement_type: string;
  commission_type?: string | null;
  commission_value?: number | null;
  active?: boolean | null;
  notes?: string | null;
};

type ProductionRow = {
  id: string;
  company_id?: string | null;
  j_key?: string | null;
  assigned_promoter_id?: string | null;
  original_promoter_id?: string | null;
  proposal_number?: string | null;
  contract_number?: string | null;
  product_description?: string | null;
  status?: string | null;
  movement_date?: string | null;
  contract_date?: string | null;
  proposal_date?: string | null;
  net_value?: number | null;
  gross_value?: number | null;
  insurance_value?: number | null;
  has_insurance?: boolean | null;
  interest_rate?: number | null;
  term_months?: number | null;
  installments?: number | null;
  company_received_percent?: number | null;
  is_srcc_restricted?: boolean | null;
  promoter_commission_percent?: number | null;
  promoter_commission_amount?: number | null;
  insurance_commission_percent?: number | null;
  insurance_commission_amount?: number | null;
  commission_rule_source?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

export type PromoterAnalyticsPayload = {
  periods: Array<{ key: string; label: string; year: number; month: number }>;
  selectedPeriod: { key: string; label: string; year: number; month: number };
  selectedPromoterId: string;
  selectedCompanyId: string;
  summary: {
    promoters: number;
    production: number;
    finalCommission: number;
    payableCommission: number;
    discounts: number;
    averageInsurancePenetration: number;
  };
  summaryRows: Array<{
    promoter_id: string;
    promoter_name: string;
    company_id?: string | null;
    company_name: string;
    company_cnpj: string;
    active: boolean;
    status: string;
    j_keys_count: number;
    production_value: number;
    proposal_count: number;
    insurance_penetration_percent: number;
    target_value: number;
    target_1_value: number;
    target_2_value: number;
    target_status: string;
    production_commission_value: number;
    insurance_commission_value: number;
    agreement_adjustment_value: number;
    discount_value: number;
    final_commission_value: number;
    payable_commission_value: number;
    result_source: string;
  }>;
  proposalRows: Array<{
    id: string;
    contract_number: string;
    proposal_number: string;
    agency_code: string;
    j_key: string;
    promoter_name: string;
    product_description: string;
    status: string;
    movement_date?: string | null;
    contract_date?: string | null;
    interest_rate: number;
    installment_count: number;
    company_received_percent: number;
    company_commission_amount: number;
    srcc_restriction: string;
    net_value: number;
    gross_value: number;
    insurance_value: number;
    company_insurance_commission_amount: number;
    insurance_penetration_percent: number;
    promoter_commission_percent: number;
    promoter_commission_amount: number;
    insurance_commission_percent: number;
    insurance_commission_amount: number;
    commission_rule_source: string;
    assigned_promoter_id?: string | null;
    assigned_promoter_name: string;
    original_promoter_id?: string | null;
    original_promoter_name: string;
  }>;
  agreementRows: Array<{
    id: string;
    agreement_type: string;
    commission_type: string;
    commission_value: number;
    notes: string;
  }>;
  discountRows: Array<{
    id: string;
    daily_production_record_id?: string | null;
    proposal_number: string;
    discount_type: string;
    amount: number;
    installments: number;
    installment_number: number;
    apply_to_company: boolean;
    notes: string;
  }>;
  promoterOptions: Array<{ id: string; name: string }>;
  promoterLookup: Array<{ id: string; name: string }>;
  companies: CompanyRow[];
};

function toNumber(value: unknown) {
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

function toPercentRate(value: unknown) {
  const parsed = toNumber(value);
  if (!parsed) return 0;
  return Math.abs(parsed) > 1 ? parsed / 100 : parsed;
}

function capPromoterViewRate(value: number) {
  return Math.min(Math.max(value, 0), 0.058);
}

function isMeaningfulAgreement(row: AgreementRow) {
  const value = toNumber(row.commission_value);
  return row.active !== false && value > 0;
}

function readRawPayloadValue(
  payload: Record<string, unknown> | null | undefined,
  aliases: string[]
) {
  if (!payload || typeof payload !== "object") return null;

  const normalizedAliases = aliases.map((alias) => normalizeText(alias));

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === "") continue;
    if (normalizedAliases.includes(normalizeText(key))) {
      return value;
    }
  }

  return null;
}

function deriveCompanyReceivedRate(record: ProductionRow, companyProductionValue: number) {
  const netValue = toNumber(record.net_value);
  if (netValue <= 0) return 0;

  const rawProductCode = readRawPayloadValue(record.raw_payload, [
    "Produto",
    "Codigo Produto",
  ]);
  const rawConvenioCode = readRawPayloadValue(record.raw_payload, [
    "Codigo Convenio",
    "Cod Convenio",
    "Convenio",
  ]);
  const rawConvenioType = readRawPayloadValue(record.raw_payload, [
    "Tipo Convenio",
    "Tipo de Convenio",
  ]);
  const rawConvenioSegment = readRawPayloadValue(record.raw_payload, [
    "Segmento Convenio",
    "Convenio Segmento",
  ]);
  const rawInsuranceType = readRawPayloadValue(record.raw_payload, ["Tipo Seguro"]);

  const operation = calcularOperacao({
    valor_liquido: netValue,
    valor_bruto: toNumber(record.gross_value),
    valor_seguro: toNumber(record.insurance_value),
    taxa_juros: toNumber(record.interest_rate),
    prazo: toNumber(record.term_months || record.installments),
    tem_seguro:
      toNumber(record.insurance_value) > 0 || Boolean(record.has_insurance),
    product_code:
      typeof rawProductCode === "string" || typeof rawProductCode === "number"
        ? rawProductCode
        : null,
    product_description: record.product_description,
    convenio_code:
      typeof rawConvenioCode === "string" || typeof rawConvenioCode === "number"
        ? rawConvenioCode
        : null,
    convenio_type: typeof rawConvenioType === "string" ? rawConvenioType : null,
    convenio_segment:
      typeof rawConvenioSegment === "string" || typeof rawConvenioSegment === "number"
        ? rawConvenioSegment
        : null,
    insurance_type: typeof rawInsuranceType === "string" ? rawInsuranceType : null,
    production_value: companyProductionValue,
    movement_date: record.movement_date,
    contract_date: record.contract_date,
    proposal_date: record.proposal_date,
  });

  const avistaEmpresa = toNumber(operation?.credito?.avista_empresa);
  if (avistaEmpresa <= 0) return 0;

  return avistaEmpresa / netValue;
}

function getCompanyReceivedRate(record: ProductionRow, companyProductionValue: number) {
  const rawRate = toPercentRate(
    readRawPayloadValue(record.raw_payload, [
      "% A VISTA",
      "% À VISTA",
      "% A VISTA EMPRESA",
      "% AVISTA",
      "Percentual A Vista",
    ])
  );

  if (rawRate > 0 && rawRate <= 0.065) {
    return rawRate;
  }

  const storedRate = toPercentRate(record.company_received_percent);
  if (storedRate > 0 && storedRate <= 0.065) {
    return storedRate;
  }

  return deriveCompanyReceivedRate(record, companyProductionValue);
}

function getPromoterViewCompanyRate(record: ProductionRow, companyProductionValue: number) {
  return capPromoterViewRate(
    getCompanyReceivedRate(record, companyProductionValue)
  );
}

function getInsuranceCompanyRate(record: ProductionRow) {
  const insuranceType = normalizeText(
    readRawPayloadValue(record.raw_payload, ["Tipo Seguro"]) || ""
  );
  const term = toNumber(record.term_months || record.installments);

  if (insuranceType.includes("ESTOQUE")) return 0.15;
  if (term >= 85) return 0.55;
  if (term >= 61) return 0.4;
  if (term >= 37) return 0.25;
  return 0.15;
}

function calculateCompanyInsuranceCommission(record: ProductionRow) {
  const gross = toNumber(record.gross_value);
  if (!gross) return 0;
  if (!toNumber(record.insurance_value) && !record.has_insurance) return 0;
  return gross * (getInsuranceCompanyRate(record) / 100);
}

function getSrccRestrictionLabel(record: ProductionRow) {
  const raw =
    readRawPayloadValue(record.raw_payload, [
      "Indicador Restricao SRCC",
      "Indicador Restrição SRCC",
      "Restricao SRCC",
      "Restrição SRCC",
    ]) || null;

  if (raw !== null && raw !== undefined && raw !== "") {
    return String(raw);
  }

  return record.is_srcc_restricted ? "Sim" : "Não";
}

function getAgencyCode(record: ProductionRow) {
  const raw = readRawPayloadValue(record.raw_payload, [
    "Prefixo Ag. Responsavel",
    "Prefixo Ag. Responsável",
    "Agencia",
    "Agência",
    "Agencia Responsavel",
    "Agência Responsável",
  ]);

  return raw === null || raw === undefined || raw === "" ? "-" : String(raw);
}

function getPeriodKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getPeriodLabel(year: number, month: number) {
  const monthNames = [
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

  return `${monthNames[month - 1]}/${String(year).slice(-2)}`;
}

function comparePeriods(a: { year: number; month: number }, b: { year: number; month: number }) {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function extractYearMonth(record: ProductionRow) {
  return (
    getProductionPeriodFromValue(record.movement_date) ||
    getProductionPeriodFromValue(record.contract_date) ||
    getProductionPeriodFromValue(record.proposal_date)
  );
}

function isProductionStatus(status: unknown) {
  const normalized = normalizeText(status);
  return normalized === "PRODUCAO" || normalized === "PRODUCTION";
}

function isEligibleProductionRecord(record: ProductionRow) {
  return isProductionStatus(record.status) && record.is_srcc_restricted !== true;
}

function resolveTargetStatus(
  productionValue: number,
  target: number,
  target1: number,
  target2: number
) {
  if (target2 > 0 && productionValue >= target2) return "META_2";
  if (target1 > 0 && productionValue >= target1) return "META_1";
  if (target > 0 && productionValue >= target) return "META";
  return "ABAIXO";
}

export async function buildPromoterAnalytics(
  supabase: SupabaseClient,
  filters?: {
    year?: number;
    month?: number;
    companyId?: string;
    promoterId?: string;
  }
): Promise<PromoterAnalyticsPayload> {
  const yearParam = filters?.year;
  const monthParam = filters?.month;
  const companyId = filters?.companyId || "";
  const promoterId = filters?.promoterId || "";

  const [companies, promoters, jKeys, targets, monthlyResults, discounts, agreements, records] =
    await Promise.all([
      fetchAllRows<CompanyRow>(() =>
        supabase
          .from("companies")
          .select("id, name, cnpj")
          .order("name", { ascending: true })
      ),
      fetchAllRows<PromoterRow>(() => {
        let query = supabase
          .from("promoters")
          .select("id, company_id, name, status, active")
          .order("name", { ascending: true });

        if (companyId) {
          query = query.eq("company_id", companyId);
        }

        return query;
      }),
      fetchAllRows<JKeyRow>(() => supabase.from("j_keys").select("id, promoter_id")),
      fetchAllRows<TargetRow>(() =>
        supabase
          .from("monthly_targets")
          .select("promoter_id, company_id, year, month, meta, meta_1, meta_2")
      ),
      fetchAllRows<MonthlyResultRow>(() =>
        supabase
          .from("promoter_monthly_results")
          .select(
            "promoter_id, company_id, year, month, production_value, proposal_count, insured_proposal_count, insured_production_value, insurance_penetration_percent, production_commission_value, insurance_commission_value, agreement_adjustment_value, final_commission_value, discount_value, target_status"
          )
      ),
      fetchAllRows<DiscountRow>(() =>
        supabase
          .from("promoter_discounts")
          .select(
            "id, promoter_id, company_id, daily_production_record_id, year, month, discount_type, amount, installments, installment_number, apply_to_company, notes"
          )
      ),
      fetchAllRows<AgreementRow>(() =>
        supabase
          .from("promoter_agreements")
          .select(
            "id, promoter_id, company_id, year, month, agreement_type, commission_type, commission_value, active, notes"
          )
      ),
      fetchAllRows<ProductionRow>(() => {
        let query = supabase
          .from("daily_production_records")
          .select(
            "id, company_id, j_key, assigned_promoter_id, original_promoter_id, proposal_number, contract_number, product_description, status, movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value, has_insurance, interest_rate, term_months, installments, company_received_percent, is_srcc_restricted, promoter_commission_percent, promoter_commission_amount, insurance_commission_percent, insurance_commission_amount, commission_rule_source, raw_payload"
          )
          .order("movement_date", { ascending: false });

        if (companyId) {
          query = query.eq("company_id", companyId);
        }

        return query;
      }),
    ]);

  const periodsMap = new Map<string, { key: string; label: string; year: number; month: number }>();

  for (const row of monthlyResults) {
    periodsMap.set(getPeriodKey(row.year, row.month), {
      key: getPeriodKey(row.year, row.month),
      label: getPeriodLabel(row.year, row.month),
      year: row.year,
      month: row.month,
    });
  }

  for (const row of targets) {
    periodsMap.set(getPeriodKey(row.year, row.month), {
      key: getPeriodKey(row.year, row.month),
      label: getPeriodLabel(row.year, row.month),
      year: row.year,
      month: row.month,
    });
  }

  for (const row of records) {
    const period = extractYearMonth(row);
    if (!period) continue;

    periodsMap.set(getPeriodKey(period.year, period.month), {
      key: getPeriodKey(period.year, period.month),
      label: getPeriodLabel(period.year, period.month),
      year: period.year,
      month: period.month,
    });
  }

  const periods = Array.from(periodsMap.values()).sort((a, b) => comparePeriods(b, a));
  const latestPeriod =
    periods.find((period) => period.year === yearParam && period.month === monthParam) ||
    periods[0] ||
    {
      key: getPeriodKey(new Date().getFullYear(), new Date().getMonth() + 1),
      label: getPeriodLabel(new Date().getFullYear(), new Date().getMonth() + 1),
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
    };

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const promoterById = new Map(promoters.map((promoter) => [promoter.id, promoter]));

  const recordsForPeriod = records.filter((record) => {
    const period = extractYearMonth(record);
    return period && period.year === latestPeriod.year && period.month === latestPeriod.month;
  });

  const companyProductionMap = new Map<string, number>();
  // CORREÇÃO A — Produção CONSOLIDADA do grupo no periodo selecionado.
  // O enquadramento Promotiva é por grupo empresarial, nao por CNPJ.
  let groupProductionValue = 0;
  for (const record of recordsForPeriod) {
    if (!record.company_id) continue;
    if (!isEligibleProductionRecord(record)) continue;

    const netValue = toNumber(record.net_value);
    companyProductionMap.set(
      record.company_id,
      toNumber(companyProductionMap.get(record.company_id)) + netValue
    );
    groupProductionValue += netValue;
  }

  const summaryRows = promoters.map((promoter) => {
    const promoterRecords = recordsForPeriod.filter(
      (record) => record.assigned_promoter_id === promoter.id
    );
    const validRecords = promoterRecords.filter(isEligibleProductionRecord);
    const result = monthlyResults.find(
      (row) =>
        row.promoter_id === promoter.id &&
        row.year === latestPeriod.year &&
        row.month === latestPeriod.month
    );
    const target = targets.find(
      (row) =>
        row.promoter_id === promoter.id &&
        row.year === latestPeriod.year &&
        row.month === latestPeriod.month
    );
    const discountValue = discounts
      .filter(
        (row) =>
          row.promoter_id === promoter.id &&
          row.year === latestPeriod.year &&
          row.month === latestPeriod.month &&
          row.apply_to_company !== true
      )
      .reduce((sum, row) => sum + toNumber(row.amount), 0);

    const productionValue = result
      ? toNumber(result.production_value)
      : validRecords.reduce((sum, row) => sum + toNumber(row.net_value), 0);
    const grossValue = validRecords.reduce((sum, row) => sum + toNumber(row.gross_value), 0);
    const insuredGrossValue = validRecords
      .filter((row) => toNumber(row.insurance_value) > 0 || row.has_insurance)
      .reduce((sum, row) => sum + toNumber(row.gross_value), 0);

    const productionCommissionValue = result
      ? toNumber(result.production_commission_value)
      : validRecords.reduce((sum, row) => sum + toNumber(row.promoter_commission_amount), 0);
    const insuranceCommissionValue = result
      ? toNumber(result.insurance_commission_value)
      : validRecords.reduce((sum, row) => sum + toNumber(row.insurance_commission_amount), 0);
    const agreementAdjustmentValue = result ? toNumber(result.agreement_adjustment_value) : 0;
    const finalCommissionValue = result
      ? toNumber(result.final_commission_value)
      : productionCommissionValue + insuranceCommissionValue + agreementAdjustmentValue;

    const targetValue = toNumber(target?.meta);
    const target1Value = toNumber(target?.meta_1);
    const target2Value = toNumber(target?.meta_2);
    const targetStatus =
      result?.target_status ||
      resolveTargetStatus(productionValue, targetValue, target1Value, target2Value);

    return {
      promoter_id: promoter.id,
      promoter_name: promoter.name,
      company_id: promoter.company_id,
      company_name: companyById.get(promoter.company_id || "")?.name || "-",
      company_cnpj: companyById.get(promoter.company_id || "")?.cnpj || "",
      active: promoter.active !== false,
      status: promoter.status || (promoter.active === false ? "DISMISSED" : "ACTIVE"),
      j_keys_count: jKeys.filter((jKey) => jKey.promoter_id === promoter.id).length,
      production_value: productionValue,
      proposal_count: result ? toNumber(result.proposal_count) : validRecords.length,
      insurance_penetration_percent:
        result?.insurance_penetration_percent !== undefined &&
        result?.insurance_penetration_percent !== null
          ? toNumber(result.insurance_penetration_percent)
          : grossValue > 0
            ? (insuredGrossValue / grossValue) * 100
            : 0,
      target_value: targetValue,
      target_1_value: target1Value,
      target_2_value: target2Value,
      target_status: targetStatus,
      production_commission_value: productionCommissionValue,
      insurance_commission_value: insuranceCommissionValue,
      agreement_adjustment_value: agreementAdjustmentValue,
      discount_value: discountValue || toNumber(result?.discount_value),
      final_commission_value: finalCommissionValue,
      payable_commission_value:
        finalCommissionValue - (discountValue || toNumber(result?.discount_value)),
      result_source: result ? "CALCULATED" : "LIVE_BASE",
    };
  });

  const filteredSummaryRows = summaryRows
    .filter((row) => (companyId ? row.company_id === companyId : true))
    .sort((a, b) => b.payable_commission_value - a.payable_commission_value);

  const selectedPromoterId =
    promoterId && filteredSummaryRows.some((row) => row.promoter_id === promoterId)
      ? promoterId
      : "";
  const selectedPromoterSummary =
    filteredSummaryRows.find((row) => row.promoter_id === selectedPromoterId) || null;
  const visibleSummaryRows = selectedPromoterId
    ? filteredSummaryRows.filter((row) => row.promoter_id === selectedPromoterId)
    : filteredSummaryRows;
  const recordsById = new Map(recordsForPeriod.map((record) => [record.id, record]));

  const agreementRows = agreements
    .filter(
      (row) =>
        row.promoter_id === selectedPromoterId &&
        row.year === latestPeriod.year &&
        row.month === latestPeriod.month &&
        isMeaningfulAgreement(row)
    )
    .map((row) => ({
      id: row.id,
      agreement_type: row.agreement_type,
      commission_type: row.commission_type || "PERCENT",
      commission_value: toNumber(row.commission_value),
      notes: String(row.notes || ""),
    }));

  const discountRows = discounts
    .filter(
      (row) =>
        row.promoter_id === selectedPromoterId &&
        row.year === latestPeriod.year &&
        row.month === latestPeriod.month
    )
    .map((row) => ({
      id: row.id,
      daily_production_record_id: row.daily_production_record_id || null,
      proposal_number:
        recordsById.get(row.daily_production_record_id || "")?.proposal_number || "-",
      discount_type: String(row.discount_type || "OUTROS"),
      amount: toNumber(row.amount),
      installments: Math.max(1, toNumber(row.installments) || 1),
      installment_number: Math.max(1, toNumber(row.installment_number) || 1),
      apply_to_company: row.apply_to_company === true,
      notes: String(row.notes || ""),
    }))
    .sort((a, b) => b.amount - a.amount);

  const proposalRows = selectedPromoterId
    ? recordsForPeriod
        .filter(
          (record) =>
            record.assigned_promoter_id === selectedPromoterId &&
            isEligibleProductionRecord(record)
        )
        .map((record) => {
          // CORREÇÃO A — usar produção CONSOLIDADA do grupo, nao por CNPJ.
          const promoterViewCompanyRate = getPromoterViewCompanyRate(
            record,
            groupProductionValue
          );

          return {
            id: record.id,
            contract_number: record.contract_number || record.proposal_number || "-",
            proposal_number: record.proposal_number || "-",
            agency_code: getAgencyCode(record),
            j_key: record.j_key || "",
            promoter_name:
              promoterById.get(record.assigned_promoter_id || "")?.name || "",
            product_description: record.product_description || "-",
            status: record.status || "-",
            movement_date: record.movement_date,
            contract_date: record.contract_date,
            interest_rate: toNumber(record.interest_rate),
            installment_count: toNumber(record.installments || record.term_months),
            company_received_percent: promoterViewCompanyRate,
            company_commission_amount:
              toNumber(record.net_value) * promoterViewCompanyRate,
            srcc_restriction: getSrccRestrictionLabel(record),
            net_value: toNumber(record.net_value),
            gross_value: toNumber(record.gross_value),
            insurance_value: toNumber(record.insurance_value),
            company_insurance_commission_amount: calculateCompanyInsuranceCommission(record),
            insurance_penetration_percent:
              toNumber(selectedPromoterSummary?.insurance_penetration_percent) / 100,
            promoter_commission_percent: toNumber(record.promoter_commission_percent),
            promoter_commission_amount: toNumber(record.promoter_commission_amount),
            insurance_commission_percent: toNumber(record.insurance_commission_percent),
            insurance_commission_amount: toNumber(record.insurance_commission_amount),
            commission_rule_source: record.commission_rule_source || "",
            assigned_promoter_id: record.assigned_promoter_id,
            assigned_promoter_name:
              promoterById.get(record.assigned_promoter_id || "")?.name || "",
            original_promoter_id: record.original_promoter_id,
            original_promoter_name:
              promoterById.get(record.original_promoter_id || "")?.name || "",
          };
        })
    : [];

  const summary = visibleSummaryRows.reduce(
    (acc, row) => {
      acc.promoters += 1;
      acc.production += row.production_value;
      acc.finalCommission += row.final_commission_value;
      acc.payableCommission += row.payable_commission_value;
      acc.discounts += row.discount_value;
      acc.insurancePenetration += row.insurance_penetration_percent;
      return acc;
    },
    {
      promoters: 0,
      production: 0,
      finalCommission: 0,
      payableCommission: 0,
      discounts: 0,
      insurancePenetration: 0,
    }
  );

  return {
    periods,
    selectedPeriod: latestPeriod,
    selectedPromoterId,
    selectedCompanyId: companyId,
    summary: {
      promoters: summary.promoters,
      production: summary.production,
      finalCommission: summary.finalCommission,
      payableCommission: summary.payableCommission,
      discounts: summary.discounts,
      averageInsurancePenetration:
        summary.promoters > 0 ? summary.insurancePenetration / summary.promoters : 0,
    },
    summaryRows: visibleSummaryRows,
    proposalRows,
    agreementRows,
    discountRows,
    promoterOptions: filteredSummaryRows.map((row) => ({
      id: row.promoter_id,
      name: row.promoter_name,
    })),
    promoterLookup: promoters.map((promoter) => ({
      id: promoter.id,
      name: promoter.name,
    })),
    companies,
  };
}

