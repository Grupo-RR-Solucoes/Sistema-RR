"use client";

import { useEffect, useMemo, useState } from "react";

export default function EditarComissoesPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState([]);
  const [rows, setRows] = useState([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [savingRowId, setSavingRowId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadCompanies() {
    try {
      setLoadingCompanies(true);
      setError("");

      const response = await fetch("/api/companies/list");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao carregar empresas.");
      }

      setCompanies(data?.companies || []);
    } catch (err) {
      setError(err.message || "Erro ao carregar empresas.");
    } finally {
      setLoadingCompanies(false);
    }
  }

  async function loadRows() {
    try {
      setLoadingRows(true);
      setError("");
      setMessage("");

      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
      });

      if (companyId) {
        params.set("companyId", companyId);
      }

      const response = await fetch(`/api/commissions/proposals?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao carregar propostas.");
      }

      setRows(
        (data?.rows || []).map((row) => ({
          ...row,
          promoter_commission_percent_input:
            row.promoter_commission_percent ?? "",
          insurance_commission_percent_input:
            row.insurance_commission_percent ?? "",
          notes_input: row.manual_notes ?? "",
        }))
      );
    } catch (err) {
      setError(err.message || "Erro ao carregar propostas.");
    } finally {
      setLoadingRows(false);
    }
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  function updateRowValue(id, field, value) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: value,
            }
          : row
      )
    );
  }

  async function saveRow(row) {
    try {
      setSavingRowId(row.id);
      setError("");
      setMessage("");

      const response = await fetch("/api/commissions/proposals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dailyProductionRecordId: row.id,
          promoterId: row.assigned_promoter_id,
          commissionPercent:
            row.promoter_commission_percent_input === ""
              ? null
              : Number(row.promoter_commission_percent_input),
          insuranceCommissionPercent:
            row.insurance_commission_percent_input === ""
              ? null
              : Number(row.insurance_commission_percent_input),
          notes: row.notes_input || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao salvar comissão.");
      }

      setMessage(`Comissão da proposta ${row.proposal_number} salva com sucesso.`);
      await loadRows();
    } catch (err) {
      setError(err.message || "Erro ao salvar comissão.");
    } finally {
      setSavingRowId("");
    }
  }

  async function clearManualRule(row) {
    try {
      setSavingRowId(row.id);
      setError("");
      setMessage("");

      const response = await fetch("/api/commissions/proposals", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dailyProductionRecordId: row.id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao remover regra manual.");
      }

      setMessage(`Regra manual da proposta ${row.proposal_number} removida.`);
      await loadRows();
    } catch (err) {
      setError(err.message || "Erro ao remover regra manual.");
    } finally {
      setSavingRowId("");
    }
  }

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.gross += Number(row.gross_value || 0);
        acc.promoterAmount += Number(row.promoter_commission_amount || 0);
        acc.insuranceAmount += Number(row.insurance_commission_amount || 0);
        return acc;
      },
      { gross: 0, promoterAmount: 0, insuranceAmount: 0 }
    );
  }, [rows]);

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>Edição de comissão por proposta</h1>
          <p style={styles.subtitle}>
            Edite o percentual da comissão do promotor e do seguro por proposta.
            A prioridade aplicada no cálculo é: proposta manual &gt; produto &gt;
            regra mensal.
          </p>
        </div>

        <section style={styles.filtersCard}>
          <div style={styles.filtersGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Ano</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Mês</label>
              <input
                type="number"
                min="1"
                max="12"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Empresa</label>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                style={styles.input}
                disabled={loadingCompanies}
              >
                <option value="">Todas</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.actions}>
              <button
                type="button"
                onClick={loadRows}
                style={styles.primaryButton}
                disabled={loadingRows}
              >
                {loadingRows ? "Carregando..." : "Buscar propostas"}
              </button>
            </div>
          </div>
        </section>

        {message ? <div style={styles.successBox}>{message}</div> : null}
        {error ? <div style={styles.errorBox}>{error}</div> : null}

        <section style={styles.summaryCard}>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Propostas</span>
            <strong style={styles.summaryValue}>{rows.length}</strong>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Base total</span>
            <strong style={styles.summaryValue}>
              {formatCurrency(totals.gross)}
            </strong>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Comissão promotor</span>
            <strong style={styles.summaryValue}>
              {formatCurrency(totals.promoterAmount)}
            </strong>
          </div>
          <div style={styles.summaryItem}>
            <span style={styles.summaryLabel}>Comissão seguro</span>
            <strong style={styles.summaryValue}>
              {formatCurrency(totals.insuranceAmount)}
            </strong>
          </div>
        </section>

        <section style={styles.tableCard}>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Proposta</th>
                  <th style={styles.th}>Promotor</th>
                  <th style={styles.th}>Produto</th>
                  <th style={styles.th}>Base</th>
                  <th style={styles.th}>Seguro</th>
                  <th style={styles.th}>Origem</th>
                  <th style={styles.th}>% Promotor</th>
                  <th style={styles.th}>Valor Promotor</th>
                  <th style={styles.th}>% Seguro</th>
                  <th style={styles.th}>Valor Seguro</th>
                  <th style={styles.th}>Observação</th>
                  <th style={styles.th}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td style={styles.emptyTd} colSpan={12}>
                      Nenhuma proposta encontrada.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const isSaving = savingRowId === row.id;

                    return (
                      <tr key={row.id}>
                        <td style={styles.td}>{row.proposal_number || "-"}</td>
                        <td style={styles.td}>{row.promoter_name || "-"}</td>
                        <td style={styles.td}>{row.product_description || "-"}</td>
                        <td style={styles.td}>
                          {formatCurrency(row.gross_value || 0)}
                        </td>
                        <td style={styles.td}>
                          {formatCurrency(row.insurance_value || 0)}
                        </td>
                        <td style={styles.td}>
                          <span style={styles.badge}>
                            {row.commission_rule_source || "MONTHLY_DEFAULT"}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <input
                            type="number"
                            step="0.01"
                            value={row.promoter_commission_percent_input}
                            onChange={(e) =>
                              updateRowValue(
                                row.id,
                                "promoter_commission_percent_input",
                                e.target.value
                              )
                            }
                            style={styles.smallInput}
                          />
                        </td>
                        <td style={styles.td}>
                          {formatCurrency(row.promoter_commission_amount || 0)}
                        </td>
                        <td style={styles.td}>
                          <input
                            type="number"
                            step="0.01"
                            value={row.insurance_commission_percent_input}
                            onChange={(e) =>
                              updateRowValue(
                                row.id,
                                "insurance_commission_percent_input",
                                e.target.value
                              )
                            }
                            style={styles.smallInput}
                          />
                        </td>
                        <td style={styles.td}>
                          {formatCurrency(row.insurance_commission_amount || 0)}
                        </td>
                        <td style={styles.td}>
                          <input
                            type="text"
                            value={row.notes_input}
                            onChange={(e) =>
                              updateRowValue(row.id, "notes_input", e.target.value)
                            }
                            style={styles.notesInput}
                          />
                        </td>
                        <td style={styles.td}>
                          <div style={styles.actionButtons}>
                            <button
                              type="button"
                              onClick={() => saveRow(row)}
                              disabled={isSaving || !row.assigned_promoter_id}
                              style={styles.saveButton}
                            >
                              {isSaving ? "Salvando..." : "Salvar"}
                            </button>

                            <button
                              type="button"
                              onClick={() => clearManualRule(row)}
                              disabled={isSaving}
                              style={styles.clearButton}
                            >
                              Limpar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f4f7fb",
    padding: "24px",
  },
  container: {
    maxWidth: "1600px",
    margin: "0 auto",
  },
  header: {
    marginBottom: "20px",
  },
  title: {
    margin: 0,
    fontSize: "32px",
    fontWeight: 700,
    color: "#111827",
  },
  subtitle: {
    marginTop: "8px",
    color: "#4b5563",
    lineHeight: 1.5,
  },
  filtersCard: {
    background: "#fff",
    borderRadius: "16px",
    padding: "20px",
    border: "1px solid #e5e7eb",
    marginBottom: "16px",
  },
  filtersGrid: {
    display: "grid",
    gridTemplateColumns: "160px 160px 1fr 220px",
    gap: "12px",
    alignItems: "end",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#111827",
  },
  input: {
    height: "42px",
    borderRadius: "10px",
    border: "1px solid #d1d5db",
    padding: "0 12px",
    fontSize: "14px",
  },
  actions: {
    display: "flex",
    alignItems: "end",
  },
  primaryButton: {
    width: "100%",
    height: "42px",
    border: "none",
    borderRadius: "10px",
    background: "#111827",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  },
  successBox: {
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    color: "#065f46",
    padding: "14px 16px",
    borderRadius: "12px",
    marginBottom: "16px",
  },
  errorBox: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#991b1b",
    padding: "14px 16px",
    borderRadius: "12px",
    marginBottom: "16px",
  },
  summaryCard: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "12px",
    marginBottom: "16px",
  },
  summaryItem: {
    background: "#fff",
    borderRadius: "16px",
    padding: "18px",
    border: "1px solid #e5e7eb",
  },
  summaryLabel: {
    display: "block",
    color: "#6b7280",
    fontSize: "13px",
    marginBottom: "8px",
  },
  summaryValue: {
    fontSize: "22px",
    color: "#111827",
  },
  tableCard: {
    background: "#fff",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
    overflow: "hidden",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "1500px",
  },
  th: {
    background: "#111827",
    color: "#fff",
    fontWeight: 600,
    fontSize: "13px",
    textAlign: "left",
    padding: "12px",
    whiteSpace: "nowrap",
  },
  td: {
    borderBottom: "1px solid #e5e7eb",
    padding: "10px 12px",
    fontSize: "13px",
    color: "#111827",
    verticalAlign: "middle",
  },
  emptyTd: {
    padding: "24px",
    textAlign: "center",
    color: "#6b7280",
  },
  badge: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#eef2ff",
    color: "#3730a3",
    fontSize: "12px",
    fontWeight: 600,
  },
  smallInput: {
    width: "90px",
    height: "38px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    padding: "0 10px",
  },
  notesInput: {
    width: "220px",
    height: "38px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    padding: "0 10px",
  },
  actionButtons: {
    display: "flex",
    gap: "8px",
  },
  saveButton: {
    border: "none",
    borderRadius: "8px",
    background: "#16a34a",
    color: "#fff",
    padding: "9px 12px",
    fontWeight: 600,
    cursor: "pointer",
  },
  clearButton: {
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    background: "#fff",
    color: "#111827",
    padding: "9px 12px",
    fontWeight: 600,
    cursor: "pointer",
  },
};
