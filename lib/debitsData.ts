import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDonaCompanyForPromoter } from "./closingMonthly.ts";

// ============================================================================
// debitsData — leitura e AÇÕES dos débitos do promotor (itens 3/4/5).
//   fetchPromoterDebits  — débitos do promotor no mês (com sources/origem + saldo)
//   fetchDebitQueue      — fila dos estornos MASTER/ADS aguardando atribuição
//   createManualDebit    — cadastro manual: gera o plano + N parcelas
//   assignQueuedDebit    — atribui um item da fila ao promotor e cria o débito
// Parcela = promoter_discounts (reuso). Saldo = total − Σ(status='APPLIED').
// ============================================================================

type SupabaseLike = SupabaseClient;

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function ruleAmount(estorno: number, rule: any): number {
  if (!rule || rule.mode === "SUM_100") return estorno;
  if (rule.mode === "PER_OPERATION") {
    const threshold = Number(rule.threshold ?? 100);
    return estorno * (estorno > threshold ? Number(rule.above_pct ?? 0.8) : Number(rule.below_pct ?? 1.0));
  }
  return estorno;
}
async function fetchRule(supabase: SupabaseLike, debitType: string, year: number, month: number) {
  const comp = `${year}-${String(month).padStart(2, "0")}-01`;
  const { data } = await supabase
    .from("debit_rule_versions")
    .select("id, rule")
    .eq("debit_type", debitType)
    .lte("vigencia_inicio", comp)
    .order("vigencia_inicio", { ascending: false })
    .limit(1);
  return (data || [])[0] || null;
}

export type PromoterDebitRow = {
  id: string;
  kind: string;
  debit_type: string;
  total_amount: number;
  installments_total: number;
  status: string;
  // parcela do mês corrente (se houver) + saldo do plano
  parcela_mes: number;
  installment_number: number | null;
  parcela_status: string | null;
  desceu: number; // Σ parcelas APPLIED
  falta: number; // total − desceu
  sources: Array<{ operation: string | null; estorno_amount: number; resolved_via: string | null }>;
};

// Débitos que TOCAM o mês (têm parcela na competência) do promotor, com saldo e origem.
export async function fetchPromoterDebits(
  supabase: SupabaseLike,
  params: { year: number; month: number; promoterId: string }
): Promise<PromoterDebitRow[]> {
  const { year, month, promoterId } = params;
  // parcelas do mês (promoter_discounts com debit_id)
  const { data: parcelasMes } = await supabase
    .from("promoter_discounts")
    .select("debit_id, amount, installment_number, status")
    .eq("promoter_id", promoterId)
    .eq("year", year)
    .eq("month", month)
    .not("debit_id", "is", null);
  const debitIds = [...new Set((parcelasMes || []).map((p: any) => p.debit_id))];
  if (debitIds.length === 0) return [];

  const { data: debits } = await supabase
    .from("promoter_debits")
    .select("id, kind, debit_type, total_amount, installments_total, status")
    .in("id", debitIds);
  const { data: allParcelas } = await supabase
    .from("promoter_discounts")
    .select("debit_id, amount, status")
    .in("debit_id", debitIds);
  const { data: sources } = await supabase
    .from("promoter_debit_sources")
    .select("debit_id, operation, estorno_amount, resolved_via")
    .in("debit_id", debitIds);

  const parcelaMesByDebit = new Map((parcelasMes || []).map((p: any) => [p.debit_id, p]));
  return (debits || []).map((d: any) => {
    const pm = parcelaMesByDebit.get(d.id);
    const desceu = round2((allParcelas || []).filter((p: any) => p.debit_id === d.id && p.status === "APPLIED").reduce((a: number, p: any) => a + Number(p.amount), 0));
    return {
      id: d.id,
      kind: d.kind,
      debit_type: d.debit_type,
      total_amount: Number(d.total_amount),
      installments_total: d.installments_total,
      status: d.status,
      parcela_mes: pm ? Number(pm.amount) : 0,
      installment_number: pm ? pm.installment_number : null,
      parcela_status: pm ? pm.status : null,
      desceu,
      falta: round2(Number(d.total_amount) - desceu),
      sources: (sources || []).filter((sc: any) => sc.debit_id === d.id).map((sc: any) => ({ operation: sc.operation, estorno_amount: Number(sc.estorno_amount), resolved_via: sc.resolved_via })),
    };
  });
}

export type DebitQueueRow = {
  id: string;
  operation: string;
  source_kind: string;
  estorno_amount: number;
  chave_j: string | null;
  debit_type: string;
};

