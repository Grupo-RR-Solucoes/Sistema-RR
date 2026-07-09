import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// VIRADA DE TELA — proposalRows do promotor no mês FECHADO por FECHAMENTO (jun+).
// Fonte: monthly_closing_entries (aba "A Vista"/CASH, RR) + linhas ADS do diário.
// Espelha o shape CmsProposalRow (mesma UI). Traz o campo SRCC do metadata p/ a
// tela colorir: "Sim" => VERMELHO, valor visível, FORA do valor (repasse 0).
//
// COMISSÃO POR LINHA = distribuição PROPORCIONAL da comissão JÁ GRAVADA no PMR
// (promoter_monthly_results, source 'fechamento'/'bbts') — crédito rateado pela
// COMISSÃO PF de cada contrato, seguro rateado pela COMISSÃO SEGURO. Isso garante
// que Σ das linhas == total do PMR (a mesma fonte do resumo), SEM reproduzir a
// régua per-contrato (acordo/Frente C). Linhas SRCC="Sim" ficam com repasse 0 e
// NÃO entram na base do rateio — exatamente "produzida, não paga".
// READ-ONLY.
// ============================================================================

import {
  loadClosingPromoterBase,
  type ClosingContrato,
} from "./closingPromoterBase.ts";
import { BBTS_COMPANY_ID } from "./bbtsMonthly.ts";
import { getProductionPeriodFromValue, getProductionPeriodKey } from "./productionPeriod.ts";
import type { CmsProposalRow } from "./promoterReportData.ts";

const BBTS_KEY = "JJ552710";

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function normKey(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").toUpperCase();
}
function normText(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

async function fetchAllPaged<T = any>(build: () => any): Promise<T[]> {
  let from = 0;
  const size = 1000;
  const all: T[] = [];
  while (true) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < size) break;
    from += size;
  }
  return all;
}

