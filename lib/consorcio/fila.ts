// FRENTE DE PRODUTO — Movimento 2b: fila com memoria do CONSORCIO (heranca por
// proposta) e o repasse consolidado por promotor para o ledger.
//
// Diferente do M2a (evento unico, chave por-parcela): o consorcio e DIFERIDO. Uma
// proposta tem PARC1..n em meses diferentes, todas do MESMO promotor. Entao a fila
// usa uma ANCORA por (company, proposta): atribui 1x -> todas as parcelas (passadas e
// futuras, qualquer competencia) herdam. Reatribuir a ancora propaga automaticamente.
//
// A ancora vive em product_line_assignments com entry_type='CONSORCIO',
// contract_number='' e year/month = 1a competencia vista (informativo). A resolucao do
// promotor por parcela IGNORA year/month e casa so por (company, proposta).
import type { SupabaseClient } from "@supabase/supabase-js";
import { repasseConsorcioPromotor } from "./trp210.ts";

type SupabaseLike = SupabaseClient;

export const CONSORCIO_ENTRY_TYPE = "CONSORCIO";

export type ConsorcioEntry = {
  company_id: string | null;
  year: number;
  month: number;
  operation_number: string | null; // proposta
  contract_number: string | null; // 'R|PARCn' (regular) | 'M|PARCn' (master)
  commission_value: number | null; // comissao-EMPRESA ja pronta
  gross_value: number | null; // VALOR BEM
  metadata: any;
};

const chaveProposta = (companyId: string | null, proposta: string | null) =>
  `${companyId ?? "NULL"}|${proposta ?? ""}`;

// Linha REGULAR do consorcio (exclui a aba MASTER, que e espelho company-level e nao
// entra no repasse do promotor).
export function isRegular(e: Pick<ConsorcioEntry, "contract_number" | "metadata">): boolean {
  if (e.metadata && typeof e.metadata === "object" && e.metadata.master === true) return false;
  const cn = String(e.contract_number || "");
  if (cn.startsWith("M|")) return false;
  return true;
}

