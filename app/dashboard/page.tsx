"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { UiStyles, Banner, Table, Num, Chip } from "@/components/ui";
import type { ChipVariant } from "@/components/ui";

// ============================================================
// DASHBOARD (Visão geral). Header = bloco navy com os 4 stats embutidos
// (formato original — KPI-sobre-navy, decisão do Diego). Piloto Etapa 3 parcial:
// alerta de projeção → <Banner variant="warn"> e "Simples por CNPJ" →
// <Table>/<Num>/<Chip> do kit; <UiStyles/> injeta a CSS dos primitivos. LÓGICA,
// FETCH e CÁLCULOS INALTERADOS. Gráfico = produção REALIZADA do grupo
// (promoter_monthly_results); jun = mês corrente PARCIAL, marcado.
// ============================================================

type CnpjRow = { nome: string; faixa: string; rbt12: number; sinal: "verde" | "amarelo" | "acima" };
type MesPonto = { mes: string; month: number; valor: number; parcial: boolean };
type Projecao = {
  percent: number | null;
  semaforo: "verde" | "amarelo" | "vermelho" | "sem_meta";
  diasDecorridos: number;
  diasTotais: number;
  mesLabel: string;
  show: boolean;
};
type Payload = {
  periodoLabel: string;
  producaoGrupoMes: number;
  producaoParcial: boolean;
  producaoNaoAtribuida: number;
  producaoNaoAtribuidaCount: number;
  comissaoBrutaEmpresa: number;
  comissaoBrutaEmpresaLabel: string;
  comissaoBrutaEmpresaNaoAtribuida: number;
  comissaoBrutaEmpresaNaoAtribuidaCount: number;
  previsaoReceita: number;
  limiteSimples: { pct: number; rbt12: number; teto: number; sinal: string };
  producaoMensal: MesPonto[];
  cnpjs: CnpjRow[];
  projecao: Projecao | null;
};

function brl0(v?: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(
    Number(v || 0)
  );
}
function pct1(v?: number | null) {
  return `${((Number(v || 0)) * 100).toFixed(1).replace(".", ",")}%`;
}
function mm2(v?: number) {
  return `${(Number(v || 0) / 1e6).toFixed(2).replace(".", ",")}MM`;
}

export default function DashboardPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    fetch("/api/dashboard")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar o dashboard."))))
      .then((j) => { if (!cancel) setData(j); })
      .catch((e) => { if (!cancel) setError(e.message || "Erro ao carregar o dashboard."); });
    return () => { cancel = true; };
  }, []);

  return (
    <div className="rrdash">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <Header data={data} />
        {data?.projecao?.show ? <AlertProjecao p={data.projecao} /> : null}
        <ChartCard data={data} error={error} />
        <CnpjCard rows={data?.cnpjs ?? []} />
        <Shortcuts />
      </main>
    </div>
  );
}

