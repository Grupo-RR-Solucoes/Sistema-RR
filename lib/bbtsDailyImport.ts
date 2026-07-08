import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// bbtsDailyImport — PARSER + IMPORT da diária BBTS (formato próprio, aba "Total")
// para daily_production_records, reusando a MESMA infra de atribuição master do
// RR (j_keys INDIVIDUAL casa direto; MASTER = balde da aba Migração).
//
// BBTS-1: SÓ importa/mapeia — NÃO calcula comissão (isso é o consolidador BBTS-2).
// A empresa ADS (group_name='BBTS', active=false) é identificada por MCI via
// company_identifiers — o import NÃO filtra por company.active (parser próprio).
//
// Diferença de escopo vs import RR (app/api/import/daily): o import BBTS NÃO
// invalida snapshots (monthly_expected_closings / promoter_monthly_results) — o
// PMR é somado pelo consolidador BBTS-2, não recalculado por empresa aqui.
//
// Marcações que o consolidador BBTS-2 lê depois (via raw_payload.__bbts_meta):
//   - cancelado: ds_transacao contém "Cancelamento" => NÃO comissiona.
//   - srcc_cd  : Cd. Restrição SRCC (1=tem restrição => is_srcc_restricted).
// A base do crédito é vl_solicitado (Valor Financiado); vl_liquido vem 0 e NÃO
// é usado como base.
// ============================================================================

// MCI da ADS/BBTS em company_identifiers (BBTS-0). O lookup real é por
// company_identifiers.mci; esta constante é só documentação/diagnóstico.
export const BBTS_MCI = "874982135";
export const BBTS_MASTER_KEY = "JJ552710";

// ---- helpers de parsing (espelham o import RR, + dinheiro "R$ 2.096,78") -----

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

