// FIX-1.E.6.C — Calculo de comissao Promotiva sobre seguro segundo
// TRP35 §188 SLIP (vigente desde abr/2026) e ESTOQUE_D0 (legado, ate
// mar/2026). Fonte unica: tabela insurance_slip_rules.
//
// Modelo (decisao Diego, Etapa C):
//   amount = baseValue × rule.commission_percent
//   (sem aplicar share do promotor — share entra na Etapa E via scale
//    SEGURO_SLIP_MAIO_2026 por penetracao mensal)
//
// Decisao D1 da Etapa A — TRP35 vira CAMADA 2 da cascata em
// /api/calculate/monthly (entre MANUAL_PROPOSAL e PRODUCT_RULE).
//
// Decisao Diego sobre base: 'gross_value' por proposta (compat com
// modelo atual via getInsuranceCompanyRate; insurance_value continua
// existindo na tabela para reporting mas nao e a base do calculo).

import type { SupabaseClient } from "@supabase/supabase-js";

export type InsuranceSlipRule = {
  id: string;
  modality: string;
  term_min: number;
  term_max: number | null;
  commission_percent: number;  // decimal: 0.00150 = 0,15%
  valid_from: string;          // ISO yyyy-mm-dd
  valid_until: string | null;
};

export type InsuranceCommissionResult = {
  percent: number;       // em unidades % (ex: 0.15 = "0,15%")
  amount: number;        // baseValue × percent/100
  ruleId: string;
  modality: string;      // 'SLIP' | 'ESTOQUE_D0' (normalizado)
};

// trim + replace ' ' -> '_' + upper. Decisao Diego.
function normalizeModality(insuranceType: unknown): string {
  return String(insuranceType ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/**
 * Procura a regra TRP35 §188 / ESTOQUE aplicavel a uma proposta e retorna
 * a comissao Promotiva projetada sobre essa proposta.
 *
 * Retorna null quando:
 *   - baseValue <= 0 (sem base de calculo)
 *   - insuranceType vazio
 *   - nenhuma regra cobre a combinacao (modality, term, data)
 *
 * No caso de retornar null, o caller deve cair para a proxima camada da
 * cascata (PRODUCT_RULE -> PROMOTER_AGREEMENT -> MONTHLY_DEFAULT).
 *
 * Async: faz um round-trip Supabase por chamada. Para uso em loop quente
 * (ex: cascata em /api/calculate/monthly), preferir 'fetchInsuranceSlipRules'
 * 1x no inicio + 'calculateInsuranceCommissionFromRules' sync no loop.
 */
export async function calculateInsuranceCommission(args: {
  supabase: SupabaseClient;
  baseValue: number;
  insuranceType: string | null | undefined;
  termMonths: number | null | undefined;
  contractDate: Date | string | null | undefined;
}): Promise<InsuranceCommissionResult | null> {
  const rules = await fetchInsuranceSlipRules(args.supabase);
  return calculateInsuranceCommissionFromRules({
    rules,
    baseValue: args.baseValue,
    insuranceType: args.insuranceType,
    termMonths: args.termMonths,
    contractDate: args.contractDate,
  });
}

/**
 * Carrega TODAS as regras insurance_slip_rules. Cardinality baixa (~5-10
 * em producao), seguro carregar tudo em memoria.
 */
export async function fetchInsuranceSlipRules(
  supabase: SupabaseClient
): Promise<InsuranceSlipRule[]> {
  const { data, error } = await supabase
    .from("insurance_slip_rules")
    .select("id, modality, term_min, term_max, commission_percent, valid_from, valid_until");
  if (error) return [];
  return (data || []).map((r: any) => ({
    id: String(r.id),
    modality: String(r.modality),
    term_min: Number(r.term_min),
    term_max: r.term_max === null ? null : Number(r.term_max),
    commission_percent: Number(r.commission_percent),
    valid_from: String(r.valid_from),
    valid_until: r.valid_until ? String(r.valid_until) : null,
  }));
}

/**
 * Versao sync — filtra/seleciona regra em memoria. Usar em loops quentes
 * apos um unico fetch de 'fetchInsuranceSlipRules'.
 */
export function calculateInsuranceCommissionFromRules(args: {
  rules: InsuranceSlipRule[];
  baseValue: number;
  insuranceType: string | null | undefined;
  termMonths: number | null | undefined;
  contractDate: Date | string | null | undefined;
}): InsuranceCommissionResult | null {
  const { rules, baseValue, insuranceType, termMonths, contractDate } = args;

  if (!baseValue || baseValue <= 0) return null;
  if (!insuranceType) return null;

  const modality = normalizeModality(insuranceType);
  if (!modality) return null;

  const term = Number(termMonths || 0);
  const refDateIso = toIsoDate(contractDate) || new Date().toISOString().slice(0, 10);

  const candidates = rules.filter((r) => {
    if (r.modality !== modality) return false;
    if (r.valid_from > refDateIso) return false;
    if (r.valid_until && r.valid_until < refDateIso) return false;
    if (r.term_min > term) return false;
    if (r.term_max !== null && r.term_max < term) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  // Empate (raro, exigiria sobreposicao de faixas): pega a mais
  // especifica (menor janela). Em pratica so deve haver 1.
  candidates.sort((a, b) => {
    const aSpan = a.term_max === null ? Infinity : a.term_max - a.term_min;
    const bSpan = b.term_max === null ? Infinity : b.term_max - b.term_min;
    return aSpan - bSpan;
  });

  const rule = candidates[0];
  const rate = rule.commission_percent; // ex: 0.00150
  const percent = rate * 100;            // 0.15 em unidades %
  const amount = baseValue * rate;       // baseValue × 0.00150

  return {
    percent,
    amount,
    ruleId: rule.id,
    modality,
  };
}
