import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// bbtsOrchestrator — BBTS-2d. Consolidação POR PROMOTOR (RR + ADS).
//
// Problema: rodando isolados por empresa, os consolidadores não veem a produção
// do promotor na outra empresa. A EMPRESA define ONDE a comissão é contabilizada
// (qual linha do PMR); a CONSOLIDAÇÃO DO PROMOTOR define quais ESCALAS se aplicam
// (meta, penetração, volume). As duas linhas (RR e ADS) recebem as MESMAS escalas.
//
// Fluxo, por promotor com produção em junho (RR e/ou ADS):
//   1. produção líquida RR + ADS  -> statusMeta (vs meta/meta_1/meta_2)
//   2. segurado/total RR + ADS    -> penetração consolidada -> seguroShare (cortes oficiais)
//   3. volume RR + ADS            -> volumeConsolidado (escala ENTRANTE)
//   4. consolidateMonthlyFromClosing(injeta 3) -> linha company RR
//   5. consolidateMonthlyFromBbts(injeta 3)    -> linha company ADS
//
// READ das fontes + (via consolidadores) WRITE nas duas linhas do PMR. dryRun
// não grava.
// ============================================================================

import { loadClosingPromoterBase } from "./closingPromoterBase.ts";
import { consolidateMonthlyFromClosing } from "./closingMonthly.ts";
import { consolidateMonthlyFromBbts, BBTS_COMPANY_ID } from "./bbtsMonthly.ts";
import { insuranceShareForPenetration } from "./insurancePenetration.ts";
import { fetchPromoterShareData } from "./proposalDetailing.ts";
import { getProductionPeriodFromValue, getProductionPeriodKey } from "./productionPeriod.ts";

const BBTS_KEY = "JJ552710";

function normKey(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").toUpperCase();
}
function normText(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}
function resolveTargetStatus(prod: number, meta: number, m1: number, m2: number): string {
  if (m2 > 0 && prod >= m2) return "META_2";
  if (m1 > 0 && prod >= m1) return "META_1";
  if (meta > 0 && prod >= meta) return "META";
  return "BELOW_META";
}
async function fetchAllPaged<T = any>(build: () => any): Promise<T[]> {
  let from = 0; const size = 1000; const all: T[] = [];
  while (true) { const { data, error } = await build().range(from, from + size - 1); if (error) throw error; if (!data || data.length === 0) break; all.push(...(data as T[])); if (data.length < size) break; from += size; }
  return all;
}

type SupabaseLike = SupabaseClient;

export type GroupRow = {
  promoter_id: string;
  promoter_name: string;
  prod_rr: number;
  prod_ads: number;
  prod_total: number;
  status_meta: string;
  penetracao_consolidada: number; // 0..1
  seguro_share: number; // 0..1
  volume_consolidado: number;
  acordo: number; // 0..1 (resultante na ADS, com volume consolidado)
  credito_rr: number;
  credito_ads: number;
  seguro_rr: number;
  seguro_ads: number;
};