async function pageAll<T>(run: (from: number, page: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  let from = 0;
  for (;;) {
    const data = await run(from, page);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return out;
}

// Entries do consorcio de UMA competencia.
export async function fetchConsorcioEntries(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<ConsorcioEntry[]> {
  const { year, month } = params;
  return pageAll<ConsorcioEntry>(async (from, page) => {
    const { data, error } = await supabase
      .from("monthly_closing_entries")
      .select("company_id, year, month, operation_number, contract_number, commission_value, gross_value, metadata")
      .eq("entry_type", CONSORCIO_ENTRY_TYPE)
      .eq("year", year)
      .eq("month", month)
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    return (data as ConsorcioEntry[]) || [];
  });
}

// Entries do consorcio de TODAS as competencias (para materializar a carteira e
// sincronizar as ancoras — a heranca precisa do historico inteiro da proposta).
export async function fetchConsorcioEntriesAll(supabase: SupabaseLike): Promise<ConsorcioEntry[]> {
  return pageAll<ConsorcioEntry>(async (from, page) => {
    const { data, error } = await supabase
      .from("monthly_closing_entries")
      .select("company_id, year, month, operation_number, contract_number, commission_value, gross_value, metadata")
      .eq("entry_type", CONSORCIO_ENTRY_TYPE)
      .order("year", { ascending: true })
      .order("month", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    return (data as ConsorcioEntry[]) || [];
  });
}

// Cria uma ancora PENDING para toda proposta de consorcio que ainda nao tem ancora.
// Idempotente: nunca toca ancoras existentes (preserva ASSIGNED). year/month = 1a
// competencia vista da proposta (informativo). Usa select+insert (nao upsert), porque
// o alvo e um indice unico PARCIAL (PostgREST nao mira parcial no onConflict).
export async function syncPendingConsorcioAnchors(
  supabase: SupabaseLike,
  params?: { dryRun?: boolean }
): Promise<{ criadas: number; existentes: number }> {
  const dryRun = params?.dryRun === true;
  const entries = (await fetchConsorcioEntriesAll(supabase)).filter(isRegular);

  // 1a competencia por proposta.
  const primeira = new Map<string, { company_id: string | null; proposta: string; year: number; month: number }>();
  for (const e of entries) {
    const proposta = String(e.operation_number || "");
    if (!proposta) continue;
    const k = chaveProposta(e.company_id, proposta);
    const cur = primeira.get(k);
    const comp = e.year * 100 + e.month;
    if (!cur || comp < cur.year * 100 + cur.month) {
      primeira.set(k, { company_id: e.company_id, proposta, year: e.year, month: e.month });
    }
  }

  const { data: existing, error } = await supabase
    .from("product_line_assignments")
    .select("company_id, operation_number")
    .eq("entry_type", CONSORCIO_ENTRY_TYPE);
  if (error) throw new Error(error.message);
  const seen = new Set((existing || []).map((a: any) => chaveProposta(a.company_id, a.operation_number)));

  const novas: any[] = [];
  for (const [k, v] of primeira) {
    if (seen.has(k)) continue;
    novas.push({
      company_id: v.company_id,
      year: v.year,
      month: v.month,
      entry_type: CONSORCIO_ENTRY_TYPE,
      operation_number: v.proposta,
      contract_number: "",
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

// Atribui (ou reatribui) uma PROPOSTA inteira ao promotor. Chamado pela tela do socio
// (M3). Propaga para todas as parcelas por heranca (a resolucao casa pela proposta).
// select+insert/update por causa do indice unico parcial.
export async function assignConsorcioProposta(
  supabase: SupabaseLike,
  params: {
    company_id: string | null;
    proposta: string;
    promoter_id: string | null; // null volta para PENDING (desatribuir)
    year?: number;
    month?: number;
    assigned_by?: string | null;
  }
): Promise<void> {
  const { company_id, proposta, promoter_id } = params;
  let q = supabase
    .from("product_line_assignments")
    .select("id")
    .eq("entry_type", CONSORCIO_ENTRY_TYPE)
    .eq("operation_number", proposta);
  q = company_id === null ? q.is("company_id", null) : q.eq("company_id", company_id);
  const { data: found, error: selErr } = await q.maybeSingle();
  if (selErr) throw new Error(selErr.message);

  const patch = {
    promoter_id,
    status: promoter_id ? "ASSIGNED" : "PENDING",
    source: "MANUAL",
    assigned_by: params.assigned_by ?? null,
    assigned_at: promoter_id ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  if (found?.id) {
    const { error } = await supabase.from("product_line_assignments").update(patch).eq("id", found.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase.from("product_line_assignments").insert({
    company_id,
    year: params.year ?? 0,
    month: params.month ?? 0,
    entry_type: CONSORCIO_ENTRY_TYPE,
    operation_number: proposta,
    contract_number: "",
    ...patch,
  });
  if (error) throw new Error(error.message);
}

// Mapa (company|proposta) -> promoter_id das ancoras ASSIGNED. A verdade do promotor.
export async function resolveConsorcioPromoterByProposta(
  supabase: SupabaseLike
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("product_line_assignments")
    .select("company_id, operation_number, promoter_id, status")
    .eq("entry_type", CONSORCIO_ENTRY_TYPE)
    .eq("status", "ASSIGNED");
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const a of data || []) {
    if (!a.promoter_id) continue;
    map.set(chaveProposta(a.company_id, a.operation_number), a.promoter_id);
  }
  return map;
}

// Repasse do consorcio por (promotor, empresa) numa competencia: soma a comissao-
// EMPRESA das parcelas RECEBIDAS no mes x 0,40, resolvendo o promotor pela ancora da
// proposta. Parcelas de proposta sem ancora ASSIGNED (balde) NAO entram.
export async function computeConsorcioCommissionByPromoter(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<Map<string, { promoter_id: string; company_id: string | null; consorcio: number }>> {
  const entries = (await fetchConsorcioEntries(supabase, params)).filter(isRegular);
  const promoterByProposta = await resolveConsorcioPromoterByProposta(supabase);

  const acc = new Map<string, { promoter_id: string; company_id: string | null; consorcio: number }>();
  for (const e of entries) {
    const pid = promoterByProposta.get(chaveProposta(e.company_id, e.operation_number));
    if (!pid) continue; // balde: sem promotor = sem repasse ate atribuir
    const repasse = repasseConsorcioPromotor(Number(e.commission_value || 0));
    const ak = `${pid}|${e.company_id}`;
    const cur = acc.get(ak) || { promoter_id: pid, company_id: e.company_id, consorcio: 0 };
    cur.consorcio += repasse;
    acc.set(ak, cur);
  }
  for (const v of acc.values()) v.consorcio = Math.round(v.consorcio * 100) / 100;
  return acc;
}
