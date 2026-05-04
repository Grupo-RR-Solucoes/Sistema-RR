"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import EmptyStatePanel from "../../components/EmptyStatePanel";
import FeedbackBanner from "../../components/FeedbackBanner";
import HistoricalFindingsSection from "../../components/auditoria/HistoricalFindingsSection";
import {
  isMetaRegime,
  isVolumeOuSafira,
} from "../../lib/historicalAuditClient";

type PeriodOption = {
  key: string;
  label: string;
};

type Summary = {
  periodLabel: string;
  expectedTotal: number;
  actualNet: number;
  deltaTotal: number;
  forecastCoveragePercent: number;
  fullForecastCoveragePercent: number;
};

type Highlight = {
  empresa_nome: string;
  empresa_cnpj: string;
  deltaTotal: number;
  expectedTotal: number;
  actualNet: number;
};

type AuditRow = {
  empresa_nome: string;
  empresa_cnpj: string;
  expectedTotal: number;
  actualNet: number;
  deltaCash: number;
  deltaPrt: number;
  deltaInsurance: number;
  deltaTotal: number;
  forecastCoveragePercent: number;
  severity: "ok" | "atencao" | "critico";
};

type AuditPayload = {
  periods: PeriodOption[];
  selectedPeriod: PeriodOption | null;
  summary: Summary;
  highlights: Highlight[];
  alerts: string[];
  rows: AuditRow[];
};

const emptyPayload: AuditPayload = {
  periods: [],
  selectedPeriod: null,
  summary: {
    periodLabel: "sem competencia",
    expectedTotal: 0,
    actualNet: 0,
    deltaTotal: 0,
    forecastCoveragePercent: 0,
    fullForecastCoveragePercent: 0,
  },
  highlights: [],
  alerts: [],
  rows: [],
};

