import type { SupabaseClient } from "@supabase/supabase-js";

import {
  calculateInsuranceCommissionFromRules,
  fetchInsuranceSlipRules,
} from "@/lib/insuranceCalculator";
import { calcularOperacao } from "@/lib/motor";
import type { TrpRegraProvider } from "@/lib/motor";
import { buildTrpCreditProvider } from "@/lib/trp/creditTrpProvider";
import { getPrazoTrp } from "@/lib/prazoTrp";
import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import {
  getAgencyCode as getAgencyCodeShared,
  getSrccRestrictionLabel as getSrccRestrictionLabelShared,
} from "@/lib/proposalDetailing";
import { fetchAllRows } from "@/lib/queryHelpers";
// Resolução de escopo (individual/grupo) extraída p/ módulo compartilhado — o
// recálculo (/api/calculate/monthly) reusa o MESMO resolvedor. Re-exporta os
// sentinelas p/ não quebrar quem importa daqui.
import {
  resolveCompanyScope,
  COMPANY_SCOPE_GROUP_RR,
  COMPANY_SCOPE_GROUP_ADS,
} from "@/lib/companyScope";

export { COMPANY_SCOPE_GROUP_RR, COMPANY_SCOPE_GROUP_ADS };

type CompanyRow = {
  id: string;
  name: string;
  cnpj: string;
  group_name?: string | null;
};

type PromoterRow = {
  id: string;
  company_id?: string | null;
  name: string;
  status?: string | null;
  active?: boolean | null;
  is_master?: boolean | null;
  estado?: string | null;
  supervisor_user_id?: string | null;
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
  source?: string | null;
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
  insurance_type?: string | null;
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
    // Produção TOTAL do grupo = atribuída (production) + master não atribuído.
    // Bate ao centavo com a "Produção do grupo" do Dashboard/Projeção. Só no
    // consolidado do grupo; com um promotor selecionado, productionUnassigned=0.
    productionTotal: number;
    productionUnassigned: number;
    productionUnassignedCount: number;
    finalCommission: number;
    payableCommission: number;
    discounts: number;
    averageInsurancePenetration: number;
    companyGrossCommission: number;
    unassignedCompanyGrossCommission: number;
    unassignedCount: number;
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

function deriveCompanyReceivedRate(
  record: ProductionRow,
  companyProductionValue: number,
  trpProvider?: TrpRegraProvider,
) {
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
    // FIX-PRAZO-TRP: regra Promotiva (J/K) — 3100→Prazo, resto→Parcelas.
    prazo:
      getPrazoTrp(record) ??
      toNumber(record.term_months || record.installments),
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
  }, { trpProvider });

  const avistaEmpresa = toNumber(operation?.credito?.avista_empresa);
  if (avistaEmpresa <= 0) return 0;

  return avistaEmpresa / netValue;
}

function getCompanyReceivedRate(
  record: ProductionRow,
  companyProductionValue: number,
  trpProvider?: TrpRegraProvider,
) {
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

  return deriveCompanyReceivedRate(record, companyProductionValue, trpProvider);
}

function getPromoterViewCompanyRate(
  record: ProductionRow,
  companyProductionValue: number,
  trpProvider?: TrpRegraProvider,
) {
  return capPromoterViewRate(
    getCompanyReceivedRate(record, companyProductionValue, trpProvider)
  );
}

// FIX-3.SEGURO — getInsuranceCompanyRate e calculateCompanyInsuranceCommission
// removidos. Migrados para insurance_slip_rules + calculateInsuranceCommissionFromRules
// (fonte única com route.ts; ver linha company_insurance_commission_amount).

// 4.4-fix-1.B.1: helpers extraidos para lib/proposalDetailing.ts.
// Wrappers locais mantidos com o mesmo nome para preservar
// chamadores internos sem mudar o restante do arquivo.
function getSrccRestrictionLabel(record: ProductionRow) {
  return getSrccRestrictionLabelShared(record);
}

