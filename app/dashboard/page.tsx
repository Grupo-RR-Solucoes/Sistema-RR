"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import EmptyStatePanel from "../../components/EmptyStatePanel";
import FeedbackBanner from "../../components/FeedbackBanner";
import Rbt12DashboardCard from "../../components/Rbt12DashboardCard";

type CompanyRow = {
  empresa_cnpj?: string;
  empresa_nome?: string;
  expectedCash?: number;
  expectedGeneratedPrt?: number;
  expectedPrt?: number;
  expectedInsurance?: number;
  expectedTotal?: number;
};

type ChartItem = {
  label: string;
  value: number;
  color: string;
  percent?: number;
};

type RevenuePoint = {
  label: string;
  expectedTotal: number;
  actualTotal: number;
};

type DashboardPayload = {
  summary: {
    forecastPeriodLabel: string;
    actualPeriodLabel?: string;
    productionPeriodLabel?: string;
    expectedCash: number;
    expectedPrt: number;
    generatedPrt: number;
    expectedInsurance: number;
    expectedTotal: number;
    futureDeferredBalance: number;
    productionTotal: number;
    activePromoters: number;
    companiesCount: number;
  };
  monthlyRevenue: RevenuePoint[];
  forecastComposition: ChartItem[];
  productShare: Array<ChartItem & { percent: number }>;
  companyRows: CompanyRow[];
  alerts: string[];
};

