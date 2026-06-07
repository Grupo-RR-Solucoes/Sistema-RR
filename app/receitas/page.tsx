"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

// Etapa 8 (enxugar menu) Fase 3 — Tela B "Receita & Simples" (socio + funcionario):
// RBT12/Simples por CNPJ + entrada de RECEITA COMPLEMENTAR. Reusa /api/rbt12 e
// /api/receita-lancamentos verbatim (zero religação). Sai do conjunto financeiro
// socio-only justamente porque o funcionario opera receita/RBT12.

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

type Empresa = {
  company_id: string;
  cnpj: string;
  name: string;
  rbt12: number;
  faixa: number;
  faltaProxima: number;
  sinal: string;
};
type Grupo = { rbt12: number; limiteSimples: number; pctLimite: number; faltaLimite: number; sinal: string };
type RbtPayload = { referencia: { ano: number; mes: number }; empresas: Empresa[]; grupo: Grupo };

type CompanyOpt = { id: string; name: string; cnpj: string; group_code?: string };
type Lancamento = {
  id: string;
  company_id: string;
  ano: number;
  mes: number;
  categoria: string;
  valor: number;
  descricao: string;
};

const brl = (v: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(v ?? 0));
const mm = (v: number) => `R$ ${(v / 1e6).toFixed(2).replace(".", ",")}MM`;

function buildPeriods() {
  const out: { key: string; label: string; ano: number; mes: number }[] = [];
  const n = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(n.getFullYear(), n.getMonth() - i, 1);
    const ano = d.getFullYear();
    const mes = d.getMonth() + 1;
    out.push({ key: `${ano}-${String(mes).padStart(2, "0")}`, label: `${MESES[mes - 1]}/${ano}`, ano, mes });
  }
  return out;
}
function isClosed(ano: number, mes: number) {
  const n = new Date();
  return ano < n.getFullYear() || (ano === n.getFullYear() && mes < n.getMonth() + 1);
}
// semáforo: verde -> g | amarelo -> a | acima/vermelho -> r
function sem(sinal: string) {
  const s = String(sinal || "").toLowerCase();
  if (s.includes("verm") || s.includes("acima") || s.includes("crit")) return "r";
  if (s.includes("amar") || s.includes("aten")) return "a";
  return "g";
}
const ZONE: Record<string, string> = { g: "Saudável", a: "Atenção", r: "Crítico" };
const CAT_LABEL: Record<string, string> = { CONSORCIO: "Consórcio", AJUSTE_CONTADOR: "Ajuste contador", OUTRO: "Outro" };