export async function fetchDebitQueue(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<DebitQueueRow[]> {
  const { data } = await supabase
    .from("promoter_debit_assignments")
    .select("id, operation, source_kind, estorno_amount, chave_j, debit_type")
    .eq("year", params.year)
    .eq("month", params.month)
    .eq("status", "PENDING")
    .order("estorno_amount", { ascending: false });
  return (data || []).map((r: any) => ({ ...r, estorno_amount: Number(r.estorno_amount) }));
}

// Cadastro MANUAL: cria o plano + N parcelas (total/N, ajuste de centavos na última).
export async function createManualDebit(
  supabase: SupabaseLike,
  params: {
    promoterId: string;
    companyId: string | null;
    debitType: string;
    totalAmount: number;
    installmentsTotal: number;
    startYear: number;
    startMonth: number;
    notes?: string | null;
    createdBy?: string | null;
  }
): Promise<{ debitId: string; parcelas: number }> {
  const n = Math.max(1, Math.floor(params.installmentsTotal || 1));
  const total = round2(params.totalAmount);
  const { data: ins, error: e1 } = await supabase
    .from("promoter_debits")
    .insert({
      promoter_id: params.promoterId,
      company_id: params.companyId,
      kind: "MANUAL",
      debit_type: params.debitType,
      total_amount: total,
      installments_total: n,
      start_year: params.startYear,
      start_month: params.startMonth,
      status: "ACTIVE",
      notes: params.notes ?? null,
      created_by: params.createdBy ?? null,
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const debitId = ins.id;

  const base = round2(total / n);
  const rows = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    let m = params.startMonth + i;
    let y = params.startYear;
    while (m > 12) { m -= 12; y += 1; }
    const amount = i === n - 1 ? round2(total - acc) : base;
    acc = round2(acc + base);
    rows.push({
      promoter_id: params.promoterId,
      company_id: params.companyId,
      year: y,
      month: m,
      discount_type: params.debitType,
      amount,
      installments: n,
      installment_number: i + 1,
      apply_to_company: false,
      debit_id: debitId,
      status: "PENDING",
      notes: params.notes ?? null,
    });
  }
  const { error: e2 } = await supabase.from("promoter_discounts").insert(rows);
  if (e2) throw e2;
  return { debitId, parcelas: rows.length };
}

// Atribui um item da FILA a um promotor e cria o débito (AUTO) + source + parcela.
export async function assignQueuedDebit(
  supabase: SupabaseLike,
  params: { assignmentId: string; promoterId: string; createdBy?: string | null }
): Promise<{ debitId: string; amount: number }> {
  const { data: a, error: eA } = await supabase
    .from("promoter_debit_assignments")
    .select("id, year, month, operation, source_kind, closing_entry_id, estorno_amount, chave_j, debit_type, status")
    .eq("id", params.assignmentId)
    .single();
  if (eA) throw eA;
  if (a.status === "RESOLVED") throw new Error("Item da fila já resolvido.");

  const ruleRow = await fetchRule(supabase, a.debit_type, a.year, a.month);
  const estorno = Number(a.estorno_amount);
  const amount = round2(ruleAmount(estorno, ruleRow?.rule));
  const isAds = a.source_kind === "DAILY_CANCEL";
  // ADS mantém a company ADS. MASTER (fechamento) resolve a empresa DONA
  // determinística pela MESMA régua do fechamento (computeDonaCompanyMap) — antes
  // gravava null e o débito sumia ao filtrar por empresa.
  const companyId = isAds
    ? "375aea6d-3b9c-4490-87f0-e739e312c8ef"
    : await resolveDonaCompanyForPromoter(supabase, { year: a.year, month: a.month, promoterId: params.promoterId });

  const { data: ins, error: e1 } = await supabase
    .from("promoter_debits")
    .insert({
      promoter_id: params.promoterId,
      company_id: companyId,
      kind: "AUTO",
      debit_type: a.debit_type,
      total_amount: amount,
      installments_total: 1,
      start_year: a.year,
      start_month: a.month,
      rule_version_id: ruleRow?.id ?? null,
      status: "ACTIVE",
      notes: `Atribuído da fila (operação ${a.operation}).`,
      created_by: params.createdBy ?? null,
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const debitId = ins.id;

  const { error: e2 } = await supabase.from("promoter_discounts").insert({
    promoter_id: params.promoterId,
    company_id: companyId,
    year: a.year,
    month: a.month,
    discount_type: a.debit_type,
    amount,
    installments: 1,
    installment_number: 1,
    apply_to_company: false,
    debit_id: debitId,
    status: "PENDING",
    notes: `Atribuído da fila (operação ${a.operation}).`,
  });
  if (e2) throw e2;

  const { error: e3 } = await supabase.from("promoter_debit_sources").insert({
    debit_id: debitId,
    source_kind: a.source_kind,
    operation: a.operation,
    closing_entry_id: a.closing_entry_id,
    estorno_amount: estorno,
    chave_j: a.chave_j,
    resolved_via: "fila-atribuida",
  });
  if (e3) throw e3;

  const { error: e4 } = await supabase
    .from("promoter_debit_assignments")
    .update({ promoter_id: params.promoterId, status: "RESOLVED", assigned_by: params.createdBy ?? null, assigned_at: new Date().toISOString() })
    .eq("id", params.assignmentId);
  if (e4) throw e4;

  return { debitId, amount };
}
