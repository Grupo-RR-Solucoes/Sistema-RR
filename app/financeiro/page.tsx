"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { UiStyles, HeaderNavy, KpiBand } from "@/components/ui";

// Etapa 8 (enxugar menu) Fase 3 — Tela A "Financeiro" (socio): consolida o antigo
// /financeiro (Caixa & Resultado) + /dre numa tela de 2 abas. Reusa /api/financeiro
// e /api/dre verbatim (zero religação). Entrada preservada: SALDO INICIAL (a despesa
// virou só visão + link pro /despesas, que é o CRUD canônico).

type Period = { key: string; label: string; year: number; month: number };

type FinSummary = {
  receivedNet: number;
  receivedInsurance: number; // "do qual seguro" das Comissoes recebidas pela empresa (M-1)
  receivedEmpresa: number; // avista + seguro do fechamento M-1 (o que gera repasse)
  totalExpenses: number;
  comissoesPagas: number;
  paidInsuranceShare: number; // "do qual seguro" do repasse (M-1)
  operatingResult: number;
  actualPrt: number;
  openingBalance: number;
  cashBalance: number;
};
type CashTrend = { key: string; label: string; receivedNet: number; totalExpenses: number; comissoesPagas: number };
type CatTotal = Record<string, unknown>;
type FinPayload = {
  periods: Period[];
  selectedPeriod: Period | null;
  summary: FinSummary;
  cashTrend: CashTrend[];
  categoryTotals: CatTotal[];
  alerts: string[];
};

type DreRow = {
  scope: "COMPANY" | "GROUP";
  name: string;
  receita: number;
  receitaSeguro: number; // informativo: "do qual seguro" (ja dentro de receita)
  comissoes: number;
  despesas: number;
  resultadoLiquido: number;
};
type DrePayload = {
  closed: boolean;
  period: Period | null;
  companies: DreRow[];
  group: DreRow | null;
  alerts: string[];
};

const brl = (v: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(v ?? 0));
const brl2 = (v: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(Number(v ?? 0));

// Valor do KPI colorido por NATUREZA (entrada azul / saida vermelho / saldo verde+
// ou vermelho-). REGRA ZERO: valor == 0 fica NEUTRO (branco padrao sobre o navy) p/
// nao dar alarme falso (ex.: Despesas R$ 0). So pinta o numero, nao o card.
function kpiVal(amount: number, nature: "in" | "out" | "saldo") {
  const txt = brl(amount);
  if (!amount) return txt; // 0/NaN -> neutro (branco)
  const color =
    nature === "in" ? "var(--kpi-in)" :
    nature === "out" ? "var(--kpi-out)" :
    amount > 0 ? "var(--kpi-pos)" : "var(--kpi-neg)";
  return <span style={{ color }}>{txt}</span>;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function cashLabel(year: number, month: number) {
  return `${MESES[month - 1]}/${String(year).slice(-2)}`;
}
// Regime de caixa: o caixa do mês M vem da competência M-1. Para listar os
// meses de CAIXA do seletor, desloca cada competência de fechamento +1 mês.
function shiftPlus1(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}
function pick(o: Record<string, unknown>, keys: string[]): number | string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null) return v as number | string;
  }
  return undefined;
}

