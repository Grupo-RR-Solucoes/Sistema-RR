// FRENTE DE PRODUTO — fila com memoria (M2a): atribuicao do promotor as linhas de
// produto de EVENTO UNICO (BBCAP / Conta Corrente), e o calculo do repasse
// consolidado por promotor para o ledger.
//
// - Nao ha heranca por parcela (evento unico); a heranca que importa e o REPROCESSO
//   do mesmo fechamento: a chave da fila = a chave natural do M1, entao reimportar
//   nao perde a atribuicao ja feita.
// - Upsert respeita decisao humana (status ASSIGNED nunca vira PENDING de volta).
import type { SupabaseClient } from "@supabase/supabase-js";
import { repassePromotor } from "./produtoRepasse.ts";
import {
  computeConsorcioCommissionByPromoter,
  syncPendingConsorcioAnchors,
} from "./consorcio/fila.ts";

type SupabaseLike = SupabaseClient;

// Produtos de evento unico cobertos pelo M2a. Consorcio/LOB (diferidos) = M2b.
export const EVENTO_UNICO_ENTRY_TYPES = ["BBCAP", "CONTA_CORRENTE"] as const;
export type ProductEntryType = (typeof EVENTO_UNICO_ENTRY_TYPES)[number];

type ProductEntry = {
  company_id: string | null;
  year: number;
  month: number;
  entry_type: string;
  operation_number: string | null;
  contract_number: string | null;
  commission_value: number | null;
};

async function fetchProductEntries(
  supabase: SupabaseLike,
  year: number,
  month: number
): Promise<ProductEntry[]> {
  const out: ProductEntry[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("monthly_closing_entries")
      .select("company_id, year, month, entry_type, operation_number, contract_number, commission_value")
      .eq("year", year)
      .eq("month", month)
      .in("entry_type", EVENTO_UNICO_ENTRY_TYPES as unknown as string[])
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as ProductEntry[]));
    if (data.length < page) break;
    from += page;
  }
  return out;
}

// Cria linhas PENDING na fila para toda linha de produto que ainda nao tem
// atribuicao. Idempotente: nunca toca linhas ja existentes (preserva ASSIGNED).
export async function syncPendingProductAssignments(
  supabase: SupabaseLike,
  params: { year: number; month: number; dryRun?: boolean }
): Promise<{ criadas: number; existentes: number }> {
  const { year, month } = params;
  const dryRun = params.dryRun === true;
  const entries = await fetchProductEntries(supabase, year, month);

  const { data: existing, error } = await supabase
    .from("product_line_assignments")
    .select("company_id, entry_type, operation_number, contract_number")
    .eq("year", year)
    .eq("month", month);
  if (error) throw new Error(error.message);
  const seen = new Set(
    (existing || []).map(
      (a: any) =>
        `${a.company_id}|${a.entry_type}|${a.operation_number}|${a.contract_number ?? ""}`
    )
  );

  const novas: any[] = [];
  const novasChaves = new Set<string>();
  for (const e of entries) {
    const key = `${e.company_id}|${e.entry_type}|${e.operation_number}|${e.contract_number ?? ""}`;
    if (seen.has(key) || novasChaves.has(key)) continue;
    novasChaves.add(key);
    novas.push({
      company_id: e.company_id,
      year,
      month,
      entry_type: e.entry_type,
      operation_number: e.operation_number,
      contract_number: e.contract_number ?? "",
      promoter_id: null,
      status: "PENDING",
      source: "MANUAL",
    });
  }

  if (!dryRun && novas.length > 0) {
    for (let i = 0; i < novas.length; i += 500) {
      const { error: insErr } = await supabase
        .from("product_line_assignments")
        .insert(novas.slice(i, i + 500));
      if (insErr) throw new Error(insErr.message);
    }
  }
  return { criadas: novas.length, existentes: seen.size };
}

