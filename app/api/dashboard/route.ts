import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import {
  calcularDelta,
  competenciaAnterior,
  deltaDaSerie,
  resolverJanela,
  type PontoSerie,
} from "@/lib/delta/calcularDelta";
import { buildClosingAnalytics } from "@/lib/closingAnalytics";
import { detectMonthRegime, type MonthRegime } from "@/lib/cmsMonthly";
import { calcularRbt12 } from "@/lib/rbt12";
import { buildProjecaoMetas, consolidarGrupo, consolidarGrupoEquipe } from "@/lib/projecaoMetas";
import { resolverJanelaRitmo } from "@/lib/janelaRitmo";
import { calcularRitmoNecessario, metaPropriaDoGrupo } from "@/lib/ritmoNecessario";
import { nowInFortaleza } from "@/lib/dateFortaleza";
import {
  buildPromoterAnalytics,
  calcularComissaoEmpresaRecortada,
  calcularProducaoMensalDoGrupo,
} from "@/lib/promoterAnalytics";
import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import { buildTrpCreditProvider } from "@/lib/trp/creditTrpProvider";
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

// Linha do daily usada SO pelo recorte por dia do delta (Fase 2). Enxuta de
// proposito: o recorte precisa de valor, competencia e os filtros de validade —
// nada de prazo, que so a produção master usa.
//
// insurance_commission_amount entrou na Fase 2.2 (recorte do SEGURO): a comissao
// de seguro JA existe por registro, com movement_date, entao ela recorta por dia
// igual a producao. Medido em 26/07/2026: junho mes-cheio pelo daily da
// R$ 4.297,21 contra R$ 4.372,62 do fechamento_mensal_empresa.valor_seguro —
// 98,3%, R$ 75,41 de diferenca.
// MEDIDA C alargou esta linha. Ate aqui ela era o subconjunto enxuto que a
// producao e o seguro precisavam (somas de coluna). A comissao BRUTA nao e soma
// de coluna: a taxa a vista sai de raw_payload -> company_received_percent ->
// derive da TRP, e o derive le valor bruto, seguro, juros, prazo e produto.
// Sem esses campos calcularComissaoEmpresaRecortada devolveria taxa zero em
// silencio para as ~9% de linhas que caem no derive.
type DailyRecorteRow = {
  id: string;
  company_id: string | null;
  status: string | null;
  is_srcc_restricted: boolean | null;
  net_value: number | null;
  movement_date: string | null;
  cancellation_date: string | null;
  insurance_commission_amount: number | null;
  // --- campos que o derive da taxa a vista consome ---
  contract_date: string | null;
  proposal_date: string | null;
  gross_value: number | null;
  insurance_value: number | null;
  has_insurance: boolean | null;
  interest_rate: number | null;
  term_months: number | null;
  installments: number | null;
  product_description: string | null;
  company_received_percent: number | null;
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
// Assinatura pelo que a funcao REALMENTE le (3 campos), e nao pela linha
// inteira: assim serve tanto a DailyUnassignedRow quanto a DailyRecorteRow (o
// recorte da Fase 2), que e um subconjunto enxuto da mesma tabela.
function isValidDailyRecord(
  r: Pick<DailyUnassignedRow, "cancellation_date" | "status" | "is_srcc_restricted">
) {
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

    // ---- FASE 2: janela do delta ----
    // O recorte "ate-dia-N" so faz sentido quando a competencia renderizada E a
    // corrente E esta aberta. Competencia FECHADA compara dois totais finais
    // (mes-cheio, caminho da Fase 1, intocado). E se o usuario navegar para uma
    // competencia passada, "dia de hoje" nao significa nada la — por isso a
    // comparacao explicita com agora.year/agora.month, e nao so !monthClosed.
    const ehCompetenciaCorrente = year === agora.year && month === agora.month;
    const modoJanelaPedido = !monthClosed && ehCompetenciaCorrente ? "ate-dia-N" : "mes-cheio";

    // Janela de datas para buscar o daily das DUAS competencias do delta. Folga
    // nos dois extremos: a competencia comeca no ultimo dia util do mes anterior
    // (dia 28-31) e termina no ultimo dia util do proprio mes.
    const compAnteriorRange = competenciaAnterior({ year, month });
    const doisMesesAntes = competenciaAnterior(compAnteriorRange);
    const mesSeguinte = { year: month === 12 ? year + 1 : year, month: month === 12 ? 1 : month + 1 };
    const recorteRange = {
      inicio: `${doisMesesAntes.year}-${String(doisMesesAntes.month).padStart(2, "0")}-20`,
      fim: `${mesSeguinte.year}-${String(mesSeguinte.month).padStart(2, "0")}-10`,
    };

    const [
      pmrRows,
      closingPayload,
      rbt12,
      projecaoRes,
      promoterAnalytics,
      activeCompanies,
      dailyUnassigned,
      insuranceSlipRules,
      dailyRecorte,
    ] = await Promise.all([
        fetchAllRows<PmrRow>(() =>
          supabase
            .from("promoter_monthly_results")
            .select("year, month, production_value, insured_production_value")
        ),
        // COMPETENCIA CANONICA — a competencia VAI junto. Antes esta chamada
        // era a unica sem year/month, e por isso "Previsao de receita" nunca
        // respondeu ao seletor em regime nenhum: o find() de closingAnalytics
        // comparava contra undefined e o periods.at(-1) escolhia sozinho.
        // Custo zero: sob fastDashboardMode os unicos consumidores de
        // year/month sao as queries historicas, que o proprio modo ja pula.
        buildClosingAnalytics(supabase, { year, month, fastDashboardMode: true }),
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
        // FASE 2 (recorte por dia): daily de TODOS os promotores — atribuidos e
        // master — das DUAS competencias do delta. Query separada da
        // dailyUnassigned de proposito: aquela filtra assigned_promoter_id null
        // (so o balde); o recorte precisa da producao inteira, e precisa dela
        // com data por linha. Janela de datas folgada nos dois extremos porque
        // a competencia comeca no ultimo dia util do mes anterior.
        fetchAllRows<DailyRecorteRow>(() =>
          supabase
            .from("daily_production_records")
            .select(
              "id, company_id, status, is_srcc_restricted, net_value, movement_date, cancellation_date, insurance_commission_amount, contract_date, proposal_date, gross_value, insurance_value, has_insurance, interest_rate, term_months, installments, product_description, company_received_percent, raw_payload"
            )
            .gte("movement_date", recorteRange.inicio)
            .lt("movement_date", recorteRange.fim)
        ),
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
    // COMPETENCIA CANONICA — a lista SEMPRE tem a competencia renderizada.
    //
    // O QUE HAVIA: monthsSet saia so de PMR + daily master orfao. No dia 01/08
    // agosto nao tinha nenhum dos dois (PMR agosto = 0, daily 31/07 = 0), entao
    // o mes nao virava <option>, o `value` do <select> ("2026-8") nao casava com
    // opcao nenhuma e o React selecionava a PRIMEIRA opcao da lista — jan/2026.
    // A tela abria exibindo "jan" enquanto o payload era de agosto.
    //
    // Acrescentar o mes renderizado a lista, mesmo sem dado, e o que a
    // lib/auditoria.ts:56-60 ja faz para o /fechamento ("mes corrente como em
    // aberto no topo, se ainda nao fechou"). Vale para QUALQUER competencia
    // pedida, nao so a corrente: navegar para um mes vazio tem de manter esse
    // mes selecionavel, senao o seletor pula para outro sozinho.
    const monthsSet = new Set<number>([...byMonth.keys(), ...unassignedByMonth.keys()]);
    monthsSet.add(month);
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

    // ============================================================
    // COMPETENCIA CANONICA — FONTE UNICA DO ROTULO.
    //
    // Os rotulos eram remontados de `MES[month - 1]/year` em CINCO pontos desta
    // rota, cada um repetindo a mesma expressao. Enquanto o VALOR vinha de um
    // resolvedor que podia recuar para outra competencia, o rotulo seguia
    // fielmente o que foi PEDIDO — e a tela exibia julho escrito "ago/2026".
    // A fase 1 fez os dois convergirem; isto aqui torna a convergencia
    // estrutural em vez de coincidente: existe UM label, e todo cartao o usa.
    //
    // `competenciaEfetiva` e a competencia que esta rota realmente somou. Vai
    // inteira no payload para a tela rotular a partir dela, em vez de remontar
    // do proprio parametro que enviou.
    // ============================================================
    const competenciaEfetiva = {
      year,
      month,
      key: `${year}-${String(month).padStart(2, "0")}`,
      label: `${MES[month - 1]}/${year}`,
      regime,
      // parcial = regime aberto. E o unico estado em que o numero ainda cresce.
      parcial: regime === "open",
      // Espelho do que o analytics resolveu. Depois da fase 1 os dois sao iguais
      // por construcao; se algum dia divergirem, o payload DIZ, em vez de a tela
      // exibir um mes sob o rotulo de outro em silencio.
      analytics: promoterAnalytics.competencia,
      divergente:
        promoterAnalytics.competencia.year !== year ||
        promoterAnalytics.competencia.month !== month,
    };
    const rotuloCompetencia = `${competenciaEfetiva.label} · ${
      competenciaEfetiva.parcial ? "parcial" : "fechado"
    }`;

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
      comissaoBrutaEmpresaLabel = rotuloCompetencia;
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
      comissaoBrutaEmpresaLabel = rotuloCompetencia;
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
      comissaoBrutaEmpresaLabel = rotuloCompetencia;
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
      seguroLabel = rotuloCompetencia;
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
      seguroLabel = rotuloCompetencia;
    }

    // ============================================================
    // RITMO DIARIO DO GRUPO — DUAS METAS, de proposito discordantes.
    //
    // (a) META DOS PROMOTORES = consolidarGrupoEquipe(res).meta. NAO somar
    //     monthly_targets na mao: a soma bruta de julho/2026 da R$ 7.562.000
    //     contra R$ 6.402.000 do consolidado, porque o consolidado ignora
    //     promotor inativo e chave master. Erro de R$ 1,16 milhao. O
    //     consolidado tambem ja deduplica por promotor (promoterAnalytics faz
    //     um `.find()` de UMA linha de meta por promotor, nao a soma delas).
    //
    // (b) META PROPRIA = META_DIARIA_GRUPO x dias uteis TOTAIS da janela.
    //     Constante NOMEADA (lib/ritmoNecessario.ts), mudar exige deploy.
    //     Decisao Diego (02/08): as duas visoes existem para DISCORDAR; se
    //     concordassem, uma seria redundante. Em julho a propria fica ~11%
    //     abaixo da soma das individuais, e isso e informacao, nao defeito.
    //
    // ACUMULADO: o MESMO nos dois lados — consEquipe.producao_acumulada, que
    // ja inclui a ADS (medido em 02/08: R$ 612.225,52 dentro dos
    // R$ 6.426.690,15 de julho). Comparar meta de grupo inteiro com producao
    // de meia empresa seria erro de universo.
    //
    // DIVIDA REGISTRADA (nao consertada nesta frente, decisao Diego): a ADS
    // esta `active=false` em `companies`, e o filtro `activeIds` daqui de cima
    // (usado por unassignedByMonth) exclui a producao ADS em chave MASTER no
    // mes FECHADO. A producao ADS ATRIBUIDA entra nos dois regimes; so o balde
    // master fica de fora, e so no fechado. Enquanto isso durar, o acumulado
    // comparado com a meta propria nao e exatamente o mesmo universo nos dois
    // regimes.
    // ============================================================
    const janelaRitmo = resolverJanelaRitmo(year, month, { closed: monthClosed });
    const ritmoGrupo = {
      diasTotais: janelaRitmo.total,
      promotores: calcularRitmoNecessario({
        meta: consEquipe.meta,
        acumulado: consEquipe.producao_acumulada,
        projecao: consEquipe.projecao,
        janela: janelaRitmo,
        mesFechado: monthClosed,
      }),
      propria: calcularRitmoNecessario({
        meta: metaPropriaDoGrupo(janelaRitmo),
        acumulado: consEquipe.producao_acumulada,
        projecao: consEquipe.projecao,
        janela: janelaRitmo,
        mesFechado: monthClosed,
      }),
    };

    // ---- alerta de projeção (só se houver risco: amarelo/vermelho) ----
    // cons já calculado acima (reusado na penetração de seguro do mês aberto).
    const projecao = {
      percent: cons.percent_projetado,
      semaforo: cons.semaforo,
      diasDecorridos: projecaoRes.janela.dias_uteis_decorridos,
      diasTotais: projecaoRes.janela.dias_uteis_totais,
      // COMPETENCIA CANONICA — ultimo rotulo remontado da rota. O banner de
      // projecao ("ritmo abaixo da meta de jul") passa a citar a MESMA
      // competencia efetiva que os cartoes, e nao uma remontagem paralela.
      mesLabel: competenciaEfetiva.label,
      show: cons.semaforo === "amarelo" || cons.semaforo === "vermelho",
    };

    // ---- DELTA vs mes anterior ----
    // O delta e calculado AQUI, no servidor, e viaja pronto para a tela. A tela
    // so desenha (<DeltaBadge/>) — nao tem como recalcular, que e o ponto da
    // REGRA DE OURO em lib/delta/calcularDelta.
    //
    // JANELA (Fase 2): competencia FECHADA compara mes-cheio vs mes-cheio;
    // ABERTA recorta as duas pontas no mesmo dia-do-mes. Hoje so a PRODUCAO
    // consegue recortar (tem daily com data por linha nas duas pontas); comissao
    // e seguro caem para mes-cheio rotulado — ver o bloco de cada um abaixo.
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

    // ---- PRODUCAO ----
    // Serie de MES CHEIO (Fase 1): as duas pontas saem do mesmo array, montado
    // por uma unica expressao la em cima. producaoMensal cobre so o ano
    // corrente, entao em janeiro o M-1 (dezembro do ano anterior) nao esta la e
    // o delta some — que e o comportamento certo: o ledger PMR nasce em jan/2026.
    const serieProducaoCheia: PontoSerie[] = producaoMensal.map((p) => ({
      year,
      month: p.month,
      valor: p.valor,
      fonte: p.parcial && !monthClosed ? "daily-vivo" : "pmr+master",
    }));

    // RECORTE POR DIA (Fase 2). Soma o daily das duas competencias aplicando o
    // corte de dia-do-mes em cada uma. As duas pontas saem da MESMA query, com o
    // MESMO predicado de validade — so o filtro de dia muda. E o que torna a
    // comparacao legitima: mesma fonte, mesma definicao, janela igual.
    //
    // Nota: o valor recortado NAO reconcilia com o "mes cheio" do proprio card,
    // e nao deveria — o corte <= N exclui o primeiro dia da janela de
    // competencia (que cai em dia 28-31), simetricamente nos dois lados.
    // FASE 2.1 — dias-do-mes que TEM producao lancada na competencia CORRENTE.
    // Alimenta o min(hoje, ultimo dia com dado) do resolverJanela: sem isso o
    // corte pede ate hoje e o dado so vai ate a ultima diaria importada, e o
    // card le atraso de carga como queda. Mesmo predicado da soma abaixo.
    // So dias do MES-CALENDARIO da competencia. O "dia-cabeca" que a janela
    // herda do mes anterior (30/06 na competencia de julho) tem dia-do-mes 30 e
    // viraria o maximo, mascarando que a diaria so foi carregada ate o dia 23.
    const prefixoMesCorrente = `${competencia.year}-${String(competencia.month).padStart(2, "0")}-`;
    const diasComDadoCorrente = new Set<number>();
    for (const r of dailyRecorte || []) {
      if (!r.company_id || !activeIds.has(r.company_id)) continue;
      if (!isProductionStatus(r.status)) continue;
      if (!isValidDailyRecord(r)) continue;
      const period = getProductionPeriodFromValue(r.movement_date);
      if (!period || period.year !== competencia.year || period.month !== competencia.month) continue;
      const bruta = String(r.movement_date ?? "");
      if (!bruta.startsWith(prefixoMesCorrente)) continue;
      const dia = Number(bruta.slice(8, 10));
      if (dia >= 1 && dia <= 31) diasComDadoCorrente.add(dia);
    }

    const janelaPedida = resolverJanela({
      competencia,
      modo: modoJanelaPedido,
      dia: agora.day,
      diasComDadoNoMesCorrente: diasComDadoCorrente,
    });

    function somaDailyRecortado(comp: { year: number; month: number }, ateDia: number | null) {
      let total = 0;
      let linhas = 0;
      for (const r of dailyRecorte || []) {
        if (!r.company_id || !activeIds.has(r.company_id)) continue;
        if (!isProductionStatus(r.status)) continue;
        if (!isValidDailyRecord(r)) continue;
        const period = getProductionPeriodFromValue(r.movement_date);
        if (!period || period.year !== comp.year || period.month !== comp.month) continue;
        linhas += 1;
        if (ateDia != null) {
          const dia = Number(String(r.movement_date).slice(8, 10));
          if (!(dia >= 1 && dia <= ateDia)) continue;
        }
        total += toNumber(r.net_value);
      }
      return { total: roundMoney(total), linhas };
    }

    // FASE 2.2 — o MESMO recorte, para a comissao de SEGURO. Mesma iteracao,
    // mesmo predicado de validade, mesmo filtro de dia; muda so a coluna somada.
    // A comissao de seguro ja nasce POR REGISTRO no daily
    // (insurance_commission_amount), entao aqui nao ha nada a derivar nem a
    // aproximar — e o mesmo tipo de corte exato que a producao ja fazia.
    function somaSeguroDailyRecortado(
      comp: { year: number; month: number },
      ateDia: number | null
    ) {
      let total = 0;
      let linhas = 0;
      for (const r of dailyRecorte || []) {
        if (!r.company_id || !activeIds.has(r.company_id)) continue;
        if (!isProductionStatus(r.status)) continue;
        if (!isValidDailyRecord(r)) continue;
        const period = getProductionPeriodFromValue(r.movement_date);
        if (!period || period.year !== comp.year || period.month !== comp.month) continue;
        linhas += 1;
        if (ateDia != null) {
          const dia = Number(String(r.movement_date).slice(8, 10));
          if (!(dia >= 1 && dia <= ateDia)) continue;
        }
        total += toNumber(r.insurance_commission_amount);
      }
      return { total: roundMoney(total), linhas };
    }

    let deltaProducao;
    if (janelaPedida.modo === "ate-dia-N") {
      const atual = somaDailyRecortado(competencia, janelaPedida.diaCorteAtual);
      const anterior = somaDailyRecortado(compAnterior, janelaPedida.diaCorteAnterior);
      // O recorte exige daily nas DUAS pontas. jan/fev/mar/mai de 2026 nao tem
      // daily nenhum — ali o corte por dia e impossivel e o card cai para
      // mes-cheio ROTULADO, em vez de comparar contra um zero inventado.
      const temDailyNasDuas = atual.linhas > 0 && anterior.linhas > 0;
      if (temDailyNasDuas) {
        deltaProducao = deltaDaSerie({
          serie: [
            { year: compAnterior.year, month: compAnterior.month, valor: anterior.total, fonte: "daily" },
            { year: competencia.year, month: competencia.month, valor: atual.total, fonte: "daily" },
          ],
          competencia,
          janela: janelaPedida,
        });
      } else {
        deltaProducao = deltaDaSerie({
          serie: serieProducaoCheia,
          competencia,
          janela: resolverJanela({ competencia, modo: "ate-dia-N", dia: agora.day, recorteIndisponivel: true }),
          // BORDA DE MES VAZIO — quantas linhas a competencia atual tem no
          // daily, INTEIRA (somaDailyRecortado conta antes de aplicar o corte
          // por dia). Zero aqui = nada importado, e o helper esconde o delta em
          // vez de exibir "-100%" contra o mes anterior cheio.
          //
          // Este ramo e justamente o que roda quando falta daily em alguma
          // ponta, e desde que a competencia renderizada passou a existir em
          // producaoMensal o ponto atual vem materializado em ZERO — sem esta
          // contagem, ausencia de importacao viraria queda de desempenho.
          linhasOrigemAtual: atual.linhas,
        });
      }
    } else {
      // Competencia FECHADA (ou navegacao para mes passado): mes-cheio, caminho
      // da Fase 1 inalterado.
      deltaProducao = deltaDaSerie({ serie: serieProducaoCheia, competencia });
    }

    // COMISSAO-EMPRESA — nao ha serie pronta (a fonte muda com o regime da
    // competencia). As duas pontas passam pelos MESMOS leitores extraidos
    // acima; a fonte de cada ponta viaja junto para a tela poder sinalizar
    // comparacao cross-source.
    //
    // ==================== MEDIDA C — A LIGACAO (27/07/2026) ====================
    //
    // Historico curto: este bloco ja disse "DECISAO FECHADA — NAO REABRIR",
    // defendendo mes-cheio para sempre. Diego reverteu em 26/07; a funcao
    // calcularComissaoEmpresaRecortada nasceu em 26/07 e ficou SEM CHAMADOR ate
    // aqui. Agora tem.
    //
    // OS DOIS PARAMETROS SAO SEPARADOS — e o ponto todo:
    //   producaoMensalDoGrupo  vem do MES INTEIRO, nas DUAS competencias. Faixa
    //                          e conceito MENSAL: a TRP escalona por volume do
    //                          mes, nao por volume do pedaco olhado. Recortar a
    //                          base empurraria operacoes para faixa inferior e o
    //                          corte mudaria a TAXA, nao so a janela.
    //   ateDia                 decide apenas QUAIS LINHAS somam.
    //
    // MEDIDO ANTES DE LIGAR (scripts/medida-c-comissao-recortada.mts, dado ate
    // 24/07, TRP_SOURCE=db):
    //
    //   antes  jul CHEIO 179.842,54 (motor) x jun CHEIO 196.837,68 (fechamento)
    //          = -8,6%   <- janelas desiguais E fontes diferentes
    //   agora  jul 1-24   170.828,97          x jun 1-24   164.533,04
    //          = +3,8%   <- mesma janela, mesma fonte
    //
    // O sinal INVERTE. Nao por desempenho: por janela. O mesmo erro que a Fase
    // 2.1 matou na producao e a Fase 2.2 matou no seguro.
    //
    // O QUE A LIGACAO CUSTA, E POR QUE VALE. Recortar obriga a ponta do M-1 a
    // sair do MOTOR e nao do fechamento — o fechamento nao tem data por linha,
    // entao nao ha onde cortar. Trocar a fonte foi medido no mes INTEIRO de
    // junho, onde as duas existem: fechamento 196.837,68 x motor 197.864,39 =
    // +0,5% (R$ 1.026,71). O motor reproduz o mes fechado dentro de meio ponto,
    // entao a troca nao e o que move o numero — a janela e.
    //
    // A ancora de conferencia nao se perde: o valor do M-1 NAO APARECE na tela,
    // so entra na conta da variacao. O numero que o Diego confere contra o PDF
    // continua no /fechamento e na DRE, intocados.
    // ==========================================================================
    const janelaSemRecorte = resolverJanela({
      competencia,
      modo: modoJanelaPedido,
      dia: agora.day,
      recorteIndisponivel: modoJanelaPedido === "ate-dia-N",
    });

    // A base da FAIXA sai da lib, ao lado da regra — nao remontada aqui. Ver
    // calcularProducaoMensalDoGrupo.
    const producaoCheiaAtual = calcularProducaoMensalDoGrupo({
      records: dailyRecorte || [],
      competencia,
    });
    const producaoCheiaAnterior = calcularProducaoMensalDoGrupo({
      records: dailyRecorte || [],
      competencia: compAnterior,
    });

    // Provider da TRP: preload async 1x das competencias dos contratos do
    // recorte; o lookup dentro do derive segue sincrono. Com TRP_SOURCE=json
    // volta undefined e o motor le o JSON embutido, como sempre.
    const trpProviderRecorte = await buildTrpCreditProvider(
      (dailyRecorte || []).map((r) => r.contract_date)
    );

    let deltaComissaoEmpresa;
    if (janelaPedida.modo === "ate-dia-N") {
      const brutaAtual = calcularComissaoEmpresaRecortada({
        records: dailyRecorte || [],
        competencia,
        producaoMensalDoGrupo: producaoCheiaAtual.total,
        ateDia: janelaPedida.diaCorteAtual,
        trpProvider: trpProviderRecorte,
      });
      const brutaAnterior = calcularComissaoEmpresaRecortada({
        records: dailyRecorte || [],
        competencia: compAnterior,
        producaoMensalDoGrupo: producaoCheiaAnterior.total,
        ateDia: janelaPedida.diaCorteAnterior,
        trpProvider: trpProviderRecorte,
      });

      // Exige linha nas DUAS pontas, igual a producao e ao seguro. Competencia
      // sem daily (jan/fev/mar/mai de 2026) cai para mes-cheio ROTULADO em vez
      // de comparar contra um zero inventado.
      if (brutaAtual.linhasSomadas > 0 && brutaAnterior.linhasSomadas > 0) {
        deltaComissaoEmpresa = calcularDelta({
          competencia,
          valorAtual: brutaAtual.total,
          valorAnterior: brutaAnterior.total,
          janela: janelaPedida,
          // As duas pontas saem do MESMO motor sobre o MESMO daily — a
          // comparacao deixa de ser cross-source. Por isso as duas fontes sao
          // iguais aqui, e a tela nao sinaliza mais mistura neste card.
          fonteAtual: "motor-recortado",
          fonteAnterior: "motor-recortado",
        });
      } else {
        deltaComissaoEmpresa = calcularDelta({
          competencia,
          valorAtual: comissaoBrutaEmpresa,
          valorAnterior: comissaoEmpresaAnterior,
          janela: janelaSemRecorte,
          fonteAtual: regime === "open" ? "motor-vivo" : regime,
          fonteAnterior: anteriorFechado ? regimeAnterior : null,
        });
      }
    } else {
      // Competencia FECHADA (ou navegacao para mes passado): os dois lados sao
      // totais finais. Nada a recortar — caminho da Fase 1 inalterado.
      deltaComissaoEmpresa = calcularDelta({
        competencia,
        valorAtual: comissaoBrutaEmpresa,
        valorAnterior: comissaoEmpresaAnterior,
        janela: janelaSemRecorte,
        fonteAtual: regime === "open" ? "motor-vivo" : regime,
        fonteAnterior: anteriorFechado ? regimeAnterior : null,
      });
    }

    // ---- SEGURO (Fase 2.2) — RECORTA por dia, como a producao ----
    // A comissao de seguro existe POR REGISTRO no daily, com movement_date.
    // Nao ha derive nem taxa dependente do volume mensal: e soma direta de
    // coluna. Entao as duas pontas saem da MESMA query, com o MESMO predicado,
    // e so o filtro de dia muda — a mesma garantia da producao.
    //
    // O QUE ISSO CORRIGE, medido em 26/07/2026 (dado carregado ate 23/07):
    //   antes  julho parcial 3.907,15 x junho CHEIO 4.372,62 = -10,6%
    //   agora  julho 1-23    3.907,15 x junho 1-23  3.828,64 = +2,0%
    // O sinal invertia por janela desigual, nao por desempenho — o mesmo erro
    // que a Fase 2.1 ja tinha matado na producao.
    //
    // O valor recortado nao reconcilia com o total do proprio card, e nao deve:
    // o corte <= N exclui o dia-cabeca da competencia nos DOIS lados.
    let deltaComissaoSeguro;
    if (janelaPedida.modo === "ate-dia-N") {
      const seguroAtual = somaSeguroDailyRecortado(competencia, janelaPedida.diaCorteAtual);
      const seguroAnterior = somaSeguroDailyRecortado(
        compAnterior,
        janelaPedida.diaCorteAnterior
      );
      // Exige daily nas DUAS pontas — competencia sem daily (jan/fev/mar/mai de
      // 2026) cai para mes-cheio ROTULADO em vez de comparar contra zero.
      if (seguroAtual.linhas > 0 && seguroAnterior.linhas > 0) {
        deltaComissaoSeguro = calcularDelta({
          competencia,
          valorAtual: seguroAtual.total,
          valorAnterior: seguroAnterior.total,
          janela: janelaPedida,
          fonteAtual: "daily",
          fonteAnterior: "daily",
        });
      } else {
        deltaComissaoSeguro = calcularDelta({
          competencia,
          valorAtual: comissaoSeguroGrupo,
          valorAnterior: seguroEmpresaAnterior,
          janela: janelaSemRecorte,
          fonteAtual: monthClosed ? "fechamento" : "daily-vivo",
          fonteAnterior: anteriorFechado ? "fechamento" : null,
        });
      }
    } else {
      // Competencia FECHADA: os dois lados sao totais finais do fechamento.
      deltaComissaoSeguro = calcularDelta({
        competencia,
        valorAtual: comissaoSeguroGrupo,
        valorAnterior: seguroEmpresaAnterior,
        janela: janelaSemRecorte,
        fonteAtual: monthClosed ? "fechamento" : "daily-vivo",
        fonteAnterior: anteriorFechado ? "fechamento" : null,
      });
    }

    // ---- PREVISAO DE RECEITA vs RECEITA REALIZADA do M-1 (3b) ----
    // DECISAO DO DIEGO, opcao (ii): a previsao de julho se compara com a
    // receita REALIZADA de junho. Responde a pergunta do negocio ("vou fechar
    // acima ou abaixo do mes passado?") e usa a mesma gramatica "vs junho" do
    // resto do sistema. As alternativas foram recusadas: comparar com a
    // previsao que se fazia em junho mede o previsor, nao o negocio (e o
    // vintage congelado nem esta guardado); comparar com o realizado do
    // PROPRIO julho e taxa de atingimento, que o /projecao ja mostra com
    // semaforo.
    //
    // AS DUAS PONTAS SAO MES-CHEIO, e este card e o UNICO assim: previsao e
    // projecao de mes inteiro, e o realizado do M-1 e mes fechado. Por isso vai
    // sem janela (JANELA_CHEIA) — rotuloJanela devolve null e o card NAO mostra
    // "1-23" como os outros. Mostrar recorte aqui seria mentira.
    //
    // As pontas sao metricas DIFERENTES de proposito (previsto x realizado), o
    // que e atipico para este modulo. Por isso as fontes viajam com nomes
    // distintos: fontesDivergentes vem true e a tela tem como sinalizar.
    // Componente a componente: previsao = expectedCash+expectedPrt+
    // expectedInsurance; realizado = actualCash+actualPrt+actualInsurance.
    const receitaRealizadaAnterior = (() => {
      const linhas = (closingPayload.companyRows || []).filter(
        (r) => r.year === compAnterior.year && r.month === compAnterior.month
      );
      if (linhas.length === 0) return null;
      return roundMoney(
        linhas.reduce(
          (sum, r) =>
            sum +
            toNumber(r.actualCash) +
            toNumber(r.actualPrt) +
            toNumber(r.actualInsurance),
          0
        )
      );
    })();

    const deltaPrevisaoReceita = calcularDelta({
      competencia,
      valorAtual: previsaoReceita,
      valorAnterior: receitaRealizadaAnterior,
      fonteAtual: "previsao",
      fonteAnterior: "realizado",
    });

    return NextResponse.json({
      periodoLabel: competenciaEfetiva.label,
      // MOV 2 (A): a competência renderizada e o regime dela — a tela usa para
      // montar o seletor e para rotular a origem do número.
      year,
      month,
      regime,
      // COMPETENCIA CANONICA — a competência EFETIVA inteira (key/label/regime/
      // parcial) + o espelho do que o analytics resolveu. A tela rotula A PARTIR
      // daqui, em vez de remontar de year/month ou de escrever literal fixo.
      competencia: competenciaEfetiva,
      // RITMO DIARIO DO GRUPO — duas metas. Ver o bloco de calculo acima.
      ritmoGrupo,
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
      // 3b — previsao (mes-cheio) x receita realizada do M-1 (mes-cheio).
      // Sem rotulo de janela de proposito; ver o comentario no calculo.
      deltaPrevisaoReceita,
      receitaRealizadaAnterior,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