// "R$ 2.096,78" / "2.096,78" / "1234.56" -> number. Remove tudo que não é dígito,
// vírgula, ponto ou sinal; depois normaliza separador BR (milhar . / decimal ,).
function parseMoneyBR(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let raw = String(value).replace(/[^\d.,-]/g, "");
  if (raw === "") return 0;
  // milhar . antes de grupos de 3 dígitos; decimal , -> .
  raw = raw.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// "1,85" / "1.85" -> 1.85 (taxa mensal, mantém escala do relatório).
function parseRateBR(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  let raw = String(value).replace("%", "").replace(/[^\d.,-]/g, "");
  raw = raw.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseIntBR(value: unknown): number | null {
  const n = parseMoneyBR(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function parseDateBR(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && value > 1) {
    // serial de data do Excel — 1899-12-30 base.
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

// lookup normalizado por linha (chave = coluna normalizada em UPPER, sem acento).
function buildRowLookup(row: Record<string, unknown>): Map<string, unknown> {
  const lookup = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined || value === null || value === "") continue;
    lookup.set(normalizeText(key), value);
  }
  return lookup;
}

function getField(lookup: Map<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const v = lookup.get(normalizeText(key));
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

// fallback: acha o valor da 1ª coluna cujo nome normalizado CONTÉM `needle`.
function getFieldByIncludes(lookup: Map<string, unknown>, needle: string): unknown {
  const n = normalizeText(needle);
  for (const [k, v] of lookup) {
    if (k.includes(n) && v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

// ---- tipos ------------------------------------------------------------------

type SupabaseLike = SupabaseClient;

export type BbtsImportResult = {
  dry_run: boolean;
  aba: string;
  linhas_aba: number;
  processadas: number; // com nu_proposta
  gravadas: number; // upserts efetivos (0 em dry-run)
  inseridas: number;
  atualizadas: number;
  individual_auto: number; // casaram chave INDIVIDUAL -> promotor
  master_balde: number; // MASTER (JJ552710) -> assigned NULL
  nao_identificadas: number; // chave fora de j_keys
  canceladas: number;
  srcc_restritas: number;
  empresa_nao_identificada: number; // MCI sem company_identifiers
  duplicadas_no_arquivo: number;
  por_empresa: Record<string, number>;
  amostra: Array<Record<string, unknown>>; // primeiras linhas mapeadas (diagnóstico)
};

// ---- import -----------------------------------------------------------------

/**
 * Importa as linhas JÁ EXTRAÍDAS da aba "Total" da diária BBTS. O caller (script/
 * endpoint) lê o XLSX e passa `rows`. dryRun=true não grava nada (só mapeia e
 * conta). Upsert idempotente onConflict company_id,proposal_number.
 */
export async function importBbtsDaily(
  supabase: SupabaseLike,
  params: { rows: Record<string, unknown>[]; fileName?: string; dryRun?: boolean; aba?: string }
): Promise<BbtsImportResult> {
  const rows = params.rows || [];
  const dryRun = params.dryRun !== false; // default: dry-run (seguro)
  const aba = params.aba || "Total";

  // 1. Lookups: empresa por MCI (company_identifiers) + j_keys ativas.
  const { data: identifiers, error: idErr } = await supabase
    .from("company_identifiers")
    .select("company_id, mci, coban_code, active");
  if (idErr) throw idErr;
  const companyByMci = new Map<string, string>();
  for (const ci of identifiers || []) {
    const mci = ci.mci ? String(ci.mci).trim() : "";
    if (mci) companyByMci.set(mci, ci.company_id);
  }

  const { data: jKeys, error: jkErr } = await supabase
    .from("j_keys")
    .select("j_key, promoter_id, key_type, active")
    .eq("active", true);
  if (jkErr) throw jkErr;
  const jKeyByValue = new Map<string, { promoter_id: string | null; key_type: string | null }>();
  for (const jk of jKeys || []) {
    const k = String(jk.j_key || "").trim().toUpperCase();
    if (k) jKeyByValue.set(k, { promoter_id: jk.promoter_id ?? null, key_type: jk.key_type ?? null });
  }

  const result: BbtsImportResult = {
    dry_run: dryRun,
    aba,
    linhas_aba: rows.length,
    processadas: 0,
    gravadas: 0,
    inseridas: 0,
    atualizadas: 0,
    individual_auto: 0,
    master_balde: 0,
    nao_identificadas: 0,
    canceladas: 0,
    srcc_restritas: 0,
    empresa_nao_identificada: 0,
    duplicadas_no_arquivo: 0,
    por_empresa: {},
    amostra: [],
  };

  // 2. Registro de import (rastreabilidade) — só quando grava.
  let importId: string | null = null;
  if (!dryRun) {
    const { data: log, error: logErr } = await supabase
      .from("daily_imports")
      .insert({ file_name: params.fileName || "bbts.xlsx", status: "PROCESSING" })
      .select("id")
      .single();
    if (logErr) throw logErr;
    importId = log.id;
  }

  // 3. Mapeia cada linha.
  const recordsByKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const lookup = buildRowLookup(row);

    const proposal = String(getField(lookup, ["nu_proposta", "numero_proposta", "proposta"]) || "").trim();
    if (!proposal) continue;

    const mci = String(getField(lookup, ["cd_mci_correspondente", "mci"]) || "").trim();
    const companyId = companyByMci.get(mci) || null;
    if (!companyId) {
      result.empresa_nao_identificada += 1;
      continue;
    }

    const jKey = String(getField(lookup, ["cd_chave_j_operador", "chave_j", "chavej"]) || "").trim();
    const jData = jKeyByValue.get(jKey.toUpperCase());
    let promoterId: string | null = null;
    let source = "UNIDENTIFIED";
    if (jData) {
      if (jData.key_type === "INDIVIDUAL") {
        promoterId = jData.promoter_id;
        source = "AUTO_J_KEY";
        result.individual_auto += 1;
      } else {
        source = "MASTER_REASSIGNED"; // MASTER (JJ552710) -> balde
        result.master_balde += 1;
      }
    } else {
      result.nao_identificadas += 1;
    }

    // Base do crédito = vl_solicitado (Valor Financiado). vl_liquido NÃO é base.
    const vlSolicitado = parseMoneyBR(getField(lookup, ["vl_solicitado"]));
    const insuranceValue =
      parseMoneyBR(getField(lookup, ["vl_seguro_credito"])) ||
      parseMoneyBR(getField(lookup, ["vl_total_seguro"]));

    const transacao = String(getField(lookup, ["ds_transacao"]) || "");
    const cancelado = normalizeText(transacao).includes("CANCELAMENTO");
    if (cancelado) result.canceladas += 1;

    // Cd. Restrição SRCC: 1=tem restrição, 2=não, 3=consulta não realizada,
    // 4=não se aplica. Procura por nome exato e, se não achar, por "RESTRIC".
    const srccRaw =
      getField(lookup, ["cd_restricao_srcc", "cd_restricao", "cd_restricao_s_r_c_c", "cd. restricao srcc"]) ??
      getFieldByIncludes(lookup, "RESTRIC");
    const srccCd = srccRaw == null || srccRaw === "" ? null : Math.trunc(parseMoneyBR(srccRaw));
    const isSrccRestricted = srccCd === 1;
    if (isSrccRestricted) result.srcc_restritas += 1;

    const situacao = getField(lookup, ["ds_situacao_documento", "situacao"]);
    const movementDate =
      parseDateBR(getField(lookup, ["dt_movimentacao", "dt_movimento", "data_movimento", "dt_operacao"]));
    const contractDate =
      parseDateBR(getField(lookup, ["dt_contratacao", "dt_contrato", "data_contratacao"]));
    const proposalDate = parseDateBR(getField(lookup, ["dt_proposta", "data_proposta"]));

    const payload: Record<string, unknown> = {
      daily_import_id: importId,
      company_id: companyId,
      j_key: jKey,
      promoter_id: promoterId,
      original_promoter_id: promoterId,
      assigned_promoter_id: promoterId,
      promoter_source: source,
      proposal_number: proposal,
      contract_number: getField(lookup, ["nu_contrato", "contrato", "numero_contrato"]),
      customer_name: getField(lookup, ["nm_cliente", "cliente", "nome_cliente"]),
      product_code: getField(lookup, ["cd_linha_credito_produto", "codigo_produto"]),
      product_description: getField(lookup, ["ds_linha_credito_produto", "produto"]),
      convenio_code: getField(lookup, ["nr_convenio", "codigo_convenio"]),
      convenio_type: getField(lookup, ["ds_linha_credito", "ds_convenio", "convenio"]),
      convenio_segment: getField(lookup, ["ds_tipo_seguimento_convenio", "ds_segmento_convenio", "segmento"]),
      // Base = vl_solicitado (Valor Financiado); espelhado em gross e net porque
      // é a base única do crédito BBTS (vl_liquido vem 0 e não é usado).
      gross_value: vlSolicitado,
      net_value: vlSolicitado,
      insurance_value: insuranceValue,
      insurance_net_value: insuranceValue,
      insurance_type: getField(lookup, ["ds_tipo_seguro", "tipo_seguro"]),
      has_insurance: insuranceValue > 0,
      interest_rate: parseRateBR(getField(lookup, ["vl_tx_mensal_juros", "taxa"])),
      term_months: parseIntBR(getField(lookup, ["qt_parcelas", "parcelas"])),
      installments: parseIntBR(getField(lookup, ["qt_parcelas", "parcelas"])),
      status: situacao,
      proposal_date: proposalDate,
      movement_date: movementDate,
      contract_date: contractDate,
      // Cancelamento marcado em __bbts_meta (abaixo); cancellation_date fica com a
      // data se houver coluna de cancelamento no arquivo.
      cancellation_date: parseDateBR(getField(lookup, ["dt_cancelamento", "data_cancelamento"])),
      is_srcc_restricted: isSrccRestricted,
      // BBTS-1 não calcula comissão (BBTS-2 preenche).
      promoter_commission_amount: null,
      promoter_commission_percent: null,
      insurance_commission_amount: null,
      insurance_commission_percent: null,
      // raw_payload = linha inteira + marcações que o consolidador BBTS-2 lê.
      raw_payload: {
        ...row,
        __bbts_meta: {
          cancelado,
          srcc_cd: srccCd,
          transacao,
          situacao: situacao ?? null,
          base_credito: "vl_solicitado",
        },
      },
    };

    const key = `${companyId}::${proposal}`;
    if (recordsByKey.has(key)) result.duplicadas_no_arquivo += 1;
    recordsByKey.set(key, payload);
    result.processadas += 1;
    result.por_empresa[companyId] = (result.por_empresa[companyId] || 0) + 1;
    if (result.amostra.length < 3) {
      result.amostra.push({
        proposal_number: proposal,
        j_key: jKey,
        promoter_source: source,
        base: vlSolicitado,
        convenio_code: payload.convenio_code,
        cancelado,
        srcc_cd: srccCd,
        status: situacao,
      });
    }
  }

  const records = Array.from(recordsByKey.values());

  // 4. Preserva atribuição MANUAL em reimport (igual ao RR) + upsert.
  if (!dryRun && records.length > 0) {
    const companyIds = [...new Set(records.map((r) => r.company_id as string))];
    const proposals = [...new Set(records.map((r) => r.proposal_number as string))];
    const existingByKey = new Map<string, any>();
    for (let i = 0; i < proposals.length; i += 200) {
      const chunk = proposals.slice(i, i + 200);
      const { data, error } = await supabase
        .from("daily_production_records")
        .select("company_id, proposal_number, assigned_promoter_id, original_promoter_id, promoter_source")
        .in("company_id", companyIds)
        .in("proposal_number", chunk);
      if (error) throw error;
      for (const e of data || []) existingByKey.set(`${e.company_id}::${e.proposal_number}`, e);
    }

    const nowIso = new Date().toISOString();
    for (const rec of records) {
      const ex = existingByKey.get(`${rec.company_id}::${rec.proposal_number}`);
      if (ex) {
        result.atualizadas += 1;
        if (ex.original_promoter_id) rec.original_promoter_id = ex.original_promoter_id;
        if (ex.promoter_source === "MANUAL_REASSIGNMENT") {
          rec.assigned_promoter_id = ex.assigned_promoter_id;
          rec.promoter_source = ex.promoter_source;
        }
      } else {
        result.inseridas += 1;
      }
      rec.updated_at = nowIso;
    }

    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const { error } = await supabase
        .from("daily_production_records")
        .upsert(chunk, { onConflict: "company_id,proposal_number" });
      if (error) throw error;
    }
    result.gravadas = records.length;

    await supabase
      .from("daily_imports")
      .update({ status: "COMPLETED", rows_count: result.processadas })
      .eq("id", importId);
  }

  return result;
}
