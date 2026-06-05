"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import FeedbackBanner from "../../components/FeedbackBanner";
import { useUser } from "../../lib/auth/useUser";

type MetaRow = {
  promoter_id: string;
  promoter_name: string;
  company_id: string | null;
  company_name: string;
  company_cnpj: string;
  estado: string;
  meta: number;
  bonus1: number;
  bonus2: number;
  production: number;
  falta_meta: number;
  faixa: "BASE" | "META1" | "META2";
  pct_vigente: number | null;
  pct_base: number | null;
  pct_meta1: number | null;
  pct_meta2: number | null;
  has_repasse: boolean;
};

type CompanyOption = { id: string; name: string; cnpj: string; estado: string };

type PeriodOption = { key: string; label: string; year: number; month: number };

const MONTHS_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function buildPeriods(): PeriodOption[] {
  const now = new Date();
  const out: PeriodOption[] = [];
  for (let i = 0; i < 15; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    out.push({
      key: `${year}-${String(month).padStart(2, "0")}`,
      label: `${MONTHS_PT[month - 1]}/${year}`,
      year,
      month,
    });
  }
  return out;
}

function brl(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  });
}

function pctLabel(fraction: number | null): string {
  if (fraction == null) return "—";
  return `${(fraction * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

const FAIXA_LABEL: Record<string, string> = {
  BASE: "Base",
  META1: "Meta 1",
  META2: "Meta 2",
};

type Draft = {
  meta: string;
  bonus1: string;
  bonus2: string;
  pct_base: string;
  pct_meta1: string;
  pct_meta2: string;
};

function rowToDraft(r: MetaRow): Draft {
  const pp = (f: number | null) => (f == null ? "" : String(+(f * 100).toFixed(4)));
  return {
    meta: r.meta ? String(r.meta) : "",
    bonus1: r.bonus1 ? String(r.bonus1) : "",
    bonus2: r.bonus2 ? String(r.bonus2) : "",
    pct_base: pp(r.pct_base),
    pct_meta1: pp(r.pct_meta1),
    pct_meta2: pp(r.pct_meta2),
  };
}

export default function MetasPage() {
  const { user, loading: userLoading } = useUser();
  const periods = useMemo(buildPeriods, []);
  const [selectedKey, setSelectedKey] = useState(periods[0].key);
  const [companyId, setCompanyId] = useState("");
  const [rows, setRows] = useState<MetaRow[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; msg: string } | null>(null);

  const period = periods.find((p) => p.key === selectedKey) ?? periods[0];
  const canEdit = user?.role === "socio" || user?.role === "funcionario";

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const params = new URLSearchParams({
        year: String(period.year),
        month: String(period.month),
      });
      if (companyId) params.set("companyId", companyId);
      const res = await fetch(`/api/metas?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Falha ao carregar.");
      setRows(json.rows || []);
      setCompanies(json.companies || []);
      const d: Record<string, Draft> = {};
      for (const r of json.rows || []) d[r.promoter_id] = rowToDraft(r);
      setDrafts(d);
    } catch (e: any) {
      setFeedback({ kind: "error", msg: e?.message || "Erro ao carregar metas." });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [period.year, period.month, companyId]);

  useEffect(() => {
    if (canEdit) load();
  }, [canEdit, load]);

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function saveRow(r: MetaRow) {
    const d = drafts[r.promoter_id];
    if (!d) return;
    setSavingId(r.promoter_id);
    setFeedback(null);
    try {
      const num = (s: string) => Number(String(s).replace(",", ".")) || 0;
      const pctOrNull = (s: string) =>
        s === "" || s == null ? null : num(s) / 100;

      const metaRes = await fetch("/api/metas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "meta_upsert",
          promoterId: r.promoter_id,
          companyId: r.company_id,
          year: period.year,
          month: period.month,
          meta: num(d.meta),
          bonus1: num(d.bonus1),
          bonus2: num(d.bonus2),
        }),
      });
      if (!metaRes.ok) throw new Error((await metaRes.json())?.error || "Falha ao salvar metas.");

      if (d.pct_base !== "") {
        const repRes = await fetch("/api/metas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "repasse_upsert",
            promoterId: r.promoter_id,
            year: period.year,
            month: period.month,
            pct_base: num(d.pct_base) / 100,
            pct_meta1: pctOrNull(d.pct_meta1),
            pct_meta2: pctOrNull(d.pct_meta2),
          }),
        });
        if (!repRes.ok) throw new Error((await repRes.json())?.error || "Falha ao salvar escala.");
      }

      setFeedback({ kind: "success", msg: `Salvo: ${r.promoter_name}.` });
      await load();
    } catch (e: any) {
      setFeedback({ kind: "error", msg: e?.message || "Erro ao salvar." });
    } finally {
      setSavingId(null);
    }
  }

  if (userLoading) return <div style={styles.note}>Carregando…</div>;
  if (!canEdit)
    return (
      <div style={styles.note}>
        Acesso restrito a sócios e funcionários.
      </div>
    );

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Comercial</div>
          <h2 style={styles.title}>Metas &amp; repasse escalonado</h2>
        </div>
        <div style={styles.chip}>{period.label}</div>
      </div>

      {feedback ? (
        <FeedbackBanner variant={feedback.kind} title={feedback.msg} />
      ) : null}

      <div style={styles.filters}>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>Competência</span>
          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            style={styles.input}
          >
            {periods.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>Empresa / CNPJ</span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            style={styles.input}
          >
            <option value="">Todas</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.estado} · {c.name} · {c.cnpj}
              </option>
            ))}
          </select>
        </label>
        <div style={{ alignSelf: "flex-end" }}>
          <button type="button" onClick={load} style={styles.secondaryBtn} disabled={loading}>
            {loading ? "Atualizando…" : "Atualizar"}
          </button>
        </div>
      </div>

      <div
        className={`rr-table-wrap${rows.length > 15 ? " rr-table-wrap--scrollable" : ""}`}
      >
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Promotor</th>
              <th style={styles.th}>Estado</th>
              <th style={styles.thNum}>META</th>
              <th style={styles.thNum}>BÔNUS1</th>
              <th style={styles.thNum}>BÔNUS2</th>
              <th style={styles.thNum}>Produção atual</th>
              <th style={styles.thNum}>Falta p/ meta</th>
              <th style={styles.th}>Faixa</th>
              <th style={styles.thNum}>% Base</th>
              <th style={styles.thNum}>% Meta1</th>
              <th style={styles.thNum}>% Meta2</th>
              <th style={styles.thNum}>% Vigente</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={13} style={styles.empty}>
                  Sem metas para esta competência.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => {
              const d = drafts[r.promoter_id];
              if (!d) return null;
              return (
                <tr key={r.promoter_id}>
                  <td style={styles.td}>{r.promoter_name}</td>
                  <td style={styles.td}>{r.estado}</td>
                  <td style={styles.tdNum}>
                    <input
                      style={styles.cellInput}
                      value={d.meta}
                      onChange={(e) => setDraft(r.promoter_id, { meta: e.target.value })}
                      inputMode="decimal"
                    />
                  </td>
                  <td style={styles.tdNum}>
                    <input
                      style={styles.cellInput}
                      value={d.bonus1}
                      onChange={(e) => setDraft(r.promoter_id, { bonus1: e.target.value })}
                      inputMode="decimal"
                    />
                  </td>
                  <td style={styles.tdNum}>
                    <input
                      style={styles.cellInput}
                      value={d.bonus2}
                      onChange={(e) => setDraft(r.promoter_id, { bonus2: e.target.value })}
                      inputMode="decimal"
                    />
                  </td>
                  <td style={styles.tdNum}>{brl(r.production)}</td>
                  <td style={{ ...styles.tdNum, fontWeight: 700 }}>{brl(r.falta_meta)}</td>
                  <td style={styles.td}>
                    <span
                      style={{
                        ...styles.badge,
                        ...(r.faixa === "META2"
                          ? styles.badgeGold
                          : r.faixa === "META1"
                          ? styles.badgeYellow
                          : styles.badgeBase),
                      }}
                    >
                      {FAIXA_LABEL[r.faixa]}
                    </span>
                  </td>
                  <td style={styles.tdNum}>
                    <input
                      style={styles.cellInputPct}
                      value={d.pct_base}
                      onChange={(e) => setDraft(r.promoter_id, { pct_base: e.target.value })}
                      inputMode="decimal"
                      placeholder="%"
                    />
                  </td>
                  <td style={styles.tdNum}>
                    <input
                      style={styles.cellInputPct}
                      value={d.pct_meta1}
                      onChange={(e) => setDraft(r.promoter_id, { pct_meta1: e.target.value })}
                      inputMode="decimal"
                      placeholder="%"
                    />
                  </td>
                  <td style={styles.tdNum}>
                    <input
                      style={styles.cellInputPct}
                      value={d.pct_meta2}
                      onChange={(e) => setDraft(r.promoter_id, { pct_meta2: e.target.value })}
                      inputMode="decimal"
                      placeholder="%"
                    />
                  </td>
                  <td style={{ ...styles.tdNum, fontWeight: 700, color: "var(--rr-navy)" }}>
                    {pctLabel(r.pct_vigente)}
                  </td>
                  <td style={styles.td}>
                    <button
                      type="button"
                      style={styles.saveBtn}
                      disabled={savingId === r.promoter_id}
                      onClick={() => saveRow(r)}
                    >
                      {savingId === r.promoter_id ? "…" : "Salvar"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={styles.footnote}>
        Os % são repasse ao promotor na faixa 5,80% empresa. Produção e faixa vêm
        do último recálculo. Edite metas (R$) e os 3 % e clique em Salvar.
      </p>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { display: "flex", flexDirection: "column", gap: 16 },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  kicker: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--rr-gold)",
  },
  title: { margin: 0, fontSize: 22, color: "var(--rr-navy)", fontWeight: 800 },
  chip: {
    padding: "6px 14px",
    borderRadius: 999,
    background: "var(--rr-navy)",
    color: "#fff000",
    fontSize: 13,
    fontWeight: 700,
  },
  filters: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    alignItems: "flex-end",
    padding: 16,
    background: "var(--rr-panel)",
    border: "1px solid var(--rr-line)",
    borderRadius: 12,
  },
  field: { display: "flex", flexDirection: "column", gap: 6, minWidth: 200 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--rr-muted)",
  },
  input: {
    height: 38,
    padding: "0 10px",
    borderRadius: 8,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-navy)",
    fontSize: 14,
  },
  secondaryBtn: {
    height: 38,
    padding: "0 16px",
    borderRadius: 8,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-navy)",
    fontWeight: 600,
    cursor: "pointer",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1100 },
  th: {
    textAlign: "left",
    padding: "10px 10px",
    color: "var(--rr-navy)",
    fontWeight: 700,
    borderBottom: "1px solid var(--rr-line)",
    whiteSpace: "nowrap",
  },
  thNum: {
    textAlign: "right",
    padding: "10px 10px",
    color: "var(--rr-navy)",
    fontWeight: 700,
    borderBottom: "1px solid var(--rr-line)",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "8px 10px",
    borderBottom: "1px solid var(--rr-line)",
    color: "var(--rr-navy)",
    whiteSpace: "nowrap",
  },
  tdNum: {
    padding: "8px 10px",
    borderBottom: "1px solid var(--rr-line)",
    color: "var(--rr-navy)",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  cellInput: {
    width: 110,
    height: 32,
    padding: "0 8px",
    textAlign: "right",
    borderRadius: 6,
    border: "1px solid var(--rr-line-strong)",
    fontSize: 13,
  },
  cellInputPct: {
    width: 78,
    height: 32,
    padding: "0 8px",
    textAlign: "right",
    borderRadius: 6,
    border: "1px solid var(--rr-line-strong)",
    fontSize: 13,
  },
  badge: {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
  },
  badgeBase: { background: "#EEF2F8", color: "var(--rr-muted)" },
  badgeYellow: { background: "var(--rr-yellow-soft)", color: "var(--rr-gold-deep)" },
  badgeGold: { background: "var(--rr-gold-soft)", color: "var(--rr-gold-deep)" },
  saveBtn: {
    height: 30,
    padding: "0 14px",
    borderRadius: 7,
    border: "none",
    background: "var(--rr-navy)",
    color: "#fff000",
    fontWeight: 700,
    cursor: "pointer",
  },
  empty: { padding: 24, textAlign: "center", color: "var(--rr-muted)" },
  note: { padding: 24, color: "var(--rr-muted)" },
  footnote: { fontSize: 12, color: "var(--rr-muted)", margin: 0 },
};