function Header({ data }: { data: Payload | null }) {
  const prod = data ? brl0(data.producaoGrupoMes) : "—";
  const brutaEmpresa = data ? brl0(data.comissaoBrutaEmpresa) : "—";
  // sublabel do bruto: mês/estado + (se houver) a parcela ainda não atribuída,
  // que some sozinha conforme o funcionário atribui as operações na Migração.
  const brutaSub = (() => {
    if (!data) return "";
    const n = data.comissaoBrutaEmpresaNaoAtribuidaCount;
    if (n > 0) {
      return `${data.comissaoBrutaEmpresaLabel} · ${brl0(
        data.comissaoBrutaEmpresaNaoAtribuida
      )} em ${n} não atribuída${n > 1 ? "s" : ""}`;
    }
    return data.comissaoBrutaEmpresaLabel || "o que a empresa recebe";
  })();
  const prev = data ? brl0(data.previsaoReceita) : "—";
  const lim = data ? pct1(data.limiteSimples.pct) : "—";
  const limSub = data ? `${mm2(data.limiteSimples.rbt12)} / ${mm2(data.limiteSimples.teto)}` : "";
  return (
    <header className="header">
      <div className="header-top">
        <div>
          <p className="brand">GRUPO RR CRED</p>
          <h1>Dashboard</h1>
        </div>
        <span className="badge"><span className="dot" />{data?.periodoLabel ?? "—"} · produção corrente</span>
      </div>
      <div className="stats">
        <div className="stat">
          <p className="label">Produção do grupo · mês</p>
          <div className="value num">{prod}</div>
          <div className="sub">mês corrente · parcial</div>
          {data && data.producaoNaoAtribuidaCount > 0 ? (
            <Link className="pending" href="/promotores?tab=migracao">
              {brl0(data.producaoNaoAtribuida)} em {data.producaoNaoAtribuidaCount} proposta
              {data.producaoNaoAtribuidaCount > 1 ? "s" : ""} aguardando atribuição →
            </Link>
          ) : null}
        </div>
        <div className="stat">
          <p className="label">Comissão bruta (empresa)</p>
          <div className="value num">{brutaEmpresa}</div>
          <div className="sub gold">{brutaSub}</div>
        </div>
        <div className="stat">
          <p className="label">Previsão de receita</p>
          <div className="value num">{prev}</div>
          <div className="sub amber">estimado</div>
        </div>
        <div className="stat">
          <p className="label">Limite Simples</p>
          <div className="value num">{lim}</div>
          <div className="sub green num">{limSub}</div>
        </div>
      </div>
    </header>
  );
}

function AlertProjecao({ p }: { p: Projecao }) {
  const ritmo = p.semaforo === "vermelho" ? "ritmo abaixo da meta" : "atenção ao ritmo da meta";
  return (
    <Banner
      variant="warn"
      action={<Link className="banner-link" href="/projecao">Ver projeção →</Link>}
    >
      <b>Projeção do grupo em {pct1(p.percent)} da meta</b>
      <span className="sep"> · </span>
      {p.diasDecorridos}º dia útil de {p.diasTotais} · {ritmo} de {p.mesLabel.split("/")[0]}
    </Banner>
  );
}

function ChartCard({ data, error }: { data: Payload | null; error: string }) {
  const chart = useMemo(() => (data ? buildChart(data.producaoMensal) : null), [data]);
  const corrente = data?.producaoMensal.find((m) => m.parcial);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Produção mensal do grupo · 2026</h2>
          <p className="csub">Valores em R$ milhões · produção realizada</p>
        </div>
      </div>
      <div className="chart-area">
        {error ? (
          <div className="chart-empty">{error}</div>
        ) : !chart ? (
          <div className="chart-empty">Carregando produção…</div>
        ) : (
          <svg className="chart" viewBox="0 0 1000 340" role="img" aria-label="Produção mensal do grupo em 2026">
            <defs>
              <linearGradient id="rrfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0F1F4A" stopOpacity="0.16" />
                <stop offset="60%" stopColor="#0F1F4A" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#0F1F4A" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g>
              {chart.ticks.map((t) => (
                <g key={t.v}>
                  <line x1={chart.x0} x2={chart.x1} y1={t.y} y2={t.y} stroke="#E9ECF1" strokeWidth={t.v === 0 ? 1.5 : 1} />
                  <text x={chart.x0 - 12} y={t.y + 4} textAnchor="end" fill="#9AA1B0" fontSize="13" className="mono">{t.label}</text>
                </g>
              ))}
            </g>
            <path d={chart.area} fill="url(#rrfill)" stroke="none" />
            <path d={chart.solid} fill="none" stroke="#0F1F4A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {chart.dashed ? (
              <path d={chart.dashed} fill="none" stroke="#0F1F4A" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 7" opacity="0.5" />
            ) : null}
            {chart.dots.map((d, i) => (
              <g key={i}>
                {d.parcial ? <circle cx={d.x} cy={d.y} r={9} fill="#D6A13F" opacity="0.18" /> : null}
                <circle cx={d.x} cy={d.y} r={d.parcial ? 5.5 : 4.5} fill="#D6A13F" stroke="#FFFFFF" strokeWidth="2" />
              </g>
            ))}
            {chart.xlabels.map((l, i) => (
              <text key={i} x={l.x} y={328} textAnchor="middle" fill={l.parcial ? "#0F1F4A" : "#9AA1B0"} fontSize="13" fontWeight={l.parcial ? 600 : 400}>
                {l.label}
              </text>
            ))}
          </svg>
        )}
      </div>
      <div className="chart-foot">
        <span>Total do mês corrente ({corrente?.mes ?? "—"}):</span>
        <b className="num">{corrente ? brl0(corrente.valor) : "—"}</b>
        <span>· parcial{data?.projecao ? `, ${data.projecao.diasDecorridos}/${data.projecao.diasTotais} dias úteis` : ""} · soma dos 4 CNPJs</span>
      </div>
    </section>
  );
}

