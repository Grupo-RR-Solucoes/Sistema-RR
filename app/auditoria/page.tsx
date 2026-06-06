"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import HistoricalFindingsSection from "../../components/auditoria/HistoricalFindingsSection";

// ============================================================
// AUDITORIA (Etapa 8) — fiel ao Auditoria_referencia.html + REGRA da trava.
// Recuperável = NOVO (curado v9 NOT EXISTS cobranca_itens). Hoje ~R$0 (tudo até abril
// já cobrado). Seção "já cobrado" = âncora (informativa). Ciclo PRT mantido (e49bc42).
// Histórico curado sob demanda (botão). socio-only.
// ============================================================

type Period = { year: number; month: number; key: string; label: string; fechado: boolean };
type Cobranca = { emitidaEm: string; competenciaDe: string; competenciaAte: string; valorAvista: number; valorPrt: number; valorTotal: number; descricao: string | null; contratos: number };
type PrtCiclo = { previsto: number; recebido: number; naoPago: number; entradas: number } | null;
type Payload = {
  periods: Period[];
  selectedPeriod: Period | null;
  recuperavel: { avista: number; prt: number; total: number; contratos: number };
  jaCobrado: Cobranca[];
  prtCiclo: PrtCiclo;
  aguardandoCuradoria: boolean;
  curadoAteLabel: string;
};

function brl2(v?: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0)); }
function brl0(v?: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(v || 0)); }
function compLabel(iso: string) { const [y, m] = iso.split("-"); const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]; return `${MES[Number(m) - 1]}/${y}`; }