export default function AuditoriaPage() {
  const [activeSection, setActiveSection] = useState<"fila" | "prioridades">("fila");
  const [selectedKey, setSelectedKey] = useState("");
  const [data, setData] = useState<AuditPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
          `/api/auditoria${params.toString() ? `?${params.toString()}` : ""}`
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Erro ao carregar auditoria.");
        }

        setData(payload || emptyPayload);
      } catch (err: any) {
        setError(err.message || "Erro ao carregar auditoria.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [selectedKey]);

  const periodValue = selectedKey || data.selectedPeriod?.key || "";

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Conferencia gerencial</div>
          <h2 style={styles.title}>Auditoria de divergencias do fechamento</h2>
          <p style={styles.description}>
            Esta tela prioriza o que precisa de conferencia imediata no mes:
            divergencias de gap total, sinais de carteira PRT fora do esperado e
            empresas com cobertura incompleta na base de calculo.
          </p>
        </article>

        <article style={styles.heroAside}>
          <div style={styles.selectorLabel}>Competencia</div>
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
          <div style={styles.heroNote}>
            Cobertura completa da previsao:{" "}
            <strong>{formatPercent(data.summary.fullForecastCoveragePercent)}</strong>
          </div>
        </article>
      </div>

      {error ? (
        <FeedbackBanner
          variant="error"
          eyebrow="Auditoria indisponivel"
          title="Nao foi possivel carregar a fila de verificacao."
          description={error}
          actionLabel="Abrir fechamento"
          actionHref="/fechamento"
        />
      ) : null}

      {data.alerts.map((alert) => (
        <div key={alert} style={styles.alertBox}>
          {alert}
        </div>
      ))}

      <div style={styles.summaryGrid}>
        <SummaryCard
          label="Previsto"
          value={formatCurrency(data.summary.expectedTotal)}
          detail="Base prevista para o mes auditado."
        />
        <SummaryCard
          label="Real"
          value={formatCurrency(data.summary.actualNet)}
          detail="Fechamento liquido realmente recebido."
        />
        <SummaryCard
          label="Gap consolidado"
          value={formatCurrency(data.summary.deltaTotal)}
          detail="Diferenca consolidada do periodo."
        />
        <SummaryCard
          label="Cobertura"
          value={formatPercent(data.summary.forecastCoveragePercent)}
          detail="Quanto da producao tem base suficiente para previsao."
        />
      </div>

      {(() => {
        const effectiveKey = periodValue;
        if (!effectiveKey) return null;
        const [yStr, mStr] = effectiveKey.split("-");
        const y = Number(yStr);
        const m = Number(mStr);
        if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
        if (!isVolumeOuSafira(y, m) && !isMetaRegime(y, m)) return null;
        return <HistoricalFindingsSection year={y} month={m} />;
      })()}

      <div style={styles.subsectionNav}>
        <button
          type="button"
          onClick={() => setActiveSection("fila")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "fila" ? styles.subsectionButtonActive : {}),
          }}
        >
          Fila de verificacao
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("prioridades")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "prioridades" ? styles.subsectionButtonActive : {}),
          }}
        >
          Prioridades
        </button>
      </div>

      {activeSection === "fila" ? (
      <div style={styles.contentGridSingle}>
        <article style={styles.tableCard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionKicker}>Fila de verificacao</div>
              <h3 style={styles.sectionTitle}>Empresas ordenadas por gap</h3>
            </div>
            <div style={styles.sectionChip}>{data.rows.length} empresas</div>
          </div>

          {loading ? (
            <EmptyStatePanel
              compact
              eyebrow="Auditoria"
              title="Carregando divergencias da competencia."
              description="A fila de conferencia esta sendo montada com base no fechamento e no previsto."
            />
          ) : data.rows.length === 0 ? (
            <EmptyStatePanel
              compact
              eyebrow="Sem fila"
              title="Nao existem divergencias para listar nesta competencia."
              description="O sistema nao encontrou pendencias relevantes para conferencia imediata."
            />
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Empresa</th>
                    <th style={styles.th}>Severidade</th>
                    <th style={styles.th}>Previsto</th>
                    <th style={styles.th}>Real</th>
                    <th style={styles.th}>Gap a vista</th>
                    <th style={styles.th}>Gap PRT</th>
                    <th style={styles.th}>Gap seguro</th>
                    <th style={styles.th}>Gap total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={`${row.empresa_cnpj}-${row.empresa_nome}`}>
                      <td style={styles.td}>
                        <div style={styles.companyName}>{row.empresa_nome}</div>
                        <div style={styles.companyMeta}>{row.empresa_cnpj}</div>
                      </td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.badge,
                            ...(row.severity === "critico"
                              ? styles.badgeCritical
                              : row.severity === "atencao"
                                ? styles.badgeWarning
                                : styles.badgeOk),
                          }}
                        >
                          {row.severity}
                        </span>
                      </td>
                      <td style={styles.td}>{formatCurrency(row.expectedTotal)}</td>
                      <td style={styles.td}>{formatCurrency(row.actualNet)}</td>
                      <td style={styles.td}>{formatCurrency(row.deltaCash)}</td>
                      <td style={styles.td}>{formatCurrency(row.deltaPrt)}</td>
                      <td style={styles.td}>{formatCurrency(row.deltaInsurance)}</td>
                      <td style={styles.tdStrong}>{formatCurrency(row.deltaTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
      ) : null}

      {activeSection === "prioridades" ? (
        <aside style={styles.sideRailWide}>
          <article style={styles.sideCard}>
            <div style={styles.sectionHeader}>
              <div>
                <div style={styles.sectionKicker}>Foco imediato</div>
                <h3 style={styles.sectionTitle}>Top divergencias</h3>
              </div>
              <div style={styles.sectionChip}>{data.highlights.length} prioridades</div>
            </div>
            <div style={styles.highlightList}>
              {loading ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Prioridades"
                  title="Levantando prioridades da auditoria."
                  description="As empresas mais sensiveis desta competencia estao sendo classificadas."
                />
              ) : data.highlights.length === 0 ? (
                <EmptyStatePanel
                  compact
                  eyebrow="Sem criticidade"
                  title="Nenhuma empresa critica foi encontrada neste mes."
                  description="A fila atual nao apresenta risco relevante na classificacao executiva."
                />
              ) : (
                data.highlights.map((item) => (
                  <div key={`${item.empresa_cnpj}-${item.empresa_nome}`} style={styles.highlightItem}>
                    <div>
                      <div style={styles.companyName}>{item.empresa_nome}</div>
                      <div style={styles.companyMeta}>{item.empresa_cnpj}</div>
                    </div>
                    <div style={styles.highlightValues}>
                      <strong style={styles.highlightValue}>{formatCurrency(item.deltaTotal)}</strong>
                      <span style={styles.highlightMeta}>
                        Previsto {formatCurrency(item.expectedTotal)} | Real {formatCurrency(item.actualNet)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>
        </aside>
      ) : null}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article style={styles.summaryCard}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={styles.summaryValue}>{value}</div>
      <div style={styles.summaryDetail}>{detail}</div>
    </article>
  );
}

function formatCurrency(value?: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

function formatPercent(value?: number) {
  return `${Number(value || 0).toFixed(1).replace(".", ",")}%`;
}

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
    borderRadius: "22px",
    padding: "20px",
    background:
      "linear-gradient(180deg, rgba(13,77,227,0.96) 0%, rgba(7,37,125,0.98) 100%)",
    boxShadow: "var(--rr-shadow)",
    display: "grid",
    gap: "14px",
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
  heroNote: {
    fontSize: "14px",
    lineHeight: 1.6,
    color: "rgba(255,255,255,0.88)",
  },
  errorBox: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(239,68,68,0.24)",
    color: "#991b1b",
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
  summaryCard: {
    borderRadius: "18px",
    padding: "16px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,249,176,0.42) 100%)",
  },
  summaryLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "8px",
    fontWeight: 800,
  },
  summaryValue: {
    fontSize: "24px",
    color: "var(--rr-ink)",
    fontWeight: 800,
    fontFamily: "var(--font-heading)",
    marginBottom: "8px",
  },
  summaryDetail: {
    fontSize: "12px",
    lineHeight: 1.5,
    color: "var(--rr-muted)",
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
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.4fr) minmax(300px, 0.8fr)",
    gap: "18px",
    alignItems: "start",
  },
  contentGridSingle: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "14px",
  },
  tableCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "22px",
    border: "1px solid var(--rr-line)",
    overflow: "hidden",
    boxShadow: "var(--rr-shadow-soft)",
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
  badgeCritical: {
    background: "rgba(239,68,68,0.12)",
    color: "#991b1b",
  },
  badgeWarning: {
    background: "rgba(245,158,11,0.14)",
    color: "#92400e",
  },
  badgeOk: {
    background: "rgba(13,77,227,0.1)",
    color: "var(--rr-blue-deep)",
  },
  sideRail: {
    display: "grid",
    gap: "14px",
  },
  sideRailWide: {
    display: "grid",
    gap: "14px",
    gridTemplateColumns: "minmax(0, 1fr)",
  },
  sideCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "22px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    overflow: "hidden",
    paddingBottom: "18px",
  },
  highlightList: {
    display: "grid",
    gap: "10px",
    padding: "16px 18px 0",
  },
  highlightItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "14px",
    borderRadius: "16px",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.16) 0%, rgba(13,77,227,0.06) 100%)",
    border: "1px solid rgba(13,77,227,0.1)",
  },
  highlightValues: {
    display: "grid",
    justifyItems: "end",
    gap: "6px",
  },
  highlightValue: {
    fontSize: "15px",
    color: "var(--rr-blue-deep)",
  },
  highlightMeta: {
    fontSize: "11px",
    color: "var(--rr-muted)",
    textAlign: "right",
    lineHeight: 1.4,
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