function CnpjCard({ rows }: { rows: CnpjRow[] }) {
  const chipFor = (s: CnpjRow["sinal"]): ChipVariant =>
    s === "acima" ? "risk" : s === "amarelo" ? "warn" : "ok";
  const chipLabel = (s: CnpjRow["sinal"]) =>
    s === "acima" ? "Acima" : s === "amarelo" ? "Atenção" : "OK";
  return (
    <section className="card">
      <div className="card-head">
        <div><h2>Simples por CNPJ</h2></div>
        <Link className="card-link" href="/receitas">Receita / RBT12 <span className="arr">→</span></Link>
      </div>
      <Table className="cnpj-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Empresa</th>
            <th>Faixa</th>
            <th style={{ textAlign: "right" }}>RBT12</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.nome}>
              <td><Chip variant={chipFor(r.sinal)}>{chipLabel(r.sinal)}</Chip></td>
              <td>{r.nome}</td>
              <td><Chip variant="neutral" dot={false}>{r.faixa}</Chip></td>
              <Num>{brl0(r.rbt12)}</Num>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr><td colSpan={4}>Carregando…</td></tr>
          ) : null}
        </tbody>
      </Table>
    </section>
  );
}

function Shortcuts() {
  return (
    <nav className="shortcuts" aria-label="Atalhos">
      <Link className="sc" href="/auditoria">
        <span className="sc-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg></span>
        <span className="sc-name">Auditoria</span>
        <span className="sc-desc">Conferência de extratos</span>
      </Link>
      <Link className="sc" href="/projecao">
        <span className="sc-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 16 9 10 13 14 21 5" /><polyline points="21 9 21 5 17 5" /></svg></span>
        <span className="sc-name">Projeção</span>
        <span className="sc-desc">Meta do mês</span>
      </Link>
      <Link className="sc" href="/financeiro">
        <span className="sc-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="18" rx="2" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" /></svg></span>
        <span className="sc-name">DRE</span>
        <span className="sc-desc">Resultado consolidado</span>
      </Link>
      <Link className="sc" href="/receitas">
        <span className="sc-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 9.5a2.5 2.5 0 0 1 2.5-1.5c1.4 0 2.2.8 2.2 1.8 0 2.4-4.4 1.4-4.4 3.8 0 1 .9 1.8 2.2 1.8a2.5 2.5 0 0 0 2.5-1.5" /></svg></span>
        <span className="sc-name">Receita</span>
        <span className="sc-desc">RBT12 por CNPJ</span>
      </Link>
    </nav>
  );
}