export async function buildClosingProposalRows(
  supabase: SupabaseClient,
  promoterId: string,
  year: number,
  month: number
): Promise<CmsProposalRow[]> {
  const compKey = getProductionPeriodKey(year, month);

  // 1. PMR do promotor (source fechamento/bbts) — total a ratear por linha.
  const { data: pmrRows, error: pmrErr } = await supabase
    .from("promoter_monthly_results")
    .select("company_id, source, production_commission_value, insurance_commission_value")
    .eq("promoter_id", promoterId)
    .eq("year", year)
    .eq("month", month)
    .in("source", ["fechamento", "bbts"]);
  if (pmrErr) throw pmrErr;
  const pmrFech = (pmrRows || []).find((r: any) => r.source === "fechamento");
  const pmrBbts = (pmrRows || []).find((r: any) => r.source === "bbts");
  const fechCredit = toNumber(pmrFech?.production_commission_value);
  const fechInsurance = toNumber(pmrFech?.insurance_commission_value);
  const bbtsCredit = toNumber(pmrBbts?.production_commission_value);
  const bbtsInsurance = toNumber(pmrBbts?.insurance_commission_value);

  // 2. RR — contratos do fechamento do promotor (chave individual + herança master).
  const base = await loadClosingPromoterBase(supabase, { year, month });
  const rrContratos = base.contratos.filter((c) => normKey(c.chaveJ) !== BBTS_KEY);
  const rrRestritas = base.restritas.filter((c) => normKey(c.chaveJ) !== BBTS_KEY);

  // Herança master p/ ESTE promotor: contratos do diário RR atribuídos a ele no mês
  // (proposal_number) — casa o órfão do fechamento (sem promotor individual).
  const heirKeys = new Set<string>();
  {
    const daily = await fetchAllPaged<any>(() =>
      supabase
        .from("daily_production_records")
        .select("proposal_number, company_id, movement_date")
        .eq("assigned_promoter_id", promoterId)
        .neq("company_id", BBTS_COMPANY_ID)
    );
    for (const d of daily) {
      if (!String(d.movement_date || "").startsWith(`${year}-${String(month).padStart(2, "0")}`)) continue;
      heirKeys.add(`${d.company_id}|${String(d.proposal_number || "").trim()}`);
    }
  }
  const belongsToPromoter = (c: ClosingContrato): boolean => {
    if (c.promoterId === promoterId) return true;
    if (!c.promoterId && c.contrato) return heirKeys.has(`${c.companyId}|${c.contrato.trim()}`);
    return false;
  };

  const myContratos = rrContratos.filter(belongsToPromoter); // pagáveis (SRCC ≠ Sim)
  const myRestritas = rrRestritas.filter(belongsToPromoter); // SRCC = Sim (vermelho)

  // Base do rateio (só pagáveis).
  const baseCredit = myContratos.reduce((s, c) => s + toNumber(c.comissaoEmpresaAvista), 0);
  const baseInsurance = myContratos.reduce((s, c) => s + toNumber(c.comissaoSeguro), 0);

  const rows: CmsProposalRow[] = [];

  const pushClosing = (c: ClosingContrato, restrita: boolean) => {
    const comissaoPf = toNumber(c.comissaoEmpresaAvista);
    const comissaoSeg = toNumber(c.comissaoSeguro);
    // SRCC="Sim" (restrita) => repasse 0 (produzida, não paga). Senão, rateio.
    const promoterCredit = restrita || baseCredit <= 0 ? 0 : (comissaoPf / baseCredit) * fechCredit;
    const promoterInsurance = restrita || baseInsurance <= 0 ? 0 : (comissaoSeg / baseInsurance) * fechInsurance;
    rows.push({
      id: `closing:${c.companyId ?? ""}:${c.contrato ?? c.chaveJ ?? Math.random()}`,
      contract_number: c.contrato || "-",
      proposal_number: c.contrato || "-",
      agency_code: "-",
      j_key: c.chaveJ || "",
      promoter_name: c.promoterName || "",
      product_description: c.produto || "-",
      status: restrita ? "FATURAR" : "FECHADO",
      movement_date: null,
      contract_date: null,
      interest_rate: toNumber(c.txJuros),
      installment_count: 0,
      company_received_percent: toNumber(c.percentualEmpresa),
      company_commission_amount: comissaoPf,
      // Campo que a UI usa para colorir. "Sim" => vermelho.
      srcc_restriction: c.srccRaw || (restrita ? "Sim" : "Não"),
      net_value: toNumber(c.valorLiquido),
      gross_value: 0,
      insurance_value: toNumber(c.valorSeguro),
      company_insurance_commission_amount: comissaoSeg,
      insurance_penetration_percent: c.penetracao != null ? toNumber(c.penetracao) * 100 : 0,
      promoter_commission_percent: 0,
      promoter_commission_amount: promoterCredit,
      insurance_commission_percent: 0,
      insurance_commission_amount: promoterInsurance,
      commission_rule_source: "fechamento",
      assigned_promoter_id: promoterId,
      assigned_promoter_name: c.promoterName || "",
      original_promoter_id: c.promoterId ?? null,
      original_promoter_name: "",
    });
  };

  for (const c of myContratos) pushClosing(c, false);
  for (const c of myRestritas) pushClosing(c, true);

  // 3. ADS — linhas do diário do promotor (source bbts), rateio proporcional.
  const adsRecords = await fetchAllPaged<any>(() =>
    supabase
      .from("daily_production_records")
      .select(
        "id, proposal_number, contract_number, product_description, gross_value, net_value, insurance_value, interest_rate, term_months, installments, status, is_srcc_restricted, movement_date, contract_date, proposal_date, raw_payload"
      )
      .eq("company_id", BBTS_COMPANY_ID)
      .eq("assigned_promoter_id", promoterId)
  );
  const adsValid = adsRecords.filter((r) => {
    const period =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    if (!period || getProductionPeriodKey(period.year, period.month) !== compKey) return false;
    const meta = (r.raw_payload && r.raw_payload.__bbts_meta) || {};
    if (meta.cancelado === true || normText(r.status) === "CANCELADO") return false;
    if (r.is_srcc_restricted === true) return false;
    return true;
  });
  const baseAdsCredit = adsValid.reduce((s, r) => s + toNumber(r.gross_value), 0);
  const baseAdsInsurance = adsValid.reduce((s, r) => s + toNumber(r.insurance_value), 0);
  for (const r of adsValid) {
    const gross = toNumber(r.gross_value);
    const seg = toNumber(r.insurance_value);
    rows.push({
      id: `bbts:${r.id}`,
      contract_number: r.contract_number || r.proposal_number || "-",
      proposal_number: r.proposal_number || "-",
      agency_code: "-",
      j_key: "",
      promoter_name: "",
      product_description: r.product_description || "-",
      status: "FECHADO",
      movement_date: r.movement_date ?? null,
      contract_date: r.contract_date ?? null,
      interest_rate: toNumber(r.interest_rate),
      installment_count: toNumber(r.installments || r.term_months),
      company_received_percent: 0,
      company_commission_amount: 0,
      srcc_restriction: "Não",
      net_value: toNumber(r.net_value) || gross,
      gross_value: gross,
      insurance_value: seg,
      company_insurance_commission_amount: 0,
      insurance_penetration_percent: 0,
      promoter_commission_percent: 0,
      promoter_commission_amount: baseAdsCredit > 0 ? (gross / baseAdsCredit) * bbtsCredit : 0,
      insurance_commission_percent: 0,
      insurance_commission_amount: baseAdsInsurance > 0 ? (seg / baseAdsInsurance) * bbtsInsurance : 0,
      commission_rule_source: "bbts",
      assigned_promoter_id: promoterId,
      assigned_promoter_name: "",
      original_promoter_id: promoterId,
      original_promoter_name: "",
    });
  }

  // Ordena: pagáveis primeiro (maior valor), restritas por último (destaque no fim).
  rows.sort((a, b) => {
    const ra = normText(a.srcc_restriction) === "SIM" ? 1 : 0;
    const rb = normText(b.srcc_restriction) === "SIM" ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return b.net_value - a.net_value;
  });

  return rows;
}
