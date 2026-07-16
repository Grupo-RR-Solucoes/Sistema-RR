import type { SupabaseClient } from "@supabase/supabase-js";

import { detectSpecialAgreementsMesFechado } from "./agreements/specialFechadoAviso.ts";

// CMS-IMPORT (SPEC §4) — consolidacao do PMR no MES FECHADO a partir do cms.
// Extraido de app/api/calculate/monthly/route.ts para que o runner de execucao
// (scripts/run_pmr_cms.cjs) rode EXATAMENTE a mesma logica da rota — a Auditoria
// 2 valida o sistema, nao uma copia.

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value).trim();
  const normalized = raw.includes(",")
    ? raw.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")
    : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function resolveTargetStatus(
  productionValue: number,
  target: number,
  target1: number,
  target2: number
) {
  if (target2 > 0 && productionValue >= target2) return "META_2";
  if (target1 > 0 && productionValue >= target1) return "META_1";
  if (target > 0 && productionValue >= target) return "META";
  return "BELOW_META";
}

async function fetchAllPaged<T = any>(baseQueryBuilder: () => any): Promise<T[]> {
  let from = 0;
  const pageSize = 1000;
  const all: T[] = [];
  while (true) {
    const { data, error } = await baseQueryBuilder().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// REGIME da competencia — decide a FONTE de leitura da tela, com PRECEDENCIA:
//   'cms'        (jan-mai): cms_imports COMPLETED cobrindo TODAS as empresas ativas.
//   'fechamento' (jun+)   : monthly_closing_imports COMPLETED cobrindo as ativas.
//   'open'                : nenhum dos dois => le o daily ao vivo.
// A ORDEM importa: jan-mai tem cms E fechamento; a precedencia cms > fechamento
// garante que aqueles meses continuem lendo o SEED do cms (nao recalculam pelo
// fechamento). ADS e active=false => NAO entra no gatilho (as 4 RR bastam).
// Pre-migration (tabela ausente) / erro => degrada para 'open' (caminho diario).
export type MonthRegime = "cms" | "fechamento" | "open";

export async function detectMonthRegime(
  supabase: SupabaseClient,
  year: number,
  month: number,
  // empresaEmVoo: o import de fechamento e POR EMPRESA e so marca COMPLETED no
  // fim do pipeline. Para o pipeline decidir, ANTES de marcar, se a competencia
  // fecha COM ele, a empresa em voo entra na cobertura como se ja estivesse
  // COMPLETED. Sem isso a ultima empresa nunca veria o mes fechar (ela mesma
  // ainda nao esta marcada) e o PMR fechado jamais seria escrito pela rota.
  // Nao muda a regra do regime — so antecipa um COMPLETED que esta a 1 passo.
  opts?: { empresaEmVoo?: string | null }
): Promise<MonthRegime> {
  const { data: active, error: companiesError } = await supabase
    .from("companies")
    .select("id")
    .eq("active", true);
  if (companiesError) throw companiesError;

  const totalActive = (active || []).length;
  if (totalActive === 0) return "open";

  // 1o) cms (jan-mai) — precedencia sobre o fechamento.
  const { data: cmsImports, error: cmsError } = await supabase
    .from("cms_imports")
    .select("company_id")
    .eq("prod_year", year)
    .eq("prod_month", month)
    .eq("status", "COMPLETED");
  if (!cmsError) {
    const covered = new Set((cmsImports || []).map((row: any) => row.company_id));
    if (covered.size >= totalActive) return "cms";
  }

  // 2o) fechamento (jun+) — monthly_closing_imports COMPLETED.
  const { data: closingImports, error: closingError } = await supabase
    .from("monthly_closing_imports")
    .select("company_id")
    .eq("year", year)
    .eq("month", month)
    .eq("status", "COMPLETED");
  if (!closingError) {
    const covered = new Set((closingImports || []).map((row: any) => row.company_id));
    if (opts?.empresaEmVoo) covered.add(opts.empresaEmVoo);
    if (covered.size >= totalActive) return "fechamento";
  }

  return "open";
}

/**
 * O par de argumentos de REGIME que promoterAnalytics espera — o MESMO que
 * /api/promotores:158, /api/dashboard e lib/report montam.
 *
 * Mora aqui, ao lado do detectMonthRegime, porque a derivacao E parte da regra de
 * regime: um so lugar decide o que "fechado" significa para o analytics. Sem
 * closedSource o analytics cai no `.find()` legado (1 linha do PMR por promotor,
 * sem filtrar source) — que trunca promotor com linha RR + linha ADS e ainda deixa
 * entrar promotor sem linha no ledger fechado.
 *
 * ARMADILHA: `closed` e `regime !== 'open'`, NUNCA `regime === 'fechamento'` —
 * isso trataria jan-mai (cms) como mes aberto.
 */
export function analyticsRegimeArgs(regime: MonthRegime | undefined): {
  closed: boolean | undefined;
  closedSource: "cms" | "fechamento" | undefined;
} {
  if (regime === undefined) return { closed: undefined, closedSource: undefined };
  return {
    closed: regime !== "open",
    closedSource: regime === "open" ? undefined : regime,
  };
}

// REMOVIDO no MOV 3 (faxina): detectClosedMonth.
//
// Era o booleano que COLAPSAVA 'cms' e 'fechamento' num "fechado" so. Quem so tinha
// o booleano assumia "fechado = cms" e lia cms_promoter_entries — que nao tem jun+.
// Foi a causa raiz do Movimento 2 (dashboard com comissao R$ 0,00, editor de propostas
// vazio, relatorio truncando RR+ADS, DRE sem junho).
//
// Depois do Mov 2 ele ficou SEM NENHUM call-site em lib/ e app/ (zero imports). Foi
// removido para nao ser reintroduzido: quem precisa da pergunta binaria escreve
// `(await detectMonthRegime(...)) !== "open"` — explicito, e sem a tentacao de
// confundir com `=== "fechamento"` (que trataria jan-mai como mes aberto).
//
// Quem escolhe FONTE usa o enum + analyticsRegimeArgs.

// Consolida o PMR do mes fechado REPRODUZINDO o cms:
//   production_commission_value = Σ promoter_credit    (por promoter_id)
//   insurance_commission_value  = Σ promoter_insurance
//   final_commission_value      = production + insurance  (e NADA MAIS)
// Sem 5,80% / acordo / FIX-6 / descontos. source='cms'.
export async function consolidateMonthlyFromCms(
  supabase: SupabaseClient,
  params: { year: number; month: number; companyId: string | null; promoterId: string | null }
) {
  const { year, month, companyId, promoterId } = params;

  const promoters = await fetchAllPaged<any>(() => {
    let query = supabase.from("promoters").select("id, company_id, name, active, is_master");
    if (companyId) query = query.eq("company_id", companyId);
    if (promoterId) query = query.eq("id", promoterId);
    return query;
  });

  const targets = await fetchAllPaged<any>(() => {
    let query = supabase
      .from("monthly_targets")
      .select("*")
      .eq("year", year)
      .eq("month", month);
    if (companyId) query = query.eq("company_id", companyId);
    if (promoterId) query = query.eq("promoter_id", promoterId);
    return query;
  });

  const entries = await fetchAllPaged<any>(() => {
    let query = supabase
      .from("cms_promoter_entries")
      .select(
        "promoter_id, company_id, net_value, gross_value, promoter_credit, promoter_insurance, insurance_premium"
      )
      .eq("prod_year", year)
      .eq("prod_month", month);
    if (companyId) query = query.eq("company_id", companyId);
    if (promoterId) query = query.eq("promoter_id", promoterId);
    return query;
  });

  type CmsAgg = {
    credit: number;
    insurance: number;
    net: number;
    gross: number;
    count: number;
    insuredCount: number;
    insuredNet: number;
    companyId: string | null;
  };
  const agg = new Map<string, CmsAgg>();
  for (const entry of entries) {
    // entries sem promotor mapeado NAO entram no PMR — ficam com a empresa.
    if (!entry.promoter_id) continue;
    const a =
      agg.get(entry.promoter_id) || {
        credit: 0,
        insurance: 0,
        net: 0,
        gross: 0,
        count: 0,
        insuredCount: 0,
        insuredNet: 0,
        companyId: entry.company_id ?? null,
      };
    a.credit += toNumber(entry.promoter_credit);
    a.insurance += toNumber(entry.promoter_insurance);
    a.net += toNumber(entry.net_value);
    a.gross += toNumber(entry.gross_value);
    a.count += 1;
    if (toNumber(entry.insurance_premium) > 0) {
      a.insuredCount += 1;
      a.insuredNet += toNumber(entry.net_value);
    }
    agg.set(entry.promoter_id, a);
  }

  const promoterMeta = new Map<string, any>(promoters.map((p: any) => [p.id, p]));
  const promoterIds = new Set<string>();
  for (const p of promoters) if (p.active) promoterIds.add(p.id);
  for (const id of agg.keys()) promoterIds.add(id);

  const upserts: any[] = [];
  const table: Array<{
    promoter_id: string;
    promoter_name: string;
    production_commission_value: number;
    insurance_commission_value: number;
    final_commission_value: number;
  }> = [];

  for (const id of promoterIds) {
    const meta = promoterMeta.get(id);
    const a =
      agg.get(id) || {
        credit: 0,
        insurance: 0,
        net: 0,
        gross: 0,
        count: 0,
        insuredCount: 0,
        insuredNet: 0,
        companyId: meta?.company_id ?? null,
      };

    // MASTER NAO RECEBE COMISSAO NO LEDGER DERIVADO.
    // O cms e ground-truth e a tabela-espelho (cms_promoter_entries) fica
    // INTACTA — os valores da fonte (credito do promotor + comissao-empresa)
    // continuam la para a reconciliacao. Aqui, ao DERIVAR o PMR, aplicamos a
    // taxonomia do proprio SISTEMA: "master = balde/CNPJ" (j_keys
    // key_type=MASTER, refletido em promoters.is_master), que NAO e promotor e
    // nao recebe comissao. E a MESMA regra que telas, daily, closing, /equipe e
    // projecao ja aplicam — so que aqui, na origem da derivacao, para nenhum
    // consumidor downstream precisar lembrar do filtro.
    //
    // Nao editamos a fonte, nao apagamos a linha (production_value etc. seguem):
    // so zeramos credito/seguro do master. NAO "consertar" isto achando que e
    // bug. Caso concreto: o 13o de fev/2026 (contrato 201830802, chave
    // JG626476) foi keyado na master pela FONTE, sem individuo cadastrado; se o
    // negocio quiser que essa comissao va para uma pessoa, e correcao de
    // DADO/ATRIBUICAO na fonte (cadastrar promotor + re-key), nao aqui.
    const isMasterPromoter = meta?.is_master === true;

    const productionCommission = isMasterPromoter ? 0 : a.credit;
    // cms é ground-truth: promoter_insurance já vem calculado pela fonte — NÃO
    // aplica share por penetração aqui, então o bug de cortes (share_scale_tier)
    // NÃO afeta a comissão do cms. A penetração abaixo é só MÉTRICA (base net,
    // "segurado" = insurance_premium>0, critério do próprio cms).
    const insuranceCommission = isMasterPromoter ? 0 : a.insurance;
    const finalCommission = productionCommission + insuranceCommission;

    const target = targets.find((t: any) => t.promoter_id === id);
    const targetValue = target ? toNumber(target.meta) : 0;
    const target1Value = target ? toNumber(target.meta_1) : 0;
    const target2Value = target ? toNumber(target.meta_2) : 0;
    const penetration = a.net > 0 ? (a.insuredNet / a.net) * 100 : 0;

    upserts.push({
      promoter_id: id,
      company_id: meta?.company_id ?? a.companyId ?? null,
      year,
      month,
      production_value: a.net,
      proposal_count: a.count,
      insured_proposal_count: a.insuredCount,
      insured_production_value: a.insuredNet,
      insurance_penetration_percent: penetration,
      target_value: targetValue,
      target_1_value: target1Value,
      target_2_value: target2Value,
      projected_production_value: a.net, // mes fechado: sem projecao diaria
      production_commission_value: productionCommission,
      insurance_commission_value: insuranceCommission,
      agreement_adjustment_value: 0,
      discount_value: 0,
      final_commission_value: finalCommission,
      target_status: resolveTargetStatus(a.net, targetValue, target1Value, target2Value),
      source: "cms",
      calculated_at: new Date().toISOString(),
      // Detector Camada 1: NULL de PROPOSITO — o cms e ground-truth e NAO usa a
      // TRP. A comissao ja vem PRONTA da fonte (cms_promoter_entries). NAO
      // "consertar" para gravar versao: nao ha versao de TRP usada neste calculo.
      trp_version_id: null,
      trp_fallback: null,
    });

    table.push({
      promoter_id: id,
      promoter_name: meta?.name ?? "(promotor desconhecido)",
      production_commission_value: productionCommission,
      insurance_commission_value: insuranceCommission,
      final_commission_value: finalCommission,
    });
  }

  if (upserts.length > 0) {
    const { error } = await supabase
      .from("promoter_monthly_results")
      .upsert(upserts, { onConflict: "promoter_id,year,month,company_id" });
    if (error) throw error;
  }

  // GUARDA ANTI-SILENCIO: ajuste comercial (acordo SPECIAL) em mes FECHADO. O cms
  // e ground-truth e REPRODUZ a fonte "e NADA MAIS" (ver doc desta funcao) — o
  // ajuste avulso NAO e aplicado aqui, agreement_adjustment_value fica 0 (acima).
  // Se houver SPECIAL ativo na competencia, avisa em vez de gravar 0 mudo, para o
  // operador conferir. NO-OP hoje (0 SPECIAL em prod). Ver
  // lib/agreements/specialFechadoAviso.ts para a decisao AVISAR-vs-HONRAR.
  const avisos: string[] = [];
  const specialFechado = await detectSpecialAgreementsMesFechado(supabase, {
    year,
    month,
    companyId,
    promoterId,
  });
  if (specialFechado.aviso) avisos.push(specialFechado.aviso);

  return { promoters_calculated: upserts.length, table, avisos };
}
