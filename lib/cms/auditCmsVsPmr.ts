import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// lib/cms/auditCmsVsPmr.ts — AUDITORIA 2 (sistema x cms), fonte unica.
//
// Compara, por competencia cms, o PMR (source='cms') com o GROUND-TRUTH
// (cms_promoter_entries): o PMR reproduz fielmente o cms? Antes esta logica so
// existia inline em scripts/run_pmr_cms.cjs. Foi extraida para ca para que o
// RUNNER (que grava) e o VIGIA (/api/diagnostico, que so LE) usem o MESMO
// criterio — sem drift entre a auditoria do script e a do health-check.
//
// PONTO CEGO QUE ISTO FECHA: a Camada 2 (detect_rules_stale) exclui os meses cms
// de proposito (escopo source in fechamento/bbts) e o vigia so checava
// EXISTENCIA do PMR. Se alguem reimportar cms_promoter_entries sem rodar o CLI
// (run_pmr_cms --apply), o PMR cms fica STALE e nada avisava. Este check e o
// detector de frescor do cms.
//
// REGRAS (identicas a AUDITORIA 2 original):
//   - Compara o FINAL por promotor (= o que e pago). A quebra credito/seguro
//     pode arredondar em meia-casa (ex.: seguro cms 85,635) sem mudar o final.
//   - MASTER NAO ENTRA: o consolidador zera credito/seguro do master no PMR de
//     PROPOSITO (ver lib/cmsMonthly.ts). Comparar cru acusaria divergencia FALSA
//     (cms tem o valor, PMR tem 0). A invariante correta e "PMR reproduz o cms
//     EXCETO master".
//   - Tolerancia meia-casa (CMS_PMR_TOLERANCE): cobre o artefato do cms com 6
//     casas decimais vs o PMR gravado com 2. Diferenca < 1 centavo NAO e
//     divergencia.
// READ-ONLY: so SELECT.
// ============================================================================

/** Tolerancia por promotor (meia-casa). Diferenca <= isto NAO e divergencia. */
export const CMS_PMR_TOLERANCE = 0.005;

const r2 = (x: unknown) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function fetchAllPaged<T>(build: () => any): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  const size = 1000;
  for (;;) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    all.push(...((data as T[]) || []));
    if (!data || data.length < size) break;
    from += size;
  }
  return all;
}

export interface CmsPmrRow {
  promoter_id: string;
  pmr_prod: number;
  pmr_ins: number;
  pmr_final: number;
  cms_credit: number;
  cms_ins: number;
  cms_esperado: number;
  delta: number;
  diverge: boolean;
}

export interface CmsPmrAudit {
  year: number;
  month: number;
  divergences: number;
  /** Σ final do PMR (exclui master). */
  total_pmr: number;
  /** Σ esperado do cms (exclui master). */
  total_cms: number;
  /** Uma linha por promotor NAO-master considerado (na ordem de iteracao). */
  rows: CmsPmrRow[];
}

/**
 * Audita o PMR source='cms' de uma competencia contra o cms_promoter_entries.
 * READ-ONLY. Master fora (regra do consolidador). Compara o FINAL com tolerancia
 * de meia-casa.
 *
 * @param opts.masterIds conjunto de promoters.is_master (evita re-fetch quando o
 *   chamador ja tem; se ausente, busca).
 * @param opts.tolerance override da tolerancia (default CMS_PMR_TOLERANCE).
 */
export async function auditCmsVsPmr(
  supabase: SupabaseClient,
  year: number,
  month: number,
  opts?: { masterIds?: Set<string>; tolerance?: number }
): Promise<CmsPmrAudit> {
  const tol = opts?.tolerance ?? CMS_PMR_TOLERANCE;

  let masterIds = opts?.masterIds;
  if (!masterIds) {
    const proms = await fetchAllPaged<{ id: string; is_master: boolean | null }>(() =>
      supabase.from("promoters").select("id, is_master")
    );
    masterIds = new Set(proms.filter((p) => p.is_master === true).map((p) => p.id));
  }

  // PMR gravado (source=cms) da competencia.
  const pmr = await fetchAllPaged<any>(() =>
    supabase
      .from("promoter_monthly_results")
      .select(
        "promoter_id, production_commission_value, insurance_commission_value, final_commission_value"
      )
      .eq("year", year)
      .eq("month", month)
      .eq("source", "cms")
  );
  const pmrBy = new Map<string, any>(pmr.map((p) => [p.promoter_id, p]));

  // cms agregado por promotor (so mapeados).
  const entries = await fetchAllPaged<any>(() =>
    supabase
      .from("cms_promoter_entries")
      .select("promoter_id, promoter_credit, promoter_insurance")
      .eq("prod_year", year)
      .eq("prod_month", month)
  );
  const cmsBy = new Map<string, { credit: number; insurance: number }>();
  for (const e of entries) {
    if (!e.promoter_id) continue;
    const a = cmsBy.get(e.promoter_id) || { credit: 0, insurance: 0 };
    a.credit += toNum(e.promoter_credit);
    a.insurance += toNum(e.promoter_insurance);
    cmsBy.set(e.promoter_id, a);
  }

  // Universo = promotores no cms OU com final != 0 no PMR (identico ao runner).
  const promoterIds = new Set<string>([
    ...cmsBy.keys(),
    ...pmr.filter((p) => toNum(p.final_commission_value) !== 0).map((p) => p.promoter_id),
  ]);

  const rows: CmsPmrRow[] = [];
  let totalPmr = 0;
  let totalCms = 0;
  let divergences = 0;
  for (const pid of promoterIds) {
    if (masterIds.has(pid)) continue; // master zerado no PMR de proposito.
    const cms = cmsBy.get(pid) || { credit: 0, insurance: 0 };
    const cmsEsperado = r2(cms.credit + cms.insurance);
    const row = pmrBy.get(pid);
    const pmrProd = row ? r2(row.production_commission_value) : 0;
    const pmrIns = row ? r2(row.insurance_commission_value) : 0;
    const pmrFinal = row ? r2(row.final_commission_value) : 0;
    const delta = r2(pmrFinal - cmsEsperado);
    const diverge = Math.abs(pmrFinal - cmsEsperado) > tol;
    totalPmr += pmrFinal;
    totalCms += cmsEsperado;
    if (diverge) divergences += 1;
    rows.push({
      promoter_id: pid,
      pmr_prod: pmrProd,
      pmr_ins: pmrIns,
      pmr_final: pmrFinal,
      cms_credit: r2(cms.credit),
      cms_ins: r2(cms.insurance),
      cms_esperado: cmsEsperado,
      delta,
      diverge,
    });
  }

  return {
    year,
    month,
    divergences,
    total_pmr: r2(totalPmr),
    total_cms: r2(totalCms),
    rows,
  };
}
