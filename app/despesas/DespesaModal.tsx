"use client";

import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import type {
  CategoryOption,
  CompanyOption,
  ExpenseRow,
} from "./DespesasList";
import { isGroupExpense } from "./DespesasList";

interface Props {
  mode: "create" | "edit";
  expense: ExpenseRow | null;
  companies: CompanyOption[];
  categories: CategoryOption[];
  onClose: () => void;
  onSuccess: (message: string) => void | Promise<void>;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];
const MONTH_OPTIONS = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
];

type Scope = "empresa" | "grupo";

// Formata enquanto digita: trabalha sobre os dígitos crus (centavos).
function fmtBR(raw: string): string {
  const d = String(raw).replace(/\D/g, "");
  if (!d) return "";
  let n = d.replace(/^0+(?=\d)/, "");
  while (n.length < 3) n = "0" + n;
  const c = n.slice(-2);
  const i = n.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return i + "," + c;
}

function parseBR(str: string): number {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/\./g, "").replace(",", ".")) || 0;
  return Math.round(n * 100) / 100;
}

function amountToInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value)))
    return "";
  return fmtBR(String(Math.round(Number(value) * 100)));
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
  const isEdit = mode === "edit";

  const initialScope: Scope =
    expense && isGroupExpense(expense) ? "grupo" : "empresa";

  const [scope, setScope] = useState<Scope>(initialScope);
  const [companyId, setCompanyId] = useState<string>(
    expense?.company_id ?? companies[0]?.id ?? ""
  );
  const [categoryId, setCategoryId] = useState<string>(
    expense?.category_id ?? categories[0]?.id ?? ""
  );
  const [description, setDescription] = useState<string>(
    expense?.description ?? ""
  );
  const [year, setYear] = useState<number>(expense?.year ?? today.getFullYear());
  const [month, setMonth] = useState<number>(
    expense?.month ?? today.getMonth() + 1
  );
  const [amountInput, setAmountInput] = useState<string>(
    amountToInput(expense?.amount)
  );
  const [dueDate, setDueDate] = useState<string>(expense?.due_date ?? "");
  const [paymentDate, setPaymentDate] = useState<string>(
    expense?.payment_date ?? ""
  );
  const [notes, setNotes] = useState<string>(expense?.notes ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, submitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedDescription = description.trim();
    const amount = parseBR(amountInput);

    if (scope === "empresa" && !companyId) {
      setError("Selecione a empresa.");
      return;
    }
    if (!categoryId) {
      setError("Selecione a categoria.");
      return;
    }
    if (!trimmedDescription) {
      setError("Informe a descrição.");
      return;
    }
    if (amount <= 0) {
      setError("Informe um valor válido (maior que zero).");
      return;
    }

    // Status derivado de payment_date.
    const status = paymentDate ? "PAID" : "PLANNED";

    setSubmitting(true);
    try {
      let res: Response;
      if (isEdit && expense) {
        // PATCH não altera escopo/empresa/competência (audit-friendly).
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
            scope: scope === "grupo" ? "GRUPO" : "COMPANY",
            companyId: scope === "grupo" ? null : companyId,
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

      await onSuccess(isEdit ? "Despesa atualizada" : "Despesa lançada");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="overlay open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modalTitle"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="modal" data-screen-label="modal-despesa">
        <div className="modal-head">
          <div>
            <p className="mt">{isEdit ? "EDITAR LANÇAMENTO" : "NOVO LANÇAMENTO"}</p>
            <h2 id="modalTitle">{isEdit ? "Editar despesa" : "Nova despesa"}</h2>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Fechar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            {/* scope toggle */}
            <div className="scope-toggle">
              <button
                type="button"
                className={`scope-opt${scope === "empresa" ? " on" : ""}`}
                data-scope="empresa"
                onClick={() => !isEdit && setScope("empresa")}
                disabled={isEdit}
                aria-pressed={scope === "empresa"}
              >
                <span className="radio" />
                <span>
                  <span className="t">Empresa específica</span>
                  <span className="d">Lançada em um CNPJ do grupo</span>
                </span>
              </button>
              <button
                type="button"
                className={`scope-opt${scope === "grupo" ? " on" : ""}`}
                data-scope="grupo"
                onClick={() => !isEdit && setScope("grupo")}
                disabled={isEdit}
                aria-pressed={scope === "grupo"}
              >
                <span className="radio" />
                <span>
                  <span className="t">Grupo todo</span>
                  <span className="d">Despesa rateada · sem CNPJ específico</span>
                </span>
              </button>
            </div>
            {isEdit ? (
              <p className="mhint" style={{ marginBottom: 16 }}>
                Escopo, empresa e competência não podem ser alterados. Para mudar,
                exclua e crie de novo.
              </p>
            ) : null}

            <div className="mgrid">
              {scope === "empresa" ? (
                <div className="mfld">
                  <label htmlFor="mEmp">
                    Empresa <span className="req">*</span>
                  </label>
                  <div className="mctrl">
                    <select
                      id="mEmp"
                      value={companyId}
                      onChange={(e) => setCompanyId(e.target.value)}
                      disabled={submitting || isEdit}
                      required
                    >
                      <option value="">Selecione…</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <span className="chev">▾</span>
                  </div>
                </div>
              ) : null}

              <div className="mfld">
                <label htmlFor="mCat">
                  Categoria <span className="req">*</span>
                </label>
                <div className="mctrl">
                  <select
                    id="mCat"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    disabled={submitting}
                    required
                  >
                    <option value="">Selecione…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="chev">▾</span>
                </div>
              </div>

              <div className="mfld full">
                <label htmlFor="mDesc">
                  Descrição <span className="req">*</span>
                </label>
                <div className="mctrl">
                  <input
                    id="mDesc"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={submitting}
                    required
                    placeholder="Ex.: aluguel da unidade Maceió centro"
                  />
                </div>
              </div>

              <div className="mfld">
                <label htmlFor="mYear">
                  Ano <span className="req">*</span>
                </label>
                <div className="mctrl">
                  <select
                    id="mYear"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    disabled={submitting || isEdit}
                  >
                    {YEAR_OPTIONS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <span className="chev">▾</span>
                </div>
              </div>

              <div className="mfld">
                <label htmlFor="mMonth">
                  Mês <span className="req">*</span>
                </label>
                <div className="mctrl">
                  <select
                    id="mMonth"
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                    disabled={submitting || isEdit}
                  >
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <span className="chev">▾</span>
                </div>
              </div>

              <div className="mfld">
                <label htmlFor="mValor">
                  Valor <span className="req">*</span>
                </label>
                <div className="mctrl">
                  <span className="pre">R$</span>
                  <input
                    id="mValor"
                    type="text"
                    inputMode="decimal"
                    className="money"
                    value={amountInput}
                    onChange={(e) => setAmountInput(fmtBR(e.target.value))}
                    disabled={submitting}
                    required
                    placeholder="0,00"
                  />
                </div>
              </div>

              <div className="mfld">
                <label htmlFor="mVenc">Vencimento</label>
                <div className="mctrl">
                  <input
                    id="mVenc"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="mfld">
                <label htmlFor="mPag">Data de pagamento</label>
                <div className="mctrl">
                  <input
                    id="mPag"
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              </div>

              <div className="mfld" style={{ justifyContent: "flex-end" }}>
                <p className="mhint">
                  Se preenchida, a despesa é marcada como{" "}
                  <b style={{ color: "var(--green)" }}>Paga</b>.
                </p>
              </div>

              <div className="mfld full">
                <label htmlFor="mObs">Observações</label>
                <div className="mctrl">
                  <textarea
                    id="mObs"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={submitting}
                    placeholder="Notas internas, nº da nota, condições…"
                  />
                </div>
              </div>
            </div>

            {error ? (
              <div role="alert" className="modal-error">
                {error}
              </div>
            ) : null}
          </div>

          <div className="modal-foot">
            <button
              type="button"
              className="btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-save" disabled={submitting}>
              {submitting
                ? "Salvando…"
                : isEdit
                  ? "Salvar alterações"
                  : "Salvar despesa"}{" "}
              <span className="ck">✓</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
