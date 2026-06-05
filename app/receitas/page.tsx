"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import FeedbackBanner from "../../components/FeedbackBanner";
import { useUser } from "../../lib/auth/useUser";

// ---- tipos espelham lib/rbt12.ts ----
type SerieMes = { competencia: string; fechamento: number; manual: number; total: number; fonteFechamento: string | null };
type Empresa = {
  company_id: string; cnpj: string; name: string; group_code: string | null;
  rbt12: number; faixa: number | null; aliquota: number | null; acimaSimples: boolean;
  tetoFaixaAtual: number | null; faltaProxima: number; pctFaltaTeto: number;
  sinal: "verde" | "amarelo" | "acima";
  mesesEsperados: number; mesesPresentes: number; janelaParcial: boolean; mesesFaltando: string[];
  serie: SerieMes[]; totalFechamento: number; totalManual: number;
};
type Rbt12Payload = {
  referencia: { ano: number; mes: number; key: string };
  referenciaProducao: { ano: number; mes: number; key: string };
  competenciaTipo: string;
  janela: { de: string; ate: string; meses: number };
  empresas: Empresa[];
  grupo: { rbt12: number; limiteSimples: number; pctLimite: number; faltaLimite: number; sinal: "verde" | "amarelo" | "vermelho" };
};
type Lancamento = { id: string; company_id: string; ano: number; mes: number; categoria: string; valor: number; descricao: string | null };
type CompanyOpt = { id: string; name: string; cnpj: string; group_code: string | null };

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const CATEGORIAS = ["CONSORCIO", "AJUSTE_CONTADOR", "OUTRO"];
const CAT_LABEL: Record<string, string> = { CONSORCIO: "Consórcio", AJUSTE_CONTADOR: "Ajuste contador", OUTRO: "Outro" };

function brl(v: number) { return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function compLabel(key: string) { const [y, m] = key.split("-"); return `${MONTHS_PT[Number(m) - 1]}/${y}`; }
// produção correspondente a uma competência fiscal (fiscal - 1 mês).
function prodLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y;
  return `${MONTHS_PT[pm - 1]}/${py}`;
}

// Períodos do seletor são competências FISCAIS (recebimento). 15 meses a partir
// de jun/2026 (fiscal) = produção de maio/2026 (último arquivo).
function buildPeriods() {
  const out: { key: string; label: string; ano: number; mes: number }[] = [];
  let y = 2026, m = 6;
  for (let i = 0; i < 15; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ key, label: `${MONTHS_PT[m - 1]}/${y} (prod. ${prodLabel(key)})`, ano: y, mes: m });
    m--; if (m === 0) { m = 12; y--; }
  }
  return out;
}