// ---- construção do gráfico (eixo Y dinâmico; jan..penúltimo sólido, corrente parcial tracejado) ----
function buildChart(serie: MesPonto[]) {
  const W = 1000, H = 340, padL = 56, padR = 22, padT = 26, padB = 38;
  const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
  const n = serie.length;
  if (n === 0) return null;

  const maxMM = Math.max(...serie.map((d) => d.valor / 1e6), 0.1);
  const niceMax = Math.max(2, Math.ceil(maxMM / 2) * 2); // ~0–6 MM dinâmico
  const fx = (i: number) => (n === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * (i / (n - 1)));
  const fy = (mm: number) => y1 - (y1 - y0) * (mm / niceMax);
  const pts = serie.map((d, i) => [fx(i), fy(d.valor / 1e6)] as [number, number]);

  const smooth = (p: [number, number][]) => {
    if (p.length < 2) return p.length === 1 ? `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}` : "";
    let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  };

  // índice do primeiro parcial (mês corrente). sólido = até o último completo.
  const firstParcial = serie.findIndex((d) => d.parcial);
  const lastSolidIdx = firstParcial === -1 ? n - 1 : Math.max(0, firstParcial - 1);
  const solidPts = pts.slice(0, lastSolidIdx + 1);
  const solid = smooth(solidPts);
  const area = solidPts.length >= 2
    ? `${solid} L${solidPts[solidPts.length - 1][0].toFixed(1)},${y1} L${solidPts[0][0].toFixed(1)},${y1} Z`
    : "";
  // segmento tracejado do último completo até o corrente (parcial)
  const dashed = firstParcial > 0
    ? `M${pts[lastSolidIdx][0].toFixed(1)},${pts[lastSolidIdx][1].toFixed(1)} L${pts[firstParcial][0].toFixed(1)},${pts[firstParcial][1].toFixed(1)}`
    : "";

  const ticks = [0, niceMax / 3, (2 * niceMax) / 3, niceMax].map((v) => ({
    v,
    y: fy(v),
    label: v === 0 ? "0" : `${v.toFixed(1).replace(".", ",")}M`,
  }));
  const dots = serie.map((d, i) => ({ x: pts[i][0], y: pts[i][1], parcial: d.parcial }));
  const xlabels = serie.map((d, i) => ({ x: fx(i), label: d.mes, parcial: d.parcial }));

  return { x0, x1, solid, area, dashed, ticks, dots, xlabels };
}

