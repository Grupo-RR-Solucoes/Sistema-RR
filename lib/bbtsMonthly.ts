import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// bbtsMonthly — consolidação do PMR da ADS/BBTS a partir de daily_production_
// records (company ADS). Irmão de consolidateMonthlyFromClosing/Cms: mesma
// tabela promoter_monthly_results, mesmo upsert onConflict
// (promoter_id,year,month,company_id), source='bbts', company_id = ADS (NUNCA
// null). Lê só linhas com assigned_promoter_id preenchido (o balde sem promotor
// NÃO entra em ninguém).
//
// CRÉDITO: crédito total = gross_value (Valor Financiado) × %TRP(FAIXA 3). Teto
//   5,80% à vista: comissão-empresa que remunera o promotor = à-vista PÓS-teto;
//   o excedente vira DIFERIDO (100% empresa, promotor não recebe).
//   - REGRA DEFINITIVA: o %TRP vem SEMPRE da Promotiva via calcularOperacao (a MESMA
//     matriz/TRP do RR), para QUALQUER competência, sem exceção. O taxa_relatorio
//     (% do relatório/fechamento BBTS) NÃO entra na comissão — serve só p/ a SOBRA
//     DE CAIXA (diferença entre o que a BBTS pagou e a TRP). Ausência dele NÃO
//     bloqueia o cálculo (a TRP está na matriz, independe do PDF).
//   - FAIXA 3 herdada do GRUPO (aba Validador). Sem exceção por proposta: o motor
//     zera sozinho quem não remunera por prazo (ex: 36 parcelas -> %TRP 0).
//   - Exclui cancelamento (raw_payload.__bbts_meta.cancelado / status CANCELADO)
//     e SRCC restrita (is_srcc_restricted).
// SEGURO: régua BBTS = ESTOQUE D0 0,10% / SLIP 0,35% × insurance_value (Valor
//   Total do Crédito). Só linhas 'calculo' (as de 'debito' já ficaram fora na
//   carga BBTS-2b).
// COMISSÃO DO PROMOTOR = comissão-empresa × acordo (resolvePromoterShareSync).
//   NÃO decide meta nem faixa de penetração aqui — o orquestrador BBTS-2d injeta
//   via statusMetaByPromoter / seguroShareByPromoter. Ausentes => comportamento
//   provisório RR-only (acordo base/profile + escala de penetração da ADS), com
//   AVISO no retorno.
//
// LIMITAÇÃO DOCUMENTADA (a): a penetração do seguro no RR filtra por "Tipo de
// Liberação = 1". O fechamento BBTS (PDF) NÃO traz esse campo — aqui TODAS as
// linhas com seguro contam (sem filtro). Sinalizado em `avisos`.
// ============================================================================

import { getProductionPeriodFromValue, getProductionPeriodKey } from "./productionPeriod.ts";
import { calcularOperacao } from "./motor.ts";
import { fetchPromoterShareData, resolvePromoterShareSync } from "./proposalDetailing.ts";
import { individualPenetration, insuranceShareForPenetration } from "./insurancePenetration.ts";

export const BBTS_COMPANY_ID = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const SEGURO_RATE = { ESTOQUE: 0.001, SLIP: 0.0035 }; // 0,10% ESTOQUE D0 / 0,35% SLIP
const TETO_AVISTA = 0.058; // teto 5,80% à vista; excedente vira diferido (100% empresa)
// FAIXA 3 herdada do GRUPO (dado oficial da aba Validador da Promotiva, jun/2026).
// production_value >= 3.000.000 => FAIXA_3 (getProductionBandByValue). É a faixa
// do enquadramento; a meta CONSOLIDADA RR+ADS é outra coisa (BBTS-2d).
const FAIXA3_PRODUCTION = 3_000_000;

type SupabaseLike = SupabaseClient;

