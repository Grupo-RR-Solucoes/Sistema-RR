import type { SupabaseClient } from "@supabase/supabase-js";
import { BBTS_COMPANY_ID } from "./bbtsMonthly.ts";
// RÉGUA ÚNICA do valor do débito (lib/debitRules). NÃO reimplementar aqui.
import { debitAmountFor, fetchDebitRule } from "./debitRules.ts";

// ============================================================================
// debitInsuranceResolver — DÉBITO AUTOMÁTICO de cancelamento de seguro.
//
// Lê a aba "Seguro" do fechamento (entry_type='INSURANCE', sheet_name='Seguro',
// STATUS='CANCELADO'), dedup por OPERAÇÃO, resolve a chave J (PRT do MESMO
// fechamento → cms → daily) → promotor, aplica a REGRA VERSIONADA da competência
// (debit_rule_versions) e grava:
//   promoter_debits(AUTO) + promoter_debit_sources + parcela em promoter_discounts
//   (discount_type='CANCELAMENTO_SEGURO', debit_id, status='PENDING').
//
// REGRA (vigência é dado, não hardcode):
//   SUM_100        (jun/2026): 1 débito por promotor = Σ estornos, 1 parcela, 100%.
//   PER_OPERATION  (jul/2026+): 1 débito por operação, amount = estorno ×
//                  (estorno > threshold ? above_pct : below_pct).
//
// MASTER não resolvido → promoter_debit_assignments (FILA), sem criar débito.
// Assignments já ASSIGNED (Diego atribuiu) são RESPEITADAS e viram débito.
//
// IDEMPOTENTE: delete-and-replace dos AUTO/CANCELAMENTO_SEGURO da competência
// (parcelas e sources caem por cascade). dryRun => não grava, só devolve o plano.
// ============================================================================

const CANCELAMENTO_SEGURO = "CANCELAMENTO_SEGURO";

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value).trim();
  const normalized = raw.includes(",") ? raw.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".") : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}
function normKey(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").toUpperCase();
}
function mdGet(md: Record<string, unknown> | null, needle: string): unknown {
  if (!md) return undefined;
  const n = normKey(needle);
  for (const k of Object.keys(md)) if (normKey(k) === n || normKey(k).startsWith(n)) return md[k];
  return undefined;
}
// Paginação ORDENADA por id (sem ORDER BY, .range() repete linhas entre páginas).
async function pagedOrdered<T = any>(build: () => any): Promise<T[]> {
  let from = 0;
  const size = 1000;
  const all: T[] = [];
  while (true) {
    const { data, error } = await build().order("id", { ascending: true }).range(from, from + size - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < size) break;
    from += size;
  }
  return all;
}

type SupabaseLike = SupabaseClient;

export type ResolvedOperation = {
  operation: string;
  estorno: number;              // |COMISSÃO|
  chaveJ: string | null;
  keyType: string | null;
  promoterId: string | null;    // null => vai pra fila (MASTER/sem dono)
  promoterName: string | null;
  companyId: string | null;
  closingEntryId: string;
  resolvedVia: string;          // 'closing/PRT' | 'cms' | 'daily' | 'fila-atribuida'
  debitAmount: number;          // valor do débito após a regra
};

export type InsuranceDebitPlan = {
  competencia: string;
  dryRun: boolean;
  rule: any | null;
  ruleVersionId: string | null;
  debits: Array<{
    promoterId: string;
    promoterName: string;
    companyId: string | null;
    total: number;
    sources: ResolvedOperation[];
  }>;
  fila: ResolvedOperation[];     // MASTER pendentes
  totals: { individuais: number; somaIndividuais: number; fila: number; somaFila: number };
  avisos: string[];
};

/**
 * Resolve e (se !dryRun) grava os débitos automáticos de cancelamento de seguro
 * da competência a partir do fechamento. READ das fontes + WRITE em
 * promoter_debits / promoter_debit_sources / promoter_discounts / _assignments.
 */
