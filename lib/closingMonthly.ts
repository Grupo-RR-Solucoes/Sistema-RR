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
//   seguro   : Σ(COMISSÃO SEGURO) × escala de penetração, somando DUAS fontes com
//              a MESMA régua — (a) o seguro EMBUTIDO nas linhas CASH e (b) a aba
//              avulsa INSURANCE/"A Vista" (tem CHAVE J, COMISSÃO SEGURO e %
//              PENETRAÇÃO). O avulso é atribuído por CHAVE J individual ou por
//              herança master (contrato → diário). Linhas avulsas SEM chave J
//              ficam de fora (logadas).
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
  fetchInsuranceSlipTiers,
  lookupInsuranceShareFromPenetration,
} from "./insuranceCalculator.ts";

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
  net: number; // Σ valorLiquido (produção do fechamento)
  count: number;
  avista: number; // Σ COMISSÃO PF × acordo (com Frente C)
  seguroEmpresa: number; // Σ COMISSÃO SEGURO EMBUTIDO no CASH (escala aplicada depois, via maxPen)
  seguroAvulso: number; // seguro da aba INSURANCE/"A Vista", escala JÁ aplicada por linha
  maxPen: number | null; // maior % penetração do promotor no fechamento
  insuredCount: number;
  insuredNet: number;
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
  }
) {
  const { year, month } = params;
  const companyId = params.companyId ?? null;
  const promoterId = params.promoterId ?? null;

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
  const share = await fetchPromoterShareData(supabase, efetivos, year, month);
  const tiers = await fetchInsuranceSlipTiers(supabase as any);

  // Nomes p/ carve-out Aldalene INSS.
  const nameById = new Map<string, string>();
  {
    const proms = await fetchAllPaged<any>(() =>
      supabase.from("promoters").select("id, name")
    );
    for (const p of proms) nameById.set(p.id, p.name);
  }

  // acordo POR CONTRATO — Frente C aplica na faixa 5,80% (escala de repasse) e o
  // acordo base (profile/default) fora dela. isAldaleneInss usa nome + produto.
  function acordoDoContrato(pid: string, c: ClosingContrato): number {
    const tgt = share.targetsMap.get(pid);
    const res = resolvePromoterShareSync({
      record: { assigned_promoter_id: pid, share_percent_override: null },
      profilesMap: share.profilesMap,
      scalesMap: share.scalesMap,
      monthlyVolumesMap: share.monthlyVolumesMap,
      frenteC: {
        goalRepasse: share.goalRepasseMap.get(pid) ?? null,
        productionValue: share.frenteCProductionMap.get(pid) ?? 0,
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
        count: 0,
        avista: 0,
        seguroEmpresa: 0,
        seguroAvulso: 0,
        maxPen: null,
        insuredCount: 0,
        insuredNet: 0,
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
    a.seguroEmpresa += c.comissaoSeguro;
    a.net += c.valorLiquido;
    a.count += 1;
    if (c.comissaoSeguro > 0 || c.valorSeguro > 0) {
      a.insuredCount += 1;
      a.insuredNet += c.valorLiquido;
    }
    if (c.penetracao != null && (a.maxPen == null || c.penetracao > a.maxPen)) {
      a.maxPen = c.penetracao;
    }
  }

  // 5b. Seguro AVULSO — aba INSURANCE/"A Vista" (194 linhas em jun/2026). Mesma
  //     escala de penetração do embutido; atribuição por CHAVE J individual ou
  //     herança master (contrato → daily.proposal_number). Sem chave => fora.
  //     Exclui BBTS (JJ552710). NÃO confundir com INSURANCE/"Seguro" (estornos,
  //     sem chave J) — essa segue como pendência documentada no cabeçalho.
  const insDiag = await addSeguroAvulso(
    supabase,
    { year, month, companyId },
    tiers,
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
    production_commission_value: number;
    insurance_commission_value: number;
    final_commission_value: number;
    source: string;
  }> = [];

  const nowIso = new Date().toISOString();
  for (const [pid, a] of agg) {
    if (promoterId && pid !== promoterId) continue;

    const insuranceShare = lookupInsuranceShareFromPenetration(
      tiers,
      a.maxPen ?? 0
    );
    const productionCommission = a.avista;
    // seguro = embutido (Σ COMISSÃO SEGURO do CASH × escala do maxPen) + avulso
    // (INSURANCE/"A Vista", escala já aplicada por linha em addSeguroAvulso).
    const insuranceCommission = a.seguroEmpresa * insuranceShare + a.seguroAvulso;
    const finalCommission = productionCommission + insuranceCommission;

    const t = targetByPromoter.get(pid);
    const targetValue = t ? toNumber(t.meta) : 0;
    const target1Value = t ? toNumber(t.meta_1) : 0;
    const target2Value = t ? toNumber(t.meta_2) : 0;
    const penetrationPct = a.maxPen != null ? a.maxPen * 100 : 0;

    upserts.push({
      promoter_id: pid,
      company_id: a.companyId ?? null,
      year,
      month,
      production_value: a.net,
      proposal_count: a.count,
      insured_proposal_count: a.insuredCount,
      insured_production_value: a.insuredNet,
      insurance_penetration_percent: penetrationPct,
      target_value: targetValue,
      target_1_value: target1Value,
      target_2_value: target2Value,
      projected_production_value: a.net, // mês fechado: sem projeção diária
      production_commission_value: productionCommission,
      insurance_commission_value: insuranceCommission,
      agreement_adjustment_value: 0,
      discount_value: 0,
      final_commission_value: finalCommission,
      target_status: resolveTargetStatus(a.net, targetValue, target1Value, target2Value),
      source: "fechamento",
      calculated_at: nowIso,
    });

    table.push({
      promoter_id: pid,
      promoter_name: nameById.get(pid) ?? "(promotor desconhecido)",
      production_commission_value: productionCommission,
      insurance_commission_value: insuranceCommission,
      final_commission_value: finalCommission,
      source: "fechamento",
    });
  }

  if (upserts.length > 0) {
    const { error } = await supabase
      .from("promoter_monthly_results")
      .upsert(upserts, { onConflict: "promoter_id,year,month,company_id" });
    if (error) throw error;
  }

  table.sort(
    (x, y) => y.final_commission_value - x.final_commission_value
  );

  return {
    promoters_calculated: upserts.length,
    table,
    // Diagnóstico / UI futura.
    contratos_processados: contratos.length,
    contratos_herdados: orphans.filter((c) => (c as any).__pid).length,
    orfaos_sem_dono: orfaosSemDono,
    restritas, // SRCC="Sim": fora do valor, para a UI listar depois.
    bbts_excluidos: base.contratos.length - contratos.length,
    seguro_avulso: insDiag, // { linhas, atribuidas, master_herdadas, sem_chave, bbts, total }
  };
}

// Aliases das colunas do metadata das linhas de seguro (readRawPayloadValue já
// normaliza acento/caixa e apara espaços — cobre "COMISSÃO SEGURO", " % PENETRAÇÃO ").
const A_CHAVE_J = ["CHAVE J", "LOGIN", "USUARIO"];
const A_COMISSAO_SEGURO = ["COMISSAO SEGURO", "COMISSÃO SEGURO"];
const A_PENETRACAO = ["% PENETRACAO", "% PENETRAÇÃO", "PENETRACAO", "PENETRAÇÃO"];
const A_CONTRATO = ["CONTRATO", "NUMERO CONTRATO", "NÚMERO CONTRATO"];

/**
 * Soma ao seguro de cada promotor o AVULSO da aba INSURANCE/"A Vista", pela MESMA
 * escala de penetração do embutido. Atribui por CHAVE J (INDIVIDUAL) ou por
 * herança master (contrato → daily.proposal_number, mesma empresa, competência).
 * Linhas sem chave resolvível ficam fora (contabilizadas). Exclui BBTS. Muta o
 * agregado via getAgg (cria entrada nova se o promotor só tiver seguro avulso).
 */
async function addSeguroAvulso(
  supabase: SupabaseLike,
  params: { year: number; month: number; companyId: string | null },
  tiers: Awaited<ReturnType<typeof fetchInsuranceSlipTiers>>,
  getAgg: (pid: string, companyId: string | null) => ClosingAgg
): Promise<{
  linhas: number;
  atribuidas: number;
  master_herdadas: number;
  sem_chave: number;
  bbts: number;
  total: number;
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
    const pen = toNumber(readRawPayloadValue(r.metadata || {}, A_PENETRACAO));
    const valor = comSeg * lookupInsuranceShareFromPenetration(tiers, pen);
    const a = getAgg(pid, r.company_id ?? null);
    a.seguroAvulso += valor;
    total += valor;
    atribuidas += 1;
  }

  return { linhas: rows.length, atribuidas, master_herdadas: masterHerdadas, sem_chave: semChave, bbts, total };
}
