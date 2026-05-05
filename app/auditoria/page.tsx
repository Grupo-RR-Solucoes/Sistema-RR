"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
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

type AuditPayload = {
  periods: PeriodOption[];
  selectedPeriod: PeriodOption | null;
  summary: Summary;
  alerts: string[];
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
};