export async function resolveInsuranceDebits(
  supabase: SupabaseLike,
  params: { year: number; month: number; dryRun?: boolean; createdBy?: string | null }
): Promise<InsuranceDebitPlan> {
  const { year, month } = params;
  const dryRun = params.dryRun !== false; // default dry-run
  const competencia = `${year}-${String(month).padStart(2, "0")}`;
  const avisos: string[] = [];

  // 1. Aba Seguro (CANCELADO), dedup por operação.
  const segRaw = await pagedOrdered<any>(() =>
    supabase
      .from("monthly_closing_entries")
      .select("id, company_id, commission_value, metadata")
      .eq("year", year)
      .eq("month", month)
      .eq("entry_type", "INSURANCE")
      .eq("sheet_name", "Seguro")
  );
  const seguro = [...new Map(segRaw.map((e) => [String(mdGet(e.metadata, "OPERAÇÃO")), e])).values()].filter(
    (e) => normKey(mdGet(e.metadata, "STATUS")) === "CANCELADO"
  );

  // 2. Mapas de resolução.
  const prt = await pagedOrdered<any>(() =>
    supabase.from("monthly_closing_entries").select("id, j_key, metadata").eq("year", year).eq("month", month).eq("entry_type", "PRT")
  );
  const prtByOp = new Map<string, string>();
  for (const e of prt) {
    const op = String(mdGet(e.metadata, "NRO OPERAÇÃO") ?? "");
    const cj = String(mdGet(e.metadata, "CHAVE J") ?? e.j_key ?? "");
    if (op && cj && !prtByOp.has(op)) prtByOp.set(op, cj);
  }
  const opNums = seguro.map((e) => String(mdGet(e.metadata, "OPERAÇÃO")));
  const cms = opNums.length
    ? await pagedOrdered<any>(() => supabase.from("cms_promoter_entries").select("id, contract_number, j_key, promoter_id").in("contract_number", opNums))
    : [];
  const cmsByOp = new Map<string, any>();
  for (const e of cms) if (!cmsByOp.has(String(e.contract_number))) cmsByOp.set(String(e.contract_number), e);
  const daily = opNums.length
    ? await pagedOrdered<any>(() => supabase.from("daily_production_records").select("id, proposal_number, j_key, assigned_promoter_id").in("proposal_number", opNums))
    : [];
  const dailyByOp = new Map<string, any>();
  for (const e of daily) if (!dailyByOp.has(String(e.proposal_number))) dailyByOp.set(String(e.proposal_number), e);

  const { data: jkeys } = await supabase.from("j_keys").select("j_key, promoter_id, key_type");
  const jkMap = new Map((jkeys || []).map((k: any) => [String(k.j_key).toUpperCase(), k]));
  const { data: proms } = await supabase.from("promoters").select("id, name");
  const nameById = new Map((proms || []).map((p: any) => [p.id, p.name]));

  // Atribuições MANUAIS já feitas pelo Diego (respeitar).
  const { data: assigns } = await supabase
    .from("promoter_debit_assignments")
    .select("operation, promoter_id, status")
    .eq("year", year)
    .eq("month", month);
  const assignByOp = new Map((assigns || []).map((a: any) => [String(a.operation), a]));

  // 3. Regra vigente da competência (régua única — lib/debitRules).
  const ruleRow = await fetchDebitRule(supabase, CANCELAMENTO_SEGURO, year, month);
  const rule = ruleRow?.rule ?? null;
  const ruleVersionId = ruleRow?.id ?? null;
  if (!rule) avisos.push(`SEM REGRA vigente para ${CANCELAMENTO_SEGURO} em ${competencia} — usando 100% (fallback).`);

  // 4. Resolve cada operação.
  const resolved: ResolvedOperation[] = [];
  const fila: ResolvedOperation[] = [];
  for (const e of seguro) {
    const md = e.metadata || {};
    const op = String(mdGet(md, "OPERAÇÃO"));
    const estorno = Math.abs(toNumber(mdGet(md, "COMISSÃO") ?? e.commission_value));
    let chaveJ: string | null = null;
    let resolvedVia = "";
    if (prtByOp.has(op)) { chaveJ = prtByOp.get(op)!; resolvedVia = "closing/PRT"; }
    else if (cmsByOp.get(op)?.j_key) { chaveJ = cmsByOp.get(op).j_key; resolvedVia = "cms"; }
    else if (dailyByOp.get(op)?.j_key) { chaveJ = dailyByOp.get(op).j_key; resolvedVia = "daily"; }

    const info = chaveJ ? jkMap.get(String(chaveJ).toUpperCase()) : undefined;
    let promoterId: string | null = null;
    let keyType: string | null = info ? info.key_type : null;
    // Atribuição manual já feita (Diego) tem precedência.
    const manual = assignByOp.get(op);
    if (manual && manual.status === "ASSIGNED" && manual.promoter_id) {
      promoterId = manual.promoter_id;
      resolvedVia = "fila-atribuida";
    } else if (info && info.key_type === "INDIVIDUAL") {
      promoterId = info.promoter_id;
    } else if (dailyByOp.get(op)?.assigned_promoter_id) {
      promoterId = dailyByOp.get(op).assigned_promoter_id;
      keyType = keyType ? `${keyType}+daily` : "MASTER+daily";
    }

    const rec: ResolvedOperation = {
      operation: op,
      estorno,
      chaveJ,
      keyType,
      promoterId,
      promoterName: promoterId ? nameById.get(promoterId) ?? null : null,
      companyId: e.company_id ?? null,
      closingEntryId: e.id,
      resolvedVia,
      debitAmount: debitAmountFor(estorno, rule),
    };
    if (promoterId) resolved.push(rec);
    else fila.push(rec);
  }

  // 5. Monta os débitos conforme a regra.
  const mode = rule?.mode ?? "SUM_100";
  type DebitAgg = { promoterId: string; promoterName: string; companyId: string | null; total: number; sources: ResolvedOperation[] };
  const debits: DebitAgg[] = [];
  if (mode === "SUM_100") {
    const byProm = new Map<string, DebitAgg>();
    for (const r of resolved) {
      let a = byProm.get(r.promoterId!);
      if (!a) { a = { promoterId: r.promoterId!, promoterName: r.promoterName || "?", companyId: r.companyId, total: 0, sources: [] }; byProm.set(r.promoterId!, a); }
      a.total += r.debitAmount; // 100%
      a.sources.push(r);
      // company representativa = a do maior estorno
      if (r.estorno >= Math.max(...a.sources.map((s) => s.estorno))) a.companyId = r.companyId;
    }
    debits.push(...byProm.values());
  } else {
    // PER_OPERATION: 1 débito por operação.
    for (const r of resolved) {
      debits.push({ promoterId: r.promoterId!, promoterName: r.promoterName || "?", companyId: r.companyId, total: r.debitAmount, sources: [r] });
    }
  }

  const plan: InsuranceDebitPlan = {
    competencia,
    dryRun,
    rule,
    ruleVersionId,
    debits,
    fila,
    totals: {
      individuais: resolved.length,
      somaIndividuais: Number(resolved.reduce((a, r) => a + r.estorno, 0).toFixed(2)),
      fila: fila.length,
      somaFila: Number(fila.reduce((a, r) => a + r.estorno, 0).toFixed(2)),
    },
    avisos,
  };
  if (fila.length) avisos.push(`${fila.length} estorno(s) aguardando atribuição (MASTER).`);

  if (dryRun) return plan;

  // 6. GRAVAÇÃO idempotente (delete-and-replace dos AUTO/seguro da competência).
  const { data: oldDebits } = await supabase
    .from("promoter_debits")
    .select("id")
    .eq("kind", "AUTO")
    .eq("debit_type", CANCELAMENTO_SEGURO)
    .eq("start_year", year)
    .eq("start_month", month)
    .neq("company_id", BBTS_COMPANY_ID); // não apaga os débitos ADS (frente DAILY_CANCEL)
  const oldIds = (oldDebits || []).map((d: any) => d.id);
  if (oldIds.length) {
    // parcelas e sources caem por ON DELETE CASCADE ao apagar o débito.
    const { error } = await supabase.from("promoter_debits").delete().in("id", oldIds);
    if (error) throw error;
  }

  const nowIso = new Date().toISOString();
  for (const d of debits) {
    const { data: ins, error: e1 } = await supabase
      .from("promoter_debits")
      .insert({
        promoter_id: d.promoterId,
        company_id: d.companyId,
        kind: "AUTO",
        debit_type: CANCELAMENTO_SEGURO,
        total_amount: Number(d.total.toFixed(2)),
        installments_total: 1,
        start_year: year,
        start_month: month,
        rule_version_id: ruleVersionId,
        status: "ACTIVE",
        notes: `Automático: ${d.sources.length} estorno(s) de seguro.`,
        created_by: params.createdBy ?? "resolver",
      })
      .select("id")
      .single();
    if (e1) throw e1;
    const debitId = ins.id;
    // parcela única (auto seguro = à vista).
    const { error: e2 } = await supabase.from("promoter_discounts").insert({
      promoter_id: d.promoterId,
      company_id: d.companyId,
      year,
      month,
      discount_type: CANCELAMENTO_SEGURO,
      amount: Number(d.total.toFixed(2)),
      installments: 1,
      installment_number: 1,
      apply_to_company: false,
      debit_id: debitId,
      status: "PENDING",
      notes: "Débito automático — cancelamento de seguro.",
    });
    if (e2) throw e2;
    // sources (rastreabilidade).
    const { error: e3 } = await supabase.from("promoter_debit_sources").insert(
      d.sources.map((s) => ({
        debit_id: debitId,
        source_kind: "CLOSING_INSURANCE",
        operation: s.operation,
        closing_entry_id: s.closingEntryId,
        estorno_amount: Number(s.estorno.toFixed(2)),
        chave_j: s.chaveJ,
        resolved_via: s.resolvedVia,
      }))
    );
    if (e3) throw e3;
  }

  // 7. FILA — upsert dos MASTER pendentes (não recria os já ASSIGNED).
  for (const r of fila) {
    const existing = assignByOp.get(r.operation);
    if (existing && existing.status !== "PENDING") continue; // ASSIGNED/RESOLVED: não mexe
    const { error } = await supabase.from("promoter_debit_assignments").upsert(
      {
        year,
        month,
        source_kind: "CLOSING_INSURANCE",
        operation: r.operation,
        closing_entry_id: r.closingEntryId,
        estorno_amount: Number(r.estorno.toFixed(2)),
        chave_j: r.chaveJ,
        debit_type: CANCELAMENTO_SEGURO,
        status: "PENDING",
      },
      { onConflict: "year,month,operation" }
    );
    if (error) throw error;
  }

  return plan;
}

