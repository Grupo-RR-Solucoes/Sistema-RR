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
  // RISCO REGISTRADO (28/07/2026): este campo é do CRÉDITO, então uma reimportação
  // da diária SOBRESCREVE o que o fechamento concluiu — na ADS, o fechamento entra
  // como FULL com o código do PDF e a diária como CREDIT com `false` (o arquivo da
  // BBTS não tem coluna de SRCC). Hoje é inócuo, porque a BBTS nunca mandou cd=1;
  // no dia em que mandar, reimportar a diária apagaria a restrição em silêncio.
  // É o mesmo padrão que os NESTED_TRACE_KEYS já tiveram de corrigir uma vez.
  // Por isso a RESPOSTA durável mora em `srcc_resolucao`, que NÃO está em nenhum
  // dos dois conjuntos de dono e portanto nenhum importador parcial alcança.
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

/**
 * COLUNAS DE CONCLUSAO CALCULADA — NENHUM importador as sobrescreve num UPDATE.
 *
 * O DEFEITO QUE ISTO CORRIGE (aconteceu em PRODUCAO, 29/07/2026). O import da
 * diaria do RR entra como owner FULL e traz no payload
 * `insurance_commission_percent: null` e `insurance_commission_amount: null`
 * (app/api/import/daily/route.ts:596-597 — de proposito: o XLSX nao tem esse
 * numero, quem calcula e /api/calculate/monthly). Mas FULL escreve TODA chave
 * presente no registro, entao o `null` APAGAVA a comissao ja calculada.
 *
 * Medido: o import dd3450f1 (29/07 13:51) reescreveu as 739 linhas do RR de
 * julho e zerou o seguro em 645/645 elegiveis. O Dashboard, que no mes ABERTO
 * soma essa coluna crua, caiu de ~R$ 4,3 mil para R$ 27,08 — uma variacao de
 * -99,4% exibida como "-100%", com 152 linhas de premio (R$ 260 mil) vendidas.
 * O credito sobreviveu no mesmo import por ACIDENTE: `promoter_commission_*`
 * nao esta no payload dele. A assimetria (credito 568/645, seguro 0/645) foi o
 * que denunciou o mecanismo.
 *
 * POR QUE AQUI E NAO EM CADA IMPORTADOR. Sao TRES escritores com o mesmo
 * padrao — import/daily (FULL), bbtsClosingImport (FULL, grava null nas quatro)
 * e bbtsDailyImport (CREDIT, grava null nas de credito). Consertar um deixaria
 * os outros dois armados. E o mesmo remedio que `srcc_resolucao` usou: a
 * conclusao nao mora ao alcance de quem so traz o dado bruto.
 *
 * SEGURO PORQUE OS ESCRITORES LEGITIMOS NAO PASSAM POR AQUI: quem calcula grava
 * DIRETO — /api/calculate/monthly:1483 (`.upsert`) e
 * lib/proposalDetailing.ts:1093 (`.update`). Nenhum deles usa este merge.
 *
 * VALE SO NO UPDATE. No INSERT o registro entra inteiro (linha nova, nao ha
 * conclusao anterior a proteger) — comportamento inalterado.
 *
 * RESIDUO CONHECIDO: se o premio de uma proposta cair para zero num reimport, a
 * comissao antiga sobrevive ate o proximo recalculo. E menos grave que apagar
 * todas, mas nao e nulo — esta nomeado no handoff.
 */
export const DERIVED_NEVER_UPDATED = new Set([
  "promoter_commission_percent",
  "promoter_commission_amount",
  "insurance_commission_percent",
  "insurance_commission_amount",
]);

/**
 * Blocos ANINHADOS do raw_payload que NUNCA podem ser perdidos num merge.
 *
 * BUG QUE ISTO CORRIGE (perda silenciosa): o merge do raw_payload era SHALLOW
 * ({...base, ...novo}). O fechamento da ADS (owner FULL) grava em
 * raw_payload.__bbts_meta o que a BBTS PAGOU (pag_avista_relatorio,
 * taxa_relatorio, seguro_valor_relatorio). A diária da ADS (owner CREDIT) também
 * grava um __bbts_meta — mas SEM esses campos. Como o spread substitui a chave
 * INTEIRA, reimportar a diária depois do fechamento APAGAVA o "pago" — e ninguém
 * percebia, porque nada lia esses campos ainda. A auditoria da ADS lê.
 *
 * Regra agora: para estas chaves, quando os dois lados são objetos, mescla-se
 * campo a campo (o novo vence por campo, o antigo sobrevive no que o novo não
 * define). Vale inclusive para o owner FULL — que no resto continua
 * sobrescrevendo o raw_payload como antes (comportamento do RR intacto: o RR não
 * tem __bbts_meta).
 */
const NESTED_TRACE_KEYS = ["__bbts_meta"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param deep true (donos parciais): mescla o raw_payload no topo (comportamento
 *   atual) — false (FULL): o novo raw_payload substitui o antigo.
 *   Em AMBOS os casos os NESTED_TRACE_KEYS são preservados campo a campo.
 */
export function mergeRawPayload(base: unknown, incoming: unknown, deep: boolean): Record<string, unknown> {
  const b = isPlainObject(base) ? base : {};
  const i = isPlainObject(incoming) ? incoming : {};
  const out: Record<string, unknown> = deep ? { ...b, ...i } : { ...i };
  for (const k of NESTED_TRACE_KEYS) {
    const bv = b[k];
    const iv = i[k];
    if (isPlainObject(bv) && isPlainObject(iv)) out[k] = { ...bv, ...iv };
    else if (isPlainObject(bv) && iv === undefined) out[k] = bv;
  }
  return out;
}

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

export function ownedColumnsFor(owner: MergeOwner, record: DailyMergeRecord): string[] {
  const cols =
    owner === "FULL"
      ? Object.keys(record).filter((k) => !CONTROL_KEYS.has(k) && k !== "raw_payload")
      : // só as colunas do dono que o registro de fato trouxe
        ((owner === "CREDIT" ? CREDIT_COLUMNS : INSURANCE_COLUMNS) as readonly string[]).filter(
          (k) => k in record
        );
  // Conclusão calculada nunca é sobrescrita por importador. Ver DERIVED_NEVER_UPDATED.
  return cols.filter((k) => !DERIVED_NEVER_UPDATED.has(k));
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

      // raw_payload: donos parciais mesclam no topo; FULL sobrescreve (como antes).
      // Em ambos, os blocos de trace aninhados (__bbts_meta) são preservados campo
      // a campo — ver NESTED_TRACE_KEYS: sem isso, reimportar a diária da ADS
      // apagava o que a BBTS pagou.
      if ("raw_payload" in rec) {
        upd.raw_payload = mergeRawPayload(existing.raw_payload, rec.raw_payload, mergeRaw);
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