export async function consolidateMonthlyGroup(
  supabase: SupabaseLike,
  params: { year: number; month: number; dryRun?: boolean }
) {
  const { year, month } = params;
  const dryRun = params.dryRun !== false; // default dry-run

  // ---- A. Soma RR (fechamento CASH, excl SRCC/BBTS, com herança master) ----
  const base = await loadClosingPromoterBase(supabase, { year, month });
  const contratos = base.contratos.filter((c) => normKey(c.chaveJ) !== BBTS_KEY);
  // herança master: contrato sem promotor individual -> assigned do diário (RR).
  const orphans = contratos.filter((c) => !c.promoterId && (c.contrato || "").trim());
  const heir = new Map<string, string>();
  {
    const cs = [...new Set(orphans.map((c) => (c.contrato || "").trim()))];
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    for (let i = 0; i < cs.length; i += 300) {
      const { data } = await supabase
        .from("daily_production_records")
        .select("proposal_number, company_id, assigned_promoter_id, movement_date, updated_at")
        .in("proposal_number", cs.slice(i, i + 300));
      const best = new Map<string, { pid: string; upd: string }>();
      for (const d of data || []) {
        if (!d.assigned_promoter_id || !String(d.movement_date || "").startsWith(prefix)) continue;
        const k = `${d.company_id}|${String(d.proposal_number || "").trim()}`;
        const prev = best.get(k); const upd = String(d.updated_at || "");
        if (!prev || upd > prev.upd) best.set(k, { pid: d.assigned_promoter_id, upd });
      }
      for (const [k, v] of best) heir.set(k, v.pid);
    }
  }
  const rr = new Map<string, { net: number; liqSeg: number }>();
  for (const c of contratos) {
    const pid = c.promoterId || heir.get(`${c.companyId}|${(c.contrato || "").trim()}`) || null;
    if (!pid) continue;
    const a = rr.get(pid) || { net: 0, liqSeg: 0 };
    a.net += c.valorLiquido;
    if (c.prodSegurada) a.liqSeg += c.valorLiquido;
    rr.set(pid, a);
  }

  // ---- B. Soma ADS (diário ADS atribuído, válido: PRODUCAO && !cancel && !srcc) ----
  // COMPETÊNCIA: mesmo predicado do consolidateMonthlyFromBbts (movement_date ->
  // contract_date -> proposal_date via getProductionPeriodFromValue). Sem ele a
  // query somava a ADS INTEIRA de todos os meses na penetração consolidada.
  const ads = new Map<string, { prod: number; liqSeg: number }>();
  {
    const compKey = getProductionPeriodKey(year, month);
    const rows = await fetchAllPaged<any>(() =>
      supabase.from("daily_production_records")
        .select("assigned_promoter_id, gross_value, insurance_value, status, is_srcc_restricted, movement_date, contract_date, proposal_date, raw_payload")
        .eq("company_id", BBTS_COMPANY_ID)
    );
    for (const r of rows) {
      const pid = r.assigned_promoter_id;
      if (!pid) continue;
      const per =
        getProductionPeriodFromValue(r.movement_date) ||
        getProductionPeriodFromValue(r.contract_date) ||
        getProductionPeriodFromValue(r.proposal_date);
      if (!per || getProductionPeriodKey(per.year, per.month) !== compKey) continue;
      const meta = (r.raw_payload && r.raw_payload.__bbts_meta) || {};
      const st = normText(r.status);
      if (!(st === "PRODUCAO" || st === "PRODUCTION")) continue;
      if (meta.cancelado === true || r.is_srcc_restricted === true) continue;
      const gross = Number(r.gross_value || 0);
      const a = ads.get(pid) || { prod: 0, liqSeg: 0 };
      a.prod += gross;
      if (Number(r.insurance_value || 0) > 0) a.liqSeg += gross;
      ads.set(pid, a);
    }
  }

  // ---- C. Metas + nomes + PRODUÇÃO/VOLUME do DIÁRIO (mesma fonte do consolidador). ----
  // A produção/volume que decide meta e escala vem do fetchPromoterShareData (o
  // que os consolidadores realmente consomem), escopada por empresa. Assim os
  // RR-sem-ADS ficam IDÊNTICOS ao RR-puro (prodRR só diário RR); a penetração
  // segue a base do FECHAMENTO (rr/ads acima), que é a fonte do seguro.
  const pids = [...new Set([...rr.keys(), ...ads.keys()])];
  const targetsRows = await fetchAllPaged<any>(() =>
    supabase.from("monthly_targets").select("promoter_id, meta, meta_1, meta_2").eq("year", year).eq("month", month)
  );
  const targetById = new Map<string, any>(targetsRows.map((t) => [t.promoter_id, t]));
  const nameById = new Map<string, string>();
  { const proms = await fetchAllPaged<any>(() => supabase.from("promoters").select("id, name")); for (const p of proms) nameById.set(p.id, p.name); }
  const rrCompanies = await fetchAllPaged<any>(() => supabase.from("companies").select("id").eq("group_name", "Grupo RR"));
  const rrCompanyIds = rrCompanies.map((c) => c.id as string);
  // Produção/volume do diário, ESCOPADAS: RR e ADS separadas — soma = consolidado.
  const shareRR = await fetchPromoterShareData(supabase, pids, year, month, rrCompanyIds);
  const shareADS = await fetchPromoterShareData(supabase, pids, year, month, [BBTS_COMPANY_ID]);

  // ---- D. Consolidado por promotor -> as 3 injeções ----
  const statusMetaByPromoter = new Map<string, string>();
  const seguroShareByPromoter = new Map<string, number>();
  const volumeConsolidadoByPromoter = new Map<string, number>();
  const prodConsolidadoByPromoter = new Map<string, number>(); // Frente C (produção válida)
  const consolid = new Map<string, { prodRR: number; prodADS: number; prodTotal: number; pen: number; share: number; status: string }>();
  for (const pid of pids) {
    // Produção/volume (diário, para meta + escala): RR + ADS.
    const prodRR = shareRR.frenteCProductionMap.get(pid) ?? 0;
    const prodADS = shareADS.frenteCProductionMap.get(pid) ?? 0;
    const volRR = shareRR.monthlyVolumesMap.get(pid) ?? 0;
    const volADS = shareADS.monthlyVolumesMap.get(pid) ?? 0;
    const prodTotal = prodRR + prodADS;
    const volTotal = volRR + volADS;
    // Penetração (base do FECHAMENTO/seguro): líq segurado / líq total, RR + ADS.
    const r = rr.get(pid) || { net: 0, liqSeg: 0 };
    const a = ads.get(pid) || { prod: 0, liqSeg: 0 };
    const penDen = r.net + a.prod;
    const penNum = r.liqSeg + a.liqSeg;
    const pen = penDen > 0 ? penNum / penDen : 0;
    const share = insuranceShareForPenetration(pen);
    const t = targetById.get(pid);
    const status = resolveTargetStatus(prodTotal, Number(t?.meta || 0), Number(t?.meta_1 || 0), Number(t?.meta_2 || 0));
    statusMetaByPromoter.set(pid, status);
    seguroShareByPromoter.set(pid, share);
    volumeConsolidadoByPromoter.set(pid, volTotal);
    prodConsolidadoByPromoter.set(pid, prodTotal);
    consolid.set(pid, { prodRR, prodADS, prodTotal, pen, share, status });
  }

  const inject = { statusMetaByPromoter, seguroShareByPromoter, volumeConsolidadoByPromoter, prodConsolidadoByPromoter };

  // ---- E. Consolidadores injetados (RR grava linha RR; ADS grava linha ADS) ----
  const rrRes: any = await consolidateMonthlyFromClosing(supabase, { year, month, dryRun, ...inject });
  const adsRes: any = await consolidateMonthlyFromBbts(supabase, { year, month, dryRun, ...inject });
  const rrByPid = new Map<string, any>(rrRes.table.map((x: any) => [x.promoter_id, x]));
  const adsByPid = new Map<string, any>(adsRes.table.map((x: any) => [x.promoter_id, x]));

  // ---- F. Tabela combinada por promotor ----
  const rows: GroupRow[] = [];
  for (const pid of pids) {
    const c = consolid.get(pid)!;
    const rrr = rrByPid.get(pid);
    const ar = adsByPid.get(pid);
    rows.push({
      promoter_id: pid,
      promoter_name: nameById.get(pid) ?? "?",
      prod_rr: c.prodRR,
      prod_ads: c.prodADS,
      prod_total: c.prodTotal,
      status_meta: c.status,
      penetracao_consolidada: c.pen,
      seguro_share: c.share,
      volume_consolidado: c.prodTotal,
      acordo: ar?.acordo ?? 0,
      credito_rr: rrr?.production_commission_value ?? 0,
      credito_ads: ar?.comissao_promotor_credito ?? 0,
      seguro_rr: rrr?.insurance_commission_value ?? 0,
      seguro_ads: ar?.seguro_comissao_promotor ?? 0,
    });
  }
  rows.sort((x, y) => y.prod_total - x.prod_total);

  return {
    dry_run: dryRun,
    promotores: pids.length,
    rows,
    totals: {
      credito_rr: rows.reduce((s, r) => s + r.credito_rr, 0),
      credito_ads: rows.reduce((s, r) => s + r.credito_ads, 0),
      seguro_rr: rows.reduce((s, r) => s + r.seguro_rr, 0),
      seguro_ads: rows.reduce((s, r) => s + r.seguro_ads, 0),
    },
    rr_gravadas: rrRes.gravadas ?? 0,
    ads_gravadas: adsRes.gravadas ?? 0,
  };
}
