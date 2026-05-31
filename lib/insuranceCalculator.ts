// FIX-3.SEGURO — Calculo de comissao Promotiva sobre seguro.
// Fonte unica: tabela insurance_slip_rules (4 regras vigentes apos
// migration 20260530000000):
//
//   ESTOQUE_D0 pré-mar/2026: premio × 2,5% (mensal — motor registra TOTAL)
//   ESTOQUE_D0 mar/2026+:    gross × 0,15%   (parcela única)
//   SLIP pré-mar/2026:       premio × 2,5%   (parcela única)
//   SLIP mar/2026+:          gross × pct_faixa(Parcelas)  [TRP §188]
//
// Validacao empirica: Tarefas M/O/P/Q em 40 meses de fechamentos
// (19.522 CASH entries). Para Thaynara abr/2026 produz R$ 1.002,86
// exato (bate planilha Diego).
//
// PRAZO usado no lookup: PARCELAS do raw_payload (Tarefa M, 23/0).
// Caller passa termPromotiva = getPrazoTrp(record) (= Parcelas para
// nao-3100/3101). Para seguro, NUNCA e Antecipacao 13.
//
// BASE de calculo (campo base_field):
//   'premio' = insurance_value (premio do seguro)
//   'gross'  = gross_value (valor financiado bruto)
//
// Decisao Diego (Fase 3):
//   - Sem regra TRP match → retorna null. Caller marca proposta em
//     VERMELHO/aviso, NAO zera, NAO chuta fallback legacy.
//   - SEM override manual de seguro — so TRP + tabela de remuneracao
//     (penetracao na Etapa E via scale SEGURO_SLIP_MAIO_2026).

import type { SupabaseClient } from "@supabase/supabase-js";

export type InsuranceSlipRule = {
  id: string;
  modality: string;
  term_min: number;
  term_max: number | null;
  commission_percent: number;       // decimal: 0.00150 = 0,15%
  base_field: "gross" | "premio";   // qual valor da proposta multiplica
  valid_from: string;               // ISO yyyy-mm-dd
  valid_until: string | null;
};

