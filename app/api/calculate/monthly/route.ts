import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { clearMemoryCache } from "@/lib/memoryCache";
import { resolveCompanyScope } from "@/lib/companyScope";
import { detectMonthRegime } from "@/lib/cmsMonthly";
import { reconsolidarCompetenciaFechada } from "@/lib/reconsolidarCompetencia";
import { findImportedProductionRule } from "@/lib/promoterRemuneration";
import { calcularOperacao, getProductionBandByValue } from "@/lib/motor";
import type { TrpRegraProvider } from "@/lib/motor";
import { buildTrpCreditProvider } from "@/lib/trp/creditTrpProvider";
import {
  calculateInsuranceCommissionFromRules,
  fetchInsuranceSlipRules,
  fetchInsuranceSlipTiers,
  lookupInsuranceShareFromPenetration,
  type InsuranceShareTier,
  type InsuranceSlipRule,
} from "@/lib/insuranceCalculator";
import { insuranceShareForPenetration } from "@/lib/insurancePenetration";
import { getPrazoTrp } from "@/lib/prazoTrp";
import { getProductionWindow } from "@/lib/productionPeriod";
import {
  fetchPromoterShareData,
  resolveFrenteCShare,
  resolvePromoterShareSync,
} from "@/lib/proposalDetailing";

function toNumber(value: unknown): number {
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

function toPercentUnits(value: unknown): number {
  const parsed = toNumber(value);
  if (!parsed) return 0;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

function toPercentRate(value: unknown): number {
  const parsed = toNumber(value);
  if (!parsed) return 0;
  return Math.abs(parsed) > 1 ? parsed / 100 : parsed;
}

// Dia 4.5 FIX-1: hardcode 58,33% removido daqui. A cascata viva esta em
// lib/proposalDetailing.ts (resolvePromoterShareSync), que centraliza o
// DEFAULT_SHARE como fallback dentro do helper.

function normalizeText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

// FRENTE C — repasse escalonado por meta (competencia 2026-05+).
// INSS da Aldalene fica FORA da escala: repasse fixo 65,86% (share sobre
// o % A VISTA, igual aos demais shares da cascata).
//
// BACKLOG (antes do fechamento de jun/2026): parametrizar este valor em
// tabela/coluna (ex.: promoter_goal_repasse.pct_inss_fixo ou tabela propria)
// em vez de constante. So tem efeito em meses ABERTOS (jun+); maio espelha o
// cms. Ver docs/frente-c-backlog.md.
const ALDALENE_INSS_FIXED_SHARE = 0.6586;

// Detecta proposta INSS (mesmo criterio do motor.ts:379):
// convenio_code = '1640' OU descricao do produto contem 'INSS'.
function isInssRecord(record: any): boolean {
  const code = String(record?.convenio_code ?? "").trim();
  if (code === "1640") return true;
  return normalizeText(record?.product_description).includes("INSS");
}

function readRawPayloadValue(record: any, aliases: string[]) {
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

function getPersistedCompanyReceivedPercent(record: any, fallbackImportedRule: any) {
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

function deriveCompanyReceivedPercentFromMotor(
  record: any,
  companyProductionValue: number,
  trpProvider?: TrpRegraProvider,
) {
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
    // FIX-PRAZO-TRP: lê Prazo (13º) ou Parcelas (demais) do raw_payload
    // conforme regra empírica validada em 40 meses (Tarefas J/K).
    // Fallback legacy preserva comportamento se helper retornar null.
    prazo:
      getPrazoTrp(record) ??
      toNumber(record.term_months || record.installments),
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
  }, { trpProvider });

  const avistaEmpresa = toNumber(operation?.credito?.avista_empresa);
  if (avistaEmpresa <= 0) return 0;

  return (avistaEmpresa / netValue) * 100;
}

function getMonthRange(year: number, month: number) {
  const window = getProductionWindow(year, month);
  return {
    start: window.start,
    end: window.endExclusive,
  };
}

function countBusinessDaysInMonth(year: number, month: number) {
  const lastDay = new Date(year, month, 0).getDate();
  let count = 0;

  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, month - 1, day);
    const weekDay = date.getDay();
    if (weekDay !== 0 && weekDay !== 6) count += 1;
  }

  return count;
}

