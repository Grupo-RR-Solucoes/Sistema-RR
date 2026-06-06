"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

// ============================================================
// FECHAMENTO (Etapa 8) — fiel ao Fechamento_referencia.html (identidade), FOCADO EM
// RECEBIDO (real). Previsto/cobertura/gap ficam de fora: o forecast vem zerado pelo
// Bug 1 nos meses fechados — não exibir número enganoso. Default = último mês fechado;
// mês aberto = "aguardando fechamento". Nomes padronizados. socio-only.
// ============================================================

type Period = { year: number; month: number; key: string; label: string; fechado: boolean };
type Row = { nome: string; cnpj: string; recebido: number; participacao: number };
type Bar = { mes: string; key: string; recebido: number };
type Payload = {
  periods: Period[];
  selectedPeriod: Period | null;
  aguardandoFechamento: boolean;
  summary: { recebido: number; empresas: number; variacaoPct: number | null } | null;
  companyRows: Row[];
  recebidoPorMes: Bar[];
};

function brl0(v?: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(v || 0));
}
function pct1(v?: number) { return `${Number(v || 0).toFixed(1).replace(".", ",")}%`; }
function signedPct(v: number) { return `${v >= 0 ? "+" : "−"}${pct1(Math.abs(v))}`; }
function brlK(v?: number) { return `R$ ${(Number(v || 0) / 1000).toFixed(0)}k`; }

