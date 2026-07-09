import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// closingMonthly — consolidação do PMR a partir do FECHAMENTO (monthly_closing_
// entries, aba "A Vista"). Função IRMÃ de consolidateMonthlyFromCms (cmsMonthly.ts):
// mesma tabela (promoter_monthly_results), mesmo upsert onConflict
// (promoter_id,year,month,company_id — constraint por empresa, p/ RR e BBTS
// coexistirem no mesmo promotor/competência), mesma forma de retorno. A diferença
// é a FONTE e a RÉGUA — aqui o valor nasce do fechamento, não do cms.
//
// RÉGUA (validada contra o gabarito RR puro — sem chave BBTS — jun/2026: gap 0,3%):
//   à vista  : Σ(COMISSÃO PF do contrato) × acordo, onde acordo = resolve-
//              PromoterShareSync com Frente C — aplica a escala de repasse na
//              faixa 5,80% e o acordo base fora dela. NÃO recalcula de líquido × %.
//   herança  : contrato de chave MASTER herda o assigned_promoter_id do DIÁRIO
//              (contract_number → daily.proposal_number, MESMA company_id,
//              competência do mês). Chave INDIVIDUAL casa direto.
//   seguro   : Σ(COMISSÃO SEGURO empresa) × share do repasse. O share vem da
//              PENETRAÇÃO INDIVIDUAL do promotor (líquido_segurado/líquido_total,
//              "segurado" pelo FLAG PROD.SEGURADA), cortes oficiais 0,11/0,21/0,30
//              (lib/insurancePenetration). NÃO usa a penetração do GRUPO (era bug).
//              Soma duas fontes de comissão-empresa — (a) embutido nas linhas CASH
//              e (b) aba avulsa INSURANCE/"A Vista" (chave individual ou herança
//              master; sem chave => fora) — e aplica o share UMA vez. O BBTS-2d
//              pode INJETAR o share (penetração consolidada RR+ADS).
//   exclusões: chave BBTS (JJ552710) fica FORA (frente BBTS futura); SRCC="Sim"
//              sai do valor e volta em `restritas` para a UI.
//
// TODO (PENDÊNCIA DOCUMENTADA — não tratar nesta onda): a aba avulsa
// INSURANCE/"Seguro" (~-R$901 em jun/2026, estornos/cancelamentos SEM chave J
// nem promotor) NÃO entra nesta consolidação. Falta decisão de rateio (dedução
// da empresa? proporcional? ignorar?). Enquanto não houver régua, fica de fora.
// (Distinta da aba INSURANCE/"A Vista", que TEM régua e já entra — ver acima.)
//
// NÃO altera detectClosedMonth, NÃO toca /api/promotores, NÃO vira a tela. É
// chamada por script/endpoint de teste manual (scripts/rodarClosingMonthly.ts).
// ============================================================================

import {
  loadClosingPromoterBase,
  type ClosingContrato,
} from "./closingPromoterBase.ts";
import {
  fetchPromoterShareData,
  resolvePromoterShareSync,
  readRawPayloadValue,
} from "./proposalDetailing.ts";
import {
  individualPenetration,
  insuranceShareForPenetration,
} from "./insurancePenetration.ts";

// Chave master BBTS/ADS — excluída desta consolidação (frente futura).
const BBTS_KEY = "JJ552710";
// Teto à vista 5,80% (decimal); acima disso o contrato está na "faixa 5,80%" e a
// Frente C aplica a escala de repasse.
const FAIXA_580 = 0.058 - 0.00001;

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

