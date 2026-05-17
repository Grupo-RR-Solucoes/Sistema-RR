"use client";

import {
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import type {
  CategoryOption,
  CompanyOption,
  ExpenseRow,
} from "./DespesasList";

interface Props {
  mode: "create" | "edit";
  expense: ExpenseRow | null;
  companies: CompanyOption[];
  categories: CategoryOption[];
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

function parseAmount(input: string): number | null {
  if (!input) return null;
  // Aceita "1234.56", "1234,56", "1.234,56"
  const cleaned = input.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatAmountForInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value)))
    return "";
  return Number(value).toFixed(2).replace(".", ",");
}

export default function DespesaModal({
  mode,
  expense,
  companies,
  categories,
  onClose,
  onSuccess,
}: Props) {
  const today = new Date();
  const defaultYear = expense?.year ?? today.getFullYear();
  const defaultMonth = expense?.month ?? today.getMonth() + 1;

  const [companyId, setCompanyId] = useState<string>(expense?.company_id ?? "");
  const [categoryId, setCategoryId] = useState<string>(
    expense?.category_id ?? ""
  );
  const [description, setDescription] = useState<string>(
    expense?.description ?? ""
  );
  const [year, setYear] = useState<number>(defaultYear);
  const [month, setMonth] = useState<number>(defaultMonth);
  const [amountInput, setAmountInput] = useState<string>(
    formatAmountForInput(expense?.amount)
  );
  const [dueDate, setDueDate] = useState<string>(expense?.due_date ?? "");
  const [paymentDate, setPaymentDate] = useState<string>(
    expense?.payment_date ?? ""
  );
  const [notes, setNotes] = useState<string>(expense?.notes ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC fecha modal
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, submitting]);

  const isEdit = mode === "edit";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedDescription = description.trim();
    const amount = parseAmount(amountInput);

    if (!companyId) {
      setError("Selecione a empresa.");
      return;
    }
    if (!categoryId) {
      setError("Selecione a categoria.");
      return;
    }
    if (!trimmedDescription) {
      setError("Informe a descricao.");
      return;
    }
    if (amount === null || amount <= 0) {
      setError("Informe um valor valido (maior que zero).");
      return;
    }

    // Status derivado de payment_date.
    const status = paymentDate ? "PAID" : "PLANNED";

    setSubmitting(true);
    try {
      let res: Response;
      if (isEdit && expense) {
        res = await fetch(`/api/financeiro/${expense.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            description: trimmedDescription,
            category_id: categoryId,
            amount,
            due_date: dueDate || null,
            payment_date: paymentDate || null,
            status,
            notes: notes || null,
          }),
        });
      } else {
        res = await fetch("/api/financeiro", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "expense",
            scope: "COMPANY",
            companyId,
            categoryId,
            description: trimmedDescription,
            year,
            month,
            amount,
            dueDate: dueDate || null,
            paymentDate: paymentDate || null,
            status,
            notes: notes || null,
          }),
        });
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Falha ao salvar despesa");
        return;
      }

      await onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true">
      <div style={styles.card}>
        <header style={styles.header}>
          <h3 style={styles.title}>
            {isEdit ? "Editar despesa" : "Nova despesa"}
          </h3>
          <button
            type="button"
            style={styles.closeBtn}
            onClick={onClose}
            disabled={submitting}
            aria-label="Fechar"
          >
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} style={styles.form} noValidate>
          <div style={styles.row2}>
            <label style={styles.label}>
              <span style={styles.labelText}>Empresa</span>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                style={styles.input}
                disabled={submitting || isEdit}
                required
              >
                <option value="">Selecione uma empresa...</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {isEdit ? (
                <span style={styles.helperInfo}>
                  Empresa nao pode ser alterada. Para mudar, delete e crie de
                  novo.
                </span>
              ) : null}
            </label>

            <label style={styles.label}>
              <span style={styles.labelText}>Categoria</span>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                style={styles.input}
                disabled={submitting}
                required
              >
                <option value="">Selecione uma categoria...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label style={styles.label}>
            <span style={styles.labelText}>Descricao</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={styles.input}
              disabled={submitting}
              required
              placeholder="Ex: Aluguel sede, NF fornecedor X, folha CLT"
            />
          </label>

          <div style={styles.row3}>
            <label style={styles.label}>
              <span style={styles.labelText}>Ano</span>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                style={styles.input}
                disabled={submitting || isEdit}
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label style={styles.label}>
              <span style={styles.labelText}>Mes</span>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                style={styles.input}
                disabled={submitting || isEdit}
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </label>
            <label style={styles.label}>
              <span style={styles.labelText}>Valor (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                style={styles.input}
                disabled={submitting}
                required
                placeholder="0,00"
              />
            </label>
          </div>

          <div style={styles.row2}>
            <label style={styles.label}>
              <span style={styles.labelText}>Vencimento</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={styles.input}
                disabled={submitting}
              />
            </label>
            <label style={styles.label}>
              <span style={styles.labelText}>Data de pagamento</span>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                style={styles.input}
                disabled={submitting}
              />
              <span style={styles.helperInfo}>
                Preencher marca a despesa como PAGA automaticamente.
              </span>
            </label>
          </div>

          <label style={styles.label}>
            <span style={styles.labelText}>Observacoes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ ...styles.input, minHeight: 72, resize: "vertical" }}
              disabled={submitting}
              placeholder="Detalhes adicionais (opcional)"
            />
          </label>

          {error ? (
            <div role="alert" style={styles.error}>
              {error}
            </div>
          ) : null}

          <div style={styles.actions}>
            <button
              type="button"
              style={styles.secondaryBtn}
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button type="submit" disabled={submitting} style={styles.primaryBtn}>
              {submitting
                ? "Salvando..."
                : isEdit
                  ? "Salvar alteracoes"
                  : "Lancar despesa"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(7, 19, 63, 0.42)",
    backdropFilter: "blur(4px)",
    display: "grid",
    placeItems: "center",
    zIndex: 100,
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "calc(100vh - 32px)",
    overflowY: "auto",
    background: "var(--rr-surface-elevated)",
    border: "1px solid var(--rr-line)",
    borderRadius: 20,
    boxShadow: "var(--rr-shadow)",
    padding: "20px 22px 22px",
    display: "grid",
    gap: 14,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  title: { margin: 0, fontSize: 18, fontWeight: 800, color: "var(--rr-ink)" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-muted)",
    fontSize: 14,
    cursor: "pointer",
  },
  form: { display: "grid", gap: 12 },
  row2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  row3: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
  },
  label: { display: "grid", gap: 6 },
  labelText: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--rr-ink)",
    letterSpacing: "0.02em",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    fontSize: 14,
    color: "var(--rr-ink)",
    outline: "none",
    fontFamily: "inherit",
  },
  helperInfo: {
    fontSize: 12,
    color: "var(--rr-muted)",
    fontStyle: "italic",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 6,
  },
  primaryBtn: {
    padding: "11px 18px",
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
  },
  secondaryBtn: {
    padding: "10px 16px",
    borderRadius: 11,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-ink)",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  error: {
    padding: "10px 12px",
    borderRadius: 10,
    background: "rgba(180,30,30,0.08)",
    border: "1px solid rgba(180,30,30,0.24)",
    color: "#8a1717",
    fontSize: 13,
    fontWeight: 600,
  },
};
