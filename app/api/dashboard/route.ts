import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import {
  calcularDelta,
  competenciaAnterior,
  deltaDaSerie,
  type PontoSerie,
} from "@/lib/delta/calcularDelta";
import { buildClosingAnalytics } from "@/lib/closingAnalytics";
import { detectMonthRegime, type MonthRegime } from "@/lib/cmsMonthly";
import { calcularRbt12 } from "@/lib/rbt12";
import { buildProjecaoMetas, consolidarGrupo, consolidarGrupoEquipe } from "@/lib/projecaoMetas";
import { nowInFortaleza } from "@/lib/dateFortaleza";
import { buildPromoterAnalytics } from "@/lib/promoterAnalytics";
import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import { fetchAllRows } from "@/lib/queryHelpers";
import {
  fetchInsuranceSlipRules,
  calculateInsuranceCommissionFromRules,
} from "@/lib/insuranceCalculator";
import { getPrazoTrp } from "@/lib/prazoTrp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// DASHBOARD (Visão geral) — REDESENHO Etapa 8. Payload enxuto, cada número uma vez.
// socio-only (withSocioAnon). READ-ONLY.
//   - Produção mensal do grupo = promoter_monthly_results.production_value somado
//     por mês (NÃO daily_production_records, que só tem abr/jun em 2026). jun é o
//     mês CORRENTE = PARCIAL (poucos dias úteis), marcado como tal.
//   - Previsão de receita = closingAnalytics expectedTotal (ESTIMADO, rotulado).
//   - Simples por CNPJ + limite do grupo = calcularRbt12.
//   - Alerta de projeção = buildProjecaoMetas/consolidarGrupo (mês corrente, aberto;
//     detectClosedMonth=false aqui é correto). Só aparece se houver risco.
// ============================================================

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function toNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
// "RR ALAGOAS 1" -> "RR Alagoas 1" (mantém sigla RR, capitaliza o resto). Nome
// padronizado e consistente em toda a tela (vem de companies via calcularRbt12).
function displayCompany(name: string) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.toUpperCase() === "RR" ? "RR" : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

type PmrRow = {
  year: number;
  month: number;
  production_value: number | null;
  insured_production_value: number | null;
};

type DailyUnassignedRow = {
  company_id: string | null;
  status: string | null;
  is_srcc_restricted: boolean | null;
  net_value: number | null;
  movement_date: string | null;
  cancellation_date: string | null;
  // Seguro do MASTER (não atribuído): o registro NÃO tem insurance_commission_amount
  // precomputado, então recalculamos pelo caminho DB-driven (insuranceCalculator
  // + insurance_slip_rules), NUNCA pelo legado motor/getInsurancePercentByTerm.
  gross_value: number | null;
  insurance_value: number | null;
  insurance_type: string | null;
  has_insurance: boolean | null;
  term_months: number | null;
  installments: number | null;
  contract_date: string | null;
  product_code: string | number | null;
  raw_payload: Record<string, unknown> | null;
};

// Mesma regra de validade/produção do motor (app/api/calculate/monthly/route.ts):
// PRODUCAO + não cancelado/pendente/SRCC-restrito. Usada só para somar a
// produção em chave MASTER ainda não redistribuída (assigned_promoter_id null),
// que o PMR não contabiliza. SRCC "consulta não realizada" NÃO é
// is_srcc_restricted, então continua contando (decisão Diego).
function normStatus(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}
function isProductionStatus(status: unknown) {
  const s = normStatus(status);
  return s === "PRODUCAO" || s === "PRODUCTION";
}
function isCancelledStatus(status: unknown) {
  const s = normStatus(status);
  return s.includes("CANCEL") || s.includes("ESTORN") || s.includes("RECUS");
}
function isPendingStatus(status: unknown) {
  const s = normStatus(status);
  return s.includes("PEND") || s.includes("ANALIS") || s.includes("PROCESS");
}
function isValidDailyRecord(r: DailyUnassignedRow) {
  if (r.cancellation_date) return false;
  if (isCancelledStatus(r.status)) return false;
  if (isPendingStatus(r.status)) return false;
  if (r.is_srcc_restricted === true) return false;
  return true;
}

