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
import { buildDonoDoDiarioMap, resolvePromotorEfetivo } from "./herancaMaster.ts";
import { lerReguaPisoVigente, resolverPiso } from "./pisoProducao.ts";
import { consolidateMonthlyFromClosing } from "./closingMonthly.ts";
import { consolidateMonthlyFromBbts, BBTS_COMPANY_ID } from "./bbtsMonthly.ts";
import {
  consolidatedInsuranceShare,
  primeInsuranceShareTiers,
} from "./insurancePenetration.ts";
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

  // ------------------------------------------------------------------
  // OS 4 CAMPOS DE DINHEIRO SAO REPASSE AO PROMOTOR. NENHUM E COMISSAO-EMPRESA.
  // ------------------------------------------------------------------
  // Os nomes antigos — "credito" e "seguro" com sufixo _rr, sem prefixo algum —
  // enganaram de verdade em 01/08/2026: levaram a hipotese de que o volume do
  // promotor estava acoplado a comissao da EMPRESA, acoplamento que nao existe.
  // O prefixo `repasse_` esta aqui para que o proximo nao repita a viagem.
  //
  // NOS QUATRO o valor JA CARREGA o share do promotor aplicado; a
  // comissao-empresa e apenas o MULTIPLICANDO. Por isso os quatro dizem
  // `repasse_`: dentro deste tipo o nome da FONTE nao aparece, entao um unico
  // campo sem o prefixo, ao lado de tres com, seria lido como "este aqui e o
  // da empresa" — exatamente pelo contraste.
  //
  //   repasse_credito_rr   = production_commission_value do fechamento RR
  //                          closingMonthly.ts:477 -> :454 -> :392
  //                          `a.avista += c.comissaoEmpresaAvista * acordoDoContrato(pid, c)`
  //                          (acordoDoContrato, :340-358, consome monthlyVolumesMap
  //                          [degrau ENTRANTE] e frenteC.productionValue)
  //
  //   repasse_seguro_rr    = insurance_commission_value do fechamento RR
  //                          closingMonthly.ts:478 -> :455
  //                          `insuranceCommission = seguroEmpresa * seguroShare`
  //
  //   repasse_credito_ads  = comissao_promotor_credito, bbtsMonthly.ts:347
  //   repasse_seguro_ads   = seguro_comissao_promotor,  bbtsMonthly.ts:350
  //
  // A comissao-EMPRESA de seguro existe e tem outro nome: `seguro_empresa`
  // em closingMonthly.ts:436/:501, comentada la como "(embutido + avulso),
  // BRUTA". Ela NAO e exposta neste GroupRow.
  repasse_credito_rr: number;
  repasse_credito_ads: number;
  repasse_seguro_rr: number;
  repasse_seguro_ads: number;
};

