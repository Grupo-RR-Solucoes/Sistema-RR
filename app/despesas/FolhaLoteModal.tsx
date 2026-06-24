"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { CategoryOption, CompanyOption } from "./DespesasList";

interface Props {
  companies: CompanyOption[];
  categories: CategoryOption[];
  onClose: () => void;
  onSuccess: (message: string) => void | Promise<void>;
}

const MES_LABEL = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

// Colunas da folha, na ordem. Casa por NOME (ignora caixa/acento).
const COLS: Array<{ key: string; label: string; re: RegExp }> = [
  { key: "folha", label: "Folha CLT", re: /folha/i },
  { key: "prolabore", label: "Pró-labore", re: /pr[oó].?labore/i },
  { key: "fgts", label: "FGTS", re: /fgts/i },
];

function fmtBR(raw: string): string {
  const d = String(raw).replace(/\D/g, "");
  if (!d) return "";
  let n = d.replace(/^0+(?=\d)/, "");
  while (n.length < 3) n = "0" + n;
  const c = n.slice(-2);
  const i = n.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return i + "," + c;
}
function parseBR(str: string): number {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/\./g, "").replace(",", ".")) || 0;
  return Math.round(n * 100) / 100;
}
function brl(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
}
function ymIndex(y: number, m: number): number {
  return y * 12 + (m - 1);
}

