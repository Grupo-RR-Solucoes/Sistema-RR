import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllRows } from "@/lib/queryHelpers";
import { nowInFortaleza } from "@/lib/dateFortaleza";
import { BBTS_COMPANY_ID } from "@/lib/bbtsClosingImport";
import { getProductionPeriodFromValue, getProductionPeriodKey } from "@/lib/productionPeriod";
import { getSupabaseAdmin, hasSupabaseEnv } from "@/lib/supabaseAdmin";

const MONTH_NAMES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

type CompanyRow = {
  id: string;
  name: string;
  cnpj: string;
  active?: boolean | null;
};

type ClosingRow = {
  empresa_cnpj: string;
  ano: number;
  mes: number;
  valor_avista?: number | null;
  valor_diferido?: number | null;
  valor_seguro?: number | null;
  valor_estorno?: number | null;
  valor_renovacao?: number | null;
  valor_liquido?: number | null;
  // Fase 2C — campos por produto (caixa soma ao valor_liquido na mesma competência).
  valor_consorcio?: number | null;
  valor_bbcap?: number | null;
  valor_conta_corrente?: number | null;
  valor_dental?: number | null;
  valor_lob?: number | null;
  valor_credito?: number | null;
};

type AdsDailyRow = {
  bbts_pag_avista?: number | null;
  bbts_seguro_pago?: number | null;
  movement_date?: string | null;
  contract_date?: string | null;
  proposal_date?: string | null;
};

type AdsPrtRow = {
  competencia?: string | null;
  valor_parcela?: number | null;
};

// Cabecalho "Valor para Emissao da Nota Fiscal" do PDF de credito, por competencia.
// A Abertura de Conta e grandeza de COMPETENCIA, nao de contrato — por isso vem de
// tabela propria e nao de daily_production_records. Mesma chave do PRT.
type AdsCabecalhoRow = {
  competencia?: string | null;
  abertura_conta?: number | null;
};

type ExpenseCategoryRow = {
  id: string;
  name: string;
  is_default?: boolean | null;
  active?: boolean | null;
};

type ExpenseRow = {
  id: string;
  company_id?: string | null;
  year: number;
  month: number;
  category_id?: string | null;
  scope?: string | null;
  description: string;
  amount?: number | null;
  due_date?: string | null;
  payment_date?: string | null;
  status?: string | null;
  notes?: string | null;
  created_at?: string | null;
};

type OpeningBalanceRow = {
  id: string;
  company_id?: string | null;
  year: number;
  month: number;
  opening_balance?: number | null;
  created_at?: string | null;
};

type DeferredRow = {
  id: string;
  valor?: number | null;
  status?: string | null;
  data_prevista?: string | null;
};

// Receita manual (consorcio/ajustes). Regime de caixa: alocada pelo MES de
// data_credito (sem defasagem M+1 — data_credito ja e o mes de caixa).
type ManualRevenueRow = {
  ano?: number | null;
  mes?: number | null;
  valor?: number | null;
  data_credito?: string | null;
  company_id?: string | null;
  categoria?: string | null;
  descricao?: string | null;
};

export type FinancePeriodOption = {
  key: string;
  label: string;
  year: number;
  month: number;
};

export type FinanceSummary = {
  periodLabel: string;
  openingBalance: number;
  receivedNet: number;
  receivedClosing: number;
  receivedLiquido: number;
  receivedProdutos: number;
  receivedManual: number;
  // INFORMATIVO — "do qual seguro" do Recebido: Σ valor_seguro dos MESMOS
  // fechamentos M-1 que compoem receivedLiquido. JA dentro de receivedNet —
  // NAO somar. Difere de actualInsurance (que e competencia M, descasada).
  receivedInsurance: number;
  // COMISSOES RECEBIDAS PELA EMPRESA (M-1) = Σ (valor_avista + valor_seguro) do
  // fechamento M-1. So o que gera repasse (PRT/valor_diferido fora). SUBCONJUNTO do
  // Recebido. Base de comparacao com comissoesPagas (entrada x saida). receivedInsurance
  // e um "do qual" DESTE card.
  receivedEmpresa: number;
  actualCash: number;
  actualPrt: number;
  actualInsurance: number;
  actualEstorno: number;
  actualRenewal: number;
  totalExpenses: number;
  paidExpenses: number;
  pendingExpenses: number;
  comissoesPagas: number;
  // INFORMATIVO — "do qual seguro" do repasse: Σ PMR.insurance_commission_value
  // da competencia M-1, a MESMA de comissoesPagas (os dois leem o mesmo
  // prevSelKey). JA dentro de comissoesPagas (final = producao + seguro) —
  // NAO somar.
  //
  // ATENCAO ao ler codigo antigo: ate a CORRECAO B este campo era competencia M
  // e o comentario aqui dizia "Competencia M, nao M-1". A CORRECAO B moveu
  // comissoesPagas e este campo para M-1 (ver o calculo em ~linha 620, que
  // registra "antes lia M, ficaria descasado do liquido agora deslocado") e o
  // comentario ficou para tras. Conferido em 26/07/2026: comissoesPagas,
  // paidInsuranceShare e receivedEmpresa leem os TRES a competencia M-1, entao
  // o card "Saldo de comissoes a vista" (receivedEmpresa − comissoesPagas)
  // subtrai a mesma competencia dos dois lados. O numero esta CERTO — nao
  // "conserte" o deslocamento achando que ha competencia cruzada aqui.
  paidInsuranceShare: number;
  operatingResult: number;
  cashBalance: number;
  futureDeferredBalance: number;
  companiesCount: number;
  expensesCount: number;
};

export type FinanceCategoryTotal = {
  label: string;
  value: number;
};

export type FinanceCashTrendPoint = {
  key: string;
  label: string;
  openingBalance: number;
  receivedNet: number;
  totalExpenses: number;
  paidExpenses: number;
  comissoesPagas: number;
  cashBalance: number;
};

export type FinanceCompanyRow = {
  id: string;
  label: string;
  cnpj?: string;
  scope: "GROUP" | "COMPANY";
  openingBalance: number;
  receivedNet: number;
  totalExpenses: number;
  paidExpenses: number;
  netResult: number;
  cashBalance: number;
};

export type FinanceExpenseRow = {
  id: string;
  scope: "GROUP" | "COMPANY";
  company_id?: string | null;
  company_name: string;
  company_cnpj?: string;
  category_id?: string | null;
  category_name: string;
  description: string;
  amount: number;
  due_date?: string | null;
  payment_date?: string | null;
  status: string;
  notes?: string | null;
  created_at?: string | null;
};

export type FinanceOpeningBalanceItem = {
  id: string;
  scope: "GROUP" | "COMPANY";
  company_id?: string | null;
  company_name: string;
  company_cnpj?: string;
  opening_balance: number;
  created_at?: string | null;
};

