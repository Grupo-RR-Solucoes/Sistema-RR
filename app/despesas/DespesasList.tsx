"use client";

import { useMemo, useState, type CSSProperties } from "react";

import type { UserRole } from "@/lib/auth/types";
import { canDeleteExpense } from "@/lib/auth/permissions";

import DespesaModal from "./DespesaModal";

export interface CompanyOption {
  id: string;
  name: string;
  cnpj: string;
  active: boolean | null;
}

export interface CategoryOption {
  id: string;
  name: string;
  active: boolean | null;
}

export interface ExpenseRow {
  id: string;
  company_id: string | null;
  year: number;
  month: number;
  category_id: string | null;
  scope: string | null;
  description: string;
  amount: number | null;
  due_date: string | null;
  payment_date: string | null;
  status: string | null;
  notes: string | null;
  created_at: string | null;
}

interface Props {
  initialCompanies: CompanyOption[];
  initialCategories: CategoryOption[];
  initialExpenses: ExpenseRow[];
  loadError: string | null;
  currentUserId: string;
  currentUserRole: UserRole;
}

interface Filters {
  companyId: string;
  year: string;
  month: string;
  status: string;
  categoryId: string;
}

const EMPTY_FILTERS: Filters = {
  companyId: "",
  year: "",
  month: "",
  status: "",
  categoryId: "",
};

const MONTHS_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR];

function normalizeStatus(s: string | null | undefined): "PAID" | "PLANNED" {
  const v = String(s ?? "").toUpperCase();
  if (v === "PAID" || v === "PAGO") return "PAID";
  return "PLANNED";
}