export default function FinanceiroPage() {
  const [tab, setTab] = useState<"caixa" | "dre">("caixa");
  const [selectedKey, setSelectedKey] = useState("");
  const [fin, setFin] = useState<FinPayload | null>(null);
  const [dre, setDre] = useState<DrePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saldo, setSaldo] = useState("");
  const [savingSaldo, setSavingSaldo] = useState(false);
  const [saldoDone, setSaldoDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError("");
        const q = selectedKey
          ? `?year=${selectedKey.split("-")[0]}&month=${Number(selectedKey.split("-")[1])}`
          : "";
        const [fr, dr] = await Promise.all([fetch(`/api/financeiro${q}`), fetch(`/api/dre${q}`)]);
        const fj = await fr.json();
        const dj = await dr.json();
        if (!fr.ok) throw new Error(fj?.error || "Erro ao carregar o financeiro.");
        if (!cancelled) {
          setFin(fj as FinPayload);
          setDre(dr.ok ? (dj as DrePayload) : null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  // Meses de CAIXA do seletor: cada competência de fechamento existente habilita
  // o caixa do mês seguinte (M-1 → M). Sempre inclui o mês corrente. Ordena do
  // mais recente para o mais antigo. (Não toca no motor — deriva de fin.periods.)
  const cashPeriods = useMemo<Period[]>(() => {
    const map = new Map<string, Period>();
    const add = (year: number, month: number) => {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, { key, label: cashLabel(year, month), year, month });
    };
    for (const p of fin?.periods ?? []) {
      const s = shiftPlus1(p.year, p.month);
      add(s.year, s.month);
    }
    const now = new Date();
    add(now.getFullYear(), now.getMonth() + 1); // mês corrente sempre selecionável
    return Array.from(map.values()).sort((a, b) => b.year - a.year || b.month - a.month);
  }, [fin]);

  // default = mês de caixa mais recente disponível (ex.: jun/26 hoje).
  useEffect(() => {
    if (selectedKey || cashPeriods.length === 0) return;
    setSelectedKey(cashPeriods[0].key);
  }, [cashPeriods, selectedKey]);

  const periodKey = selectedKey || cashPeriods[0]?.key || fin?.selectedPeriod?.key || "";
  const period = cashPeriods.find((p) => p.key === periodKey) || fin?.selectedPeriod || null;
  const periodShort = period?.label || "—";

  const chart = useMemo(() => {
    const rows = fin?.cashTrend || [];
    if (rows.length === 0) return null;
    const saidaOf = (r: CashTrend) => r.totalExpenses + (r.comissoesPagas || 0);
    const yMax = Math.max(1, ...rows.map((r) => Math.max(r.receivedNet, saidaOf(r)))) * 1.12;
    const W = 1000, H = 320, padL = 56, padR = 16, padT = 16, padB = 40;
    const x0 = padL, x1 = W - padR, y1 = H - padB;
    const fy = (v: number) => y1 - (y1 - padT) * (v / yMax);
    const n = rows.length, groupW = (x1 - x0) / n, barW = 24, gap = 8;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ v: t * yMax, y: fy(t * yMax) }));
    const bars = rows.map((r, i) => {
      const cx = x0 + groupW * i + groupW / 2;
      const saidas = saidaOf(r);
      return {
        label: r.label.split("/")[0],
        inX: cx - barW - gap / 2, inY: fy(r.receivedNet), inH: y1 - fy(r.receivedNet),
        outX: cx + gap / 2, outY: fy(saidas), outH: y1 - fy(saidas),
        cur: i === rows.length - 1, cx,
      };
    });
    return { W, H, x0, x1, y1, ticks, bars };
  }, [fin]);

  const cats = useMemo(() => {
    const raw = fin?.categoryTotals || [];
    const mapped = raw.map((c) => ({
      name: String(pick(c, ["name", "category", "categoryName", "nome"]) ?? "—"),
      total: Number(pick(c, ["total", "amount", "value", "valor"]) ?? 0),
      pct: Number(pick(c, ["percent", "pct", "participacao"]) ?? 0),
    }));
    const totalAll = mapped.reduce((s, c) => s + c.total, 0);
    return mapped.map((c) => ({ ...c, pct: c.pct || (totalAll > 0 ? (c.total / totalAll) * 100 : 0) }));
  }, [fin]);

  function onSaldoInput(raw: string) {
    const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    if (!digits) {
      setSaldo("");
      return;
    }
    const p = digits.padStart(3, "0");
    const cents = p.slice(-2);
    const intp = p.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    setSaldo(`${intp},${cents}`);
  }

  async function saveSaldo(e: React.FormEvent) {
    e.preventDefault();
    if (!saldo || !period) return;
    const openingBalance = Number(saldo.replace(/\./g, "").replace(",", ".")) || 0;
    try {
      setSavingSaldo(true);
      setError("");
      const res = await fetch("/api/financeiro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "opening_balance",
          scope: "GROUP",
          year: period.year,
          month: period.month,
          openingBalance,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Erro ao lançar o saldo inicial.");
      setSaldoDone(true);
      setTimeout(() => setSaldoDone(false), 2200);
      setSelectedKey(period.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar o saldo.");
    } finally {
      setSavingSaldo(false);
    }
  }

  return (
    <div className="rrfin">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <Link href="/dashboard">Dashboard</Link>
          <span className="sep">/</span>
          <span>Financeiro</span>
        </nav>

        <HeaderNavy
          brand="GRUPO RR CRED"
          title="Financeiro"
          actions={
            <div className="comp">
              <select aria-label="Mês de caixa" value={periodKey} onChange={(e) => setSelectedKey(e.target.value)}>
                {cashPeriods.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label} · caixa
                  </option>
                ))}
              </select>
              <span className="chev">▾</span>
            </div>
          }
        >
          <div className="tabs" role="tablist">
            <button className="tab" role="tab" aria-selected={tab === "caixa"} onClick={() => setTab("caixa")}>
              Caixa &amp; Resultado
            </button>
            <button className="tab" role="tab" aria-selected={tab === "dre"} onClick={() => setTab("dre")}>
              DRE
            </button>
          </div>
          {tab === "caixa" && fin ? (
            <>
              {/* Linha 1 — fluxo de comissoes/despesas (M-1). Cor por natureza:
                  entrada azul, saida vermelho, saldo verde/vermelho, zero neutro. */}
              <KpiBand
                valueSize={24}
                items={[
                  { label: "Recebido", value: kpiVal(fin.summary.receivedNet, "in"), sub: "crédito recebido (bruto)" },
                  { label: "Comissões recebidas", value: kpiVal(fin.summary.receivedEmpresa, "in"), sub: "à vista + seguro do fechamento M-1 (o que gera repasse)" },
                  { label: "Comissões pagas", value: kpiVal(fin.summary.comissoesPagas, "out"), sub: "repasse aos promotores (M-1)" },
                  { label: "Saldo de comissões à vista", value: kpiVal(fin.summary.receivedEmpresa - fin.summary.comissoesPagas, "saldo"), sub: "recebidas − pagas (M-1)" },
                  { label: "Despesas", value: kpiVal(fin.summary.totalExpenses, "out"), sub: "operacionais" },
                ]}
              />
              {/* Linha 2 — detalhe de seguro (do qual, M-1) + saldo do caixa. */}
              <KpiBand
                valueSize={24}
                items={[
                  { label: "Seguro recebido", value: kpiVal(fin.summary.receivedInsurance, "in"), sub: "do qual das 'comissões recebidas' — mês anterior" },
                  { label: "Seguro repassado", value: kpiVal(fin.summary.paidInsuranceShare, "out"), sub: "do qual das 'comissões pagas' (M-1)" },
                  { label: "Saldo", value: kpiVal(fin.summary.operatingResult, "saldo"), sub: "recebido − comissões − despesas", accent: true },
                ]}
              />
            </>
          ) : null}
        </HeaderNavy>

        {error ? <div className="banner err">{error}</div> : null}
        {loading ? <div className="state">Carregando financeiro…</div> : null}

        {!loading && tab === "caixa" && fin ? (
          <div className="panes">
            {/* Os KPIs (incl. os 2 de seguro, agora promovidos) vivem no <KpiBand>
                dentro do <HeaderNavy>. "Seguro recebido" e um "do qual" das Comissoes
                recebidas pela empresa; "Seguro repassado" e um "do qual" das Comissoes
                pagas — nenhum e entrada/saida adicional (nao somam). */}
            <p className="note"><span className="dot" />Saldo de <b>caixa</b> = recebido − comissões pagas − despesas. <b>Comissões recebidas</b> (à vista + seguro do fechamento M-1) × <b>Comissões pagas</b> = <b>Saldo de comissões à vista</b> (mesma competência M-1). Difere do resultado da DRE pela receita complementar (competência, não caixa).</p>

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Fluxo de caixa &amp; despesas</h2>
                  <p className="csub">Entradas, saídas e composição</p>
                </div>
                <span className="socio">SÓCIOS</span>
              </div>
              <div className="flow">
                <div className="panel">
                  <p className="panel-title">Fluxo de caixa mensal</p>
                  {chart ? (
                    <svg className="flux" viewBox={`0 0 ${chart.W} ${chart.H}`} role="img" aria-label="Entradas e saídas mensais">
                      {chart.ticks.map((t, i) => (
                        <g key={i}>
                          <line x1={chart.x0} x2={chart.x1} y1={t.y} y2={t.y} stroke="#E9ECF1" strokeWidth={i === 0 ? 1.5 : 1} />
                          <text x={chart.x0 - 12} y={t.y + 4} textAnchor="end" fill="#9AA1B0" fontSize="13" fontFamily="'IBM Plex Mono', monospace">
                            {t.v === 0 ? "0" : `${Math.round(t.v / 1000)}k`}
                          </text>
                        </g>
                      ))}
                      {chart.bars.map((b, i) => (
                        <g key={i}>
                          <rect x={b.inX} y={b.inY} width={24} height={b.inH} rx={5} fill="#0F1F4A" />
                          <rect x={b.outX} y={b.outY} width={24} height={b.outH} rx={5} fill="#D6A13F" />
                          <text x={b.cx} y={chart.H - 14} textAnchor="middle" fill={b.cur ? "#0F1F4A" : "#9AA1B0"} fontSize="13" fontWeight={b.cur ? 600 : 400}>
                            {b.label}
                          </text>
                        </g>
                      ))}
                    </svg>
                  ) : (
                    <div className="state">Sem histórico de caixa.</div>
                  )}
                  <div className="legend">
                    <span><i className="in" />Entradas</span>
                    <span><i className="out" />Saídas</span>
                  </div>
                </div>
                <div className="panel">
                  <p className="panel-title">Participação por categoria</p>
                  {cats.length === 0 ? (
                    <div className="state sm">Sem despesas lançadas nesta competência.</div>
                  ) : (
                    <div className="cats">
                      {cats.map((c, i) => (
                        <div key={c.name} className={`cat${i === 0 ? " lead" : ""}`}>
                          <div className="top">
                            <span className="nm">{c.name}</span>
                            <span className="pc num">{c.pct.toFixed(1).replace(".", ",")}%</span>
                          </div>
                          <div className="track"><div className="fill" style={{ width: `${Math.min(100, c.pct)}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Despesas do mês</h2>
                  <p className="csub">Visão consolidada · {periodShort} — somente leitura</p>
                </div>
                <Link className="card-link" href="/despesas">Gerenciar despesas <span className="arr">→</span></Link>
              </div>
              {cats.length === 0 ? (
                <div className="state sm">Nenhuma despesa lançada. Lance em <Link href="/despesas" className="ilink">Gerenciar despesas</Link>.</div>
              ) : (
                <>
                  <div className="dlist">
                    {cats.map((c, i) => (
                      <div key={c.name} className={`drow${i === 0 ? " lead" : ""}`}>
                        <span className="dot" />
                        <span className="nm">{c.name}</span>
                        <span className="amt num">{brl(c.total)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="dtot">
                    <span className="l">Total de despesas · {periodShort}</span>
                    <span className="v num">{brl(fin.summary.totalExpenses)}</span>
                  </div>
                </>
              )}
            </section>

            <div className="open">
              <span className="oi">R$</span>
              <div className="otxt">
                <h3>Abrir caixa do mês</h3>
                <p>Lance o saldo inicial da competência ({periodShort}) para iniciar a conciliação de caixa.</p>
              </div>
              <form onSubmit={saveSaldo} autoComplete="off">
                <div className="field">
                  <span className="pre">R$</span>
                  <input type="text" inputMode="decimal" placeholder="0,00" aria-label="Saldo inicial" value={saldo} onChange={(e) => onSaldoInput(e.target.value)} />
                </div>
                <button type="submit" className={`save${saldoDone ? " done" : ""}`} disabled={savingSaldo}>
                  {saldoDone ? "Saldo lançado" : savingSaldo ? "Salvando…" : "Salvar saldo"} <span className="ck">✓</span>
                </button>
              </form>
              <p className="help"><span className="dot" />Única entrada desta tela · demais lançamentos em <Link href="/despesas" className="ilink">Gerenciar despesas</Link>.</p>
            </div>
          </div>
        ) : null}

        {!loading && tab === "dre" ? (
          <div className="panes">
            {!dre || !dre.group ? (
              <div className="card">
                <div className="state">
                  {dre?.alerts?.[0] || "DRE indisponível para esta competência (só meses fechados com receita)."}
                </div>
              </div>
            ) : (
              <>
                <p className="note"><span className="dot" /><b>DRE gerencial · {dre.period?.label || periodShort}</b>&nbsp;— resultado consolidado por CNPJ</p>
                {/* Subtotal INFORMATIVO de seguro: "do qual" — JA dentro da
                    receita (nao soma de novo). Fonte: fechamento_mensal_empresa.valor_seguro (competencia M). */}
                <section className="card" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: ".04em" }}>
                      Comissão de seguro <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--ink-3)" }}>(do qual)</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 5 }}>
                      já inclusa na receita abaixo — não é parcela adicional
                    </div>
                  </div>
                  <div className="num" style={{ fontSize: 26, fontWeight: 700, color: "var(--gold-deep)", whiteSpace: "nowrap", fontFamily: "'IBM Plex Mono',ui-monospace,monospace", fontVariantNumeric: "tabular-nums" }}>
                    {brl2(dre.group.receitaSeguro)}
                  </div>
                </section>
                <section className="card">
                  <div className="card-head">
                    <div>
                      <h2>Resultado por empresa</h2>
                      <p className="csub">Receita − comissões − despesas = resultado</p>
                    </div>
                    <span className="socio">SÓCIOS</span>
                  </div>
                  <div className="dre-tbl">
                    <div className="dhead">
                      <span className="h">Empresa</span>
                      <span className="h r">Receita</span>
                      <span className="h r">Comissões</span>
                      <span className="h r">Despesas</span>
                      <span className="h r">Resultado</span>
                    </div>
                    {dre.companies.map((c) => (
                      <div className="dr" key={c.name}>
                        <div className="emp"><span className="st" />{c.name}</div>
                        <div className="dcell"><span className="k">Receita</span><span className="v num muted">{brl2(c.receita)}</span></div>
                        <div className="dcell"><span className="k">Comissões</span><span className="v num neg">−{brl2(c.comissoes)}</span></div>
                        <div className="dcell"><span className="k">Despesas</span><span className="v num neg">{c.despesas ? `−${brl2(c.despesas)}` : brl2(0)}</span></div>
                        <div className="dcell"><span className="k">Resultado</span><span className="v num res">{brl2(c.resultadoLiquido)}</span></div>
                      </div>
                    ))}
                    <div className="dr total">
                      <div className="emp"><span className="st" />{dre.group.name}</div>
                      <div className="dcell"><span className="k">Receita</span><span className="v num">{brl2(dre.group.receita)}</span></div>
                      <div className="dcell"><span className="k">Comissões</span><span className="v num neg">−{brl2(dre.group.comissoes)}</span></div>
                      <div className="dcell"><span className="k">Despesas</span><span className="v num neg">{dre.group.despesas ? `−${brl2(dre.group.despesas)}` : brl2(0)}</span></div>
                      <div className="dcell"><span className="k">Resultado</span><span className="v num res">{brl2(dre.group.resultadoLiquido)}</span></div>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}

const CSS = `
.rrfin{
  --navy:#0F1F4A; --navy-bar:#1E3066; --yellow:#FFF000; --gold:#D6A13F; --gold-deep:#B9842A; --gold-soft:#E7BE6A;
  --green:#3C9D6B; --green-soft:#5FB98A; --red:#C0443C; --red-bg:#FBECEB;
  /* Cores por natureza do KPI, legiveis sobre o navy (valor branco por padrao).
     ENTRADA=azul claro, SAIDA=vermelho claro, SALDO +=verde / -=vermelho. */
  --kpi-in:#7FB0FF; --kpi-out:#E88A82; --kpi-pos:#5FB98A; --kpi-neg:#E88A82;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C; --r-lg:20px; --r-md:16px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  background:var(--page);color:var(--ink);font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.45;
}
.rrfin *{box-sizing:border-box;}
.rrfin .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrfin .wrap{max-width:1080px;margin:0 auto;padding:34px 28px 56px;display:flex;flex-direction:column;gap:22px;}
.rrfin .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:-6px 2px -4px;}
.rrfin .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rrfin .crumb a:hover{color:var(--navy);}
.rrfin .crumb .sep{color:#C2C8D2;}
/* bloco navy + marca + h1 agora vêm do <HeaderNavy> do kit; .comp (select) e .tabs (children) ficam */
.rrfin .comp{position:relative;}
.rrfin .comp select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 36px 8px 14px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rrfin .comp select option{color:#16203A;}
.rrfin .comp select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rrfin .comp .chev{position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:#9DA9C6;font-size:11px;}
.rrfin .tabs{margin-top:26px;display:inline-flex;gap:4px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:5px;width:fit-content;}
.rrfin .tab{appearance:none;border:none;background:transparent;color:#B7C1DA;font-family:inherit;font-size:12.5px;font-weight:600;padding:8px 18px;border-radius:999px;cursor:pointer;transition:.15s;white-space:nowrap;}
.rrfin .tab:hover{color:#fff;}
.rrfin .tab[aria-selected="true"]{background:#fff;color:var(--navy);}
.rrfin .socio{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--gold-deep);}
.rrfin .banner{border-radius:var(--r-md);padding:12px 16px;font-size:13px;background:var(--red-bg);border:1px solid #E9B7B2;color:#8E2F28;}
.rrfin .state{padding:24px 4px;font-size:13.5px;color:var(--ink-3);}
.rrfin .state.sm{padding:14px 2px;}
.rrfin .ilink{color:var(--navy);font-weight:600;text-decoration:none;}
.rrfin .ilink:hover{color:var(--gold);}
.rrfin .panes{display:flex;flex-direction:column;gap:22px;}
/* os 4 KPIs (.summary/.scard) agora vêm do <KpiBand valueSize={26}> do kit (navy embutido) */
.rrfin .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:26px 28px;}
.rrfin .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:4px;}
.rrfin .card-head h2{font-size:16.5px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrfin .card-head .csub{font-size:12.5px;color:var(--ink-3);margin:5px 0 0;}
.rrfin .card-link{font-size:12.5px;font-weight:600;color:var(--navy);text-decoration:none;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;}
.rrfin .card-link:hover{color:var(--gold);}
.rrfin .flow{display:grid;grid-template-columns:1.4fr 1fr;gap:0;margin-top:20px;}
.rrfin .flow .panel{padding:0 30px;position:relative;}
.rrfin .flow .panel:first-child{padding-left:0;}
.rrfin .flow .panel + .panel::before{content:"";position:absolute;left:0;top:0;bottom:0;width:1px;background:var(--bd-soft);}
.rrfin .panel-title{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin:0 0 16px;}
.rrfin svg.flux{width:100%;height:auto;display:block;}
.rrfin .legend{display:flex;gap:18px;margin-top:14px;font-size:12px;color:var(--ink-2);}
.rrfin .legend span{display:inline-flex;align-items:center;gap:7px;}
.rrfin .legend i{width:11px;height:11px;border-radius:3px;display:inline-block;}
.rrfin .legend i.in{background:var(--navy);}
.rrfin .legend i.out{background:var(--gold);}
.rrfin .cats{display:flex;flex-direction:column;gap:13px;}
.rrfin .cat .top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:6px;}
.rrfin .cat .nm{font-size:13px;font-weight:500;color:var(--ink-2);}
.rrfin .cat .pc{font-size:12px;font-weight:600;color:var(--ink);}
.rrfin .cat .track{height:8px;border-radius:6px;background:#EFF1F5;overflow:hidden;}
.rrfin .cat .fill{height:100%;border-radius:6px;background:var(--navy);}
.rrfin .cat.lead .fill{background:linear-gradient(90deg,var(--gold-deep),var(--gold));}
.rrfin .cat.lead .nm{color:var(--ink);font-weight:600;}
.rrfin .dlist{margin-top:18px;display:flex;flex-direction:column;}
.rrfin .drow{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:16px;padding:14px 2px;border-top:1px solid var(--bd-soft);}
.rrfin .drow:first-child{border-top:none;}
.rrfin .drow .dot{width:9px;height:9px;border-radius:50%;flex:none;background:var(--navy-bar);}
.rrfin .drow.lead .dot{background:var(--gold);}
.rrfin .drow .nm{font-size:14.5px;font-weight:600;color:var(--ink);}
.rrfin .drow .amt{font-size:15px;font-weight:600;color:var(--ink);text-align:right;}
.rrfin .dtot{display:grid;grid-template-columns:1fr auto;align-items:center;gap:16px;margin-top:6px;padding:16px 2px 2px;border-top:2px solid var(--bd);}
.rrfin .dtot .l{font-size:13px;font-weight:600;color:var(--ink-2);}
.rrfin .dtot .v{font-size:16px;font-weight:700;color:var(--ink);text-align:right;}
.rrfin .open{background:var(--card);border:1px dashed #CDD3DE;border-radius:var(--r-md);padding:20px 22px;display:flex;align-items:center;gap:22px;flex-wrap:wrap;}
.rrfin .open .oi{flex:none;width:40px;height:40px;border-radius:11px;background:#F1F3F7;border:1px solid var(--bd);display:grid;place-items:center;color:var(--navy);font-weight:700;font-size:13px;}
.rrfin .open .otxt{flex:1;min-width:200px;}
.rrfin .open .otxt h3{font-size:14.5px;font-weight:600;margin:0 0 3px;color:var(--ink);}
.rrfin .open .otxt p{font-size:12.5px;color:var(--ink-3);margin:0;}
.rrfin .open form{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.rrfin .field{position:relative;display:inline-flex;align-items:center;}
.rrfin .field .pre{position:absolute;left:14px;font-size:13.5px;font-weight:600;color:var(--ink-3);pointer-events:none;}
.rrfin .field input{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;font-size:15px;font-weight:600;color:var(--ink);width:170px;padding:11px 14px 11px 40px;border:1px solid var(--bd);border-radius:10px;background:#fff;outline:none;}
.rrfin .field input:focus{border-color:var(--navy);box-shadow:0 0 0 3px rgba(15,31,74,.08);}
.rrfin .save{display:inline-flex;align-items:center;gap:8px;background:var(--navy);color:#fff;border:none;border-radius:10px;padding:12px 20px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;white-space:nowrap;}
.rrfin .save:hover{background:#16285C;}
.rrfin .save:disabled{opacity:.7;cursor:default;}
.rrfin .save .ck{color:var(--yellow);font-size:13px;}
.rrfin .save.done{background:var(--green);}
.rrfin .save.done .ck{color:#fff;}
.rrfin .open .help{flex-basis:100%;font-size:11.5px;color:var(--ink-3);margin:0;display:flex;align-items:center;gap:7px;}
.rrfin .open .help .dot{width:6px;height:6px;border-radius:50%;background:var(--green);}
.rrfin .note{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--ink-3);margin:-4px 4px;}
.rrfin .note .dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(60,157,107,.13);}
.rrfin .note b{color:var(--ink-2);font-weight:600;}
.rrfin .dre-tbl{margin-top:18px;}
.rrfin .dhead,.rrfin .dr{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr 1fr;align-items:center;gap:14px;}
.rrfin .dhead{padding:0 2px 11px;border-bottom:1px solid var(--bd);}
.rrfin .dhead .h{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);}
.rrfin .dhead .h.r{text-align:right;}
.rrfin .dr{padding:15px 2px;border-top:1px solid var(--bd-soft);}
.rrfin .dr:first-of-type{border-top:none;}
.rrfin .dr .emp{display:flex;align-items:center;gap:11px;font-size:14.5px;font-weight:600;color:var(--ink);}
.rrfin .dr .emp .st{width:9px;height:9px;border-radius:50%;background:var(--green);flex:none;box-shadow:0 0 0 3px rgba(60,157,107,.13);}
.rrfin .dcell .k{display:none;}
.rrfin .dcell .v{font-size:14.5px;font-weight:600;text-align:right;display:block;}
.rrfin .dcell .v.muted{color:var(--ink-2);font-weight:500;}
.rrfin .dcell .v.neg{color:var(--red);font-weight:500;}
.rrfin .dcell .v.res{color:var(--green);}
.rrfin .dr.total{margin-top:6px;padding:18px 2px 4px;border-top:2px solid var(--bd);}
.rrfin .dr.total .emp{font-size:15px;color:var(--navy);}
.rrfin .dr.total .emp .st{background:var(--gold);box-shadow:0 0 0 3px rgba(214,161,63,.16);}
.rrfin .dr.total .dcell .v{font-size:15.5px;font-weight:700;color:var(--ink);}
.rrfin .dr.total .dcell .v.neg{color:var(--red);}
.rrfin .dr.total .dcell .v.res{color:var(--green);}

@media (max-width:760px){
  .rrfin .wrap{padding:18px 16px 40px;gap:16px;}
  .rrfin .tabs{width:100%;}
  .rrfin .tab{flex:1;text-align:center;}
  .rrfin .card{padding:20px 18px;}
  .rrfin .flow{grid-template-columns:1fr;gap:24px;}
  .rrfin .flow .panel{padding:0;}
  .rrfin .flow .panel + .panel{padding-top:24px;border-top:1px solid var(--bd-soft);}
  .rrfin .flow .panel + .panel::before{display:none;}
  .rrfin .open{flex-direction:column;align-items:flex-start;gap:16px;}
  .rrfin .dhead{display:none;}
  .rrfin .dr{grid-template-columns:1fr 1fr;gap:8px 14px;}
  .rrfin .dr .emp{grid-column:1 / -1;margin-bottom:2px;}
  .rrfin .dcell{display:flex;flex-direction:column;gap:2px;}
  .rrfin .dcell .v{text-align:left;}
  .rrfin .dcell .k{display:block;font-size:11px;font-weight:600;text-transform:uppercase;color:var(--ink-3);}
  .rrfin .dr.total{grid-template-columns:1fr 1fr;}
  .rrfin .dr.total .emp{grid-column:1 / -1;}
}
`;
