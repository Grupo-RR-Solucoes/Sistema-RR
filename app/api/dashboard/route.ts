import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { buildClosingAnalytics } from "@/lib/closingAnalytics";
import { detectClosedMonth } from "@/lib/cmsMonthly";
import { calcularRbt12 } from "@/lib/rbt12";
import { buildProjecaoMetas, consolidarGrupo } from "@/lib/projecaoMetas";
import { buildPromoterAnalytics } from "@/lib/promoterAnalytics";
import { fetchAllRows } from "@/lib/queryHelpers";

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

type PmrRow = { year: number; month: number; production_value: number | null };

export async function GET() {
  try {
    const { supabase } = await withSocioAnon();

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const [pmrRows, closingPayload, rbt12, projecaoRes, promoterAnalytics, monthClosed] =
      await Promise.all([
        fetchAllRows<PmrRow>(() =>
          supabase.from("promoter_monthly_results").select("year, month, production_value")
        ),
        buildClosingAnalytics(supabase, { fastDashboardMode: true }),
        calcularRbt12(supabase, { ano: year, mes: month }),
        buildProjecaoMetas(supabase, { year, month }),
        // motor: comissão bruta da EMPRESA do grupo no mês corrente (aberto).
        buildPromoterAnalytics(supabase, { year, month }),
        detectClosedMonth(supabase, year, month).catch(() => false),
      ]);

    // ---- produção mensal do grupo (ano corrente), por promoter_monthly_results ----
    const byMonth = new Map<number, number>();
    for (const r of pmrRows) {
      if (r.year !== year) continue;
      byMonth.set(r.month, toNumber(byMonth.get(r.month)) + toNumber(r.production_value));
    }
    const producaoMensal = Array.from(byMonth.keys())
      .sort((a, b) => a - b)
      .map((m) => ({
        mes: MES[m - 1],
        month: m,
        valor: roundMoney(toNumber(byMonth.get(m))),
        // mês corrente = parcial (em andamento). Os anteriores são realizados.
        parcial: m === month,
      }));

    // KPI "Produção do grupo · mês" = mês corrente (parcial), coerente com o ponto do gráfico.
    const producaoGrupoMes = roundMoney(toNumber(byMonth.get(month)));

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
      comissaoBrutaEmpresa,
      comissaoBrutaEmpresaLabel,
      comissaoBrutaEmpresaNaoAtribuida,
      comissaoBrutaEmpresaNaoAtribuidaCount,
      previsaoReceita,
      limiteSimples,
      producaoMensal,
      cnpjs,
      projecao,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
