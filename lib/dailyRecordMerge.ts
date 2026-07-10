import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// dailyRecordMerge — MERGE POR DONO DE COLUNA em daily_production_records.
//
// PROBLEMA que resolve: o upsert de LINHA INTEIRA (onConflict company_id,
// proposal_number) destruía o merge — subir o crédito depois do seguro zerava
// insurance_*, e vice-versa. A ADS sobe crédito e seguro em ARQUIVOS SEPARADOS,
// em qualquer ordem, e o import tem de ser idempotente nos dois sentidos.
//
// SOLUÇÃO: cada parser é DONO de um conjunto de colunas.
//   - CREDIT    escreve as colunas de crédito (produção/convênio/datas/promotor).
//               NÃO toca em insurance_*.
//   - INSURANCE escreve as colunas de seguro (insurance_*/prod_segurada/nº seguro).
//               NÃO toca nas colunas de crédito.
//   - FULL      escreve tudo (RR Promotiva e fechamento vêm crédito+seguro juntos
//               numa linha só) — comportamento idêntico ao upsert antigo.
//
// MECÂNICA: read-before-write. Linha existe -> UPDATE só das colunas do dono
// (upsert com payload contendo só essas colunas => ON CONFLICT DO UPDATE SET
// toca só elas). Linha ausente -> INSERT do registro completo (o outro lado cai
// no DEFAULT 0/false do schema, ou nos zeros que o parser já pôs). raw_payload é
// mesclado (shallow) nos donos parciais p/ não perder o trace do outro lado.
//
// PRESERVA assigned_promoter_id quando promoter_source='MANUAL_REASSIGNMENT'
// (atribuição da aba Migração) — só relevante p/ donos que escrevem promotor
// (CREDIT/FULL); o dono INSURANCE nem inclui essas colunas.
//
// __createIfMissing=false no registro => se a linha não existe, NÃO cria (ex.:
// linha de seguro NÃO-segurada sem crédito no mês não vira fantasma).
// ============================================================================

type SupabaseLike = SupabaseClient;

export type MergeOwner = "CREDIT" | "INSURANCE" | "FULL";

// Colunas de CRÉDITO (dono = parser de crédito / RR-FULL).
export const CREDIT_COLUMNS = [
  "j_key",
  "promoter_id",
  "original_promoter_id",
  "assigned_promoter_id",
  "promoter_source",
  "contract_number",
  "customer_name",
  "product_code",
  "product_description",
  "convenio_code",
  "convenio_type",
  "convenio_segment",
  "gross_value",
  "net_value",
  "interest_rate",
  "term_months",
  "installments",
  "company_received_percent",
  "status",
  "proposal_date",
  "movement_date",
  "contract_date",
  "cancellation_date",
  "is_srcc_restricted",
  "promoter_commission_percent",
  "promoter_commission_amount",
] as const;

// Colunas de SEGURO (dono = parser de seguro).
export const INSURANCE_COLUMNS = [
  "insurance_value",
  "insurance_net_value",
  "insurance_type",
  "has_insurance",
  "insurance_slip_eligible",
  "insurance_number",
  "prod_segurada",
  "insurance_commission_percent",
  "insurance_commission_amount",
] as const;

// Colunas que o promotor "possui" — alvo da preservação de MANUAL_REASSIGNMENT.
const PROMOTER_COLUMNS = new Set([
  "promoter_id",
  "original_promoter_id",
  "assigned_promoter_id",
  "promoter_source",
]);

const CONTROL_KEYS = new Set(["__createIfMissing"]);

export type DailyMergeRecord = Record<string, unknown> & {
  company_id: string;
  proposal_number: string;
  __createIfMissing?: boolean;
};

export type DailyMergeResult = {
  inserted: number;
  updated: number;
  skipped: number; // ausentes com __createIfMissing=false
};

function ownedColumnsFor(owner: MergeOwner, record: DailyMergeRecord): string[] {
  if (owner === "FULL") {
    return Object.keys(record).filter((k) => !CONTROL_KEYS.has(k) && k !== "raw_payload");
  }
  const set = owner === "CREDIT" ? CREDIT_COLUMNS : INSURANCE_COLUMNS;
  // só as colunas do dono que o registro de fato trouxe
  return (set as readonly string[]).filter((k) => k in record);
}

/**
 * Aplica os registros a daily_production_records por MERGE de dono de coluna.
 * `owner` decide quais colunas um registro EXISTENTE tem atualizadas; um registro
 * NOVO é inserido inteiro (o outro lado cai no default do schema). dryRun não grava.
 */
