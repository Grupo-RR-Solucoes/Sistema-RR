"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import EmptyStatePanel from "../../components/EmptyStatePanel";
import FeedbackBanner from "../../components/FeedbackBanner";

type PeriodOption = {
  key: string;
  label: string;
  year: number;
  month: number;
};

type Summary = {
  periodLabel: string;
  expectedCash: number;
  expectedPrt: number;
  expectedInsurance: number;
  expectedTotal: number;
  actualCash: number;
  actualPrt: number;
  actualInsurance: number;
  actualEstorno: number;
  actualRenewal: number;
  actualNet: number;
  deltaTotal: number;
  grossProduction: number;
  validProduction: number;
  operations: number;
  companiesCount: number;
  insurancePenetrationPercent: number;
  forecastCoveragePercent: number;
  fullForecastCoveragePercent: number;
  futureDeferredBalance: number;
};

type CompanyRow = {
  empresa_nome: string;
  empresa_cnpj: string;
  validProduction: number;
  expectedCash: number;
  expectedPrt: number;
  expectedInsurance: number;
  actualNet: number;
  actualEstorno: number;
  actualRenewal: number;
  deltaTotal: number;
  forecastCoveragePercent: number;
};

type TrendPoint = {
  key: string;
  label: string;
  expectedTotal: number;
  actualNet: number;
  deltaTotal: number;
  expectedPrt: number;
  actualPrt: number;
};

type Highlight = {
  empresa_nome: string;
  empresa_cnpj: string;
  deltaTotal: number;
  expectedTotal: number;
  actualNet: number;
};

type ClosingPayload = {
  periods: PeriodOption[];
  selectedPeriod: PeriodOption | null;
  summary: Summary;
  companyRows: CompanyRow[];
  trend: TrendPoint[];
  highlights: Highlight[];
  alerts: string[];
};

const emptyPayload: ClosingPayload = {
  periods: [],
  selectedPeriod: null,
  summary: {
    periodLabel: "sem competencia",
    expectedCash: 0,
    expectedPrt: 0,
    expectedInsurance: 0,
    expectedTotal: 0,
    actualCash: 0,
    actualPrt: 0,
    actualInsurance: 0,
    actualEstorno: 0,
    actualRenewal: 0,
    actualNet: 0,
    deltaTotal: 0,
    grossProduction: 0,
    validProduction: 0,
    operations: 0,
    companiesCount: 0,
    insurancePenetrationPercent: 0,
    forecastCoveragePercent: 0,
    fullForecastCoveragePercent: 0,
    futureDeferredBalance: 0,
  },
  companyRows: [],
  trend: [],
  highlights: [],
  alerts: [],
};

