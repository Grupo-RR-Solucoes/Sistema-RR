import { fetchAllRows } from "@/lib/queryHelpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { withMemoryCache } from "@/lib/memoryCache";

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
  actualCash: number;
  actualPrt: number;
  actualInsurance: number;
  actualEstorno: number;
  actualRenewal: number;
  totalExpenses: number;
  paidExpenses: number;
  pendingExpenses: number;
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

const FINANCIAL_ANALYTICS_CACHE_TTL_MS = 20_000;

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

export async function buildFinancialAnalytics(filters?: {
  year?: number;
  month?: number;
}): Promise<FinancialAnalyticsPayload> {
  const cacheKey = `financial:${filters?.year || "latest"}:${filters?.month || "latest"}`;

  return withMemoryCache(cacheKey, FINANCIAL_ANALYTICS_CACHE_TTL_MS, async () => {
  const supabaseAdmin = getSupabaseAdmin();

  const [companies, categories, closings, expenses, openingBalances, deferredRows] =
    await Promise.all([
      fetchAllRows<CompanyRow>(() =>
        supabaseAdmin
          .from("companies")
          .select("id, name, cnpj, active")
          .order("name", { ascending: true })
      ),
      fetchAllRows<ExpenseCategoryRow>(() =>
        supabaseAdmin
          .from("expense_categories")
          .select("id, name, is_default, active")
          .eq("active", true)
          .order("name", { ascending: true })
      ),
      fetchAllRows<ClosingRow>(() =>
        supabaseAdmin
          .from("fechamento_mensal_empresa")
          .select(
            "empresa_cnpj, ano, mes, valor_avista, valor_diferido, valor_seguro, valor_estorno, valor_renovacao, valor_liquido"
          )
          .order("ano", { ascending: true })
          .order("mes", { ascending: true })
          .order("empresa_cnpj", { ascending: true })
      ),
      fetchAllRows<ExpenseRow>(() =>
        supabaseAdmin
          .from("financial_expenses")
          .select(
            "id, company_id, year, month, category_id, scope, description, amount, due_date, payment_date, status, notes, created_at"
          )
          .order("year", { ascending: true })
          .order("month", { ascending: true })
          .order("created_at", { ascending: false })
      ),
      fetchAllRows<OpeningBalanceRow>(() =>
        supabaseAdmin
          .from("cash_opening_balances")
          .select("id, company_id, year, month, opening_balance, created_at")
          .order("year", { ascending: true })
          .order("month", { ascending: true })
          .order("created_at", { ascending: false })
      ),
      fetchAllRows<DeferredRow>(() =>
        supabaseAdmin
          .from("diferido_parcelas")
          .select("id, valor, status, data_prevista")
          .order("data_prevista", { ascending: true })
      ),
    ]);

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const companyByCnpj = new Map(companies.map((company) => [company.cnpj, company]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

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

  const receivedSummary = selectedClosings.reduce(
    (acc, row) => {
      acc.receivedNet += roundMoney(
        toNumber(row.valor_liquido) ||
          toNumber(row.valor_avista) +
            toNumber(row.valor_diferido) +
            toNumber(row.valor_seguro) -
            toNumber(row.valor_estorno) -
            toNumber(row.valor_renovacao)
      );
      acc.actualCash += toNumber(row.valor_avista);
      acc.actualPrt += toNumber(row.valor_diferido);
      acc.actualInsurance += toNumber(row.valor_seguro);
      acc.actualEstorno += toNumber(row.valor_estorno);
      acc.actualRenewal += toNumber(row.valor_renovacao);
      return acc;
    },
    {
      receivedNet: 0,
      actualCash: 0,
      actualPrt: 0,
      actualInsurance: 0,
      actualEstorno: 0,
      actualRenewal: 0,
    }
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

  const summary: FinanceSummary = {
    periodLabel: selectedPeriod.label,
    openingBalance,
    receivedNet: roundMoney(receivedSummary.receivedNet),
    actualCash: roundMoney(receivedSummary.actualCash),
    actualPrt: roundMoney(receivedSummary.actualPrt),
    actualInsurance: roundMoney(receivedSummary.actualInsurance),
    actualEstorno: roundMoney(receivedSummary.actualEstorno),
    actualRenewal: roundMoney(receivedSummary.actualRenewal),
    totalExpenses,
    paidExpenses,
    pendingExpenses,
    operatingResult: roundMoney(receivedSummary.receivedNet - totalExpenses),
    cashBalance: roundMoney(openingBalance + receivedSummary.receivedNet - paidExpenses),
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
      const periodClosings = closings.filter(
        (row) => row.ano === period.year && row.mes === period.month
      );
      const periodExpenses = expenses.filter(
        (row) => row.year === period.year && row.month === period.month
      );
      const periodOpenings = openingBalances.filter(
        (row) => row.year === period.year && row.month === period.month
      );

      const receivedNet = roundMoney(
        periodClosings.reduce(
          (sum, row) =>
            sum +
            (toNumber(row.valor_liquido) ||
              toNumber(row.valor_avista) +
                toNumber(row.valor_diferido) +
                toNumber(row.valor_seguro) -
                toNumber(row.valor_estorno) -
                toNumber(row.valor_renovacao)),
          0
        )
      );
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

      return {
        key: period.key,
        label: period.label,
        openingBalance,
        receivedNet,
        totalExpenses,
        paidExpenses,
        cashBalance: roundMoney(openingBalance + receivedNet - paidExpenses),
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
  });
}
