import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeDailyProductionRecords } from "./dailyRecordMerge.ts";
import { BBTS_MASTER_KEY } from "./bbtsDailyImport.ts";

// ============================================================================
// adsSeguroDailyImport — PARSER + IMPORT da diária de SEGURO da ADS (arquivo
// "Prestamista", aba única, 20 colunas). DONO DE COLUNA = SEGURO
// (mergeDailyProductionRecords owner='INSURANCE'): escreve só insurance_* /
// prod_segurada / nº seguro e NÃO toca nas colunas de crédito.
//
// UNIFICAÇÃO: casa por Contrato == proposal_number da linha de crédito.
//   - crédito já existe -> ATUALIZA o seguro na mesma linha (uma linha por proposta).
//   - seguro ANTES do crédito -> cria linha só-seguro (gross=0, chave master ->
//     balde), como o seguro_only do bbtsClosingImport. Só SEGURADA cria linha;
//     não-segurada sem crédito NÃO vira fantasma (__createIfMissing=false).
//   - idempotente: re-subir o seguro não duplica nem zera o crédito.
//
// prod_segurada = coluna "Seguro" NÃO-vazia (o Prestamista lista TODAS as
// propostas, seguradas ou não). insurance_value/net = base da régua BBTS (Valor
// Financiado = Valor Total do Crédito), MESMA semântica do bbtsClosingImport (o
// consolidador BBTS-2c aplica 0,10/0,35 sobre ela). Prêmio (Vl. Seguro / Total
// Seg. Líquido) e Versão EDS ficam em raw_payload.__ads_seguro_meta (trace).
//
// VALIDAÇÃO: Vl. Financiado do seguro deve bater com gross_value da linha de
// crédito existente; divergência vira AVISO (pode indicar match errado), não
// bloqueia.
// ============================================================================

export const ADS_SEGURO_ABA = "Prestamista";

