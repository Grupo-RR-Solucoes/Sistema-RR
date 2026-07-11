import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllRows } from "@/lib/queryHelpers";

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
  // da competencia M (mesma de comissoesPagas). JA dentro de comissoesPagas
  // (final = producao + seguro) — NAO somar. Competencia M, nao M-1.
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
  pmrRows: Array<{ year: number; month: number; final_commission_value: number | null }>,
  discountRows: Array<{ year: number; month: number; amount: number | null; apply_to_company: boolean | null }>
): { payableByPeriod: Map<string, number>; finalByPeriod: Map<string, number>; discountByPeriod: Map<string, number> } {
  const finalByPeriod = new Map<string, number>();
  for (const r of pmrRows) {
    const k = getPeriodKey(r.year, r.month);
    finalByPeriod.set(k, toNumber(finalByPeriod.get(k)) + toNumber(r.final_commission_value));
  }
  const discountByPeriod = new Map<string, number>();
  for (const d of discountRows) {
    if (d.apply_to_company === true) continue; // debito da EMPRESA nao abate o repasse
    const k = getPeriodKey(d.year, d.month);
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

// "Recebido" (caixa) da competencia M: fechamento(M-1) + manuais(data_credito em M).
// receivedClosing = valor_liquido(M-1) + Σ produtos(M-1).
function cashReceivedFor(
  year: number,
  month: number,
  allClosings: ClosingRow[],
  manualRows: ManualRevenueRow[]
) {
  const prev = prevCompetencia(year, month);
  const closingRows = allClosings.filter((r) => r.ano === prev.year && r.mes === prev.month);
  const receivedLiquido = roundMoney(sumClosingNet(closingRows));
  const receivedProdutos = roundMoney(sumClosingProdutos(closingRows));
  // INFORMATIVO: parcela de seguro JA dentro de receivedLiquido (mesmas M-1 rows).
  const receivedInsurance = roundMoney(sumClosingInsurance(closingRows));
  const receivedClosing = roundMoney(receivedLiquido + receivedProdutos);
  const receivedManual = roundMoney(
    manualRows.reduce((sum, row) => {
      const ym = manualCreditYM(row);
      return ym && ym.year === year && ym.month === month ? sum + toNumber(row.valor) : sum;
    }, 0)
  );
  return {
    receivedLiquido,
    receivedProdutos,
    receivedInsurance,
    receivedClosing,
    receivedManual,
    receivedNet: roundMoney(receivedClosing + receivedManual),
  };
}

function isPaidExpense(row: ExpenseRow) {
  const status = normalizeText(row.status);
  return status === "PAID" || status === "PAGO" || Boolean(row.payment_date);
}

function makeSelectedPeriod(periods: FinancePeriodOption[], year?: number, month?: number) {
  if (year && month) {
    return (
      periods.find((period) => period.year === year && period.month === month) || {
        key: getPeriodKey(year, month),
        label: getPeriodLabel(year, month),
        year,
        month,
      }
    );
  }

  return periods[0];
}

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
        final_commission_value: number | null;
        discount_value: number | null;
        insurance_commission_value: number | null;
      }>(() =>
        supabase
          .from("promoter_monthly_results")
          .select("year, month, company_id, final_commission_value, discount_value, insurance_commission_value")
      ),
      // RECEITA MANUAL (consórcio/ajustes) — entra no "Recebido" (caixa) pelo
      // mês de data_credito (Etapa 3). Aditiva ao fechamento, sem defasagem.
      fetchAllRows<ManualRevenueRow>(() =>
        supabase
          .from("receita_lancamento_manual")
          .select("ano, mes, valor, data_credito")
      ),
      // DEBITOS do repasse (adiantamento/cancelamento seguro/etc.) — parcelas em
      // promoter_discounts. Abatidos do LIQUIDO por competencia (correcao B do caixa:
      // comissoes pagas do mes M = liquido da competencia M-1). apply_to_company !== true.
      fetchAllRows<{ year: number; month: number; amount: number | null; apply_to_company: boolean | null }>(() =>
        supabase
          .from("promoter_discounts")
          .select("year, month, amount, apply_to_company")
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

  // REGIME DE CAIXA: "Recebido" = fechamento(M-1) + manuais(data_credito em M).
  const received = cashReceivedFor(
    selectedPeriod.year,
    selectedPeriod.month,
    closings,
    manualRevenues
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
      const { receivedNet } = cashReceivedFor(period.year, period.month, closings, manualRevenues);
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

  return {
    periods,
    selectedPeriod,
    summary,
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