const emptyPayload: DashboardPayload = {
  summary: {
    forecastPeriodLabel: "sem competencia",
    actualPeriodLabel: "",
    productionPeriodLabel: "",
    expectedCash: 0,
    expectedPrt: 0,
    generatedPrt: 0,
    expectedInsurance: 0,
    expectedTotal: 0,
    futureDeferredBalance: 0,
    productionTotal: 0,
    activePromoters: 0,
    companiesCount: 0,
  },
  monthlyRevenue: [],
  forecastComposition: [],
  productShare: [],
  companyRows: [],
  alerts: [],
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("/api/dashboard");
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Erro ao carregar dashboard.");
        }

        setData(payload || emptyPayload);
      } catch (err: any) {
        setError(err.message || "Erro ao carregar dashboard.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  return (
    <section style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerCopy}>
          <div style={styles.kicker}>Visao executiva</div>
          <h2 style={styles.title}>Dashboard financeiro do Grupo RR Cred</h2>
          <p style={styles.description}>
            Painel de previsao operacional separado em tres leituras:
            a vista previsto para o mes, PRT previsto para entrar na
            competencia pela carteira parcelada e PRT futuro gerado
            pela producao atual. PRT e diferido sao a mesma verba; aqui
            o painel separa apenas o que vence no mes e o que fica para
            meses futuros.
          </p>
          <div style={styles.executiveSignals}>
            <div style={styles.executiveSignal}>
              <span style={styles.executiveSignalLabel}>A vista do mes</span>
              <strong style={styles.executiveSignalValue}>
                {formatCurrency(data.summary.expectedCash)}
              </strong>
              <span style={styles.executiveSignalHint}>Fluxo imediato esperado na competencia.</span>
            </div>
            <div style={styles.executiveSignal}>
              <span style={styles.executiveSignalLabel}>PRT da carteira</span>
              <strong style={styles.executiveSignalValue}>
                {formatCurrency(data.summary.expectedPrt)}
              </strong>
              <span style={styles.executiveSignalHint}>Parcelas historicas que deveriam entrar no mes.</span>
            </div>
            <div style={styles.executiveSignal}>
              <span style={styles.executiveSignalLabel}>PRT futuro gerado</span>
              <strong style={styles.executiveSignalValue}>
                {formatCurrency(data.summary.generatedPrt)}
              </strong>
              <span style={styles.executiveSignalHint}>Parcelas futuras criadas pela producao atual.</span>
            </div>
          </div>
        </div>

        <div style={styles.periodPanel}>
          <PeriodBadge
            label="Previsao"
            value={data.summary.forecastPeriodLabel}
            tone="gold"
          />
          {data.summary.actualPeriodLabel ? (
            <PeriodBadge
              label="Recebido real"
              value={data.summary.actualPeriodLabel}
              tone="blue"
            />
          ) : null}
          {data.summary.productionPeriodLabel ? (
            <PeriodBadge
              label="Producao"
              value={data.summary.productionPeriodLabel}
              tone="blue"
            />
          ) : null}
        </div>
      </div>

      {error ? (
        <FeedbackBanner
          variant="error"
          eyebrow="Painel indisponivel"
          title="Nao foi possivel carregar o dashboard financeiro."
          description={error}
          actionLabel="Abrir fechamento"
          actionHref="/fechamento"
        />
      ) : null}

      {!loading && data.alerts.length > 0 ? (
        <article style={styles.noticeBox}>
          <div style={styles.noticeKicker}>Leitura financeira</div>
          <div style={styles.noticeList}>
            {data.alerts.map((alert) => (
              <div key={alert} style={styles.noticeItem}>
                {alert}
              </div>
            ))}
          </div>
        </article>
      ) : null}

      <div style={styles.kpiGrid}>
        <KpiCard
          label="Previsao a vista"
          value={formatCurrency(data.summary.expectedCash)}
          tone="gold"
          detail="Comissao prevista da producao valida da competencia."
        />
        <KpiCard
          label="PRT previsto do mes"
          value={formatCurrency(data.summary.expectedPrt)}
          tone="blue"
          detail="Carteira PRT prevista para receber nesta competencia. Nao inclui o PRT novo da producao atual."
        />
        <KpiCard
          label="PRT futuro gerado"
          value={formatCurrency(data.summary.generatedPrt)}
          tone="gold"
          detail="Parte parcelada da producao atual, com primeira parcela dois meses apos a contratacao."
        />
        <KpiCard
          label="Carteira PRT futura"
          value={formatCurrency(data.summary.futureDeferredBalance)}
          tone="gold"
          detail="Saldo futuro de PRT apos a competencia, somando historico e novos parcelamentos."
        />
        <KpiCard
          label="Previsao total"
          value={formatCurrency(data.summary.expectedTotal)}
          tone="blue"
          detail="A vista, PRT do mes e seguro previstos para recebimento."
        />
        <KpiCard
          label="Producao atual"
          value={formatCurrency(data.summary.productionTotal)}
          tone="blue"
          detail={
            data.summary.productionPeriodLabel
              ? `Base valida de producao em ${data.summary.productionPeriodLabel}.`
              : "Sem producao valida carregada."
          }
        />
        <KpiCard
          label="Promotores ativos"
          value={formatNumber(data.summary.activePromoters)}
          tone="gold"
          detail="Promotores ativos cadastrados e considerados no painel."
        />
      </div>

      <Rbt12DashboardCard />

      <div style={styles.contentGrid}>
        <article style={styles.tableCard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.sectionKicker}>Previsao por empresa</div>
              <h3 style={styles.sectionTitle}>Consolidado por empresa</h3>
            </div>
            <div style={styles.sectionChip}>{data.summary.companiesCount} empresas</div>
          </div>
          <CompanyForecastChart items={data.companyRows} loading={loading} />
        </article>

        <aside style={styles.sideRail}>
          <article style={styles.chartCard}>
            <div style={styles.sectionHeader}>
              <div>
                <div style={styles.sectionKicker}>Fluxo mensal</div>
                <h3 style={styles.sectionTitle}>Real x previsao</h3>
              </div>
            </div>
            <RevenueChart items={data.monthlyRevenue} loading={loading} />
          </article>

          <article style={styles.chartCard}>
            <div style={styles.sectionHeader}>
              <div>
                <div style={styles.sectionKicker}>Participacao</div>
                <h3 style={styles.sectionTitle}>Distribuicao da previsao</h3>
              </div>
            </div>
            <DonutChart
              items={data.forecastComposition}
              total={data.summary.expectedTotal}
              loading={loading}
              centerLabel="Previsao"
            />
          </article>

          <article style={styles.chartCard}>
            <div style={styles.sectionHeader}>
              <div>
                <div style={styles.sectionKicker}>Mix comercial</div>
                <h3 style={styles.sectionTitle}>Percentual por produto</h3>
              </div>
            </div>
            <ProductShareChart items={data.productShare} loading={loading} />
          </article>
        </aside>
      </div>
    </section>
  );
}