function normalizeText(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

function parseMoneyBR(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let raw = String(value).replace(/[^\d.,-]/g, "");
  if (raw === "") return 0;
  raw = raw.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseIntBR(value: unknown): number | null {
  const n = parseMoneyBR(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function parseDateBR(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && value > 1) {
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

type SupabaseLike = SupabaseClient;

export type AdsSeguroImportResult = {
  dry_run: boolean;
  aba: string;
  linhas_aba: number;
  processadas: number; // com Contrato
  seguradas: number; // "Seguro" não-vazio
  nao_seguradas: number;
  inseridas: number; // linhas só-seguro criadas (seguro antes do crédito)
  atualizadas: number; // seguro anexado a linha existente
  puladas: number; // não-segurada sem crédito (não cria fantasma)
  empresa_nao_identificada: number;
  duplicadas_no_arquivo: number;
  vfin_divergente: Array<{ contrato: string; vfin_seguro: number; gross_credito: number; delta: number }>;
  amostra: Array<Record<string, unknown>>;
};

/**
 * Importa as linhas JÁ EXTRAÍDAS da aba "Prestamista". O caller lê o XLSX e passa
 * `rows`. dryRun=true (default) só mapeia/conta. Merge por dono de coluna
 * (owner='INSURANCE'): idempotente e não destrói o crédito.
 */
export async function importAdsSeguroDaily(
  supabase: SupabaseLike,
  params: { rows: Record<string, unknown>[]; fileName?: string; dryRun?: boolean }
): Promise<AdsSeguroImportResult> {
  const rows = params.rows || [];
  const dryRun = params.dryRun !== false; // default: dry-run seguro
  const aba = ADS_SEGURO_ABA;

  // 1. Lookup de empresa por MCI (company_identifiers).
  const { data: identifiers, error: idErr } = await supabase
    .from("company_identifiers")
    .select("company_id, mci");
  if (idErr) throw idErr;
  const companyByMci = new Map<string, string>();
  for (const ci of identifiers || []) {
    const mci = ci.mci ? String(ci.mci).trim() : "";
    if (mci) companyByMci.set(mci, ci.company_id);
  }

  const result: AdsSeguroImportResult = {
    dry_run: dryRun,
    aba,
    linhas_aba: rows.length,
    processadas: 0,
    seguradas: 0,
    nao_seguradas: 0,
    inseridas: 0,
    atualizadas: 0,
    puladas: 0,
    empresa_nao_identificada: 0,
    duplicadas_no_arquivo: 0,
    vfin_divergente: [],
    amostra: [],
  };

  // 2. Registro de import (rastreabilidade) — só quando grava.
  let importId: string | null = null;
  if (!dryRun) {
    const { data: log, error: logErr } = await supabase
      .from("daily_imports")
      .insert({ file_name: params.fileName || "prestamista_ads.xlsx", status: "PROCESSING" })
      .select("id")
      .single();
    if (logErr) throw logErr;
    importId = log.id;
  }

  // 3. Mapeia cada linha do Prestamista.
  const recordsByKey = new Map<string, Record<string, unknown>>();
  const vfinByContrato = new Map<string, { companyId: string; vfin: number }>();
  for (const row of rows) {
    const lookup = buildRowLookup(row);

    const contrato = String(getField(lookup, ["Contrato", "nu_contrato", "nu_proposta"]) || "").trim();
    if (!contrato) continue;

    const mci = String(getField(lookup, ["Cod. MCI", "Cód. MCI", "cd_mci_correspondente", "MCI"]) || "").trim();
    const companyId = companyByMci.get(mci) || null;
    if (!companyId) {
      result.empresa_nao_identificada += 1;
      continue;
    }

    const seguroTipoRaw = getField(lookup, ["Seguro"]); // "ESTOQUE D0" / "SLIP" / vazio
    const seguroTipo = seguroTipoRaw == null ? null : String(seguroTipoRaw).trim();
    const isSegurada = Boolean(seguroTipo);

    // Base da régua BBTS = Valor Financiado (= Valor Total do Crédito). MESMA
    // semântica do bbtsClosingImport (insurance_value = base; BBTS-2c aplica a %).
    const vlFinanciado = parseMoneyBR(getField(lookup, ["Vl. Financiado", "Valor Financiado", "Vl Financiado"]));
    const seguroBase = isSegurada ? vlFinanciado : 0;

    const numeroSeguro = getField(lookup, ["Nº Seguro", "N. Seguro", "Numero Seguro", "Nº do Seguro"]);
    const versaoEds = getField(lookup, ["Versão EDS", "Versao EDS"]);
    const vlSeguro = parseMoneyBR(getField(lookup, ["Vl. Seguro", "Valor Seguro"]));
    const totalSegLiquido = parseMoneyBR(getField(lookup, ["Total Seg. Líquido", "Total Seg. Liquido", "Total Seguro Liquido"]));
    const movimento = parseDateBR(getField(lookup, ["Movimento", "Data Movimento", "Modificação", "Modificacao"]));
    const parcelas = parseIntBR(getField(lookup, ["Parcelas"]));

    if (isSegurada) result.seguradas += 1;
    else result.nao_seguradas += 1;

    // Registro com colunas de SEGURO (dono) + defaults de criação (usados só se a
    // linha ainda não existe: seguro antes do crédito -> linha só-seguro no balde).
    const payload: Record<string, unknown> = {
      company_id: companyId,
      proposal_number: contrato,
      // ---- colunas de SEGURO (as que o dono INSURANCE escreve no update) ----
      insurance_value: seguroBase,
      insurance_net_value: seguroBase,
      insurance_type: seguroTipo,
      has_insurance: isSegurada && seguroBase > 0,
      insurance_number: numeroSeguro == null ? null : String(numeroSeguro).trim(),
      prod_segurada: isSegurada,
      // ---- defaults de CRIAÇÃO (linha só-seguro; NÃO sobrescrevem no update) ----
      contract_number: contrato,
      j_key: BBTS_MASTER_KEY,
      promoter_id: null,
      original_promoter_id: null,
      assigned_promoter_id: null,
      promoter_source: "MASTER_REASSIGNED",
      product_description: "SEGURO (sem credito no mes)",
      gross_value: 0,
      net_value: 0,
      status: "PRODUCAO",
      proposal_date: movimento,
      movement_date: movimento,
      contract_date: movimento,
      is_srcc_restricted: false,
      installments: parcelas,
      term_months: parcelas,
      raw_payload: {
        __ads_seguro_meta: {
          fonte: "diaria_prestamista",
          seguro_tipo: seguroTipo,
          numero_seguro: numeroSeguro ?? null,
          versao_eds: versaoEds ?? null,
          vl_seguro_premio: vlSeguro,
          total_seg_liquido: totalSegLiquido,
          vl_financiado: vlFinanciado,
        },
      },
      // não-segurada sem crédito não vira fantasma; segurada cria a linha só-seguro
      __createIfMissing: isSegurada,
    };

    const key = `${companyId}::${contrato}`;
    if (recordsByKey.has(key)) result.duplicadas_no_arquivo += 1;
    recordsByKey.set(key, payload);
    if (vlFinanciado > 0) vfinByContrato.set(contrato, { companyId, vfin: vlFinanciado });
    result.processadas += 1;

    if (result.amostra.length < 3) {
      result.amostra.push({ proposal_number: contrato, seguro_tipo: seguroTipo, prod_segurada: isSegurada, base: seguroBase, numero_seguro: numeroSeguro ?? null });
    }
  }

  const records = Array.from(recordsByKey.values());

  // 4. Validação: Vl. Financiado do seguro × gross_value do crédito existente.
  if (vfinByContrato.size > 0) {
    const contratos = [...vfinByContrato.keys()];
    for (let i = 0; i < contratos.length; i += 200) {
      const chunk = contratos.slice(i, i + 200);
      const { data, error } = await supabase
        .from("daily_production_records")
        .select("company_id, proposal_number, gross_value")
        .in("proposal_number", chunk);
      if (error) throw error;
      for (const e of data || []) {
        const ref = vfinByContrato.get(String(e.proposal_number));
        if (!ref || ref.companyId !== e.company_id) continue;
        const gross = Number(e.gross_value) || 0;
        if (gross > 0 && Math.abs(gross - ref.vfin) > 0.01) {
          result.vfin_divergente.push({ contrato: String(e.proposal_number), vfin_seguro: ref.vfin, gross_credito: gross, delta: Math.round((ref.vfin - gross) * 100) / 100 });
        }
      }
    }
  }

  // 5. MERGE por dono de coluna (owner='INSURANCE').
  if (!dryRun && records.length > 0) {
    const merged = await mergeDailyProductionRecords(supabase, {
      records: records as any,
      owner: "INSURANCE",
      daily_import_id: importId,
    });
    result.inseridas = merged.inserted;
    result.atualizadas = merged.updated;
    result.puladas = merged.skipped;

    await supabase
      .from("daily_imports")
      .update({ status: "COMPLETED", rows_count: result.processadas })
      .eq("id", importId);
  } else if (dryRun) {
    // conta o que faria sem gravar (mesma lógica de create-if-missing)
    const merged = await mergeDailyProductionRecords(supabase, {
      records: records as any,
      owner: "INSURANCE",
      dryRun: true,
    });
    result.inseridas = merged.inserted;
    result.atualizadas = merged.updated;
    result.puladas = merged.skipped;
  }

  return result;
}