function countElapsedBusinessDays(year: number, month: number) {
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

function isCancelledStatus(status: unknown) {
  const s = normalizeText(status);
  return s.includes("CANCEL") || s.includes("ESTORN") || s.includes("RECUS");
}

function isPendingStatus(status: unknown) {
  const s = normalizeText(status);
  return s.includes("PEND") || s.includes("ANALIS") || s.includes("PROCESS");
}

function isProductionStatus(status: unknown) {
  const s = normalizeText(status);
  return s === "PRODUCAO" || s === "PRODUCTION";
}

function isRenewedStatus(status: unknown, productDescription: unknown) {
  const s = normalizeText(status);
  const p = normalizeText(productDescription);
  return s.includes("RENOVA") || p.includes("RENOVA");
}

function isValidRecord(record: any) {
  if (record.cancellation_date) return false;
  if (isCancelledStatus(record.status)) return false;
  if (isPendingStatus(record.status)) return false;
  if (record.is_srcc_restricted) return false;
  return true;
}

// FIX-1.E.6.E — recorte exclusivo da PENETRACAO mensal (Modelo B).
// Aplicado SO em cima do calculo de insurance_penetration_percent;
// production_value, proposal_count, insured_proposal_count e
// insured_production_value continuam usando o recorte legacy.
//
// Filtros confirmados Diego:
//   - raw_payload 'Tipo de Liberacao' == '1'
//   - exclui j_key comecando com 'JJJ' (chave JJJ552710 nao entra
//     na base de penetracao da Etapa E)
function isEligibleForInsurancePenetration(record: any) {
  const tipoLiberacao = readRawPayloadValue(record, [
    "Tipo de Liberacao",
    "Tipo de Liberação",
    "Tipo Liberacao",
    "Tipo Liberação",
    "TipoLiberacao",
    "TIPO DE LIBERACAO",
  ]);
  const tipoLiberacaoTxt = String(tipoLiberacao ?? "").trim();
  if (tipoLiberacaoTxt !== "1") return false;

  const jKey = String(record.j_key ?? "").trim().toUpperCase();
  if (jKey.startsWith("JJJ")) return false;

  return true;
}

function calculateInsurancePenetration(productionValue: number, insuredValue: number) {
  if (productionValue <= 0) return 0;
  return (insuredValue / productionValue) * 100;
}

// @deprecated FIX-3.SEGURO — cascata legacy de seguro (gross × taxa
// hardcoded por prazo) substituída por insurance_slip_rules + getPrazoTrp.
// Manteve-se aqui só para evitar quebra de imports caso surjam consumidores
// não mapeados. Após confirmar que ninguém mais chama, remover. Prazo já
// passa por getPrazoTrp para coerência com a regra Promotiva (J/K).
function getInsuranceCompanyRate(record: any) {
  const insuranceType = normalizeText(record.insurance_type);
  const prazo = getPrazoTrp(record) ?? Number(record.term_months || 0);

  if (insuranceType.includes("ESTOQUE")) return 0.15;
  if (prazo >= 85) return 0.55;
  if (prazo >= 61) return 0.4;
  if (prazo >= 37) return 0.25;
  return 0.15;
}

// @deprecated FIX-3.SEGURO — função órfã após remoção do fallback legacy
// de seguro na cascata (route.ts:1077-1120 antigo). Mantida só para evitar
// quebra de imports não mapeados; remover quando tiver certeza.
function calculateCompanyInsuranceCommission(record: any) {
  const gross = toNumber(record.gross_value);

  if (!gross) return 0;
  if (!toNumber(record.insurance_value) && !record.has_insurance) return 0;

  return gross * (getInsuranceCompanyRate(record) / 100);
}

function pickCommissionRow(rows: any[], metricValue: number) {
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

function calculatePercentValue(baseValue: unknown, percent: unknown) {
  return toNumber(baseValue) * toPercentRate(percent);
}

function isMeaningfulImportedProductionRule(rule: any) {
  if (!rule) return false;
  const promoterPercent = toPercentUnits(rule.promoter_percent);
  const receivedPercent = toPercentUnits(rule.received_percent);
  return promoterPercent > 0 || receivedPercent > 0;
}

function isMeaningfulAgreement(agreement: any) {
  if (!agreement || agreement.active === false) return false;
  const value = toNumber(agreement.commission_value);
  return value > 0;
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
  return "BELOW_META";
}

function groupByCompany(records: any[]) {
  const map = new Map<string, any[]>();
  for (const record of records) {
    if (!record.company_id) continue;
    if (!map.has(record.company_id)) map.set(record.company_id, []);
    map.get(record.company_id)!.push(record);
  }
  return map;
}

function groupByPromoter(records: any[]) {
  const map = new Map<string, any[]>();
  for (const record of records) {
    const promoterId = record.assigned_promoter_id;
    if (!promoterId) continue;
    if (!map.has(promoterId)) map.set(promoterId, []);
    map.get(promoterId)!.push(record);
  }
  return map;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function getLatestImportedPromoterRemuneration(
  supabase: SupabaseClient,
  year: number,
  month: number
) {
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
      (row: any) =>
        Number(row?.payload?.year) === Number(year) &&
        Number(row?.payload?.month) === Number(month)
    )?.payload || null
  );
}

async function fetchAllPaged<T = any>(baseQueryBuilder: () => any): Promise<T[]> {
  let from = 0;
  const pageSize = 1000;
  const all: T[] = [];

  while (true) {
    const { data, error } = await baseQueryBuilder().range(
      from,
      from + pageSize - 1
    );

    if (error) throw error;
    if (!data || data.length === 0) break;

    all.push(...(data as T[]));

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

function calculateCompanyExpectedValues(records: any[], trpProvider?: TrpRegraProvider) {
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
      // FIX-PRAZO-TRP: regra Promotiva (J/K) — 3100→Prazo, resto→Parcelas.
      prazo: getPrazoTrp(record) ?? toNumber(record.term_months),
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
    }, { trpProvider });

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

// Dia 4.5 FIX-1.B: chooseMonthlyDefaultPercent removido. Era o fallback
// "MONTHLY_DEFAULT" antigo (tabela mensal de comissao por banda) que
// nunca seria usado depois do desacoplamento: sem company_received_percent,
// agora retornamos NULL em vez de fallback para tabela.

function findProductRule(productRules: any[], record: any) {
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

export async function POST(req: Request) {
  try {
    // D26 - Escola A (withSocioAdmin). Esta rota faz batch invasivo
    // recalculando consolidacao mensal em N tabelas; service_role com
    // guard de socio eh a escolha apropriada (vs RLS por linha).
    const { supabase } = await withSocioAdmin();

    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);
    const companyId = body.companyId || null;
    const promoterId = body.promoterId || null;

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Informe year e month válidos." },
        { status: 400 }
      );
    }

    const { start, end } = getMonthRange(year, month);

    // ESCOPO — traduz "grupo:rr"/"grupo:ads" no conjunto de company_ids ANTES dos
    // filtros (sem isto, companyId cru caía num .eq(uuid) -> 22P02 "Erro interno").
    // null => sem restrição; grupo => [ids]; individual => [uuid].
    const allCompaniesForScope = await fetchAllPaged<any>(() =>
      supabase.from("companies").select("id, group_name")
    );
    const scope = resolveCompanyScope(companyId || "", allCompaniesForScope);
    const scopeIds = scope.companyIds;

    const companies = await fetchAllPaged<any>(() => {
      let query = supabase
        .from("companies")
        .select("id, name, cnpj")
        .eq("active", true);

      if (scopeIds) query = query.in("id", scopeIds);
      return query;
    });

    // MES FECHADO — o PMR fechado NAO e mais escrito aqui a partir do cms.
    //
    // Antes: este ramo chamava consolidateMonthlyFromCms. Isso era um morto-vivo:
    // cms_promoter_entries so tem jan/fev/mar/mai de 2026. Em abril e junho+ (que
    // JA sao regime 'fechamento') ele lia 0 entries, fazia 0 upserts e ainda assim
    // respondia success:true com "PMR reproduzido a partir do cms" — mentia em
    // silencio, e o PMR fechado so existia se alguem rodasse script na mao.
    //
    // Agora: regime 'fechamento' -> reconsolidarCompetenciaFechada (a MESMA funcao
    // que o import de fechamento chama, orquestrador RR+ADS + reconciliacao).
    //         regime 'cms' -> nada a fazer: o PMR de jan-mai e o SEED do financeiro,
    // ja gravado (399 linhas), e nao se recalcula. O historico fica intacto.
    const regime = await detectMonthRegime(supabase, year, month);
    if (regime !== "open") {
      const res = await reconsolidarCompetenciaFechada(supabase, {
        year,
        month,
        dryRun: false,
      });

      clearMemoryCache("closing:");
      clearMemoryCache("financial:");
      clearMemoryCache("promoters:");
      clearMemoryCache("dashboard:");

      return NextResponse.json({
        success: true,
        year,
        month,
        source: regime,
        promoters_calculated: res.gravadas ?? 0,
        reconciliacao: res.reconciliacao ?? null,
        message: res.ran
          ? `Mês fechado (regime '${regime}'): PMR consolidado do fechamento (RR+ADS) e fatia reconciliada.`
          : `Mês fechado (regime '${regime}'): ${res.motivo}`,
      });
    }

    const dailyRecords = await fetchAllPaged<any>(() => {
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
          insurance_slip_eligible,
          has_insurance,
          status,
          proposal_date,
          movement_date,
          contract_date,
          cancellation_date,
          is_srcc_restricted,
          term_months,
          company_received_percent,
          convenio_code,
          convenio_type,
          convenio_segment,
          interest_rate,
          j_key,
          raw_payload
        `)
        .gte("movement_date", start)
        .lt("movement_date", end);

      if (scopeIds) query = query.in("company_id", scopeIds);
      if (promoterId) query = query.eq("assigned_promoter_id", promoterId);
      return query;
    });

    const promoters = await fetchAllPaged<any>(() => {
      let query = supabase
        .from("promoters")
        .select("id, company_id, name, active")
        .eq("active", true);

      if (scopeIds) query = query.in("company_id", scopeIds);
      if (promoterId) query = query.eq("id", promoterId);
      return query;
    });

    const targets = await fetchAllPaged<any>(() => {
      let query = supabase
        .from("monthly_targets")
        .select("*")
        .eq("year", year)
        .eq("month", month);

      if (scopeIds) query = query.in("company_id", scopeIds);
      if (promoterId) query = query.eq("promoter_id", promoterId);
      return query;
    });

    const agreements = await fetchAllPaged<any>(() => {
      let query = supabase
        .from("promoter_agreements")
        .select("*")
        .eq("year", year)
        .eq("month", month)
        .eq("active", true);

      if (scopeIds) query = query.in("company_id", scopeIds);
      if (promoterId) query = query.eq("promoter_id", promoterId);
      return query;
    });

    const commissionTables = await fetchAllPaged<any>(() => {
      let query = supabase
        .from("commission_tables")
        .select("id, company_id, year, month, active, version")
        .eq("year", year)
        .eq("month", month)
        .eq("active", true);

      if (scopeIds) query = query.in("company_id", scopeIds);
      return query;
    });

    const tableIds = commissionTables.map((t: any) => t.id);

    let commissionRows: any[] = [];
    if (tableIds.length > 0) {
      commissionRows = await fetchAllPaged<any>(() =>
        supabase
          .from("commission_table_rows")
          .select("*")
          .in("commission_table_id", tableIds)
      );
    }

    const productRules = await fetchAllPaged<any>(() => {
      let query = supabase
        .from("promoter_product_commissions")
        .select("*")
        .eq("year", year)
        .eq("month", month)
        .eq("active", true);

      if (scopeIds) query = query.in("company_id", scopeIds);
      if (promoterId) query = query.eq("promoter_id", promoterId);
      return query;
    });

    const importedPromoterRemuneration = await getLatestImportedPromoterRemuneration(
      supabase,
      year,
      month
    );

    // FIX-1.E.6.C — pre-carrega regras TRP35 §188 SLIP / ESTOQUE_D0
    // (cardinality ~5, seguro carregar tudo). Evita 1 round-trip por
    // proposta no loop quente.
    const insuranceSlipRules: InsuranceSlipRule[] = await fetchInsuranceSlipRules(
      supabase
    );

    // FIX-1.E.6.E — pre-carrega tiers da scale SEGURO_SLIP_MAIO_2026
    // (7 tiers fixos). Aplicada 1x por promotor no upsert mensal.
    const insuranceShareTiers: InsuranceShareTier[] = await fetchInsuranceSlipTiers(
      supabase
    );

    // FIX-1.E.6.E — Gate de vigencia (Modelo B). Scale SEGURO_SLIP aplica
    // o repasse Modelo B (total Promotiva × share por penetracao); quando
    // inativo, grava o total Promotiva (100%) em
    // promoter_monthly_results.insurance_commission_value.
    // FIX-6 (Diego): repasse de 50% vale desde MARCO/2026, nao maio. Gate
    // antecipado de month>=5 para month>=3. Requer recalculo retroativo de
    // mar+abr/2026 para alinhar o gravado ao que ja foi pago.
    const insuranceShareScaleActive = year > 2026 || (year === 2026 && month >= 3);

    const proposalRules = await fetchAllPaged<any>(() => {
      let query = supabase
        .from("promoter_proposal_commissions")
        .select("*")
        .eq("active", true);

      if (promoterId) query = query.eq("promoter_id", promoterId);
      return query;
    });

    // Dia 4.5 FIX-1: pre-carrega dados da cascata Etapa B em batch (3-4
    // queries: profiles + scales/tiers + volumes mensais). Evita N+1 dentro
    // do loop de records que segue abaixo.
    const uniquePromoterIdsForShare = Array.from(
      new Set(
        dailyRecords
          .map((r: any) => r.assigned_promoter_id)
          .filter((id: any): id is string => Boolean(id))
      )
    );
    const { profilesMap, scalesMap, monthlyVolumesMap } =
      await fetchPromoterShareData(
        supabase,
        uniquePromoterIdsForShare,
        year,
        month
      );

    // FRENTE C — escala de repasse por meta da competencia (1o dia do mes).
    // So aplica a propostas faixa 5,80% empresa; os limiares de producao
    // (bonus1/bonus2) sao meta_1/meta_2 de monthly_targets (fonte unica).
    //
    // GATING POR cms: meses FECHADOS por cms (ex.: maio/2026, que ja tinha a
    // escala embutida nos repasses) retornam ACIMA (monthIsClosed -> espelha
    // o cms) e nunca chegam aqui. Logo a escala so calcula de fato em meses
    // ABERTOS (jun/2026+). A linha de maio fica gravada so p/ historico/tela.
    const competencia = `${year}-${String(month).padStart(2, "0")}-01`;
    // Tolerante: se a migration de promoter_goal_repasse ainda nao foi
    // aplicada, o recalculo segue normalmente sem a escala (mapa vazio).
    let goalRepasseRows: any[] = [];
    try {
      goalRepasseRows = await fetchAllPaged<any>(() => {
        let query = supabase
          .from("promoter_goal_repasse")
          .select("promoter_id, pct_base, pct_meta1, pct_meta2")
          .eq("competencia", competencia);
        if (promoterId) query = query.eq("promoter_id", promoterId);
        return query;
      });
    } catch (e) {
      console.warn(
        "[FRENTE C] promoter_goal_repasse indisponivel; recalculo sem escala.",
        (e as any)?.message ?? e
      );
    }
    const goalRepasseMap = new Map<string, any>(
      goalRepasseRows.map((r: any) => [r.promoter_id, r])
    );

    const hasPromoterRemunerationBase =
      !!importedPromoterRemuneration ||
      commissionTables.length > 0 ||
      productRules.length > 0 ||
      proposalRules.length > 0 ||
      agreements.length > 0;

    const companyGroups = groupByCompany(dailyRecords);
    const expectedClosingsUpserts: any[] = [];
    const companyExpectedMap = new Map<string, any>();

    // TRP self-service: fonte da regra de crédito atrás da flag TRP_SOURCE. Preload
    // async 1x das competências dos registros (derivadas do contract_date, a MESMA
    // chave do motor); o cálculo por linha continua síncrono. Sem db-source,
    // provider=undefined -> motor lê o JSON (no-op).
    // A data mid-month da competencia-alvo entra no preload para GARANTIR que o
    // carimbo do detector (getResolved abaixo) ache a versao do mes do PMR, mesmo
    // que nenhum contract_date individual caia exatamente nela.
    const trpStampComp = `${year}-${String(month).padStart(2, "0")}`;
    const trpProvider = await buildTrpCreditProvider([
      `${trpStampComp}-15`,
      ...dailyRecords.map((record: any) => record.contract_date),
    ]);
    // Detector Camada 1 (TRP): versao efetivamente usada (com fallback) na
    // competencia — a MESMA que o motor consumiu. Uma so por rodada (todas as
    // linhas daily compartilham year/month). NULL quando TRP_SOURCE=json ou
    // competencia sem versao no DB (numero veio do JSON embutido). No-op no valor.
    const trpStamp = trpProvider ? trpProvider.getResolved(trpStampComp) : null;

    for (const company of companies) {
      const records = companyGroups.get(company.id) || [];
      const expected = calculateCompanyExpectedValues(records, trpProvider);
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
    const promoterUpserts: any[] = [];
    const recordUpdates: any[] = [];
    let unmatchedImportedRules = 0;

    // FIX-1.E.6.E — coleta dry-run de Etapa E (abril/2026). Vazio quando
    // a scale ja esta ativa (maio/2026+).
    const insuranceShareDryRun: Array<{
      promoter_id: string;
      promoter_name: string;
      insurance_penetration_percent_legacy: number;
      insurance_penetration_percent: number;
      insurance_share_applied: number;
      promotiva_total: number;
      projected_promoter_value: number;
      current_persisted_value: number;
    }> = [];

    const elapsedBusinessDays = countElapsedBusinessDays(year, month);
    const totalBusinessDays = countBusinessDaysInMonth(year, month);

    for (const promoter of promoters) {
      const records = promoterGroups.get(promoter.id) || [];
      const validRecords = records.filter(
        (record: any) => isProductionStatus(record.status) && isValidRecord(record)
      );

      const productionValue = validRecords.reduce(
        (sum: number, record: any) => sum + toNumber(record.net_value),
        0
      );

      const grossProductionValue = validRecords.reduce(
        (sum: number, record: any) => sum + toNumber(record.gross_value),
        0
      );

      const proposalCount = validRecords.length;

      const insuredRecords = validRecords.filter(
        (record: any) => toNumber(record.insurance_value) > 0 || record.has_insurance
      );

      const insuredProposalCount = insuredRecords.length;
      const insuredProductionValue = insuredRecords.reduce(
        (sum: number, record: any) => sum + toNumber(record.net_value),
        0
      );

      const insuredGrossValue = insuredRecords.reduce(
        (sum: number, record: any) => sum + toNumber(record.gross_value),
        0
      );

      // FIX-1.E.6.E — subset exclusivo da PENETRACAO mensal (Modelo B):
      // recorta validRecords por Tipo de Liberacao=1 AND j_key NOT LIKE
      // 'JJJ%' antes de calcular numerador/denominador. Demais metricas
      // (production_value, insured_proposal_count, insured_production_value)
      // continuam usando o recorte legacy.
      const penetrationRecords = validRecords.filter(
        isEligibleForInsurancePenetration
      );
      // FIX penetração: base LÍQUIDO (net_value), não BRUTO (gross_value). O
      // oficial Promotiva calcula sobre a produção líquida (excl SRCC, já em
      // validRecords). BRUTO empurrava a penetração p/ a faixa de baixo.
      const penetrationDenominator = penetrationRecords.reduce(
        (sum: number, record: any) => sum + toNumber(record.net_value),
        0
      );
      // TODO: "segurado" oficial é o FLAG PROD.SEGURADA; enquanto o campo
      // equivalente na diária não é confirmado, mantém insurance_value>0.
      const penetrationNumerator = penetrationRecords
        .filter(
          (record: any) => toNumber(record.insurance_value) > 0 || record.has_insurance
        )
        .reduce(
          (sum: number, record: any) => sum + toNumber(record.net_value),
          0
        );

      const insurancePenetrationPercent = calculateInsurancePenetration(
        penetrationDenominator,
        penetrationNumerator
      );

      // Penetracao "antes do filtro" (recorte legacy). Mantida em paralelo
      // para o dry-run de abril/2026 — permite comparar 36,20% (legacy) x
      // 37,11% (Etapa E).
      const insurancePenetrationPercentLegacy = calculateInsurancePenetration(
        grossProductionValue,
        insuredGrossValue
      );

      const target = targets.find((t: any) => t.promoter_id === promoter.id);
      const targetValue = target ? toNumber(target.meta) : 0;
      const target1Value = target ? toNumber(target.meta_1) : 0;
      const target2Value = target ? toNumber(target.meta_2) : 0;

      // FRENTE C — escala de repasse deste promotor na competencia (ou null)
      // e flag da Aldalene (carve-out do INSS fixo).
      const goalRepasse = goalRepasseMap.get(promoter.id) || null;
      const isAldalenePromoter = normalizeText(promoter.name).includes(
        "ALDALENE"
      );

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
        .filter((t: any) => t.company_id === promoter.company_id)
        .sort((a: any, b: any) => b.version - a.version)[0];

      const rowsForTable = companyTable
        ? commissionRows.filter((r: any) => r.commission_table_id === companyTable.id)
        : [];

      // FIX-1.B: productionRows nao e mais consumido (chooseMonthlyDefaultPercent
      // removido). insuranceRows continua sendo usado por pickCommissionRow
      // no calculo de % seguro.
      const insuranceRows = rowsForTable.filter(
        (r: any) => r.rule_type === "INSURANCE"
      );

      const promoterAgreements = agreements.filter(
        (a: any) => a.promoter_id === promoter.id && isMeaningfulAgreement(a)
      );
      const productionAgreement = promoterAgreements.find(
        (agreement: any) => agreement.agreement_type === "PRODUCTION"
      );
      const insuranceAgreement = promoterAgreements.find(
        (agreement: any) => agreement.agreement_type === "INSURANCE"
      );
      const specialAgreements = promoterAgreements.filter(
        (agreement: any) => agreement.agreement_type === "SPECIAL"
      );

      const promoterProductRules = productRules.filter(
        (r: any) => r.promoter_id === promoter.id
      );

      let productionCommissionValue = 0;
      let insuranceCommissionValue = 0;
      let agreementAdjustmentValue = 0;

      for (const record of validRecords) {
        const manualRule = proposalRules.find(
          (r: any) => r.daily_production_record_id === record.id
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

        let commissionPercent: number | null = 0;
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
            toNumber(companyExpected?.netValidProduction),
            trpProvider
          );

        const effectiveCompanyReceivedPercent = persistedCompanyReceivedPercent;

        // Dia 4.5 FIX-1.B: cascata em 2 fases desacopladas.
        //
        // FASE 1 (% A VISTA): identifica de onde veio o
        // company_received_percent persistido (raw_payload, stored,
        // importedRule.received_percent ou motor). aVistaSource e
        // conceitual — descreve a fonte mas nao re-multiplica nada.
        //
        // FASE 2 (% REPASSE Etapa B): SEMPRE aplica resolvePromoterShareSync
        // (override de proposta > profile > DEFAULT 58,33%), exceto pelos
        // ramos LEGACY que gravam % FINAL pre-calculado por back-compat
        // (manualRule.commission_percent, productRule.commission_percent,
        // AGREEMENT.FIXED).
        //
        // Source final: '${aVistaSource}+DIA45_${shareSource}'
        // ou '<RULE>_LEGACY' para o bypass.
        const isShareOfCompanyAgreement =
          productionAgreement &&
          normalizeText(productionAgreement.commission_type) ===
            "SHARE_OF_COMPANY";

        if (manualRule && manualRule.commission_percent !== null) {
          commissionPercent = Math.min(
            toPercentUnits(manualRule.commission_percent),
            5.8
          );
          productionRuleSource = "MANUAL_PROPOSAL_LEGACY";
        } else if (productRule && productRule.commission_percent !== null) {
          commissionPercent = Math.min(
            toPercentUnits(productRule.commission_percent),
            5.8
          );
          productionRuleSource = "PRODUCT_RULE_LEGACY";
        } else if (productionAgreement && !isShareOfCompanyAgreement) {
          commissionPercent = Math.min(
            toPercentUnits(productionAgreement.commission_value),
            5.8
          );
          productionRuleSource = "PROMOTER_AGREEMENT_LEGACY";
        } else {
          // FASE 1: identifica aVistaSource (conceitual, nao recalcula).
          let aVistaSource: string;
          if (importedRule) {
            aVistaSource = "IMPORTED_MONTHLY_TABLE";
          } else if (isShareOfCompanyAgreement) {
            aVistaSource = "PROMOTER_AGREEMENT";
          } else {
            aVistaSource = "DEFAULT_PERSISTED";
          }

          // FASE 2: cascata viva Etapa B aplica share por cima do % A VISTA.
          // Teto 5,80% sobre % A VISTA ANTES de multiplicar pelo share
          // (regra RR: Promotiva paga ate 6%, visao promotor limitada
          // a 5,80%, spread fica empresa).
          if (effectiveCompanyReceivedPercent > 0) {
            const aVistaClamped = Math.min(
              effectiveCompanyReceivedPercent,
              5.8
            );
            // FRENTE C — faixa 5,80% empresa (visao promotor) = % A VISTA
            // atingiu o teto 5,80. So nessa faixa a escala por meta entra.
            const isFaixa580 = aVistaClamped >= 5.8 - 0.001;

            // FRENTE C — escala da FONTE ÚNICA (resolveFrenteCShare). Mesma
            // regra que a tela de edição agora aplica. Aldalene INSS fixo +
            // escala por meta. null => cai na cascata viva (profile/default).
            const fcShare = resolveFrenteCShare({
              goalRepasse,
              productionValue,
              target1Value,
              target2Value,
              isAldaleneInss: isAldalenePromoter && isInssRecord(record),
              isFaixa580,
            });
            if (fcShare) {
              commissionPercent = aVistaClamped * fcShare.share;
              productionRuleSource = `${aVistaSource}+${fcShare.source}`;
            } else {
              // Mantem o acordo atual (cascata viva Etapa B) — NAO mexer.
              const resolution = resolvePromoterShareSync({
                record: {
                  assigned_promoter_id: record.assigned_promoter_id,
                  share_percent_override:
                    manualRule?.share_percent_override ?? null,
                },
                profilesMap,
                scalesMap,
                monthlyVolumesMap,
              });
              commissionPercent = aVistaClamped * resolution.sharePercent;
              productionRuleSource = `${aVistaSource}+DIA45_${resolution.source}`;
            }
          } else {
            // Sem % A VISTA valido em nenhuma fonte (raw_payload / stored
            // / importedRule / motor) — manter NULL. 30 propostas em
            // abr/2026 nesse estado (D29 backlog: investigar importador,
            // fora do escopo deste fix).
            commissionPercent = null;
            productionRuleSource = "NULL_COMPANY_PERCENT";
          }
        }

        // FIX-1.E.6.C — TRP35 §188 SLIP / ESTOQUE_D0. CAMADA 2 da cascata
        // (decisao D1 Etapa A): abaixo de MANUAL_PROPOSAL, acima de
        // PRODUCT_RULE / PROMOTER_AGREEMENT / MONTHLY_DEFAULT.
        // Base = gross_value (decisao Diego, modelo hibrido): amount
        // armazenado e a comissao TOTAL da Promotiva por essa proposta
        // (sem share do promotor — share entra na Etapa E via scale
        // SEGURO_SLIP_MAIO_2026 por penetracao mensal).
        // FIX-3.SEGURO — assinatura nova: passa grossValue + premioValue
        // (a regra escolhe a base via base_field); termPromotiva usa
        // getPrazoTrp = Parcelas (J/K). insurance_type continua sendo
        // SLIP|ESTOQUE_D0 lido do raw_payload pelo importer.
        const trp35Result = calculateInsuranceCommissionFromRules({
          rules: insuranceSlipRules,
          grossValue: toNumber(record.gross_value),
          premioValue: toNumber(record.insurance_value),
          insuranceType: record.insurance_type,
          termPromotiva:
            getPrazoTrp(record) ??
            toNumber(record.term_months || record.installments),
          contractDate: record.contract_date || record.movement_date,
        });

        // FIX-3.SEGURO — cascata de seguro simplificada (decisão Diego):
        // SEM override manual (MANUAL_PROPOSAL/PRODUCT_RULE/PROMOTER_
        // AGREEMENT/MONTHLY_DEFAULT removidos para seguro). Só TRP §188
        // via insurance_slip_rules. Sem regra TRP + tem seguro → marca
        // SEM_REGRA_TRP (UI destaca em vermelho). Isso elimina o bug
        // "÷ 2" da Tarefa P (fallback MONTHLY_DEFAULT aplicava 50%).
        // Repasse promotor (% da Promotiva ao promotor) entra em outra
        // etapa via scale SEGURO_SLIP_MAIO_2026 (Etapa E).
        const hasInsurance =
          toNumber(record.insurance_value) > 0 || Boolean(record.has_insurance);

        let insuranceCommissionAmount: number;
        if (trp35Result) {
          insuranceCommissionAmount = trp35Result.amount;
          insuranceCommissionPercent = trp35Result.percent;
          insuranceRuleSource = `TRP35_${trp35Result.modality}`;
        } else if (hasInsurance) {
          insuranceCommissionAmount = 0;
          insuranceCommissionPercent = 0;
          insuranceRuleSource = "SEM_REGRA_TRP";
        } else {
          insuranceCommissionAmount = 0;
          insuranceCommissionPercent = 0;
          insuranceRuleSource = "NO_INSURANCE";
        }

        const productionBase = toNumber(record.net_value);

        // NULL_COMPANY_PERCENT: mantem amount=NULL para sinalizar dado
        // faltando, em vez de gravar 0 (que somaria como producao real).
        //
        // FIX-1.C: divisao explicita por 100 em vez de calculatePercentValue.
        // Aquele helper usa toPercentRate (heuristica `Math.abs > 1 ? /100
        // : as-is`) que falha para % final < 1 (ex: Lilian CLT 16,66% *
        // 2,44% a_vista = 0,4065%). A heuristica nao consegue distinguir
        // 0,4065% (percent) de 0.4065 (rate ja em 0..1), e tratava o pct
        // como rate, gerando amount ~100x maior. 141/500 propostas de
        // abr/2026 quebraram exatamente nessa armadilha.
        const promoterCommissionAmount: number | null =
          commissionPercent === null
            ? null
            : (productionBase * commissionPercent) / 100;

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

        // FIX-3.SEGURO — sufixo de seguro no source só para casos
        // informativos: TRP35_* (regra aplicada) ou SEM_REGRA_TRP
        // (alerta). NO_INSURANCE é o caso normal (sem seguro) — não
        // polui o source. MONTHLY_DEFAULT mantido por defensividade
        // (não existe mais após FIX-3, mas evita regressão silenciosa).
        const commissionRuleSource =
          insuranceRuleSource !== "MONTHLY_DEFAULT" &&
          insuranceRuleSource !== "NO_INSURANCE" &&
          insuranceRuleSource !== productionRuleSource
            ? `${productionRuleSource}+${insuranceRuleSource}`
            : productionRuleSource;

        productionCommissionValue += promoterCommissionAmount ?? 0;
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

      // FIX-1.E.6.E — Etapa E (Modelo B): aplica share da scale
      // SEGURO_SLIP_MAIO_2026 sobre a soma Promotiva total do promotor.
      //   insurance_commission_value (promotor) =
      //     SUM(insurance_commission_amount Promotiva) × share_da_scale
      // share_da_scale = lookup pela penetracao mensal (decimal 0..1).
      //
      // Vigencia: maio/2026+. Abril/2026 calcula projecao para dry-run
      // mas grava o valor atual (Promotiva total) — preservacao explicita
      // ate Etapa D rodar o recalculo retroativo.
      const insurancePenetrationDecimal = insurancePenetrationPercent / 100;
      // Cortes oficiais 0,11/0,21/0,30 via lib única (share_scale_tier do banco
      // ainda tem 0,10/0,20/0,30 — migration pendente; a lib não lê o banco).
      const insuranceShareApplied = insuranceShareForPenetration(
        insurancePenetrationDecimal
      );
      const insuranceCommissionValuePromotorProjected =
        insuranceCommissionValue * insuranceShareApplied;
      const insuranceCommissionValuePersisted = insuranceShareScaleActive
        ? insuranceCommissionValuePromotorProjected
        : insuranceCommissionValue;

      if (!insuranceShareScaleActive) {
        insuranceShareDryRun.push({
          promoter_id: promoter.id,
          promoter_name: promoter.name,
          insurance_penetration_percent_legacy: insurancePenetrationPercentLegacy,
          insurance_penetration_percent: insurancePenetrationPercent,
          insurance_share_applied: insuranceShareApplied,
          promotiva_total: insuranceCommissionValue,
          projected_promoter_value: insuranceCommissionValuePromotorProjected,
          current_persisted_value: insuranceCommissionValue,
        });
      }

      const finalCommissionValue =
        productionCommissionValue +
        insuranceCommissionValuePersisted +
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
        insurance_commission_value: insuranceCommissionValuePersisted,
        agreement_adjustment_value: agreementAdjustmentValue,
        final_commission_value: finalCommissionValue,
        target_status: targetStatus,
        source: "daily",
        calculated_at: new Date().toISOString(),
        // Detector Camada 1: versao da TRP usada (NULL = desconhecido/sem versao).
        trp_version_id: trpStamp?.versionId ?? null,
        trp_fallback: trpStamp ? trpStamp.isFallback : null,
      });
    }

    if (promoterUpserts.length > 0) {
      const { error } = await supabase
        .from("promoter_monthly_results")
        .upsert(promoterUpserts, {
          onConflict: "promoter_id,year,month,company_id",
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

    return NextResponse.json({
      success: true,
      year,
      month,
      source: "daily",
      companies_calculated: expectedClosingsUpserts.length,
      promoters_calculated: promoterUpserts.length,
      unmatched_imported_rules: unmatchedImportedRules,
      remuneration_base_mode: hasPromoterRemunerationBase
        ? "MONTH_RULES_OR_AGREEMENTS"
        : "DEFAULT_SHARE_ONLY",
      insurance_share_scale_active: insuranceShareScaleActive,
      insurance_share_dry_run: insuranceShareDryRun,
      message:
        "Cálculo mensal concluído com regra por produto e percentual recebido.",
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