export default function FechamentoPage() {
  const [activeSection, setActiveSection] = useState<
    "empresas" | "comparativos" | "prioridades"
  >("empresas");
  const [selectedKey, setSelectedKey] = useState("");
  const [data, setData] = useState<ClosingPayload>(emptyPayload);
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
          `/api/fechamento${params.toString() ? `?${params.toString()}` : ""}`
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Erro ao carregar fechamento.");
        }

        setData(payload || emptyPayload);
      } catch (err: any) {
        setError(err.message || "Erro ao carregar fechamento.");
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
          <div style={styles.kicker}>Conciliacao financeira</div>
          <h2 style={styles.title}>Fechamento mensal por empresa e por grupo</h2>
          <p style={styles.description}>
            Esta visao compara a previsao da producao com o recebimento real, separa
            a vista, seguro e a carteira PRT vencendo no mes, e deixa a auditoria
            pronta para acompanhar os meses passados sem travar a competencia.
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
              <span style={styles.heroStatLabel}>Cobertura</span>
              <strong style={styles.heroStatValue}>
                {formatPercent(data.summary.fullForecastCoveragePercent)}
              </strong>
            </div>
          </div>
        </article>
      </div>

      {error ? (
        <FeedbackBanner
          variant="error"
          eyebrow="Fechamento indisponivel"
          title="Nao foi possivel carregar a conciliacao mensal."
          description={error}
          actionLabel="Abrir importacoes"
          actionHref="/importacoes"
        />
      ) : null}

      {data.alerts.map((alert) => (
        <div key={alert} style={styles.alertBox}>
          {alert}
        </div>
      ))}

      <div style={styles.summaryGrid}>
        <MetricCard
          label="Previsto total"
          value={formatCurrency(data.summary.expectedTotal)}
          description="Soma do a vista, seguro e carteira PRT prevista para vencer na competencia."
          tone="blue"
        />
        <MetricCard
          label="Recebido real"
          value={formatCurrency(data.summary.actualNet)}
          description="Valor liquido vindo do fechamento real importado."
          tone="gold"
        />
        <MetricCard
          label="Gap do mes"
          value={formatCurrency(data.summary.deltaTotal)}
          description="Diferenca entre previsto total e fechamento liquido real."
          tone={data.summary.deltaTotal >= 0 ? "blue" : "gold"}
        />
        <MetricCard
          label="PRT da carteira"
          value={`${formatCurrency(data.summary.expectedPrt)} / ${formatCurrency(data.summary.actualPrt)}`}
          description="Comparativo entre a carteira PRT vencendo no mes e o valor realmente recebido."
          tone="blue"
        />
        <MetricCard
          label="Carteira PRT futura"
          value={formatCurrency(data.summary.futureDeferredBalance)}
          description="Saldo pendente de PRT ainda nao liquidado."
          tone="gold"
        />
        <MetricCard
          label="Producao valida"
          value={formatCurrency(data.summary.validProduction)}
          description={`Penetracao de seguro em ${formatPercent(
            data.summary.insurancePenetrationPercent
          )}.`}
          tone="blue"
        />
      </div>

      <div style={styles.subsectionNav}>
        <button
          type="button"
          onClick={() => setActiveSection("empresas")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "empresas" ? styles.subsectionButtonActive : {}),
          }}
        >
          Empresas
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("comparativos")}
          style={{
            ...styles.subsectionButton,
            ...(activeSection === "comparativos" ? styles.subsectionButtonActive : {}),
          }}
        >
          Comparativos
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

      {activeSection === "empresas" ? (
      <div style={styles.contentGridSingle}>
        <article style={styles.tableCard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionKicker}>Detalhamento por empresa</div>
              <h3 style={styles.sectionTitle}>Previsto x recebido</h3>
            </div>
            <div style={styles.sectionChip}>
              {formatNumber(data.summary.operations)} propostas validas
            </div>
          </div>

          {loading ? (
            <EmptyStatePanel
              compact
              eyebrow="Fechamento"
              title="Carregando fechamento mensal."
              description="A conciliacao entre previsto e recebido esta sendo preparada."
            />
          ) : data.companyRows.length === 0 ? (
            <EmptyStatePanel
              compact
              eyebrow="Sem empresas"
              title="Nenhuma empresa foi encontrada para esta competencia."
              description="Importe os fechamentos mensais ou revise a competencia selecionada."
              actionLabel="Abrir importacoes"
              actionHref="/importacoes"
            />
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Empresa</th>
                    <th style={styles.th}>Producao valida</th>
                    <th style={styles.th}>Previsto a vista</th>
                    <th style={styles.th}>PRT carteira</th>
                    <th style={styles.th}>Previsto seguro</th>
                    <th style={styles.th}>Recebido liquido</th>
                    <th style={styles.th}>Ajustes</th>
                    <th style={styles.th}>Gap</th>
                    <th style={styles.th}>Cobertura</th>
                  </tr>
                </thead>
                <tbody>
                  {data.companyRows.map((row) => (
                    <tr key={`${row.empresa_cnpj}-${row.empresa_nome}`}>
                      <td style={styles.td}>
                        <div style={styles.companyName}>{row.empresa_nome}</div>
                        <div style={styles.companyMeta}>{row.empresa_cnpj}</div>
                      </td>
                      <td style={styles.td}>{formatCurrency(row.validProduction)}</td>
                      <td style={styles.td}>{formatCurrency(row.expectedCash)}</td>
                      <td style={styles.td}>{formatCurrency(row.expectedPrt)}</td>
                      <td style={styles.td}>{formatCurrency(row.expectedInsurance)}</td>
                      <td style={styles.tdStrong}>{formatCurrency(row.actualNet)}</td>
                      <td style={styles.td}>
                        {formatCurrency(row.actualEstorno + row.actualRenewal)}
                      </td>
                      <td
                        style={{
                          ...styles.tdStrong,
                          color: row.deltaTotal >= 0 ? "var(--rr-blue-deep)" : "#b45309",
                        }}
                      >
                        {formatCurrency(row.deltaTotal)}
                      </td>
                      <td style={styles.td}>{formatPercent(row.forecastCoveragePercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
      ) : null}

      {activeSection === "comparativos" ? (
        <aside style={styles.sideRailWide}>
          <article style={styles.chartCard}>
            <div style={styles.sectionHeader}>
              <div>
                <div style={styles.sectionKicker}>Componentes</div>
                <h3 style={styles.sectionTitle}>Previsto x real por camada</h3>
              </div>
              <div style={styles.sectionChip}>3 camadas</div>
            </div>
            <CompareBars
              loading={loading}
              items={[
                {
                  label: "A vista",
                  expected: data.summary.expectedCash,
                  actual: data.summary.actualCash,
                },
                {
                  label: "Seguro",
                  expected: data.summary.expectedInsurance,
                  actual: data.summary.actualInsurance,
                },
                {
                  label: "PRT carteira",
                  expected: data.summary.expectedPrt,
                  actual: data.summary.actualPrt,
                },
              ]}
            />
          </article>

          <article style={styles.chartCard}>
            <div style={styles.sectionHeader}>
              <div>
                <div style={styles.sectionKicker}>Historico</div>
                <h3 style={styles.sectionTitle}>Evolucao mensal</h3>
              </div>
              <div style={styles.sectionChip}>{data.trend.length} meses</div>
            </div>
            <TrendChart items={data.trend} loading={loading} />
          </article>
        </aside>
      ) : null}

      {activeSection === "prioridades" ? (
        <aside style={styles.sideRailWide}>
          <article style={styles.chartCard}>
            <div style={styles.sectionHeader}>
              <div>
                <div style={styles.sectionKicker}>Prioridades</div>
                <h3 style={styles.sectionTitle}>Maiores divergencias</h3>
              </div>
              <div style={styles.sectionChip}>{data.highlights.length} alertas</div>
            </div>
            <HighlightList items={data.highlights} loading={loading} />
          </article>
        </aside>
      ) : null}
    </section>
  );
}

function MetricCard({
  label,
  value,
  description,
  tone,
}: {
  label: string;
  value: string;
  description: string;
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
      <div style={styles.metricDescription}>{description}</div>
    </article>
  );
}

function CompareBars({
  items,
  loading,
}: {
  items: Array<{ label: string; expected: number; actual: number }>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Comparativo"
        title="Carregando comparativo mensal."
        description="O sistema esta alinhando previsto, recebido e diferencas da competencia."
      />
    );
  }

  const maxValue = Math.max(
    1,
    ...items.flatMap((item) => [item.expected, item.actual])
  );

  return (
    <div style={styles.compareList}>
      {items.map((item) => (
        <div key={item.label} style={styles.compareItem}>
          <div style={styles.compareTop}>
            <span style={styles.compareLabel}>{item.label}</span>
            <strong style={styles.compareValue}>{formatCurrency(item.actual)}</strong>
          </div>
          <div style={styles.compareTrack}>
            <div
              style={{
                ...styles.compareExpected,
                width: `${Math.max((item.expected / maxValue) * 100, item.expected > 0 ? 12 : 0)}%`,
              }}
            />
            <div
              style={{
                ...styles.compareActual,
                width: `${Math.max((item.actual / maxValue) * 100, item.actual > 0 ? 12 : 0)}%`,
              }}
            />
          </div>
          <div style={styles.compareMeta}>
            Previsto {formatCurrency(item.expected)}
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendChart({
  items,
  loading,
}: {
  items: TrendPoint[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Historico"
        title="Montando historico mensal."
        description="A linha do tempo do fechamento esta sendo organizada para leitura executiva."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Sem historico"
        title="Nao ha historico suficiente para o fechamento."
        description="Importe mais competencias para liberar comparativos de tendencia."
      />
    );
  }

  const maxValue = Math.max(
    1,
    ...items.flatMap((item) => [item.expectedTotal, item.actualNet])
  );

  return (
    <div style={styles.trendChart}>
      {items.map((item) => (
        <div key={item.key} style={styles.trendColumn}>
          <div style={styles.trendBars}>
            <div
              style={{
                ...styles.trendBarExpected,
                height: `${Math.max((item.expectedTotal / maxValue) * 100, item.expectedTotal > 0 ? 10 : 0)}%`,
              }}
            />
            <div
              style={{
                ...styles.trendBarActual,
                height: `${Math.max((item.actualNet / maxValue) * 100, item.actualNet > 0 ? 10 : 0)}%`,
              }}
            />
          </div>
          <div style={styles.trendLabel}>{item.label}</div>
          <div style={styles.trendMeta}>{formatCurrencyCompact(item.deltaTotal)}</div>
        </div>
      ))}
    </div>
  );
}

function HighlightList({
  items,
  loading,
}: {
  items: Highlight[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Prioridades"
        title="Levantando pontos criticos."
        description="As divergencias mais importantes estao sendo reunidas para conferencia."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Sem alertas"
        title="Nao existem divergencias relevantes nesta competencia."
        description="A conciliacao atual esta equilibrada entre previsto e recebido."
      />
    );
  }

  return (
    <div style={styles.highlightList}>
      {items.map((item) => (
        <div key={`${item.empresa_cnpj}-${item.empresa_nome}`} style={styles.highlightItem}>
          <div>
            <div style={styles.highlightName}>{item.empresa_nome}</div>
            <div style={styles.highlightMeta}>{item.empresa_cnpj}</div>
          </div>
          <div style={styles.highlightValues}>
            <strong style={styles.highlightDelta}>{formatCurrency(item.deltaTotal)}</strong>
            <span style={styles.highlightSubline}>
              Previsto {formatCurrency(item.expectedTotal)} | Real {formatCurrency(item.actualNet)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
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

function formatPercent(value?: number) {
  return `${Number(value || 0).toFixed(1).replace(".", ",")}%`;
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
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
  metricDescription: {
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
    gridTemplateColumns: "minmax(0, 1.55fr) minmax(320px, 0.95fr)",
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
  sectionChip: {
    padding: "8px 12px",
    borderRadius: "999px",
    background: "rgba(13,77,227,0.08)",
    border: "1px solid rgba(13,77,227,0.12)",
    color: "var(--rr-blue-deep)",
    fontSize: "12px",
    fontWeight: 800,
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
  sideRail: {
    display: "grid",
    gap: "14px",
  },
  sideRailWide: {
    display: "grid",
    gap: "14px",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  },
  chartCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "22px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    overflow: "hidden",
    paddingBottom: "18px",
  },
  compareList: {
    display: "grid",
    gap: "12px",
    padding: "16px 18px 0",
  },
  compareItem: {
    display: "grid",
    gap: "8px",
  },
  compareTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
  },
  compareLabel: {
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--rr-ink)",
  },
  compareValue: {
    fontSize: "13px",
    color: "var(--rr-blue-deep)",
  },
  compareTrack: {
    display: "grid",
    gap: "8px",
  },
  compareExpected: {
    height: "10px",
    borderRadius: "999px",
    background: "linear-gradient(90deg, rgba(13,77,227,0.92) 0%, rgba(52,111,241,0.88) 100%)",
  },
  compareActual: {
    height: "10px",
    borderRadius: "999px",
    background: "linear-gradient(90deg, rgba(255,240,0,0.98) 0%, rgba(214,161,63,0.94) 100%)",
  },
  compareMeta: {
    fontSize: "12px",
    color: "var(--rr-muted)",
  },
  trendChart: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(48px, 1fr))",
    gap: "10px",
    alignItems: "end",
    padding: "16px 18px 0",
    minHeight: "210px",
  },
  trendColumn: {
    display: "grid",
    gap: "8px",
    alignItems: "end",
    justifyItems: "center",
  },
  trendBars: {
    width: "100%",
    maxWidth: "42px",
    height: "118px",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "5px",
    alignItems: "end",
  },
  trendBarExpected: {
    borderRadius: "12px 12px 8px 8px",
    background: "linear-gradient(180deg, rgba(13,77,227,0.95) 0%, rgba(7,37,125,0.98) 100%)",
  },
  trendBarActual: {
    borderRadius: "12px 12px 8px 8px",
    background: "linear-gradient(180deg, rgba(255,240,0,1) 0%, rgba(214,161,63,0.95) 100%)",
  },
  trendLabel: {
    fontSize: "12px",
    color: "var(--rr-blue-deep)",
    fontWeight: 700,
  },
  trendMeta: {
    fontSize: "11px",
    color: "var(--rr-muted)",
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
  highlightName: {
    fontSize: "14px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    marginBottom: "4px",
  },
  highlightMeta: {
    fontSize: "12px",
    color: "var(--rr-muted)",
  },
  highlightValues: {
    display: "grid",
    justifyItems: "end",
    gap: "6px",
  },
  highlightDelta: {
    fontSize: "15px",
    color: "var(--rr-blue-deep)",
  },
  highlightSubline: {
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