function getAgencyCode(record: ProductionRow) {
  return getAgencyCodeShared(record);
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

// ETAPA 7 — base fetch-once: as 9 queries + summaryRows de TODOS os promotores
// (independente de promotor selecionado). O lote chama isto 1x e fatia N vezes
// com selectPromoterView, em vez de refazer 9 queries por promotor.
export async function loadPromoterAnalyticsBase(
  supabase: SupabaseClient,
  filters?: {
    year?: number;
    month?: number;
    companyId?: string;
    // Regime do mês: FECHADO (true) ou indefinido => pode usar o PMR (CALCULATED).
    // ABERTO (false) => ignora o PMR (snapshot defasado) e força LIVE_BASE (daily
    // ao vivo). Quem decide é o CHAMADOR (via detectClosedMonth). Default sem
    // closed = comportamento anterior (CALCULATED) — preserva dre/projecao.
    closed?: boolean;
    // VIRADA DE TELA — fonte do mês FECHADO: 'cms' (jan-mai, seed) ou 'fechamento'
    // (jun+). PRESENTE => caminho CONSOLIDADO: soma as linhas do PMR por promotor no
    // escopo (sem filtro = fechamento+bbts; grupo/empresa = só as do escopo), em vez
    // do .find() de UMA linha. AUSENTE => comportamento anterior (dre/projecao intactos).
    closedSource?: "cms" | "fechamento";
  }
) {
  const yearParam = filters?.year;
  const monthParam = filters?.month;
  const companyId = filters?.companyId || "";
  const closedSource = filters?.closedSource;

  // companies PRIMEIRO — necessário para resolver o escopo de grupo (Grupo RR / ADS)
  // antes de escopar o daily. Os promotores são buscados SEM filtro de empresa: no
  // fechado a linha vem do PMR (um promotor ADS pode ter home RR), e o recorte por
  // escopo acontece em filteredSummaryRows / na agregação do PMR.
  const companies = await fetchAllRows<CompanyRow>(() =>
    supabase
      .from("companies")
      .select("id, name, cnpj, group_name")
      .order("name", { ascending: true })
  );
  const scope = resolveCompanyScope(companyId, companies);

  const [promoters, jKeys, targets, monthlyResults, discounts, agreements, records, insuranceSlipRules] =
    await Promise.all([
      fetchAllRows<PromoterRow>(() =>
        supabase
          .from("promoters")
          .select("id, company_id, name, status, active, is_master, estado, supervisor_user_id")
          .order("name", { ascending: true })
      ),
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
            "promoter_id, company_id, year, month, production_value, proposal_count, insured_proposal_count, insured_production_value, insurance_penetration_percent, production_commission_value, insurance_commission_value, agreement_adjustment_value, final_commission_value, discount_value, target_status, source"
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
            "id, company_id, j_key, assigned_promoter_id, original_promoter_id, proposal_number, contract_number, product_description, status, movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value, insurance_type, has_insurance, interest_rate, term_months, installments, company_received_percent, is_srcc_restricted, promoter_commission_percent, promoter_commission_amount, insurance_commission_percent, insurance_commission_amount, commission_rule_source, raw_payload"
          )
          .order("movement_date", { ascending: false });

        if (scope.companyIds) {
          query = query.in("company_id", scope.companyIds);
        }

        return query;
      }),
      // FIX-3.SEGURO — carrega TRP §188 / ESTOQUE 1x para passar ao
      // calculateInsuranceCommissionFromRules no loop de records.
      fetchInsuranceSlipRules(supabase),
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

  // TRP self-service: fonte da regra de crédito atrás da flag TRP_SOURCE. Preload
  // async 1x das competências do período (derivadas do contract_date, a MESMA chave
  // do motor); as taxas por registro (getPromoterViewCompanyRate) seguem síncronas.
  // Sem db-source, provider=undefined -> motor lê o JSON (no-op).
  const trpProvider = await buildTrpCreditProvider(
    recordsForPeriod.map((record) => record.contract_date)
  );

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

  // Comissão BRUTA da EMPRESA do grupo no período (company_commission) = ganho
  // da EMPRESA, NÃO o repasse do promotor. net × taxa da empresa, exatamente a
  // mesma getPromoterViewCompanyRate das proposalRows (teto 5,80% + derive TRP
  // p/ registros sem % à vista armazenado). Respeita o filtro de empresa; a
  // derivação da taxa usa a produção CONSOLIDADA do grupo (igual às propostas).
  // unassigned* = parcela do bruto sobre operações AINDA SEM promotor atribuído.
  // Faz parte do bruto (a empresa fatura), mas é o que ainda falta distribuir;
  // encolhe conforme o funcionário atribui na Migração. Exposto p/ o sublabel.
  let companyGrossCommission = 0;
  let unassignedCompanyGrossCommission = 0;
  let unassignedCount = 0;
  // Produção (net) em chave MASTER ainda sem promotor: mesma fonte/criterio do
  // Dashboard (registros PRODUCAO válidos do período, assigned_promoter_id null).
  // Entra só no consolidado do grupo; nenhum promotor individual a recebe.
  let unassignedProduction = 0;
  // Mês FECHADO consolidado (closedSource): esses agregados vêm do PMR, não do
  // daily. Zera aqui — senão a produção master do daily (inclui a SRCC não flagada)
  // vazaria no productionTotal e infla. No fechamento não há órfão (herança resolve).
  if (!closedSource) {
    for (const record of recordsForPeriod) {
      if (scope.companyIds && !scope.companyIds.includes(record.company_id || "")) continue;
      if (!isEligibleProductionRecord(record)) continue;
      const commission =
        toNumber(record.net_value) *
        getPromoterViewCompanyRate(record, groupProductionValue, trpProvider);
      companyGrossCommission += commission;
      if (!record.assigned_promoter_id) {
        unassignedCompanyGrossCommission += commission;
        unassignedProduction += toNumber(record.net_value);
        unassignedCount += 1;
      }
    }
  }

  const summaryRows = promoters.map((promoter) => {
    const promoterRecords = recordsForPeriod.filter(
      (record) => record.assigned_promoter_id === promoter.id
    );
    const validRecords = promoterRecords.filter(isEligibleProductionRecord);
    // Mês ABERTO (filters.closed === false): NÃO usa o PMR (snapshot defasado) —
    // result = undefined força o ramo LIVE_BASE (Σ daily ao vivo), alinhando com a
    // projeção. Fechado (true) ou indefinido: mantém CALCULATED (PMR/cms) — idêntico
    // ao comportamento anterior. Recorte só do mês aberto; não toca histórico fechado.
    const result =
      filters?.closed === false
        ? undefined
        : monthlyResults.find(
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
      estado: promoter.estado ?? null,
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

  // VIRADA — mês FECHADO consolidado: SOMA as linhas do PMR por promotor no escopo,
  // em vez do .find() de UMA linha (que mostrava metade de quem tem RR + ADS).
  // regime 'cms' => só source='cms' (jan-mai); 'fechamento' => source IN
  // ('fechamento','bbts') (jun+). O escopo (grupo/empresa) filtra pelo company_id da
  // PRÓPRIA linha do PMR (não pelo home do promotor) — assim a ADS aparece mesmo p/
  // promotor de home RR (ex.: Kétley). As linhas source='daily' (valor 0) ficam fora.
  const consolidatedSummaryRows = !closedSource
    ? null
    : (() => {
        const regimeSources = closedSource === "cms" ? ["cms"] : ["fechamento", "bbts"];
        type Agg = {
          production_value: number;
          insured_production_value: number;
          proposal_count: number;
          production_commission_value: number;
          insurance_commission_value: number;
          agreement_adjustment_value: number;
          final_commission_value: number;
          discount_value: number;
          target_status: string | null;
          company_id: string | null;
          best_production: number; // p/ escolher company_id/status da linha dominante
        };
        const agg = new Map<string, Agg>();
        for (const row of monthlyResults) {
          if (row.year !== latestPeriod.year || row.month !== latestPeriod.month) continue;
          if (!regimeSources.includes(String(row.source || ""))) continue;
          if (scope.companyIds && !scope.companyIds.includes(row.company_id || "")) continue;
          let a = agg.get(row.promoter_id);
          if (!a) {
            a = {
              production_value: 0,
              insured_production_value: 0,
              proposal_count: 0,
              production_commission_value: 0,
              insurance_commission_value: 0,
              agreement_adjustment_value: 0,
              final_commission_value: 0,
              discount_value: 0,
              target_status: null,
              company_id: null,
              best_production: -1,
            };
            agg.set(row.promoter_id, a);
          }
          const prod = toNumber(row.production_value);
          a.production_value += prod;
          a.insured_production_value += toNumber(row.insured_production_value);
          a.proposal_count += toNumber(row.proposal_count);
          a.production_commission_value += toNumber(row.production_commission_value);
          a.insurance_commission_value += toNumber(row.insurance_commission_value);
          a.agreement_adjustment_value += toNumber(row.agreement_adjustment_value);
          a.final_commission_value += toNumber(row.final_commission_value);
          a.discount_value += toNumber(row.discount_value);
          // company_id/status representativos = os da linha de MAIOR produção
          // (a RR/fechamento domina; a linha ADS não rouba o rótulo).
          if (prod > a.best_production) {
            a.best_production = prod;
            a.company_id = row.company_id ?? null;
            a.target_status = row.target_status ?? a.target_status;
          }
        }
        return [...agg.entries()].map(([pid, a]) => {
          const promoter = promoterById.get(pid);
          const target = targets.find(
            (t) => t.promoter_id === pid && t.year === latestPeriod.year && t.month === latestPeriod.month
          );
          const manualDiscount = discounts
            .filter(
              (d) =>
                d.promoter_id === pid &&
                d.year === latestPeriod.year &&
                d.month === latestPeriod.month &&
                d.apply_to_company !== true
            )
            .reduce((sum, d) => sum + toNumber(d.amount), 0);
          const discountValue = manualDiscount || a.discount_value;
          const targetValue = toNumber(target?.meta);
          const target1Value = toNumber(target?.meta_1);
          const target2Value = toNumber(target?.meta_2);
          return {
            promoter_id: pid,
            promoter_name: promoter?.name ?? "(promotor desconhecido)",
            company_id: a.company_id,
            company_name: companyById.get(a.company_id || "")?.name || "-",
            company_cnpj: companyById.get(a.company_id || "")?.cnpj || "",
            estado: promoter?.estado ?? null,
            active: promoter?.active !== false,
            status: promoter?.status || (promoter?.active === false ? "DISMISSED" : "ACTIVE"),
            j_keys_count: jKeys.filter((jKey) => jKey.promoter_id === pid).length,
            production_value: a.production_value,
            proposal_count: a.proposal_count,
            insurance_penetration_percent:
              a.production_value > 0 ? (a.insured_production_value / a.production_value) * 100 : 0,
            target_value: targetValue,
            target_1_value: target1Value,
            target_2_value: target2Value,
            target_status:
              a.target_status || resolveTargetStatus(a.production_value, targetValue, target1Value, target2Value),
            production_commission_value: a.production_commission_value,
            insurance_commission_value: a.insurance_commission_value,
            agreement_adjustment_value: a.agreement_adjustment_value,
            discount_value: discountValue,
            final_commission_value: a.final_commission_value,
            payable_commission_value: a.final_commission_value - discountValue,
            result_source: "CALCULATED",
          };
        });
      })();

  const filteredSummaryRows = (
    consolidatedSummaryRows ??
    summaryRows.filter((row) =>
      scope.companyIds ? scope.companyIds.includes(row.company_id || "") : true
    )
  ).sort((a, b) => b.payable_commission_value - a.payable_commission_value);

  const recordsById = new Map(recordsForPeriod.map((record) => [record.id, record]));

  return {
    periods,
    latestPeriod,
    companyId,
    companies,
    promoters,
    promoterById,
    filteredSummaryRows,
    recordsForPeriod,
    // ADITIVO — base crua de TODOS os meses (sem recorte por competência) para
    // consumidores que precisam da série histórica (ex.: drill-down da /projecao).
    // recordsForPeriod continua sendo o recorte do mês selecionado (inalterado).
    records,
    targets,
    recordsById,
    groupProductionValue,
    // TRP self-service: provider (db) pre-carregado 1x; repassado a selectPromoterView
    // para as proposalRows usarem a MESMA fonte de crédito (síncrono). undefined em
    // modo json (motor lê o JSON).
    trpProvider,
    companyGrossCommission,
    unassignedCompanyGrossCommission,
    unassignedProduction,
    unassignedCount,
    agreements,
    discounts,
    insuranceSlipRules,
  };
}

// ETAPA 7 — fatia a base pra UM promotor. Reproduz EXATAMENTE o recorte que o
// buildPromoterAnalytics original fazia (proposalRows/discountRows/agreementRows/
// summary), pra que cada relatorio do lote seja bit-a-bit igual ao individual.
export function selectPromoterView(
  base: Awaited<ReturnType<typeof loadPromoterAnalyticsBase>>,
  promoterId?: string,
  options?: { masterUnassigned?: boolean; allUnassigned?: boolean }
): PromoterAnalyticsPayload {
  const {
    periods,
    latestPeriod,
    companyId,
    companies,
    promoters,
    promoterById,
    filteredSummaryRows,
    recordsForPeriod,
    recordsById,
    groupProductionValue,
    trpProvider,
    companyGrossCommission,
    unassignedCompanyGrossCommission,
    unassignedProduction,
    unassignedCount,
    agreements,
    discounts,
    insuranceSlipRules,
  } = base;

  const requestedPromoterId = promoterId || "";
  const selectedPromoterId =
    requestedPromoterId &&
    filteredSummaryRows.some((row) => row.promoter_id === requestedPromoterId)
      ? requestedPromoterId
      : "";
  const selectedPromoterSummary =
    filteredSummaryRows.find((row) => row.promoter_id === selectedPromoterId) || null;
  const visibleSummaryRows = selectedPromoterId
    ? filteredSummaryRows.filter((row) => row.promoter_id === selectedPromoterId)
    : filteredSummaryRows;

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

  // Chave MASTER = balde temporário: as propostas digitadas nela entram em
  // daily_production_records com assigned_promoter_id = NULL (o import marca
  // promoter_source = MASTER_REASSIGNED e só preenche o id quando a Chave J é
  // INDIVIDUAL — ver app/api/import/daily/route.ts). O match exato
  // (assigned_promoter_id === id) nunca casa p/ master, por isso a aba Migração
  // vinha vazia justo em quem MAIS precisa redistribuir. Quando o chamador pede
  // (masterUnassigned) e o selecionado é is_master, lista o balde NÃO atribuído.
  // O escopo de empresa segue o filtro da tela: recordsForPeriod já vem
  // restrito por companyId quando há empresa selecionada (loadPromoterAnalyticsBase),
  // então NÃO filtramos por empresa aqui — com "todas" mostra todo o pendente,
  // sem esconder propostas de outra empresa. Promotor real: match exato de
  // sempre, intacto.
  const selectedPromoter = promoterById.get(selectedPromoterId) || null;
  const showMasterBucket =
    options?.masterUnassigned === true && selectedPromoter?.is_master === true;
  // AJUSTE 1 — modo agregado "todas as não atribuídas" (link do Dashboard,
  // ?unassigned=1): SEM promotor selecionado, lista TODO o balde pendente
  // (!assigned_promoter_id) no escopo da empresa atual (recordsForPeriod já
  // vem restrito por companyId). Só vale enquanto NENHUM promotor está
  // selecionado; ao escolher um real/master, volta ao comportamento normal
  // (match exato / PR #27).
  const showAllUnassigned =
    options?.allUnassigned === true && !selectedPromoterId;
  const showBucket = showMasterBucket || showAllUnassigned;

  const matchesProposalScope = (record: ProductionRow) =>
    showBucket
      ? !record.assigned_promoter_id
      : record.assigned_promoter_id === selectedPromoterId;

  const proposalRows = selectedPromoterId || showAllUnassigned
    ? recordsForPeriod
        .filter(
          (record) =>
            matchesProposalScope(record) && isEligibleProductionRecord(record)
        )
        .map((record) => {
          // CORREÇÃO A — usar produção CONSOLIDADA do grupo, nao por CNPJ.
          const promoterViewCompanyRate = getPromoterViewCompanyRate(
            record,
            groupProductionValue,
            trpProvider
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
            // FIX-3.SEGURO — fonte única com route.ts: usa TRP §188 +
            // base_field (gross|premio) + Parcelas via getPrazoTrp.
            // Mesma chamada produz o mesmo amount que o motor principal
            // grava em daily_production_records.insurance_commission_amount,
            // garantindo coerência nas duas colunas adjacentes em /promotores.
            company_insurance_commission_amount:
              calculateInsuranceCommissionFromRules({
                rules: insuranceSlipRules,
                grossValue: toNumber(record.gross_value),
                premioValue: toNumber(record.insurance_value),
                insuranceType: record.insurance_type,
                termPromotiva:
                  getPrazoTrp(record) ??
                  toNumber(record.term_months || record.installments),
                contractDate: record.contract_date || record.movement_date,
              })?.amount ?? 0,
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
      // Master só entra no CONSOLIDADO do grupo; com um promotor selecionado o
      // KPI mostra os números dele, sem master (productionTotal = production).
      productionUnassigned: selectedPromoterId ? 0 : unassignedProduction,
      productionUnassignedCount: selectedPromoterId ? 0 : unassignedCount,
      productionTotal:
        summary.production + (selectedPromoterId ? 0 : unassignedProduction),
      finalCommission: summary.finalCommission,
      payableCommission: summary.payableCommission,
      discounts: summary.discounts,
      averageInsurancePenetration:
        summary.promoters > 0 ? summary.insurancePenetration / summary.promoters : 0,
      companyGrossCommission,
      unassignedCompanyGrossCommission,
      unassignedCount,
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

// Mantem assinatura/comportamento originais: base fetch-once + recorte de 1 promotor.
// Comportamento bit-a-bit identico ao codigo anterior (usado pelo export individual).
export async function buildPromoterAnalytics(
  supabase: SupabaseClient,
  filters?: {
    year?: number;
    month?: number;
    companyId?: string;
    promoterId?: string;
    closed?: boolean; // ver loadPromoterAnalyticsBase: aberto(false)=LIVE_BASE, fechado/indef=CALCULATED
    // VIRADA — fonte do mês fechado (consolida PMR por promotor). Ver loadPromoterAnalyticsBase.
    closedSource?: "cms" | "fechamento";
    // Aba Migração: quando o selecionado é is_master, proposalRows lista o balde
    // não atribuído (assigned_promoter_id NULL) p/ redistribuir. Default off =>
    // todos os demais chamadores ficam idênticos (match exato por promoter_id).
    masterUnassigned?: boolean;
    // Modo agregado da Migração: lista todo o balde não atribuído sem promotor
    // selecionado (link do Dashboard). Default off => demais chamadores intactos.
    allUnassigned?: boolean;
  }
): Promise<PromoterAnalyticsPayload> {
  const base = await loadPromoterAnalyticsBase(supabase, filters);
  return selectPromoterView(base, filters?.promoterId, {
    masterUnassigned: filters?.masterUnassigned,
    allUnassigned: filters?.allUnassigned,
  });
}

