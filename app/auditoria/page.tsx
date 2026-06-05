"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import FeedbackBanner from "../../components/FeedbackBanner";
import HistoricalFindingsSection from "../../components/auditoria/HistoricalFindingsSection";

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

type PrtCiclo = {
  year: number;
  month: number;
  entradas: number;
  previsto: number;
  recebido: number;
  naoPago: number;
};

type AuditPayload = {
  periods: PeriodOption[];
  selectedPeriod: PeriodOption | null;
  summary: Summary;
  alerts: string[];
  prtCiclo: PrtCiclo | null;
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
  alerts: [],
  prtCiclo: null,
};

export default function AuditoriaPage() {
  const [selectedKey, setSelectedKey] = useState("");
  const [data, setData] = useState<AuditPayload>(emptyPayload);
  const [, setLoading] = useState(true);
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

      {data.prtCiclo ? (
        <article style={styles.prtCard}>
          <div style={styles.prtHead}>
            <div>
              <div style={styles.prtKicker}>Ciclo PRT — previsto vs recebido</div>
              <h3 style={styles.prtTitle}>
                PRT do ciclo de {data.selectedPeriod?.label ?? "—"}
              </h3>
            </div>
            <span style={styles.prtBadge}>estimativa automática do fechamento</span>
          </div>
          <div style={styles.prtGrid}>
            <SummaryCard
              label="PRT previsto (listado)"
              value={formatCurrency(data.prtCiclo.previsto)}
              detail={`${data.prtCiclo.entradas} parcelas listadas no ciclo.`}
            />
            <SummaryCard
              label="PRT recebido (cod_est=1)"
              value={formatCurrency(data.prtCiclo.recebido)}
              detail="Parcelas que de fato vieram (bate o diferido do fechamento)."
            />
            <SummaryCard
              label="PRT não pago no ciclo"
              value={formatCurrency(data.prtCiclo.naoPago)}
              detail="Listado e não pago neste ciclo (cod_est 2/99). Não cumulativo."
            />
          </div>
          <p style={styles.prtNote}>
            Métrica <strong>automática</strong> do fechamento (apenas cod_est + comissão
            listada, sem curadoria de produto). <strong>Não é a auditoria oficial curada</strong>{" "}
            — essa fica nas seções abaixo (auditoria histórica). O à vista automático foi
            desativado por não ser confiável sem curadoria; volta quando a planilha
            curada por mês for carregada.
          </p>
        </article>
      ) : null}

      {(() => {
        const effectiveKey = periodValue;
        if (!effectiveKey) return null;
        const [yStr, mStr] = effectiveKey.split("-");
        const y = Number(yStr);
        const m = Number(mStr);
        if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
        return <HistoricalFindingsSection year={y} month={m} />;
      })()}
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
  prtCard: {
    borderRadius: "20px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    background: "rgba(255,255,255,0.96)",
    padding: "18px",
    display: "grid",
    gap: "12px",
  },
  prtHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  prtKicker: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  prtTitle: { margin: "4px 0 0", fontSize: "18px", color: "var(--rr-ink)" },
  prtBadge: {
    fontSize: "11px",
    fontWeight: 800,
    color: "#92400e",
    background: "#fef3c7",
    border: "1px solid #f59e0b55",
    borderRadius: "999px",
    padding: "4px 10px",
  },
  prtGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "10px",
  },
  prtNote: {
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.6,
    color: "var(--rr-muted)",
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
};