export async function consolidateMonthlyGroup(
  supabase: SupabaseLike,
  params: { year: number; month: number; dryRun?: boolean }
) {
  const { year, month } = params;
  const dryRun = params.dryRun !== false; // default dry-run

  // Escala de seguro: fonte canônica é a TABELA (share_scale SEGURO_SLIP).
  // Prime ANTES de qualquer insuranceShareForPenetration; sem isto o resolvedor
  // cai na REDE (literal) silenciosamente.
  await primeInsuranceShareTiers(supabase as unknown as SupabaseClient);

  // ---- A. Soma RR (fechamento CASH, excl SRCC/BBTS, promotor efetivo) ----
  const base = await loadClosingPromoterBase(supabase, { year, month });
  const contratos = base.contratos.filter((c) => normKey(c.chaveJ) !== BBTS_KEY);
  // O DIÁRIO manda: `assigned_promoter_id` honra a reatribuição manual; a chave J
  // fica no dono ORIGINAL e serve de fallback. Mapa sobre TODAS as linhas — não só
  // as órfãs de chave master, que era o recorte que desfazia a reatribuição.
  // Fonte única da precedência: lib/herancaMaster.ts (mesmo helper do PMR).
  const dono = await buildDonoDoDiarioMap(supabase, contratos, year, month);
  const rr = new Map<string, { net: number; liqSeg: number }>();
  for (const c of contratos) {
    const pid = resolvePromotorEfetivo(
      { promoterIdDaChave: c.promoterId, contrato: c.contrato, companyId: c.companyId },
      dono
    );
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
    // Faixa pela penetração CONSOLIDADA (RR + ADS). A conta vive em
    // lib/insurancePenetration (consolidatedInsuranceShare) — a MESMA função que
    // o render da /promotores usa, para não haver duas regras de faixa.
    const { penetracao: pen, share } = consolidatedInsuranceShare({
      seguradoRR: r.liqSeg,
      totalRR: r.net,
      seguradoADS: a.liqSeg,
      totalADS: a.prod,
    });
    const t = targetById.get(pid);
    const status = resolveTargetStatus(prodTotal, Number(t?.meta || 0), Number(t?.meta_1 || 0), Number(t?.meta_2 || 0));
    statusMetaByPromoter.set(pid, status);
    seguroShareByPromoter.set(pid, share);
    volumeConsolidadoByPromoter.set(pid, volTotal);
    prodConsolidadoByPromoter.set(pid, prodTotal);
    consolid.set(pid, { prodRR, prodADS, prodTotal, pen, share, status });
  }

  // ---- F. PISO DE PRODUCAO PARA O REPASSE ----
  // ESTE E O UNICO PONTO DO SISTEMA QUE AVALIA A REGRA DO PISO. Ele existe aqui, e
  // nao dentro dos consolidadores, porque so aqui a producao CONSOLIDADA RR+ADS
  // existe para as duas empresas ao mesmo tempo — em closingMonthly as injecoes
  // sao opcionais e o fallback RR-puro zeraria quem produziu na ADS.
  //
  // Os consolidadores recebem FATORES (0|1), nunca a regra: eles nao sabem o piso,
  // nem a base, nem quem e alcancado — exatamente como ja recebem
  // seguroShareByPromoter sem saber o que e penetracao consolidada.
  //
  // POR QUE NAO ZERAR seguroShareByPromoter: funcionaria (o `??` preserva 0), mas
  // seguro_share e exibido como FAIXA DE PENETRACAO (closingMonthly:465, :245
  // abaixo). Faixa e piso sao duas regras; na mesma variavel, uma esconde a outra.
  //
  // UNIVERSO = pids UNIAO alcancados. Quem tem so seguro avulso nao entra em
  // `pids` (:170, alimentado por contratos) mas entra no agregado do
  // closingMonthly via addSeguroAvulso — sem a uniao, passaria batido pelo piso.
  const alcancadosPiso = (await lerReguaPisoVigente(supabase, { year, month })).regua?.promoterIds ?? [];
  const universoPiso = [...new Set([...pids, ...alcancadosPiso])];
  const planoPiso = await resolverPiso(supabase, {
    year,
    month,
    producoes: universoPiso.map((pid) => {
      const r = rr.get(pid) || { net: 0, liqSeg: 0 };
      const a = ads.get(pid) || { prod: 0, liqSeg: 0 };
      return {
        promoterId: pid,
        // Base FECHAMENTO = o que vira production_value nas duas linhas do PMR.
        fechamento: r.net + a.prod,
        // Base DIARIO = producao valida na janela (a mesma da Frente C).
        diario: (shareRR.frenteCProductionMap.get(pid) ?? 0) + (shareADS.frenteCProductionMap.get(pid) ?? 0),
      };
    }),
  });

  const inject = {
    statusMetaByPromoter,
    seguroShareByPromoter,
    volumeConsolidadoByPromoter,
    prodConsolidadoByPromoter,
    fatorCreditoByPromoter: planoPiso.fatorCreditoByPromoter,
    fatorSeguroByPromoter: planoPiso.fatorSeguroByPromoter,
  };

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
      repasse_credito_rr: rrr?.production_commission_value ?? 0,
      repasse_credito_ads: ar?.comissao_promotor_credito ?? 0,
      repasse_seguro_rr: rrr?.insurance_commission_value ?? 0,
      repasse_seguro_ads: ar?.seguro_comissao_promotor ?? 0,
    });
  }
  rows.sort((x, y) => y.prod_total - x.prod_total);

  return {
    dry_run: dryRun,
    promotores: pids.length,
    // PISO — o veredicto por alcancado, com o numero que decidiu. E o que o
    // dry-run mostra e o que o gate compara; sem isto, "final = 0" seria
    // indistinguivel de "nao produziu".
    piso: {
      regua_id: planoPiso.regua?.id ?? null,
      piso: planoPiso.regua?.piso ?? null,
      base_calculo: planoPiso.regua?.baseCalculo ?? null,
      zera: planoPiso.regua?.zera ?? [],
      veredictos: planoPiso.veredictos,
      // Frente C: o mapa segue mesmo quando `zera` nao inclui PRODUTO (fator 1).
      fator_produto_by_promoter: planoPiso.fatorProdutoByPromoter,
      avisos: planoPiso.avisos,
    },
    // Uniao do payload das DUAS linhas (RR + ADS) — o conjunto que DEFINE o PMR
    // fechado da competencia. A reconciliacao apaga o que sobrar fora daqui.
    payload: [...(rrRes.payload ?? []), ...(adsRes.payload ?? [])] as any[],
    rows,
    totals: {
      repasse_credito_rr: rows.reduce((s, r) => s + r.repasse_credito_rr, 0),
      repasse_credito_ads: rows.reduce((s, r) => s + r.repasse_credito_ads, 0),
      repasse_seguro_rr: rows.reduce((s, r) => s + r.repasse_seguro_rr, 0),
      repasse_seguro_ads: rows.reduce((s, r) => s + r.repasse_seguro_ads, 0),
    },
    rr_gravadas: rrRes.gravadas ?? 0,
    ads_gravadas: adsRes.gravadas ?? 0,
    // DETALHE POR PROPOSTA DA ADS — aditivo, nao muda nada do que ja existia.
    //
    // POR QUE SAI DAQUI E NAO E RECALCULADO PELO CHAMADOR. A /promotores precisa
    // exibir a comissao do promotor POR LINHA na ADS, e no mes ABERTO nao ha de
    // onde ler: a coluna do diario nunca e escrita (calculate/monthly exclui a ADS
    // pela trava semAds) e o PMR e ignorado no aberto (promoterAnalytics:1079).
    // Reproduzir a regra na tela seria reimplementar dinheiro — o erro que esta
    // base ja pagou caro. Entao o detalhe vem da MESMA passada que produz o PMR.
    //
    // A IDENTIDADE QUE TORNA ISTO EXATO: em bbtsMonthly:336 o repasse e
    // `comPromotorCredito = comEmpAvista * acordo`, com o `acordo` UNIFORME por
    // promotor. Logo, por linha, `comEmpresa_linha * acordo` e exato — nao e
    // rateio aproximado, e a decomposicao da propria soma. Somar as linhas de um
    // promotor devolve, ao centavo, o `comissao_promotor_credito` do PMR.
    ads_detalhe: {
      // uma entrada por proposta: { contrato, comEmpresa, promoter_id, ... }
      propostas: adsRes.propostas ?? [],
      // uma entrada por promotor, com o `acordo` (share) que fecha a identidade
      table: adsRes.table ?? [],
    },
  };
}