export type FinancialAnalyticsPayload = {
  periods: FinancePeriodOption[];
  selectedPeriod: FinancePeriodOption;
  summary: FinanceSummary;
  /** matriz EMPRESA x COMPONENTE, entrada e saida. Ver o bloco DETALHAMENTO. */
  detalhamento: FinanceDetalhamento;
  categoryTotals: FinanceCategoryTotal[];
  cashTrend: FinanceCashTrendPoint[];
  companyRows: FinanceCompanyRow[];
  expenseRows: FinanceExpenseRow[];
  openingBalanceRows: FinanceOpeningBalanceItem[];
  categories: ExpenseCategoryRow[];
  companies: CompanyRow[];
  alerts: string[];
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function getPeriodKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getPeriodLabel(year: number, month: number) {
  return `${MONTH_NAMES[month - 1]}/${String(year).slice(-2)}`;
}

function comparePeriods(a: { year: number; month: number }, b: { year: number; month: number }) {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

// ============================================================
// REGIME DE CAIXA (Etapa 3) — "Recebido" do /financeiro.
// Caixa do mes M = fechamento da competencia M-1 (defasagem M+1) + receita
// manual com data_credito dentro de M (manual nao tem defasagem). So o
// "Recebido" muda; despesas/saldo/diferido/comissoes seguem como estao.
// ============================================================

// competencia anterior (M-1): se M=jan -> dez do ano anterior.
function prevCompetencia(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// LIQUIDO por competencia = Σ final_commission_value (PMR) − Σ debitos
// (promoter_discounts, apply_to_company !== true). MESMA formula do promoterAnalytics
// (so a parte do debito). NAO filtra ativos/source — preserva o CONJUNTO de linhas do
// PMR que a Caixa ja soma. Debitos (adiantamento/cancelamento seguro) sao parcelas em
// promoter_discounts (com debit_id). Helper LEVE: opera sobre os dados JA carregados
// (pmrRows) + a query de promoter_discounts, sem chamar loadPromoterAnalyticsBase.
function payableByCompetencia(
  pmrRows: Array<{
    year: number;
    month: number;
    final_commission_value: number | null;
    promoter_id?: string | null;
    piso_zerou?: boolean | null;
  }>,
  discountRows: Array<{
    year: number;
    month: number;
    amount: number | null;
    apply_to_company: boolean | null;
    promoter_id?: string | null;
  }>
): { payableByPeriod: Map<string, number>; finalByPeriod: Map<string, number>; discountByPeriod: Map<string, number> } {
  const finalByPeriod = new Map<string, number>();
  // PISO DE REPASSE, por (promotor, competencia): quando o piso zera o repasse, o
  // desconto NAO acontece (ver promoterAnalytics, "PISO ZEROU O REPASSE"). Sem
  // isto o Caixa pagaria um liquido NEGATIVO — e o DRE, que ja suprime, diria
  // outro numero.
  const pisoZerouPorCompetencia = new Set<string>();
  for (const r of pmrRows) {
    const k = getPeriodKey(r.year, r.month);
    finalByPeriod.set(k, toNumber(finalByPeriod.get(k)) + toNumber(r.final_commission_value));
    if (r.piso_zerou === true && r.promoter_id) pisoZerouPorCompetencia.add(`${r.promoter_id}|${k}`);
  }
  const discountByPeriod = new Map<string, number>();
  for (const d of discountRows) {
    if (d.apply_to_company === true) continue; // debito da EMPRESA nao abate o repasse
    const k = getPeriodKey(d.year, d.month);
    if (d.promoter_id && pisoZerouPorCompetencia.has(`${d.promoter_id}|${k}`)) continue;
    discountByPeriod.set(k, toNumber(discountByPeriod.get(k)) + toNumber(d.amount));
  }
  const payableByPeriod = new Map<string, number>();
  for (const k of new Set<string>([...finalByPeriod.keys(), ...discountByPeriod.keys()])) {
    payableByPeriod.set(k, toNumber(finalByPeriod.get(k)) - toNumber(discountByPeriod.get(k)));
  }
  return { payableByPeriod, finalByPeriod, discountByPeriod };
}

// Σ liquido do fechamento (com o mesmo fallback ja usado: valor_liquido OU
// avista+diferido+seguro-estorno-renovacao). valor_liquido JA e liquido de
// estorno — o estorno acompanha o mesmo deslocamento, nada separado.
function sumClosingNet(rows: ClosingRow[]) {
  return rows.reduce(
    (sum, row) =>
      sum +
      (toNumber(row.valor_liquido) ||
        toNumber(row.valor_avista) +
          toNumber(row.valor_diferido) +
          toNumber(row.valor_seguro) -
          toNumber(row.valor_estorno) -
          toNumber(row.valor_renovacao)),
    0
  );
}

// Fase 2C — Σ dos 6 campos por produto (consorcio/bbcap/conta_corrente/dental/
// lob/credito). Entram no caixa junto com valor_liquido, na MESMA competencia
// M-1 (o produto segue a mesma defasagem do fechamento). NAO estao em
// valor_liquido (que vem so do Resumo: avista+PRT+seguro-estorno-renovacao).
function sumClosingProdutos(rows: ClosingRow[]) {
  return rows.reduce(
    (sum, row) =>
      sum +
      toNumber(row.valor_consorcio) +
      toNumber(row.valor_bbcap) +
      toNumber(row.valor_conta_corrente) +
      toNumber(row.valor_dental) +
      toNumber(row.valor_lob) +
      toNumber(row.valor_credito),
    0
  );
}

// INFORMATIVO — Σ valor_seguro dos fechamentos (mesmas rows que sumClosingNet).
// "do qual seguro" do receivedLiquido; NAO entra em nenhum total, so segregacao.
function sumClosingInsurance(rows: ClosingRow[]) {
  return rows.reduce((sum, row) => sum + toNumber(row.valor_seguro), 0);
}

// mes de caixa de um lancamento manual: extrai ano/mes de data_credito
// (YYYY-MM-DD). Fallback p/ ano/mes da competencia se data_credito faltar.
function manualCreditYM(row: ManualRevenueRow): { year: number; month: number } | null {
  if (row.data_credito) {
    const [y, m] = String(row.data_credito).slice(0, 10).split("-").map(Number);
    if (y && m) return { year: y, month: m };
  }
  if (row.ano && row.mes) return { year: row.ano, month: row.mes };
  return null;
}

// ---- ADS/BBTS: a 5a empresa, que NAO tem linha em fechamento_mensal_empresa ----
//
// A ADS nao fatura pela Promotiva — fatura pela BBTS — e por isso NUNCA teve linha
// naquela tabela (medido 26/08/2026: 0 no historico inteiro, contra 44/24/21/11 das
// quatro RR). O Caixa somava so as 4 RR e ficava ~6,3% abaixo do realizado do grupo.
// O DRE ja compensava isso desde sempre, com bloco proprio (lib/dre.ts:314-365):
// eram duas telas do MESMO sistema respondendo diferente para a mesma competencia.
//
// O de-para com as colunas do RR — a MESMA semantica, fonte diferente:
//   valor_avista   -> daily_production_records.bbts_pag_avista
//   valor_diferido -> bbts_prt_parcelas.valor_parcela  (PRT)
//   valor_seguro   -> daily_production_records.bbts_seguro_pago
//
// COMPETENCIA por JANELA (getProductionPeriodFromValue), igual ao dre.ts: a linha
// de 30/06 e julho e a de 31/07 e agosto. Nao usar o mes de calendario.
//
// O de-para tem uma 4a perna desde 27/08/2026:
//   abertura_conta -> bbts_fechamento_totais.abertura_conta  (por competencia
//   LITERAL, igual ao PRT — nao ha contrato a que anexar).
//
// LIMITE CONHECIDO (medido, nao estimado):
//   - a Abertura de Conta so entra nas competencias cujo fechamento foi importado
//     DEPOIS da captura do cabecalho. Para as anteriores, reimportar o PDF de
//     credito. O check ads_cabecalho_nf_ausente (ledgerHealth) lista quais sao.
//   - os cancelamentos do PDF de seguro (-R$ 49,45 em jul/2026) nao sao abatidos
//     aqui: viram debito ao promotor.
type AdsCash = { avista: number; prt: number; seguro: number; abertura: number };

function buildAdsCashByPeriod(
  adsDaily: AdsDailyRow[],
  adsPrt: AdsPrtRow[],
  adsCabecalho: AdsCabecalhoRow[] = []
): Map<string, AdsCash> {
  const out = new Map<string, AdsCash>();
  const bucket = (k: string) => {
    let b = out.get(k);
    if (!b) { b = { avista: 0, prt: 0, seguro: 0, abertura: 0 }; out.set(k, b); }
    return b;
  };
  for (const r of adsDaily) {
    const p =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    if (!p) continue;
    const b = bucket(getProductionPeriodKey(p.year, p.month));
    b.avista += toNumber(r.bbts_pag_avista);
    b.seguro += toNumber(r.bbts_seguro_pago);
  }
  for (const r of adsPrt) {
    const comp = String(r.competencia || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(comp)) continue;
    bucket(comp).prt += toNumber(r.valor_parcela);
  }
  // Abertura de Conta: pela competencia LITERAL do fechamento, igual ao PRT — nao
  // pela janela. Sao os dois valores do cabecalho que nao tem contrato a que se
  // ancorar, entao seguem a mesma regra.
  for (const r of adsCabecalho) {
    const comp = String(r.competencia || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(comp)) continue;
    bucket(comp).abertura += toNumber(r.abertura_conta);
  }
  return out;
}

// ===========================================================================
// GRANDEZA DO CARD "Recebido" — HISTORICO DE DECISOES. NAO REABRIR SEM O DIEGO.
//
// [26/08/2026 TARDE — VIGENTE] "Recebido" = TUDO que entrou no caixa da empresa,
// de TODAS as gestoras (RR + ADS): comissao de credito + PRT + SEGURO + produtos.
//   - "Comissoes recebidas" = tudo que foi comissao, INCLUINDO seguro.
//   - "Comissoes pagas" = tudo que foi pago, incluindo o seguro repassado ao
//     promotor (ja era assim: final_commission_value soma producao + seguro +
//     produtos, e paidInsuranceShare e o Sigma insurance_commission_value).
//   - "Seguro recebido" e "Seguro repassado" sao DETALHE dentro dos totais: os
//     dois com rotulo "do qual", simetricos.
//
// [26/08/2026 MANHA — REVOGADA] O seguro tinha ficado FORA do "Recebido" e do
// "receivedEmpresa", virando linha independente ("a mais"). Revogada na mesma
// tarde. Fica registrada porque o codigo passou algumas horas assim e o
// test_caixa_recebido_empresa.cjs chegou a ser reescrito para ela — se aparecer
// um "a mais" solto em rotulo ou comentario, e residuo desta versao.
//
// O QUE O CARD NAO E: volume financiado. Em jul/2026 o financiado do grupo foi
// R$ 6.477.490,15 e a comissao R$ 299.736,82 — 4,63%. Se fosse desembolso o card
// mostraria milhoes.
//
// DE-PARA RR -> ADS (mesma semantica, fonte diferente):
//   valor_avista   -> daily_production_records.bbts_pag_avista
//   valor_diferido -> bbts_prt_parcelas.valor_parcela
//   valor_seguro   -> daily_production_records.bbts_seguro_pago
//
// DE-PARA RR -> ADS, 4a perna (27/08/2026):
//   abertura_conta -> bbts_fechamento_totais.abertura_conta
//
// ERRATA — a versao anterior deste bloco dizia "faltam R$ 139,97 da ADS em
// jul/2026", somando R$ 100,00 de Abertura com R$ 89,42 de linha so-seguro. A
// medicao de 27/08/2026 mostra que SO OS R$ 100,00 eram de julho:
//   - Abertura de Conta R$ 100,00 (competencia 2026-07): CONFIRMADO. Era isso que
//     separava o card do total do PDF (18.737,33 + 7,01 = 18.744,34 contra
//     18.844,34). Agora entra, via bbts_fechamento_totais.
//   - os R$ 89,42 da unica linha SO-SEGURO do banco (contrato 221262790) NAO
//     faltavam em julho: aquela linha esta com movement_date=2026-07-31, e a
//     janela manda 31/07 para AGOSTO. As 12 irmas dela, do mesmo fechamento,
//     estao em 2026-07-15. O importador ja grava a coluna; a linha existente
//     depende de decisao sobre a competencia (ver HANDOFF).
//   - os cancelamentos (-R$ 49,45) reduziram o pagamento da BBTS e nao sao abatidos
//     aqui: viram debito ao promotor.
// ===========================================================================
// "Recebido" (caixa) da competencia M: fechamento(M-1) + manuais(data_credito em M).
// receivedClosing = valor_liquido(M-1) + Σ produtos(M-1) + ADS(M-1).
function cashReceivedFor(
  year: number,
  month: number,
  allClosings: ClosingRow[],
  manualRows: ManualRevenueRow[],
  adsCashByPeriod: Map<string, AdsCash>
) {
  const prev = prevCompetencia(year, month);
  const closingRows = allClosings.filter((r) => r.ano === prev.year && r.mes === prev.month);
  const ads = adsCashByPeriod.get(getProductionPeriodKey(prev.year, prev.month)) ?? {
    avista: 0,
    prt: 0,
    seguro: 0,
    abertura: 0,
  };
  // ADS: avista + PRT + seguro = o analogo do valor_liquido do RR (que tambem soma
  // avista + diferido + seguro). Nao ha estorno/renovacao do lado da ADS.
  // ADS = a-vista + PRT + SEGURO — o analogo do valor_liquido do RR, que tambem
  // soma os tres. Nao ha estorno/renovacao do lado da ADS.
  const receivedAds = roundMoney(ads.avista + ads.prt + ads.seguro + ads.abertura);
  // RR: valor_liquido JA inclui valor_seguro. Nada a subtrair (decisao da tarde).
  const receivedLiquido = roundMoney(sumClosingNet(closingRows) + receivedAds);
  const receivedProdutos = roundMoney(sumClosingProdutos(closingRows));
  // INFORMATIVO: parcela de seguro JA dentro de receivedLiquido (mesmas M-1 rows).
  // "DO QUAL" seguro do Recebido — RR + ADS. E SUBCONJUNTO, nao soma de novo
  // (decisao de 26/08 tarde: o seguro voltou para dentro dos totais).
  const receivedInsurance = roundMoney(sumClosingInsurance(closingRows) + ads.seguro);
  // COMISSOES RECEBIDAS PELA EMPRESA (M-1) — so o que gera repasse ao promotor:
  // valor_avista + valor_seguro. PRT (valor_diferido) FICA DE FORA (e da empresa,
  // nao entra na comparacao com as comissoes pagas). E um SUBCONJUNTO do Recebido.
  // TODO (decisao Diego): abater valor_estorno? O Recebido usa valor_liquido (ja
  // liquido de estorno/renovacao); por ora receivedEmpresa e avista+seguro PURO.
  // A ADS entra AQUI TAMBEM, com o mesmo recorte do RR (avista + seguro, PRT fora).
  // Sem isto o "Recebido" passaria a incluir a ADS e as "Comissoes recebidas" nao —
  // e o card "Saldo de comissoes a vista" (receivedEmpresa - comissoesPagas) ficaria
  // comparando um lado COM a ADS contra um lado SEM, que e pior que o desalinho de
  // hoje (onde os dois ignoram a ADS por igual).
  // "a vista + seguro do fechamento M-1", dos DOIS lados. O PRT fica de fora aqui
  // (e da empresa, nao entra na comparacao com as comissoes pagas) — regra antiga
  // do RR, agora espelhada na ADS.
  const receivedEmpresa = roundMoney(
    closingRows.reduce((sum, r) => sum + toNumber(r.valor_avista) + toNumber(r.valor_seguro), 0) +
      ads.avista +
      ads.seguro
  );
  const receivedClosing = roundMoney(receivedLiquido + receivedProdutos);
  const receivedManual = roundMoney(
    manualRows.reduce((sum, row) => {
      const ym = manualCreditYM(row);
      return ym && ym.year === year && ym.month === month ? sum + toNumber(row.valor) : sum;
    }, 0)
  );
  return {
    receivedLiquido,
    receivedAds,
    receivedProdutos,
    receivedInsurance,
    receivedEmpresa,
    receivedClosing,
    receivedManual,
    receivedNet: roundMoney(receivedClosing + receivedManual),
  };
}

function isPaidExpense(row: ExpenseRow) {
  const status = normalizeText(row.status);
  return status === "PAID" || status === "PAGO" || Boolean(row.payment_date);
}

// COMPETENCIA CANONICA — esta funcao ja era o MODELO da sintese (year/month
// pedidos que nao existem viram periodo sintetizado, em vez de recuar para
// outro mes). O que faltava era o outro lado da regra: sem year/month ela
// devolvia `periods[0]`, isto e, "primeira da lista" — na pratica a competencia
// mais recente COM dado, nunca a corrente. Agora o default e o mes CORRENTE em
// America/Fortaleza (nao UTC: as 21h BRT o mes ja virava o seguinte), pela
// mesma sintese. Quem chama sem competencia passa a abrir no mes corrente,
// mesmo que ele ainda nao tenha lancamento nenhum.
function makeSelectedPeriod(periods: FinancePeriodOption[], year?: number, month?: number) {
  const agora = nowInFortaleza();
  const alvoYear = year && month ? year : agora.year;
  const alvoMonth = year && month ? month : agora.month;

  return (
    periods.find((period) => period.year === alvoYear && period.month === alvoMonth) || {
      key: getPeriodKey(alvoYear, alvoMonth),
      label: getPeriodLabel(alvoYear, alvoMonth),
      year: alvoYear,
      month: alvoMonth,
    }
  );
}

// ===========================================================================
// DETALHAMENTO — matriz EMPRESA x COMPONENTE, para ENTRADA e SAIDA.
//
// A PERGUNTA QUE ELA RESPONDE: "de onde veio cada real". "De onde" e EMPRESA —
// e como a NF e emitida e como o Diego somou a mao quando descobriu que a ADS
// faltava no Caixa. Por isso a leitura e POR LINHA: total de linha em destaque,
// total de coluna discreto.
//
// INVARIANTE, e ela e o motivo de a matriz existir: a soma da matriz e IGUAL ao
// card, ao centavo. Matriz que nao fecha e pior que matriz nenhuma — daria a
// impressao de explicar sem explicar. Por isso cada matriz carrega `total` e
// `cardTotal`, e a tela mostra os dois lado a lado com o delta. Travado por
// scripts/financeiro_matriz_fecha_gate.cjs.
//
// SEM DELTA: nenhuma variacao vs mes anterior aqui. Regra transversal do projeto
// (delta so em card, nunca em tabela). O unico numero comparativo e a linha de
// conferencia, que e reconciliacao da MESMA competencia, nao serie temporal.
//
// LANCAMENTOS AVULSOS EM LINHA PROPRIA (decisao do Diego, 26/08/2026): a receita
// manual NAO e distribuida entre as empresas. Ela tem company_id no banco, mas e
// de outra natureza — o ressarcimento de R$ 1.509,44 de jul/26, por exemplo, tem
// competencia de ORIGEM 06/2026 e caixa 07/2026. Diluir na linha da empresa
// esconderia isso. Fica embaixo, rotulada como avulsa.
// ===========================================================================
/**
 * Arredonda as celulas de uma linha e devolve o RESIDUO de centavos para a maior
 * celula em modulo, de forma que as celulas EXIBIDAS somem exatamente o total
 * EXIBIDO.
 *
 * POR QUE ISTO EXISTE. O card faz `round(Sigma A) - round(Sigma B)`; a matriz faz
 * `Sigma round(A_empresa - B_empresa)`. As duas contas divergem em centavos por
 * acumulo — medido: jul/2026 dava matriz 115.936,95 contra card 115.936,94. Um
 * centavo num total de R$ 115 mil e irrelevante como dinheiro e FATAL como matriz:
 * o Diego confere somando a coluna, e o que nao fecha ele nao usa.
 *
 * A escolha de jogar na MAIOR celula (e nao pro-rata) e deliberada: concentra o
 * residuo onde ele e proporcionalmente invisivel, em vez de espalhar erro por
 * todas. Nao muda nenhum total — so redistribui centavo DENTRO da linha.
 */
function fecharLinha(
  celulasRaw: Record<string, number>,
  totalRaw: number
): { celulas: Record<string, number>; total: number } {
  const celulas: Record<string, number> = {};
  for (const [k, v] of Object.entries(celulasRaw)) celulas[k] = roundMoney(v);
  const total = roundMoney(totalRaw);
  const soma = roundMoney(Object.values(celulas).reduce((a, v) => a + v, 0));
  const residuo = roundMoney(total - soma);
  if (residuo !== 0) {
    let alvo = "";
    let maior = -1;
    for (const [k, v] of Object.entries(celulas)) {
      if (Math.abs(v) > maior) {
        maior = Math.abs(v);
        alvo = k;
      }
    }
    if (alvo) celulas[alvo] = roundMoney(celulas[alvo] + residuo);
  }
  return { celulas, total };
}

export type MatrizCelula = { chave: string; rotulo: string; valor: number };
export type MatrizLinha = {
  chave: string;
  rotulo: string;
  /** true = lancamento avulso (nao e producao de empresa) */
  avulso?: boolean;
  celulas: Record<string, number>;
  /** desdobramento da coluna "outros", para a expansao na propria linha */
  outrosDetalhe: MatrizCelula[];
  total: number;
};
export type MatrizColuna = {
  chave: string;
  rotulo: string;
  expansivel?: boolean;
  /** de onde o numero sai. Exibido no rodape da matriz. */
  fonte?: string;
  /** marca discreta na coluna (ex.: "*") ligando a nota de rodape. */
  marca?: string;
};
export type Matriz = {
  titulo: string;
  subtitulo: string;
  /** rodape: o que a marca "*" significa. */
  notaMarca?: string;
  colunas: MatrizColuna[];
  linhas: MatrizLinha[];
  totaisColuna: Record<string, number>;
  /** soma da matriz */
  total: number;
  /** o card correspondente — a matriz TEM de bater com ele */
  cardTotal: number;
  /** total - cardTotal; 0,00 quando fecha */
  delta: number;
};
export type FinanceDetalhamento = { entrada: Matriz; saida: Matriz; despesa: Matriz };

export async function buildFinancialAnalytics(
  supabase: SupabaseClient,
  filters?: {
    year?: number;
    month?: number;
  }
): Promise<FinancialAnalyticsPayload> {
  const [companies, categories, closings, expenses, openingBalances, deferredRows, pmrRows, manualRevenues, discountRows] =
    await Promise.all([
      fetchAllRows<CompanyRow>(() =>
        supabase
          .from("companies")
          .select("id, name, cnpj, active")
          .order("name", { ascending: true })
      ),
      fetchAllRows<ExpenseCategoryRow>(() =>
        supabase
          .from("expense_categories")
          .select("id, name, is_default, active")
          .eq("active", true)
          .order("name", { ascending: true })
      ),
      fetchAllRows<ClosingRow>(() =>
        supabase
          .from("fechamento_mensal_empresa")
          .select(
            "empresa_cnpj, ano, mes, valor_avista, valor_diferido, valor_seguro, valor_estorno, valor_renovacao, valor_liquido, valor_consorcio, valor_bbcap, valor_conta_corrente, valor_dental, valor_lob, valor_credito"
          )
          .order("ano", { ascending: true })
          .order("mes", { ascending: true })
          .order("empresa_cnpj", { ascending: true })
      ),
      fetchAllRows<ExpenseRow>(() =>
        supabase
          .from("financial_expenses")
          .select(
            "id, company_id, year, month, category_id, scope, description, amount, due_date, payment_date, status, notes, created_at"
          )
          .order("year", { ascending: true })
          .order("month", { ascending: true })
          .order("created_at", { ascending: false })
      ),
      fetchAllRows<OpeningBalanceRow>(() =>
        supabase
          .from("cash_opening_balances")
          .select("id, company_id, year, month, opening_balance, created_at")
          .order("year", { ascending: true })
          .order("month", { ascending: true })
          .order("created_at", { ascending: false })
      ),
      fetchAllRows<DeferredRow>(() =>
        supabase
          .from("diferido_parcelas")
          .select("id, valor, status, data_prevista")
          .order("data_prevista", { ascending: true })
      ),
      // COMISSÃO PAGA (repasse aos promotores) — saída de caixa real. Mesma base
      // da DRE: payable = final_commission_value − discount_value (cms/motor) por
      // competência (payable_commission_value é campo computado, não coluna).
      fetchAllRows<{
        year: number;
        month: number;
        company_id: string | null;
        promoter_id: string | null;
        final_commission_value: number | null;
        discount_value: number | null;
        insurance_commission_value: number | null;
        piso_zerou: boolean | null;
      }>(() =>
        supabase
          .from("promoter_monthly_results")
          .select("year, month, company_id, promoter_id, final_commission_value, discount_value, insurance_commission_value, production_commission_value, bbcap_commission_value, conta_corrente_commission_value, consorcio_commission_value, lob_commission_value, piso_zerou")
          // DEFESA EM PROFUNDIDADE (#13): exclui source='daily'. O Caixa e o DRE
          // devem ver o MESMO conjunto (o DRE ja filtra source IN ('fechamento',
          // 'bbts')). 'daily' so existe no mes ABERTO e nunca e caixa pago; se um
          // dia sobrevivesse numa competencia fechada (o Mov 1 impede hoje), esta
          // soma o DOBRARIA em silencio. Excluir por FILTRO torna isso impossivel,
          // nao so improvavel. No-op hoje: nenhuma competencia fechada tem daily.
          .neq("source", "daily")
      ),
      // RECEITA MANUAL (consórcio/ajustes) — entra no "Recebido" (caixa) pelo
      // mês de data_credito (Etapa 3). Aditiva ao fechamento, sem defasagem.
      fetchAllRows<ManualRevenueRow>(() =>
        supabase
          .from("receita_lancamento_manual")
          .select("ano, mes, valor, data_credito, company_id, categoria, descricao")
      ),
      // DEBITOS do repasse (adiantamento/cancelamento seguro/etc.) — parcelas em
      // promoter_discounts. Abatidos do LIQUIDO por competencia (correcao B do caixa:
      // comissoes pagas do mes M = liquido da competencia M-1). apply_to_company !== true.
      fetchAllRows<{ year: number; month: number; amount: number | null; apply_to_company: boolean | null; promoter_id: string | null; company_id: string | null }>(() =>
        supabase
          .from("promoter_discounts")
          .select("year, month, amount, apply_to_company, promoter_id, company_id")
      ),

    ]);

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const companyByCnpj = new Map(companies.map((company) => [company.cnpj, company]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  // COMISSAO PAGA (saida de caixa) = LIQUIDO por competencia = Σ final_commission_value
  // − Σ debitos (promoter_discounts). O caixa do mes M usa o LIQUIDO da competencia
  // M-1 (mesma do "Recebido"); o deslocamento M-1 acontece no consumo (:comissoesPagas
  // e no cashTrend), aqui so montamos o mapa por competencia.
  const { payableByPeriod } = payableByCompetencia(pmrRows, discountRows);
  // INFORMATIVO: parcela de seguro do repasse por competencia (subcomponente do
  // liquido, "do qual seguro"). Consumido tambem em M-1 (mesma competencia do liquido).
  const comissaoSeguroByPeriod = new Map<string, number>();
  for (const row of pmrRows) {
    const k = getPeriodKey(row.year, row.month);
    comissaoSeguroByPeriod.set(
      k,
      toNumber(comissaoSeguroByPeriod.get(k)) + toNumber(row.insurance_commission_value)
    );
  }

  const periodMap = new Map<string, FinancePeriodOption>();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  for (const row of closings) {
    periodMap.set(getPeriodKey(row.ano, row.mes), {
      key: getPeriodKey(row.ano, row.mes),
      label: getPeriodLabel(row.ano, row.mes),
      year: row.ano,
      month: row.mes,
    });
  }

  for (const row of expenses) {
    periodMap.set(getPeriodKey(row.year, row.month), {
      key: getPeriodKey(row.year, row.month),
      label: getPeriodLabel(row.year, row.month),
      year: row.year,
      month: row.month,
    });
  }

  for (const row of openingBalances) {
    periodMap.set(getPeriodKey(row.year, row.month), {
      key: getPeriodKey(row.year, row.month),
      label: getPeriodLabel(row.year, row.month),
      year: row.year,
      month: row.month,
    });
  }

  if (periodMap.size === 0) {
    periodMap.set(getPeriodKey(currentYear, currentMonth), {
      key: getPeriodKey(currentYear, currentMonth),
      label: getPeriodLabel(currentYear, currentMonth),
      year: currentYear,
      month: currentMonth,
    });
  }

  const periods = Array.from(periodMap.values()).sort((a, b) => comparePeriods(b, a));
  const selectedPeriod = makeSelectedPeriod(periods, filters?.year, filters?.month);

  if (!periodMap.has(selectedPeriod.key)) {
    periods.unshift(selectedPeriod);
  }

  const selectedClosings = closings.filter(
    (row) => row.ano === selectedPeriod.year && row.mes === selectedPeriod.month
  );
  const selectedExpenses = expenses.filter(
    (row) => row.year === selectedPeriod.year && row.month === selectedPeriod.month
  );
  const selectedOpenings = openingBalances.filter(
    (row) => row.year === selectedPeriod.year && row.month === selectedPeriod.month
  );

  // actual* (avista/PRT/seguro/estorno/renovacao) seguem da competencia ATUAL —
  // fora do escopo desta etapa (so o "Recebido"/receivedNet vira regime de caixa).
  const receivedSummary = selectedClosings.reduce(
    (acc, row) => {
      acc.actualCash += toNumber(row.valor_avista);
      acc.actualPrt += toNumber(row.valor_diferido);
      acc.actualInsurance += toNumber(row.valor_seguro);
      acc.actualEstorno += toNumber(row.valor_estorno);
      acc.actualRenewal += toNumber(row.valor_renovacao);
      return acc;
    },
    {
      actualCash: 0,
      actualPrt: 0,
      actualInsurance: 0,
      actualEstorno: 0,
      actualRenewal: 0,
    }
  );

  // ============================================================================
  // LEITURA DA ADS — service_role DIRIGIDO, so para estas duas fontes.
  //
  // POR QUE NAO PELO CLIENTE DA PAGINA. `bbts_prt_parcelas` esta com RLS
  // default-deny e ZERO politicas, DE PROPOSITO — a migration que a criou diz
  // "RLS default-deny (so service_role)" (20260712_000004:40) e ate prevê, na
  // verificacao pos-execucao, `select count(*) from pg_policies ... -- 0`. As 4
  // rotas que chamam esta funcao usam guard ANON (papel `authenticated`), entao
  // ler a tabela por elas devolve 42501 "permission denied" e derruba a tela
  // INTEIRA — aconteceu em 26/08/2026, no /financeiro.
  //
  // A ALTERNATIVA REJEITADA foi abrir policy na tabela: ela e a unica do grupo
  // deliberadamente fechada, e afrouxar isso de passagem, dentro de um conserto de
  // card, e mudanca que merece contexto proprio. Decisao do Diego, 26/08/2026.
  //
  // NAO E ESCALADA DE PRIVILEGIO: a AUTORIZACAO continua no guard de cada rota
  // (socio ou funcionario, ja exigido antes de chegar aqui); o que muda e so o
  // canal de leitura de dois agregados. Mesmo padrao ja usado em
  // app/api/dre/route.ts:8-13 (cms_imports) e app/api/promotores/route.ts:98.
  //
  // `daily_production_records` teria grant para `authenticated` (o Dashboard a le
  // pelo caminho anon em app/api/dashboard/route.ts:330), mas vai pelo MESMO
  // cliente de proposito: as duas fontes compoem UM numero, e le-las por canais
  // diferentes deixaria o card meio-preenchido se so uma falhasse.
  //
  // Sem env de service_role (build/preview), a ADS entra como ZERO em vez de
  // derrubar a pagina — o card fica incompleto, nunca quebrado.
  // ============================================================================
  let adsDaily: AdsDailyRow[] = [];
  let adsPrt: AdsPrtRow[] = [];
  let adsCabecalho: AdsCabecalhoRow[] = [];
  if (hasSupabaseEnv()) {
    const admin = getSupabaseAdmin();
    [adsDaily, adsPrt, adsCabecalho] = await Promise.all([
      fetchAllRows<AdsDailyRow>(() =>
        admin
          .from("daily_production_records")
          .select("bbts_pag_avista, bbts_seguro_pago, movement_date, contract_date, proposal_date")
          .eq("company_id", BBTS_COMPANY_ID)
      ),
      fetchAllRows<AdsPrtRow>(() =>
        admin.from("bbts_prt_parcelas").select("competencia, valor_parcela").eq("company_id", BBTS_COMPANY_ID)
      ),
      // TOLERA APENAS A TABELA INEXISTENTE (migration ainda nao aplicada): nesse
      // caso a Abertura entra como 0 e o card fica como estava. Qualquer OUTRO
      // erro (RLS, grant, rede) e RELANCADO — engolir tudo esconderia justamente
      // o tipo de falha que ja zerou comissao de seguro em producao uma vez.
      fetchAllRows<AdsCabecalhoRow>(() =>
        admin
          .from("bbts_fechamento_totais")
          .select("competencia, abertura_conta")
          .eq("company_id", BBTS_COMPANY_ID)
      ).catch((e: unknown) => {
        const msg = String((e as Error)?.message || e);
        if (/schema cache|does not exist|PGRST205/i.test(msg)) return [] as AdsCabecalhoRow[];
        throw e;
      }),
    ]);
  }

  // ADS: um balde por competencia, construido UMA vez e reusado pelo KPI e pela
  // serie do grafico — os dois tem de ver o mesmo numero.
  const adsCashByPeriod = buildAdsCashByPeriod(adsDaily, adsPrt, adsCabecalho);

  // REGIME DE CAIXA: "Recebido" = fechamento(M-1) + ADS(M-1) + manuais(data_credito em M).
  const received = cashReceivedFor(
    selectedPeriod.year,
    selectedPeriod.month,
    closings,
    manualRevenues,
    adsCashByPeriod
  );

  const totalExpenses = roundMoney(
    selectedExpenses.reduce((sum, row) => sum + toNumber(row.amount), 0)
  );
  const paidExpenses = roundMoney(
    selectedExpenses.reduce(
      (sum, row) => sum + (isPaidExpense(row) ? toNumber(row.amount) : 0),
      0
    )
  );
  const pendingExpenses = roundMoney(totalExpenses - paidExpenses);
  const openingBalance = roundMoney(
    selectedOpenings.reduce((sum, row) => sum + toNumber(row.opening_balance), 0)
  );

  const periodStart = `${selectedPeriod.year}-${String(selectedPeriod.month).padStart(2, "0")}-01`;
  const futureDeferredBalance = roundMoney(
    deferredRows.reduce((sum, row) => {
      if (normalizeText(row.status) === "PAGO") {
        return sum;
      }

      if (row.data_prevista && row.data_prevista < periodStart) {
        return sum;
      }

      return sum + toNumber(row.valor);
    }, 0)
  );

  // CORRECAO B: comissoes pagas do caixa M = LIQUIDO (final − debitos) da competencia
  // M-1 — MESMA prevCompetencia do "Recebido" (cashReceivedFor), inclusive jan -> dez
  // ano-1. Antes lia selectedPeriod (M) e o valor era bruto (discount_value=0).
  const prevSel = prevCompetencia(selectedPeriod.year, selectedPeriod.month);
  const prevSelKey = getPeriodKey(prevSel.year, prevSel.month);
  const comissoesPagas = roundMoney(payableByPeriod.get(prevSelKey) ?? 0);
  // INFORMATIVO: "do qual seguro" do repasse — subcomponente do comissoesPagas, MESMA
  // competencia M-1 (antes lia M, ficaria descasado do liquido agora deslocado).
  const paidInsuranceShare = roundMoney(comissaoSeguroByPeriod.get(prevSelKey) ?? 0);

  const summary: FinanceSummary = {
    periodLabel: selectedPeriod.label,
    openingBalance,
    // receivedNet = receivedClosing(M-1) + receivedManual(M) — regime de caixa.
    // receivedClosing = receivedLiquido + receivedProdutos (6 campos por produto).
    receivedNet: received.receivedNet,
    receivedClosing: received.receivedClosing,
    receivedLiquido: received.receivedLiquido,
    receivedProdutos: received.receivedProdutos,
    receivedManual: received.receivedManual,
    receivedInsurance: received.receivedInsurance,
    receivedEmpresa: received.receivedEmpresa,
    actualCash: roundMoney(receivedSummary.actualCash),
    actualPrt: roundMoney(receivedSummary.actualPrt),
    actualInsurance: roundMoney(receivedSummary.actualInsurance),
    actualEstorno: roundMoney(receivedSummary.actualEstorno),
    actualRenewal: roundMoney(receivedSummary.actualRenewal),
    totalExpenses,
    paidExpenses,
    pendingExpenses,
    // Comissão paga = maior saída de caixa (repasse). Saldo/resultado refletem o
    // conceito de CAIXA: recebido − comissões pagas − despesas operacionais.
    comissoesPagas,
    paidInsuranceShare,
    operatingResult: roundMoney(
      received.receivedNet - comissoesPagas - totalExpenses
    ),
    cashBalance: roundMoney(
      openingBalance + received.receivedNet - comissoesPagas - paidExpenses
    ),
    futureDeferredBalance,
    companiesCount: selectedClosings.length,
    expensesCount: selectedExpenses.length,
  };

  const categoryTotals = Array.from(
    selectedExpenses.reduce((map, row) => {
      const label = categoryById.get(row.category_id || "")?.name || "Sem categoria";
      map.set(label, (map.get(label) || 0) + toNumber(row.amount));
      return map;
    }, new Map<string, number>())
  )
    .map(([label, value]) => ({ label, value: roundMoney(value) }))
    .sort((a, b) => b.value - a.value);

  const companyRowsMap = new Map<string, FinanceCompanyRow>();

  for (const company of companies) {
    companyRowsMap.set(company.id, {
      id: company.id,
      label: company.name,
      cnpj: company.cnpj,
      scope: "COMPANY",
      openingBalance: 0,
      receivedNet: 0,
      totalExpenses: 0,
      paidExpenses: 0,
      netResult: 0,
      cashBalance: 0,
    });
  }

  const groupRowKey = "GROUP";
  companyRowsMap.set(groupRowKey, {
    id: groupRowKey,
    label: "Grupo RR",
    scope: "GROUP",
    openingBalance: 0,
    receivedNet: 0,
    totalExpenses: 0,
    paidExpenses: 0,
    netResult: 0,
    cashBalance: 0,
  });

  for (const row of selectedClosings) {
    const company = companyByCnpj.get(row.empresa_cnpj);
    if (!company) continue;

    const current = companyRowsMap.get(company.id);
    if (!current) continue;

    current.receivedNet += roundMoney(
      toNumber(row.valor_liquido) ||
        toNumber(row.valor_avista) +
          toNumber(row.valor_diferido) +
          toNumber(row.valor_seguro) -
          toNumber(row.valor_estorno) -
          toNumber(row.valor_renovacao)
    );
  }

  for (const row of selectedOpenings) {
    const key = row.company_id || groupRowKey;
    const current = companyRowsMap.get(key);
    if (!current) continue;
    current.openingBalance += toNumber(row.opening_balance);
  }

  for (const row of selectedExpenses) {
    const isGroupScope =
      normalizeText(row.scope) === "GROUP" || normalizeText(row.scope) === "GRUPO" || !row.company_id;
    const key = isGroupScope ? groupRowKey : row.company_id || groupRowKey;
    const current = companyRowsMap.get(key);
    if (!current) continue;

    current.totalExpenses += toNumber(row.amount);

    if (isPaidExpense(row)) {
      current.paidExpenses += toNumber(row.amount);
    }
  }

  const companyRows = Array.from(companyRowsMap.values())
    .map((row) => ({
      ...row,
      openingBalance: roundMoney(row.openingBalance),
      receivedNet: roundMoney(row.receivedNet),
      totalExpenses: roundMoney(row.totalExpenses),
      paidExpenses: roundMoney(row.paidExpenses),
      netResult: roundMoney(row.receivedNet - row.totalExpenses),
      cashBalance: roundMoney(row.openingBalance + row.receivedNet - row.paidExpenses),
    }))
    .filter(
      (row) =>
        row.scope === "GROUP" ||
        row.openingBalance > 0 ||
        row.receivedNet > 0 ||
        row.totalExpenses > 0
    )
    .sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === "GROUP" ? -1 : 1;
      return b.receivedNet + b.openingBalance - (a.receivedNet + a.openingBalance);
    });

  const expenseRows = selectedExpenses
    .map((row) => {
      const company = row.company_id ? companyById.get(row.company_id) : undefined;
      const isGroupScope =
        normalizeText(row.scope) === "GROUP" || normalizeText(row.scope) === "GRUPO" || !row.company_id;

      return {
        id: row.id,
        scope: isGroupScope ? "GROUP" : "COMPANY",
        company_id: row.company_id,
        company_name: isGroupScope ? "Grupo RR" : company?.name || "Empresa nao identificada",
        company_cnpj: company?.cnpj,
        category_id: row.category_id,
        category_name: categoryById.get(row.category_id || "")?.name || "Sem categoria",
        description: row.description,
        amount: roundMoney(toNumber(row.amount)),
        due_date: row.due_date,
        payment_date: row.payment_date,
        status: row.status || (isPaidExpense(row) ? "PAID" : "PLANNED"),
        notes: row.notes,
        created_at: row.created_at,
      } satisfies FinanceExpenseRow;
    })
    .sort((a, b) => {
      const aDate = a.payment_date || a.due_date || a.created_at || "";
      const bDate = b.payment_date || b.due_date || b.created_at || "";
      return String(bDate).localeCompare(String(aDate));
    });

  const openingBalanceRows = selectedOpenings
    .map((row) => {
      const company = row.company_id ? companyById.get(row.company_id) : undefined;
      const isGroupScope = !row.company_id;

      return {
        id: row.id,
        scope: isGroupScope ? "GROUP" : "COMPANY",
        company_id: row.company_id,
        company_name: isGroupScope ? "Grupo RR" : company?.name || "Empresa nao identificada",
        company_cnpj: company?.cnpj,
        opening_balance: roundMoney(toNumber(row.opening_balance)),
        created_at: row.created_at,
      } satisfies FinanceOpeningBalanceItem;
    })
    .sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === "GROUP" ? -1 : 1;
      return b.opening_balance - a.opening_balance;
    });

  const trendPeriods = periods
    .slice(0, 6)
    .sort(comparePeriods)
    .map((period) => {
      const periodExpenses = expenses.filter(
        (row) => row.year === period.year && row.month === period.month
      );
      const periodOpenings = openingBalances.filter(
        (row) => row.year === period.year && row.month === period.month
      );

      // mesmo regime de caixa do KPI: fechamento(M-1) + manuais(M). Mantém o
      // gráfico coerente com o "Recebido" do summary.
      const { receivedNet } = cashReceivedFor(period.year, period.month, closings, manualRevenues, adsCashByPeriod);
      const totalExpenses = roundMoney(
        periodExpenses.reduce((sum, row) => sum + toNumber(row.amount), 0)
      );
      const paidExpenses = roundMoney(
        periodExpenses.reduce(
          (sum, row) => sum + (isPaidExpense(row) ? toNumber(row.amount) : 0),
          0
        )
      );
      const openingBalance = roundMoney(
        periodOpenings.reduce((sum, row) => sum + toNumber(row.opening_balance), 0)
      );
      // cada ponto usa o LIQUIDO do mes ANTERIOR (M-1 do proprio ponto) — mesmo regime
      // de caixa do Recebido (cashReceivedFor acima), pra o grafico bater com o card.
      const prevP = prevCompetencia(period.year, period.month);
      const comissoesPagas = roundMoney(payableByPeriod.get(getPeriodKey(prevP.year, prevP.month)) ?? 0);

      return {
        key: period.key,
        label: period.label,
        openingBalance,
        receivedNet,
        totalExpenses,
        paidExpenses,
        comissoesPagas,
        cashBalance: roundMoney(openingBalance + receivedNet - comissoesPagas - paidExpenses),
      } satisfies FinanceCashTrendPoint;
    });

  const alerts: string[] = [];

  if (summary.receivedNet === 0) {
    alerts.push(
      "Ainda nao existe recebimento real consolidado para esta competencia no financeiro."
    );
  }

  if (summary.openingBalance === 0) {
    alerts.push(
      "O saldo inicial deste mes ainda nao foi lancado. O fluxo de caixa fica parcial sem ele."
    );
  }

  if (summary.totalExpenses === 0) {
    alerts.push(
      "Nenhuma despesa foi registrada nesta competencia. O resultado liquido ainda pode estar subavaliado."
    );
  }

  // ---------------------------------------------------------------- MATRIZES
  const OUTROS_ENTRADA: Array<[string, string]> = [
    ["bbcap", "BBCAP"],
    ["conta_corrente", "Conta corrente"],
    ["dental", "Dental"],
    ["lob", "LOB"],
    ["credito", "Credito (nota)"],
  ];
  const prevMat = prevCompetencia(selectedPeriod.year, selectedPeriod.month);
  const fechMat = closings.filter((r) => r.ano === prevMat.year && r.mes === prevMat.month);
  const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const nomePorCnpj = new Map(companies.map((c) => [soDigitos(c.cnpj), c.name]));
  const nomePorId = new Map(companies.map((c) => [c.id, c.name]));

  const linhasEntrada: MatrizLinha[] = [];
  for (const row of fechMat) {
    const nome = nomePorCnpj.get(soDigitos(row.empresa_cnpj)) || `CNPJ ${row.empresa_cnpj}`;
    const outros = OUTROS_ENTRADA.map(([k, rotulo]) => ({
      chave: k,
      rotulo,
      valor: roundMoney(toNumber((row as any)[`valor_${k}`])),
    }));
    const raw: Record<string, number> = {
      avista: toNumber(row.valor_avista),
      prt: toNumber(row.valor_diferido),
      seguro: toNumber(row.valor_seguro),
      consorcio: toNumber(row.valor_consorcio),
      outros: outros.reduce((a, o) => a + o.valor, 0),
      ajustes: -toNumber(row.valor_estorno) - toNumber(row.valor_renovacao),
    };
    const fech = fecharLinha(raw, Object.values(raw).reduce((a, v) => a + v, 0));
    linhasEntrada.push({
      chave: soDigitos(row.empresa_cnpj),
      rotulo: nome,
      celulas: fech.celulas,
      outrosDetalhe: outros,
      total: fech.total,
    });
  }
  // ADS: mesmas colunas, 3 preenchidas. O vazio nas outras E informacao (ela nao
  // vende consorcio nem BBCAP) — por isso entra como LINHA, nao como nota de rodape.
  {
    const a = adsCashByPeriod.get(getProductionPeriodKey(prevMat.year, prevMat.month)) ?? {
      avista: 0,
      prt: 0,
      seguro: 0,
      abertura: 0,
    };
    const celulas: Record<string, number> = {
      avista: roundMoney(a.avista),
      prt: roundMoney(a.prt),
      seguro: roundMoney(a.seguro),
      consorcio: 0,
      // Abertura de Conta entra em "outros": e receita da ADS que nao e credito,
      // nem PRT, nem seguro. R$ 100,00 na competencia 2026-07.
      outros: roundMoney(a.abertura),
      ajustes: 0,
    };
    if (Object.values(celulas).some((v) => v !== 0)) {
      linhasEntrada.push({
        chave: BBTS_COMPANY_ID,
        rotulo: nomePorId.get(BBTS_COMPANY_ID) || "ADS",
        celulas,
        outrosDetalhe: OUTROS_ENTRADA.map(([k, rotulo]) => ({ chave: k, rotulo, valor: 0 })),
        total: roundMoney(Object.values(celulas).reduce((x, v) => x + v, 0)),
      });
    }
  }
  const ordenar = (a: MatrizLinha, b: MatrizLinha) => {
    if (a.avulso !== b.avulso) return a.avulso ? 1 : -1;
    if (a.chave === BBTS_COMPANY_ID) return 1;
    if (b.chave === BBTS_COMPANY_ID) return -1;
    return a.rotulo.localeCompare(b.rotulo);
  };
  linhasEntrada.sort(ordenar);
  // LANCAMENTOS AVULSOS: linha PROPRIA, nunca diluidos entre as empresas.
  if (received.receivedManual !== 0) {
    const doMes = manualRevenues.filter((row) => {
      const ym = manualCreditYM(row);
      return ym && ym.year === selectedPeriod.year && ym.month === selectedPeriod.month;
    });
    const porCategoria = new Map<string, number>();
    for (const row of doMes) {
      const k = String(row.categoria || "OUTRO");
      porCategoria.set(k, roundMoney(toNumber(porCategoria.get(k)) + toNumber(row.valor)));
    }
    linhasEntrada.push({
      chave: "__avulsos",
      rotulo: "Lancamentos avulsos (nao e producao de empresa)",
      avulso: true,
      celulas: {
        avista: 0,
        prt: 0,
        seguro: 0,
        consorcio: 0,
        outros: received.receivedManual,
        ajustes: 0,
      },
      outrosDetalhe: [...porCategoria.entries()].map(([k, v]) => ({ chave: k, rotulo: k, valor: v })),
      total: received.receivedManual,
    });
  }

  // A FONTE DE CADA COLUNA E EXIBIDA NO RODAPE — e nao e detalhe cosmetico.
  //
  // A matriz poe lado a lado numeros de DUAS ORIGENS: as 4 RR saem de
  // `fechamento_mensal_empresa`, um agregado JA POR CNPJ; a ADS sai de
  // `daily_production_records` + `bbts_prt_parcelas`, por linha, agregada aqui.
  // As duas sao LIDAS (nunca derivadas por juncao), mas nao sao a mesma coisa: a
  // primeira e o que a Promotiva declarou no fechamento, a segunda e o que a BBTS
  // pagou, somado por nos. Quem confere precisa saber qual esta olhando.
  //
  // ATRIBUICAO DE EMPRESA — MEDIDO 26/08/2026, e o registro importa:
  //   `fechamento_mensal_empresa` : por `empresa_cnpj`, LIDO.
  //   `bbts_prt_parcelas`         : `company_id`, LIDO.
  //   `monthly_closing_entries`   : `company_id` nao-nulo em 10.258/10.258 no PRT
  //                                 de jul/2026, LIDO. E essa tabela NAO TEM coluna
  //                                 `promoter_id` — logo nao existe, nem seria
  //                                 possivel, atribuir PRT a empresa via promotor.
  //   `diferido_parcelas`         : VAZIA (0 linhas) e fora do Recebido; alem
  //                                 disso nao tem empresa, contrato, chave J, MCI
  //                                 nem arquivo de origem. Se um dia for populada,
  //                                 a empresa NAO sera derivavel de nada — o
  //                                 conserto e na ESCRITA. Ver secao 4 do
  //                                 HANDOFF_FINANCEIRO_DETALHAMENTO.md.
  //
  // PROMOTOR MULTI-EMPRESA: e real (8 de 50 em jul/2026; CAMILA GOMES, MARIA
  // LETICIA e FABIANA tem competencia com duas empresas, e MARIA LETICIA aparece
  // em tres empresas distintas ao longo de 2026). Isso NAO afeta esta matriz,
  // porque o PMR ja esta no grao (promotor x empresa), com linha e `company_id`
  // proprios — agrupar por empresa soma certo. E AUSENCIA CIRCUNSTANCIAL DE
  // PROBLEMA, NAO PROTECAO PROJETADA: no dia em que chegar uma fonte de PRT por
  // parcela SEM `company_id`, atribui-la via promotor fica AMBIGUO exatamente para
  // esses casos, e vai precisar de criterio (contrato original? empresa de maior
  // producao? nao-atribuido?). Nada no codigo impede isso hoje.
  const FONTE_RR_ADS =
    "RR: fechamento_mensal_empresa (por CNPJ) · ADS: daily_production_records / bbts_prt_parcelas (por company_id)";
  const COLS_ENTRADA: MatrizColuna[] = [
    { chave: "avista", rotulo: "A vista", marca: "*", fonte: FONTE_RR_ADS },
    { chave: "prt", rotulo: "PRT", marca: "*", fonte: FONTE_RR_ADS },
    { chave: "seguro", rotulo: "Seguro", marca: "*", fonte: FONTE_RR_ADS },
    { chave: "consorcio", rotulo: "Consorcio", fonte: "fechamento_mensal_empresa (por CNPJ)" },
    { chave: "outros", rotulo: "Outros", expansivel: true, fonte: "fechamento_mensal_empresa (por CNPJ)" },
    { chave: "ajustes", rotulo: "Ajustes", fonte: "fechamento_mensal_empresa: estorno + renovacao (por CNPJ)" },
  ];

  // ---- SAIDA: mesma forma. Espelha payableByCompetencia, mas POR EMPRESA. ----
  const pmrMat = pmrRows.filter((r) => r.year === prevMat.year && r.month === prevMat.month);
  const pisoZerouMat = new Set(
    pmrMat.filter((r) => r.piso_zerou === true && r.promoter_id).map((r) => String(r.promoter_id))
  );
  const OUTROS_SAIDA: Array<[string, string]> = [
    ["bbcap_commission_value", "BBCAP"],
    ["conta_corrente_commission_value", "Conta corrente"],
    ["lob_commission_value", "LOB"],
  ];
  type AccSaida = {
    producao: number;
    seguro: number;
    consorcio: number;
    outros: Map<string, number>;
    desconto: number;
  };
  const acc = new Map<string, AccSaida>();
  const bucket = (id: string) => {
    let b = acc.get(id);
    if (!b) {
      b = { producao: 0, seguro: 0, consorcio: 0, outros: new Map(), desconto: 0 };
      acc.set(id, b);
    }
    return b;
  };
  for (const r of pmrMat) {
    const b = bucket(String(r.company_id ?? "__sem_empresa"));
    b.producao += toNumber((r as any).production_commission_value);
    b.seguro += toNumber(r.insurance_commission_value);
    b.consorcio += toNumber((r as any).consorcio_commission_value);
    for (const [k] of OUTROS_SAIDA) {
      b.outros.set(k, toNumber(b.outros.get(k)) + toNumber((r as any)[k]));
    }
  }
  // Descontos com a MESMA regra do card (ver payableByCompetencia): ignora
  // apply_to_company e ignora quem teve o piso zerado.
  for (const d of discountRows) {
    if (d.year !== prevMat.year || d.month !== prevMat.month) continue;
    if (d.apply_to_company === true) continue;
    if (d.promoter_id && pisoZerouMat.has(String(d.promoter_id))) continue;
    bucket(String((d as any).company_id ?? "__sem_empresa")).desconto += toNumber(d.amount);
  }
  const linhasSaida: MatrizLinha[] = [];
  for (const [id, b] of acc) {
    const outros = OUTROS_SAIDA.map(([k, rotulo]) => ({
      chave: k,
      rotulo,
      valor: roundMoney(toNumber(b.outros.get(k))),
    }));
    const raw: Record<string, number> = {
      producao: b.producao,
      seguro: b.seguro,
      consorcio: b.consorcio,
      outros: outros.reduce((a, o) => a + o.valor, 0),
      descontos: -b.desconto,
    };
    const fech = fecharLinha(raw, Object.values(raw).reduce((a, v) => a + v, 0));
    linhasSaida.push({
      chave: id,
      rotulo: id === "__sem_empresa" ? "— sem empresa —" : nomePorId.get(id) || `ID ${id.slice(0, 8)}`,
      celulas: fech.celulas,
      outrosDetalhe: outros,
      total: fech.total,
    });
  }
  linhasSaida.sort(ordenar);
  const FONTE_PMR = "promoter_monthly_results (por company_id)";
  const COLS_SAIDA: MatrizColuna[] = [
    { chave: "producao", rotulo: "Producao", fonte: FONTE_PMR },
    { chave: "seguro", rotulo: "Seguro", fonte: FONTE_PMR },
    { chave: "consorcio", rotulo: "Consorcio", fonte: FONTE_PMR },
    { chave: "outros", rotulo: "Outros", expansivel: true, fonte: FONTE_PMR },
    { chave: "descontos", rotulo: "Descontos", fonte: "promoter_discounts (por company_id)" },
  ];

  const montarMatriz = (
    titulo: string,
    subtitulo: string,
    colunas: MatrizColuna[],
    linhas: MatrizLinha[],
    cardTotal: number
  ): Matriz => {
    const totaisColuna: Record<string, number> = {};
    for (const c of colunas) {
      totaisColuna[c.chave] = roundMoney(linhas.reduce((a, l) => a + toNumber(l.celulas[c.chave]), 0));
    }
    let total = roundMoney(linhas.reduce((a, l) => a + l.total, 0));
    const alvo = roundMoney(cardTotal);
    // RESIDUO DE CENTAVO (nao e divergencia): o card arredonda uma vez sobre o
    // total; a matriz arredonda por empresa e soma. Quando a diferenca cabe em
    // 1 centavo por linha, e ruido de acumulo — devolve-se para a MAIOR linha e a
    // matriz volta a fechar. Acima disso o delta SOBREVIVE e a tela mostra: e
    // divergencia de verdade, e a linha de conferencia existe para denunciar.
    const residuo = roundMoney(alvo - total);
    if (residuo !== 0 && Math.abs(residuo) <= 0.01 * Math.max(1, linhas.length)) {
      let iMaior = -1;
      let maior = -1;
      linhas.forEach((l, i) => {
        if (Math.abs(l.total) > maior) {
          maior = Math.abs(l.total);
          iMaior = i;
        }
      });
      if (iMaior >= 0) {
        const l = linhas[iMaior];
        const ajustada = fecharLinha(l.celulas, roundMoney(l.total + residuo));
        linhas[iMaior] = { ...l, celulas: ajustada.celulas, total: ajustada.total };
        for (const c of colunas) {
          totaisColuna[c.chave] = roundMoney(linhas.reduce((a, x) => a + toNumber(x.celulas[c.chave]), 0));
        }
        total = roundMoney(linhas.reduce((a, x) => a + x.total, 0));
      }
    }
    return {
      titulo,
      subtitulo,
      notaMarca: colunas.some((c) => c.marca)
        ? "* coluna com DUAS fontes: as 4 RR vem do fechamento da Promotiva (agregado por CNPJ); a ADS vem do que a BBTS pagou, somado por linha. Nos dois casos a empresa e LIDA do dado, nunca derivada."
        : undefined,
      colunas,
      linhas,
      totaisColuna,
      total,
      cardTotal: alvo,
      delta: roundMoney(total - alvo),
    };
  };
  // ---- DESPESAS: EMPRESA x CATEGORIA ----
  //
  // POR QUE AS COLUNAS SAO DINAMICAS, ao contrario das outras duas. Nas matrizes de
  // entrada e saida as colunas sao ESTRUTURAIS: componentes fixos do fechamento e do
  // PMR, sempre os mesmos, sempre com valor. Aqui a categoria e um cadastro ABERTO —
  // 11 hoje (`expense_categories`), podem virar 15 — e o uso e concentrado: medido em
  // 26/08/2026, das 11 apenas 3 tiveram movimento (Folha 79,0%, Pro-labore 14,6%,
  // FGTS 6,3%). Colunas fixas dariam 8 colunas de zero permanente, que nao ensinam
  // nada e comem a largura que as outras precisam.
  //
  // O CORTE: as categorias com valor na competencia exibida, ordenadas por valor
  // (maior primeiro), TETO de 4 colunas; da 5a em diante entra em "Outros",
  // expansivel — o mesmo criterio de materialidade das outras duas matrizes.
  //
  // COMPETENCIA: esta matriz le a competencia CORRENTE (o mes selecionado), enquanto
  // Recebido e Comissoes pagas leem M-1. NAO e defeito, e o regime de caixa: o que
  // entrou veio do fechamento do mes passado, o que se paga de despesa e deste mes.
  // Por isso cada matriz declara o proprio periodo no subtitulo — tres tabelas na
  // mesma tela com janelas diferentes e um convite ao erro se nao disserem qual e.
  const TETO_CAT = 4;
  const catNomePorId = new Map(categories.map((c) => [c.id, c.name]));
  const norm = (v: unknown) => normalizeText(v);
  const ehGrupo = (r: ExpenseRow) =>
    norm(r.scope) === "GROUP" || norm(r.scope) === "GRUPO" || !r.company_id;

  // valor por categoria na competencia, para decidir o corte
  const valorPorCat = new Map<string, number>();
  for (const r of selectedExpenses) {
    const k = String(r.category_id ?? "__sem_categoria");
    valorPorCat.set(k, toNumber(valorPorCat.get(k)) + toNumber(r.amount));
  }
  const catsOrdenadas = [...valorPorCat.entries()]
    .filter(([, v]) => Math.abs(v) > 0.005)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const catsColuna = catsOrdenadas.slice(0, TETO_CAT).map(([k]) => k);
  const catsOutros = catsOrdenadas.slice(TETO_CAT).map(([k]) => k);
  const rotuloCat = (id: string) =>
    id === "__sem_categoria" ? "(sem categoria)" : catNomePorId.get(id) || "(categoria removida)";

  const accDesp = new Map<string, { grupo: boolean; porCat: Map<string, number> }>();
  for (const r of selectedExpenses) {
    const grupo = ehGrupo(r);
    // A linha de GRUPO nao e "nao atribuido": e despesa que LEGITIMAMENTE nao tem
    // CNPJ (rateio do grupo). Dado faltando e outra coisa, e o rotulo tem de
    // distinguir — ver o rotulo mais abaixo.
    const chave = grupo ? "__grupo" : String(r.company_id);
    let b = accDesp.get(chave);
    if (!b) {
      b = { grupo, porCat: new Map() };
      accDesp.set(chave, b);
    }
    const ck = String(r.category_id ?? "__sem_categoria");
    b.porCat.set(ck, toNumber(b.porCat.get(ck)) + toNumber(r.amount));
  }

  const COLS_DESPESA: MatrizColuna[] = [
    ...catsColuna.map((id) => ({
      chave: `cat:${id}`,
      rotulo: rotuloCat(id),
      fonte: "financial_expenses (por company_id + category_id)",
    })),
    ...(catsOutros.length
      ? [
          {
            chave: "outros",
            rotulo: "Outros",
            expansivel: true,
            fonte: `${catsOutros.length} categoria(s) de menor valor nesta competencia`,
          } as MatrizColuna,
        ]
      : []),
  ];

  const linhasDespesa: MatrizLinha[] = [];
  for (const [chave, b] of accDesp) {
    const outros = catsOutros.map((id) => ({
      chave: id,
      rotulo: rotuloCat(id),
      valor: roundMoney(toNumber(b.porCat.get(id))),
    }));
    const raw: Record<string, number> = {};
    for (const id of catsColuna) raw[`cat:${id}`] = toNumber(b.porCat.get(id));
    if (catsOutros.length) raw.outros = outros.reduce((a, o) => a + o.valor, 0);
    const fech = fecharLinha(raw, Object.values(raw).reduce((a, v) => a + v, 0));
    linhasDespesa.push({
      chave,
      // ROTULO DELIBERADO: "Grupo (sem empresa)", nunca "nao atribuido". A primeira
      // diz "esta despesa nao pertence a uma empresa"; a segunda diria "faltou o
      // dado". Sao coisas diferentes e so uma delas e verdade aqui.
      rotulo: b.grupo ? "Grupo (sem empresa)" : nomePorId.get(chave) || `ID ${chave.slice(0, 8)}`,
      avulso: b.grupo,
      celulas: fech.celulas,
      outrosDetalhe: outros,
      total: fech.total,
    });
  }
  linhasDespesa.sort(ordenar);

  const rotuloPrev = `${MONTH_NAMES[prevMat.month - 1]}/${String(prevMat.year).slice(2)}`;
  const rotuloAtual = `${MONTH_NAMES[selectedPeriod.month - 1]}/${String(selectedPeriod.year).slice(2)}`;
  const detalhamento: FinanceDetalhamento = {
    entrada: montarMatriz(
      "Recebido",
      `fechamento de ${rotuloPrev} (M-1)`,
      COLS_ENTRADA,
      linhasEntrada,
      summary.receivedNet
    ),
    saida: montarMatriz(
      "Comissoes pagas",
      `competencia ${rotuloPrev} (M-1)`,
      COLS_SAIDA,
      linhasSaida,
      summary.comissoesPagas
    ),
    despesa: montarMatriz(
      "Despesas",
      `competencia ${rotuloAtual} — o mes CORRENTE, nao M-1`,
      COLS_DESPESA,
      linhasDespesa,
      summary.totalExpenses
    ),
  };

  return {
    periods,
    selectedPeriod,
    summary,
    detalhamento,
    categoryTotals,
    cashTrend: trendPeriods,
    companyRows,
    expenseRows,
    openingBalanceRows,
    categories,
    companies: companies.filter((company) => company.active !== false),
    alerts,
  };
}

