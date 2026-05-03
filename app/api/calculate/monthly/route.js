import { createClient } from "@supabase/supabase-js";
import { clearMemoryCache } from "@/lib/memoryCache";
import { findImportedProductionRule } from "@/lib/promoterRemuneration";
import { calcularOperacao, getProductionBandByValue } from "@/lib/motor";
import { getProductionWindow } from "@/lib/productionPeriod";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = String(value).trim();
  const normalized = raw.includes(",")
    ? raw.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")
    : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function toPercentUnits(value) {
  const parsed = toNumber(value);
  if (!parsed) return 0;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

function toPercentRate(value) {
  const parsed = toNumber(value);
  if (!parsed) return 0;
  return Math.abs(parsed) > 1 ? parsed / 100 : parsed;
}

const DEFAULT_PROMOTER_SHARE_PERCENT = 58.33;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function readRawPayloadValue(record, aliases) {
  const payload = record?.raw_payload;
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

function getPersistedCompanyReceivedPercent(record, fallbackImportedRule) {
  const rawPercent = toPercentUnits(
    readRawPayloadValue(record, [
      "% A VISTA",
      "% À VISTA",
      "% A VISTA EMPRESA",
      "% AVISTA",
      "PERCENTUAL A VISTA",
    ])
  );

  if (rawPercent > 0 && rawPercent <= 6.5) {
    return rawPercent;
  }

  const storedPercent = toPercentUnits(record.company_received_percent);
  if (storedPercent > 0 && storedPercent <= 6.5) {
    return storedPercent;
  }

  const importedPercent = toPercentUnits(fallbackImportedRule?.received_percent);
  if (importedPercent > 0 && importedPercent <= 6.5) {
    return importedPercent;
  }

  return 0;
}

function deriveCompanyReceivedPercentFromMotor(record, companyProductionValue) {
  const netValue = toNumber(record.net_value);
  if (netValue <= 0) return 0;

  const rawProductCode = readRawPayloadValue(record, [
    "Produto",
    "Codigo Produto",
  ]);
  const rawConvenioCode = readRawPayloadValue(record, [
    "Codigo Convenio",
    "Codigo do Convenio",
    "Cod Convenio",
    "Convenio",
  ]);
  const rawConvenioType = readRawPayloadValue(record, [
    "Tipo Convenio",
    "Tipo de Convenio",
  ]);
  const rawConvenioSegment = readRawPayloadValue(record, [
    "Segmento Convenio",
    "Convenio Segmento",
  ]);
  const rawInsuranceType = readRawPayloadValue(record, ["Tipo Seguro"]);

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
        : record.product_code,
    product_description: record.product_description,
    convenio_code:
      typeof rawConvenioCode === "string" || typeof rawConvenioCode === "number"
        ? rawConvenioCode
        : record.convenio_code,
    convenio_type:
      typeof rawConvenioType === "string"
        ? rawConvenioType
        : record.convenio_type,
    convenio_segment:
      typeof rawConvenioSegment === "string" ||
      typeof rawConvenioSegment === "number"
        ? rawConvenioSegment
        : record.convenio_segment,
    insurance_type:
      typeof rawInsuranceType === "string"
        ? rawInsuranceType
        : record.insurance_type,
    production_value: companyProductionValue,
    movement_date: record.movement_date,
    contract_date: record.contract_date,
    proposal_date: record.proposal_date,
  });

  const avistaEmpresa = toNumber(operation?.credito?.avista_empresa);
  if (avistaEmpresa <= 0) return 0;

  return (avistaEmpresa / netValue) * 100;
}

function getMonthRange(year, month) {
  const window = getProductionWindow(year, month);
  return {
    start: window.start,
    end: window.endExclusive,
  };
}

function countBusinessDaysInMonth(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  let count = 0;

  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, month - 1, day);
    const weekDay = date.getDay();
    if (weekDay !== 0 && weekDay !== 6) count += 1;
  }

  return count;
}

function countElapsedBusinessDays(year, month) {
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() + 1 === month;

  const limitDay = isCurrentMonth
    ? today.getDate()
    : new Date(year, month, 0).getDate();

  let count = 0;

  for (let day = 1; day <= limitDay; day += 1) {
    const date = new Date(year, month - 1, day);
    const weekDay = date.getDay();
    if (weekDay !== 0 && weekDay !== 6) count += 1;
  }

  return Math.max(count, 1);
}

