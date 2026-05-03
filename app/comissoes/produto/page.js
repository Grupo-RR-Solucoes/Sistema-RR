"use client";

import { useEffect, useMemo, useState } from "react";

export default function ComissaoProdutoPage() {
  const [rows, setRows] = useState([]);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(4);
  const [companyId, setCompanyId] = useState("");
  const [promoterId, setPromoterId] = useState("");
  const [companies, setCompanies] = useState([]);
  const [promoters, setPromoters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingLists, setLoadingLists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadCompanies();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const nextYear = Number(params.get("year") || 0);
    const nextMonth = Number(params.get("month") || 0);
    const nextCompanyId = params.get("companyId") || "";
    const nextPromoterId = params.get("promoterId") || "";

    if (nextYear) {
      setYear(nextYear);
    }

    if (nextMonth) {
      setMonth(nextMonth);
    }

    if (nextCompanyId) {
      setCompanyId(nextCompanyId);
    }

    if (nextPromoterId) {
      setPromoterId(nextPromoterId);
    }
  }, []);

  useEffect(() => {
    loadPromoters();
  }, [companyId]);

  useEffect(() => {
    loadRows();
  }, [year, month, companyId, promoterId]);

  async function loadCompanies() {
    try {
      setLoadingLists(true);
      const response = await fetch("/api/companies/list");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao carregar empresas.");
      }

      setCompanies(data?.companies || []);
    } catch (err) {
      setError(err.message || "Erro ao carregar empresas.");
    } finally {
      setLoadingLists(false);
    }
  }

  async function loadPromoters() {
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);

      const response = await fetch(
        `/api/promoters/list${params.toString() ? `?${params.toString()}` : ""}`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao carregar promotores.");
      }

      const nextPromoters = data?.promoters || [];
      setPromoters(nextPromoters);

      if (
        promoterId &&
        !nextPromoters.some((promoter) => promoter.id === promoterId)
      ) {
        setPromoterId("");
      }
    } catch (err) {
      setError(err.message || "Erro ao carregar promotores.");
    }
  }

  async function loadRows() {
    try {
      setLoading(true);
      setError("");
      setMessage("");

      if (!promoterId) {
        setRows([]);
        return;
      }

      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
        promoterId,
      });

      if (companyId) {
        params.set("companyId", companyId);
      }

      const response = await fetch(`/api/commissions/product-rules?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao carregar regras.");
      }

      setRows(data?.rows || []);
    } catch (err) {
      setError(err.message || "Erro ao carregar regras.");
    } finally {
      setLoading(false);
    }
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        product_code: "",
        product_description: "",
        company_received_percent_from: "",
        company_received_percent_to: "",
        commission_percent: "",
        insurance_commission_percent: "",
        notes: "",
      },
    ]);
  }

  function updateRow(index, field, value) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: value,
            }
          : row
      )
    );
  }

  function removeRow(index) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  function adjustPercent(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.min(numeric, 5.8);
  }

  async function saveAll() {
    try {
      setSaving(true);
      setError("");
      setMessage("");

      if (!promoterId) {
        throw new Error("Selecione o promotor antes de salvar a regra por produto.");
      }

      const response = await fetch("/api/commissions/product-rules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          year,
          month,
          companyId: companyId || null,
          promoterId,
          rows: rows.map((row) => ({
            ...row,
            commission_percent: adjustPercent(row.commission_percent),
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao salvar regras.");
      }

      setMessage("Regras por produto do promotor salvas com sucesso.");
      await loadRows();
    } catch (err) {
      setError(err.message || "Erro ao salvar regras.");
    } finally {
      setSaving(false);
    }
  }

  const selectedPromoterName = useMemo(
    () => promoters.find((promoter) => promoter.id === promoterId)?.name || "",
    [promoterId, promoters]
  );

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Acordo comercial por promotor</div>
          <h2 style={styles.title}>Regra por produto do promotor</h2>
          <p style={styles.description}>
            Aqui a regra deixa de ser geral e passa a pertencer ao promotor
            escolhido. A base continua sendo a tabela mensal padrao, mas toda
            excecao por produto fica salva como acordo comercial individual.
          </p>
        </article>

        <article style={styles.heroCard}>
          <div style={styles.heroLabel}>Promotor em foco</div>
          <div style={styles.heroValue}>
            {selectedPromoterName || "Selecione o promotor"}
          </div>
          <div style={styles.heroText}>
            Use esta tela para dar percentual diferente por produto, faixa de
            recebido ou seguro para um vendedor especifico.
          </div>
        </article>
      </div>

      {message ? <div style={styles.successBox}>{message}</div> : null}
      {error ? <div style={styles.errorBox}>{error}</div> : null}

      <section style={styles.controlCard}>
        <div style={styles.controlGrid}>
          <div style={styles.field}>
            <label style={styles.label}>Ano</label>
            <input
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Mes</label>
            <input
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Empresa</label>
            <select
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              style={styles.input}
              disabled={loadingLists}
            >
              <option value="">Todas</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Promotor</label>
            <select
              value={promoterId}
              onChange={(event) => setPromoterId(event.target.value)}
              style={styles.input}
            >
              <option value="">Selecione</option>
              {promoters.map((promoter) => (
                <option key={promoter.id} value={promoter.id}>
                  {promoter.name}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.controlActions}>
            <button
              onClick={addRow}
              style={styles.secondaryButton}
              disabled={!promoterId}
            >
              + Nova regra
            </button>
            <button
              onClick={saveAll}
              style={styles.primaryButton}
              disabled={saving || !promoterId}
            >
              {saving ? "Salvando..." : "Salvar regras"}
            </button>
          </div>
        </div>
      </section>

      {!promoterId ? (
        <div style={styles.warningBox}>
          Selecione um promotor para editar as regras por produto dele.
        </div>
      ) : null}

      <section style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <div style={styles.tableKicker}>Configuracao individual</div>
          <h3 style={styles.tableTitle}>Linhas de repasse por produto</h3>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Codigo</th>
                <th style={styles.th}>Produto</th>
                <th style={styles.th}>% Empresa de</th>
                <th style={styles.th}>% Empresa ate</th>
                <th style={styles.th}>% Promotor</th>
                <th style={styles.th}>% Seguro</th>
                <th style={styles.th}>Observacao</th>
                <th style={styles.th}>Acao</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={styles.emptyTd}>
                    Carregando regras...
                  </td>
                </tr>
              ) : !promoterId ? (
                <tr>
                  <td colSpan={8} style={styles.emptyTd}>
                    Escolha um promotor para visualizar as regras.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={styles.emptyTd}>
                    Nenhuma regra especifica cadastrada para este promotor.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={`${row.id || "new"}-${index}`}>
                    <td style={styles.td}>
                      <input
                        value={row.product_code || ""}
                        onChange={(event) =>
                          updateRow(index, "product_code", event.target.value)
                        }
                        style={styles.smallInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        value={row.product_description || ""}
                        onChange={(event) =>
                          updateRow(index, "product_description", event.target.value)
                        }
                        style={styles.fullInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        value={row.company_received_percent_from ?? ""}
                        onChange={(event) =>
                          updateRow(
                            index,
                            "company_received_percent_from",
                            event.target.value
                          )
                        }
                        style={styles.smallInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        value={row.company_received_percent_to ?? ""}
                        onChange={(event) =>
                          updateRow(
                            index,
                            "company_received_percent_to",
                            event.target.value
                          )
                        }
                        style={styles.smallInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        value={row.commission_percent ?? ""}
                        onChange={(event) =>
                          updateRow(index, "commission_percent", event.target.value)
                        }
                        style={styles.smallInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        value={row.insurance_commission_percent ?? ""}
                        onChange={(event) =>
                          updateRow(
                            index,
                            "insurance_commission_percent",
                            event.target.value
                          )
                        }
                        style={styles.smallInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        value={row.notes || ""}
                        onChange={(event) =>
                          updateRow(index, "notes", event.target.value)
                        }
                        style={styles.fullInput}
                      />
                    </td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        style={styles.removeButton}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

const styles = {
  page: {
    display: "grid",
    gap: "18px",
  },
  hero: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "18px",
  },
  heroMain: {
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.95) 0%, rgba(255,253,245,0.98) 100%)",
    borderRadius: "28px",
    padding: "28px",
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
    fontSize: "15px",
    lineHeight: 1.75,
    color: "var(--rr-muted)",
  },
  heroCard: {
    background:
      "linear-gradient(180deg, rgba(13,77,227,0.96) 0%, rgba(7,37,125,0.98) 100%)",
    borderRadius: "28px",
    padding: "26px",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "var(--rr-shadow)",
  },
  heroLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "rgba(255,255,255,0.72)",
    marginBottom: "10px",
  },
  heroValue: {
    fontSize: "24px",
    fontWeight: 800,
    color: "var(--rr-yellow)",
    marginBottom: "10px",
    lineHeight: 1.2,
  },
  heroText: {
    fontSize: "14px",
    lineHeight: 1.65,
    color: "rgba(255,255,255,0.9)",
  },
  successBox: {
    background: "rgba(236,253,245,0.92)",
    border: "1px solid rgba(16,185,129,0.24)",
    color: "#065f46",
    padding: "14px 16px",
    borderRadius: "16px",
  },
  errorBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(239,68,68,0.24)",
    color: "#991b1b",
    padding: "14px 16px",
    borderRadius: "16px",
  },
  warningBox: {
    background: "rgba(255,248,220,0.96)",
    border: "1px solid rgba(214,161,63,0.24)",
    color: "#7c5d00",
    padding: "14px 16px",
    borderRadius: "16px",
  },
  controlCard: {
    background: "rgba(255,255,255,0.92)",
    borderRadius: "24px",
    padding: "20px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
  },
  controlGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
    alignItems: "end",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  input: {
    height: "44px",
    borderRadius: "12px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "0 12px",
    background: "#fff",
  },
  controlActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    alignItems: "center",
  },
  primaryButton: {
    height: "44px",
    padding: "0 18px",
    border: "none",
    borderRadius: "12px",
    background:
      "linear-gradient(135deg, var(--rr-blue) 0%, var(--rr-blue-deep) 100%)",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 16px 30px rgba(13,77,227,0.2)",
  },
  secondaryButton: {
    height: "44px",
    padding: "0 18px",
    border: "1px solid rgba(13,77,227,0.14)",
    borderRadius: "12px",
    background: "#fffdf6",
    color: "var(--rr-ink)",
    fontWeight: 800,
    cursor: "pointer",
  },
  removeButton: {
    height: "40px",
    padding: "0 14px",
    border: "1px solid rgba(239,68,68,0.16)",
    borderRadius: "10px",
    background: "#fff",
    color: "#991b1b",
    fontWeight: 800,
    cursor: "pointer",
  },
  tableCard: {
    background: "rgba(255,255,255,0.92)",
    borderRadius: "26px",
    border: "1px solid var(--rr-line)",
    overflow: "hidden",
    boxShadow: "var(--rr-shadow-soft)",
  },
  tableHeader: {
    padding: "24px 24px 0",
  },
  tableKicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "8px",
    fontWeight: 800,
  },
  tableTitle: {
    margin: 0,
    fontSize: "24px",
    color: "var(--rr-ink)",
  },
  tableWrap: {
    overflowX: "auto",
    padding: "18px 24px 24px",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
  },
  th: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--rr-blue)",
    textAlign: "left",
    padding: "0 12px 14px 0",
    borderBottom: "1px solid var(--rr-line)",
    whiteSpace: "nowrap",
    fontWeight: 800,
  },
  td: {
    borderBottom: "1px solid rgba(13,77,227,0.08)",
    padding: "12px 12px 12px 0",
    fontSize: "13px",
    color: "var(--rr-muted)",
    verticalAlign: "middle",
  },
  emptyTd: {
    padding: "24px",
    textAlign: "center",
    color: "var(--rr-muted)",
  },
  fullInput: {
    width: "100%",
    height: "40px",
    borderRadius: "10px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "0 10px",
    background: "#fff",
  },
  smallInput: {
    width: "120px",
    height: "40px",
    borderRadius: "10px",
    border: "1px solid rgba(13,77,227,0.14)",
    padding: "0 10px",
    background: "#fff",
  },
};
