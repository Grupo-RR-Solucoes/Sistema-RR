import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// FRENTE 2 / ETAPA 7 — fonte das linhas de proposta do promotor no mes
// FECHADO (cms = ground truth pago pelo financeiro), compartilhada entre a
// rota GET /api/promotores (PromotorView) e o export de relatorio, para que
// AMBOS consumam EXATAMENTE o mesmo numero, sem recalcular.
// ============================================================

// Chave coletiva 552710 (JJ/JJJ): o VALOR conta normalmente, mas a
// identificacao (contrato, data, chave J) e ocultada no detalhamento do
// promotor (tela e relatorio). Mesmo criterio do PromotorView.
export function isColetivaJKey(jKey: string | null | undefined): boolean {
  return /^J+552710$/.test(
    String(jKey ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toUpperCase()
  );
}
export const COLETIVA_MASK = "—";

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function rawValue(rp: Record<string, unknown> | null, keys: string[]): unknown {
  if (!rp) return null;
  for (const k of keys) if (rp[k] !== undefined && rp[k] !== "") return rp[k];
  return null;
}
function rawNum(rp: Record<string, unknown> | null, keys: string[]): number {
  return toNumber(rawValue(rp, keys));
}

export type CmsProposalRow = {
  id: string;
  contract_number: string;
  proposal_number: string;
  agency_code: string;
  j_key: string;
  promoter_name: string;
  product_description: string;
  status: string;
  movement_date: string | null;
  contract_date: string | null;
  interest_rate: number;
  installment_count: number;
  company_received_percent: number;
  company_commission_amount: number;
  srcc_restriction: string;
  net_value: number;
  gross_value: number;
  insurance_value: number;
  company_insurance_commission_amount: number;
  insurance_penetration_percent: number;
  promoter_commission_percent: number;
  promoter_commission_amount: number;
  insurance_commission_percent: number;
  insurance_commission_amount: number;
  commission_rule_source: string;
  assigned_promoter_id: string | null;
  assigned_promoter_name: string;
  original_promoter_id: string | null;
  original_promoter_name: string;
};

// Monta as linhas de proposta a partir de cms_promoter_entries, ordenadas por
// aba + contrato. promoter_credit/promoter_insurance = comissao paga (cms).
export async function buildCmsProposalRows(
  supabase: SupabaseClient,
  promoterId: string,
  year: number,
  month: number
): Promise<CmsProposalRow[]> {
  const { data, error } = await supabase
    .from("cms_promoter_entries")
    .select(CMS_ENTRY_COLUMNS)
    .eq("promoter_id", promoterId)
    .eq("prod_year", year)
    .eq("prod_month", month);
  if (error) throw new Error(error.message);

  return mapCmsEntries(data || []);
}

// Colunas lidas de cms_promoter_entries — fonte unica entre o individual e o lote.
const CMS_ENTRY_COLUMNS =
  "id, source_sheet, contract_number, j_key, net_value, gross_value, promoter_credit, promoter_insurance, insurance_premium, company_commission, avista_percent, penetration, product_description, raw_payload, promoter_id";

// Ordena (aba + contrato) e mapeia as entries cms para CmsProposalRow. Extraido
// pra ser reusado IDENTICO pelo individual (buildCmsProposalRows) e pelo lote
// (buildCmsProposalRowsBatch), garantindo o mesmo numero nas duas saidas.
function mapCmsEntries(entries: any[]): CmsProposalRow[] {
  const sorted = entries.slice().sort((a: any, b: any) => {
    const sa = String(a.source_sheet || ""),
      sb = String(b.source_sheet || "");
    if (sa !== sb) return sa < sb ? -1 : 1;
    return String(a.contract_number || "").localeCompare(String(b.contract_number || ""));
  });

  return sorted.map((e: any) => {
    const rp = (e.raw_payload as Record<string, unknown> | null) || {};
    return {
      id: e.id,
      contract_number: e.contract_number || "-",
      proposal_number: e.contract_number || "-",
      agency_code: String(rawValue(rp, ["AGENCIA"]) ?? "") || "-",
      j_key: e.j_key || "",
      promoter_name: "",
      product_description: e.product_description || "-",
      status: "FECHADO",
      movement_date: null,
      contract_date:
        (rawValue(rp, ["DATA CONTRATACAO", "DATA CONTRATAÇÃO"]) as string | null) ?? null,
      interest_rate: rawNum(rp, ["TX JUROS"]),
      installment_count: rawNum(rp, ["PARCELA", "PARCELAS"]),
      company_received_percent: toNumber(e.avista_percent),
      company_commission_amount: toNumber(e.company_commission),
      srcc_restriction: String(rawValue(rp, ["RESTRICAO SRCC", "RESTRIÇÃO SRCC"]) ?? "") || "-",
      net_value: toNumber(e.net_value),
      gross_value: toNumber(e.gross_value),
      insurance_value: toNumber(e.insurance_premium),
      company_insurance_commission_amount: 0,
      insurance_penetration_percent: toNumber(e.penetration),
      promoter_commission_percent: 0,
      promoter_commission_amount: toNumber(e.promoter_credit),
      insurance_commission_percent: 0,
      insurance_commission_amount: toNumber(e.promoter_insurance),
      commission_rule_source: "cms",
      assigned_promoter_id: e.promoter_id ?? null,
      assigned_promoter_name: "",
      original_promoter_id: e.promoter_id ?? null,
      original_promoter_name: "",
    };
  });
}

// ETAPA 7 (lote) — busca as entries cms de VARIOS promotores numa unica query
// (.in) e agrupa por promoter_id. Evita N round-trips no export em lote do mes
// fechado. Cada grupo passa pelo MESMO mapCmsEntries do individual.
export async function buildCmsProposalRowsBatch(
  supabase: SupabaseClient,
  promoterIds: string[],
  year: number,
  month: number
): Promise<Map<string, CmsProposalRow[]>> {
  const result = new Map<string, CmsProposalRow[]>();
  const ids = Array.from(new Set(promoterIds.filter(Boolean)));
  if (ids.length === 0) return result;

  const { data, error } = await supabase
    .from("cms_promoter_entries")
    .select(CMS_ENTRY_COLUMNS)
    .in("promoter_id", ids)
    .eq("prod_year", year)
    .eq("prod_month", month);
  if (error) throw new Error(error.message);

  const byPromoter = new Map<string, any[]>();
  for (const entry of data || []) {
    const pid = String((entry as any).promoter_id ?? "");
    if (!pid) continue;
    const bucket = byPromoter.get(pid);
    if (bucket) bucket.push(entry);
    else byPromoter.set(pid, [entry]);
  }

  for (const pid of ids) {
    result.set(pid, mapCmsEntries(byPromoter.get(pid) || []));
  }
  return result;
}
