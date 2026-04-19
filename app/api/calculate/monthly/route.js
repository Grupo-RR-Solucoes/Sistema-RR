import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const normalized = String(value).replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value) {
  return String(value || "").trim().toUpperCase();
}

function getMonthRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
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
  return toNumber(baseValue) * (toNumber(percent) / 100);
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
  let expectedInsuranceCommission = 0;

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

    if (toNumber(record.insurance_value) > 0 && gross > 0 && record.term_months) {
      const prazo = Number(record.term_months);
      let rate = 0.15;

      if (prazo >= 37 && prazo <= 60) rate = 0.25;
      else if (prazo >= 61 && prazo <= 84) rate = 0.4;
      else if (prazo >= 85) rate = 0.55;

      expectedInsuranceCommission += gross * (rate / 100);
    }
  }

  const band = getProductionBand(netValidProduction);
  const expectedCashCommission = 0;
  const expectedPrtCommission = 0;

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

  // Gatilho simples para meta/meta1/meta2
  // Aqui você pode depois sofisticar com percentuais específicos por faixa.
  if (targetStatus === "META_1") {
    percent = Math.min(percent + 0.1, 5.8);
  } else if (targetStatus === "META_2") {
    percent = Math.min(percent + 0.2, 5.8);
  }

  return percent;
}

function findProductRule(productRules, record) {
  const code = normalizeText(record.product_code);
  const desc = normalizeText(record.product_description);

  return (
    productRules.find((rule) => {
      const ruleCode = normalizeText(rule.product_code);
      const ruleDesc = normalizeText(rule.product_description);

      if (ruleCode && code && ruleCode === code) return true;
      if (ruleDesc && desc && ruleDesc === desc) return true;
      return false;
    }) || null
  );
}

export async function POST(req) {
  const supabase = getSupabase();

  try {
    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);
    const companyId = body.companyId || null;

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
          has_insurance,
          status,
          proposal_date,
          movement_date,
          cancellation_date,
          is_srcc_restricted,
          term_months
        `)
        .gte("movement_date", start)
        .lt("movement_date", end);

      if (companyId) query = query.eq("company_id", companyId);
      return query;
    });

    const promoters = await fetchAllPaged(() => {
      let query = supabase
        .from("promoters")
        .select("id, company_id, name, active")
        .eq("active", true);

      if (companyId) query = query.eq("company_id", companyId);
      return query;
    });

    const targets = await fetchAllPaged(() => {
      let query = supabase
        .from("monthly_targets")
        .select("*")
        .eq("year", year)
        .eq("month", month);

      if (companyId) query = query.eq("company_id", companyId);
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
      return query;
    });

    const proposalRules = await fetchAllPaged(() => {
      let query = supabase
        .from("promoter_proposal_commissions")
        .select("*")
        .eq("active", true);

      return query;
    });

    // 1) Fechamento empresa
    const companyGroups = groupByCompany(dailyRecords);
    const expectedClosingsUpserts = [];

    for (const company of companies) {
      const records = companyGroups.get(company.id) || [];
      const expected = calculateCompanyExpectedValues(records);

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

    // 2) Promotores e detalhe por proposta
    const promoterGroups = groupByPromoter(dailyRecords);
    const promoterUpserts = [];

    const elapsedBusinessDays = countElapsedBusinessDays(year, month);
    const totalBusinessDays = countBusinessDaysInMonth(year, month);

    for (const promoter of promoters) {
      const records = promoterGroups.get(promoter.id) || [];
      const validRecords = records.filter(isValidRecord);

      const productionValue = validRecords.reduce(
        (sum, record) => sum + toNumber(record.net_value),
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

      const insurancePenetrationPercent = calculateInsurancePenetration(
        productionValue,
        insuredProductionValue
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
        (a) => a.promoter_id === promoter.id && a.active !== false
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

        let commissionPercent = 0;
        let insuranceCommissionPercent = 0;
        let commissionRuleSource = "MONTHLY_DEFAULT";

        if (manualRule) {
          commissionPercent =
            manualRule.commission_percent !== null
              ? toNumber(manualRule.commission_percent)
              : 0;

          insuranceCommissionPercent =
            manualRule.insurance_commission_percent !== null
              ? toNumber(manualRule.insurance_commission_percent)
              : 0;

          commissionRuleSource = "MANUAL_PROPOSAL";
        } else if (productRule) {
          commissionPercent = toNumber(productRule.commission_percent);
          insuranceCommissionPercent = toNumber(
            productRule.insurance_commission_percent
          );
          commissionRuleSource = "PRODUCT_RULE";
        } else {
          commissionPercent = chooseMonthlyDefaultPercent({
            productionValue,
            targetStatus,
            productionRows,
          });

          const insuranceMetricValue =
            insuranceRows.length > 0 &&
            insuranceRows[0].metric_type === "VALUE"
              ? insuredProductionValue
              : insuranceRows.length > 0 &&
                insuranceRows[0].metric_type === "COUNT"
              ? insuredProposalCount
              : insurancePenetrationPercent;

          const insuranceRow = pickCommissionRow(
            insuranceRows,
            insuranceMetricValue
          );

          insuranceCommissionPercent = insuranceRow
            ? toNumber(insuranceRow.commission_value)
            : 0;

          commissionRuleSource = "MONTHLY_DEFAULT";
        }

        const productionBase = toNumber(record.gross_value);
        const insuranceBase = toNumber(record.insurance_value);

        let promoterCommissionAmount = calculatePercentValue(
          productionBase,
          commissionPercent
        );

        let insuranceCommissionAmount = calculatePercentValue(
          insuranceBase,
          insuranceCommissionPercent
        );

        // Acordos individuais sobrescrevem a base padrão
        for (const agreement of promoterAgreements) {
          if (agreement.agreement_type === "PRODUCTION") {
            commissionPercent = toNumber(agreement.commission_value);
            promoterCommissionAmount = calculatePercentValue(
              productionBase,
              commissionPercent
            );
            commissionRuleSource = "AGREEMENT";
          } else if (agreement.agreement_type === "INSURANCE") {
            insuranceCommissionPercent = toNumber(agreement.commission_value);
            insuranceCommissionAmount = calculatePercentValue(
              insuranceBase,
              insuranceCommissionPercent
            );
            commissionRuleSource = "AGREEMENT";
          } else if (agreement.agreement_type === "SPECIAL") {
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

        productionCommissionValue += promoterCommissionAmount;
        insuranceCommissionValue += insuranceCommissionAmount;

        const { error: updateRecordError } = await supabase
          .from("daily_production_records")
          .update({
            promoter_commission_percent: commissionPercent,
            promoter_commission_amount: promoterCommissionAmount,
            insurance_commission_percent: insuranceCommissionPercent,
            insurance_commission_amount: insuranceCommissionAmount,
            commission_rule_source: commissionRuleSource,
          })
          .eq("id", record.id);

        if (updateRecordError) throw updateRecordError;
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

    return Response.json({
      success: true,
      year,
      month,
      companies_calculated: expectedClosingsUpserts.length,
      promoters_calculated: promoterUpserts.length,
      message:
        "Cálculo mensal concluído com comissão editável por produto e proposta.",
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
