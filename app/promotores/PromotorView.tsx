"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

type PeriodOption = {
  key: string;
  label: string;
  year: number;
  month: number;
};

type ProposalRow = {
  id: string;
  contract_number: string;
  proposal_number: string;
  agency_code: string;
  j_key: string;
  promoter_name: string;
  product_description: string;
  status: string;
  movement_date?: string | null;
  contract_date?: string | null;
  interest_rate: number;
  installment_count: number;
  company_received_percent: number;
  company_commission_amount: number;
  srcc_restriction: string;
  net_value: number;
  gross_value: number;
  insurance_value: number;
  company_insurance_commission_amount: number;
  insurance_penetration_percent: number;
  promoter_commission_percent: number;
  promoter_commission_amount: number;
  insurance_commission_percent: number;
  insurance_commission_amount: number;
};

type PromoterSummaryRow = {
  promoter_id: string;
  promoter_name: string;
  production_value: number;
  target_value: number;
  insurance_penetration_percent: number;
  final_commission_value: number;
  payable_commission_value: number;
};

type PromotorPayload = {
  periods: PeriodOption[];
  selectedPeriod: PeriodOption;
  summaryRows: PromoterSummaryRow[];
  proposalRows: ProposalRow[];
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatCurrency(value: number | null | undefined) {
  return currencyFormatter.format(Number(value ?? 0));
}

function formatPercent(value: number | null | undefined, decimals = 2) {
  const raw = Number(value ?? 0);
  // Heuristica: se valor menor que 1, esta em formato decimal (0.058);
  // multiplica por 100. Acima de 1, ja esta em percentual (5.8).
  const display = Math.abs(raw) > 0 && Math.abs(raw) <= 1 ? raw * 100 : raw;
  return `${display.toFixed(decimals).replace(".", ",")}%`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const year = parsed.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function formatInterestRate(value: number | null | undefined) {
  const raw = Number(value ?? 0);
  const display = Math.abs(raw) > 0 && Math.abs(raw) <= 1 ? raw * 100 : raw;
  return `${display.toFixed(2).replace(".", ",")}%`;
}

// Cores precisam ser explicitas no <td> sticky-left porque sticky cria
// stacking context proprio que ignora o background do <tr>. Sem isso o
// texto das outras colunas vaza por baixo da coluna CONTRATO durante
// scroll horizontal. Cores SOLIDAS (sem alpha) sao obrigatorias —
// cores semi-transparentes nao cobrem o conteudo que rola por tras.
const ROW_BG = "#ffffff";
const ROW_ALT_BG = "#f8faff"; // azul ~3% blendado sobre branco
const TOTAL_ROW_BG = "#f1f5fd"; // azul ~6% blendado sobre branco

const COLUMNS = [
  { key: "contract", label: "Contrato", align: "left" as const },
  { key: "valor_bruto", label: "Valor bruto", align: "right" as const },
  { key: "valor_liquido", label: "Valor líquido", align: "right" as const },
  { key: "parcela", label: "Parcela", align: "right" as const },
  { key: "agencia", label: "Agência", align: "left" as const },
  { key: "chave_j", label: "Chave J", align: "left" as const },
  { key: "promotor", label: "Promotor(a)", align: "left" as const },
  { key: "data", label: "Data contratação", align: "left" as const },
  { key: "tx_juros", label: "Tx juros", align: "right" as const },
  { key: "produto", label: "Descrição do produto", align: "left" as const },
  { key: "p_vista", label: "% à vista", align: "right" as const },
  { key: "comissao_pf", label: "Comissão PF", align: "right" as const },
  { key: "srcc", label: "Restrição SRCC", align: "left" as const },
  { key: "valor_seguro", label: "Valor seguro", align: "right" as const },
  { key: "comissao_seguro", label: "Comissão seguro", align: "right" as const },
  { key: "p_penetracao", label: "% penetração", align: "right" as const },
  { key: "comissao_promotor", label: "Comissão promotor", align: "right" as const },
  { key: "comissao_seguro_2", label: "Comissão seguro promotor", align: "right" as const },
];

export default function PromotorView() {
  const [data, setData] = useState<PromotorPayload | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams();
        if (selectedKey) {
          const [year, month] = selectedKey.split("-");
          if (year) params.set("year", year);
          if (month) params.set("month", String(Number(month)));
        }

        const response = await fetch(
          `/api/promotores${params.toString() ? `?${params.toString()}` : ""}`
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Erro ao carregar seu relatório.");
        }

        if (!cancelled) {
          setData(payload as PromotorPayload);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Erro ao carregar seu relatório.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  // 3.5.6.1 - Nao forcar selectedKey para o mes vigente. O fetch
  // inicial vai sem year/month, deixando buildPromoterAnalytics
  // escolher latestPeriod (mes mais recente com producao real).
  // O dropdown mostra esse periodo via currentKey computado abaixo.
  // Quando o promotor troca de competencia, ai selectedKey muda e o
  // useEffect dispara fetch com year/month explicitos.
  const summary = data?.summaryRows[0] ?? null;
  const proposals = data?.proposalRows ?? [];
  const currentKey = selectedKey || data?.selectedPeriod.key || "";

  const totals = useMemo(() => {
    const liquido = proposals.reduce((sum, row) => sum + Number(row.net_value ?? 0), 0);
    const comissaoPromotor = proposals.reduce(
      (sum, row) => sum + Number(row.promoter_commission_amount ?? 0),
      0
    );
    const comissaoSeguro = proposals.reduce(
      (sum, row) => sum + Number(row.insurance_commission_amount ?? 0),
      0
    );

    return {
      liquido,
      comissaoPromotor,
      comissaoSeguro,
      total: comissaoPromotor + comissaoSeguro,
    };
  }, [proposals]);

  const metaInfo = useMemo(() => {
    if (!summary) return null;
    if (!summary.target_value || summary.target_value <= 0) return null;
    return {
      target: summary.target_value,
      achieved: summary.production_value,
      atingida: summary.production_value >= summary.target_value,
    };
  }, [summary]);

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.kicker}>Meu relatório mensal</div>
          <h1 style={styles.title}>
            {summary?.promoter_name || "Minha carteira"}
          </h1>
          <p style={styles.subtitle}>
            Operação consolidada do mês selecionado.
          </p>
        </div>
        <div style={styles.periodSelectorWrap}>
          <label style={styles.label} htmlFor="competencia">
            Competência
          </label>
          <select
            id="competencia"
            value={currentKey}
            onChange={(event) => setSelectedKey(event.target.value)}
            style={styles.select}
          >
            {(data?.periods ?? []).map((period) => (
              <option key={period.key} value={period.key}>
                {period.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {error ? <div style={styles.error}>{error}</div> : null}

      {metaInfo ? (
        <div
          style={{
            ...styles.metaBanner,
            ...(metaInfo.atingida ? styles.metaOk : styles.metaPending),
          }}
        >
          <span style={styles.metaLabel}>
            {metaInfo.atingida ? "Meta atingida" : "Meta não atingida"}
          </span>
          <span style={styles.metaValues}>
            Produção {formatCurrency(metaInfo.achieved)} · Meta{" "}
            {formatCurrency(metaInfo.target)}
          </span>
        </div>
      ) : null}

      <div style={styles.card}>
        {loading ? (
          <div style={styles.loading}>Carregando seu relatório...</div>
        ) : proposals.length === 0 ? (
          <div style={styles.empty}>
            Nenhuma proposta encontrada nesta competência.
          </div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {COLUMNS.map((col, i) => (
                    <th
                      key={col.key}
                      style={{
                        ...styles.th,
                        textAlign: col.align,
                        ...(i === 0 ? styles.thSticky : {}),
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {proposals.map((row, rowIdx) => {
                  const isZebra = rowIdx % 2 === 1;
                  const rowBg = isZebra ? ROW_ALT_BG : ROW_BG;
                  return (
                  <tr
                    key={row.id}
                    style={isZebra ? styles.rowAlt : undefined}
                  >
                    <td
                      style={{
                        ...styles.td,
                        ...styles.tdSticky,
                        background: rowBg,
                      }}
                    >
                      {row.contract_number || row.proposal_number || "-"}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {formatCurrency(row.gross_value)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {formatCurrency(row.net_value)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {row.installment_count || 0}
                    </td>
                    <td style={styles.td}>{row.agency_code || "-"}</td>
                    <td style={styles.td}>{row.j_key || "-"}</td>
                    <td style={styles.td}>{row.promoter_name || "-"}</td>
                    <td style={styles.td}>
                      {formatDate(row.contract_date || row.movement_date)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {formatInterestRate(row.interest_rate)}
                    </td>
                    <td style={styles.td}>{row.product_description || "-"}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {formatPercent(row.company_received_percent)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {formatCurrency(row.company_commission_amount)}
                    </td>
                    <td style={styles.td}>{row.srcc_restriction || "Não"}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {formatCurrency(row.insurance_value)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {formatCurrency(row.company_insurance_commission_amount)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {formatPercent(row.insurance_penetration_percent)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {formatCurrency(row.promoter_commission_amount)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right" }}>
                      {formatCurrency(row.insurance_commission_amount)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={styles.totalRow}>
                  <td style={{ ...styles.tdTotal, ...styles.tdSticky }} />
                  <td style={{ ...styles.tdTotal, textAlign: "right" }}>
                    Total
                  </td>
                  <td style={{ ...styles.tdTotal, textAlign: "right" }}>
                    {formatCurrency(totals.liquido)}
                  </td>
                  <td colSpan={15} style={styles.tdTotal} />
                </tr>
                <tr style={styles.totalRow}>
                  <td style={{ ...styles.tdTotal, ...styles.tdSticky }} />
                  <td colSpan={14} style={styles.tdTotal} />
                  <td style={{ ...styles.tdTotal, textAlign: "right" }}>
                    Total
                  </td>
                  <td style={{ ...styles.tdTotal, textAlign: "right" }}>
                    {formatCurrency(totals.comissaoPromotor)}
                  </td>
                  <td style={{ ...styles.tdTotal, textAlign: "right" }}>
                    {formatCurrency(totals.comissaoSeguro)}
                  </td>
                </tr>
                <tr style={styles.totalRow}>
                  <td style={{ ...styles.tdTotal, ...styles.tdSticky }} />
                  <td colSpan={14} style={styles.tdTotal} />
                  <td style={{ ...styles.tdTotal, textAlign: "right" }}>
                    Total geral
                  </td>
                  <td style={styles.tdTotal} />
                  <td style={{ ...styles.tdGrandTotal, textAlign: "right" }}>
                    {formatCurrency(totals.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: 20,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: 16,
  },
  kicker: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "var(--rr-blue)",
    marginBottom: 6,
  },
  title: {
    margin: 0,
    fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
    fontWeight: 700,
    color: "var(--rr-ink)",
    lineHeight: 1.2,
  },
  subtitle: {
    margin: "6px 0 0",
    fontSize: 13,
    color: "var(--rr-muted)",
  },
  periodSelectorWrap: {
    display: "grid",
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: 800,
    color: "var(--rr-blue)",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  select: {
    borderRadius: 12,
    border: "1px solid #d8e2fa",
    padding: "10px 12px",
    background: "#fff",
    fontSize: 14,
    color: "var(--rr-ink)",
    minWidth: 180,
  },
  error: {
    padding: 14,
    borderRadius: 12,
    background: "rgba(214,80,80,0.08)",
    color: "#a32626",
    fontSize: 13,
    fontWeight: 600,
  },
  metaBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "14px 18px",
    borderRadius: 16,
    fontWeight: 700,
  },
  metaOk: {
    background: "linear-gradient(135deg, rgba(34,178,93,0.16) 0%, rgba(255,255,255,0.95) 100%)",
    border: "1px solid rgba(34,178,93,0.32)",
    color: "#1a6b3d",
  },
  metaPending: {
    background: "linear-gradient(135deg, rgba(214,161,63,0.16) 0%, rgba(255,255,255,0.95) 100%)",
    border: "1px solid rgba(214,161,63,0.32)",
    color: "#8a5a18",
  },
  metaLabel: {
    fontSize: 14,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  metaValues: {
    fontSize: 13,
  },
  card: {
    borderRadius: 20,
    background: "#fff",
    border: "1px solid var(--rr-line)",
    overflow: "hidden",
  },
  loading: {
    padding: 28,
    textAlign: "center",
    color: "var(--rr-muted)",
    fontSize: 14,
  },
  empty: {
    padding: 28,
    textAlign: "center",
    color: "var(--rr-muted)",
    fontSize: 14,
  },
  tableWrap: {
    overflowX: "auto",
    maxHeight: "70vh",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 12.5,
  },
  th: {
    padding: "12px 14px",
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--rr-blue)",
    background: "#ffffff",
    borderBottom: "1px solid var(--rr-line)",
    position: "sticky",
    top: 0,
    whiteSpace: "nowrap",
    zIndex: 2,
  },
  thSticky: {
    left: 0,
    zIndex: 3,
  },
  td: {
    padding: "10px 14px",
    color: "var(--rr-ink)",
    borderBottom: "1px solid #f0f4fd",
    whiteSpace: "nowrap",
    // background propositadamente removido: o zebra do <tr> (styles.rowAlt)
    // precisa ficar visivel em todas as colunas, nao so na sticky. A
    // sticky cell mantem background inline explicito por necessidade.
  },
  // 'background' propositadamente omitido — cada uso de tdSticky deve
  // setar a propria cor de fundo via inline style (ROW_BG, ROW_ALT_BG
  // ou TOTAL_ROW_BG conforme contexto). Sticky cria stacking context
  // proprio e nao herda o background do <tr>.
  tdSticky: {
    position: "sticky",
    left: 0,
    fontWeight: 700,
    zIndex: 1,
  },
  rowAlt: {
    background: ROW_ALT_BG,
  },
  totalRow: {
    background: TOTAL_ROW_BG,
  },
  tdTotal: {
    padding: "12px 14px",
    fontSize: 12.5,
    fontWeight: 800,
    color: "var(--rr-ink)",
    borderTop: "1px solid #d8e2fa",
    background: TOTAL_ROW_BG,
    whiteSpace: "nowrap",
  },
  tdGrandTotal: {
    padding: "12px 14px",
    fontSize: 13.5,
    fontWeight: 800,
    color: "var(--rr-blue-deep)",
    borderTop: "2px solid #b2c6f8",
    background: "#fffcd6",
    whiteSpace: "nowrap",
  },
};