export default function AuditoriaPage() {
  const [selectedKey, setSelectedKey] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [showHist, setShowHist] = useState(false);

  useEffect(() => {
    let cancel = false;
    const params = new URLSearchParams();
    if (selectedKey) { const [y, m] = selectedKey.split("-"); params.set("year", y); params.set("month", String(Number(m))); }
    setShowHist(false);
    fetch(`/api/auditoria${params.toString() ? `?${params}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar auditoria."))))
      .then((j) => { if (!cancel) setData(j); })
      .catch((e) => { if (!cancel) setError(e.message); });
    return () => { cancel = true; };
  }, [selectedKey]);

  const periodValue = selectedKey || data?.selectedPeriod?.key || "";
  const sel = data?.selectedPeriod;
  const rec = data?.recuperavel;
  const nada = rec ? rec.total === 0 : true;
  const prt = data?.prtCiclo;

  return (
    <div className="rraud">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb"><Link href="/">Visão geral</Link><span className="sep">/</span><span>Auditoria</span></nav>

        <header className="header">
          <div className="header-top">
            <div><p className="brand">GRUPO RR CRED</p><h1>Auditoria de divergências</h1></div>
            <div className="comp">
              <select aria-label="Competência" value={periodValue} onChange={(e) => setSelectedKey(e.target.value)}>
                {(data?.periods ?? []).filter((p) => p.fechado).map((p) => (<option key={p.key} value={p.key}>{p.label}</option>))}
              </select>
              <span className="chev">▾</span>
            </div>
          </div>

          <div className="hero">
            <div>
              <p className="lbl"><span className="tag">A recuperar</span> Recuperável novo</p>
              <div className="big num">{brl2(rec?.total)}</div>
              <div className="sub">{nada ? `nada novo a recuperar — tudo até ${data?.curadoAteLabel ?? "abril"} já cobrado` : `${rec?.contratos} contratos curados não cobrados`}</div>
            </div>
            <p className="aside">Recuperável = auditoria curada (v9) que ainda <b>não</b> entrou em nenhuma cobrança emitida. Exclui por contrato o que já foi cobrado.</p>
          </div>
        </header>

        {error ? <div className="aguard">{error}</div> : null}

        {/* CICLO PRT (estimativa automática, e49bc42) */}
        {prt ? (
          <section className="card">
            <div className="card-head"><div><h2>Ciclo PRT</h2><p className="csub">Competência {sel?.label ?? "—"}</p></div></div>
            <div className="prt">
              <div className="cell"><p className="k">PRT previsto</p><div className="val num">{brl0(prt.previsto)}</div></div>
              <div className="cell"><p className="k">PRT recebido</p><div className="val num">{brl0(prt.recebido)}</div></div>
              <div className="cell alert"><p className="k">PRT não pago</p><div className="val num">{brl0(prt.naoPago)}</div></div>
            </div>
            <div className="prt-foot"><span className="gi">∿</span> Estimativa automática do fechamento · {prt.entradas} parcelas listadas. Não é auditoria curada — não entra no recuperável.</div>
          </section>
        ) : null}

        {/* AGUARDANDO CURADORIA */}
        {data?.aguardandoCuradoria ? (
          <div className="aguard">
            <strong>Aguardando curadoria de {sel?.label ?? "—"}.</strong> A auditoria curada (v9) vai até {data.curadoAteLabel}. Para meses posteriores, o recuperável só é confiável após a planilha curada do mês — o número bruto do ciclo acima é só estimativa, não vira "a recuperar".
          </div>
        ) : null}

        {/* JÁ COBRADO (âncora, informativo) */}
        {data?.jaCobrado?.length ? (
          <section className="card">
            <div className="card-head"><div><h2>Já cobrado</h2><p className="csub">Histórico de cobranças emitidas — informativo, não entra no recuperável</p></div></div>
            {data.jaCobrado.map((c) => (
              <div className="cob" key={c.emitidaEm}>
                <div className="cob-main">
                  <div className="cob-total num">{brl2(c.valorTotal)}</div>
                  <div className="cob-meta">{c.descricao || "Cobrança emitida"} · {c.contratos.toLocaleString("pt-BR")} contratos</div>
                </div>
                <div className="cob-break">
                  <span><i>à vista</i> <b className="num">{brl2(c.valorAvista)}</b></span>
                  <span><i>PRT</i> <b className="num">{brl2(c.valorPrt)}</b></span>
                  <span><i>período</i> <b>{compLabel(c.competenciaDe)} → {compLabel(c.competenciaAte)}</b></span>
                  <span><i>emitida</i> <b>{c.emitidaEm.split("-").reverse().join("/")}</b></span>
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {/* CARREGAR HISTÓRICO SOB DEMANDA */}
        <div className="load">
          <p className="lt"><b>Auditoria histórica não carregada.</b> A conferência curada automática (motor) de competências anteriores é pesada (pode levar ~2 min). Carregue sob demanda.</p>
          {!showHist ? (
            <button className="btn" onClick={() => setShowHist(true)} disabled={!sel}>Carregar auditoria histórica <span className="ar">→</span></button>
          ) : null}
        </div>

        {showHist && sel ? <HistoricalFindingsSection year={sel.year} month={sel.month} /> : null}
      </main>
    </div>
  );
}

const CSS = `
.rraud{
  --navy:#0F1F4A;--yellow:#FFF000;--gold:#D6A13F;--gold-deep:#B9842A;
  --green:#3C9D6B;--red:#C0443C;--red-bg:#FBECEB;
  --page:#EDEFF3;--card:#FFFFFF;--bd:#E4E7EC;--bd-soft:#EEF0F4;--ink:#16203A;--ink-2:#4B5468;--ink-3:#838B9C;
  --amber-bg:#FBF1DC;--amber-bd:#EAD7A6;
  --r-lg:20px;--r-md:16px;--shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  color:var(--ink);
}
.rraud .num{font-variant-numeric:tabular-nums;}
.rraud .wrap{max-width:1080px;margin:0 auto;padding:6px 0 24px;display:flex;flex-direction:column;gap:22px;}
.rraud .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);}
.rraud .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rraud .crumb a:hover{color:var(--navy);}
.rraud .crumb .sep{color:#C2C8D2;}
.rraud .header{background:var(--navy);border-radius:var(--r-lg);padding:30px 34px 34px;color:#fff;position:relative;overflow:hidden;}
.rraud .header::after{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--gold),rgba(214,161,63,0));opacity:.6;}
.rraud .header-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;}
.rraud .brand{font-size:11.5px;font-weight:600;letter-spacing:.18em;color:var(--yellow);margin:0 0 7px;}
.rraud .header h1{font-size:27px;font-weight:600;letter-spacing:-.01em;margin:0;color:#fff;}
.rraud .comp{position:relative;}
.rraud .comp select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 36px 8px 14px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rraud .comp select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rraud .comp .chev{position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:#9DA9C6;font-size:11px;}
.rraud .hero{margin-top:28px;border-top:1px solid rgba(255,255,255,.10);padding-top:24px;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;}
.rraud .hero .lbl{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:500;color:#9DA9C6;margin:0 0 12px;}
.rraud .hero .lbl .tag{font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--gold);background:rgba(214,161,63,.14);border:1px solid rgba(214,161,63,.32);padding:2px 8px;border-radius:999px;}
.rraud .hero .big{font-size:52px;font-weight:700;letter-spacing:-.025em;line-height:.95;color:var(--gold);}
.rraud .hero .sub{font-size:13px;color:#A6B0CB;margin-top:11px;}
.rraud .hero .aside{font-size:12.5px;color:#8C98B6;max-width:260px;text-align:right;line-height:1.5;}
.rraud .hero .aside b{color:#C9D2E8;font-weight:600;}
.rraud .aguard{background:var(--amber-bg);border:1px solid var(--amber-bd);border-radius:var(--r-md);padding:16px 18px;font-size:13.5px;line-height:1.55;color:#5C4A1E;}
.rraud .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:26px 28px;}
.rraud .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
.rraud .card-head h2{font-size:16.5px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rraud .card-head .csub{font-size:12.5px;color:var(--ink-3);margin:5px 0 0;}
.rraud .prt{display:grid;grid-template-columns:repeat(3,1fr);margin-top:20px;}
.rraud .prt .cell{padding:0 24px;position:relative;}
.rraud .prt .cell:first-child{padding-left:0;}
.rraud .prt .cell + .cell::before{content:"";position:absolute;left:0;top:4px;bottom:4px;width:1px;background:var(--bd);}
.rraud .prt .k{font-size:12px;font-weight:500;color:var(--ink-3);margin:0 0 9px;}
.rraud .prt .val{font-size:30px;font-weight:600;letter-spacing:-.02em;line-height:1;color:var(--ink);}
.rraud .prt .cell.alert .val{color:var(--red);}
.rraud .prt .cell.alert .k{color:var(--red);}
.rraud .prt-foot{margin-top:18px;padding-top:14px;border-top:1px solid var(--bd-soft);font-size:12px;color:var(--ink-3);display:flex;align-items:center;gap:8px;}
.rraud .prt-foot .gi{width:16px;height:16px;border-radius:5px;background:#F1F3F7;border:1px solid var(--bd);display:grid;place-items:center;font-size:10px;color:var(--ink-3);}
.rraud .cob{margin-top:16px;padding-top:16px;border-top:1px solid var(--bd-soft);display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;}
.rraud .cob:first-of-type{border-top:none;margin-top:18px;padding-top:0;}
.rraud .cob-total{font-size:26px;font-weight:700;letter-spacing:-.02em;color:var(--gold-deep);line-height:1;}
.rraud .cob-meta{font-size:12.5px;color:var(--ink-3);margin-top:7px;}
.rraud .cob-break{display:flex;gap:22px;flex-wrap:wrap;align-items:flex-end;}
.rraud .cob-break span{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--ink-3);}
.rraud .cob-break i{font-style:normal;text-transform:uppercase;letter-spacing:.04em;font-size:10.5px;}
.rraud .cob-break b{font-size:14px;font-weight:600;color:var(--ink);}
.rraud .load{background:var(--card);border:1px dashed #CDD3DE;border-radius:var(--r-md);padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.rraud .load .lt{font-size:13px;color:var(--ink-2);max-width:560px;}
.rraud .load .lt b{color:var(--ink);font-weight:600;}
.rraud .btn{flex:none;display:inline-flex;align-items:center;gap:8px;background:var(--navy);color:#fff;border:none;border-radius:10px;padding:11px 18px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;}
.rraud .btn:hover{background:#16285C;}
.rraud .btn[disabled]{opacity:.5;cursor:default;}
.rraud .btn .ar{color:var(--yellow);font-size:13px;}
@media (max-width:720px){
  .rraud .header{padding:22px 20px 24px;}
  .rraud .header h1{font-size:22px;}
  .rraud .hero{padding-top:18px;margin-top:20px;}
  .rraud .hero .big{font-size:42px;}
  .rraud .hero .aside{text-align:left;max-width:none;}
  .rraud .card{padding:20px 18px;}
  .rraud .prt{grid-template-columns:1fr;}
  .rraud .prt .cell{padding:16px 0;border-top:1px solid var(--bd-soft);}
  .rraud .prt .cell:first-child{padding-top:0;border-top:none;}
  .rraud .prt .cell + .cell::before{display:none;}
  .rraud .cob{flex-direction:column;gap:14px;}
  .rraud .load{flex-direction:column;align-items:flex-start;}
}
`;