// ---------------------------------------------------------------------------
// DELTA vs mes anterior — leitores de competencia FECHADA.
//
// Existem como funcao (e nao inline, como estavam) exatamente para que as DUAS
// pontas do delta leiam pela MESMA definicao de metrica. E a contrapartida, do
// lado da fonte, da REGRA DE OURO de lib/delta/calcularDelta: o helper garante
// que a conta e unica; estas funcoes garantem que o que entra na conta e a
// mesma coisa nos dois meses. Se a fonte da comissao-empresa mudar um dia,
// muda aqui e as duas pontas mudam juntas — nao ha como uma so.
// ---------------------------------------------------------------------------

/**
 * Comissao-EMPRESA de credito a vista de uma competencia FECHADA.
 * Split de regime identico ao que o mes corrente ja usava:
 *   cms (jan-mai)      -> Sigma cms_promoter_entries.company_commission
 *   fechamento (jun+)  -> Sigma fechamento_mensal_empresa.valor_avista
 */
async function lerComissaoEmpresaCreditoFechada(
  supabase: SupabaseClient,
  regime: "cms" | "fechamento",
  year: number,
  month: number
): Promise<number> {
  if (regime === "cms") {
    const entries = await fetchAllRows<{ company_commission: number | null }>(() =>
      supabase
        .from("cms_promoter_entries")
        .select("company_commission")
        .eq("prod_year", year)
        .eq("prod_month", month)
    );
    return roundMoney(entries.reduce((sum, r) => sum + toNumber(r.company_commission), 0));
  }
  const fechAvista = await fetchAllRows<{ valor_avista: number | null }>(() =>
    supabase
      .from("fechamento_mensal_empresa")
      .select("valor_avista")
      .eq("ano", year)
      .eq("mes", month)
  );
  return roundMoney(fechAvista.reduce((sum, r) => sum + toNumber(r.valor_avista), 0));
}

/**
 * Comissao-EMPRESA de seguro de uma competencia FECHADA. Fonte unica para os
 * DOIS regimes fechados (fechamento_mensal_empresa.valor_seguro) — a mesma do
 * financeiro/DRE. NAO e o share do promotor (cms.promoter_insurance), que e a
 * camada de repasse e nao o ganho da empresa.
 */