export default function ReceitasPage() {
  const { user, loading: userLoading } = useUser();
  const periods = useMemo(buildPeriods, []);
  const [refKey, setRefKey] = useState("2026-06");
  const [rbt12, setRbt12] = useState<Rbt12Payload | null>(null);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; msg: string } | null>(null);

  // form de lancamento
  const emptyForm = { id: "", company_id: "", ano: "2026", mes: "5", categoria: "CONSORCIO", valor: "", descricao: "" };
  const [form, setForm] = useState({ ...emptyForm });

  const period = periods.find((p) => p.key === refKey) ?? periods[1];
  const canEdit = user?.role === "socio" || user?.role === "funcionario";

  const load = useCallback(async () => {
    setLoading(true); setFeedback(null);
    try {
      const [rRes, lRes] = await Promise.all([
        fetch(`/api/rbt12?ano=${period.ano}&mes=${period.mes}`),
        fetch(`/api/receita-lancamentos`),
      ]);
      const rJson = await rRes.json();
      if (!rRes.ok) throw new Error(rJson?.error || "Falha ao calcular RBT12.");
      setRbt12(rJson);
      const lJson = await lRes.json();
      if (lRes.ok) { setLancamentos(lJson.lancamentos || []); setCompanies(lJson.companies || []); }
    } catch (e: any) {
      setFeedback({ kind: "error", msg: e?.message || "Erro ao carregar." });
    } finally { setLoading(false); }
  }, [period.ano, period.mes]);

  useEffect(() => { if (canEdit) load(); }, [canEdit, load]);

  async function salvarLancamento() {
    if (!form.company_id) { setFeedback({ kind: "error", msg: "Escolha a empresa." }); return; }
    setFeedback(null);
    try {
      const isEdit = !!form.id;
      const res = await fetch("/api/receita-lancamentos", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id || undefined,
          company_id: form.company_id, ano: Number(form.ano), mes: Number(form.mes),
          categoria: form.categoria, valor: form.valor, descricao: form.descricao,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Falha ao salvar.");
      setFeedback({ kind: "success", msg: isEdit ? "Lançamento atualizado." : "Lançamento criado." });
      setForm({ ...emptyForm, company_id: form.company_id, ano: form.ano, mes: form.mes });
      await load();
    } catch (e: any) { setFeedback({ kind: "error", msg: e?.message || "Erro ao salvar." }); }
  }

  async function excluir(id: string) {
    setFeedback(null);
    try {
      const res = await fetch(`/api/receita-lancamentos?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Falha ao excluir.");
      setFeedback({ kind: "success", msg: "Lançamento excluído." });
      await load();
    } catch (e: any) { setFeedback({ kind: "error", msg: e?.message || "Erro ao excluir." }); }
  }

  function editar(l: Lancamento) {
    setForm({ id: l.id, company_id: l.company_id, ano: String(l.ano), mes: String(l.mes), categoria: l.categoria, valor: String(l.valor), descricao: l.descricao || "" });
  }

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || id;

  if (userLoading) return <div style={styles.note}>Carregando…</div>;
  if (!canEdit) return <div style={styles.note}>Acesso restrito a sócios e funcionários.</div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Controle · Simples Nacional (Anexo III)</div>
          <h2 style={styles.title}>Receita &amp; RBT12 por CNPJ</h2>
        </div>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>Competência fiscal (recebimento)</span>
          <select value={refKey} onChange={(e) => setRefKey(e.target.value)} style={styles.input}>
            {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
      </div>

      {feedback ? <FeedbackBanner variant={feedback.kind} title={feedback.msg} /> : null}
      {rbt12 ? (
        <div style={styles.fiscalBanner}>
          <strong>Competência FISCAL (regime de caixa): {compLabel(rbt12.referencia.key)}</strong> — corresponde à produção de {compLabel(rbt12.referenciaProducao.key)}.
          {" "}Janela 12m fiscal: {compLabel(rbt12.janela.de)} → {compLabel(rbt12.janela.ate)}. Receita = fechamento (mês de produção, deslocado +1 mês) + lançamentos manuais (já em competência fiscal).
          {" "}⚠ O Dashboard é por <em>produção</em> — os meses não batem 1:1, e isso é esperado (não é divergência).
        </div>
      ) : null}

      {/* ---- Cards RBT12 ---- */}
      <div style={styles.cardsGrid}>
        {(rbt12?.empresas || []).map((e) => {
          const cor = e.sinal === "acima" ? "#cc2b49" : e.sinal === "amarelo" ? "var(--rr-gold)" : "#178a5a";
          const open = expanded === e.company_id;
          return (
            <div key={e.company_id} style={{ ...styles.card, borderTop: `4px solid ${cor}` }}>
              <div style={styles.cardTop}>
                <div>
                  <div style={styles.cardName}>{e.name}</div>
                  <div style={styles.cardCnpj}>{e.cnpj}</div>
                </div>
                <span style={{ ...styles.faixaPill, background: cor }}>
                  {e.acimaSimples ? "ACIMA" : `Faixa ${e.faixa}`}
                </span>
              </div>
              <div style={styles.rbtValue}>{brl(e.rbt12)}</div>
              <div style={styles.cardMeta}>
                RBT12 · alíquota {e.aliquota != null ? `${(e.aliquota * 100).toFixed(2)}%` : "—"}
              </div>
              <div style={styles.cardRow}><span>Fechamento</span><span>{brl(e.totalFechamento)}</span></div>
              <div style={styles.cardRow}><span>Manual</span><span>{brl(e.totalManual)}</span></div>
              <div style={styles.cardRow}>
                <span>Falta p/ próxima</span>
                <span style={{ fontWeight: 700 }}>{e.acimaSimples ? "—" : `${brl(e.faltaProxima)} (${(e.pctFaltaTeto * 100).toFixed(1)}%)`}</span>
              </div>
              {e.janelaParcial ? (
                <div style={styles.parcial}>⚠ Janela parcial: {e.mesesPresentes}/{e.mesesEsperados} meses (falta {e.mesesFaltando.map(compLabel).join(", ")})</div>
              ) : null}
              <button type="button" style={styles.expandBtn} onClick={() => setExpanded(open ? null : e.company_id)}>
                {open ? "Ocultar série" : "Ver série mensal"}
              </button>
              {open ? (
                <table style={styles.serieTable}>
                  <thead><tr><th style={styles.sTh}>Mês fiscal</th><th style={styles.sThNum}>Fechamento</th><th style={styles.sThNum}>Manual</th><th style={styles.sThNum}>Total</th></tr></thead>
                  <tbody>
                    {e.serie.map((s) => (
                      <tr key={s.competencia}>
                        <td style={styles.sTd}>{compLabel(s.competencia)}{s.fonteFechamento === "temp" ? " ·T" : ""}</td>
                        <td style={styles.sTdNum}>{brl(s.fechamento)}</td>
                        <td style={styles.sTdNum}>{s.manual ? brl(s.manual) : "—"}</td>
                        <td style={{ ...styles.sTdNum, fontWeight: 700 }}>{brl(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          );
        })}
        {rbt12 ? (() => {
          const g = rbt12.grupo;
          const cor = g.sinal === "vermelho" ? "#cc2b49" : g.sinal === "amarelo" ? "var(--rr-gold)" : "#178a5a";
          return (
            <div style={{ ...styles.card, borderTop: `4px solid ${cor}`, background: "#f7f9fc" }}>
              <div style={styles.cardName}>GRUPO — limite do Simples</div>
              <div style={styles.cardCnpj}>receita somada dos 4 CNPJs</div>
              <div style={styles.rbtValue}>{brl(g.rbt12)}</div>
              <div style={styles.cardMeta}>
                <strong style={{ color: cor }}>{(g.pctLimite * 100).toFixed(1)}%</strong> do limite de {brl(g.limiteSimples)}
              </div>
              <div style={styles.cardRow}><span>Falta p/ o teto</span><span style={{ fontWeight: 700 }}>{brl(g.faltaLimite)}</span></div>
              <div style={{ ...styles.parcial, background: g.sinal === "verde" ? "#e6f4ec" : "var(--rr-gold-soft)", color: g.sinal === "vermelho" ? "#cc2b49" : "var(--rr-gold-deep)" }}>
                Monitoramento do <strong>limite de permanência</strong> no Simples (R$ 4,8 MM/ano somados do grupo). Estourar exclui o grupo do regime. <strong>Não é faixa nem base de DAS</strong> — cada CNPJ é tributado pela faixa dele (acima).
              </div>
            </div>
          );
        })() : null}
      </div>

      {/* ---- Lançamentos manuais ---- */}
      <h3 style={styles.sectionTitle}>Lançamentos manuais de receita</h3>
      <div style={styles.formCard}>
        <div style={styles.formGrid}>
          <label style={styles.field}><span style={styles.fieldLabel}>Empresa</span>
            <select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })} style={styles.input}>
              <option value="">Selecione</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.group_code} · {c.name}</option>)}
            </select>
          </label>
          <label style={styles.field}><span style={styles.fieldLabel}>Ano</span>
            <input value={form.ano} onChange={(e) => setForm({ ...form, ano: e.target.value })} style={styles.input} inputMode="numeric" />
          </label>
          <label style={styles.field}><span style={styles.fieldLabel}>Mês (fiscal)</span>
            <select value={form.mes} onChange={(e) => setForm({ ...form, mes: e.target.value })} style={styles.input}>
              {MONTHS_PT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label style={styles.field}><span style={styles.fieldLabel}>Categoria</span>
            <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} style={styles.input}>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select>
          </label>
          <label style={styles.field}><span style={styles.fieldLabel}>Valor (R$)</span>
            <input value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} style={styles.input} inputMode="decimal" placeholder="0,00" />
          </label>
          <label style={{ ...styles.field, minWidth: 240 }}><span style={styles.fieldLabel}>Descrição</span>
            <input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} style={styles.input} placeholder="ex.: consórcio recebido à parte" />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <button type="button" style={styles.primaryBtn} onClick={salvarLancamento}>{form.id ? "Atualizar" : "Lançar"}</button>
            {form.id ? <button type="button" style={styles.secondaryBtn} onClick={() => setForm({ ...emptyForm })}>Cancelar</button> : null}
          </div>
        </div>
      </div>

      <div className={`rr-table-wrap${lancamentos.length > 15 ? " rr-table-wrap--scrollable" : ""}`}>
        <table style={styles.table}>
          <thead><tr>
            <th style={styles.th}>Empresa</th><th style={styles.th}>Competência</th><th style={styles.th}>Categoria</th>
            <th style={styles.thNum}>Valor</th><th style={styles.th}>Descrição</th><th style={styles.th}></th>
          </tr></thead>
          <tbody>
            {lancamentos.length === 0 && !loading ? (
              <tr><td colSpan={6} style={styles.empty}>Nenhum lançamento manual. (Lembre de rodar a migration da tabela.)</td></tr>
            ) : null}
            {lancamentos.map((l) => (
              <tr key={l.id}>
                <td style={styles.td}>{companyName(l.company_id)}</td>
                <td style={styles.td}>{compLabel(`${l.ano}-${String(l.mes).padStart(2, "0")}`)}</td>
                <td style={styles.td}>{CAT_LABEL[l.categoria] || l.categoria}</td>
                <td style={styles.tdNum}>{brl(l.valor)}</td>
                <td style={styles.td}>{l.descricao || "—"}</td>
                <td style={styles.td}>
                  <button type="button" style={styles.linkBtn} onClick={() => editar(l)}>editar</button>
                  <button type="button" style={{ ...styles.linkBtn, color: "#cc2b49" }} onClick={() => excluir(l.id)}>excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { display: "flex", flexDirection: "column", gap: 16 },
  header: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  kicker: { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--rr-gold)" },
  title: { margin: 0, fontSize: 22, color: "var(--rr-navy)", fontWeight: 800 },
  footnote: { fontSize: 12, color: "var(--rr-muted)", margin: 0 },
  fiscalBanner: { fontSize: 13, color: "var(--rr-navy)", background: "var(--rr-yellow-soft)", border: "1px solid var(--rr-gold)", borderRadius: 10, padding: "10px 14px", lineHeight: 1.5 },
  cardsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 },
  card: { background: "var(--rr-panel)", border: "1px solid var(--rr-line)", borderRadius: 12, padding: 16, boxShadow: "var(--rr-shadow-soft)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  cardName: { fontWeight: 800, color: "var(--rr-navy)", fontSize: 15 },
  cardCnpj: { fontSize: 12, color: "var(--rr-muted)" },
  faixaPill: { color: "#fff", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" },
  rbtValue: { fontSize: 26, fontWeight: 800, color: "var(--rr-navy)", marginTop: 10 },
  cardMeta: { fontSize: 12, color: "var(--rr-muted)", marginBottom: 8 },
  cardRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--rr-navy)", padding: "2px 0" },
  parcial: { marginTop: 8, fontSize: 12, color: "var(--rr-gold-deep)", background: "var(--rr-gold-soft)", borderRadius: 8, padding: "6px 8px" },
  expandBtn: { marginTop: 10, width: "100%", height: 30, borderRadius: 7, border: "1px solid var(--rr-line-strong)", background: "#fff", color: "var(--rr-navy)", fontWeight: 600, cursor: "pointer" },
  serieTable: { width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 12 },
  sTh: { textAlign: "left", padding: "4px 6px", color: "var(--rr-muted)", borderBottom: "1px solid var(--rr-line)" },
  sThNum: { textAlign: "right", padding: "4px 6px", color: "var(--rr-muted)", borderBottom: "1px solid var(--rr-line)" },
  sTd: { padding: "3px 6px", color: "var(--rr-navy)" },
  sTdNum: { padding: "3px 6px", color: "var(--rr-navy)", textAlign: "right" },
  sectionTitle: { margin: "8px 0 0", fontSize: 17, color: "var(--rr-navy)", fontWeight: 800 },
  formCard: { background: "var(--rr-panel)", border: "1px solid var(--rr-line)", borderRadius: 12, padding: 16 },
  formGrid: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" },
  field: { display: "flex", flexDirection: "column", gap: 6, minWidth: 130 },
  fieldLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--rr-muted)" },
  input: { height: 38, padding: "0 10px", borderRadius: 8, border: "1px solid var(--rr-line-strong)", background: "#fff", color: "var(--rr-navy)", fontSize: 14 },
  primaryBtn: { height: 38, padding: "0 18px", borderRadius: 8, border: "none", background: "var(--rr-navy)", color: "#fff000", fontWeight: 700, cursor: "pointer" },
  secondaryBtn: { height: 38, padding: "0 14px", borderRadius: 8, border: "1px solid var(--rr-line-strong)", background: "#fff", color: "var(--rr-navy)", fontWeight: 600, cursor: "pointer" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 },
  th: { textAlign: "left", padding: "10px", color: "var(--rr-navy)", fontWeight: 700, borderBottom: "1px solid var(--rr-line)", whiteSpace: "nowrap" },
  thNum: { textAlign: "right", padding: "10px", color: "var(--rr-navy)", fontWeight: 700, borderBottom: "1px solid var(--rr-line)" },
  td: { padding: "8px 10px", borderBottom: "1px solid var(--rr-line)", color: "var(--rr-navy)", whiteSpace: "nowrap" },
  tdNum: { padding: "8px 10px", borderBottom: "1px solid var(--rr-line)", color: "var(--rr-navy)", textAlign: "right", whiteSpace: "nowrap" },
  linkBtn: { background: "none", border: "none", color: "var(--rr-blue)", cursor: "pointer", fontWeight: 600, marginRight: 10, padding: 0 },
  empty: { padding: 24, textAlign: "center", color: "var(--rr-muted)" },
  note: { padding: 24, color: "var(--rr-muted)" },
};