function getProductionBand(value) {
  if (value >= 20000000) return "FAIXA_5";
  if (value >= 7000000) return "FAIXA_4";
  if (value >= 3000000) return "FAIXA_3";
  if (value >= 1000000) return "FAIXA_2";
  return "FAIXA_1";
}

function isCancelledStatus(status) {
  const s = normalizeText(status);
  return s.includes("CANCEL") || s.includes("ESTORN") || s.includes("RECUS");
}

function isPendingStatus(status) {
  const s = normalizeText(status);
  return s.includes("PEND") || s.includes("ANALIS") || s.includes("PROCESS");
}

function isProductionStatus(status) {
  const s = normalizeText(status);
  return s === "PRODUCAO" || s === "PRODUCTION";
}

function isRenewedStatus(status, productDescription) {
  const s = normalizeText(status);
  const p = normalizeText(productDescription);
  return s.includes("RENOVA") || p.includes("RENOVA");
}

function isValidRecord(record) {
  if (record.cancellation_date) return false;
  if (isCancelledStatus(record.status)) return false;
  if (isPendingStatus(record.status)) return false;
  if (record.is_srcc_restricted) return false;
  return true;
}

function calculateInsurancePenetration(productionValue, insuredValue) {
  if (productionValue <= 0) return 0;
  return (insuredValue / productionValue) * 100;
}

function getInsuranceCompanyRate(record) {
  const insuranceType = normalizeText(record.insurance_type);
  const prazo = Number(record.term_months || 0);

  if (insuranceType.includes("ESTOQUE")) return 0.15;
  if (prazo >= 85) return 0.55;
  if (prazo >= 61) return 0.4;
  if (prazo >= 37) return 0.25;
  return 0.15;
}

function calculateCompanyInsuranceCommission(record) {
  const gross = toNumber(record.gross_value);

  if (!gross) return 0;
  if (!toNumber(record.insurance_value) && !record.has_insurance) return 0;

  return gross * (getInsuranceCompanyRate(record) / 100);
}

function pickCommissionRow(rows, metricValue) {
  const ordered = [...rows].sort(
    (a, b) => toNumber(a.range_from) - toNumber(b.range_from)
  );

  return (
    ordered.find((row) => {
      const from = toNumber(row.range_from);
      const to = row.range_to === null ? null : toNumber(row.range_to);
      if (metricValue < from) return false;
      if (to !== null && metricValue > to) return false;
      return true;
    }) || null
  );
}

function calculatePercentValue(baseValue, percent) {
  return toNumber(baseValue) * toPercentRate(percent);
}

function getDefaultPromoterPercentFromCompany(companyReceivedPercent) {
  const companyPercent = toPercentUnits(companyReceivedPercent);
  if (!companyPercent || companyPercent <= 0) return 0;
  return Math.min(
    companyPercent * toPercentRate(DEFAULT_PROMOTER_SHARE_PERCENT),
    5.8
  );
}

function isMeaningfulImportedProductionRule(rule) {
  if (!rule) return false;
  const promoterPercent = toPercentUnits(rule.promoter_percent);
  const receivedPercent = toPercentUnits(rule.received_percent);
  return promoterPercent > 0 || receivedPercent > 0;
}

function isMeaningfulAgreement(agreement) {
  if (!agreement || agreement.active === false) return false;
  const value = toNumber(agreement.commission_value);
  return value > 0;
}

function resolveTargetStatus(productionValue, target, target1, target2) {
  if (target2 > 0 && productionValue >= target2) return "META_2";
  if (target1 > 0 && productionValue >= target1) return "META_1";
  if (target > 0 && productionValue >= target) return "META";
  return "BELOW_META";
}

function groupByCompany(records) {
  const map = new Map();
  for (const record of records) {
    if (!record.company_id) continue;
    if (!map.has(record.company_id)) map.set(record.company_id, []);
    map.get(record.company_id).push(record);
  }
  return map;
}

function groupByPromoter(records) {
  const map = new Map();
  for (const record of records) {
    const promoterId = record.assigned_promoter_id;
    if (!promoterId) continue;
    if (!map.has(promoterId)) map.set(promoterId, []);
    map.get(promoterId).push(record);
  }
  return map;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function getLatestImportedPromoterRemuneration(supabase, year, month) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("payload, created_at")
    .eq("entity_name", "promoter_remuneration_table")
    .eq("action", "IMPORT")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  return (
    (data || []).find(
      (row) =>
        Number(row?.payload?.year) === Number(year) &&
        Number(row?.payload?.month) === Number(month)
    )?.payload || null
  );
}

