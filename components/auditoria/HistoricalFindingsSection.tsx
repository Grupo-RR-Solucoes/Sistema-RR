"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import FeedbackBanner from "../FeedbackBanner";
import HistoricalFindingsCash from "./HistoricalFindingsCash";
import HistoricalFindingsPrt from "./HistoricalFindingsPrt";
import {
  fetchHistoricalAudit,
  formatCurrency,
  isMetaRegime,
  isVolumeOuSafira,
  type HistoricalAuditPayload,
} from "@/lib/historicalAuditClient";

type Tab = "cash" | "prt";

export default function HistoricalFindingsSection({
  year,
  month,
}: {
  year: number;
  month: number;
}) {
  const isMeta = isMetaRegime(year, month);
  const isCovered = isVolumeOuSafira(year, month);

  // Caso META: placeholder explicativo, sem fetch.
  if (isMeta) {
    return (
      <section style={styles.outer}>
        <SectionHeader />
        <FeedbackBanner
          variant="info"
          eyebrow="Em construção"
          title="Auditoria histórica indisponível para este mês"
          description="Mês em regime META (jul/2023 a jun/2025). A detecção de enquadramento errado por meta requer extensão do importador (Sub-etapa 3.2.A.4 pendente). Apenas auditoria de divergência interna está disponível para esses meses no momento."
        />
      </section>
    );
  }

  if (!isCovered) {
    return null;
  }

  return <HistoricalFindingsLoaded year={year} month={month} />;
}

function HistoricalFindingsLoaded({
  year,
  month,
}: {
  year: number;
  month: number;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("cash");
  const [payload, setPayload] = useState<HistoricalAuditPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setPayload(null);
    fetchHistoricalAudit(year, month, ctrl.signal)
      .then((data) => setPayload(data))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(err?.message || "Falha ao carregar auditoria histórica.");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [year, month]);

  return (
    <section style={styles.outer}>
      <SectionHeader />

      <FeedbackBanner
        variant="warning"
        eyebrow="Importante"
        title="Esta análise olha apenas a parte JÁ VENCIDA até o fim do mês selecionado."
        description="Não cobra parcelas futuras. Recuperáveis representam o saldo entre o que a Promotiva pagou e o que deveria ter pago até aqui."
      />

      {loading ? (
        <FeedbackBanner
          variant="info"
          eyebrow="Calculando"
          title="Auditoria em andamento"
          description="Estamos consultando histórico A Vista, PRT e Débito do grupo. Pode levar até 2 minutos na primeira execução; depois disso fica em cache por 15 min."
          helper="Carregando..."
        />
      ) : null}

      {error ? (
        <FeedbackBanner
          variant="error"
          eyebrow="Erro"
          title="Auditoria indisponível agora"
          description={`${error}. Tente novamente em alguns instantes.`}
        />
      ) : null}

      {payload && !loading && !error ? (
        <>
          <SummaryCards payload={payload} />

          <div style={styles.tabRow}>
            <button
              type="button"
              onClick={() => setActiveTab("cash")}
              style={{
                ...styles.tabButton,
                ...(activeTab === "cash" ? styles.tabButtonActive : {}),
              }}
            >
              À Vista
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("prt")}
              style={{
                ...styles.tabButton,
                ...(activeTab === "prt" ? styles.tabButtonActive : {}),
              }}
            >
              PRT
            </button>
          </div>

          {activeTab === "cash" ? (
            <HistoricalFindingsCash results={payload.cash.results} />
          ) : (
            <HistoricalFindingsPrt results={payload.prt.results} />
          )}
        </>
      ) : null}
    </section>
  );
}

function SectionHeader() {
  return (
    <header style={styles.header}>
      <div style={styles.kicker}>Achados Históricos</div>
      <h2 style={styles.title}>Auditoria automática</h2>
      <p style={styles.subtitle}>
        Comparação entre comissão devida (regra Promotiva) e comissão paga.
      </p>
    </header>
  );
}

function SummaryCards({ payload }: { payload: HistoricalAuditPayload }) {
  const cashSum = payload.cash.summary;
  const prtSum = payload.prt.summary;
  const cashDivergencias =
    (cashSum.byDivergence.INTERNAL_DIVERGENCE || 0) +
    (cashSum.byDivergence.WRONG_BRACKET || 0) +
    (cashSum.byDivergence.OTHER || 0);

  return (
    <div style={styles.cardsGrid}>
      <Card
        eyebrow="Recuperável À Vista"
        value={formatCurrency(cashSum.totalRecuperavel)}
        helper={`${cashDivergencias} divergências detectadas`}
      />
      <Card
        eyebrow="Recuperável PRT"
        value={formatCurrency(prtSum.totalRecuperavel)}
        helper={`${prtSum.byStatus.INTERROMPIDO_SUSPEITO || 0} suspeitos + ${
          prtSum.byStatus.INTERROMPIDO_LEGITIMO || 0
        } legítimos cobráveis`}
      />
      <Card
        eyebrow="Débitos aplicados"
        value={String(prtSum.debitsApplied || 0)}
        helper="Liquidações/cancelamentos justificados"
      />
      <Card
        eyebrow="Cobertura"
        value={`${cashSum.totalContracts} À Vista | ${prtSum.totalContractsAuditados} PRT`}
        helper={`Cache: ${payload.meta.cached ? "ativo" : "primeira execução"}`}
      />
    </div>
  );
}

function Card({
  eyebrow,
  value,
  helper,
}: {
  eyebrow: string;
  value: string;
  helper: string;
}) {
  return (
    <article style={styles.card}>
      <div style={styles.cardEyebrow}>{eyebrow}</div>
      <div style={styles.cardValue}>{value}</div>
      <div style={styles.cardHelper}>{helper}</div>
    </article>
  );
}

const styles: Record<string, CSSProperties> = {
  outer: {
    marginTop: "32px",
    paddingTop: "24px",
    borderTop: "1px solid var(--rr-line)",
    display: "grid",
    gap: "16px",
  },
  header: {
    display: "grid",
    gap: "4px",
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
    fontSize: "clamp(1.4rem, 2vw, 1.9rem)",
    color: "var(--rr-ink)",
    fontFamily: "var(--font-heading)",
  },
  subtitle: {
    margin: 0,
    fontSize: "14px",
    color: "var(--rr-muted)",
    lineHeight: 1.55,
  },
  cardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "10px",
  },
  card: {
    borderRadius: "18px",
    padding: "16px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(238,244,255,0.96) 100%)",
    display: "grid",
    gap: "6px",
  },
  cardEyebrow: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  cardValue: {
    fontSize: "22px",
    fontWeight: 800,
    color: "var(--rr-ink)",
    fontFamily: "var(--font-heading)",
    lineHeight: 1.18,
  },
  cardHelper: {
    fontSize: "12px",
    color: "var(--rr-muted)",
    lineHeight: 1.5,
  },
  tabRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  tabButton: {
    border: "1px solid rgba(13,77,227,0.12)",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.92)",
    color: "var(--rr-blue-deep)",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    cursor: "pointer",
  },
  tabButtonActive: {
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.98) 0%, rgba(7,37,125,0.98) 100%)",
    color: "#ffffff",
    border: "1px solid rgba(13,77,227,0.98)",
  },
};