// ============================================================================
// resolveAdsCancelDebits — débito de cancelamento de seguro da ADS (source
// DAILY_CANCEL). A fonte é o BBTS (result.debitos do bbtsClosingImport), que hoje
// NÃO persistia (só console.log). Resolve o promotor via daily da ADS
// (proposal_number → assigned_promoter_id); sem dono → fila. Mesma regra
// versionada e mesmo destino (promoter_debits/discounts/assignments). estorno =
// |valor_seguro| do débito. Idempotente escopado à empresa ADS (não colide com
// o RR CLOSING_INSURANCE).
// ============================================================================
export async function resolveAdsCancelDebits(
  supabase: SupabaseLike,
  params: {
    year: number;
    month: number;
    debitos: Array<{ contrato: string; valor_seguro: number; tipo?: string | null }>;
    dryRun?: boolean;
    createdBy?: string | null;
  }
): Promise<InsuranceDebitPlan> {
  const { year, month } = params;
  const dryRun = params.dryRun !== false;
  const competencia = `${year}-${String(month).padStart(2, "0")}`;
  const avisos: string[] = [];
  const debitosRaw = params.debitos || [];

  const ops = debitosRaw.map((d) => String(d.contrato).trim());
  const daily = ops.length
    ? await pagedOrdered<any>(() =>
        supabase.from("daily_production_records").select("id, proposal_number, assigned_promoter_id").eq("company_id", BBTS_COMPANY_ID).in("proposal_number", ops)
      )
    : [];
  const dailyByOp = new Map<string, any>();
  for (const e of daily) if (!dailyByOp.has(String(e.proposal_number))) dailyByOp.set(String(e.proposal_number), e);
  const { data: proms } = await supabase.from("promoters").select("id, name");
  const nameById = new Map((proms || []).map((p: any) => [p.id, p.name]));
  const { data: assigns } = await supabase.from("promoter_debit_assignments").select("operation, promoter_id, status").eq("year", year).eq("month", month);
  const assignByOp = new Map((assigns || []).map((a: any) => [String(a.operation), a]));

  // Regra vigente da competência (régua única — lib/debitRules). MESMA regra do RR.
  const ruleRow = await fetchDebitRule(supabase, CANCELAMENTO_SEGURO, year, month);
  const rule = ruleRow?.rule ?? null;
  const ruleVersionId = ruleRow?.id ?? null;

  const resolved: ResolvedOperation[] = [];
  const fila: ResolvedOperation[] = [];
  for (const d of debitosRaw) {
    const op = String(d.contrato).trim();
    const estorno = Math.abs(toNumber(d.valor_seguro));
    let promoterId: string | null = null;
    let resolvedVia = "";
    const manual = assignByOp.get(op);
    if (manual && manual.status === "ASSIGNED" && manual.promoter_id) { promoterId = manual.promoter_id; resolvedVia = "fila-atribuida"; }
    else if (dailyByOp.get(op)?.assigned_promoter_id) { promoterId = dailyByOp.get(op).assigned_promoter_id; resolvedVia = "daily"; }
    const rec: ResolvedOperation = {
      operation: op,
      estorno,
      chaveJ: null,
      keyType: null,
      promoterId,
      promoterName: promoterId ? nameById.get(promoterId) ?? null : null,
      companyId: BBTS_COMPANY_ID,
      closingEntryId: "", // ADS não tem monthly_closing_entries; origem é o BBTS/JSON
      resolvedVia,
      debitAmount: debitAmountFor(estorno, rule),
    };
    if (promoterId) resolved.push(rec);
    else fila.push(rec);
  }

  const mode = rule?.mode ?? "SUM_100";
  const debits: InsuranceDebitPlan["debits"] = [];
  if (mode === "SUM_100") {
    const byProm = new Map<string, InsuranceDebitPlan["debits"][number]>();
    for (const r of resolved) {
      let a = byProm.get(r.promoterId!);
      if (!a) { a = { promoterId: r.promoterId!, promoterName: r.promoterName || "?", companyId: BBTS_COMPANY_ID, total: 0, sources: [] }; byProm.set(r.promoterId!, a); }
      a.total += r.debitAmount;
      a.sources.push(r);
    }
    debits.push(...byProm.values());
  } else {
    for (const r of resolved) debits.push({ promoterId: r.promoterId!, promoterName: r.promoterName || "?", companyId: BBTS_COMPANY_ID, total: r.debitAmount, sources: [r] });
  }

  const plan: InsuranceDebitPlan = {
    competencia,
    dryRun,
    rule,
    ruleVersionId,
    debits,
    fila,
    totals: {
      individuais: resolved.length,
      somaIndividuais: Number(resolved.reduce((a, r) => a + r.estorno, 0).toFixed(2)),
      fila: fila.length,
      somaFila: Number(fila.reduce((a, r) => a + r.estorno, 0).toFixed(2)),
    },
    avisos,
  };
  if (fila.length) avisos.push(`${fila.length} cancelamento(s) ADS aguardando atribuição.`);
  if (dryRun) return plan;

  // GRAVAÇÃO idempotente escopada à ADS (source DAILY_CANCEL / company ADS).
  const { data: oldDebits } = await supabase
    .from("promoter_debits")
    .select("id")
    .eq("kind", "AUTO")
    .eq("debit_type", CANCELAMENTO_SEGURO)
    .eq("start_year", year)
    .eq("start_month", month)
    .eq("company_id", BBTS_COMPANY_ID);
  const oldIds = (oldDebits || []).map((d: any) => d.id);
  if (oldIds.length) {
    const { error } = await supabase.from("promoter_debits").delete().in("id", oldIds);
    if (error) throw error;
  }
  for (const d of debits) {
    const { data: ins, error: e1 } = await supabase
      .from("promoter_debits")
      .insert({
        promoter_id: d.promoterId, company_id: BBTS_COMPANY_ID, kind: "AUTO", debit_type: CANCELAMENTO_SEGURO,
        total_amount: Number(d.total.toFixed(2)), installments_total: 1, start_year: year, start_month: month,
        rule_version_id: ruleVersionId, status: "ACTIVE", notes: `ADS: ${d.sources.length} cancelamento(s).`, created_by: params.createdBy ?? "resolver-ads",
      })
      .select("id")
      .single();
    if (e1) throw e1;
    const debitId = ins.id;
    const { error: e2 } = await supabase.from("promoter_discounts").insert({
      promoter_id: d.promoterId, company_id: BBTS_COMPANY_ID, year, month, discount_type: CANCELAMENTO_SEGURO,
      amount: Number(d.total.toFixed(2)), installments: 1, installment_number: 1, apply_to_company: false,
      debit_id: debitId, status: "PENDING", notes: "Débito automático — cancelamento de seguro (ADS).",
    });
    if (e2) throw e2;
    const { error: e3 } = await supabase.from("promoter_debit_sources").insert(
      d.sources.map((sc) => ({ debit_id: debitId, source_kind: "DAILY_CANCEL", operation: sc.operation, estorno_amount: Number(sc.estorno.toFixed(2)), resolved_via: sc.resolvedVia }))
    );
    if (e3) throw e3;
  }
  for (const r of fila) {
    const existing = assignByOp.get(r.operation);
    if (existing && existing.status !== "PENDING") continue;
    const { error } = await supabase.from("promoter_debit_assignments").upsert(
      { year, month, source_kind: "DAILY_CANCEL", operation: r.operation, estorno_amount: Number(r.estorno.toFixed(2)), debit_type: CANCELAMENTO_SEGURO, status: "PENDING" },
      { onConflict: "year,month,operation" }
    );
    if (error) throw error;
  }
  return plan;
}