export default function FolhaLoteModal({ companies, categories, onClose, onSuccess }: Props) {
  const now = new Date();
  const [companyId, setCompanyId] = useState<string>(companies[0]?.id ?? "");
  // janela default: 12 meses terminando no mês corrente.
  const ini = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const [deYear, setDeYear] = useState(ini.getUTCFullYear());
  const [deMonth, setDeMonth] = useState(ini.getUTCMonth() + 1);
  const [ateYear, setAteYear] = useState(now.getUTCFullYear());
  const [ateMonth, setAteMonth] = useState(now.getUTCMonth() + 1);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !submitting) onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  // colunas presentes (só categorias que existem em expense_categories).
  const cols = useMemo(
    () =>
      COLS.map((c) => {
        const cat = categories.find((k) => c.re.test(String(k.name ?? "")));
        return cat ? { ...c, categoryId: cat.id, catName: cat.name } : null;
      }).filter(Boolean) as Array<{ key: string; label: string; categoryId: string; catName: string }>,
    [categories],
  );

  // meses do intervalo (de..até inclusivo).
  const meses = useMemo(() => {
    const a = ymIndex(deYear, deMonth);
    const b = ymIndex(ateYear, ateMonth);
    const out: Array<{ year: number; month: number; key: string }> = [];
    if (b < a) return out;
    for (let i = a; i <= b && out.length <= 36; i++) {
      const year = Math.floor(i / 12);
      const month = (i % 12) + 1;
      out.push({ year, month, key: `${year}-${month}` });
    }
    return out;
  }, [deYear, deMonth, ateYear, ateMonth]);

  const cellKey = (y: number, m: number, catId: string) => `${y}-${m}::${catId}`;
  const setCell = (y: number, m: number, catId: string, v: string) =>
    setValues((prev) => ({ ...prev, [cellKey(y, m, catId)]: fmtBR(v) }));

  // totais por coluna + total geral (só p/ feedback visual).
  const totaisCol = useMemo(() => {
    const t: Record<string, number> = {};
    let geral = 0;
    for (const c of cols) {
      let s = 0;
      for (const mo of meses) s += parseBR(values[cellKey(mo.year, mo.month, c.categoryId)] ?? "");
      t[c.categoryId] = s;
      geral += s;
    }
    return { t, geral };
  }, [values, cols, meses]);

  const nLancamentos = useMemo(() => {
    let n = 0;
    for (const mo of meses) for (const c of cols) if (parseBR(values[cellKey(mo.year, mo.month, c.categoryId)] ?? "") > 0) n++;
    return n;
  }, [values, cols, meses]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!companyId) { setError("Selecione a empresa."); return; }
    if (meses.length === 0) { setError("Intervalo inválido (de > até)."); return; }
    const cells: Array<{ year: number; month: number; categoryId: string; amount: number }> = [];
    for (const mo of meses) {
      for (const c of cols) {
        const amount = parseBR(values[cellKey(mo.year, mo.month, c.categoryId)] ?? "");
        if (amount > 0) cells.push({ year: mo.year, month: mo.month, categoryId: c.categoryId, amount });
      }
    }
    if (cells.length === 0) { setError("Nenhum valor preenchido (> 0)."); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/financeiro", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "folha_lote", companyId, cells }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setError(out.error ?? "Falha ao salvar folha em lote"); return; }
      await onSuccess(`Folha gravada: ${out.created ?? 0} criados, ${out.updated ?? 0} atualizados.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="overlay open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="folhaLoteTitle"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="modal modal-lote" data-screen-label="modal-folha-lote">
        <div className="modal-head">
          <div>
            <p className="mt">FOLHA EM LOTE</p>
            <h2 id="folhaLoteTitle">Lançar folha por CNPJ</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} disabled={submitting} aria-label="Fechar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            <div className="lote-controls">
              <div className="mfld mfld-emp">
                <label htmlFor="loteEmp">Empresa <span className="req">*</span></label>
                <div className="mctrl">
                  <select id="loteEmp" value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={submitting}>
                    <option value="">Selecione…</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <span className="chev">▾</span>
                </div>
              </div>
              <div className="mfld">
                <label>De (mês/ano) <span className="req">*</span></label>
                <div className="lote-range">
                  <div className="mctrl mes"><select value={deMonth} onChange={(e) => setDeMonth(Number(e.target.value))} disabled={submitting}>{MES_LABEL.map((l, i) => <option key={i} value={i + 1}>{l}</option>)}</select><span className="chev">▾</span></div>
                  <div className="mctrl ano"><select value={deYear} onChange={(e) => setDeYear(Number(e.target.value))} disabled={submitting}>{YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}</select><span className="chev">▾</span></div>
                </div>
              </div>
              <div className="mfld">
                <label>Até (mês/ano) <span className="req">*</span></label>
                <div className="lote-range">
                  <div className="mctrl mes"><select value={ateMonth} onChange={(e) => setAteMonth(Number(e.target.value))} disabled={submitting}>{MES_LABEL.map((l, i) => <option key={i} value={i + 1}>{l}</option>)}</select><span className="chev">▾</span></div>
                  <div className="mctrl ano"><select value={ateYear} onChange={(e) => setAteYear(Number(e.target.value))} disabled={submitting}>{YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}</select><span className="chev">▾</span></div>
                </div>
              </div>
            </div>

            <p className="mhint">Preencha só os meses/categorias com valor. Em branco ou R$0 é ignorado (não cria lançamento). Reenviar a mesma competência atualiza o valor — não duplica.</p>

            {cols.length === 0 ? (
              <div className="modal-error" role="alert">Nenhuma categoria de folha (Folha/Pró-labore/FGTS) encontrada.</div>
            ) : meses.length === 0 ? (
              <div className="modal-error" role="alert">Intervalo inválido: &quot;de&quot; é depois de &quot;até&quot;.</div>
            ) : (
              <div className="lote-grid-wrap">
                <table className="lote-grid">
                  <thead>
                    <tr>
                      <th className="mcol">Competência</th>
                      {cols.map((c) => <th key={c.key}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {meses.map((mo) => (
                      <tr key={mo.key}>
                        <td className="mcol">{MES_LABEL[mo.month - 1]}/{mo.year}</td>
                        {cols.map((c) => (
                          <td key={c.key}>
                            <div className="cellctrl">
                              <span className="pre">R$</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={values[cellKey(mo.year, mo.month, c.categoryId)] ?? ""}
                                onChange={(e) => setCell(mo.year, mo.month, c.categoryId, e.target.value)}
                                disabled={submitting}
                                placeholder="0,00"
                                aria-label={`${c.label} ${MES_LABEL[mo.month - 1]}/${mo.year}`}
                              />
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="mcol">Total</td>
                      {cols.map((c) => <td key={c.key} className="tot num">{brl(totaisCol.t[c.categoryId] ?? 0)}</td>)}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {error ? <div role="alert" className="modal-error">{error}</div> : null}
          </div>

          <div className="modal-foot">
            <span className="lote-resumo">{nLancamentos} lançamento(s) · total {brl(totaisCol.geral)}</span>
            <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="submit" className="btn-save" disabled={submitting || nLancamentos === 0}>
              {submitting ? "Salvando…" : "Salvar folha"} <span className="ck">✓</span>
            </button>
          </div>
        </form>
      </div>

      <style dangerouslySetInnerHTML={{ __html: LOTE_CSS }} />
    </div>
  );
}

const LOTE_CSS = `
.modal-lote{max-width:820px;width:96vw;}
.lote-controls{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;margin-bottom:6px;}
.lote-controls .mfld-emp{grid-column:1 / -1;}
.lote-range{display:flex;gap:10px;}
.lote-range .mctrl{flex:1 1 0;}
.lote-range .mctrl.mes{flex:1 1 96px;min-width:96px;}
.lote-range .mctrl.ano{flex:0 0 104px;min-width:104px;}
.lote-range .mctrl select{min-width:0;}
.lote-grid-wrap{margin-top:12px;border:1px solid var(--bd,#E4E7EC);border-radius:12px;overflow:auto;max-height:46vh;}
.lote-grid{width:100%;border-collapse:collapse;font-size:13px;}
.lote-grid thead th{position:sticky;top:0;background:var(--neu,#F1F3F7);color:var(--ink-2,#4B5468);text-transform:uppercase;font-size:11px;letter-spacing:.04em;font-weight:600;text-align:right;padding:9px 12px;border-bottom:1px solid var(--bd,#E4E7EC);white-space:nowrap;}
.lote-grid thead th.mcol{text-align:left;}
.lote-grid td{padding:5px 8px;border-bottom:1px solid var(--bd-soft,#EEF0F4);}
.lote-grid td.mcol{font-weight:600;color:var(--ink,#16203A);white-space:nowrap;}
.lote-grid tbody tr:nth-child(even){background:var(--neu,#F7F8FA);}
.lote-grid .cellctrl{display:flex;align-items:center;gap:4px;justify-content:flex-end;}
.lote-grid .cellctrl .pre{font-size:11px;color:var(--ink-3,#838B9C);}
.lote-grid .cellctrl input{width:96px;text-align:right;border:1px solid var(--bd,#E4E7EC);border-radius:7px;padding:6px 8px;font-family:inherit;font-size:13px;font-variant-numeric:tabular-nums;}
.lote-grid .cellctrl input:focus{outline:none;border-color:var(--navy,#0F1F4A);}
.lote-grid tfoot td{padding:9px 12px;border-top:2px solid var(--accent,#FFF000);background:var(--paper,#fff);font-weight:700;}
.lote-grid tfoot td.tot{text-align:right;font-variant-numeric:tabular-nums;}
.lote-resumo{margin-right:auto;font-size:12.5px;color:var(--ink-2,#4B5468);}
@media (max-width:720px){ .lote-controls{grid-template-columns:1fr;} }
`;