export default function FechamentoPage() {
  const [selectedKey, setSelectedKey] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    const params = new URLSearchParams();
    if (selectedKey) { const [y, m] = selectedKey.split("-"); params.set("year", y); params.set("month", String(Number(m))); }
    fetch(`/api/fechamento${params.toString() ? `?${params}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar fechamento."))))
      .then((j) => { if (!cancel) setData(j); })
      .catch((e) => { if (!cancel) setError(e.message); });
    return () => { cancel = true; };
  }, [selectedKey]);

  const periodValue = selectedKey || data?.selectedPeriod?.key || "";
  const sel = data?.selectedPeriod;
  const aguard = data?.aguardandoFechamento;
  const s = data?.summary;

  return (
    <div className="rrfech">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb"><Link href="/dashboard">Visão geral</Link><span className="sep">/</span><span>Fechamento</span></nav>

        <header className="header">
          <div className="header-top">
            <div><p className="brand">GRUPO RR CRED</p><h1>Fechamento mensal</h1></div>
            <div className="comp">
              <select aria-label="Competência" value={periodValue} onChange={(e) => setSelectedKey(e.target.value)}>
                {(data?.periods ?? []).map((p) => (
                  <option key={p.key} value={p.key}>{p.label} · {p.fechado ? "fechado" : "em aberto"}</option>
                ))}
              </select>
              <span className="chev">▾</span>
            </div>
          </div>

          <div className="stats">
            <div className="stat"><p className="label">Recebido real</p><div className="value num">{s ? brl0(s.recebido) : "—"}</div><div className="sub">crédito confirmado na competência</div></div>
            <div className="stat"><p className="label">Empresas</p><div className="value num">{s ? s.empresas : "—"}</div><div className="sub">CNPJs com recebimento</div></div>
            <div className="stat"><p className="label">vs mês anterior</p><div className="value num">{s && s.variacaoPct != null ? signedPct(s.variacaoPct) : "—"}</div><div className={`sub${s && s.variacaoPct != null && s.variacaoPct >= 0 ? " green" : ""}`}>{s && s.variacaoPct != null ? "variação do recebido" : "sem mês anterior"}</div></div>
          </div>
        </header>

        {error ? <div className="aguard">{error}</div> : null}

        {aguard && !error ? (
          <div className="aguard">
            <strong>Aguardando fechamento de {sel?.label ?? "—"}.</strong> A competência ainda está em aberto — o recebido real só existe após o fechamento do mês. Selecione um mês fechado.
          </div>
        ) : null}

        {!aguard && !error && data ? (
          <>
            <p className="note"><span className="dot" /><b>Competência fechada</b>&nbsp;· recebimento confirmado</p>

            <section className="card">
              <div className="card-head"><div><h2>Recebido por empresa</h2><p className="csub">Crédito confirmado na competência · {sel?.label ?? ""}</p></div></div>
              <div className="tbl">
                <div className="thead">
                  <span className="h">Empresa</span><span className="h r">Recebido</span><span className="h r">Participação</span>
                </div>
                {data.companyRows.map((r) => (
                  <div className="trow" key={r.cnpj}>
                    <div className="emp"><span className="st" />{r.nome}</div>
                    <div className="cell"><span className="k">Recebido</span><span className="v num">{brl0(r.recebido)}</span></div>
                    <div className="cell"><span className="k">Participação</span><span className="v num muted">{pct1(r.participacao)}</span></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="card">
              <div className="card-head"><div><h2>Recebido por mês</h2><p className="csub">Crédito confirmado · meses fechados de 2026</p></div></div>
              <Bars items={data.recebidoPorMes} selKey={sel?.key} />
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function Bars({ items, selKey }: { items: Bar[]; selKey?: string }) {
  const max = useMemo(() => Math.max(1, ...items.map((d) => d.recebido)), [items]);
  if (!items.length) return <div className="aguard">Sem recebimento mensal para exibir.</div>;
  const floorPx = 70, topPx = 158;
  return (
    <>
      <div className="bars">
        {items.map((d) => {
          const cur = d.key === selKey;
          const px = floorPx + (topPx - floorPx) * (d.recebido / max);
          return (
            <div className={`barcol${cur ? " cur" : ""}`} key={d.key}>
              <span className="bval num">{brlK(d.recebido)}</span>
              <div className="bar" style={{ height: `${px.toFixed(0)}px` }} />
            </div>
          );
        })}
      </div>
      <div className="xrow">
        {items.map((d) => (<span key={d.key} className={d.key === selKey ? "cur" : ""}>{d.mes}</span>))}
      </div>
    </>
  );
}

const CSS = `
.rrfech{
  --navy:#0F1F4A;--navy-deep:#0B1838;--navy-bar:#1E3066;--yellow:#FFF000;--gold:#D6A13F;
  --green:#3C9D6B;--green-soft:#5FB98A;--red:#C0443C;
  --page:#EDEFF3;--card:#FFFFFF;--bd:#E4E7EC;--bd-soft:#EEF0F4;--ink:#16203A;--ink-2:#4B5468;--ink-3:#838B9C;
  --amber-bg:#FBF1DC;--amber-bd:#EAD7A6;
  --r-lg:20px;--r-md:16px;--shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  color:var(--ink);
}
.rrfech .num{font-variant-numeric:tabular-nums;}
.rrfech .wrap{max-width:1080px;margin:0 auto;padding:6px 0 24px;display:flex;flex-direction:column;gap:22px;}
.rrfech .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);}
.rrfech .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rrfech .crumb a:hover{color:var(--navy);}
.rrfech .crumb .sep{color:#C2C8D2;}
.rrfech .header{background:var(--navy);border-radius:var(--r-lg);padding:30px 34px 34px;color:#fff;position:relative;overflow:hidden;}
.rrfech .header::after{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--gold),rgba(214,161,63,0));opacity:.55;}
.rrfech .header-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;}
.rrfech .brand{font-size:11.5px;font-weight:600;letter-spacing:.18em;color:var(--yellow);margin:0 0 7px;}
.rrfech .header h1{font-size:27px;font-weight:600;letter-spacing:-.01em;margin:0;color:#fff;}
.rrfech .comp{position:relative;}
.rrfech .comp select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 36px 8px 14px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rrfech .comp select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rrfech .comp .chev{position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:#9DA9C6;font-size:11px;}
.rrfech .stats{margin-top:28px;display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid rgba(255,255,255,.10);padding-top:24px;}
.rrfech .stat{padding:0 26px;position:relative;}
.rrfech .stat:first-child{padding-left:0;}
.rrfech .stat + .stat::before{content:"";position:absolute;left:0;top:2px;bottom:2px;width:1px;background:rgba(255,255,255,.10);}
.rrfech .stat .label{font-size:12px;font-weight:500;color:#9DA9C6;margin:0 0 10px;}
.rrfech .stat .value{font-size:38px;font-weight:600;letter-spacing:-.02em;line-height:1;color:#fff;}
.rrfech .stat .sub{font-size:12.5px;margin-top:9px;color:#8C98B6;}
.rrfech .stat .sub.green{color:var(--green-soft);}
.rrfech .note{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--ink-3);}
.rrfech .note .dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(60,157,107,.13);}
.rrfech .note b{color:var(--ink-2);font-weight:600;}
.rrfech .aguard{background:var(--amber-bg);border:1px solid var(--amber-bd);border-radius:var(--r-md);padding:16px 18px;font-size:13.5px;line-height:1.55;color:#5C4A1E;}
.rrfech .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:26px 28px;}
.rrfech .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:4px;}
.rrfech .card-head h2{font-size:16.5px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrfech .card-head .csub{font-size:12.5px;color:var(--ink-3);margin:5px 0 0;}
.rrfech .tbl{margin-top:16px;}
.rrfech .thead,.rrfech .trow{display:grid;grid-template-columns:1.6fr 1fr 1fr;align-items:center;gap:14px;}
.rrfech .thead{padding:0 2px 10px;border-bottom:1px solid var(--bd);}
.rrfech .thead .h{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);}
.rrfech .thead .h.r,.rrfech .trow .v{text-align:right;}
.rrfech .trow{padding:14px 2px;border-top:1px solid var(--bd-soft);}
.rrfech .trow:first-of-type{border-top:none;}
.rrfech .trow .emp{display:flex;align-items:center;gap:11px;font-size:14.5px;font-weight:600;color:var(--ink);}
.rrfech .trow .emp .st{width:9px;height:9px;border-radius:50%;background:var(--green);flex:none;box-shadow:0 0 0 3px rgba(60,157,107,.13);}
.rrfech .cell .k{display:none;}
.rrfech .cell .v{font-size:14.5px;font-weight:600;color:var(--ink);}
.rrfech .cell .v.muted{color:var(--ink-2);font-weight:500;}
.rrfech .bars{margin-top:22px;display:grid;grid-template-columns:repeat(auto-fit, minmax(40px, 1fr));gap:18px;align-items:end;height:210px;padding-top:10px;border-bottom:1px solid var(--bd);}
.rrfech .barcol{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:200px;gap:8px;}
.rrfech .barcol .bval{font-size:12px;font-weight:600;color:var(--ink-2);}
.rrfech .barcol.cur .bval{color:var(--gold);}
.rrfech .bar{width:46px;max-width:62%;background:var(--navy-bar);border-radius:6px 6px 0 0;}
.rrfech .barcol.cur .bar{background:var(--navy);}
.rrfech .xrow{display:grid;grid-template-columns:repeat(auto-fit, minmax(40px, 1fr));gap:18px;margin-top:10px;}
.rrfech .xrow span{text-align:center;font-size:12.5px;color:var(--ink-3);}
.rrfech .xrow span.cur{color:var(--navy);font-weight:600;}
@media (max-width:720px){
  .rrfech .header{padding:22px 20px 24px;}
  .rrfech .header h1{font-size:22px;}
  .rrfech .stats{grid-template-columns:1fr;padding-top:18px;margin-top:20px;}
  .rrfech .stat{padding:18px 0;}
  .rrfech .stat:first-child{padding-top:0;}
  .rrfech .stat + .stat::before{display:none;}
  .rrfech .stat + .stat{border-top:1px solid rgba(255,255,255,.10);}
  .rrfech .stat .value{font-size:32px;}
  .rrfech .card{padding:20px 18px;}
  .rrfech .thead{display:none;}
  .rrfech .trow{grid-template-columns:1fr 1fr;gap:10px 14px;padding:16px 0;}
  .rrfech .trow .emp{grid-column:1 / -1;margin-bottom:2px;}
  .rrfech .cell{display:flex;flex-direction:column;gap:2px;}
  .rrfech .cell .v{text-align:left;}
  .rrfech .cell .k{display:block;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3);}
  .rrfech .bars{gap:8px;height:180px;}
  .rrfech .barcol{height:170px;}
  .rrfech .bar{width:100%;}
  .rrfech .xrow{gap:8px;}
  .rrfech .barcol .bval{font-size:10.5px;}
}
`;
