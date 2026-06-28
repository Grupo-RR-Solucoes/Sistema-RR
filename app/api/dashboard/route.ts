import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { buildClosingAnalytics } from "@/lib/closingAnalytics";
import { detectClosedMonth } from "@/lib/cmsMonthly";
import { calcularRbt12 } from "@/lib/rbt12";
import { buildProjecaoMetas, consolidarGrupo } from "@/lib/projecaoMetas";
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

export async function GET() {
  try {
    const { supabase } = await withSocioAnon();

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const [
      pmrRows,
      closingPayload,
      rbt12,
      projecaoRes,
      promoterAnalytics,
      monthClosed,
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
        // motor: comissão bruta da EMPRESA do grupo no mês corrente (aberto).
        buildPromoterAnalytics(supabase, { year, month }),
        detectClosedMonth(supabase, year, month).catch(() => false),
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

    // total[m] = atribuído (PMR) + master não-atribuído (daily).
    const monthsSet = new Set<number>([...byMonth.keys(), ...unassignedByMonth.keys()]);
    const producaoMensal = Array.from(monthsSet)
      .sort((a, b) => a - b)
      .map((m) => ({
        mes: MES[m - 1],
        month: m,
        valor: roundMoney(toNumber(byMonth.get(m)) + toNumber(unassignedByMonth.get(m))),
        // mês corrente = parcial (em andamento). Os anteriores são realizados.
        parcial: m === month,
      }));

    // KPI "Produção do grupo · mês" = total do mês corrente (atribuído + master
    // pendente), coerente com o ponto do gráfico e com o portal.
    const producaoGrupoMes = roundMoney(
      toNumber(byMonth.get(month)) + toNumber(unassignedByMonth.get(month))
    );
    // Aviso discreto: produção (net) ainda em chave master sem promotor.
    const producaoNaoAtribuida = roundMoney(toNumber(unassignedByMonth.get(month)));
    const producaoNaoAtribuidaCount = toNumber(unassignedCountByMonth.get(month));

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
    if (monthClosed) {
      const entries = await fetchAllRows<{ company_commission: number | null }>(() =>
        supabase
          .from("cms_promoter_entries")
          .select("company_commission")
          .eq("prod_year", year)
          .eq("prod_month", month)
      );
      comissaoBrutaEmpresa = roundMoney(
        entries.reduce((sum, r) => sum + toNumber(r.company_commission), 0)
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
    let comissaoSeguroGrupo = 0;
    let penetracaoSeguroGrupo = 0; // fração 0..1
    let seguroLabel = "";
    let seguroMasterSemRegra = 0;
    if (monthClosed) {
      // Ground truth do fechamento (já inclui tudo; sem master separado no fechado).
      const cmsSeguro = await fetchAllRows<{
        promoter_insurance: number | null;
        penetration: number | null;
        net_value: number | null;
      }>(() =>
        supabase
          .from("cms_promoter_entries")
          .select("promoter_insurance, penetration, net_value")
          .eq("prod_year", year)
          .eq("prod_month", month)
      );
      comissaoSeguroGrupo = roundMoney(
        cmsSeguro.reduce((sum, r) => sum + toNumber(r.promoter_insurance), 0)
      );
      // Penetração ponderada = Σ(penetration_i × net_value_i) / Σ net_value_i.
      // cms.penetration já é FRAÇÃO (0..1); pondera pelo net_value.
      let penNum = 0;
      let penDen = 0;
      for (const r of cmsSeguro) {
        const nv = toNumber(r.net_value);
        penNum += toNumber(r.penetration) * nv;
        penDen += nv;
      }
      penetracaoSeguroGrupo = penDen > 0 ? penNum / penDen : 0;
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
      // Penetração ponderada ATRIBUÍDO-ONLY = Σ insured_production_value /
      // Σ production_value do PMR (mês corrente). O master NÃO entra (não existe no
      // PMR). Fração 0..1.
      let penNum = 0;
      let penDen = 0;
      for (const r of pmrRows) {
        if (r.year !== year || r.month !== month) continue;
        penNum += toNumber(r.insured_production_value);
        penDen += toNumber(r.production_value);
      }
      penetracaoSeguroGrupo = penDen > 0 ? penNum / penDen : 0;
      seguroLabel = `${MES[month - 1]}/${year} · parcial`;
    }

    // ---- alerta de projeção (só se houver risco: amarelo/vermelho) ----
    const cons = consolidarGrupo(projecaoRes);
    const projecao = {
      percent: cons.percent_projetado,
      semaforo: cons.semaforo,
      diasDecorridos: projecaoRes.janela.dias_uteis_decorridos,
      diasTotais: projecaoRes.janela.dias_uteis_totais,
      mesLabel: `${MES[month - 1]}/${year}`,
      show: cons.semaforo === "amarelo" || cons.semaforo === "vermelho",
    };

    return NextResponse.json({
      periodoLabel: `${MES[month - 1]}/${year}`,
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
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