export default function ReceitasPage() {
  const periods = useMemo(buildPeriods, []);
  const [selectedKey, setSelectedKey] = useState("");
  const [rbt, setRbt] = useState<RbtPayload | null>(null);
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // form receita complementar
  const [fComp, setFComp] = useState("");
  const [fEmp, setFEmp] = useState("");
  const [fValor, setFValor] = useState("");
  const [fTipo, setFTipo] = useState("CONSORCIO");
  const [fDesc, setFDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const periodKey = selectedKey || periods.find((p) => isClosed(p.ano, p.mes))?.key || periods[0]?.key || "";
  const period = periods.find((p) => p.key === periodKey) || periods[0];

  async function loadAll() {
    try {
      setLoading(true);
      setError("");
      const [rr, rc] = await Promise.all([
        fetch(`/api/rbt12?ano=${period.ano}&mes=${period.mes}`),
        fetch(`/api/receita-lancamentos`),
      ]);
      const rj = await rr.json();
      const cj = await rc.json();
      if (!rr.ok) throw new Error(rj?.error || "Erro ao carregar o RBT12.");
      setRbt(rj as RbtPayload);
      setCompanies((cj.companies || []) as CompanyOpt[]);
      setLancamentos((cj.lancamentos || []) as Lancamento[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey]);

  // defaults do form
  useEffect(() => {
    if (!fComp) setFComp(periodKey);
  }, [periodKey, fComp]);
  useEffect(() => {
    if (!fEmp && companies[0]) setFEmp(companies[0].id);
  }, [companies, fEmp]);

  function onValor(raw: string) {
    const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    if (!digits) {
      setFValor("");
      return;
    }
    const p = digits.padStart(3, "0");
    setFValor(`${p.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${p.slice(-2)}`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // a API parseia valor como STRING BR ("." = milhar, "," = decimal) — manda o
    // valor mascarado tal qual (fValor), NÃO o número JS (senão vira 100x).
    const valorNum = Number(fValor.replace(/\./g, "").replace(",", ".")) || 0;
    if (!valorNum || !fEmp) return;
    const p = periods.find((x) => x.key === fComp) || period;
    try {
      setSaving(true);
      setError("");
      const res = await fetch("/api/receita-lancamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: fEmp,
          ano: p.ano,
          mes: p.mes,
          categoria: fTipo,
          valor: fValor,
          descricao: fDesc.trim() || "Receita complementar",
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Erro ao lançar a receita.");
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
      setFValor("");
      setFDesc("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remover este lançamento de receita complementar?")) return;
    try {
      const res = await fetch(`/api/receita-lancamentos?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao remover.");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover.");
    }
  }

  const compName = (id: string) => companies.find((c) => c.id === id)?.name || "—";
  const lblOf = (l: Lancamento) => `${MESES[(l.mes || 1) - 1]}/${l.ano}`;
  const totalComp = lancamentos.reduce((s, l) => s + Number(l.valor || 0), 0);
  const teto = rbt?.grupo.limiteSimples || 4800000;

  return (
    <div className="rrrec">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <Link href="/dashboard">Visão geral</Link>
          <span className="sep">/</span>
          <span>Receita &amp; Simples</span>
        </nav>

        <header className="header">
          <div className="header-top">
            <div>
              <p className="brand">GRUPO RR CRED</p>
              <h1>Receita &amp; Simples</h1>
            </div>
            <div className="hr-right">
              <div className="comp">
                <select aria-label="Competência" value={periodKey} onChange={(e) => setSelectedKey(e.target.value)}>
                  {periods.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label} · {isClosed(p.ano, p.mes) ? "fechado" : "em aberto"}
                    </option>
                  ))}
                </select>
                <span className="chev">▾</span>
              </div>
              <span className="access">Sócios + equipe fiscal</span>
            </div>
          </div>

          {rbt ? (
            <>
              <div className="gstat">
                <div>
                  <p className="lbl"><span className={`sem ${sem(rbt.grupo.sinal)}`} />RBT12 consolidado do grupo · ref. {period.label}</p>
                  <div className="big num">{brl(rbt.grupo.rbt12)}<small>/ {mm(teto)}</small></div>
                </div>
                <div className="right">
                  <div className={`pct num ${sem(rbt.grupo.sinal)}`}>{(rbt.grupo.pctLimite * 100).toFixed(1).replace(".", ",")}%</div>
                  <div className="pct-k">do teto · {ZONE[sem(rbt.grupo.sinal)].toLowerCase()}</div>
                </div>
              </div>
              <div className="gbar">
                <div className="track"><div className={`fill ${sem(rbt.grupo.sinal)}`} style={{ width: `${Math.min(100, rbt.grupo.pctLimite * 100)}%` }} /></div>
                <div className="scale"><span>R$ 0</span><span className="mid">atenção a partir de 60%</span><span>teto {mm(teto)}</span></div>
              </div>
            </>
          ) : null}
        </header>

        {error ? <div className="banner err">{error}</div> : null}
        {loading ? <div className="state">Carregando RBT12…</div> : null}

        {!loading && rbt ? (
          <>
            <div className="sec-title">
              <h2>Por CNPJ · acompanhamento do Simples</h2>
              <div className="legend">
                <span><i className="g" />Saudável &lt;60%</span>
                <span><i className="a" />Atenção 60–85%</span>
                <span><i className="r" />Crítico &gt;85%</span>
              </div>
            </div>

            <section className="cgrid">
              {rbt.empresas.map((emp) => {
                const sg = sem(emp.sinal);
                const pctTeto = teto > 0 ? (emp.rbt12 / teto) * 100 : 0;
                const folga = Math.max(0, teto - emp.rbt12);
                return (
                  <div className="ccard" key={emp.company_id}>
                    <div className="ch">
                      <div className="nm"><span className={`sem ${sg}`} />{emp.name}</div>
                      <span className="faixa">Faixa {emp.faixa}</span>
                    </div>
                    <p className="rbt-k">RBT12 · receita acumulada 12 meses</p>
                    <div className="rbt num">{brl(emp.rbt12)}</div>
                    <div className="bar"><div className="track"><div className={`fill ${sg}`} style={{ width: `${Math.min(100, pctTeto)}%` }} /></div></div>
                    <div className="meta">
                      <span className="pct num"><b>{pctTeto.toFixed(1).replace(".", ",")}%</b> do teto</span>
                      <span className="folga num">folga <b>{mm(folga)}</b></span>
                    </div>
                    <div className={`zone ${sg}`}>● {ZONE[sg]} <span className="tt">· {sg === "g" ? "abaixo do teto" : sg === "a" ? "monitorar ritmo" : "perto do limite"}</span></div>
                  </div>
                );
              })}
            </section>

            <p className="note"><span className="gi">∿</span>Cada CNPJ tem teto próprio de <b>{mm(teto)}/ano</b> no Simples. O semáforo do grupo soma os {rbt.empresas.length} e sinaliza ritmo agregado.</p>

            {/* RECEITA COMPLEMENTAR */}
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Receita complementar</h2>
                  <p className="csub">Lançamento manual que entra no RBT12 além da apuração automática</p>
                </div>
              </div>
              <div className="rc">
                <div className="form-col">
                  <form onSubmit={submit} autoComplete="off">
                    <div className="form-grid">
                      <div className="fld">
                        <label>Competência</label>
                        <div className="ctrl">
                          <select value={fComp} onChange={(e) => setFComp(e.target.value)}>
                            {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                          </select>
                          <span className="chev">▾</span>
                        </div>
                      </div>
                      <div className="fld">
                        <label>Empresa</label>
                        <div className="ctrl">
                          <select value={fEmp} onChange={(e) => setFEmp(e.target.value)}>
                            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <span className="chev">▾</span>
                        </div>
                      </div>
                      <div className="fld">
                        <label>Valor</label>
                        <div className="ctrl">
                          <span className="pre">R$</span>
                          <input className="money" inputMode="decimal" placeholder="0,00" value={fValor} onChange={(e) => onValor(e.target.value)} />
                        </div>
                      </div>
                      <div className="fld">
                        <label>Natureza</label>
                        <div className="ctrl">
                          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
                            <option value="CONSORCIO">Consórcio</option>
                            <option value="AJUSTE_CONTADOR">Ajuste contador</option>
                            <option value="OUTRO">Outro</option>
                          </select>
                          <span className="chev">▾</span>
                        </div>
                      </div>
                      <div className="fld full">
                        <label>Descrição</label>
                        <div className="ctrl">
                          <input placeholder="Ex.: consultoria avulsa para parceiro" value={fDesc} onChange={(e) => setFDesc(e.target.value)} />
                        </div>
                      </div>
                    </div>
                    <div className="rc-actions">
                      <button type="submit" className={`save${saved ? " done" : ""}`} disabled={saving}>
                        {saved ? "Lançamento salvo" : saving ? "Salvando…" : "Salvar lançamento"} <span className="ck">✓</span>
                      </button>
                      <span className="hint">Entra no RBT12 da empresa na competência selecionada.</span>
                    </div>
                  </form>
                </div>

                <div className="list-col">
                  <div className="lh">
                    <h3>Receitas complementares lançadas</h3>
                    <span className="ct">{lancamentos.length} lançamentos</span>
                  </div>
                  {lancamentos.length === 0 ? (
                    <div className="state sm">Nenhum lançamento complementar.</div>
                  ) : (
                    <>
                      <div className="rlist">
                        {lancamentos.map((l) => (
                          <div className="ritem" key={l.id}>
                            <span className="desc">{l.descricao || "Receita complementar"}</span>
                            <span className="amt num">{brl(l.valor)}</span>
                            <span className="meta">
                              <span className="pill">{compName(l.company_id)}</span>
                              <span className="dotsep">·</span>{lblOf(l)}
                              <span className="dotsep">·</span>{CAT_LABEL[l.categoria] || l.categoria}
                              <button type="button" className="del" title="Remover" onClick={() => remove(l.id)}>×</button>
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="rlist-foot">
                        <span className="l">Total complementar lançado</span>
                        <span className="v num">{brl(totalComp)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

const CSS = `
.rrrec{
  --navy:#0F1F4A; --yellow:#FFF000; --gold:#D6A13F; --gold-deep:#B9842A;
  --green:#3C9D6B; --green-soft:#5FB98A; --green-bg:#E9F5EF;
  --warn:#D69A1E; --warn-soft:#E7BE6A; --warn-bg:#FBF1DC;
  --red:#C0443C; --red-soft:#E07A72; --red-bg:#FBECEB;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C; --r-lg:20px; --r-md:16px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  background:var(--page);color:var(--ink);font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.45;
}
.rrrec *{box-sizing:border-box;}
.rrrec .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrrec .wrap{max-width:1080px;margin:0 auto;padding:34px 28px 56px;display:flex;flex-direction:column;gap:22px;}
.rrrec .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:-6px 2px -4px;}
.rrrec .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rrrec .crumb a:hover{color:var(--navy);}
.rrrec .crumb .sep{color:#C2C8D2;}
.rrrec .header{background:var(--navy);border-radius:var(--r-lg);padding:30px 34px 34px;color:#fff;position:relative;overflow:hidden;}
.rrrec .header::after{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--gold),rgba(214,161,63,0));opacity:.55;}
.rrrec .header-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;}
.rrrec .brand{font-size:11.5px;font-weight:600;letter-spacing:.18em;color:var(--yellow);margin:0 0 7px;}
.rrrec .header h1{font-size:27px;font-weight:600;letter-spacing:-.01em;margin:0;color:#fff;}
.rrrec .hr-right{display:flex;flex-direction:column;align-items:flex-end;gap:10px;}
.rrrec .comp{position:relative;}
.rrrec .comp select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 36px 8px 14px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rrrec .comp select option{color:#16203A;}
.rrrec .comp select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rrrec .comp .chev{position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:#9DA9C6;font-size:11px;}
.rrrec .access{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:500;color:#9DA9C6;}
.rrrec .gstat{margin-top:28px;border-top:1px solid rgba(255,255,255,.10);padding-top:24px;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;}
.rrrec .gstat .lbl{font-size:12px;font-weight:500;color:#9DA9C6;margin:0 0 11px;display:flex;align-items:center;gap:9px;}
.rrrec .gstat .lbl .sem{width:10px;height:10px;border-radius:50%;}
.rrrec .gstat .big{font-size:42px;font-weight:700;letter-spacing:-.025em;line-height:.95;color:#fff;}
.rrrec .gstat .big small{font-size:19px;font-weight:600;color:#A6B0CB;margin-left:8px;letter-spacing:0;}
.rrrec .gstat .right{text-align:right;}
.rrrec .gstat .pct{font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1;}
.rrrec .gstat .pct.g{color:var(--green-soft);}
.rrrec .gstat .pct.a{color:var(--warn-soft);}
.rrrec .gstat .pct.r{color:var(--red-soft);}
.rrrec .gstat .pct-k{font-size:12px;color:#9DA9C6;margin-top:8px;}
.rrrec .sem.g{background:var(--green);box-shadow:0 0 0 4px rgba(60,157,107,.18);}
.rrrec .sem.a{background:var(--warn);box-shadow:0 0 0 4px rgba(214,154,30,.20);}
.rrrec .sem.r{background:var(--red);box-shadow:0 0 0 4px rgba(192,68,60,.18);}
.rrrec .gbar{margin-top:20px;}
.rrrec .gbar .track{height:9px;border-radius:6px;background:rgba(255,255,255,.10);overflow:hidden;}
.rrrec .gbar .fill{height:100%;border-radius:6px;}
.rrrec .gbar .fill.g{background:linear-gradient(90deg,var(--green),var(--green-soft));}
.rrrec .gbar .fill.a{background:linear-gradient(90deg,var(--warn),var(--warn-soft));}
.rrrec .gbar .fill.r{background:linear-gradient(90deg,var(--red),var(--red-soft));}
.rrrec .gbar .scale{display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:#7C88A8;}
.rrrec .gbar .scale .mid{color:#9DA9C6;}
.rrrec .banner{border-radius:var(--r-md);padding:12px 16px;font-size:13px;background:var(--red-bg);border:1px solid #E9B7B2;color:#8E2F28;}
.rrrec .state{padding:24px 4px;font-size:13.5px;color:var(--ink-3);}
.rrrec .state.sm{padding:14px 2px;}
.rrrec .sec-title{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin:4px 2px -4px;flex-wrap:wrap;}
.rrrec .sec-title h2{font-size:16.5px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrrec .sec-title .legend{display:flex;gap:16px;font-size:12px;color:var(--ink-3);}
.rrrec .sec-title .legend span{display:inline-flex;align-items:center;gap:6px;}
.rrrec .sec-title .legend i{width:9px;height:9px;border-radius:50%;display:inline-block;}
.rrrec .legend i.g{background:var(--green);}
.rrrec .legend i.a{background:var(--warn);}
.rrrec .legend i.r{background:var(--red);}
.rrrec .cgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.rrrec .ccard{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:24px 26px;display:flex;flex-direction:column;}
.rrrec .ccard .ch{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;}
.rrrec .ccard .nm{display:flex;align-items:center;gap:11px;font-size:15.5px;font-weight:600;color:var(--ink);}
.rrrec .ccard .sem{width:11px;height:11px;border-radius:50%;flex:none;}
.rrrec .ccard .faixa{font-size:11.5px;font-weight:600;color:var(--ink-2);background:#F3F5F8;border:1px solid var(--bd);padding:4px 10px;border-radius:7px;white-space:nowrap;}
.rrrec .ccard .rbt-k{font-size:12px;font-weight:500;color:var(--ink-3);margin:0 0 6px;}
.rrrec .ccard .rbt{font-size:30px;font-weight:600;letter-spacing:-.02em;line-height:1;color:var(--ink);}
.rrrec .ccard .bar{margin-top:20px;}
.rrrec .ccard .bar .track{height:8px;border-radius:6px;background:#EFF1F5;overflow:hidden;}
.rrrec .ccard .bar .fill{height:100%;border-radius:6px;}
.rrrec .ccard .bar .fill.g{background:linear-gradient(90deg,var(--green),var(--green-soft));}
.rrrec .ccard .bar .fill.a{background:linear-gradient(90deg,var(--warn),var(--warn-soft));}
.rrrec .ccard .bar .fill.r{background:linear-gradient(90deg,var(--red),var(--red-soft));}
.rrrec .ccard .meta{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:11px;}
.rrrec .ccard .meta .pct{font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;}
.rrrec .ccard .meta .pct b{color:var(--green);}
.rrrec .ccard .meta .folga{font-size:12px;color:var(--ink-3);white-space:nowrap;}
.rrrec .ccard .meta .folga b{color:var(--ink-2);font-weight:600;}
.rrrec .ccard .zone{font-size:11.5px;font-weight:600;margin-top:14px;padding-top:13px;border-top:1px solid var(--bd-soft);display:flex;align-items:center;gap:8px;}
.rrrec .ccard .zone.g{color:var(--green);}
.rrrec .ccard .zone.a{color:var(--warn);}
.rrrec .ccard .zone.r{color:var(--red);}
.rrrec .ccard .zone .tt{color:var(--ink-3);font-weight:500;}
.rrrec .note{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--ink-3);margin:-2px 4px;}
.rrrec .note .gi{width:16px;height:16px;border-radius:5px;background:#F1F3F7;border:1px solid var(--bd);display:grid;place-items:center;font-size:10px;color:var(--ink-3);}
.rrrec .note b{color:var(--ink-2);font-weight:600;}
.rrrec .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:26px 28px;}
.rrrec .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:4px;}
.rrrec .card-head h2{font-size:16.5px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrrec .card-head .csub{font-size:12.5px;color:var(--ink-3);margin:5px 0 0;}
.rrrec .rc{display:grid;grid-template-columns:1.05fr .95fr;gap:0;}
.rrrec .rc .form-col{padding-right:30px;border-right:1px solid var(--bd-soft);}
.rrrec .rc .list-col{padding-left:30px;}
.rrrec .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px;}
.rrrec .fld{display:flex;flex-direction:column;gap:7px;}
.rrrec .fld.full{grid-column:1 / -1;}
.rrrec .fld label{font-size:11.5px;font-weight:600;letter-spacing:.03em;color:var(--ink-2);}
.rrrec .ctrl{position:relative;display:flex;align-items:center;}
.rrrec .ctrl .pre{position:absolute;left:13px;font-size:13.5px;font-weight:600;color:var(--ink-3);pointer-events:none;}
.rrrec .ctrl select,.rrrec .ctrl input{width:100%;font-family:inherit;font-size:13.5px;color:var(--ink);border:1px solid var(--bd);border-radius:10px;background:#fff;padding:11px 13px;outline:none;}
.rrrec .ctrl input.money{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;font-weight:600;padding-left:38px;}
.rrrec .ctrl select{appearance:none;-webkit-appearance:none;cursor:pointer;padding-right:34px;}
.rrrec .ctrl .chev{position:absolute;right:13px;pointer-events:none;color:var(--ink-3);font-size:11px;}
.rrrec .ctrl select:focus,.rrrec .ctrl input:focus{border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}
.rrrec .rc-actions{display:flex;align-items:center;gap:14px;margin-top:18px;flex-wrap:wrap;}
.rrrec .save{display:inline-flex;align-items:center;gap:8px;background:var(--navy);color:#fff;border:none;border-radius:10px;padding:12px 22px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;}
.rrrec .save:hover{background:#16285C;}
.rrrec .save:disabled{opacity:.7;cursor:default;}
.rrrec .save .ck{color:var(--yellow);font-size:13px;}
.rrrec .save.done{background:var(--green);}
.rrrec .save.done .ck{color:#fff;}
.rrrec .rc-actions .hint{font-size:11.5px;color:var(--ink-3);max-width:220px;}
.rrrec .list-col .lh{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:4px;}
.rrrec .list-col .lh h3{font-size:13px;font-weight:600;color:var(--ink);margin:0;}
.rrrec .list-col .lh .ct{font-size:11.5px;color:var(--ink-3);}
.rrrec .rlist{display:flex;flex-direction:column;}
.rrrec .ritem{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:14px 2px;border-top:1px solid var(--bd-soft);}
.rrrec .ritem:first-child{border-top:none;}
.rrrec .ritem .desc{font-size:13.5px;font-weight:600;color:var(--ink);}
.rrrec .ritem .amt{font-size:14px;font-weight:600;color:var(--green);text-align:right;}
.rrrec .ritem .meta{grid-column:1 / -1;font-size:11.5px;color:var(--ink-3);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.rrrec .ritem .meta .pill{font-size:10.5px;font-weight:600;color:var(--ink-2);background:#F3F5F8;border:1px solid var(--bd);padding:2px 7px;border-radius:6px;}
.rrrec .ritem .meta .dotsep{color:#C2C8D2;}
.rrrec .ritem .meta .del{margin-left:auto;appearance:none;border:none;background:none;color:var(--ink-3);font-size:16px;line-height:1;cursor:pointer;padding:0 4px;}
.rrrec .ritem .meta .del:hover{color:var(--red);}
.rrrec .rlist-foot{display:grid;grid-template-columns:1fr auto;gap:12px;margin-top:6px;padding:14px 2px 2px;border-top:2px solid var(--bd);}
.rrrec .rlist-foot .l{font-size:12px;font-weight:600;color:var(--ink-2);}
.rrrec .rlist-foot .v{font-size:14.5px;font-weight:700;color:var(--green);text-align:right;}

@media (max-width:820px){
  .rrrec .rc{grid-template-columns:1fr;}
  .rrrec .rc .form-col{padding-right:0;border-right:none;padding-bottom:26px;border-bottom:1px solid var(--bd-soft);}
  .rrrec .rc .list-col{padding-left:0;padding-top:26px;}
}
@media (max-width:680px){
  .rrrec .wrap{padding:18px 16px 40px;gap:16px;}
  .rrrec .header{padding:22px 20px 24px;}
  .rrrec .header h1{font-size:22px;}
  .rrrec .hr-right{align-items:flex-start;}
  .rrrec .gstat .big{font-size:34px;}
  .rrrec .cgrid{grid-template-columns:1fr;}
  .rrrec .ccard,.rrrec .card{padding:20px 18px;}
  .rrrec .form-grid{grid-template-columns:1fr;}
}
`;