export async function mergeDailyProductionRecords(
  supabase: SupabaseLike,
  params: {
    records: DailyMergeRecord[];
    owner: MergeOwner;
    dryRun?: boolean;
    daily_import_id?: string | null;
  }
): Promise<DailyMergeResult> {
  const { records, owner } = params;
  const dryRun = params.dryRun === true;
  const result: DailyMergeResult = { inserted: 0, updated: 0, skipped: 0 };
  if (records.length === 0) return result;

  const nowIso = new Date().toISOString();
  const mergeRaw = owner !== "FULL"; // donos parciais mesclam raw_payload; FULL sobrescreve

  // 1. Lê existentes (por company_id + proposal_number), em lotes por empresa.
  const byCompany = new Map<string, Set<string>>();
  for (const r of records) {
    if (!byCompany.has(r.company_id)) byCompany.set(r.company_id, new Set());
    byCompany.get(r.company_id)!.add(r.proposal_number);
  }
  const existingByKey = new Map<string, any>();
  for (const [companyId, propSet] of byCompany) {
    const proposals = [...propSet];
    for (let i = 0; i < proposals.length; i += 200) {
      const chunk = proposals.slice(i, i + 200);
      const { data, error } = await supabase
        .from("daily_production_records")
        .select("company_id, proposal_number, assigned_promoter_id, original_promoter_id, promoter_source, raw_payload")
        .eq("company_id", companyId)
        .in("proposal_number", chunk);
      if (error) throw error;
      for (const e of data || []) existingByKey.set(`${e.company_id}::${e.proposal_number}`, e);
    }
  }

  // 2. Monta INSERTs (registro completo) e UPDATEs (só colunas do dono).
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Record<string, unknown>[] = [];
  for (const rec of records) {
    const key = `${rec.company_id}::${rec.proposal_number}`;
    const existing = existingByKey.get(key);
    const createIfMissing = rec.__createIfMissing !== false;

    if (!existing) {
      if (!createIfMissing) {
        result.skipped += 1;
        continue;
      }
      const full: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rec)) if (!CONTROL_KEYS.has(k)) full[k] = v;
      full.daily_import_id = params.daily_import_id ?? full.daily_import_id ?? null;
      full.updated_at = nowIso;
      toInsert.push(full);
      result.inserted += 1;
    } else {
      const owned = ownedColumnsFor(owner, rec);
      const upd: Record<string, unknown> = {
        company_id: rec.company_id,
        proposal_number: rec.proposal_number,
        daily_import_id: params.daily_import_id ?? existing.daily_import_id ?? null,
        updated_at: nowIso,
      };
      for (const col of owned) upd[col] = (rec as any)[col];

      // Preserva atribuição manual (só faz sentido p/ donos que escrevem promotor).
      if (owned.some((c) => PROMOTER_COLUMNS.has(c))) {
        if (existing.original_promoter_id) upd.original_promoter_id = existing.original_promoter_id;
        if (existing.promoter_source === "MANUAL_REASSIGNMENT") {
          upd.assigned_promoter_id = existing.assigned_promoter_id;
          upd.promoter_source = existing.promoter_source;
        }
      }

      // raw_payload: donos parciais mesclam (shallow) p/ manter o trace do outro
      // lado; FULL sobrescreve (comportamento antigo).
      if ("raw_payload" in rec) {
        if (mergeRaw) {
          const base = (existing.raw_payload && typeof existing.raw_payload === "object") ? existing.raw_payload : {};
          upd.raw_payload = { ...base, ...(rec.raw_payload as object) };
        } else {
          upd.raw_payload = rec.raw_payload;
        }
      }
      toUpdate.push(upd);
      result.updated += 1;
    }
  }

  if (dryRun) return result;

  // 3. Grava. INSERT do registro completo; UPDATE via upsert com payload parcial
  //    (ON CONFLICT DO UPDATE SET só das colunas presentes = as do dono).
  for (let i = 0; i < toInsert.length; i += 500) {
    const { error } = await supabase
      .from("daily_production_records")
      .upsert(toInsert.slice(i, i + 500), { onConflict: "company_id,proposal_number" });
    if (error) throw error;
  }
  for (let i = 0; i < toUpdate.length; i += 500) {
    const { error } = await supabase
      .from("daily_production_records")
      .upsert(toUpdate.slice(i, i + 500), { onConflict: "company_id,proposal_number" });
    if (error) throw error;
  }

  return result;
}
