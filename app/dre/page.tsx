"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import FeedbackBanner from "../../components/FeedbackBanner";

type DrePeriod = { year: number; month: number; key: string; label: string };

type DreLine = {
  scope: "COMPANY" | "GROUP";
  companyId: string | null;
  cnpj: string;
  name: string;
  receita: number;
  receitaFechamento: number;
  receitaComplementar: number;
  comissoes: number;
  resultadoBruto: number;
  despesas: number;
  despesasGrupo: number;
  resultadoLiquido: number;
};

type DrePayload = {
  closed: boolean;
  period: DrePeriod | null;
  periods: DrePeriod[];
  companies: DreLine[];
  group: DreLine | null;
  alerts: string[];
};

const emptyPayload: DrePayload = {
  closed: false,
  period: null,
  periods: [],
  companies: [],
  group: null,
  alerts: [],
};

function formatCurrency(value?: number) {
  return (value ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export default function DrePage() {
  const [selectedKey, setSelectedKey] = useState("");
  const [data, setData] = useState<DrePayload>(emptyPayload);
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
          params.set("month", String(Number(month)));
        }

        const response = await fetch(
          `/api/dre${params.toString() ? `?${params.toString()}` : ""}`
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || "Erro ao carregar o DRE.");
        }
        setData(payload || emptyPayload);
      } catch (err: any) {
        setError(err.message || "Erro ao carregar o DRE.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedKey]);

  const periodValue = selectedKey || data.period?.key || "";

  return (
    <section style={styles.page}>
      <div style={styles.hero}>
        <article style={styles.heroMain}>
          <div style={styles.kicker}>Demonstrativo gerencial</div>
          <h2 style={styles.title}>DRE — Demonstrativo de Resultado</h2>
          <p style={styles.description}>
            Resultado do negócio por <strong>competência de produção</strong>: receita
            do mês, menos comissões pagas aos promotores, menos despesas operacionais.
            Um demonstrativo por CNPJ e o consolidado do grupo.
          </p>
        </article>

        <article style={styles.heroAside}>
          <div style={styles.selectorLabel}>Competência (meses fechados)</div>
          <select
            value={periodValue}
            onChange={(event) => setSelectedKey(event.target.value)}
            style={styles.select}
          >
            {data.periods.length === 0 ? (
              <option value="">Sem mês fechado</option>
            ) : null}
            {data.periods.map((period) => (
              <option key={period.key} value={period.key}>
                {period.label}
              </option>
            ))}
          </select>
        </article>
      </div>

      <div style={styles.regimeNote}>
        <strong>Gerencial (regime de competência, eixo de produção).</strong> Não é o
        RBT12: o RBT12 é fiscal (regime de caixa / recebimento, para o Simples). Os dois
        usam eixos diferentes por natureza — <em>caixa ≠ competência</em> — então não
        batem entre si, e isso é o esperado.
      </div>

      {error ? (
        <FeedbackBanner
          variant="error"
          eyebrow="DRE indisponível"
          title="Não foi possível carregar o demonstrativo."
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

      {!loading && !error && !data.closed ? (
        <FeedbackBanner
          variant="info"
          eyebrow="Aguardando fechamento"
          title={`${data.period?.label ?? "Competência"} ainda não fechada`}
          description="A receita só existe após o fechamento do mês. O DRE é de resultado realizado e não exibe número parcial."
          actionLabel="Abrir fechamento"
          actionHref="/fechamento"
        />
      ) : null}

      {data.closed && data.group ? (
        <DreCard line={data.group} highlight periodLabel={data.period?.label ?? ""} />
      ) : null}

      {data.closed && data.companies.length > 0 ? (
        <div style={styles.companiesGrid}>
          {data.companies.map((line) => (
            <DreCard key={line.companyId ?? line.cnpj} line={line} periodLabel={data.period?.label ?? ""} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DreCard({
  line,
  periodLabel,
  highlight,
}: {
  line: DreLine;
  periodLabel: string;
  highlight?: boolean;
}) {
  const liquidoPositive = line.resultadoLiquido >= 0;
  return (
    <article style={{ ...styles.card, ...(highlight ? styles.cardGroup : {}) }}>
      <div style={styles.cardHead}>
        <div>
          <div style={styles.cardKicker}>
            {line.scope === "GROUP" ? "Consolidado do grupo" : "Por CNPJ"}
          </div>
          <h3 style={styles.cardTitle}>{line.name}</h3>
          {line.cnpj ? <div style={styles.cardCnpj}>{line.cnpj}</div> : null}
        </div>
        <span style={styles.periodBadge}>{periodLabel}</span>
      </div>

      <div style={styles.table}>
        <Row label="RECEITA" value={line.receita} strong />
        <SubRow label="fechamento (nota fiscal)" value={line.receitaFechamento} />
        <SubRow label="complementares (lançamentos)" value={line.receitaComplementar} />
        <Row label="(−) Comissões pagas" value={-line.comissoes} />
        <Row label="= RESULTADO BRUTO" value={line.resultadoBruto} strong divider />
        <Row label="(−) Despesas operacionais" value={-line.despesas} />
        {line.scope === "GROUP" && line.despesasGrupo > 0 ? (
          <SubRow label="inclui despesas de escopo grupo" value={line.despesasGrupo} />
        ) : null}
        <Row
          label="= RESULTADO LÍQUIDO"
          value={line.resultadoLiquido}
          strong
          divider
          tone={liquidoPositive ? "pos" : "neg"}
        />
      </div>
    </article>
  );
}

function Row({
  label,
  value,
  strong,
  divider,
  tone,
}: {
  label: string;
  value: number;
  strong?: boolean;
  divider?: boolean;
  tone?: "pos" | "neg";
}) {
  return (
    <div
      style={{
        ...styles.row,
        ...(divider ? styles.rowDivider : {}),
      }}
    >
      <span style={{ ...styles.rowLabel, ...(strong ? styles.rowLabelStrong : {}) }}>
        {label}
      </span>
      <span
        style={{
          ...styles.rowValue,
          ...(strong ? styles.rowValueStrong : {}),
          ...(tone === "pos" ? styles.valuePos : {}),
          ...(tone === "neg" ? styles.valueNeg : {}),
        }}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function SubRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={styles.subRow}>
      <span style={styles.subRowLabel}>{label}</span>
      <span style={styles.subRowValue}>{formatCurrency(value)}</span>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { display: "grid", gap: "16px" },
  hero: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    flexWrap: "wrap",
  },
  heroMain: { maxWidth: "620px" },
  kicker: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  title: { margin: "6px 0 8px", fontSize: "22px", color: "var(--rr-ink)" },
  description: { margin: 0, fontSize: "13px", lineHeight: 1.6, color: "var(--rr-muted)" },
  heroAside: { display: "grid", gap: "6px", minWidth: "220px" },
  selectorLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "var(--rr-muted)",
    fontWeight: 700,
  },
  select: {
    padding: "8px 10px",
    borderRadius: "10px",
    border: "1px solid var(--rr-line)",
    fontSize: "14px",
    background: "#fff",
  },
  regimeNote: {
    fontSize: "12px",
    lineHeight: 1.6,
    color: "#92400e",
    background: "#fef3c7",
    border: "1px solid #f59e0b55",
    borderRadius: "12px",
    padding: "10px 14px",
  },
  alertBox: {
    fontSize: "13px",
    color: "#92400e",
    background: "#fffbeb",
    border: "1px solid #f59e0b55",
    borderRadius: "10px",
    padding: "10px 14px",
  },
  companiesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "14px",
  },
  card: {
    borderRadius: "18px",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow-soft)",
    background: "rgba(255,255,255,0.96)",
    padding: "18px",
    display: "grid",
    gap: "12px",
  },
  cardGroup: {
    border: "2px solid var(--rr-blue)",
    background: "rgba(13,77,227,0.03)",
  },
  cardHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10px",
  },
  cardKicker: {
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  cardTitle: { margin: "4px 0 0", fontSize: "16px", color: "var(--rr-ink)" },
  cardCnpj: { fontSize: "11px", color: "var(--rr-muted)", marginTop: "2px" },
  periodBadge: {
    fontSize: "11px",
    fontWeight: 700,
    color: "var(--rr-muted)",
    background: "var(--rr-surface, #f3f4f6)",
    border: "1px solid var(--rr-line)",
    borderRadius: "999px",
    padding: "3px 10px",
    whiteSpace: "nowrap",
  },
  table: { display: "grid", gap: "2px" },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "12px",
    padding: "5px 0",
  },
  rowDivider: { borderTop: "1px solid var(--rr-line)", marginTop: "2px", paddingTop: "8px" },
  rowLabel: { fontSize: "13px", color: "var(--rr-muted)" },
  rowLabelStrong: { fontWeight: 800, color: "var(--rr-ink)", fontSize: "13px" },
  rowValue: { fontSize: "13px", color: "var(--rr-ink)", fontVariantNumeric: "tabular-nums" },
  rowValueStrong: { fontWeight: 800, fontSize: "14px" },
  valuePos: { color: "#15803d" },
  valueNeg: { color: "#b91c1c" },
  subRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "12px",
    padding: "1px 0 1px 14px",
  },
  subRowLabel: { fontSize: "11px", color: "var(--rr-muted)" },
  subRowValue: {
    fontSize: "11px",
    color: "var(--rr-muted)",
    fontVariantNumeric: "tabular-nums",
  },
};
