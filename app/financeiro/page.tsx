"use client";

import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

type PeriodOption = {
  key: string;
  label: string;
  year: number;
  month: number;
};

type Summary = {
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

type CategoryTotal = {
  label: string;
  value: number;
};

type CashTrendPoint = {
  key: string;
  label: string;
  openingBalance: number;
  receivedNet: number;
  totalExpenses: number;
  paidExpenses: number;
  cashBalance: number;
};

type CompanyRow = {
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

type ExpenseRow = {
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

type OpeningBalanceRow = {
  id: string;
  scope: "GROUP" | "COMPANY";
  company_id?: string | null;
  company_name: string;
  company_cnpj?: string;
  opening_balance: number;
  created_at?: string | null;
};

type Category = {
  id: string;
  name: string;
};

type Company = {
  id: string;
  name: string;
  cnpj: string;
};

type FinancialPayload = {
  periods: PeriodOption[];
  selectedPeriod: PeriodOption;
  summary: Summary;
  categoryTotals: CategoryTotal[];
  cashTrend: CashTrendPoint[];
  companyRows: CompanyRow[];
  expenseRows: ExpenseRow[];
  openingBalanceRows: OpeningBalanceRow[];
  categories: Category[];
  companies: Company[];
  alerts: string[];
};

type ExpenseFormState = {
  year: string;
  month: string;
  scope: "GROUP" | "COMPANY";
  companyId: string;
  categoryId: string;
  description: string;
  amount: string;
  dueDate: string;
  paymentDate: string;
  status: "PLANNED" | "PAID";
  notes: string;
};

type OpeningFormState = {
  year: string;
  month: string;
  scope: "GROUP" | "COMPANY";
  companyId: string;
  openingBalance: string;
};

const emptyPayload: FinancialPayload = {
  periods: [],
  selectedPeriod: {
    key: "",
    label: "sem competencia",
    year: 0,
    month: 0,
  },
  summary: {
    periodLabel: "sem competencia",
    openingBalance: 0,
    receivedNet: 0,
    actualCash: 0,
    actualPrt: 0,
    actualInsurance: 0,
    actualEstorno: 0,
    actualRenewal: 0,
    totalExpenses: 0,
    paidExpenses: 0,
    pendingExpenses: 0,
    operatingResult: 0,
    cashBalance: 0,
    futureDeferredBalance: 0,
    companiesCount: 0,
    expensesCount: 0,
  },
  categoryTotals: [],
  cashTrend: [],
  companyRows: [],
  expenseRows: [],
  openingBalanceRows: [],
  categories: [],
  companies: [],
  alerts: [],
};

const initialExpenseForm: ExpenseFormState = {
  year: "",
  month: "",
  scope: "GROUP",
  companyId: "",
  categoryId: "",
  description: "",
  amount: "",
  dueDate: "",
  paymentDate: "",
  status: "PLANNED",
  notes: "",
};

const initialOpeningForm: OpeningFormState = {
  year: "",
  month: "",
  scope: "GROUP",
  companyId: "",
  openingBalance: "",
};

export default function FinanceiroPage() {
  const [activeSection, setActiveSection] = useState<
    "visao" | "lancamentos" | "historico"
  >("visao");
  const [selectedKey, setSelectedKey] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<FinancialPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(initialExpenseForm);
  const [openingForm, setOpeningForm] = useState<OpeningFormState>(initialOpeningForm);
  const [categoryName, setCategoryName] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState<"" | "expense" | "opening" | "category">("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams();

        if (selectedKey) {
          const [year, month] = selectedKey.split("-");
          params.set("year", year);
          params.set("month", month);
        }

        const response = await fetch(
          `/api/financeiro${params.toString() ? `?${params.toString()}` : ""}`
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Erro ao carregar financeiro.");
        }

        setData(payload || emptyPayload);
      } catch (err: any) {
        setError(err.message || "Erro ao carregar financeiro.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [selectedKey, reloadKey]);

  useEffect(() => {
    if (!data.selectedPeriod.year || !data.selectedPeriod.month) return;

    setExpenseForm((current) => ({
      ...current,
      year: String(data.selectedPeriod.year),
      month: String(data.selectedPeriod.month),
    }));

    setOpeningForm((current) => ({
      ...current,
      year: String(data.selectedPeriod.year),
      month: String(data.selectedPeriod.month),
    }));
  }, [data.selectedPeriod.key, data.selectedPeriod.month, data.selectedPeriod.year]);

  async function handleExpenseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting("expense");
    setNotice("");

    try {
      const response = await fetch("/api/financeiro", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "expense",
          year: Number(expenseForm.year),
          month: Number(expenseForm.month),
          scope: expenseForm.scope,
          companyId: expenseForm.scope === "COMPANY" ? expenseForm.companyId : null,
          categoryId: expenseForm.categoryId || null,
          description: expenseForm.description,
          amount: parseBrazilianNumber(expenseForm.amount),
          dueDate: expenseForm.dueDate || null,
          paymentDate: expenseForm.paymentDate || null,
          status: expenseForm.status,
          notes: expenseForm.notes || null,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao lancar despesa.");
      }

      const periodKey = `${expenseForm.year}-${String(Number(expenseForm.month)).padStart(2, "0")}`;
      setSelectedKey(periodKey);
      setReloadKey((value) => value + 1);
      setExpenseForm((current) => ({
        ...current,
        description: "",
        amount: "",
        dueDate: "",
        paymentDate: "",
        notes: "",
      }));
      setNotice("Despesa lancada com sucesso.");
    } catch (err: any) {
      setNotice(err.message || "Erro ao lancar despesa.");
    } finally {
      setSubmitting("");
    }
  }

  async function handleOpeningSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting("opening");
    setNotice("");

    try {
      const response = await fetch("/api/financeiro", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "opening_balance",
          year: Number(openingForm.year),
          month: Number(openingForm.month),
          scope: openingForm.scope,
          companyId: openingForm.scope === "COMPANY" ? openingForm.companyId : null,
          openingBalance: parseBrazilianNumber(openingForm.openingBalance),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao salvar saldo inicial.");
      }

      const periodKey = `${openingForm.year}-${String(Number(openingForm.month)).padStart(2, "0")}`;
      setSelectedKey(periodKey);
      setReloadKey((value) => value + 1);
      setOpeningForm((current) => ({
        ...current,
        openingBalance: "",
      }));
      setNotice("Saldo inicial salvo com sucesso.");
    } catch (err: any) {
      setNotice(err.message || "Erro ao salvar saldo inicial.");
    } finally {
      setSubmitting("");
    }
  }

  async function handleCategorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting("category");
    setNotice("");

    try {
      const response = await fetch("/api/financeiro", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "category",
          name: categoryName,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Erro ao criar categoria.");
      }

      setReloadKey((value) => value + 1);
      setCategoryName("");
      setExpenseForm((current) => ({
        ...current,
        categoryId: payload?.category?.id || current.categoryId,
      }));
      setNotice("Categoria salva com sucesso.");
    } catch (err: any) {
      setNotice(err.message || "Erro ao criar categoria.");
    } finally {
      setSubmitting("");
    }
  }

  const periodValue = selectedKey || data.selectedPeriod.key || "";

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Fluxo de caixa</div>
          <h2 style={styles.title}>Financeiro consolidado do grupo</h2>
          <p style={styles.description}>
            Esta tela combina fechamento real, PRT futuro, despesas e saldo inicial
            para mostrar o resultado do mes e o caixa projetado sem depender de
            controles paralelos.
          </p>
        </article>

        <article style={styles.heroAside}>
          <div style={styles.selectorLabel}>Competencia analisada</div>
          <select
            value={periodValue}
            onChange={(event) => setSelectedKey(event.target.value)}
            style={styles.select}
          >
            {data.periods.length === 0 ? (
              <option value="">Sem competencia</option>
            ) : null}
            {data.periods.map((period) => (
              <option key={period.key} value={period.key}>
                {period.label}
              </option>
            ))}
          </select>

          <div style={styles.heroStats}>
            <div style={styles.heroStat}>
              <span style={styles.heroStatLabel}>Empresas</span>
              <strong style={styles.heroStatValue}>
                {formatNumber(data.summary.companiesCount)}
              </strong>
            </div>
            <div style={styles.heroStat}>
              <span style={styles.heroStatLabel}>Despesas</span>
              <strong style={styles.heroStatValue}>
                {formatNumber(data.summary.expensesCount)}
              </strong>
            </div>
          </div>
        </article>
      </div>

      {error ? <div style={styles.errorBox}>{error}</div> : null}
      {notice ? <div style={styles.noticeBox}>{notice}</div> : null}

      {data.alerts.map((alert) => (
        <div key={alert} style={styles.alertBox}>
          {alert}
        </div>
      ))}

      <div style={styles.summaryGrid}>
        <MetricCard
          label="Saldo inicial"
          value={formatCurrency(data.summary.openingBalance)}
          detail="Saldo manual de abertura somado entre grupo e empresas."
          tone="blue"
        />
        <MetricCard
          label="Recebido real"
          value={formatCurrency(data.summary.receivedNet)}
          detail="Fechamento liquido efetivamente recebido no mes."
          tone="gold"
        />
        <MetricCard
          label="Despesas do mes"
          value={formatCurrency(data.summary.totalExpenses)}
          detail={`Pagas ${formatCurrency(data.summary.paidExpenses)} | Pendentes ${formatCurrency(
            data.summary.pendingExpenses
          )}.`}
          tone="blue"
        />
        <MetricCard
          label="Resultado operacional"
          value={formatCurrency(data.summary.operatingResult)}
          detail="Recebimento real menos despesas lancadas."
          tone={data.summary.operatingResult >= 0 ? "gold" : "blue"}
        />
        <MetricCard
          label="Saldo de caixa"
          value={formatCurrency(data.summary.cashBalance)}
          detail="Saldo inicial + recebido real - despesas pagas."
          tone="gold"
        />
        <MetricCard
          label="Carteira PRT futura"
          value={formatCurrency(data.summary.futureDeferredBalance)}
          detail="Saldo de PRT ainda nao liquidado."
          tone="blue"
        />
      </div>

      <div style={styles.subsectionNav}>
        <button
          type="button"
          onClick={() => setActiveSection("visao")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "visao" ? styles.subsectionButtonActive : {}),
          }}
        >
          Visao consolidada
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("historico")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "historico" ? styles.subsectionButtonActive : {}),
          }}
        >
          Historico
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("lancamentos")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "lancamentos" ? styles.subsectionButtonActive : {}),
          }}
        >
          Lancamentos
        </button>
      </div>

      {activeSection === "historico" ? (
      <div style={styles.topGrid}>
        <article style={styles.chartCard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionKicker}>Historico</div>
              <h3 style={styles.sectionTitle}>Fluxo de caixa mensal</h3>
            </div>
            <div style={styles.sectionChip}>{data.cashTrend.length} meses</div>
          </div>
          <CashTrendChart items={data.cashTrend} loading={loading} />
        </article>

        <article style={styles.chartCard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionKicker}>Despesas</div>
              <h3 style={styles.sectionTitle}>Participacao por categoria</h3>
            </div>
            <div style={styles.sectionChip}>{data.categoryTotals.length} categorias</div>
          </div>
          <CategoryBreakdown items={data.categoryTotals} loading={loading} />
        </article>
      </div>
      ) : null}

      {activeSection === "visao" ? (
      <div style={styles.contentGrid}>
        <article style={styles.tableCard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionKicker}>Visao por caixa</div>
              <h3 style={styles.sectionTitle}>Grupo e empresas</h3>
            </div>
            <div style={styles.sectionChip}>{data.companyRows.length} caixas</div>
          </div>

          {loading ? (
            <div style={styles.emptyState}>Carregando consolidacao financeira...</div>
          ) : data.companyRows.length === 0 ? (
            <div style={styles.emptyState}>Sem movimento financeiro nesta competencia.</div>
          ) : (
            <div
              className={`rr-table-wrap${data.companyRows.length > 15 ? " rr-table-wrap--scrollable" : ""}`}
              style={styles.tableWrap}
            >
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Escopo</th>
                    <th style={styles.th}>Saldo inicial</th>
                    <th style={styles.th}>Recebido</th>
                    <th style={styles.th}>Despesas</th>
                    <th style={styles.th}>Despesas pagas</th>
                    <th style={styles.th}>Resultado</th>
                    <th style={styles.th}>Caixa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.companyRows.map((row) => (
                    <tr key={row.id}>
                      <td style={styles.td}>
                        <div style={styles.companyName}>{row.label}</div>
                        <div style={styles.companyMeta}>
                          {row.scope === "GROUP" ? "Consolidado de grupo" : row.cnpj || "-"}
                        </div>
                      </td>
                      <td style={styles.td}>{formatCurrency(row.openingBalance)}</td>
                      <td style={styles.td}>{formatCurrency(row.receivedNet)}</td>
                      <td style={styles.td}>{formatCurrency(row.totalExpenses)}</td>
                      <td style={styles.td}>{formatCurrency(row.paidExpenses)}</td>
                      <td style={styles.tdStrong}>{formatCurrency(row.netResult)}</td>
                      <td style={styles.tdStrong}>{formatCurrency(row.cashBalance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

      </div>
      ) : null}

      {activeSection === "lancamentos" ? (
      <div style={styles.contentGrid}>
        <aside style={styles.formRail}>
          <article style={styles.formCard}>
            <div style={styles.sectionHeaderCompact}>
              <div>
                <div style={styles.sectionKicker}>Lancamento manual</div>
                <h3 style={styles.sectionTitle}>Nova despesa</h3>
              </div>
            </div>
            <form onSubmit={handleExpenseSubmit} style={styles.formGrid}>
              <FormRow label="Ano">
                <input
                  value={expenseForm.year}
                  onChange={(event) =>
                    setExpenseForm((current) => ({ ...current, year: event.target.value }))
                  }
                  style={styles.input}
                  inputMode="numeric"
                />
              </FormRow>
              <FormRow label="Mes">
                <select
                  value={expenseForm.month}
                  onChange={(event) =>
                    setExpenseForm((current) => ({ ...current, month: event.target.value }))
                  }
                  style={styles.input}
                >
                  {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((month) => (
                    <option key={month} value={month}>
                      {month.padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Escopo">
                <select
                  value={expenseForm.scope}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      scope: event.target.value as "GROUP" | "COMPANY",
                      companyId: event.target.value === "COMPANY" ? current.companyId : "",
                    }))
                  }
                  style={styles.input}
                >
                  <option value="GROUP">Grupo</option>
                  <option value="COMPANY">Empresa</option>
                </select>
              </FormRow>
              {expenseForm.scope === "COMPANY" ? (
                <FormRow label="Empresa">
                  <select
                    value={expenseForm.companyId}
                    onChange={(event) =>
                      setExpenseForm((current) => ({ ...current, companyId: event.target.value }))
                    }
                    style={styles.input}
                  >
                    <option value="">Selecione</option>
                    {data.companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </FormRow>
              ) : null}
              <FormRow label="Categoria">
                <select
                  value={expenseForm.categoryId}
                  onChange={(event) =>
                    setExpenseForm((current) => ({ ...current, categoryId: event.target.value }))
                  }
                  style={styles.input}
                >
                  <option value="">Sem categoria</option>
                  {data.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Descricao">
                <input
                  value={expenseForm.description}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="Valor">
                <input
                  value={expenseForm.amount}
                  onChange={(event) =>
                    setExpenseForm((current) => ({ ...current, amount: event.target.value }))
                  }
                  style={styles.input}
                  placeholder="0,00"
                />
              </FormRow>
              <FormRow label="Vencimento">
                <input
                  type="date"
                  value={expenseForm.dueDate}
                  onChange={(event) =>
                    setExpenseForm((current) => ({ ...current, dueDate: event.target.value }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="Pagamento">
                <input
                  type="date"
                  value={expenseForm.paymentDate}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      paymentDate: event.target.value,
                    }))
                  }
                  style={styles.input}
                />
              </FormRow>
              <FormRow label="Status">
                <select
                  value={expenseForm.status}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      status: event.target.value as "PLANNED" | "PAID",
                    }))
                  }
                  style={styles.input}
                >
                  <option value="PLANNED">Planejada</option>
                  <option value="PAID">Paga</option>
                </select>
              </FormRow>
              <FormRow label="Observacoes">
                <textarea
                  value={expenseForm.notes}
                  onChange={(event) =>
                    setExpenseForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  style={styles.textarea}
                />
              </FormRow>
              <button type="submit" style={styles.primaryButton} disabled={submitting === "expense"}>
                {submitting === "expense" ? "Salvando..." : "Lancar despesa"}
              </button>
            </form>
          </article>

          <article style={styles.formCard}>
            <div style={styles.sectionHeaderCompact}>
              <div>
                <div style={styles.sectionKicker}>Saldo inicial</div>
                <h3 style={styles.sectionTitle}>Abrir caixa do mes</h3>
              </div>
            </div>
            <form onSubmit={handleOpeningSubmit} style={styles.formGrid}>
              <FormRow label="Ano">
                <input
                  value={openingForm.year}
                  onChange={(event) =>
                    setOpeningForm((current) => ({ ...current, year: event.target.value }))
                  }
                  style={styles.input}
                  inputMode="numeric"
                />
              </FormRow>
              <FormRow label="Mes">
                <select
                  value={openingForm.month}
                  onChange={(event) =>
                    setOpeningForm((current) => ({ ...current, month: event.target.value }))
                  }
                  style={styles.input}
                >
                  {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((month) => (
                    <option key={month} value={month}>
                      {month.padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Escopo">
                <select
                  value={openingForm.scope}
                  onChange={(event) =>
                    setOpeningForm((current) => ({
                      ...current,
                      scope: event.target.value as "GROUP" | "COMPANY",
                      companyId: event.target.value === "COMPANY" ? current.companyId : "",
                    }))
                  }
                  style={styles.input}
                >
                  <option value="GROUP">Grupo</option>
                  <option value="COMPANY">Empresa</option>
                </select>
              </FormRow>
              {openingForm.scope === "COMPANY" ? (
                <FormRow label="Empresa">
                  <select
                    value={openingForm.companyId}
                    onChange={(event) =>
                      setOpeningForm((current) => ({ ...current, companyId: event.target.value }))
                    }
                    style={styles.input}
                  >
                    <option value="">Selecione</option>
                    {data.companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </FormRow>
              ) : null}
              <FormRow label="Valor">
                <input
                  value={openingForm.openingBalance}
                  onChange={(event) =>
                    setOpeningForm((current) => ({
                      ...current,
                      openingBalance: event.target.value,
                    }))
                  }
                  style={styles.input}
                  placeholder="0,00"
                />
              </FormRow>
              <button type="submit" style={styles.secondaryButton} disabled={submitting === "opening"}>
                {submitting === "opening" ? "Salvando..." : "Salvar saldo inicial"}
              </button>
            </form>
          </article>

          <article style={styles.formCard}>
            <div style={styles.sectionHeaderCompact}>
              <div>
                <div style={styles.sectionKicker}>Categorias</div>
                <h3 style={styles.sectionTitle}>Nova categoria</h3>
              </div>
            </div>
            <form onSubmit={handleCategorySubmit} style={styles.formGrid}>
              <FormRow label="Nome">
                <input
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  style={styles.input}
                />
              </FormRow>
              <button type="submit" style={styles.secondaryButton} disabled={submitting === "category"}>
                {submitting === "category" ? "Salvando..." : "Salvar categoria"}
              </button>
            </form>
          </article>
        </aside>
      </div>
      ) : null}

      {activeSection === "lancamentos" ? (
      <div style={styles.bottomGrid}>
        <article style={styles.tableCard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionKicker}>Movimentos do mes</div>
              <h3 style={styles.sectionTitle}>Despesas lancadas</h3>
            </div>
            <div style={styles.sectionChip}>{data.expenseRows.length} despesas</div>
          </div>

          {loading ? (
            <div style={styles.emptyState}>Carregando despesas...</div>
          ) : data.expenseRows.length === 0 ? (
            <div style={styles.emptyState}>Nenhuma despesa lancada nesta competencia.</div>
          ) : (
            <div
              className={`rr-table-wrap${data.expenseRows.length > 15 ? " rr-table-wrap--scrollable" : ""}`}
              style={styles.tableWrap}
            >
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Descricao</th>
                    <th style={styles.th}>Escopo</th>
                    <th style={styles.th}>Categoria</th>
                    <th style={styles.th}>Valor</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Vencimento</th>
                    <th style={styles.th}>Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expenseRows.map((row) => (
                    <tr key={row.id}>
                      <td style={styles.td}>
                        <div style={styles.companyName}>{row.description}</div>
                        <div style={styles.companyMeta}>{row.company_name}</div>
                      </td>
                      <td style={styles.td}>{row.scope === "GROUP" ? "Grupo" : "Empresa"}</td>
                      <td style={styles.td}>{row.category_name}</td>
                      <td style={styles.tdStrong}>{formatCurrency(row.amount)}</td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.badge,
                            ...(normalizeStatus(row.status) === "PAID"
                              ? styles.badgeOk
                              : styles.badgeWarning),
                          }}
                        >
                          {normalizeStatus(row.status) === "PAID" ? "paga" : "planejada"}
                        </span>
                      </td>
                      <td style={styles.td}>{formatDate(row.due_date)}</td>
                      <td style={styles.td}>{formatDate(row.payment_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article style={styles.tableCard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionKicker}>Abertura do mes</div>
              <h3 style={styles.sectionTitle}>Saldos iniciais</h3>
            </div>
            <div style={styles.sectionChip}>{data.openingBalanceRows.length} saldos</div>
          </div>

          {loading ? (
            <div style={styles.emptyState}>Carregando saldos...</div>
          ) : data.openingBalanceRows.length === 0 ? (
            <div style={styles.emptyState}>Nenhum saldo inicial lancado nesta competencia.</div>
          ) : (
            <div style={styles.list}>
              {data.openingBalanceRows.map((row) => (
                <div key={row.id} style={styles.listItem}>
                  <div>
                    <div style={styles.companyName}>{row.company_name}</div>
                    <div style={styles.companyMeta}>
                      {row.scope === "GROUP" ? "Grupo RR" : row.company_cnpj || "-"}
                    </div>
                  </div>
                  <strong style={styles.listValue}>{formatCurrency(row.opening_balance)}</strong>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
      ) : null}
    </section>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label style={styles.formRow}>
      <span style={styles.formLabel}>{label}</span>
      {children}
    </label>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "gold";
}) {
  return (
    <article
      style={{
        ...styles.metricCard,
        background:
          tone === "blue"
            ? "linear-gradient(135deg, rgba(13,77,227,0.12) 0%, rgba(255,255,255,0.98) 100%)"
            : "linear-gradient(135deg, rgba(255,240,0,0.18) 0%, rgba(214,161,63,0.18) 100%)",
      }}
    >
      <div style={styles.metricLabel}>{label}</div>
      <div
        style={{
          ...styles.metricValue,
          color: tone === "blue" ? "var(--rr-blue-deep)" : "#9a6b06",
        }}
      >
        {value}
      </div>
      <div style={styles.metricDetail}>{detail}</div>
    </article>
  );
}

function CashTrendChart({
  items,
  loading,
}: {
  items: CashTrendPoint[];
  loading: boolean;
}) {
  if (loading) {
    return <div style={styles.emptyState}>Carregando historico financeiro...</div>;
  }

  if (items.length === 0) {
    return <div style={styles.emptyState}>Sem historico suficiente para o fluxo de caixa.</div>;
  }

  const maxValue = Math.max(
    1,
    ...items.flatMap((item) => [item.cashBalance, item.receivedNet])
  );

  return (
    <div style={styles.barChart}>
      {items.map((item) => (
        <div key={item.key} style={styles.barColumn}>
          <div style={styles.barValue}>{formatCurrencyCompact(item.cashBalance)}</div>
          <div style={styles.barTrack}>
            <div
              style={{
                ...styles.barFillBack,
                height: `${Math.max((item.receivedNet / maxValue) * 100, item.receivedNet > 0 ? 10 : 0)}%`,
              }}
            />
            <div
              style={{
                ...styles.barFillFront,
                height: `${Math.max((item.cashBalance / maxValue) * 100, item.cashBalance > 0 ? 10 : 0)}%`,
              }}
            />
          </div>
          <div style={styles.barLabel}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function CategoryBreakdown({
  items,
  loading,
}: {
  items: CategoryTotal[];
  loading: boolean;
}) {
  if (loading) {
    return <div style={styles.emptyState}>Carregando categorias...</div>;
  }

  if (items.length === 0) {
    return <div style={styles.emptyState}>Nenhuma despesa categorizada neste mes.</div>;
  }

  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <div style={styles.categoryList}>
      {items.map((item, index) => (
        <div key={item.label} style={styles.categoryItem}>
          <div style={styles.categoryTop}>
            <span style={styles.categoryLabel}>{item.label}</span>
            <strong style={styles.categoryValue}>{formatCurrency(item.value)}</strong>
          </div>
          <div style={styles.categoryTrack}>
            <div
              style={{
                ...styles.categoryFill,
                width: `${Math.max((item.value / maxValue) * 100, 8)}%`,
                background: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function parseBrazilianNumber(value: string) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value?: string) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  return normalized;
}

function formatCurrency(value?: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

function formatCurrencyCompact(value?: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function formatDate(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

const CATEGORY_COLORS = [
  "#0d4de3",
  "#f0b53f",
  "#0b1633",
  "#fff000",
  "#1d63e9",
  "#7c5cff",
];

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: "16px",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "14px",
  },
  heroMain: {
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.95) 0%, rgba(255,253,245,0.98) 100%)",
    borderRadius: "22px",
    padding: "22px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow)",
  },
  kicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: "var(--rr-blue)",
    fontWeight: 800,
    marginBottom: "10px",
  },
  title: {
    margin: 0,
    fontSize: "clamp(2rem, 3vw, 3.2rem)",
    color: "var(--rr-ink)",
  },
  description: {
    margin: "14px 0 0",
    fontSize: "14px",
    lineHeight: 1.62,
    color: "var(--rr-muted)",
  },
  heroAside: {
    background:
      "linear-gradient(180deg, rgba(13,77,227,0.96) 0%, rgba(7,37,125,0.98) 100%)",
    borderRadius: "22px",
    padding: "20px",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "var(--rr-shadow)",
    display: "grid",
    gap: "16px",
    alignContent: "start",
  },
  selectorLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "rgba(255,255,255,0.72)",
    fontWeight: 800,
  },
  select: {
    width: "100%",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.18)",
    padding: "14px 16px",
    fontSize: "15px",
    fontWeight: 700,
    background: "rgba(255,255,255,0.92)",
    color: "var(--rr-blue-deep)",
    outline: "none",
  },
  heroStats: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "12px",
  },
  heroStat: {
    borderRadius: "18px",
    padding: "14px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    display: "grid",
    gap: "6px",
  },
  heroStatLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "rgba(255,255,255,0.7)",
  },
  heroStatValue: {
    fontSize: "22px",
    color: "var(--rr-yellow)",
    fontFamily: "var(--font-heading)",
  },
  errorBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(239,68,68,0.24)",
    color: "#991b1b",
    borderRadius: "18px",
    padding: "16px",
  },
  noticeBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(13,77,227,0.14)",
    color: "var(--rr-blue-deep)",
    borderRadius: "18px",
    padding: "16px",
  },
  alertBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(13,77,227,0.12)",
    color: "var(--rr-blue-deep)",
    borderRadius: "18px",
    padding: "16px",
    lineHeight: 1.6,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "10px",
  },
  subsectionNav: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "-2px",
  },
  subsectionButton: {
    border: "1px solid rgba(13,77,227,0.12)",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.92)",
    color: "var(--rr-blue-deep)",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "var(--rr-shadow-soft)",
  },
  subsectionButtonActive: {
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.98) 0%, rgba(7,37,125,0.98) 100%)",
    color: "#ffffff",
    border: "1px solid rgba(13,77,227,0.98)",
  },
  metricCard: {
    borderRadius: "18px",
    border: "1px solid var(--rr-line)",
    padding: "16px",
    boxShadow: "var(--rr-shadow-soft)",
  },
  metricLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "8px",
    fontWeight: 800,
  },
  metricValue: {
    fontSize: "24px",
    fontWeight: 800,
    fontFamily: "var(--font-heading)",
    marginBottom: "8px",
    lineHeight: 1.2,
  },
  metricDetail: {
    fontSize: "12px",
    lineHeight: 1.5,
    color: "var(--rr-muted)",
  },
  topGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "14px",
    alignItems: "start",
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "14px",
    alignItems: "start",
  },
  bottomGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "14px",
    alignItems: "start",
  },
  chartCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "22px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    overflow: "hidden",
    paddingBottom: "18px",
  },
  tableCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "22px",
    border: "1px solid var(--rr-line)",
    overflow: "hidden",
    boxShadow: "var(--rr-shadow-soft)",
  },
  formRail: {
    display: "grid",
    gap: "14px",
    position: "sticky",
    top: "84px",
  },
  formCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "22px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    overflow: "hidden",
    paddingBottom: "18px",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    padding: "18px 18px 0",
  },
  sectionChip: {
    padding: "8px 12px",
    borderRadius: "999px",
    background: "rgba(13,77,227,0.08)",
    border: "1px solid rgba(13,77,227,0.12)",
    color: "var(--rr-blue-deep)",
    fontSize: "12px",
    fontWeight: 800,
  },
  sectionHeaderCompact: {
    padding: "18px 18px 0",
  },
  sectionKicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "8px",
    fontWeight: 800,
  },
  sectionTitle: {
    margin: 0,
    fontSize: "22px",
    color: "var(--rr-ink)",
  },
  barChart: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(48px, 1fr))",
    gap: "10px",
    alignItems: "end",
    padding: "16px 18px 0",
    minHeight: "210px",
  },
  barColumn: {
    display: "grid",
    gap: "8px",
    alignItems: "end",
    justifyItems: "center",
  },
  barValue: {
    fontSize: "11px",
    color: "var(--rr-muted)",
    fontWeight: 700,
  },
  barTrack: {
    width: "100%",
    maxWidth: "40px",
    height: "118px",
    borderRadius: "14px",
    background: "linear-gradient(180deg, rgba(13,77,227,0.06) 0%, rgba(13,77,227,0.12) 100%)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: "4px",
    padding: "4px",
  },
  barFillBack: {
    width: "45%",
    borderRadius: "10px",
    background: "linear-gradient(180deg, rgba(13,77,227,0.95) 0%, rgba(7,37,125,0.98) 100%)",
    boxShadow: "0 12px 22px rgba(13,77,227,0.16)",
  },
  barFillFront: {
    width: "45%",
    borderRadius: "10px",
    background: "linear-gradient(180deg, rgba(255,240,0,1) 0%, rgba(214,161,63,0.95) 100%)",
    boxShadow: "0 12px 22px rgba(214,161,63,0.18)",
  },
  barLabel: {
    fontSize: "12px",
    color: "var(--rr-blue-deep)",
    fontWeight: 700,
  },
  categoryList: {
    display: "grid",
    gap: "12px",
    padding: "16px 18px 0",
  },
  categoryItem: {
    display: "grid",
    gap: "8px",
  },
  categoryTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
  },
  categoryLabel: {
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--rr-ink)",
  },
  categoryValue: {
    fontSize: "13px",
    color: "var(--rr-blue-deep)",
  },
  categoryTrack: {
    width: "100%",
    height: "12px",
    borderRadius: "999px",
    background: "rgba(13,77,227,0.08)",
    overflow: "hidden",
  },
  categoryFill: {
    height: "100%",
    borderRadius: "999px",
  },
  tableWrap: {
    overflowX: "auto",
    padding: "14px 18px 18px",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
  },
  th: {
    textAlign: "left",
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--rr-blue)",
    padding: "0 12px 12px 0",
    borderBottom: "1px solid var(--rr-line)",
    fontWeight: 800,
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
    background: "rgba(255,255,255,0.98)",
    zIndex: 1,
  },
  td: {
    padding: "12px 12px 12px 0",
    fontSize: "13px",
    color: "var(--rr-muted)",
    borderBottom: "1px solid rgba(13,77,227,0.08)",
    whiteSpace: "nowrap",
    verticalAlign: "top",
  },
  tdStrong: {
    padding: "12px 12px 12px 0",
    fontSize: "13px",
    color: "var(--rr-ink)",
    borderBottom: "1px solid rgba(13,77,227,0.08)",
    whiteSpace: "nowrap",
    fontWeight: 800,
    verticalAlign: "top",
  },
  companyName: {
    color: "var(--rr-ink)",
    fontWeight: 700,
    marginBottom: "4px",
  },
  companyMeta: {
    fontSize: "12px",
    color: "var(--rr-muted)",
  },
  formGrid: {
    display: "grid",
    gap: "10px",
    padding: "14px 18px 0",
  },
  formRow: {
    display: "grid",
    gap: "6px",
  },
  formLabel: {
    fontSize: "12px",
    color: "var(--rr-blue)",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  input: {
    width: "100%",
    borderRadius: "12px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "10px 12px",
    fontSize: "14px",
    color: "var(--rr-ink)",
    background: "rgba(255,255,255,0.96)",
    outline: "none",
  },
  textarea: {
    width: "100%",
    minHeight: "92px",
    borderRadius: "12px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "10px 12px",
    fontSize: "14px",
    color: "var(--rr-ink)",
    background: "rgba(255,255,255,0.96)",
    outline: "none",
    resize: "vertical",
    fontFamily: "inherit",
  },
  primaryButton: {
    border: 0,
    borderRadius: "16px",
    padding: "14px 16px",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
    color: "#ffffff",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.98) 0%, rgba(7,37,125,0.98) 100%)",
    boxShadow: "0 14px 28px rgba(13,77,227,0.16)",
  },
  secondaryButton: {
    border: 0,
    borderRadius: "16px",
    padding: "14px 16px",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
    color: "var(--rr-blue-deep)",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.95) 0%, rgba(214,161,63,0.92) 100%)",
    boxShadow: "0 14px 24px rgba(214,161,63,0.14)",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  badgeOk: {
    background: "rgba(13,77,227,0.1)",
    color: "var(--rr-blue-deep)",
  },
  badgeWarning: {
    background: "rgba(245,158,11,0.14)",
    color: "#92400e",
  },
  list: {
    display: "grid",
    gap: "10px",
    padding: "14px 18px 18px",
  },
  listItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "center",
    padding: "14px",
    borderRadius: "16px",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.12) 0%, rgba(255,255,255,0.96) 100%)",
    border: "1px solid rgba(13,77,227,0.1)",
  },
  listValue: {
    fontSize: "15px",
    fontWeight: 800,
    color: "var(--rr-blue-deep)",
  },
  emptyState: {
    margin: "14px 18px 18px",
    padding: "16px",
    color: "var(--rr-muted)",
    fontSize: "14px",
    lineHeight: 1.6,
    borderRadius: "16px",
    border: "1px dashed rgba(13,77,227,0.16)",
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.04) 0%, rgba(255,255,255,0.96) 100%)",
  },
};