const CSS = `
.rrdash{
  --navy:#0F1F4A;--navy-deep:#0B1838;--yellow:#FFF000;--gold:#D6A13F;
  --green:#3C9D6B;--green-soft:#5FB98A;--amber:#B07A12;--amber-bg:#FBF1DC;--amber-bd:#EAD7A6;
  --page:#EDEFF3;--card:#FFFFFF;--bd:#E4E7EC;--bd-soft:#EEF0F4;
  --ink:#16203A;--ink-2:#4B5468;--ink-3:#838B9C;
  --r-lg:20px;--r-md:16px;--r-sm:11px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  color:var(--ink);
}
.rrdash .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrdash .mono{font-variant-numeric:tabular-nums;}
.rrdash .wrap{max-width:1080px;margin:0 auto;padding:6px 0 24px;display:flex;flex-direction:column;gap:22px;}
.rrdash .header{background:var(--navy);border-radius:var(--r-lg);padding:30px 34px 34px;color:#fff;position:relative;overflow:hidden;}
.rrdash .header::after{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--gold),rgba(214,161,63,0));opacity:.55;}
.rrdash .header-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;}
.rrdash .brand{font-size:11.5px;font-weight:600;letter-spacing:.18em;color:var(--yellow);margin:0 0 7px;}
.rrdash .header h1{font-size:27px;font-weight:600;letter-spacing:-.01em;margin:0;color:#fff;}
.rrdash .badge{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:500;color:#C9D2E8;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);padding:7px 13px;border-radius:999px;white-space:nowrap;}
.rrdash .badge .dot{width:6px;height:6px;border-radius:50%;background:var(--green-soft);}
.rrdash .stats{margin-top:28px;display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:1px solid rgba(255,255,255,.10);padding-top:24px;}
.rrdash .stat{padding:0 26px;position:relative;}
.rrdash .stat:first-child{padding-left:0;}
.rrdash .stat + .stat::before{content:"";position:absolute;left:0;top:2px;bottom:2px;width:1px;background:rgba(255,255,255,.10);}
.rrdash .stat .label{font-size:12px;font-weight:500;letter-spacing:.01em;color:#9DA9C6;margin:0 0 10px;}
.rrdash .stat .value{font-size:30px;font-weight:600;letter-spacing:-.02em;line-height:1;color:#fff;}
.rrdash .stat .sub{font-size:12.5px;margin-top:9px;color:#8C98B6;}
.rrdash .stat .sub.amber{color:#E7BE6A;}
.rrdash .stat .sub.gold{color:var(--gold);}
.rrdash .stat .sub.green{color:var(--green-soft);}
.rrdash .stat .pending{display:inline-block;margin-top:7px;font-size:11.5px;font-weight:500;color:var(--gold-soft,#E7BE6A);text-decoration:none;border-bottom:1px dashed rgba(231,190,106,.45);padding-bottom:1px;transition:color .14s,border-color .14s;}
.rrdash .stat .pending:hover{color:#fff;border-color:rgba(255,255,255,.5);}
/* alerta de projeção agora é <Banner variant="warn"> do kit; só o link da ação fica aqui */
.rrdash .banner-link{font-size:13px;font-weight:600;color:var(--warn);text-decoration:none;white-space:nowrap;}
.rrdash .banner-link:hover{text-decoration:underline;}
.rrdash .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:26px 28px;}
.rrdash .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:6px;}
.rrdash .card-head h2{font-size:16.5px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrdash .card-head .csub{font-size:12.5px;color:var(--ink-3);margin:5px 0 0;}
.rrdash .card-link{font-size:12.5px;font-weight:600;color:var(--navy);text-decoration:none;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;}
.rrdash .card-link:hover{color:var(--gold);}
.rrdash .card-link .arr{font-size:14px;line-height:1;}
.rrdash .chart-area{margin-top:18px;}
.rrdash svg.chart{width:100%;height:auto;display:block;}
.rrdash .chart-empty{padding:48px 0;text-align:center;color:var(--ink-3);font-size:13.5px;}
.rrdash .chart-foot{margin-top:14px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:12.5px;color:var(--ink-3);}
.rrdash .chart-foot b{color:var(--ink);font-weight:600;}
/* lista "Simples por CNPJ" agora é <Table> do kit; só o espaçamento dentro do card */
.rrdash .cnpj-table{margin-top:14px;}
.rrdash .shortcuts{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
.rrdash .sc{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-md);padding:18px;text-decoration:none;color:var(--ink);display:flex;flex-direction:column;gap:12px;transition:border-color .15s, box-shadow .15s, transform .15s;}
.rrdash .sc:hover{border-color:#C7CEDA;box-shadow:var(--shadow);transform:translateY(-1px);}
.rrdash .sc .sc-ic{width:36px;height:36px;border-radius:9px;background:#F1F3F7;border:1px solid var(--bd);display:grid;place-items:center;color:var(--navy);}
.rrdash .sc:hover .sc-ic{background:var(--navy);color:var(--yellow);border-color:var(--navy);}
.rrdash .sc .sc-name{font-size:14.5px;font-weight:600;}
.rrdash .sc .sc-desc{font-size:12px;color:var(--ink-3);margin-top:-6px;}
.rrdash .sc-ic svg{display:block;}
@media (max-width:920px){
  .rrdash .stats{grid-template-columns:repeat(2,1fr);row-gap:22px;}
  .rrdash .stat:nth-child(1)::before,.rrdash .stat:nth-child(3)::before{display:none;}
  .rrdash .stat:nth-child(3),.rrdash .stat:nth-child(4){padding-left:0;}
}
@media (max-width:720px){
  .rrdash .header{padding:22px 20px 24px;}
  .rrdash .header h1{font-size:23px;}
  .rrdash .stats{grid-template-columns:1fr;gap:0;padding-top:18px;margin-top:20px;}
  .rrdash .stat{padding:18px 0;}
  .rrdash .stat:first-child{padding-top:0;}
  .rrdash .stat + .stat::before{display:none;}
  .rrdash .stat + .stat{border-top:1px solid rgba(255,255,255,.10);}
  .rrdash .stat .value{font-size:33px;}
  .rrdash .card{padding:20px 18px;}
  .rrdash .shortcuts{grid-template-columns:repeat(2,1fr);}
}
`;