async function lerSeguroEmpresaFechada(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<number> {
  const fechSeguro = await fetchAllRows<{ valor_seguro: number | null }>(() =>
    supabase
      .from("fechamento_mensal_empresa")
      .select("valor_seguro")
      .eq("ano", year)
      .eq("mes", month)
  );
  return roundMoney(fechSeguro.reduce((sum, r) => sum + toNumber(r.valor_seguro), 0));
}

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioAnon();

    // Competência corrente no fuso America/Fortaleza, NÃO UTC: às 21h BRT o mês
    // já virava o seguinte em UTC, roteando a competência cedo demais (ex.: 30/06
    // 21h → julho). Assim, 30/06 resolve para JUNHO. O rótulo do header
    // ("<mês>/<ano> · produção corrente") deriva de periodoLabel = MES[month-1]/year,
    // então passa a exibir jun/2026 automaticamente.
    //
    // MOV 2 (A): a competência agora vem da QUERY (?year&month) — antes o dashboard
    // era preso ao mês corrente e NUNCA renderizava um mês fechado, o que deixava o
    // ramo de mês fechado abaixo como código morto. Sem query, o default é o mês
    // corrente: o comportamento de hoje fica idêntico.
    const url = new URL(req.url);
    const agora = nowInFortaleza();
    const qYear = Number(url.searchParams.get("year") || 0);
    const qMonth = Number(url.searchParams.get("month") || 0);
    const year = qYear >= 2000 && qYear <= 2999 ? qYear : agora.year;
    const month = qMonth >= 1 && qMonth <= 12 ? qMonth : agora.month;

    // REGIME (enum canônico), não o booleano colapsado. Aqui a pergunta é de FONTE
    // (3 respostas: cms / fechamento / open), não "está aberto?". O booleano
    // detectClosedMonth mandava o mês 'fechamento' (jun+) ler cms_promoter_entries,
    // que NÃO tem jun+ — a comissão-empresa e a penetração vinham 0.
    //
    // closedSource: EXATAMENTE o padrão de /api/promotores/route.ts:158 — o analytics
    // monta consolidatedSummaryRows filtrando source IN ('cms') ou ('fechamento','bbts').
    // O dashboard passa a ler o PMR fechado PELO MESMO caminho (summaryRows), em vez
    // de consultar o cms por conta própria. Assim as duas telas leem a mesma coisa.
    const regime = await detectMonthRegime(supabase, year, month).catch(
      () => "open" as MonthRegime
    );
    const monthClosed = regime !== "open";
    const closedSource = regime === "open" ? undefined : regime;

    const [
      pmrRows,
      closingPayload,
      rbt12,
      projecaoRes,
      promoterAnalytics,
      activeCompanies,
      dailyUnassigned,
      insuranceSlipRules,
    ] = await Promise.all([
        fetchAllRows<PmrRow>(() =>
          supabase
            .from("promoter_monthly_results")
            .select("year, month, production_value, insured_production_value")
        ),
        buildClosingAnalytics(supabase, { fastDashboardMode: true }),
        calcularRbt12(supabase, { ano: year, mes: month }),
        buildProjecaoMetas(supabase, { year, month }),
        // motor: comissão bruta/seguro do grupo no mês corrente. closed=monthClosed
        // → mês ABERTO usa LIVE_BASE (daily ao vivo), alinhado à projeção.
        buildPromoterAnalytics(supabase, { year, month, closed: monthClosed, closedSource }),
        // CNPJs do grupo (4 ativas) — para somar só produção do grupo.
        fetchAllRows<{ id: string }>(() =>
          supabase.from("companies").select("id").eq("active", true)
        ),
        // Produção em chave MASTER ainda sem promotor (assigned_promoter_id
        // null). Janela ampla por movement_date cobre a vigência de jan..dez
        // do ano corrente; a competência é resolvida em getProductionPeriodFromValue.
        fetchAllRows<DailyUnassignedRow>(() =>
          supabase
            .from("daily_production_records")
            .select(
              "company_id, status, is_srcc_restricted, net_value, movement_date, cancellation_date, gross_value, insurance_value, insurance_type, has_insurance, term_months, installments, contract_date, product_code, raw_payload"
            )
            .is("assigned_promoter_id", null)
            .gte("movement_date", `${year - 1}-12-15`)
            .lt("movement_date", `${year + 1}-01-10`)
        ),
        fetchInsuranceSlipRules(supabase),
      ]);

    // ---- produção mensal do grupo (ano corrente) ----
    // Atribuído (PMR) por mês.
    const byMonth = new Map<number, number>();
    for (const r of pmrRows) {
      if (r.year !== year) continue;
      byMonth.set(r.month, toNumber(byMonth.get(r.month)) + toNumber(r.production_value));
    }

    // Produção em chave MASTER ainda não redistribuída (assigned_promoter_id
    // null): o PMR/detalhamento por promotor não a contabiliza. Somamos aqui
    // para o KPI e o gráfico refletirem a produção TOTAL nível-empresa do
    // grupo, coerente com o portal. Em meses FECHADOS isto é 0 (o cms já
    // atribuiu tudo); só o mês ABERTO tem master pendente. Cada registro vai
    // para a competência da sua janela de vigência (mesma do motor).
    const activeIds = new Set((activeCompanies || []).map((c) => c.id));
    const unassignedByMonth = new Map<number, number>();
    const unassignedCountByMonth = new Map<number, number>();
    for (const r of dailyUnassigned || []) {
      if (!r.company_id || !activeIds.has(r.company_id)) continue;
      if (!isProductionStatus(r.status)) continue;
      if (!isValidDailyRecord(r)) continue;
      const period = getProductionPeriodFromValue(r.movement_date);
      if (!period || period.year !== year) continue;
      unassignedByMonth.set(
        period.month,
        toNumber(unassignedByMonth.get(period.month)) + toNumber(r.net_value)
      );
      unassignedCountByMonth.set(
        period.month,
        (unassignedCountByMonth.get(period.month) || 0) + 1
      );
    }

    // Produção do grupo do mês CORRENTE: mês ABERTO usa a MESMA fonte da tela
    // Projeção (consolidarGrupoEquipe = atribuído + master, "bate ao centavo com
    // Produção do grupo"). Ela recorta por vigência + refDate, então dá R$ 0
    // quando nada foi importado na janela — eliminando o fallback silencioso de
    // período do buildPromoterAnalytics (summaryRows caía em periods[0] = último
    // mês com dados e rotulava errado). Mês FECHADO mantém o PMR/cms (byMonth +
    // master do daily), comportamento inalterado.
    const consEquipe = consolidarGrupoEquipe(projecaoRes);
    const producaoGrupoCorrente = monthClosed
      ? toNumber(byMonth.get(month)) + toNumber(unassignedByMonth.get(month))
      : toNumber(consEquipe.producao_acumulada);

    // total[m] = atribuído (PMR no fechado/histórico; daily-live no corrente aberto)
    // + master não-atribuído (daily).
    const monthsSet = new Set<number>([...byMonth.keys(), ...unassignedByMonth.keys()]);
    const producaoMensal = Array.from(monthsSet)
      .sort((a, b) => a - b)
      .map((m) => ({
        mes: MES[m - 1],
        month: m,
        valor: roundMoney(
          m === month
            ? producaoGrupoCorrente
            : toNumber(byMonth.get(m)) + toNumber(unassignedByMonth.get(m))
        ),
        // mês corrente = parcial (em andamento). Os anteriores são realizados.
        parcial: m === month,
      }));

    // KPI "Produção do grupo · mês" = total do mês corrente (atribuído + master
    // pendente), coerente com o ponto do gráfico, com o portal e com a tela
    // Projeção (mesma consolidarGrupoEquipe).
    const producaoGrupoMes = roundMoney(producaoGrupoCorrente);
    // Sublink "inclui R$ X em N não atribuídas" = parcela em chave master DENTRO
    // do total acima (não subtraída). Mês ABERTO: mesma fonte recortada do total
    // (consEquipe.nao_atribuido), garantindo subconjunto coerente. Mês FECHADO:
    // daily (o cms já atribuiu, tende a 0).
    const producaoNaoAtribuida = roundMoney(
      monthClosed
        ? toNumber(unassignedByMonth.get(month))
        : toNumber(consEquipe.nao_atribuido.acumulada)
    );
    const producaoNaoAtribuidaCount = monthClosed
      ? toNumber(unassignedCountByMonth.get(month))
      : toNumber(consEquipe.nao_atribuido.count);

    // ---- previsão de receita (ESTIMADO) ----
    const s = closingPayload.summary;
    const previsaoReceita = roundMoney(
      toNumber(s.expectedCash) + toNumber(s.expectedPrt) + toNumber(s.expectedInsurance)
    );

    // ---- Simples por CNPJ (ordenado por RBT12 desc) + limite do grupo ----
    const cnpjs = [...rbt12.empresas]
      .sort((a, b) => b.rbt12 - a.rbt12)
      .map((e) => ({
        nome: displayCompany(e.name),
        faixa: e.acimaSimples ? "Acima" : `Faixa ${e.faixa}`,
        rbt12: roundMoney(e.rbt12),
        sinal: e.sinal, // "verde" | "amarelo" | "acima"
      }));
    const limiteSimples = {
      pct: rbt12.grupo.pctLimite,
      rbt12: roundMoney(rbt12.grupo.rbt12),
      teto: rbt12.grupo.limiteSimples,
      sinal: rbt12.grupo.sinal,
    };

    // ---- comissão bruta da EMPRESA · mês corrente (company_commission) ----
    // É o GANHO DA EMPRESA (o que a empresa recebe), NÃO o repasse do promotor.
    // Split cms/motor do resto do sistema: mês FECHADO = ground truth do cms (Σ
    // cms_promoter_entries.company_commission); mês ABERTO = motor (buildPromoter-
    // Analytics → summary.companyGrossCommission, mesma getPromoterViewCompanyRate
    // das propostas, com teto 5,80% + derive TRP). O mês corrente é parcial.
    let comissaoBrutaEmpresa = 0;
    let comissaoBrutaEmpresaLabel = "";
    // parcela ainda SEM promotor atribuído (faz parte do bruto; encolhe conforme
    // o funcionário atribui na Migração). Só existe no mês aberto (motor); no
    // fechado (cms) tudo já está atribuído por j_key.
    let comissaoBrutaEmpresaNaoAtribuida = 0;
    let comissaoBrutaEmpresaNaoAtribuidaCount = 0;
    if (regime === "cms") {
      // jan-mai: seed do financeiro. Ground truth = COMISSÃO PF do cms. INALTERADO
      // (leitura extraída para lerComissaoEmpresaCreditoFechada, mesma query).
      comissaoBrutaEmpresa = await lerComissaoEmpresaCreditoFechada(supabase, "cms", year, month);
      comissaoBrutaEmpresaLabel = `${MES[month - 1]}/${year} · fechado`;
    } else if (regime === "fechamento") {
      // jun+ (e abril): NÃO existe cms — o booleano antigo mandava ler cms aqui e
      // trazia 0. A comissão-EMPRESA de crédito também NÃO existe no PMR (o PMR
      // guarda a comissão do PROMOTOR; promoterAnalytics só calcula
      // companyGrossCommission no caminho vivo, dentro de `if (!closedSource)`).
      // A fonte certa é o fechamento: valor_avista = Σ da COMISSÃO PF das linhas
      // CASH (monthlyClosingImport acumula exatamente isso). É a MESMA tabela que o
      // seguro do grupo já usa aqui embaixo (valor_seguro) e a mesma do financeiro/DRE.
      comissaoBrutaEmpresa = await lerComissaoEmpresaCreditoFechada(
        supabase,
        "fechamento",
        year,
        month
      );
      comissaoBrutaEmpresaLabel = `${MES[month - 1]}/${year} · fechado`;
    } else {
      comissaoBrutaEmpresa = roundMoney(
        toNumber(promoterAnalytics.summary.companyGrossCommission)
      );
      comissaoBrutaEmpresaNaoAtribuida = roundMoney(
        toNumber(promoterAnalytics.summary.unassignedCompanyGrossCommission)
      );
      comissaoBrutaEmpresaNaoAtribuidaCount = toNumber(
        promoterAnalytics.summary.unassignedCount
      );
      comissaoBrutaEmpresaLabel = `${MES[month - 1]}/${year} · parcial`;
    }

    // ---- KPIs de SEGURO (DB-driven; NUNCA motor/closingAnalytics) ----
    // Split idêntico ao comissaoBrutaEmpresa (monthClosed). A penetração ponderada
    // é ATRIBUÍDO-ONLY nos dois regimes (o master não existe no PMR/cms) — decisão
    // Diego, documentada aqui.
    // Consolidado da projeção (mês corrente) — fonte da penetração no mês aberto
    // (idêntica à tela de projeção). Reusado no alerta de projeção abaixo.
    const cons = consolidarGrupo(projecaoRes);

    let comissaoSeguroGrupo = 0;
    let penetracaoSeguroGrupo = 0; // fração 0..1
    let seguroLabel = "";
    let seguroMasterSemRegra = 0;
    if (monthClosed) {
      // TOTAL do grupo = comissão-EMPRESA do fechamento (fechamento_mensal_empresa.
      // valor_seguro) — MESMA fonte do financeiro/DRE. NÃO o share do promotor
      // (cms.promoter_insurance), que é a camada de repasse, não o ganho da empresa.
      // Vale para os DOIS regimes fechados (cms e fechamento) — já estava certo
      // (leitura extraída para lerSeguroEmpresaFechada, mesma query).
      comissaoSeguroGrupo = await lerSeguroEmpresaFechada(supabase, year, month);

      // PENETRAÇÃO ponderada — a fonte muda com o regime.
      if (regime === "cms") {
        // jan-mai: Σ(penetration_i × net_value_i) / Σ net_value_i (cms). INALTERADO.
        const cmsSeguro = await fetchAllRows<{
          penetration: number | null;
          net_value: number | null;
        }>(() =>
          supabase
            .from("cms_promoter_entries")
            .select("penetration, net_value")
            .eq("prod_year", year)
            .eq("prod_month", month)
        );
        let penNum = 0;
        let penDen = 0;
        for (const r of cmsSeguro) {
          const nv = toNumber(r.net_value);
          penNum += toNumber(r.penetration) * nv;
          penDen += nv;
        }
        penetracaoSeguroGrupo = penDen > 0 ? penNum / penDen : 0;
      } else {
        // jun+ (e abril): o cms não tem essas competências — lia 0. Agora vem do PMR
        // FECHADO, pelo MESMO summaryRows que /promotores usa (consolidatedSummaryRows,
        // source IN ('fechamento','bbts'), já somando RR+ADS por promotor).
        // MESMA FÓRMULA do ramo cms — ponderada pela produção; só a fonte muda.
        // (insurance_penetration_percent vem em 0..100; penetracaoSeguroGrupo é 0..1.)
        let penNum = 0;
        let penDen = 0;
        for (const r of promoterAnalytics.summaryRows || []) {
          const prod = toNumber(r.production_value);
          penNum += (toNumber(r.insurance_penetration_percent) / 100) * prod;
          penDen += prod;
        }
        penetracaoSeguroGrupo = penDen > 0 ? penNum / penDen : 0;
      }
      seguroLabel = `${MES[month - 1]}/${year} · fechado`;
    } else {
      // ATRIBUÍDO: Σ summaryRows.insurance_commission_value (PMR via analytics;
      // ex-SRCC já filtrado no pipeline).
      const seguroAtribuido = (promoterAnalytics.summaryRows || []).reduce(
        (sum, r) => sum + toNumber(r.insurance_commission_value),
        0
      );
      // MASTER (não atribuído): recalcula pelo MESMO caminho DB-driven do pipeline
      // (calculateInsuranceCommissionFromRules + insurance_slip_rules). Mesmo filtro
      // ex-SRCC/produção/competência da produção master. Sem regra → soma 0 e conta
      // em seguroMasterSemRegra (NÃO chuta fallback legado).
      let seguroMaster = 0;
      for (const r of dailyUnassigned || []) {
        if (!r.company_id || !activeIds.has(r.company_id)) continue;
        if (!isProductionStatus(r.status)) continue;
        if (!isValidDailyRecord(r)) continue;
        const period = getProductionPeriodFromValue(r.movement_date);
        if (!period || period.year !== year || period.month !== month) continue;
        if (!(toNumber(r.insurance_value) > 0 || r.has_insurance === true)) continue;
        const res = calculateInsuranceCommissionFromRules({
          rules: insuranceSlipRules,
          grossValue: toNumber(r.gross_value),
          premioValue: toNumber(r.insurance_value),
          insuranceType: r.insurance_type,
          termPromotiva: getPrazoTrp(r) ?? toNumber(r.term_months || r.installments),
          contractDate: r.contract_date || r.movement_date,
        });
        if (!res) {
          seguroMasterSemRegra += 1;
          continue;
        }
        seguroMaster += res.amount;
      }
      comissaoSeguroGrupo = roundMoney(seguroAtribuido + seguroMaster);
      // Penetração: mês ABERTO usa a MESMA da projeção (cons.seguro_penetracao —
      // ponderada pela produção, daily ao vivo), alinhando com a tela de projeção
      // (ex.: 19,1%) em vez do PMR snapshot defasado (18,0%). Fração 0..1.
      penetracaoSeguroGrupo = cons.seguro_penetracao ?? 0;
      seguroLabel = `${MES[month - 1]}/${year} · parcial`;
    }

    // ---- alerta de projeção (só se houver risco: amarelo/vermelho) ----
    // cons já calculado acima (reusado na penetração de seguro do mês aberto).
    const projecao = {
      percent: cons.percent_projetado,
      semaforo: cons.semaforo,
      diasDecorridos: projecaoRes.janela.dias_uteis_decorridos,
      diasTotais: projecaoRes.janela.dias_uteis_totais,
      mesLabel: `${MES[month - 1]}/${year}`,
      show: cons.semaforo === "amarelo" || cons.semaforo === "vermelho",
    };

    // ---- DELTA vs mes anterior (FASE 1: mes-cheio vs mes-cheio) ----
    // O delta e calculado AQUI, no servidor, e viaja pronto para a tela. A tela
    // so desenha (<DeltaBadge/>) — nao tem como recalcular, que e o ponto da
    // REGRA DE OURO em lib/delta/calcularDelta.
    //
    // TODO-FASE-2 (recorte por dia): em competencia FECHADA este delta ja e
    // 100% correto. Em competencia ABERTA a ponta atual e PARCIAL (producao ate
    // hoje) e a anterior e CHEIA — o delta aparece artificialmente negativo, e
    // quanto mais cedo no mes, pior. A Fase 2 corrige comparando os N primeiros
    // DIAS UTEIS de cada competencia (nao o dia-do-mes calendario, que embute
    // vies proprio — ver o TODO no fim de lib/delta/calcularDelta.ts).
    const competencia = { year, month };
    const compAnterior = competenciaAnterior(competencia);

    // Regime do M-1: decide QUAL leitor usa (cms x fechamento). Se o M-1 ainda
    // estiver aberto nao ha valor consolidado -> valorAnterior null -> o helper
    // esconde o delta sozinho (motivo "sem-anterior").
    const regimeAnterior = await detectMonthRegime(
      supabase,
      compAnterior.year,
      compAnterior.month
    ).catch(() => "open" as MonthRegime);
    const anteriorFechado = regimeAnterior !== "open";

    const [comissaoEmpresaAnterior, seguroEmpresaAnterior] = await Promise.all([
      anteriorFechado
        ? lerComissaoEmpresaCreditoFechada(
            supabase,
            regimeAnterior as "cms" | "fechamento",
            compAnterior.year,
            compAnterior.month
          )
        : Promise.resolve(null),
      anteriorFechado
        ? lerSeguroEmpresaFechada(supabase, compAnterior.year, compAnterior.month)
        : Promise.resolve(null),
    ]);

    // PRODUCAO — caminho preferido: as duas pontas saem da MESMA serie
    // (producaoMensal), montada por uma unica expressao la em cima. Sao a mesma
    // metrica por construcao. producaoMensal cobre so o ano corrente, entao em
    // janeiro o M-1 (dezembro do ano anterior) nao esta la e o delta some — que
    // e o comportamento certo: o ledger PMR nasce em jan/2026.
    const serieProducao: PontoSerie[] = producaoMensal.map((p) => ({
      year,
      month: p.month,
      valor: p.valor,
      fonte: p.parcial && !monthClosed ? "daily-vivo" : "pmr+master",
    }));
    const deltaProducao = deltaDaSerie({ serie: serieProducao, competencia });

    // COMISSAO-EMPRESA e SEGURO — nao ha serie pronta (a fonte muda com o
    // regime da competencia). As duas pontas passam pelos MESMOS leitores
    // extraidos acima; a fonte de cada ponta viaja junto para a tela poder
    // sinalizar comparacao cross-source.
    const deltaComissaoEmpresa = calcularDelta({
      competencia,
      valorAtual: comissaoBrutaEmpresa,
      valorAnterior: comissaoEmpresaAnterior,
      fonteAtual: regime === "open" ? "motor-vivo" : regime,
      fonteAnterior: anteriorFechado ? regimeAnterior : null,
    });

    const deltaComissaoSeguro = calcularDelta({
      competencia,
      valorAtual: comissaoSeguroGrupo,
      valorAnterior: seguroEmpresaAnterior,
      fonteAtual: monthClosed ? "fechamento" : "daily-vivo",
      fonteAnterior: anteriorFechado ? "fechamento" : null,
    });

    return NextResponse.json({
      periodoLabel: `${MES[month - 1]}/${year}`,
      // MOV 2 (A): a competência renderizada e o regime dela — a tela usa para
      // montar o seletor e para rotular a origem do número.
      year,
      month,
      regime,
      producaoGrupoMes,
      producaoParcial: true,
      producaoNaoAtribuida,
      producaoNaoAtribuidaCount,
      comissaoBrutaEmpresa,
      comissaoBrutaEmpresaLabel,
      comissaoBrutaEmpresaNaoAtribuida,
      comissaoBrutaEmpresaNaoAtribuidaCount,
      previsaoReceita,
      limiteSimples,
      producaoMensal,
      cnpjs,
      projecao,
      // Seguridade (DB-driven). penetracaoSeguroGrupo = fração 0..1 (ponderada,
      // atribuído-only). seguroMasterSemRegra = nº de contratos master com seguro
      // sem regra TRP casada (não somados; sinalizar discreto na UI).
      comissaoSeguroGrupo,
      penetracaoSeguroGrupo,
      seguroLabel,
      seguroMasterSemRegra,
      // DELTA vs mes anterior — ja calculado (ResultadoDelta serializavel). A
      // tela renderiza via <DeltaBadge/> e nao refaz conta nenhuma.
      deltaProducao,
      deltaComissaoEmpresa,
      deltaComissaoSeguro,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