function normText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normKey(value: unknown): string {
  return normText(value).replace(/ /g, "");
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

async function fetchAllPaged<T = any>(build: () => any): Promise<T[]> {
  let from = 0;
  const pageSize = 1000;
  const all: T[] = [];
  while (true) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * Herança master: para cada contrato SEM promotor individual, busca no DIÁRIO a
 * linha cujo proposal_number == contract_number do fechamento, na MESMA empresa e
 * na competência do mês; usa o assigned_promoter_id (mais recente se houver mais
 * de uma). Devolve Map<`${companyId}|${contrato}`, promoterId>.
 */
async function buildMasterHeirMap(
  supabase: SupabaseLike,
  orphans: Array<{ contrato: string | null; companyId: string | null }>,
  year: number,
  month: number
): Promise<Map<string, string>> {
  const contracts = [
    ...new Set(orphans.map((c) => (c.contrato || "").trim()).filter(Boolean)),
  ];
  const heir = new Map<string, string>();
  if (contracts.length === 0) return heir;

  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const best = new Map<string, { pid: string; updatedAt: string }>();
  for (let i = 0; i < contracts.length; i += 300) {
    const chunk = contracts.slice(i, i + 300);
    const { data, error } = await supabase
      .from("daily_production_records")
      .select("proposal_number, company_id, assigned_promoter_id, movement_date, updated_at")
      .in("proposal_number", chunk);
    if (error) throw error;
    for (const d of data || []) {
      if (!d.assigned_promoter_id) continue;
      if (!String(d.movement_date || "").startsWith(prefix)) continue; // competência do mês
      const key = `${d.company_id}|${String(d.proposal_number || "").trim()}`;
      const prev = best.get(key);
      const upd = String(d.updated_at || "");
      if (!prev || upd > prev.updatedAt) best.set(key, { pid: d.assigned_promoter_id, updatedAt: upd });
    }
  }
  for (const [key, v] of best) heir.set(key, v.pid);
  return heir;
}

type SupabaseLike = SupabaseClient;

type ClosingAgg = {
  companyId: string | null;
  net: number; // Σ valorLiquido (produção do fechamento) = denominador da penetração
  liquidoSegurado: number; // Σ valorLiquido de contratos com PROD.SEGURADA="Sim" = numerador
  count: number;
  avista: number; // Σ COMISSÃO PF × acordo (com Frente C)
  // Comissão-EMPRESA de seguro (COMISSÃO SEGURO), BRUTA — o share (individual) é
  // aplicado UMA vez no final sobre (embutido + avulso).
  seguroEmpresaEmbutido: number; // Σ COMISSÃO SEGURO do CASH
  seguroEmpresaAvulso: number; // Σ COMISSÃO SEGURO da aba INSURANCE/"A Vista"
  insuredCount: number;
};

/**
 * Consolida o PMR do mês a partir do FECHAMENTO. Grava em
 * promoter_monthly_results com source='fechamento', agregado por promotor.
 * READ das fontes + WRITE apenas em promoter_monthly_results (upsert onConflict).
 * Não vira a tela nem altera outras rotas.
 */
export async function consolidateMonthlyFromClosing(
  supabase: SupabaseLike,
  params: {
    year: number;
    month: number;
    companyId?: string | null;
    promoterId?: string | null;
    dryRun?: boolean;
    // ===== INJEÇÕES DO ORQUESTRADOR (BBTS-2d) — produção CONSOLIDADA RR+ADS =====
    // Ausentes => comportamento RR-puro (cada uma cai no cálculo local).
    // (1) share de seguro pela penetração CONSOLIDADA RR+ADS.
    seguroShareByPromoter?: Map<string, number>;
    // (2) target_status pela meta CONSOLIDADA RR+ADS (coluna do PMR).
    statusMetaByPromoter?: Map<string, string>;
    // (3) volume CONSOLIDADO (RR+ADS) da escala ENTRANTE (monthlyVolumesMap).
    volumeConsolidadoByPromoter?: Map<string, number>;
    // (3b) produção VÁLIDA CONSOLIDADA (RR+ADS) da Frente C (frenteCProductionMap).
    //      Separada do volume: ENTRANTE usa TODOS os records; Frente C só válidos.
    prodConsolidadoByPromoter?: Map<string, number>;
  }
) {
  const { year, month } = params;
  const companyId = params.companyId ?? null;
  const promoterId = params.promoterId ?? null;
  const dryRun = params.dryRun === true;

  // 1. Base do fechamento (à vista + seguro embutido; SRCC="Sim" em restritas).
  const base = await loadClosingPromoterBase(supabase, { year, month, companyId });

  // 2. Exclui a chave BBTS (JJ552710) de TUDO — frente futura cuida dela.
  const isBbts = (c: ClosingContrato) => normKey(c.chaveJ) === BBTS_KEY;
  const contratos = base.contratos.filter((c) => !isBbts(c));
  const restritas = base.restritas.filter((c) => !isBbts(c));

  // 3. Herança master: contratos sem promotor individual herdam do diário.
  const orphans = contratos.filter((c) => !c.promoterId && (c.contrato || "").trim());
  const heir = await buildMasterHeirMap(supabase, orphans, year, month);
  const efetivoPid = (c: ClosingContrato): string | null => {
    if (c.promoterId) return c.promoterId;
    const h = heir.get(`${c.companyId}|${(c.contrato || "").trim()}`);
    return h ?? null;
  };
  for (const c of contratos) (c as any).__pid = efetivoPid(c);
  for (const c of restritas) (c as any).__pid = efetivoPid(c);

  // 4. Dados de cascata/Frente C (profiles, escalas, metas, goal_repasse,
  //    produção válida) para os promotores EFETIVOS.
  const efetivos = [
    ...new Set(contratos.map((c) => (c as any).__pid).filter(Boolean)),
  ] as string[];
  // ESCOPO DE EMPRESA: a produção/volume que decide a escala do promotor
  // (monthlyVolumesMap/frenteCProductionMap) deve considerar SÓ o Grupo RR — sem
  // isso, a produção ADS atribuída no diário vazava na escala (bug Maria Letícia).
  // A meta CONSOLIDADA RR+ADS é aplicada explicitamente pelo BBTS-2d.
  const rrCompanies = await fetchAllPaged<any>(() =>
    supabase.from("companies").select("id").eq("group_name", "Grupo RR")
  );
  const rrCompanyIds = rrCompanies.map((c) => c.id as string);
  const share = await fetchPromoterShareData(supabase, efetivos, year, month, rrCompanyIds);

  // Nomes p/ carve-out Aldalene INSS.
  const nameById = new Map<string, string>();
  {
    const proms = await fetchAllPaged<any>(() =>
      supabase.from("promoters").select("id, name")
    );
    for (const p of proms) nameById.set(p.id, p.name);
  }

  // Volume/produção efetivos p/ a escala: CONSOLIDADO (RR+ADS) quando injetado
  // pelo orquestrador; senão RR-puro (monthlyVolumesMap / frenteCProductionMap).
  const volConsol = params.volumeConsolidadoByPromoter;
  const prodConsol = params.prodConsolidadoByPromoter;
  const volumeDe = (pid: string) => volConsol?.get(pid) ?? share.monthlyVolumesMap.get(pid) ?? 0;
  const producaoDe = (pid: string) => prodConsol?.get(pid) ?? share.frenteCProductionMap.get(pid) ?? 0;

  // acordo POR CONTRATO — Frente C aplica na faixa 5,80% (escala de repasse) e o
  // acordo base (profile/default) fora dela. isAldaleneInss usa nome + produto.
  function acordoDoContrato(pid: string, c: ClosingContrato): number {
    const tgt = share.targetsMap.get(pid);
    const res = resolvePromoterShareSync({
      record: { assigned_promoter_id: pid, share_percent_override: null },
      profilesMap: share.profilesMap,
      scalesMap: share.scalesMap,
      monthlyVolumesMap: new Map([[pid, volumeDe(pid)]]), // ENTRANTE: volume consolidado
      frenteC: {
        goalRepasse: share.goalRepasseMap.get(pid) ?? null,
        productionValue: producaoDe(pid), // Frente C: produção consolidada
        target1Value: tgt?.meta1 ?? 0,
        target2Value: tgt?.meta2 ?? 0,
        isAldaleneInss:
          normText(nameById.get(pid)).includes("ALDALENE") &&
          normText(c.produto).includes("INSS"),
        isFaixa580: c.percentualEmpresa >= FAIXA_580,
      },
    });
    return Math.min(Math.max(Number(res.sharePercent) || 0, 0), 1);
  }

  // 5. Agrega por promotor EFETIVO. Contratos órfãos (sem promotor mesmo após
  //    herança) NÃO entram no PMR — ficam com a empresa (igual ao cms).
  const agg = new Map<string, ClosingAgg>();
  const getAgg = (pid: string, companyId: string | null): ClosingAgg => {
    let a = agg.get(pid);
    if (!a) {
      a = {
        companyId: companyId ?? null,
        net: 0,
        liquidoSegurado: 0,
        count: 0,
        avista: 0,
        seguroEmpresaEmbutido: 0,
        seguroEmpresaAvulso: 0,
        insuredCount: 0,
      };
      agg.set(pid, a);
    }
    return a;
  };

  let orfaosSemDono = 0;
  for (const c of contratos) {
    const pid = (c as any).__pid as string | null;
    if (!pid) {
      orfaosSemDono += 1;
      continue;
    }
    const a = getAgg(pid, c.companyId ?? null);
    a.avista += c.comissaoEmpresaAvista * acordoDoContrato(pid, c);
    a.seguroEmpresaEmbutido += c.comissaoSeguro;
    a.net += c.valorLiquido; // denominador da penetração (SRCC já fora — restritas separadas)
    a.count += 1;
    // "Segurado" pelo FLAG oficial PROD.SEGURADA (não insurance_value>0).
    if (c.prodSegurada) {
      a.insuredCount += 1;
      a.liquidoSegurado += c.valorLiquido; // numerador da penetração
    }
  }

  // 5b. Seguro AVULSO — aba INSURANCE/"A Vista". Acumula a COMISSÃO SEGURO BRUTA
  //     (o share individual é aplicado no final, junto com o embutido). Atribui
  //     por CHAVE J individual ou herança master; exclui BBTS. A aba
  //     INSURANCE/"Seguro" (estornos, sem chave) segue como pendência.
  const insDiag = await addSeguroAvulso(
    supabase,
    { year, month, companyId },
    getAgg
  );

  // 6. Metas (para target_status e colunas de meta).
  const targets = await fetchAllPaged<any>(() => {
    let q = supabase
      .from("monthly_targets")
      .select("promoter_id, meta, meta_1, meta_2")
      .eq("year", year)
      .eq("month", month);
    if (companyId) q = q.eq("company_id", companyId);
    if (promoterId) q = q.eq("promoter_id", promoterId);
    return q;
  });
  const targetByPromoter = new Map<string, any>(
    targets.map((t: any) => [t.promoter_id, t])
  );

  // 7. Monta upserts + tabela de retorno. Se promoterId veio no filtro, só ele.
  const upserts: any[] = [];
  const table: Array<{
    promoter_id: string;
    promoter_name: string;
    // Diagnóstico de seguro para o dry-run/conferência.
    penetracao_individual: number; // decimal 0..1
    seguro_share: number; // 0..1 aplicado
    seguro_empresa: number; // comissão-empresa (embutido + avulso), BRUTA
    production_commission_value: number;
    insurance_commission_value: number;
    final_commission_value: number;
    source: string;
  }> = [];

  const nowIso = new Date().toISOString();
  for (const [pid, a] of agg) {
    if (promoterId && pid !== promoterId) continue;

    // PENETRAÇÃO INDIVIDUAL (líquido segurado / líquido total) + cortes oficiais.
    // O share pode ser INJETADO pelo BBTS-2d (penetração consolidada RR+ADS).
    const penetracao = individualPenetration(a.liquidoSegurado, a.net);
    const seguroShare =
      params.seguroShareByPromoter?.get(pid) ?? insuranceShareForPenetration(penetracao);
    const seguroEmpresa = a.seguroEmpresaEmbutido + a.seguroEmpresaAvulso;

    const productionCommission = a.avista;
    const insuranceCommission = seguroEmpresa * seguroShare;
    const finalCommission = productionCommission + insuranceCommission;

    const t = targetByPromoter.get(pid);
    const targetValue = t ? toNumber(t.meta) : 0;
    const target1Value = t ? toNumber(t.meta_1) : 0;
    const target2Value = t ? toNumber(t.meta_2) : 0;

    upserts.push({
      promoter_id: pid,
      company_id: a.companyId ?? null,
      year,
      month,
      production_value: a.net,
      proposal_count: a.count,
      insured_proposal_count: a.insuredCount,
      insured_production_value: a.liquidoSegurado,
      insurance_penetration_percent: penetracao * 100, // INDIVIDUAL, não a do grupo
      target_value: targetValue,
      target_1_value: target1Value,
      target_2_value: target2Value,
      projected_production_value: a.net, // mês fechado: sem projeção diária
      production_commission_value: productionCommission,
      insurance_commission_value: insuranceCommission,
      agreement_adjustment_value: 0,
      discount_value: 0,
      final_commission_value: finalCommission,
      // Meta CONSOLIDADA (RR+ADS) injetada pelo orquestrador; senão RR-pura.
      target_status:
        params.statusMetaByPromoter?.get(pid) ??
        resolveTargetStatus(a.net, targetValue, target1Value, target2Value),
      source: "fechamento",
      calculated_at: nowIso,
    });

    table.push({
      promoter_id: pid,
      promoter_name: nameById.get(pid) ?? "(promotor desconhecido)",
      penetracao_individual: penetracao,
      seguro_share: seguroShare,
      seguro_empresa: seguroEmpresa,
      production_commission_value: productionCommission,
      insurance_commission_value: insuranceCommission,
      final_commission_value: finalCommission,
      source: "fechamento",
    });
  }

  // dryRun: NÃO grava (só calcula e devolve p/ conferência).
  if (!dryRun && upserts.length > 0) {
    const { error } = await supabase
      .from("promoter_monthly_results")
      .upsert(upserts, { onConflict: "promoter_id,year,month,company_id" });
    if (error) throw error;
  }

  table.sort(
    (x, y) => y.final_commission_value - x.final_commission_value
  );

  return {
    dry_run: dryRun,
    promoters_calculated: upserts.length,
    gravadas: dryRun ? 0 : upserts.length,
    table,
    // Diagnóstico / UI futura.
    contratos_processados: contratos.length,
    contratos_herdados: orphans.filter((c) => (c as any).__pid).length,
    orfaos_sem_dono: orfaosSemDono,
    restritas, // SRCC="Sim": fora do valor, para a UI listar depois.
    bbts_excluidos: base.contratos.length - contratos.length,
    seguro_avulso: insDiag,
  };
}

// Aliases das colunas do metadata das linhas de seguro (readRawPayloadValue já
// normaliza acento/caixa e apara espaços — cobre "COMISSÃO SEGURO", " % PENETRAÇÃO ").
const A_CHAVE_J = ["CHAVE J", "LOGIN", "USUARIO"];
const A_COMISSAO_SEGURO = ["COMISSAO SEGURO", "COMISSÃO SEGURO"];
const A_CONTRATO = ["CONTRATO", "NUMERO CONTRATO", "NÚMERO CONTRATO"];

/**
 * Acumula em cada promotor a COMISSÃO SEGURO BRUTA da aba INSURANCE/"A Vista"
 * (em seguroEmpresaAvulso). O share (penetração individual) é aplicado UMA vez no
 * final, junto com o embutido — por isso NÃO multiplica por share aqui. Atribui
 * por CHAVE J (INDIVIDUAL) ou herança master (contrato → daily.proposal_number).
 * Sem chave resolvível => fora. Exclui BBTS. Muta o agregado via getAgg (cria
 * entrada nova se o promotor só tiver seguro avulso).
 */
async function addSeguroAvulso(
  supabase: SupabaseLike,
  params: { year: number; month: number; companyId: string | null },
  getAgg: (pid: string, companyId: string | null) => ClosingAgg
): Promise<{
  linhas: number;
  atribuidas: number;
  master_herdadas: number;
  sem_chave: number;
  bbts: number;
  total: number; // Σ COMISSÃO SEGURO BRUTA atribuída (antes do share)
}> {
  const { year, month, companyId } = params;

  // Linhas INSURANCE da aba "A Vista" (sheet_name tem espaço no fim). A aba
  // "Seguro" (estornos) é outra sheet_name e NÃO entra aqui.
  const rows = await fetchAllPaged<any>(() => {
    let q = supabase
      .from("monthly_closing_entries")
      .select("company_id, j_key, commission_value, metadata")
      .eq("year", year)
      .eq("month", month)
      .eq("entry_type", "INSURANCE")
      .eq("sheet_name", "A Vista ");
    if (companyId) q = q.eq("company_id", companyId);
    return q;
  });

  // Mapa Chave J -> tipo/promotor.
  const jkeys = await fetchAllPaged<any>(() =>
    supabase.from("j_keys").select("j_key, promoter_id, key_type")
  );
  const jkeyMap = new Map<string, { promoter_id: string | null; key_type: string | null }>();
  for (const jk of jkeys) {
    const k = normKey(jk.j_key);
    if (k) jkeyMap.set(k, { promoter_id: jk.promoter_id ?? null, key_type: jk.key_type ?? null });
  }

  const chaveDe = (r: any): string =>
    normKey(readRawPayloadValue(r.metadata || {}, A_CHAVE_J) || r.j_key);
  const contratoDe = (r: any): string =>
    String(readRawPayloadValue(r.metadata || {}, A_CONTRATO) || "").trim();

  // Herança master p/ as linhas cuja chave é MASTER.
  const masterOrphans = rows
    .filter((r) => {
      const info = jkeyMap.get(chaveDe(r));
      return info && info.key_type === "MASTER";
    })
    .map((r) => ({ contrato: contratoDe(r), companyId: r.company_id ?? null }));
  const heir = await buildMasterHeirMap(supabase, masterOrphans, year, month);

  let atribuidas = 0;
  let masterHerdadas = 0;
  let semChave = 0;
  let bbts = 0;
  let total = 0;

  for (const r of rows) {
    const chave = chaveDe(r);
    if (chave === BBTS_KEY) {
      bbts += 1;
      continue;
    }
    const info = jkeyMap.get(chave);
    let pid: string | null = null;
    if (info && info.key_type === "INDIVIDUAL") {
      pid = info.promoter_id;
    } else if (info && info.key_type === "MASTER") {
      pid = heir.get(`${r.company_id}|${contratoDe(r)}`) ?? null;
      if (pid) masterHerdadas += 1;
    }
    if (!pid) {
      semChave += 1; // sem chave individual nem herança master resolvível
      continue;
    }
    const comSeg =
      toNumber(readRawPayloadValue(r.metadata || {}, A_COMISSAO_SEGURO)) ||
      toNumber(r.commission_value);
    const a = getAgg(pid, r.company_id ?? null);
    a.seguroEmpresaAvulso += comSeg; // BRUTO — share individual aplicado no final
    total += comSeg;
    atribuidas += 1;
  }

  return { linhas: rows.length, atribuidas, master_herdadas: masterHerdadas, sem_chave: semChave, bbts, total };
}