export type InsuranceCommissionResult = {
  percent: number;                  // em unidades % (ex: 0.15 = "0,15%")
  amount: number;                   // base × percent/100
  ruleId: string;
  modality: string;                 // 'SLIP' | 'ESTOQUE_D0' (normalizado)
  baseField: "gross" | "premio";    // qual base foi multiplicada
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
 * Procura a regra insurance_slip_rules aplicavel a uma proposta e retorna
 * a comissao Promotiva projetada (sobre gross OU premio, conforme
 * rule.base_field).
 *
 * Retorna null quando:
 *   - insuranceType vazio
 *   - nenhuma regra cobre a combinacao (modality, term, data)
 *   - a base requerida pela rule (gross ou premio) e <= 0
 *
 * No caso de null, caller marca a proposta em VERMELHO/aviso — NAO chuta
 * fallback legacy (decisao Diego, Fase 3).
 *
 * Async: faz um round-trip Supabase por chamada. Para loop quente
 * (cascata em /api/calculate/monthly), preferir 'fetchInsuranceSlipRules'
 * 1x no inicio + 'calculateInsuranceCommissionFromRules' sync no loop.
 */
export async function calculateInsuranceCommission(args: {
  supabase: SupabaseClient;
  grossValue: number;
  premioValue: number;
  insuranceType: string | null | undefined;
  termPromotiva: number | null | undefined;
  contractDate: Date | string | null | undefined;
}): Promise<InsuranceCommissionResult | null> {
  const rules = await fetchInsuranceSlipRules(args.supabase);
  return calculateInsuranceCommissionFromRules({
    rules,
    grossValue: args.grossValue,
    premioValue: args.premioValue,
    insuranceType: args.insuranceType,
    termPromotiva: args.termPromotiva,
    contractDate: args.contractDate,
  });
}

/**
 * Carrega TODAS as regras insurance_slip_rules. Cardinality baixa (~7
 * em producao), seguro carregar tudo em memoria.
 */
export async function fetchInsuranceSlipRules(
  supabase: SupabaseClient
): Promise<InsuranceSlipRule[]> {
  const { data, error } = await supabase
    .from("insurance_slip_rules")
    .select(
      "id, modality, term_min, term_max, commission_percent, base_field, valid_from, valid_until"
    );
  if (error) return [];
  return (data || []).map((r: any) => ({
    id: String(r.id),
    modality: String(r.modality),
    term_min: Number(r.term_min),
    term_max: r.term_max === null ? null : Number(r.term_max),
    commission_percent: Number(r.commission_percent),
    base_field: r.base_field === "premio" ? "premio" : "gross",
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
  grossValue: number;
  premioValue: number;
  insuranceType: string | null | undefined;
  termPromotiva: number | null | undefined;
  contractDate: Date | string | null | undefined;
}): InsuranceCommissionResult | null {
  const { rules, grossValue, premioValue, insuranceType, termPromotiva, contractDate } = args;

  if (!insuranceType) return null;
  const modality = normalizeModality(insuranceType);
  if (!modality) return null;

  const term = Number(termPromotiva || 0);
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
  const baseField = rule.base_field;
  const base =
    baseField === "premio" ? Number(premioValue || 0) : Number(grossValue || 0);
  if (!base || base <= 0) return null;

  const rate = rule.commission_percent;
  const percent = rate * 100;
  const amount = base * rate;

  return {
    percent,
    amount,
    ruleId: rule.id,
    modality,
    baseField,
  };
}

// ===========================================================================
// FIX-1.E.6.E — Etapa E: scale SEGURO_SLIP_MAIO_2026 (Modelo B).
//
// Comissao SEGURO PROMOTOR =
//   SUM(insurance_commission_amount Promotiva total) ×
//   share_da_scale(penetracao mensal do promotor)
//
// volume_min/max da scale sao DECIMAIS (0..1). Penetracao precisa /100
// antes do lookup. insurance_commission_amount per-record NAO muda
// (continua sendo Promotiva total, sem share).
// ===========================================================================

const INSURANCE_SHARE_SCALE_CODE = "SEGURO_SLIP_MAIO_2026";

export type InsuranceShareTier = {
  volume_min: number;   // penetracao decimal 0..1 inclusive
  volume_max: number | null; // NULL = sem teto
  share_percent: number;
};

/**
 * Carrega tiers da scale SEGURO_SLIP_MAIO_2026 1x. Cardinality fixa
 * (7 tiers no seed). Em caso de erro / scale inexistente retorna [].
 *
 * Lookup por scale_code (canonical no seed); scale_id varia entre
 * ambientes.
 */
export async function fetchInsuranceSlipTiers(
  supabase: SupabaseClient
): Promise<InsuranceShareTier[]> {
  const { data: scaleRow, error: scaleErr } = await supabase
    .from("share_scale")
    .select("id")
    .eq("scale_code", INSURANCE_SHARE_SCALE_CODE)
    .maybeSingle();
  if (scaleErr || !scaleRow) return [];

  const scaleId = (scaleRow as { id: string }).id;
  const { data: tierRows, error: tierErr } = await supabase
    .from("share_scale_tier")
    .select("volume_min, volume_max, share_percent")
    .eq("scale_id", scaleId)
    .order("volume_min", { ascending: true });
  if (tierErr || !tierRows) return [];

  return (tierRows as any[]).map((r) => ({
    volume_min: Number(r.volume_min),
    volume_max: r.volume_max == null ? null : Number(r.volume_max),
    share_percent: Number(r.share_percent),
  }));
}

/**
 * Procura o share_percent aplicavel a uma penetracao mensal (decimal
 * 0..1). Borda inferior INCLUSIVA (p >= volume_min), borda superior
 * EXCLUSIVA (p < volume_max). Ultima faixa (volume_max = NULL) e
 * aberta a direita.
 *
 * FIX-1.E.6.E.2: exclusividade na borda superior. Evita que penetracao
 * exatamente igual a um limite (0.10, 0.20, 0.30) case em duas faixas
 * adjacentes — 30,00% precisa cair em "30%+", nao em "20-30%".
 *
 * Convencoes:
 *   - penetracao 0 cai na 1a faixa (volume_min=0).
 *   - sem match → 0 + console.warn (sinaliza buraco na scale).
 *   - tiers vazios → 0 (sem warn, scale ausente ja eh sinalizada upstream).
 */
export function lookupInsuranceShareFromPenetration(
  tiers: InsuranceShareTier[],
  penetracaoDecimal: number
): number {
  if (tiers.length === 0) return 0;

  const p = Number.isFinite(penetracaoDecimal) ? penetracaoDecimal : 0;

  const match = tiers.find((t) => {
    if (p < t.volume_min) return false;
    if (t.volume_max !== null && p >= t.volume_max) return false;
    return true;
  });

  if (!match) {
    console.warn(
      `[insuranceShare] sem tier para penetracao=${p} em ${INSURANCE_SHARE_SCALE_CODE}; retornando 0`
    );
    return 0;
  }
  return match.share_percent;
}