function KpiCard({
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
  const accent =
    tone === "gold"
      ? "linear-gradient(135deg, rgba(255,240,0,0.18) 0%, rgba(214,161,63,0.18) 100%)"
      : "linear-gradient(135deg, rgba(13,77,227,0.14) 0%, rgba(255,255,255,0.98) 100%)";

  const valueColor = tone === "gold" ? "#a67408" : "var(--rr-blue-deep)";
  const { prefix, amount } = splitKpiValue(value);
  const amountStyle = getAdaptiveValueStyle(amount || value);

  return (
    <article style={{ ...styles.kpiCard, background: accent }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, color: valueColor }}>
        {prefix ? <span style={styles.kpiValuePrefix}>{prefix}</span> : null}
        <span style={{ ...styles.kpiValueAmount, ...amountStyle }}>
          {amount || value}
        </span>
      </div>
      <div style={styles.kpiDetail}>{detail}</div>
    </article>
  );
}

function PeriodBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "gold";
}) {
  const toneStyles =
    tone === "gold"
      ? {
          background: "rgba(255,252,236,0.96)",
          border: "1px solid rgba(214,161,63,0.22)",
          labelColor: "#a67408",
          valueColor: "var(--rr-ink)",
        }
      : {
          background: "rgba(255,255,255,0.94)",
          border: "1px solid rgba(13,77,227,0.12)",
          labelColor: "var(--rr-blue)",
          valueColor: "var(--rr-blue-deep)",
        };

  return (
    <div
      style={{
        ...styles.periodBadge,
        background: toneStyles.background,
        border: toneStyles.border,
      }}
    >
      <span style={{ ...styles.periodLabel, color: toneStyles.labelColor }}>{label}</span>
      <strong style={{ ...styles.periodValue, color: toneStyles.valueColor }}>{value}</strong>
    </div>
  );
}