// Atribui (ou reatribui) uma linha ao promotor. Chamado pela tela do socio (M3) e
// idempotente por chave natural. status vira ASSIGNED; reprocesso nao sobrescreve.
export async function assignProductLine(
  supabase: SupabaseLike,
  params: {
    company_id: string | null;
    year: number;
    month: number;
    entry_type: string;
    operation_number: string;
    contract_number?: string;
    promoter_id: string | null; // null volta para PENDING (desatribuir)
    assigned_by?: string | null;
  }
): Promise<void> {
  const row = {
    company_id: params.company_id,
    year: params.year,
    month: params.month,
    entry_type: params.entry_type,
    operation_number: params.operation_number,
    contract_number: params.contract_number ?? "",
    promoter_id: params.promoter_id,
    status: params.promoter_id ? "ASSIGNED" : "PENDING",
    source: "MANUAL",
    assigned_by: params.assigned_by ?? null,
    assigned_at: params.promoter_id ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("product_line_assignments")
    .upsert(row, {
      onConflict: "company_id,year,month,entry_type,operation_number,contract_number",
    });
  if (error) throw new Error(error.message);
}

export type ProductCommissionByPromoter = Map<
  string, // `${promoter_id}|${company_id}`
  {
    promoter_id: string;
    company_id: string | null;
    bbcap: number;
    conta_corrente: number;
    consorcio: number; // M2b: repasse do consorcio (comissao-empresa x 0,40)
    lob: number; // M2b: adiado (sem fonte) — sempre 0
  }
>;

// Repasse consolidado por (promotor, empresa): junta as linhas de produto
// (comissao-EMPRESA no fechamento) com a fila (ASSIGNED -> promoter_id) e aplica o
// fator de repasse. Linhas PENDING/balde NAO entram (sem promotor = sem repasse).
export async function computeProductCommissionByPromoter(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<ProductCommissionByPromoter> {
  const { year, month } = params;
  const entries = await fetchProductEntries(supabase, year, month);

  const { data: assigns, error } = await supabase
    .from("product_line_assignments")
    .select("company_id, entry_type, operation_number, contract_number, promoter_id, status")
    .eq("year", year)
    .eq("month", month)
    .eq("status", "ASSIGNED");
  if (error) throw new Error(error.message);
  const promoterByKey = new Map<string, string>();
  for (const a of assigns || []) {
    if (!a.promoter_id) continue;
    promoterByKey.set(
      `${a.company_id}|${a.entry_type}|${a.operation_number}|${a.contract_number ?? ""}`,
      a.promoter_id
    );
  }

  const acc: ProductCommissionByPromoter = new Map();
  const novoBucket = (pid: string, company_id: string | null) => ({
    promoter_id: pid,
    company_id,
    bbcap: 0,
    conta_corrente: 0,
    consorcio: 0,
    lob: 0,
  });
  for (const e of entries) {
    const key = `${e.company_id}|${e.entry_type}|${e.operation_number}|${e.contract_number ?? ""}`;
    const pid = promoterByKey.get(key);
    if (!pid) continue; // PENDING/balde: sem repasse ate ser atribuido
    const repasse = repassePromotor(Number(e.commission_value || 0));
    const ak = `${pid}|${e.company_id}`;
    const cur = acc.get(ak) || novoBucket(pid, e.company_id);
    if (e.entry_type === "BBCAP") cur.bbcap += repasse;
    else if (e.entry_type === "CONTA_CORRENTE") cur.conta_corrente += repasse;
    acc.set(ak, cur);
  }

  // M2b — CONSORCIO (diferido): resolve o promotor pela ANCORA da proposta (heranca)
  // e soma a comissao-empresa das parcelas RECEBIDAS no mes x 0,40. LOB fica adiado.
  const cons = await computeConsorcioCommissionByPromoter(supabase, { year, month });
  for (const c of cons.values()) {
    const ak = `${c.promoter_id}|${c.company_id}`;
    const cur = acc.get(ak) || novoBucket(c.promoter_id, c.company_id);
    cur.consorcio += c.consorcio;
    acc.set(ak, cur);
  }

  // arredonda o agregado para 2 casas (numeric(18,2) do PMR).
  for (const v of acc.values()) {
    v.bbcap = Math.round(v.bbcap * 100) / 100;
    v.conta_corrente = Math.round(v.conta_corrente * 100) / 100;
    v.consorcio = Math.round(v.consorcio * 100) / 100;
    v.lob = Math.round(v.lob * 100) / 100;
  }
  return acc;
}

const chavePmr = (promoterId: string, companyId: string | null) =>
  `${promoterId}|${companyId ?? "NULL"}`;

// Aplica o repasse de produto ao PMR fechado: grava as colunas por produto e
// RECOMPOE final = producao + seguro + bbcap + conta_corrente. Aditivo e
// idempotente (recompoe do proprio row). So toca promotores COM produto atribuido
// -> quem nao tem produto fica byte-identico (gate). Roda dentro do
// reconsolidarCompetenciaFechada, depois do consolidateMonthlyGroup.
//
// Devolve as chaves (promoter|company) tocadas, para o reconciliador NAO apagar os
// promotores que so tem produto (sem credito/seguro).
export async function applyProdutoRepasseAoPmr(
  supabase: SupabaseLike,
  params: { year: number; month: number; dryRun?: boolean }
): Promise<{ chaves: Set<string>; atualizadas: number; inseridas: number; promotores: number }> {
  const { year, month } = params;
  const dryRun = params.dryRun === true;

  await syncPendingProductAssignments(supabase, { year, month, dryRun });
  await syncPendingConsorcioAnchors(supabase, { dryRun }); // M2b: ancoras por proposta
  const porPromotor = await computeProductCommissionByPromoter(supabase, { year, month });

  const chaves = new Set<string>();
  for (const v of porPromotor.values()) chaves.add(chavePmr(v.promoter_id, v.company_id));
  if (porPromotor.size === 0 || dryRun) {
    return { chaves, atualizadas: 0, inseridas: 0, promotores: porPromotor.size };
  }

  // Le producao/seguro atuais dos promotores com produto (para recompor o final
  // SEM tocar producao/seguro).
  const pids = [...new Set([...porPromotor.values()].map((v) => v.promoter_id))];
  const existentes = new Map<string, { prod: number; ins: number }>();
  for (let i = 0; i < pids.length; i += 300) {
    const { data, error } = await supabase
      .from("promoter_monthly_results")
      .select("promoter_id, company_id, production_commission_value, insurance_commission_value")
      .eq("year", year)
      .eq("month", month)
      .in("promoter_id", pids.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const r of data || []) {
      existentes.set(chavePmr(r.promoter_id, r.company_id), {
        prod: Number(r.production_commission_value || 0),
        ins: Number(r.insurance_commission_value || 0),
      });
    }
  }

  const updates: any[] = []; // linhas ja existentes: nao mexe em producao/seguro
  const inserts: any[] = []; // promotores so-produto: nascem com producao/seguro 0
  for (const v of porPromotor.values()) {
    const k = chavePmr(v.promoter_id, v.company_id);
    const base = existentes.get(k);
    const prod = base?.prod ?? 0;
    const ins = base?.ins ?? 0;
    const final =
      Math.round((prod + ins + v.bbcap + v.conta_corrente + v.consorcio + v.lob) * 100) / 100;
    if (base) {
      updates.push({
        promoter_id: v.promoter_id,
        company_id: v.company_id,
        year,
        month,
        bbcap_commission_value: v.bbcap,
        conta_corrente_commission_value: v.conta_corrente,
        consorcio_commission_value: v.consorcio,
        lob_commission_value: v.lob,
        final_commission_value: final,
      });
    } else {
      inserts.push({
        promoter_id: v.promoter_id,
        company_id: v.company_id,
        year,
        month,
        source: "fechamento",
        production_commission_value: 0,
        insurance_commission_value: 0,
        bbcap_commission_value: v.bbcap,
        conta_corrente_commission_value: v.conta_corrente,
        consorcio_commission_value: v.consorcio,
        lob_commission_value: v.lob,
        final_commission_value: final,
      });
    }
  }

  const onConflict = "promoter_id,year,month,company_id";
  for (const batch of [updates, inserts]) {
    for (let i = 0; i < batch.length; i += 500) {
      const { error } = await supabase
        .from("promoter_monthly_results")
        .upsert(batch.slice(i, i + 500), { onConflict });
      if (error) throw new Error(error.message);
    }
  }
  return { chaves, atualizadas: updates.length, inseridas: inserts.length, promotores: porPromotor.size };
}