async function fetchAllPaged(baseQueryBuilder) {
  let from = 0;
  const pageSize = 1000;
  const all = [];

  while (true) {
    const { data, error } = await baseQueryBuilder().range(
      from,
      from + pageSize - 1
    );

    if (error) throw error;
    if (!data || data.length === 0) break;

    all.push(...data);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

function calculateCompanyExpectedValues(records) {
  let grossProduction = 0;
  let netValidProduction = 0;
  let cancelledValue = 0;
  let pendingValue = 0;
  let renewedValue = 0;
  let expectedCashCommission = 0;
  let expectedInsuranceCommission = 0;
  let expectedPrtCommission = 0;

  for (const record of records) {
    const gross = toNumber(record.gross_value);
    const net = toNumber(record.net_value);
    grossProduction += gross;

    if (isCancelledStatus(record.status) || record.cancellation_date) {
      cancelledValue += net;
      continue;
    }

    if (isPendingStatus(record.status)) {
      pendingValue += net;
      continue;
    }

    if (isRenewedStatus(record.status, record.product_description)) {
      renewedValue += net;
    }

    if (isValidRecord(record)) {
      netValidProduction += net;
    }
  }

  const band = getProductionBandByValue(netValidProduction);

  for (const record of records) {
    if (!isValidRecord(record) || !isProductionStatus(record.status)) {
      continue;
    }

    const gross = toNumber(record.gross_value);
    const net = toNumber(record.net_value);

    const result = calcularOperacao({
      valor_liquido: net,
      valor_bruto: gross,
      valor_seguro: toNumber(record.insurance_value),
      taxa_juros: toNumber(record.interest_rate),
      prazo: toNumber(record.term_months),
      tem_seguro:
        toNumber(record.insurance_value) > 0 || Boolean(record.has_insurance),
      product_code: record.product_code,
      product_description: record.product_description,
      convenio_code: record.convenio_code,
      convenio_type: record.convenio_type,
      convenio_segment: record.convenio_segment,
      company_cash_percent: record.company_received_percent,
      production_value: netValidProduction,
      insurance_type: record.insurance_type,
      movement_date: record.movement_date,
      contract_date: record.contract_date,
      proposal_date: record.proposal_date,
    });

    expectedCashCommission += toNumber(result.credito.avista_empresa);
    expectedPrtCommission += toNumber(result.credito.diferido);
    expectedInsuranceCommission += toNumber(result.seguro.empresa);
  }

  return {
    grossProduction,
    netValidProduction,
    cancelledValue,
    pendingValue,
    renewedValue,
    productionBand: band,
    expectedCashCommission,
    expectedInsuranceCommission,
    expectedPrtCommission,
    expectedTotal:
      expectedCashCommission +
      expectedInsuranceCommission +
      expectedPrtCommission,
  };
}

function chooseMonthlyDefaultPercent({
  productionValue,
  targetStatus,
  productionRows,
}) {
  const baseRow = pickCommissionRow(productionRows, productionValue);
  if (!baseRow) return 0;

  let percent = toNumber(baseRow.commission_value);
  percent = toPercentUnits(percent);

  if (targetStatus === "META_1") {
    percent = Math.min(percent + 0.1, 5.8);
  } else if (targetStatus === "META_2") {
    percent = Math.min(percent + 0.2, 5.8);
  }

  return Math.min(percent, 5.8);
}

function findProductRule(productRules, record) {
  const code = normalizeText(record.product_code);
  const desc = normalizeText(record.product_description);
  const received = toPercentUnits(record.company_received_percent);

  const matchingRules = productRules.filter((rule) => {
    const ruleCode = normalizeText(rule.product_code);
    const ruleDesc = normalizeText(rule.product_description);

    const matchesProduct =
      (!ruleCode && !ruleDesc) ||
      (ruleCode && code && ruleCode === code) ||
      (ruleDesc && desc && ruleDesc === desc);

      const from = rule.company_received_percent_from === null
        ? null
        : toPercentUnits(rule.company_received_percent_from);

      const to = rule.company_received_percent_to === null
        ? null
        : toPercentUnits(rule.company_received_percent_to);

    const matchesReceived =
      (from === null && to === null) ||
      ((from === null || received >= from) &&
        (to === null || received <= to));

    return matchesProduct && matchesReceived;
  });

  if (matchingRules.length === 0) return null;

  matchingRules.sort((a, b) => {
    const aSpecificity =
      (a.product_code ? 2 : 0) +
      (a.product_description ? 1 : 0) +
      (a.company_received_percent_from !== null || a.company_received_percent_to !== null ? 4 : 0);

    const bSpecificity =
      (b.product_code ? 2 : 0) +
      (b.product_description ? 1 : 0) +
      (b.company_received_percent_from !== null || b.company_received_percent_to !== null ? 4 : 0);

    return bSpecificity - aSpecificity;
  });

  return matchingRules[0];
}

export async function POST(req) {
  const supabase = getSupabase();

  try {
    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);
    const companyId = body.companyId || null;
    const promoterId = body.promoterId || null;

    if (!year || !month || month < 1 || month > 12) {
      return Response.json(
        { error: "Informe year e month válidos." },
        { status: 400 }
      );
    }

    const { start, end } = getMonthRange(year, month);

    const companies = await fetchAllPaged(() => {
      let query = supabase
        .from("companies")
        .select("id, name, cnpj")
        .eq("active", true);

      if (companyId) query = query.eq("id", companyId);
      return query;
    });

    const dailyRecords = await fetchAllPaged(() => {
      let query = supabase
        .from("daily_production_records")
        .select(`
          id,
          company_id,
          assigned_promoter_id,
          proposal_number,
          contract_number,
          product_code,
          product_description,
          gross_value,
          net_value,
          insurance_value,
          insurance_type,
          has_insurance,
          status,
          proposal_date,
          movement_date,
          cancellation_date,
          is_srcc_restricted,
          term_months,
          company_received_percent,
          convenio_code,
          convenio_type,
          convenio_segment,
          interest_rate,
          raw_payload
        `)
        .gte("movement_date", start)
        .lt("movement_date", end);

      if (companyId) query = query.eq("company_id", companyId);
      if (promoterId) query = query.eq("assigned_promoter_id", promoterId);
      return query;
    });

    const promoters = await fetchAllPaged(() => {
      let query = supabase
        .from("promoters")
        .select("id, company_id, name, active")
        .eq("active", true);

      if (companyId) query = query.eq("company_id", companyId);
      if (promoterId) query = query.eq("id", promoterId);
      return query;
    });

    const targets = await fetchAllPaged(() => {
      let query = supabase
        .from("monthly_targets")
        .select("*")
        .eq("year", year)
        .eq("month", month);

      if (companyId) query = query.eq("company_id", companyId);
      if (promoterId) query = query.eq("promoter_id", promoterId);
      return query;
    });

    const agreements = await fetchAllPaged(() => {
      let query = supabase
        .from("promoter_agreements")
        .select("*")
        .eq("year", year)
        .eq("month", month)
        .eq("active", true);

      if (companyId) query = query.eq("company_id", companyId);
      if (promoterId) query = query.eq("promoter_id", promoterId);
      return query;
    });

    const commissionTables = await fetchAllPaged(() => {
      let query = supabase
        .from("commission_tables")
        .select("id, company_id, year, month, active, version")
        .eq("year", year)
        .eq("month", month)
        .eq("active", true);

      if (companyId) query = query.eq("company_id", companyId);
      return query;
    });

    const tableIds = commissionTables.map((t) => t.id);

    let commissionRows = [];
    if (tableIds.length > 0) {
      commissionRows = await fetchAllPaged(() =>
        supabase
          .from("commission_table_rows")
          .select("*")
          .in("commission_table_id", tableIds)
      );
    }

    const productRules = await fetchAllPaged(() => {
      let query = supabase
        .from("promoter_product_commissions")
        .select("*")
        .eq("year", year)
        .eq("month", month)
        .eq("active", true);

      if (companyId) query = query.eq("company_id", companyId);
      if (promoterId) query = query.eq("promoter_id", promoterId);
      return query;
    });

    const importedPromoterRemuneration = await getLatestImportedPromoterRemuneration(
      supabase,
      year,
      month
    );

    const proposalRules = await fetchAllPaged(() =>
      {
        let query = supabase
          .from("promoter_proposal_commissions")
          .select("*")
          .eq("active", true);

        if (promoterId) query = query.eq("promoter_id", promoterId);
        return query;
      }
    );

    const hasPromoterRemunerationBase =
      !!importedPromoterRemuneration ||
      commissionTables.length > 0 ||
      productRules.length > 0 ||
      proposalRules.length > 0 ||
      agreements.length > 0;

    const companyGroups = groupByCompany(dailyRecords);
    const expectedClosingsUpserts = [];
    const companyExpectedMap = new Map();

    for (const company of companies) {
      const records = companyGroups.get(company.id) || [];
      const expected = calculateCompanyExpectedValues(records);
      companyExpectedMap.set(company.id, expected);

      expectedClosingsUpserts.push({
        company_id: company.id,
        year,
        month,
        gross_production: expected.grossProduction,
        net_valid_production: expected.netValidProduction,
        cancelled_value: expected.cancelledValue,
        pending_value: expected.pendingValue,
        renewed_value: expected.renewedValue,
        production_band: expected.productionBand,
        expected_cash_commission: expected.expectedCashCommission,
        expected_insurance_commission: expected.expectedInsuranceCommission,
        expected_prt_commission: expected.expectedPrtCommission,
        expected_total: expected.expectedTotal,
        calculated_at: new Date().toISOString(),
      });
    }

    if (expectedClosingsUpserts.length > 0) {
      const { error } = await supabase
        .from("monthly_expected_closings")
        .upsert(expectedClosingsUpserts, {
          onConflict: "company_id,year,month",
        });

      if (error) throw error;
    }

    const promoterGroups = groupByPromoter(dailyRecords);
    const promoterUpserts = [];
    const recordUpdates = [];
    let unmatchedImportedRules = 0;

    const elapsedBusinessDays = countElapsedBusinessDays(year, month);
    const totalBusinessDays = countBusinessDaysInMonth(year, month);

    for (const promoter of promoters) {
      const records = promoterGroups.get(promoter.id) || [];
      const validRecords = records.filter(
        (record) => isProductionStatus(record.status) && isValidRecord(record)
      );

      const productionValue = validRecords.reduce(
        (sum, record) => sum + toNumber(record.net_value),
        0
      );

      const grossProductionValue = validRecords.reduce(
        (sum, record) => sum + toNumber(record.gross_value),
        0
      );

      const proposalCount = validRecords.length;

      const insuredRecords = validRecords.filter(
        (record) => toNumber(record.insurance_value) > 0 || record.has_insurance
      );

      const insuredProposalCount = insuredRecords.length;
      const insuredProductionValue = insuredRecords.reduce(
        (sum, record) => sum + toNumber(record.net_value),
        0
      );

      const insuredGrossValue = insuredRecords.reduce(
        (sum, record) => sum + toNumber(record.gross_value),
        0
      );

      const insurancePenetrationPercent = calculateInsurancePenetration(
        grossProductionValue,
        insuredGrossValue
      );

      const target = targets.find((t) => t.promoter_id === promoter.id);
      const targetValue = target ? toNumber(target.meta) : 0;
      const target1Value = target ? toNumber(target.meta_1) : 0;
      const target2Value = target ? toNumber(target.meta_2) : 0;

      const projectedProductionValue =
        elapsedBusinessDays > 0
          ? (productionValue / elapsedBusinessDays) * totalBusinessDays
          : productionValue;

      const targetStatus = resolveTargetStatus(
        productionValue,
        targetValue,
        target1Value,
        target2Value
      );

      const companyTable = commissionTables
        .filter((t) => t.company_id === promoter.company_id)
        .sort((a, b) => b.version - a.version)[0];

      const rowsForTable = companyTable
        ? commissionRows.filter((r) => r.commission_table_id === companyTable.id)
        : [];

      const productionRows = rowsForTable.filter(
        (r) => r.rule_type === "PRODUCTION"
      );

      const insuranceRows = rowsForTable.filter(
        (r) => r.rule_type === "INSURANCE"
      );

      const promoterAgreements = agreements.filter(
        (a) => a.promoter_id === promoter.id && isMeaningfulAgreement(a)
      );
      const productionAgreement = promoterAgreements.find(
        (agreement) => agreement.agreement_type === "PRODUCTION"
      );
      const insuranceAgreement = promoterAgreements.find(
        (agreement) => agreement.agreement_type === "INSURANCE"
      );
      const specialAgreements = promoterAgreements.filter(
        (agreement) => agreement.agreement_type === "SPECIAL"
      );

      const promoterProductRules = productRules.filter(
        (r) => r.promoter_id === promoter.id
      );

      let productionCommissionValue = 0;
      let insuranceCommissionValue = 0;
      let agreementAdjustmentValue = 0;

      for (const record of validRecords) {
        const manualRule = proposalRules.find(
          (r) => r.daily_production_record_id === record.id
        );

        const productRule = manualRule
          ? null
          : findProductRule(promoterProductRules, record);
        const importedRuleCandidate =
          manualRule || productRule
            ? null
            : findImportedProductionRule(
                importedPromoterRemuneration?.productionRules || [],
                record
              );
        const importedRule = isMeaningfulImportedProductionRule(importedRuleCandidate)
          ? importedRuleCandidate
          : null;

        let commissionPercent = 0;
        let insuranceCommissionPercent = 0;
        let productionRuleSource = "MONTHLY_DEFAULT";
        let insuranceRuleSource = "MONTHLY_DEFAULT";
        const companyExpected = companyExpectedMap.get(record.company_id) || null;
        const persistedCompanyReceivedPercent =
          getPersistedCompanyReceivedPercent(
            record,
            importedRule
          ) ||
          deriveCompanyReceivedPercentFromMotor(
            record,
            toNumber(companyExpected?.netValidProduction)
          );

        const effectiveCompanyReceivedPercent = persistedCompanyReceivedPercent;

        if (manualRule && manualRule.commission_percent !== null) {
          commissionPercent =
            manualRule.commission_percent !== null
              ? Math.min(toPercentUnits(manualRule.commission_percent), 5.8)
              : 0;
          productionRuleSource = "MANUAL_PROPOSAL";
        } else if (productRule && productRule.commission_percent !== null) {
          commissionPercent = Math.min(
            toPercentUnits(productRule.commission_percent),
            5.8
          );
          productionRuleSource = "PRODUCT_RULE";
        } else if (productionAgreement) {
          if (
            normalizeText(productionAgreement.commission_type) ===
            "SHARE_OF_COMPANY"
          ) {
            const shareRate = toPercentRate(productionAgreement.commission_value);
            const basePercent =
              effectiveCompanyReceivedPercent > 0
                ? effectiveCompanyReceivedPercent
                : commissionPercent;

            commissionPercent = Math.min(basePercent * shareRate, 5.8);
          } else {
            commissionPercent = Math.min(
              toPercentUnits(productionAgreement.commission_value),
              5.8
            );
          }
          productionRuleSource = "PROMOTER_AGREEMENT";
        } else {
          if (importedRule) {
            commissionPercent = Math.min(
              toPercentUnits(importedRule.promoter_percent),
              5.8
            );
            productionRuleSource = "IMPORTED_MONTHLY_TABLE";
          } else if (effectiveCompanyReceivedPercent > 0) {
            commissionPercent = getDefaultPromoterPercentFromCompany(
              effectiveCompanyReceivedPercent
            );
            productionRuleSource = "DEFAULT_SHARE_OF_COMPANY";
          } else {
            commissionPercent = chooseMonthlyDefaultPercent({
              productionValue,
              targetStatus,
              productionRows,
            });

            if (!commissionPercent) {
              unmatchedImportedRules += 1;
            }

            productionRuleSource = "MONTHLY_DEFAULT";
          }
        }

        if (
          manualRule &&
          manualRule.insurance_commission_percent !== null
        ) {
          insuranceCommissionPercent = toPercentUnits(
            manualRule.insurance_commission_percent
          );
          insuranceRuleSource = "MANUAL_PROPOSAL";
        } else if (
          productRule &&
          productRule.insurance_commission_percent !== null
        ) {
          insuranceCommissionPercent = toPercentUnits(
            productRule.insurance_commission_percent
          );
          insuranceRuleSource = "PRODUCT_RULE";
        } else if (insuranceAgreement) {
          insuranceCommissionPercent = toPercentUnits(
            insuranceAgreement.commission_value
          );
          insuranceRuleSource = "PROMOTER_AGREEMENT";
        } else {
          const insuranceMetricValue =
            insuranceRows.length > 0 &&
            insuranceRows[0].metric_type === "VALUE"
              ? insuredGrossValue
              : insuranceRows.length > 0 &&
                insuranceRows[0].metric_type === "COUNT"
              ? insuredProposalCount
              : insurancePenetrationPercent;

          const insuranceRow = pickCommissionRow(
            insuranceRows,
            insuranceMetricValue
          );

          insuranceCommissionPercent = insuranceRow
            ? toPercentUnits(insuranceRow.commission_value)
            : 0;
          insuranceRuleSource = "MONTHLY_DEFAULT";
        }

        const productionBase = toNumber(record.net_value);
        const insuranceBase = calculateCompanyInsuranceCommission(record);

        let promoterCommissionAmount = calculatePercentValue(
          productionBase,
          commissionPercent
        );

        let insuranceCommissionAmount = calculatePercentValue(
          insuranceBase,
          insuranceCommissionPercent
        );

        for (const agreement of specialAgreements) {
          if (agreement.agreement_type === "SPECIAL") {
            agreementAdjustmentValue += calculatePercentValue(
              productionBase,
              agreement.commission_type === "PERCENT"
                ? toNumber(agreement.commission_value)
                : 0
            );

            if (agreement.commission_type === "FIXED") {
              agreementAdjustmentValue += toNumber(agreement.commission_value);
            }
          }
        }

        const commissionRuleSource =
          productionRuleSource === insuranceRuleSource
            ? productionRuleSource
            : `${productionRuleSource}+${insuranceRuleSource}`;

        productionCommissionValue += promoterCommissionAmount;
        insuranceCommissionValue += insuranceCommissionAmount;

        recordUpdates.push({
          id: record.id,
          company_id: record.company_id,
          proposal_number: record.proposal_number,
          company_received_percent: persistedCompanyReceivedPercent,
          promoter_commission_percent: commissionPercent,
          promoter_commission_amount: promoterCommissionAmount,
          insurance_commission_percent: insuranceCommissionPercent,
          insurance_commission_amount: insuranceCommissionAmount,
          commission_rule_source: commissionRuleSource,
        });
      }

      const finalCommissionValue =
        productionCommissionValue +
        insuranceCommissionValue +
        agreementAdjustmentValue;

      promoterUpserts.push({
        promoter_id: promoter.id,
        company_id: promoter.company_id,
        year,
        month,
        production_value: productionValue,
        proposal_count: proposalCount,
        insured_proposal_count: insuredProposalCount,
        insured_production_value: insuredProductionValue,
        insurance_penetration_percent: insurancePenetrationPercent,
        target_value: targetValue,
        target_1_value: target1Value,
        target_2_value: target2Value,
        projected_production_value: projectedProductionValue,
        production_commission_value: productionCommissionValue,
        insurance_commission_value: insuranceCommissionValue,
        agreement_adjustment_value: agreementAdjustmentValue,
        final_commission_value: finalCommissionValue,
        target_status: targetStatus,
        calculated_at: new Date().toISOString(),
      });
    }

    if (promoterUpserts.length > 0) {
      const { error } = await supabase
        .from("promoter_monthly_results")
        .upsert(promoterUpserts, {
          onConflict: "promoter_id,year,month",
        });

      if (error) throw error;
    }

    if (recordUpdates.length > 0) {
      for (const chunk of chunkArray(recordUpdates, 200)) {
        const { error } = await supabase
          .from("daily_production_records")
          .upsert(chunk, {
            onConflict: "id",
          });

        if (error) throw error;
      }
    }

    clearMemoryCache("closing:");
    clearMemoryCache("financial:");
    clearMemoryCache("promoters:");
    clearMemoryCache("dashboard:");

    return Response.json({
      success: true,
      year,
      month,
      companies_calculated: expectedClosingsUpserts.length,
      promoters_calculated: promoterUpserts.length,
      unmatched_imported_rules: unmatchedImportedRules,
      remuneration_base_mode: hasPromoterRemunerationBase
        ? "MONTH_RULES_OR_AGREEMENTS"
        : "DEFAULT_SHARE_ONLY",
      message:
        "Cálculo mensal concluído com regra por produto e percentual recebido.",
    });
  } catch (error) {
    return Response.json(
      {
        error: error.message || "Erro ao calcular fechamento mensal.",
      },
      { status: 500 }
    );
  }
}
