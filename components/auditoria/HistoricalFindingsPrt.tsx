"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import EmptyStatePanel from "../EmptyStatePanel";
import {
  type PrtResult,
  type PrtStatus,
  formatCurrency,
  getCompanyShortName,
} from "@/lib/historicalAuditClient";

const PAGE_SIZE = 10;

type Filter =
  | "ALL"
  | "INTERROMPIDO_SUSPEITO"
  | "INTERROMPIDO_LEGITIMO"
  | "NUNCA_PAGO"
  | "AUSENTE";

const FILTER_OPTIONS: Array<{ key: Filter; label: string }> = [
  { key: "ALL", label: "Todos" },
  { key: "INTERROMPIDO_SUSPEITO", label: "Suspeitos <12m" },
  { key: "INTERROMPIDO_LEGITIMO", label: "Legítimos ≥12m" },
  { key: "NUNCA_PAGO", label: "Nunca pagos" },
  { key: "AUSENTE", label: "Ausentes" },
];

export default function HistoricalFindingsPrt({ results }: { results: PrtResult[] }) {
  const [filter, setFilter] = useState<Filter>("INTERROMPIDO_SUSPEITO");
  const [page, setPage] = useState(1);

  // "ALL" lista contratos cobráveis (exclui OK e OK_DEBITADO — débitos
  // justificados não pertencem ao recuperável). Filtros específicos casam
  // exatamente o status.
  const filtered = useMemo(() => {
    let arr: PrtResult[];
    if (filter === "ALL") {
      arr = results.filter(
        (r) => r.status !== "OK" && r.status !== "OK_DEBITADO"
      );
    } else {
      arr = results.filter((r) => r.status === filter);
    }
    arr.sort(
      (a, b) =>
        Math.abs(b.recuperavelEstimado) - Math.abs(a.recuperavelEstimado)
    );
    return arr;
  }, [results, filter]);

  const totalRecuperavel = useMemo(
    () => filtered.reduce((s, r) => s + r.recuperavelEstimado, 0),
    [filtered]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const slice = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  function changeFilter(next: Filter) {
    setFilter(next);
    setPage(1);
  }

  return (
    <div style={styles.container}>
      <div style={styles.pillRow}>
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => changeFilter(opt.key)}
            style={{
              ...styles.pill,
              ...(filter === opt.key ? styles.pillActive : {}),
            }}
          >
            {opt.label}
          </button>
        ))}
        <span style={styles.counter}>{filtered.length} contratos</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyStatePanel
          compact
          eyebrow="PRT"
          title="Nenhum contrato neste filtro."
          description="Selecione outro filtro acima para ver mais resultados."
        />
      ) : (
        <>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Contrato</th>
                  <th style={styles.th}>Empresa</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Parcelas</th>
                  <th style={styles.thRight}>Meses desde origem</th>
                  <th style={styles.thRight}>Recuperável</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => (
                  <tr key={`${r.companyCnpj}-${r.operationNumber}`}>
                    <td style={styles.td}>{r.operationNumber || "—"}</td>
                    <td style={styles.td}>{getCompanyShortName(r.companyCnpj)}</td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.badge,
                          ...statusBadge(r.status),
                        }}
                      >
                        {labelOfStatus(r.status)}
                      </span>
                    </td>
                    <td style={styles.td}>
                      {r.parcelasPagas}/{r.parcelasTotal || "—"}
                    </td>
                    <td style={styles.tdRight}>{r.idadeAteUltimoMesPago}</td>
                    <td
                      style={{
                        ...styles.tdRight,
                        color:
                          r.recuperavelEstimado > 0
                            ? "#a62345"
                            : "var(--rr-muted)",
                        fontWeight: r.recuperavelEstimado > 0 ? 700 : 500,
                      }}
                    >
                      {formatCurrency(r.recuperavelEstimado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={styles.footerRow}>
            <span style={styles.footerLabel}>
              Total recuperável (filtro atual)
            </span>
            <strong style={styles.footerValue}>
              {formatCurrency(totalRecuperavel)}
            </strong>
          </div>

          <PaginationBar
            page={safePage}
            totalPages={totalPages}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

function PaginationBar({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div style={styles.pagination}>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        style={{
          ...styles.pageButton,
          ...(page <= 1 ? styles.pageButtonDisabled : {}),
        }}
      >
        Anterior
      </button>
      <span style={styles.pageLabel}>
        Página {page} de {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        style={{
          ...styles.pageButton,
          ...(page >= totalPages ? styles.pageButtonDisabled : {}),
        }}
      >
        Próxima
      </button>
    </div>
  );
}

function labelOfStatus(s: PrtStatus): string {
  switch (s) {
    case "OK":
      return "OK";
    case "OK_DEBITADO":
      return "Débito justificou";
    case "INTERROMPIDO_SUSPEITO":
      return "Suspeito";
    case "INTERROMPIDO_LEGITIMO":
      return "Legítimo";
    case "NUNCA_PAGO":
      return "Nunca pago";
    case "AUSENTE":
      return "Ausente";
  }
}

function statusBadge(s: PrtStatus): CSSProperties {
  switch (s) {
    case "OK":
      return { background: "rgba(18,142,87,0.12)", color: "#177954" };
    case "OK_DEBITADO":
      return { background: "rgba(18,142,87,0.18)", color: "#14533d" };
    case "INTERROMPIDO_SUSPEITO":
      return { background: "rgba(204,43,73,0.12)", color: "#a62345" };
    case "INTERROMPIDO_LEGITIMO":
      return { background: "rgba(214,161,63,0.16)", color: "#745114" };
    case "NUNCA_PAGO":
      return { background: "rgba(127,23,52,0.16)", color: "#7f1734" };
    case "AUSENTE":
      return {
        background: "rgba(99, 102, 113, 0.14)",
        color: "var(--rr-muted)",
      };
  }
}

const styles: Record<string, CSSProperties> = {
  container: {
    display: "grid",
    gap: "12px",
  },
  pillRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
  },
  pill: {
    border: "1px solid rgba(13,77,227,0.16)",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.92)",
    color: "var(--rr-blue-deep)",
    padding: "8px 14px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  pillActive: {
    background:
      "linear-gradient(135deg, rgba(13,77,227,0.98) 0%, rgba(7,37,125,0.98) 100%)",
    color: "#ffffff",
    border: "1px solid rgba(13,77,227,0.98)",
  },
  counter: {
    marginLeft: "auto",
    fontSize: "12px",
    color: "var(--rr-muted)",
    fontWeight: 600,
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid var(--rr-line)",
    borderRadius: "16px",
    background: "rgba(255,255,255,0.96)",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
  },
  th: {
    textAlign: "left",
    padding: "12px 14px",
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--rr-blue)",
    borderBottom: "1px solid var(--rr-line)",
    fontWeight: 800,
    whiteSpace: "nowrap",
    background: "rgba(255,255,255,0.98)",
  },
  thRight: {
    textAlign: "right",
    padding: "12px 14px",
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--rr-blue)",
    borderBottom: "1px solid var(--rr-line)",
    fontWeight: 800,
    whiteSpace: "nowrap",
    background: "rgba(255,255,255,0.98)",
  },
  td: {
    padding: "10px 14px",
    fontSize: "13px",
    color: "var(--rr-ink)",
    borderBottom: "1px solid rgba(13,77,227,0.06)",
    whiteSpace: "nowrap",
  },
  tdRight: {
    padding: "10px 14px",
    fontSize: "13px",
    color: "var(--rr-ink)",
    borderBottom: "1px solid rgba(13,77,227,0.06)",
    whiteSpace: "nowrap",
    textAlign: "right",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  footerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px 14px",
    border: "1px solid var(--rr-line)",
    borderRadius: "14px",
    background: "rgba(13,77,227,0.04)",
  },
  footerLabel: {
    fontSize: "12px",
    color: "var(--rr-blue)",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
  },
  footerValue: {
    fontSize: "16px",
    color: "var(--rr-ink)",
    fontWeight: 800,
  },
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "10px",
  },
  pageButton: {
    border: "1px solid var(--rr-line-strong)",
    background: "rgba(255,255,255,0.94)",
    color: "var(--rr-blue-deep)",
    padding: "8px 14px",
    borderRadius: "12px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  pageButtonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  pageLabel: {
    fontSize: "12px",
    color: "var(--rr-muted)",
    fontWeight: 600,
  },
};