function formatBRL(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  // ISO date (YYYY-MM-DD). Parse manualmente para evitar timezone shift.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function DespesasList({
  initialCompanies,
  initialCategories,
  initialExpenses,
  loadError,
  currentUserId: _currentUserId,
  currentUserRole,
}: Props) {
  const [expenses, setExpenses] = useState<ExpenseRow[]>(initialExpenses);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [modalState, setModalState] = useState<
    { mode: "none" } | { mode: "create" } | { mode: "edit"; expense: ExpenseRow }
  >({ mode: "none" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(loadError);
  const [isFetching, setIsFetching] = useState(false);

  const companyById = useMemo(
    () => new Map(initialCompanies.map((c) => [c.id, c])),
    [initialCompanies]
  );
  const categoryById = useMemo(
    () => new Map(initialCategories.map((c) => [c.id, c])),
    [initialCategories]
  );

  const hasActiveFilter = useMemo(
    () =>
      Boolean(
        filters.companyId ||
          filters.year ||
          filters.month ||
          filters.status ||
          filters.categoryId
      ),
    [filters]
  );

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (filters.companyId && e.company_id !== filters.companyId) return false;
      if (filters.year && String(e.year) !== filters.year) return false;
      if (filters.month && String(e.month) !== filters.month) return false;
      if (filters.status && normalizeStatus(e.status) !== filters.status)
        return false;
      if (filters.categoryId && e.category_id !== filters.categoryId)
        return false;
      return true;
    });
  }, [expenses, filters]);

  const kpis = useMemo(() => {
    const today = todayISO();
    let planned = 0;
    let paid = 0;
    let overdue = 0;
    for (const e of filteredExpenses) {
      const amount = Number(e.amount ?? 0);
      const status = normalizeStatus(e.status);
      if (status === "PAID") {
        paid += amount;
      } else {
        planned += amount;
        if (e.due_date && e.due_date < today) overdue += amount;
      }
    }
    return { planned, paid, overdue };
  }, [filteredExpenses]);

  async function refetch() {
    setIsFetching(true);
    setError(null);
    try {
      const res = await fetch("/api/financeiro", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Falha ao recarregar despesas");
        return;
      }
      const body = await res.json();
      setExpenses((body.expenses ?? []) as ExpenseRow[]);
    } finally {
      setIsFetching(false);
    }
  }

  async function markAsPaid(expense: ExpenseRow) {
    const ok = window.confirm(
      `Marcar a despesa "${expense.description}" como PAGA com data de hoje?`
    );
    if (!ok) return;
    setBusyId(expense.id);
    setError(null);
    try {
      const res = await fetch(`/api/financeiro/${expense.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "PAID",
          payment_date: todayISO(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Falha ao marcar como paga");
        return;
      }
      await refetch();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteExpense(expense: ExpenseRow) {
    const ok = window.confirm(
      `Confirma DELETAR a despesa "${expense.description}" (${formatBRL(expense.amount)})? Esta acao nao pode ser desfeita.`
    );
    if (!ok) return;
    setBusyId(expense.id);
    setError(null);
    try {
      const res = await fetch(`/api/financeiro/${expense.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Falha ao deletar despesa");
        return;
      }
      await refetch();
    } finally {
      setBusyId(null);
    }
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerCopy}>
          <div style={styles.kicker}>GESTÃO DE DESPESAS</div>
          <h2 style={styles.title}>Despesas operacionais</h2>
          <p style={styles.subtitle}>
            Sócios e funcionários lançam despesas mensais por empresa. Sócios
            podem deletar lançamentos. Toda criação, edição e remoção é
            auditada automaticamente.
          </p>
        </div>
        <button
          type="button"
          style={styles.primaryBtn}
          onClick={() => setModalState({ mode: "create" })}
        >
          + Nova despesa
        </button>
      </header>

      {error ? (
        <div role="alert" style={styles.errorBanner}>
          {error}
        </div>
      ) : null}

      <div style={styles.filtersWrap}>
        <div style={styles.filtersGrid}>
          <label style={styles.filterLabel}>
            <span style={styles.filterLabelText}>Empresa</span>
            <select
              value={filters.companyId}
              onChange={(e) =>
                setFilters((f) => ({ ...f, companyId: e.target.value }))
              }
              style={styles.input}
            >
              <option value="">Todas</option>
              {initialCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.filterLabel}>
            <span style={styles.filterLabelText}>Ano</span>
            <select
              value={filters.year}
              onChange={(e) =>
                setFilters((f) => ({ ...f, year: e.target.value }))
              }
              style={styles.input}
            >
              <option value="">Todos</option>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.filterLabel}>
            <span style={styles.filterLabelText}>Mês</span>
            <select
              value={filters.month}
              onChange={(e) =>
                setFilters((f) => ({ ...f, month: e.target.value }))
              }
              style={styles.input}
            >
              <option value="">Todos</option>
              {MONTHS_PT.map((label, idx) => (
                <option key={idx + 1} value={String(idx + 1)}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.filterLabel}>
            <span style={styles.filterLabelText}>Status</span>
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: e.target.value }))
              }
              style={styles.input}
            >
              <option value="">Todos</option>
              <option value="PLANNED">Planejada</option>
              <option value="PAID">Paga</option>
            </select>
          </label>
          <label style={styles.filterLabel}>
            <span style={styles.filterLabelText}>Categoria</span>
            <select
              value={filters.categoryId}
              onChange={(e) =>
                setFilters((f) => ({ ...f, categoryId: e.target.value }))
              }
              style={styles.input}
            >
              <option value="">Todas</option>
              {initialCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {hasActiveFilter ? (
          <button
            type="button"
            onClick={clearFilters}
            style={styles.clearFiltersBtn}
          >
            Limpar filtros
          </button>
        ) : null}
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Descrição</th>
              <th style={styles.th}>Empresa</th>
              <th style={styles.th}>Categoria</th>
              <th style={styles.th}>Competência</th>
              <th style={styles.th}>Vencimento</th>
              <th style={styles.thRight}>Valor</th>
              <th style={styles.th}>Status</th>
              <th style={styles.thActions}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredExpenses.length === 0 ? (
              <tr>
                <td colSpan={8} style={styles.empty}>
                  {isFetching
                    ? "Recarregando..."
                    : hasActiveFilter
                      ? "Nenhuma despesa encontrada com os filtros atuais."
                      : "Nenhuma despesa cadastrada ainda."}
                </td>
              </tr>
            ) : (
              filteredExpenses.map((e) => {
                const status = normalizeStatus(e.status);
                const companyName =
                  companyById.get(e.company_id ?? "")?.name ?? "—";
                const categoryName =
                  categoryById.get(e.category_id ?? "")?.name ?? "—";
                const canDelete = canDeleteExpense(currentUserRole);
                return (
                  <tr key={e.id}>
                    <td style={styles.td}>{e.description}</td>
                    <td style={styles.td}>{companyName}</td>
                    <td style={styles.td}>{categoryName}</td>
                    <td style={styles.td}>
                      {String(e.month).padStart(2, "0")}/{e.year}
                    </td>
                    <td style={styles.td}>{formatDateBR(e.due_date)}</td>
                    <td style={styles.tdRight}>{formatBRL(e.amount)}</td>
                    <td style={styles.td}>
                      <span style={statusChip(status)}>
                        {status === "PAID" ? "Paga" : "Planejada"}
                      </span>
                    </td>
                    <td style={styles.tdActions}>
                      <button
                        type="button"
                        style={styles.actionBtn}
                        disabled={busyId === e.id}
                        onClick={() => setModalState({ mode: "edit", expense: e })}
                        title="Editar despesa"
                      >
                        Editar
                      </button>
                      {status === "PLANNED" ? (
                        <button
                          type="button"
                          style={styles.actionBtn}
                          disabled={busyId === e.id}
                          onClick={() => markAsPaid(e)}
                          title="Marcar como paga com data de hoje"
                        >
                          Marcar como paga
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          style={styles.dangerBtn}
                          disabled={busyId === e.id}
                          onClick={() => deleteExpense(e)}
                          title="Deletar despesa (apenas sócio)"
                        >
                          Deletar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={styles.kpiGrid}>
        <KpiCard
          label="Planejado"
          value={formatBRL(kpis.planned)}
          tone="neutral"
        />
        <KpiCard label="Pago" value={formatBRL(kpis.paid)} tone="success" />
        <KpiCard
          label="Atrasado"
          value={formatBRL(kpis.overdue)}
          tone="danger"
        />
      </div>

      {modalState.mode !== "none" ? (
        <DespesaModal
          mode={modalState.mode}
          expense={modalState.mode === "edit" ? modalState.expense : null}
          companies={initialCompanies}
          categories={initialCategories}
          onClose={() => setModalState({ mode: "none" })}
          onSuccess={async () => {
            setModalState({ mode: "none" });
            await refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "success" | "danger";
}) {
  const palette: Record<typeof tone, { bg: string; color: string; label: string }> =
    {
      neutral: { bg: "#E8EDF5", color: "#0F1F4A", label: "#5A6B82" },
      success: {
        bg: "rgba(40,140,80,0.10)",
        color: "#185a36",
        label: "#185a36",
      },
      danger: {
        bg: "rgba(180,30,30,0.08)",
        color: "#8a1717",
        label: "#8a1717",
      },
    };
  const c = palette[tone];
  return (
    <div style={{ ...styles.kpiCard, background: c.bg }}>
      <div style={{ ...styles.kpiLabel, color: c.label }}>{label}</div>
      <div style={{ ...styles.kpiValue, color: c.color }}>{value}</div>
    </div>
  );
}

function statusChip(status: "PAID" | "PLANNED"): CSSProperties {
  const base: CSSProperties = {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.3px",
  };
  if (status === "PAID") {
    return { ...base, background: "rgba(40,140,80,0.14)", color: "#185a36" };
  }
  return { ...base, background: "#E8EDF5", color: "#5A6B82" };
}

const styles: Record<string, CSSProperties> = {
  page: { display: "grid", gap: 24 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 20,
    flexWrap: "wrap",
    marginBottom: 4,
  },
  headerCopy: { display: "grid", gap: 8, maxWidth: 760 },
  kicker: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "2.5px",
    textTransform: "uppercase",
    color: "#0d4de3",
  },
  title: {
    margin: 0,
    fontSize: "clamp(2rem, 3.5vw, 2.4rem)",
    fontWeight: 700,
    color: "#0F1F4A",
    lineHeight: 1.1,
  },
  subtitle: {
    margin: 0,
    fontSize: 15,
    color: "#5A6B82",
    maxWidth: 720,
    lineHeight: 1.6,
  },
  primaryBtn: {
    padding: "12px 20px",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    background: "#0d4de3",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.5px",
    textTransform: "uppercase",
    boxShadow: "0 4px 12px rgba(13,77,227,0.18)",
    alignSelf: "flex-start",
  },
  errorBanner: {
    padding: "10px 14px",
    borderRadius: 10,
    background: "rgba(180,30,30,0.08)",
    border: "1px solid rgba(180,30,30,0.24)",
    color: "#8a1717",
    fontSize: 13,
    fontWeight: 600,
  },
  filtersWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "16px 18px",
    background: "var(--rr-surface-elevated)",
    border: "1px solid var(--rr-line)",
    borderRadius: 16,
  },
  filtersGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
  },
  filterLabel: { display: "grid", gap: 6 },
  filterLabelText: {
    fontSize: 11,
    fontWeight: 700,
    color: "#0F1F4A",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  clearFiltersBtn: {
    alignSelf: "flex-end",
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-blue-deep)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  tableWrap: {
    overflowX: "auto",
    background: "var(--rr-surface-elevated)",
    border: "1px solid var(--rr-line)",
    borderRadius: 16,
    boxShadow: "var(--rr-shadow-soft)",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left",
    padding: "12px 14px",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#0F1F4A",
    borderBottom: "1px solid var(--rr-line)",
    background: "#E8EDF5",
  },
  thRight: {
    textAlign: "right",
    padding: "12px 14px",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#0F1F4A",
    borderBottom: "1px solid var(--rr-line)",
    background: "#E8EDF5",
  },
  thActions: {
    textAlign: "right",
    padding: "12px 14px",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#0F1F4A",
    borderBottom: "1px solid var(--rr-line)",
    background: "#E8EDF5",
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid var(--rr-line)",
    color: "var(--rr-ink)",
    verticalAlign: "middle",
  },
  tdRight: {
    padding: "12px 14px",
    borderBottom: "1px solid var(--rr-line)",
    color: "var(--rr-ink)",
    verticalAlign: "middle",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  tdActions: {
    padding: "10px 14px",
    borderBottom: "1px solid var(--rr-line)",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  empty: {
    padding: "28px 14px",
    textAlign: "center",
    color: "var(--rr-muted)",
    fontStyle: "italic",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "9px 12px",
    borderRadius: 10,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    fontSize: 14,
    color: "var(--rr-ink)",
    outline: "none",
    fontFamily: "inherit",
  },
  actionBtn: {
    marginLeft: 8,
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-blue-deep)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  dangerBtn: {
    marginLeft: 8,
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid rgba(180,30,30,0.32)",
    background: "rgba(180,30,30,0.06)",
    color: "#8a1717",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  kpiCard: {
    padding: "16px 18px",
    borderRadius: 16,
    display: "grid",
    gap: 6,
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
  },
};