function CompanyForecastChart({
  items,
  loading,
}: {
  items: CompanyRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Empresas"
        title="Carregando consolidado por empresa."
        description="A previsao por empresa esta sendo montada a partir da base financeira e operacional."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Sem previsao"
        title="Ainda nao existe previsao suficiente para montar o consolidado por empresa."
        description="Verifique se a diaria e os fechamentos mensais ja foram importados para esta competencia."
      />
    );
  }

  const maxTotal = Math.max(...items.map((item) => Number(item.expectedTotal || 0)), 1);

  return (
    <div style={styles.companyChartWrap}>
      <div style={styles.companyLegendList}>
        <LegendPill label="A vista" color="#0d4de3" />
        <LegendPill label="PRT" color="#f0b53f" />
        <LegendPill label="Seguro" color="#fff000" />
      </div>

      <div style={styles.companyBarsList}>
        {items.map((item) => {
          const total = Number(item.expectedTotal || 0);
          const expectedCash = Number(item.expectedCash || 0);
          const expectedPrt = Number(item.expectedPrt || 0);
          const expectedInsurance = Number(item.expectedInsurance || 0);
          const visualWidth = total > 0 ? Math.max((total / maxTotal) * 100, 14) : 0;
          const cashShare = total > 0 ? (expectedCash / total) * 100 : 0;
          const prtShare = total > 0 ? (expectedPrt / total) * 100 : 0;
          const insuranceShare = total > 0 ? (expectedInsurance / total) * 100 : 0;

          return (
            <div
              key={`${item.empresa_cnpj}-${item.empresa_nome}`}
              style={styles.companyBarItem}
            >
              <div style={styles.companyBarHeader}>
                <div>
                  <div style={styles.companyName}>{item.empresa_nome || "-"}</div>
                  <div style={styles.companyMeta}>{item.empresa_cnpj || "-"}</div>
                </div>
                <div style={styles.companyTotal}>{formatCurrency(total)}</div>
              </div>

              <div style={styles.companyTrack}>
                <div style={{ ...styles.companyFill, width: `${visualWidth}%` }}>
                  {cashShare > 0 ? (
                    <div
                      style={{
                        ...styles.companySegment,
                        width: `${cashShare}%`,
                        background: "#0d4de3",
                      }}
                    />
                  ) : null}
                  {prtShare > 0 ? (
                    <div
                      style={{
                        ...styles.companySegment,
                        width: `${prtShare}%`,
                        background: "#f0b53f",
                      }}
                    />
                  ) : null}
                  {insuranceShare > 0 ? (
                    <div
                      style={{
                        ...styles.companySegment,
                        width: `${insuranceShare}%`,
                        background: "#fff000",
                      }}
                    />
                  ) : null}
                </div>
              </div>

              <div style={styles.companyBreakdown}>
                <span style={styles.companyBreakdownItem}>
                  A vista {formatCurrency(expectedCash)}
                </span>
                <span style={styles.companyBreakdownItem}>
                  PRT do mes {formatCurrency(expectedPrt)}
                </span>
                <span style={styles.companyBreakdownItem}>
                  Seguro {formatCurrency(expectedInsurance)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LegendPill({ label, color }: { label: string; color: string }) {
  return (
    <div style={styles.legendPill}>
      <span style={{ ...styles.legendDot, background: color }} />
      <span style={styles.legendPillLabel}>{label}</span>
    </div>
  );
}

function RevenueChart({
  items,
  loading,
}: {
  items: RevenuePoint[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Historico"
        title="Carregando barras mensais."
        description="O fluxo real x previsao esta sendo organizado mes a mes."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Sem historico"
        title="Nao ha historico mensal para exibir."
        description="Importe mais competencias para transformar esse painel em uma serie executiva."
      />
    );
  }

  const maxValue = Math.max(
    ...items.map((item) => Math.max(item.actualTotal, item.expectedTotal)),
    1
  );

  return (
    <div style={styles.revenueWrap}>
      <div style={styles.compareLegend}>
        <LegendPill label="Real" color="#0d4de3" />
        <LegendPill label="Previsao" color="#f0b53f" />
      </div>

      <div style={styles.barChart}>
        {items.map((item) => {
          const actualHeight =
            item.actualTotal > 0 ? Math.max((item.actualTotal / maxValue) * 100, 10) : 0;
          const expectedHeight =
            item.expectedTotal > 0
              ? Math.max((item.expectedTotal / maxValue) * 100, 10)
              : 0;

          return (
            <div key={item.label} style={styles.barColumn}>
              <div style={styles.barValue}>
                {formatCurrencyCompact(Math.max(item.actualTotal, item.expectedTotal))}
              </div>
              <div style={styles.compareTracks}>
                <div style={styles.compareTrack}>
                  {actualHeight > 0 ? (
                    <div
                      style={{
                        ...styles.compareFill,
                        height: `${actualHeight}%`,
                        background:
                          "linear-gradient(180deg, rgba(13,77,227,0.95) 0%, rgba(7,37,125,0.98) 100%)",
                      }}
                    />
                  ) : null}
                </div>
                <div style={styles.compareTrack}>
                  {expectedHeight > 0 ? (
                    <div
                      style={{
                        ...styles.compareFill,
                        height: `${expectedHeight}%`,
                        background:
                          "linear-gradient(180deg, rgba(255,240,0,1) 0%, rgba(240,181,63,0.95) 100%)",
                      }}
                    />
                  ) : null}
                </div>
              </div>
              <div style={styles.barLabel}>{item.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DonutChart({
  items,
  total,
  centerLabel,
  loading,
}: {
  items: ChartItem[];
  total: number;
  centerLabel: string;
  loading: boolean;
}) {
  if (loading) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Composicao"
        title="Montando composicao da previsao."
        description="A distribuicao entre a vista, PRT e seguro esta sendo consolidada."
      />
    );
  }

  if (items.length === 0 || total <= 0) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Sem composicao"
        title="Nao ha base suficiente para montar o grafico."
        description="Essa visao precisa de previsao financeira valida para a competencia atual."
      />
    );
  }

  let accumulated = 0;
  const slices = items.map((item) => {
    const slice = (item.value / total) * 100;
    const start = accumulated;
    accumulated += slice;
    return `${item.color} ${start}% ${accumulated}%`;
  });

  return (
    <div style={styles.donutLayout}>
      <div
        style={{
          ...styles.donut,
          background: `conic-gradient(${slices.join(", ")})`,
        }}
      >
        <div style={styles.donutCenter}>
          <strong style={styles.donutValue}>{formatCurrencyCompact(total)}</strong>
          <span style={styles.donutLabel}>{centerLabel}</span>
        </div>
      </div>

      <div style={styles.legendList}>
        {items.map((item) => (
          <div key={item.label} style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: item.color }} />
            <div style={styles.legendCopy}>
              <span style={styles.legendLabel}>{item.label}</span>
              <strong style={styles.legendValue}>{formatCurrency(item.value)}</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductShareChart({
  items,
  loading,
}: {
  items: Array<ChartItem & { percent: number }>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Mix comercial"
        title="Calculando participacao por produto."
        description="A leitura da producao valida esta sendo consolidada por familia comercial."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyStatePanel
        compact
        eyebrow="Sem producao"
        title="Ainda nao existe producao valida para esse grafico."
        description="Importe ou recalcule a competencia para liberar a leitura por produto."
      />
    );
  }

  return (
    <div style={styles.productList}>
      {items.map((item) => (
        <div key={item.label} style={styles.productItem}>
          <div style={styles.productTop}>
            <span style={styles.productLabel}>{item.label}</span>
            <strong style={styles.productPercent}>{formatPercent(item.percent)}</strong>
          </div>
          <div style={styles.productTrack}>
            <div
              style={{
                ...styles.productFill,
                width: `${Math.max(item.percent, 8)}%`,
                background: item.color,
              }}
            />
          </div>
          <div style={styles.productValue}>{formatCurrency(item.value)}</div>
        </div>
      ))}
    </div>
  );
}

function splitKpiValue(value: string) {
  const match = String(value || "").match(/^([^\d-]+)\s*(.+)$/);

  if (!match) {
    return {
      prefix: "",
      amount: String(value || ""),
    };
  }

  return {
    prefix: match[1].trim(),
    amount: match[2].trim(),
  };
}

function getAdaptiveValueStyle(value: string): CSSProperties {
  const length = String(value || "").trim().length;

  if (length >= 14) {
    return {
      fontSize: "clamp(1.45rem, 1.2vw, 1.95rem)",
      letterSpacing: "-0.05em",
    };
  }

  if (length >= 11) {
    return {
      fontSize: "clamp(1.65rem, 1.45vw, 2.2rem)",
      letterSpacing: "-0.045em",
    };
  }

  return {
    fontSize: "clamp(1.9rem, 1.8vw, 2.65rem)",
    letterSpacing: "-0.03em",
  };
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

function formatNumber(value?: number) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function formatPercent(value?: number) {
  return `${Number(value || 0).toFixed(1).replace(".", ",")}%`;
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: "16px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "flex-start",
    flexWrap: "wrap",
    padding: "18px 20px",
    borderRadius: "24px",
    background: "linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(248,251,255,0.96) 100%)",
    border: "1px solid rgba(13,77,227,0.1)",
    boxShadow: "var(--rr-shadow-soft)",
  },
  headerCopy: {
    display: "grid",
    gap: "12px",
    maxWidth: 820,
  },
  periodPanel: {
    display: "grid",
    gap: "8px",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    justifyItems: "stretch",
  },
  kicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  title: {
    margin: 0,
    fontSize: "clamp(2rem, 3vw, 3.2rem)",
    color: "var(--rr-ink)",
  },
  description: {
    margin: 0,
    fontSize: "14px",
    lineHeight: 1.62,
    color: "var(--rr-muted)",
  },
  executiveSignals: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "10px",
  },
  executiveSignal: {
    display: "grid",
    gap: "4px",
    padding: "12px 13px",
    borderRadius: "18px",
    background: "rgba(13,77,227,0.04)",
    border: "1px solid rgba(13,77,227,0.08)",
  },
  executiveSignalLabel: {
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  executiveSignalValue: {
    fontSize: "18px",
    color: "var(--rr-ink-soft)",
    fontFamily: "var(--font-heading)",
  },
  executiveSignalHint: {
    fontSize: "12px",
    lineHeight: 1.45,
    color: "var(--rr-muted)",
  },
  periodBadge: {
    display: "grid",
    gap: "4px",
    minWidth: "160px",
    borderRadius: "20px",
    padding: "12px 14px",
    boxShadow: "var(--rr-shadow-soft)",
  },
  periodLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    fontWeight: 800,
  },
  periodValue: {
    fontSize: "22px",
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
    background: "rgba(255,252,236,0.96)",
    border: "1px solid rgba(214,161,63,0.22)",
    borderRadius: "18px",
    padding: "14px 16px",
    display: "grid",
    gap: "8px",
  },
  noticeKicker: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "#a67408",
    fontWeight: 800,
  },
  noticeList: {
    display: "grid",
    gap: "8px",
  },
  noticeItem: {
    fontSize: "13px",
    lineHeight: 1.6,
    color: "var(--rr-ink)",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "10px",
  },
  kpiCard: {
    borderRadius: "20px",
    padding: "16px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    minWidth: 0,
    position: "relative",
    overflow: "hidden",
  },
  kpiLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    marginBottom: "8px",
    fontWeight: 800,
  },
  kpiValue: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    flexWrap: "wrap",
    marginBottom: "8px",
    lineHeight: 1.08,
    minWidth: 0,
  },
  kpiValuePrefix: {
    fontSize: "clamp(1.2rem, 1vw, 1.55rem)",
    fontWeight: 800,
    fontFamily: "var(--font-heading)",
    flexShrink: 0,
  },
  kpiValueAmount: {
    fontWeight: 800,
    fontFamily: "var(--font-heading)",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    minWidth: 0,
    maxWidth: "100%",
  },
  kpiDetail: {
    fontSize: "12px",
    lineHeight: 1.5,
    color: "var(--rr-muted)",
  },
  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(360px, 1.34fr) minmax(300px, 0.98fr)",
    gap: "14px",
    alignItems: "start",
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
    background: "rgba(13,77,227,0.06)",
    border: "1px solid rgba(13,77,227,0.1)",
    color: "var(--rr-blue-deep)",
    fontSize: "12px",
    fontWeight: 800,
  },
  companyChartWrap: {
    display: "grid",
    gap: "14px",
    padding: "14px 18px 18px",
  },
  companyLegendList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
  },
  legendPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    borderRadius: "999px",
    background: "rgba(13,77,227,0.06)",
    border: "1px solid rgba(13,77,227,0.08)",
  },
  legendPillLabel: {
    fontSize: "12px",
    color: "var(--rr-blue-deep)",
    fontWeight: 700,
  },
  companyBarsList: {
    display: "grid",
    gap: "14px",
  },
  companyBarItem: {
    display: "grid",
    gap: "8px",
  },
  companyBarHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "flex-start",
    flexWrap: "wrap",
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
  companyTotal: {
    fontSize: "14px",
    color: "var(--rr-blue-deep)",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  companyTrack: {
    width: "100%",
    height: "16px",
    borderRadius: "999px",
    background: "rgba(13,77,227,0.08)",
    overflow: "hidden",
    display: "flex",
    alignItems: "stretch",
  },
  companyFill: {
    height: "100%",
    borderRadius: "999px",
    overflow: "hidden",
    display: "flex",
    boxShadow: "0 10px 22px rgba(13,77,227,0.12)",
  },
  companySegment: {
    height: "100%",
  },
  companyBreakdown: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
  },
  companyBreakdownItem: {
    fontSize: "12px",
    color: "var(--rr-muted)",
  },
  sideRail: {
    display: "grid",
    gap: "14px",
    position: "sticky",
    top: "84px",
  },
  chartCard: {
    background: "rgba(255,255,255,0.94)",
    borderRadius: "22px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    overflow: "hidden",
    paddingBottom: "18px",
  },
  revenueWrap: {
    display: "grid",
    gap: "12px",
  },
  compareLegend: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    padding: "14px 18px 0",
  },
  barChart: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(46px, 1fr))",
    gap: "10px",
    alignItems: "end",
    padding: "0 18px 0",
    minHeight: "220px",
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
  compareTracks: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(16px, 1fr))",
    gap: "8px",
    alignItems: "end",
  },
  compareTrack: {
    width: "100%",
    maxWidth: "22px",
    height: "118px",
    borderRadius: "14px",
    background: "linear-gradient(180deg, rgba(13,77,227,0.06) 0%, rgba(13,77,227,0.12) 100%)",
    display: "flex",
    alignItems: "flex-end",
    padding: "4px",
  },
  compareFill: {
    width: "100%",
    borderRadius: "10px",
    boxShadow: "0 12px 22px rgba(13,77,227,0.16)",
  },
  barLabel: {
    fontSize: "12px",
    color: "var(--rr-blue-deep)",
    fontWeight: 700,
  },
  donutLayout: {
    display: "grid",
    gap: "14px",
    padding: "16px 18px 0",
    justifyItems: "center",
  },
  donut: {
    width: "174px",
    height: "174px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
  },
  donutCenter: {
    width: "108px",
    height: "108px",
    borderRadius: "50%",
    background: "#ffffff",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    boxShadow: "inset 0 0 0 1px rgba(13,77,227,0.08)",
    padding: "12px",
  },
  donutValue: {
    fontSize: "20px",
    color: "var(--rr-blue-deep)",
    fontFamily: "var(--font-heading)",
  },
  donutLabel: {
    fontSize: "12px",
    color: "var(--rr-muted)",
  },
  legendList: {
    display: "grid",
    gap: "10px",
    width: "100%",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  legendDot: {
    width: "10px",
    height: "10px",
    borderRadius: "999px",
    flexShrink: 0,
  },
  legendCopy: {
    display: "grid",
    gap: "2px",
  },
  legendLabel: {
    fontSize: "13px",
    color: "var(--rr-muted)",
  },
  legendValue: {
    fontSize: "13px",
    color: "var(--rr-ink)",
  },
  productList: {
    display: "grid",
    gap: "12px",
    padding: "16px 18px 0",
  },
  productItem: {
    display: "grid",
    gap: "8px",
  },
  productTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "center",
  },
  productLabel: {
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--rr-ink)",
  },
  productPercent: {
    fontSize: "13px",
    color: "var(--rr-blue-deep)",
  },
  productTrack: {
    width: "100%",
    height: "12px",
    borderRadius: "999px",
    background: "rgba(13,77,227,0.08)",
    overflow: "hidden",
  },
  productFill: {
    height: "100%",
    borderRadius: "999px",
    boxShadow: "0 8px 20px rgba(13,77,227,0.12)",
  },
  productValue: {
    fontSize: "12px",
    color: "var(--rr-muted)",
  },
  emptyState: {
    padding: "18px",
    color: "var(--rr-muted)",
    fontSize: "14px",
  },
};
