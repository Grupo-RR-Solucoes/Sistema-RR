"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import type { UserRole } from "@/lib/auth/types";
import { canDeleteExpense } from "@/lib/auth/permissions";

import DespesaModal from "./DespesaModal";
import { UiStyles, HeaderNavy, KpiBand } from "@/components/ui";

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
  search: string;
}

const EMPTY_FILTERS: Filters = {
  companyId: "",
  year: "",
  month: "",
  status: "",
  categoryId: "",
  search: "",
};

// Sentinela do filtro de empresa para "Grupo todo" (despesas sem CNPJ).
const GROUP_FILTER = "__GROUP__";

const MONTHS_SHORT = [
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

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

/** Uma despesa é de escopo grupo quando scope ∈ {GROUP,GRUPO} ou não tem CNPJ. */
export function isGroupExpense(e: {
  scope: string | null;
  company_id: string | null;
}): boolean {
  const s = String(e.scope ?? "").trim().toUpperCase();
  return s === "GROUP" || s === "GRUPO" || !e.company_id;
}

function normalizeStatus(s: string | null | undefined): "PAID" | "PLANNED" {
  const v = String(s ?? "").toUpperCase();
  if (v === "PAID" || v === "PAGO") return "PAID";
  return "PLANNED";
}

function isPaid(e: ExpenseRow): boolean {
  return normalizeStatus(e.status) === "PAID" || Boolean(e.payment_date);
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
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();
  const [newCategory, setNewCategory] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryDone, setCategoryDone] = useState(false);

  const isSocio = currentUserRole === "socio";
  const canDelete = canDeleteExpense(currentUserRole);

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
          filters.categoryId ||
          filters.search.trim()
      ),
    [filters]
  );

  const filteredExpenses = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const list = expenses.filter((e) => {
      if (filters.companyId === GROUP_FILTER) {
        if (!isGroupExpense(e)) return false;
      } else if (filters.companyId) {
        if (e.company_id !== filters.companyId) return false;
      }
      if (filters.year && String(e.year) !== filters.year) return false;
      if (filters.month && String(e.month).padStart(2, "0") !== filters.month)
        return false;
      if (filters.status) {
        const paid = isPaid(e);
        if (filters.status === "paga" && !paid) return false;
        if (filters.status === "plan" && paid) return false;
      }
      if (filters.categoryId && e.category_id !== filters.categoryId)
        return false;
      if (
        q &&
        e.description.toLowerCase().indexOf(q) < 0 &&
        String(e.notes ?? "").toLowerCase().indexOf(q) < 0
      )
        return false;
      return true;
    });
    list.sort((a, b) => {
      const ka = `${a.year}${String(a.month).padStart(2, "0")}`;
      const kb = `${b.year}${String(b.month).padStart(2, "0")}`;
      if (ka !== kb) return kb < ka ? -1 : 1;
      return String(b.due_date ?? "") < String(a.due_date ?? "") ? -1 : 1;
    });
    return list;
  }, [expenses, filters]);

  const kpis = useMemo(() => {
    const today = todayISO();
    let planned = 0;
    let paid = 0;
    let overdue = 0;
    for (const e of filteredExpenses) {
      const amount = Number(e.amount ?? 0);
      if (isPaid(e)) {
        paid += amount;
      } else {
        planned += amount;
        if (e.due_date && e.due_date < today) overdue += amount;
      }
    }
    return { planned, paid, overdue };
  }, [filteredExpenses]);

  const total = useMemo(
    () => filteredExpenses.reduce((s, e) => s + Number(e.amount ?? 0), 0),
    [filteredExpenses]
  );

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }

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

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    setAddingCategory(true);
    setError(null);
    try {
      const res = await fetch("/api/financeiro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "category", name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Falha ao criar categoria");
        return;
      }
      setNewCategory("");
      setCategoryDone(true);
      window.setTimeout(() => setCategoryDone(false), 1600);
      showToast("Categoria adicionada");
      router.refresh(); // re-fetcha as categorias (prop do servidor)
    } finally {
      setAddingCategory(false);
    }
  }

  async function markAsPaid(expense: ExpenseRow) {
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
      showToast("Marcada como paga");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteExpense(expense: ExpenseRow) {
    const ok = window.confirm(
      `Excluir a despesa "${expense.description}" (${formatBRL(expense.amount)})? Esta ação não pode ser desfeita.`
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
      showToast("Despesa excluída");
    } finally {
      setBusyId(null);
    }
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
  }

  const today = todayISO();
  const noneAtAll = expenses.length === 0;
  const emptyFiltered = !noneAtAll && filteredExpenses.length === 0;

  return (
    <div className="rrdesp">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <Link href="/dashboard">Dashboard</Link>
          <span className="sep">/</span>
          <Link href="/financeiro">Financeiro</Link>
          <span className="sep">/</span>
          <span>Despesas</span>
        </nav>

        {/* HEADER navy (kit) — CTA em actions; KPIs como children. Barras de
            status dos KPIs viram subTone no sublabel (ok/amber legíveis no navy) */}
        <HeaderNavy
          brand="GRUPO RR CRED"
          title="Despesas operacionais"
          subtitle="Fonte que alimenta o Caixa e a DRE · sócios + equipe"
          actions={
            <button className="btn-new" onClick={() => setModalState({ mode: "create" })}>
              <span className="plus">+</span>Nova despesa
            </button>
          }
        >
          <KpiBand
            valueSize={24}
            items={[
              { label: "Planejado", value: formatBRL(kpis.planned), sub: "a pagar no período filtrado" },
              { label: "Pago", value: formatBRL(kpis.paid), sub: "liquidado no período filtrado", subTone: "ok" },
              {
                label: "Atrasado",
                value: formatBRL(kpis.overdue),
                sub: kpis.overdue > 0 ? "venceu e não foi pago" : "nada vencido em aberto",
                subTone: kpis.overdue > 0 ? "amber" : "neutral",
              },
            ]}
          />
        </HeaderNavy>

        {error ? <div className="banner err">{error}</div> : null}

        {/* FILTER BAR */}
        <div className="filters">
          <div className="fsel">
            <select
              aria-label="Empresa"
              value={filters.companyId}
              onChange={(e) =>
                setFilters((f) => ({ ...f, companyId: e.target.value }))
              }
            >
              <option value="">Todas empresas</option>
              {initialCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={GROUP_FILTER}>Grupo todo</option>
            </select>
            <span className="chev">▾</span>
          </div>
          <div className="fsel">
            <select
              aria-label="Ano"
              value={filters.year}
              onChange={(e) => setFilters((f) => ({ ...f, year: e.target.value }))}
            >
              <option value="">Ano</option>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
            <span className="chev">▾</span>
          </div>
          <div className="fsel">
            <select
              aria-label="Mês"
              value={filters.month}
              onChange={(e) =>
                setFilters((f) => ({ ...f, month: e.target.value }))
              }
            >
              <option value="">Mês</option>
              {MONTHS_SHORT.map((label, idx) => (
                <option key={idx + 1} value={String(idx + 1).padStart(2, "0")}>
                  {label}
                </option>
              ))}
            </select>
            <span className="chev">▾</span>
          </div>
          <div className="fsel">
            <select
              aria-label="Status"
              value={filters.status}
              onChange={(e) =>
                setFilters((f) => ({ ...f, status: e.target.value }))
              }
            >
              <option value="">Status</option>
              <option value="paga">Paga</option>
              <option value="plan">Planejada</option>
            </select>
            <span className="chev">▾</span>
          </div>
          <div className="fsel">
            <select
              aria-label="Categoria"
              value={filters.categoryId}
              onChange={(e) =>
                setFilters((f) => ({ ...f, categoryId: e.target.value }))
              }
            >
              <option value="">Categoria</option>
              {initialCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="chev">▾</span>
          </div>
          <div className="divider" />
          <label className="search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por descrição…"
              value={filters.search}
              onChange={(e) =>
                setFilters((f) => ({ ...f, search: e.target.value }))
              }
            />
          </label>
          {hasActiveFilter ? (
            <button className="clear" onClick={clearFilters}>
              Limpar filtros
            </button>
          ) : null}
        </div>

        {/* TABLE */}
        <section className="tcard">
          <div className="tcard-head">
            <h2>Despesas lançadas</h2>
            <div className="tcard-meta">
              <span className="cnt">
                <b>{filteredExpenses.length}</b>{" "}
                {filteredExpenses.length === 1 ? "despesa" : "despesas"}
              </span>
              <span className="total">
                Total: <b className="num">{formatBRL(total)}</b>
              </span>
            </div>
          </div>

          {!noneAtAll && !emptyFiltered ? (
            <div className="tscroll">
              <table>
                <thead>
                  <tr>
                    <th className="sticky">Descrição</th>
                    <th>Empresa / Escopo</th>
                    <th>Categoria</th>
                    <th>Competência</th>
                    <th>Vencimento</th>
                    <th className="r">Valor</th>
                    <th className="c">Status</th>
                    <th className="r">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map((e) => {
                    const paid = isPaid(e);
                    const over = !paid && e.due_date && e.due_date < today;
                    const group = isGroupExpense(e);
                    const companyName =
                      companyById.get(e.company_id ?? "")?.name ?? "—";
                    const categoryName =
                      categoryById.get(e.category_id ?? "")?.name ?? "—";
                    const rowBusy = busyId === e.id;
                    return (
                      <tr key={e.id}>
                        <td className="sticky desc-cell">
                          {e.description}
                          {e.notes ? <span className="obs">{e.notes}</span> : null}
                        </td>
                        <td>
                          {group ? (
                            <span className="scope">
                              <span className="badge grupo">Grupo</span>Rateado
                            </span>
                          ) : (
                            <span className="scope">{companyName}</span>
                          )}
                        </td>
                        <td className="cat-cell">
                          <span className="cat-tag">{categoryName}</span>
                        </td>
                        <td className="comp-cell">
                          {String(e.month).padStart(2, "0")}/{e.year}
                        </td>
                        <td className={`venc-cell${over ? " over" : ""}`}>
                          {formatDateBR(e.due_date)}
                        </td>
                        <td className="amt">{formatBRL(e.amount)}</td>
                        <td style={{ textAlign: "center" }}>
                          {paid ? (
                            <span className="chip paga">
                              <span className="d" />
                              Paga
                            </span>
                          ) : (
                            <span className="chip plan">
                              <span className="d" />
                              Planejada
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="acts">
                            <button
                              className="iconbtn edit"
                              title="Editar"
                              disabled={rowBusy}
                              onClick={() =>
                                setModalState({ mode: "edit", expense: e })
                              }
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                              </svg>
                            </button>
                            <button
                              className="iconbtn pay"
                              title={paid ? "Já paga" : "Marcar paga"}
                              disabled={paid || rowBusy}
                              onClick={() => markAsPaid(e)}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            </button>
                            {canDelete ? (
                              <button
                                className="iconbtn del"
                                title="Excluir"
                                disabled={rowBusy}
                                onClick={() => deleteExpense(e)}
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <div className="art">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" />
                  <path d="M9 7V5a3 3 0 0 1 6 0v2" />
                  <path d="M12 12v4M10 14h4" />
                </svg>
              </div>
              {emptyFiltered ? (
                <>
                  <h3>
                    {isFetching
                      ? "Recarregando…"
                      : "Nenhuma despesa com esses filtros"}
                  </h3>
                  <p>Ajuste ou limpe os filtros para ver os lançamentos.</p>
                  {hasActiveFilter ? (
                    <button className="btn-new" onClick={clearFilters}>
                      Limpar filtros
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <h3>Nenhuma despesa cadastrada ainda</h3>
                  <p>
                    Comece lançando a primeira despesa operacional. Tudo que você
                    registrar aqui vira saída no Caixa e custo na DRE da
                    competência.
                  </p>
                  <button
                    className="btn-new"
                    onClick={() => setModalState({ mode: "create" })}
                  >
                    <span className="plus">+</span>Lançar primeira despesa
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {/* NOVA CATEGORIA (discreta, só sócio) */}
        {isSocio ? (
          <div className="catbar">
            <span className="lbl">
              <span className="socio">SÓCIO</span>Gerenciar categorias de despesa
            </span>
            <form onSubmit={handleAddCategory} autoComplete="off">
              <input
                type="text"
                placeholder="Nova categoria…"
                aria-label="Nome da nova categoria"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
              <button
                type="submit"
                className={`add${categoryDone ? " done" : ""}`}
                disabled={addingCategory}
              >
                {categoryDone
                  ? "Adicionada"
                  : addingCategory
                    ? "Salvando…"
                    : "Adicionar"}
              </button>
            </form>
          </div>
        ) : null}
      </main>

      {modalState.mode !== "none" ? (
        <DespesaModal
          mode={modalState.mode}
          expense={modalState.mode === "edit" ? modalState.expense : null}
          companies={initialCompanies}
          categories={initialCategories}
          onClose={() => setModalState({ mode: "none" })}
          onSuccess={async (message) => {
            setModalState({ mode: "none" });
            await refetch();
            showToast(message);
          }}
        />
      ) : null}

      {toast ? (
        <div className="toast show">
          <span className="ck">✓</span>
          <span>{toast}</span>
        </div>
      ) : null}
    </div>
  );
}

const CSS = `
.rrdesp{
  --navy:#0F1F4A; --navy-deep:#0B1838; --navy-bar:#1E3066;
  --yellow:#FFF000; --gold:#D6A13F; --gold-deep:#B9842A; --gold-soft:#E7BE6A;
  --green:#3C9D6B; --green-soft:#5FB98A; --green-bg:#E9F5EF; --green-bd:#BFE3D0;
  --warn:#B07A12; --warn-soft:#D69A1E; --warn-bg:#FBF1DC; --warn-bd:#EAD7A6;
  --red:#C0443C; --red-soft:#E07A72; --red-bg:#FBECEB; --red-bd:#F0C7C3;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C;
  --r-lg:20px; --r-md:16px; --r-sm:11px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  --shadow-lg:0 24px 70px rgba(11,24,56,.34);
  background:var(--page);color:var(--ink);font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.45;
}
.rrdesp *{box-sizing:border-box;}
.rrdesp .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrdesp .wrap{max-width:1180px;margin:0 auto;padding:34px 28px 56px;display:flex;flex-direction:column;gap:22px;}

.rrdesp .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:-6px 2px -4px;}
.rrdesp .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rrdesp .crumb a:hover{color:var(--navy);}
.rrdesp .crumb .sep{color:#C2C8D2;}

.rrdesp .btn-new{display:inline-flex;align-items:center;gap:9px;background:var(--yellow);color:var(--navy);border:none;border-radius:11px;padding:13px 20px;font-family:inherit;font-size:13.5px;font-weight:700;letter-spacing:.01em;cursor:pointer;box-shadow:0 6px 18px rgba(255,240,0,.18);transition:transform .12s,box-shadow .12s,background .12s;}
.rrdesp .btn-new:hover{background:#FFF55C;transform:translateY(-1px);box-shadow:0 10px 24px rgba(255,240,0,.26);}
.rrdesp .btn-new .plus{font-size:17px;line-height:1;margin-top:-1px;}

.rrdesp .banner{border-radius:var(--r-md);padding:12px 16px;font-size:13px;}
.rrdesp .banner.err{background:var(--red-bg);border:1px solid #E9B7B2;color:#8E2F28;}

.rrdesp .filters{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-md);box-shadow:var(--shadow);padding:14px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.rrdesp .filters .fsel{position:relative;display:inline-flex;align-items:center;}
.rrdesp .filters select{appearance:none;-webkit-appearance:none;background:#F6F7FA;border:1px solid var(--bd);color:var(--ink-2);font-family:inherit;font-size:12.5px;font-weight:500;padding:9px 30px 9px 13px;border-radius:9px;cursor:pointer;outline:none;transition:border-color .15s,background .15s;}
.rrdesp .filters select:hover{background:#F0F2F6;}
.rrdesp .filters select:focus{border-color:var(--navy);background:#fff;}
.rrdesp .filters .fsel .chev{position:absolute;right:11px;pointer-events:none;color:var(--ink-3);font-size:10px;}
.rrdesp .filters .search{position:relative;display:inline-flex;align-items:center;flex:1;min-width:170px;}
.rrdesp .filters .search svg{position:absolute;left:12px;color:var(--ink-3);pointer-events:none;}
.rrdesp .filters .search input{width:100%;background:#F6F7FA;border:1px solid var(--bd);border-radius:9px;font-family:inherit;font-size:12.5px;color:var(--ink);padding:9px 12px 9px 34px;outline:none;transition:border-color .15s,background .15s;}
.rrdesp .filters .search input:focus{border-color:var(--navy);background:#fff;}
.rrdesp .filters .search input::placeholder{color:var(--ink-3);}
.rrdesp .filters .clear{background:none;border:none;color:var(--ink-3);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:9px 6px;white-space:nowrap;transition:color .15s;}
.rrdesp .filters .clear:hover{color:var(--red);}
.rrdesp .filters .divider{width:1px;height:22px;background:var(--bd);margin:0 2px;}

.rrdesp .tcard{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);overflow:hidden;}
.rrdesp .tcard-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:20px 24px 16px;border-bottom:1px solid var(--bd-soft);}
.rrdesp .tcard-head h2{font-size:16px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrdesp .tcard-meta{display:flex;align-items:center;gap:18px;}
.rrdesp .tcard-head .cnt{font-size:12.5px;color:var(--ink-3);}
.rrdesp .tcard-head .cnt b{color:var(--ink-2);font-weight:600;}
.rrdesp .tcard-head .total{font-size:13px;color:var(--ink-3);}
.rrdesp .tcard-head .total b{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums;}

.rrdesp .tscroll{overflow-x:auto;}
.rrdesp table{width:100%;border-collapse:collapse;min-width:920px;}
.rrdesp thead th{font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);text-align:left;padding:13px 16px;background:#FAFBFC;border-bottom:1px solid var(--bd);white-space:nowrap;}
.rrdesp thead th.r{text-align:right;}
.rrdesp thead th.c{text-align:center;}
.rrdesp tbody td{padding:15px 16px;border-bottom:1px solid var(--bd-soft);font-size:13.5px;color:var(--ink-2);vertical-align:middle;}
.rrdesp tbody tr:last-child td{border-bottom:none;}
.rrdesp tbody tr:hover td{background:#FBFCFD;}
.rrdesp th.sticky,.rrdesp td.sticky{position:sticky;left:0;z-index:2;background:#fff;}
.rrdesp thead th.sticky{background:#FAFBFC;z-index:3;}
.rrdesp tbody tr:hover td.sticky{background:#FBFCFD;}
.rrdesp td.sticky::after,.rrdesp th.sticky::after{content:"";position:absolute;top:0;right:0;bottom:0;width:1px;background:var(--bd-soft);}
.rrdesp .desc-cell{font-weight:600;color:var(--ink);min-width:200px;}
.rrdesp .desc-cell .obs{display:block;font-size:11.5px;font-weight:400;color:var(--ink-3);margin-top:2px;}
.rrdesp .scope{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--ink-2);white-space:nowrap;}
.rrdesp .scope .badge{font-size:10px;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:6px;text-transform:uppercase;}
.rrdesp .scope .badge.grupo{background:#EDF0F6;color:var(--navy);border:1px solid #D8DEEC;}
.rrdesp .cat-cell{white-space:nowrap;}
.rrdesp .cat-tag{display:inline-block;font-size:11.5px;font-weight:500;color:var(--ink-2);background:#F3F5F8;border:1px solid var(--bd);padding:3px 9px;border-radius:7px;}
.rrdesp td.amt{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;font-weight:600;color:var(--ink);text-align:right;white-space:nowrap;}
.rrdesp .comp-cell,.rrdesp .venc-cell{white-space:nowrap;font-variant-numeric:tabular-nums;}
.rrdesp .venc-cell.over{color:var(--warn);font-weight:600;}
.rrdesp .chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:4px 11px;border-radius:999px;white-space:nowrap;}
.rrdesp .chip .d{width:6px;height:6px;border-radius:50%;}
.rrdesp .chip.paga{background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd);}
.rrdesp .chip.paga .d{background:var(--green);}
.rrdesp .chip.plan{background:var(--warn-bg);color:var(--warn);border:1px solid var(--warn-bd);}
.rrdesp .chip.plan .d{background:var(--warn-soft);}
.rrdesp .acts{display:flex;align-items:center;gap:4px;justify-content:flex-end;white-space:nowrap;}
.rrdesp .iconbtn{width:30px;height:30px;border-radius:8px;border:1px solid transparent;background:none;display:grid;place-items:center;cursor:pointer;color:var(--ink-3);transition:background .12s,color .12s,border-color .12s;}
.rrdesp .iconbtn:hover{background:#F1F3F7;color:var(--navy);border-color:var(--bd);}
.rrdesp .iconbtn.pay:hover{background:var(--green-bg);color:var(--green);border-color:var(--green-bd);}
.rrdesp .iconbtn.del:hover{background:var(--red-bg);color:var(--red);border-color:var(--red-bd);}
.rrdesp .iconbtn[disabled]{opacity:.3;cursor:default;}
.rrdesp .iconbtn[disabled]:hover{background:none;color:var(--ink-3);border-color:transparent;}

.rrdesp .empty{padding:64px 30px 70px;text-align:center;display:flex;flex-direction:column;align-items:center;}
.rrdesp .empty .art{width:88px;height:88px;border-radius:24px;background:linear-gradient(160deg,#F4F6FA,#E9EDF4);border:1px solid var(--bd);display:grid;place-items:center;color:var(--navy);margin-bottom:22px;box-shadow:inset 0 1px 0 #fff;}
.rrdesp .empty h3{font-size:18px;font-weight:600;color:var(--ink);margin:0 0 8px;letter-spacing:-.01em;}
.rrdesp .empty p{font-size:13.5px;color:var(--ink-3);margin:0 0 24px;max-width:380px;line-height:1.55;}
.rrdesp .empty .btn-new{background:var(--navy);color:#fff;box-shadow:0 8px 22px rgba(15,31,74,.16);}
.rrdesp .empty .btn-new:hover{background:#16285C;box-shadow:0 12px 28px rgba(15,31,74,.22);}
.rrdesp .empty .btn-new .plus{color:var(--yellow);}

.rrdesp .catbar{display:flex;align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap;margin:-2px 4px;}
.rrdesp .catbar .lbl{font-size:11.5px;color:var(--ink-3);display:inline-flex;align-items:center;gap:8px;}
.rrdesp .catbar .lbl .socio{font-size:10px;font-weight:700;letter-spacing:.04em;color:var(--gold-deep);background:var(--warn-bg);border:1px solid var(--warn-bd);padding:2px 7px;border-radius:6px;}
.rrdesp .catbar form{display:inline-flex;align-items:center;gap:8px;}
.rrdesp .catbar input{background:#fff;border:1px solid var(--bd);border-radius:9px;font-family:inherit;font-size:12.5px;color:var(--ink);padding:8px 12px;outline:none;width:180px;transition:border-color .15s,box-shadow .15s;}
.rrdesp .catbar input:focus{border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.07);}
.rrdesp .catbar .add{background:#fff;border:1px solid var(--navy);color:var(--navy);border-radius:9px;font-family:inherit;font-size:12.5px;font-weight:600;padding:8px 15px;cursor:pointer;transition:background .15s,color .15s;}
.rrdesp .catbar .add:hover{background:var(--navy);color:#fff;}
.rrdesp .catbar .add.done{background:var(--green);border-color:var(--green);color:#fff;}
.rrdesp .catbar .add[disabled]{opacity:.7;cursor:default;}

.rrdesp .overlay{position:fixed;inset:0;background:rgba(11,24,56,.52);backdrop-filter:blur(3px);display:none;align-items:flex-start;justify-content:center;padding:40px 20px;z-index:50;overflow-y:auto;}
.rrdesp .overlay.open{display:flex;}
.rrdesp .modal{background:var(--card);border-radius:var(--r-lg);box-shadow:var(--shadow-lg);width:100%;max-width:600px;overflow:hidden;animation:rrdesp-pop .18s ease;}
@keyframes rrdesp-pop{from{opacity:0;transform:translateY(10px) scale(.985);}to{opacity:1;transform:none;}}
.rrdesp .modal-head{background:var(--navy);color:#fff;padding:22px 26px;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;position:relative;}
.rrdesp .modal-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,var(--gold),rgba(214,161,63,0));opacity:.6;}
.rrdesp .modal-head .mt{font-size:11px;font-weight:600;letter-spacing:.14em;color:var(--yellow);margin:0 0 6px;white-space:nowrap;}
.rrdesp .modal-head h2{font-size:19px;font-weight:600;margin:0;letter-spacing:-.01em;}
.rrdesp .modal-close{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:#C9D2E6;width:32px;height:32px;border-radius:9px;cursor:pointer;display:grid;place-items:center;flex:none;transition:background .15s,color .15s;}
.rrdesp .modal-close:hover{background:rgba(255,255,255,.16);color:#fff;}
.rrdesp .modal-body{padding:24px 26px;}

.rrdesp .scope-toggle{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;}
.rrdesp .scope-opt{border:1.5px solid var(--bd);border-radius:12px;padding:14px 16px;cursor:pointer;transition:border-color .15s,background .15s;display:flex;gap:11px;align-items:flex-start;text-align:left;background:#fff;font-family:inherit;width:100%;}
.rrdesp .scope-opt:hover{border-color:#C6CEDE;}
.rrdesp .scope-opt.on{border-color:var(--navy);background:#F7F9FC;}
.rrdesp .scope-opt[disabled]{cursor:default;opacity:.85;}
.rrdesp .scope-opt[disabled]:hover{border-color:var(--bd);}
.rrdesp .scope-opt.on[disabled]{border-color:var(--navy);}
.rrdesp .scope-opt .radio{width:18px;height:18px;border-radius:50%;border:2px solid #C6CEDE;flex:none;margin-top:1px;display:grid;place-items:center;transition:border-color .15s;}
.rrdesp .scope-opt.on .radio{border-color:var(--navy);}
.rrdesp .scope-opt.on .radio::after{content:"";width:9px;height:9px;border-radius:50%;background:var(--navy);}
.rrdesp .scope-opt .t{font-size:13.5px;font-weight:600;color:var(--ink);display:block;}
.rrdesp .scope-opt .d{font-size:11.5px;color:var(--ink-3);margin-top:2px;line-height:1.4;display:block;}

.rrdesp .mgrid{display:grid;grid-template-columns:1fr 1fr;gap:15px;}
.rrdesp .mfld{display:flex;flex-direction:column;gap:7px;}
.rrdesp .mfld.full{grid-column:1 / -1;}
.rrdesp .mfld label{font-size:11.5px;font-weight:600;letter-spacing:.02em;color:var(--ink-2);}
.rrdesp .mfld label .req{color:var(--red);}
.rrdesp .mctrl{position:relative;display:flex;align-items:center;}
.rrdesp .mctrl .pre{position:absolute;left:13px;font-size:13.5px;font-weight:600;color:var(--ink-3);pointer-events:none;}
.rrdesp .mctrl select,.rrdesp .mctrl input,.rrdesp .mctrl textarea{width:100%;font-family:inherit;font-size:13.5px;color:var(--ink);border:1px solid var(--bd);border-radius:10px;background:#fff;padding:11px 13px;outline:none;transition:border-color .15s,box-shadow .15s;}
.rrdesp .mctrl input.money{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;font-weight:600;padding-left:38px;}
.rrdesp .mctrl select{appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:34px;}
.rrdesp .mctrl select:disabled,.rrdesp .mctrl input:disabled,.rrdesp .mctrl textarea:disabled{background:#F4F6F9;color:var(--ink-3);cursor:not-allowed;}
.rrdesp .mctrl .chev{position:absolute;right:13px;pointer-events:none;color:var(--ink-3);font-size:11px;}
.rrdesp .mctrl textarea{resize:vertical;min-height:62px;line-height:1.5;}
.rrdesp .mctrl select:focus,.rrdesp .mctrl input:focus,.rrdesp .mctrl textarea:focus{border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}
.rrdesp .mhint{font-size:11px;color:var(--ink-3);margin:0;}
.rrdesp .modal-error{margin-top:16px;border-radius:10px;padding:11px 14px;font-size:12.5px;font-weight:500;background:var(--red-bg);border:1px solid var(--red-bd);color:#8E2F28;}
.rrdesp .modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:11px;padding:18px 26px 24px;border-top:1px solid var(--bd-soft);margin-top:4px;}
.rrdesp .btn-ghost{background:none;border:1px solid var(--bd);color:var(--ink-2);border-radius:10px;font-family:inherit;font-size:13px;font-weight:600;padding:11px 18px;cursor:pointer;transition:background .15s,border-color .15s;}
.rrdesp .btn-ghost:hover{background:#F4F6F9;border-color:#C6CEDE;}
.rrdesp .btn-save{background:var(--navy);color:#fff;border:none;border-radius:10px;font-family:inherit;font-size:13px;font-weight:600;padding:11px 22px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:background .15s;}
.rrdesp .btn-save:hover{background:#16285C;}
.rrdesp .btn-save[disabled]{opacity:.7;cursor:default;}
.rrdesp .btn-save .ck{color:var(--yellow);}

.rrdesp .toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(0);background:var(--navy);color:#fff;font-size:13px;font-weight:500;padding:13px 20px;border-radius:11px;box-shadow:var(--shadow-lg);display:flex;align-items:center;gap:10px;z-index:60;}
.rrdesp .toast .ck{color:var(--yellow);}

@media (max-width:680px){
  .rrdesp .wrap{padding:18px 16px 40px;gap:16px;}
  .rrdesp .btn-new{justify-content:center;}
  .rrdesp .mgrid{grid-template-columns:1fr;}
  .rrdesp .scope-toggle{grid-template-columns:1fr;}
  .rrdesp .catbar{justify-content:flex-start;}
  .rrdesp .filters{padding:12px;}
  .rrdesp .filters .search{min-width:100%;order:-1;}
}
`;
