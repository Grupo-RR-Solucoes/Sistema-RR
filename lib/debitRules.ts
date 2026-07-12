import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// debitRules — FONTE ÚNICA da régua de valor do débito automático.
//
// Antes desta lib a régua existia em TRÊS lugares:
//   1. debitInsuranceResolver.debitAmountFor  (correta, versionada)
//   2. debitsData.ruleAmount + fetchRule      (cópia da correta)
//   3. app/api/promotores/route.resolveDiscountAmount → companyAmount * 0.7
//      (LEGADO, hardcoded, à margem do debit_rule_versions)
// O (3) pagava 70% enquanto o (1)/(2) pagavam o que a regra da competência manda:
// duas réguas ativas ao mesmo tempo. Esta lib é a única régua; os três pontos
// agora importam daqui.
//
// A regra é DADO (tabela debit_rule_versions), nunca hardcode:
//   SUM_100        — desconta 100% do estorno (agregação por promotor fora daqui).
//   PER_OPERATION  — por operação: estorno > threshold ? above_pct : below_pct.
//
// Vigência: vale a regra de MAIOR vigencia_inicio ≤ 1º dia da competência.
//   jun/2026: SUM_100 (CONGELADO — lançado à mão, não se recalcula).
//   jul/2026+: PER_OPERATION.
// ============================================================================

type SupabaseLike = SupabaseClient;

export type DebitRule = {
  mode: "SUM_100" | "PER_OPERATION" | string;
  threshold?: number;
  above_pct?: number;
  below_pct?: number;
};

export type DebitRuleVersion = {
  id: string;
  rule: DebitRule;
  vigencia_inicio?: string;
};

/**
 * Tipos de débito cujo valor é DERIVADO (o usuário informa a base da empresa e a
 * régua decide quanto desce do promotor). Os demais tipos descem pelo valor cheio.
 */
export const DEBIT_AUTO_TYPES = new Set([
  "LIQUIDACAO_ANTECIPADA",
  "CANCELAMENTO_SEGURO",
  "CANCELAMENTO_CREDITO",
  "ESTORNO_CREDITO",
  "RENOVACAO_ANTECIPADA",
]);

export function isAutoDebitType(debitType: string): boolean {
  return DEBIT_AUTO_TYPES.has(String(debitType || "").toUpperCase());
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Regra VIGENTE do tipo na competência (maior vigencia_inicio ≤ competência).
 * null => não há regra versionada para este tipo nesta competência. O chamador
 * decide o que fazer com isso — NUNCA inventar um percentual.
 */
export async function fetchDebitRule(
  supabase: SupabaseLike,
  debitType: string,
  year: number,
  month: number
): Promise<DebitRuleVersion | null> {
  const primeiroDia = `${year}-${String(month).padStart(2, "0")}-01`;
  const { data, error } = await supabase
    .from("debit_rule_versions")
    .select("id, rule, vigencia_inicio")
    .eq("debit_type", debitType)
    .lte("vigencia_inicio", primeiroDia)
    .order("vigencia_inicio", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data || [])[0] as DebitRuleVersion) || null;
}

/**
 * Valor que DESCE do promotor para UM estorno, segundo a regra da competência.
 * rule=null => 100% do estorno (o valor cheio — nunca um percentual inventado).
 * Os defaults (threshold/above/below) só valem se a linha da regra vier sem a
 * chave; o normal é a regra trazer tudo — ela é a fonte da verdade.
 */
export function debitAmountFor(estorno: number, rule: DebitRule | null | undefined): number {
  const base = Number(estorno) || 0;
  if (!rule || rule.mode === "SUM_100") return base;
  if (rule.mode === "PER_OPERATION") {
    const threshold = Number(rule.threshold ?? 100);
    const above = Number(rule.above_pct ?? 0.8);
    const below = Number(rule.below_pct ?? 1.0);
    return base * (base > threshold ? above : below);
  }
  return base;
}