function toNumber(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function normText(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

function seguroRate(tipo: unknown): number {
  return normText(tipo).includes("SLIP") ? SEGURO_RATE.SLIP : SEGURO_RATE.ESTOQUE;
}

async function fetchAllPaged<T = any>(build: () => any): Promise<T[]> {
  let from = 0;
  const size = 1000;
  const all: T[] = [];
  while (true) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < size) break;
    from += size;
  }
  return all;
}

export type BbtsMonthlyRow = {
  promoter_id: string;
  promoter_name: string;
  producao_ads: number;
  credito_pct_efetivo: number; // Σ comissão-empresa-crédito / Σ gross (blended)
  comissao_empresa_credito: number;
  acordo: number; // 0..1
  comissao_promotor_credito: number;
  seguro_base: number;
  seguro_comissao_empresa: number;
  seguro_comissao_promotor: number;
  penetracao_ads: number; // 0..1
  final: number;
};

export async function consolidateMonthlyFromBbts(
  supabase: SupabaseLike,
  params: {
    year: number;
    month: number;
    dryRun?: boolean;
    // ===== INJEÇÕES DO ORQUESTRADOR (BBTS-2d) — produção CONSOLIDADA RR+ADS =====
    statusMetaByPromoter?: Map<string, string>; // meta conjunta -> target_status
    seguroShareByPromoter?: Map<string, number>; // penetração consolidada -> share seguro
    // volume consolidado p/ a escala ENTRANTE (sem ele, volume ADS-isolado dá 0%).
    volumeConsolidadoByPromoter?: Map<string, number>;
  }
) {
  const { year, month } = params;
  const dryRun = params.dryRun !== false; // default dry-run
  const compKey = getProductionPeriodKey(year, month);
  const avisos: string[] = [];

  // 1. Linhas ADS da competência, com promotor atribuído.
  const rows = await fetchAllPaged<any>(() =>
    supabase
      .from("daily_production_records")
      .select(
        "proposal_number, assigned_promoter_id, gross_value, net_value, insurance_value, insurance_type, interest_rate, term_months, convenio_code, product_description, product_code, movement_date, contract_date, proposal_date, status, is_srcc_restricted, raw_payload"
      )
      .eq("company_id", BBTS_COMPANY_ID)
  );

  const emCompetencia = rows.filter((r) => {
    const p =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    return p && getProductionPeriodKey(p.year, p.month) === compKey;
  });

  // 2. Agrega por promotor (exclui balde, cancelado, SRCC).
  type Agg = {
    prod: number;
    insuredProd: number;
    comEmpAvista: number; // à-vista PÓS-teto (base do repasse ao promotor)
    diferido: number; // excedente do teto — 100% empresa, promotor não recebe
    seguroBase: number;
    comEmpSeguro: number;
    count: number;
  };
  const agg = new Map<string, Agg>();
  const compDate = `${year}-${String(month).padStart(2, "0")}-15`; // competência p/ vigência TRP
  let ignoradasBalde = 0, ignoradasCancel = 0, ignoradasSrcc = 0;
  // Detalhe por proposta (conferência).
  const propostas: Array<{ contrato: string; vfin: number; juros: number; parc: number; conv: string; trp: number; avista: number; diferido: number; comEmpresa: number; promoter_id: string }> = [];

  for (const r of emCompetencia) {
    const pid = r.assigned_promoter_id as string | null;
    if (!pid) { ignoradasBalde += 1; continue; }
    const meta = (r.raw_payload && r.raw_payload.__bbts_meta) || {};
    if (meta.cancelado === true || normText(r.status) === "CANCELADO") { ignoradasCancel += 1; continue; }
    if (r.is_srcc_restricted === true) { ignoradasSrcc += 1; continue; }

    const gross = toNumber(r.gross_value);

    // CRÉDITO — SEMPRE a TRP Promotiva (a MESMA matriz do RR), para QUALQUER
    // competência, sem exceção. O taxa_relatorio (% do relatório/fechamento BBTS)
    // NÃO entra na comissão — serve só p/ a SOBRA DE CAIXA (fica em raw_payload/
    // __bbts_meta p/ um cálculo futuro), e a ausência dele NÃO bloqueia o cálculo.
    // FAIXA 3 (grupo); o motor zera sozinho quem não remunera por prazo (ex: 36
    // parcelas -> 0%). Só há crédito quando gross > 0 (linha só-seguro tem gross=0).
    let creditPercent = 0;
    if (gross > 0) {
      const op = {
        product_description: r.product_description ?? null,
        product_code: r.product_code ?? null,
        convenio_code: r.convenio_code ?? null,
        valor_liquido: gross,
        valor_bruto: gross,
        taxa_juros: toNumber(r.interest_rate),
        prazo: toNumber(r.term_months),
        contract_date: compDate, // competência decide a vigência da TRP
        movement_date: compDate,
        proposal_date: compDate,
        production_value: FAIXA3_PRODUCTION, // FAIXA 3 do grupo (Validador oficial)
        tem_seguro: false,
        valor_seguro: 0,
        company_cash_percent: null,
      };
      creditPercent = toNumber(calcularOperacao(op as any).credito.percentual);
    }

    // TETO 5,80% à vista; excedente = diferido (100% empresa). Comissão-empresa
    // que remunera o promotor = à-vista PÓS-teto.
    const avistaPercent = Math.min(creditPercent, TETO_AVISTA);
    const comEmpAvista = gross * avistaPercent;
    const diferido = gross * Math.max(creditPercent - avistaPercent, 0);

    // SEGURO — régua BBTS por tipo (ESTOQUE/SLIP) × base (insurance_value).
    const seguroBase = toNumber(r.insurance_value);
    const tipo = meta.seguro_tipo ?? r.insurance_type;
    const comEmpSeguro = seguroBase * seguroRate(tipo);

    const a = agg.get(pid) || { prod: 0, insuredProd: 0, comEmpAvista: 0, diferido: 0, seguroBase: 0, comEmpSeguro: 0, count: 0 };
    a.prod += gross;
    a.comEmpAvista += comEmpAvista;
    a.diferido += diferido;
    a.seguroBase += seguroBase;
    a.comEmpSeguro += comEmpSeguro;
    if (seguroBase > 0) a.insuredProd += gross; // (a) sem filtro Tipo de Liberação — todas contam
    a.count += 1;
    agg.set(pid, a);

    propostas.push({ contrato: String(r.proposal_number), vfin: gross, juros: toNumber(r.interest_rate), parc: toNumber(r.term_months), conv: String(r.convenio_code ?? ""), trp: creditPercent, avista: comEmpAvista, diferido, comEmpresa: comEmpAvista, promoter_id: pid });
  }

  if (params.statusMetaByPromoter === undefined && params.seguroShareByPromoter === undefined) {
    avisos.push("PROVISÓRIO: meta e faixa de seguro NÃO injetadas (BBTS-2d). acordo = base/profile; seguro promotor = escala de penetração da ADS. Rode via BBTS-2d p/ a meta conjunta RR+ADS.");
  }
  avisos.push("LIMITAÇÃO (a): sem 'Tipo de Liberação' no fechamento PDF — TODAS as linhas de seguro contam na penetração.");
  avisos.push(`Competência ${compKey}: crédito pela TRP Promotiva (matriz por competência), teto 5,80% x acordo. taxa_relatorio NÃO entra na comissão (só sobra de caixa).`);

  // 3. Acordo (cascata) + escala de seguro. ESCOPO = só a ADS (a produção/volume
  //    da escala do promotor não pode misturar RR — o BBTS-2d é quem injeta a
  //    meta/penetração CONSOLIDADA RR+ADS).
  const promoterIds = [...agg.keys()];
  const share = await fetchPromoterShareData(supabase, promoterIds, year, month, [BBTS_COMPANY_ID]);
  const nameById = new Map<string, string>();
  {
    const proms = await fetchAllPaged<any>(() => supabase.from("promoters").select("id, name").in("id", promoterIds.length ? promoterIds : ["00000000-0000-0000-0000-000000000000"]));
    for (const p of proms) nameById.set(p.id, p.name);
  }

  function acordoDe(pid: string): number {
    // ENTRANTE usa o VOLUME: consolidado (RR+ADS) quando o orquestrador injeta;
    // senão o ADS-isolado (que dá 0% p/ quem tem volume baixo — provisório).
    // frenteC null (BBTS crédito INSS < 5,80%, fora da escala de meta).
    const volume =
      params.volumeConsolidadoByPromoter?.get(pid) ?? share.monthlyVolumesMap.get(pid) ?? 0;
    const res = resolvePromoterShareSync({
      record: { assigned_promoter_id: pid, share_percent_override: null },
      profilesMap: share.profilesMap,
      scalesMap: share.scalesMap,
      monthlyVolumesMap: new Map([[pid, volume]]),
      frenteC: null,
    });
    return Math.min(Math.max(Number(res.sharePercent) || 0, 0), 1);
  }

  const nowIso = new Date().toISOString();
  const table: BbtsMonthlyRow[] = [];
  const upserts: any[] = [];

  for (const [pid, a] of agg) {
    const acordo = acordoDe(pid);
    // Penetração individual (base LÍQUIDA; na ADS net==gross=Valor Financiado);
    // cortes oficiais via lib única. O BBTS-2d injeta o share (penetração
    // CONSOLIDADA RR+ADS); ausente => individual da própria ADS.
    const penetracao = individualPenetration(a.insuredProd, a.prod);
    const seguroShare =
      params.seguroShareByPromoter?.get(pid) ?? insuranceShareForPenetration(penetracao);

    const comPromotorCredito = a.comEmpAvista * acordo;
    const comPromotorSeguro = a.comEmpSeguro * seguroShare;
    const final = comPromotorCredito + comPromotorSeguro;

    table.push({
      promoter_id: pid,
      promoter_name: nameById.get(pid) ?? "(desconhecido)",
      producao_ads: a.prod,
      credito_pct_efetivo: a.prod > 0 ? a.comEmpAvista / a.prod : 0,
      comissao_empresa_credito: a.comEmpAvista,
      acordo,
      comissao_promotor_credito: comPromotorCredito,
      seguro_base: a.seguroBase,
      seguro_comissao_empresa: a.comEmpSeguro,
      seguro_comissao_promotor: comPromotorSeguro,
      penetracao_ads: penetracao,
      final,
    });

    upserts.push({
      promoter_id: pid,
      company_id: BBTS_COMPANY_ID, // NUNCA null
      year,
      month,
      production_value: a.prod,
      proposal_count: a.count,
      insured_proposal_count: 0, // BBTS não distingue contagem de segurados por contrato aqui
      insured_production_value: a.insuredProd,
      insurance_penetration_percent: penetracao * 100,
      target_value: 0,
      target_1_value: 0,
      target_2_value: 0,
      projected_production_value: a.prod,
      production_commission_value: comPromotorCredito,
      insurance_commission_value: comPromotorSeguro,
      agreement_adjustment_value: 0,
      discount_value: 0,
      final_commission_value: final,
      target_status: params.statusMetaByPromoter?.get(pid) ?? "BELOW_META",
      source: "bbts",
      calculated_at: nowIso,
    });
  }

  if (!dryRun && upserts.length > 0) {
    const { error } = await supabase
      .from("promoter_monthly_results")
      .upsert(upserts, { onConflict: "promoter_id,year,month,company_id" });
    if (error) throw error;
  }

  table.sort((x, y) => y.final - x.final);
  propostas.sort((a, b) => b.vfin - a.vfin);
  return {
    dry_run: dryRun,
    competencia: compKey,
    linhas_competencia: emCompetencia.length,
    promotores: table.length,
    ignoradas: { balde: ignoradasBalde, cancelada: ignoradasCancel, srcc: ignoradasSrcc },
    gravadas: dryRun ? 0 : upserts.length,
    avisos,
    propostas, // detalhe por proposta (conferência)
    table,
  };
}
