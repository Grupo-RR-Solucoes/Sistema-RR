"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  UiStyles,
  HeaderNavy,
  KpiBand,
  Table,
  Num,
  Chip,
  Banner,
  EmptyState,
} from "@/components/ui";

// Recebiveis (Camada 4) — tela navy. Consome /api/recebiveis (agregador Camada 3 +
// inadimplência Camada 1). Previsto = direito contratado (PRT) + à vista crédito
// PF da produção aberta. Recebido = realizado por produto. Tudo com cobertura
// explícita (o previsto é PARCIAL — a tela não esconde isso).

type Cobertura = { incluido: string[]; aIncluir: string[]; nota: string };
type AgMes = {
  competencia: string;
  fechado: boolean;
  previstoPrt: number | null;
  recebidoPrt: number | null;
  gapPrt: number | null;
  previstoAvista: number | null;
  recebidoAvista: number | null;
  gapAvistaInformativo: number | null;
  previstoDiferido: number | null;
  avistaFallback: { competenciaFornecedora: string; contratos: number } | null;
  cobertura: Cobertura;
};
type Agregador = {
  snapshotPrt: string;
  competenciaProducaoAberta: string;
  competenciaCaixaAvista: string;
  avistaContratosSemTrp: number;
  meses: AgMes[];
};
type InadItem = {
  operacao: string;
  comissaoMensal: number;
  parcelasRestantes: number;
  parcelasPagas: number;
  parcelasTotal: number;
};
type Inadimplencia = {
  snapshotAnterior: { competencia: string };
  snapshotRecente: { competencia: string };
  paradaAntecipada: number;
  comissaoMensalPerdida: number;
  parcelasFuturasPerdidas: number;
  itens: InadItem[];
};
type Payload = { agregador: Agregador; inadimplencia: Inadimplencia };

const brl = (v: number | null | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
const brl2 = (v: number | null | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(v);

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function fmtComp(comp: string) {
  const [y, m] = comp.split("-").map(Number);
  return `${MESES[m - 1]}/${String(y).slice(-2)}`;
}

// F6b.4 — texto técnico do badge de fallback da régua TRP (tooltip + aria-label).
// Semântica real (resolveTrpRegraDb): sem versão ativa da competência, usa a TRP
// mais recente de competência anterior; número provisório até publicar a própria.
function fallbackDesc(comp: string) {
  return `Competência sem TRP própria publicada. À vista calculado com a régua vigente de ${fmtComp(comp)} (TRP mais recente anterior). Provisório até a TRP desta competência ser publicada.`;
}

export default function RecebiveisPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const res = await fetch("/api/recebiveis");
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Erro ao carregar os recebíveis.");
        if (!cancelled) setData(j as Payload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ag = data?.agregador ?? null;
  const inad = data?.inadimplencia ?? null;

  // KPIs: recebido do último fechado, previsto do 1º futuro, carteira PRT (base).
  const kpis = useMemo(() => {
    if (!ag) return null;
    const fechados = ag.meses.filter((m) => m.fechado);
    const ultimo = fechados[fechados.length - 1] ?? null;
    const proximo = ag.meses.find((m) => !m.fechado) ?? null;
    const recebido = ultimo ? (ultimo.recebidoPrt ?? 0) + (ultimo.recebidoAvista ?? 0) : null;
    const previsto = proximo
      ? (proximo.previstoPrt ?? 0) + (proximo.previstoAvista ?? 0) + (proximo.previstoDiferido ?? 0)
      : null;
    // "Carteira PRT" = direito contratado mensal da competência do snapshot.
    const carteira = ag.meses.find((m) => m.competencia === ag.snapshotPrt)?.previstoPrt ?? null;
    return {
      recebido,
      recebidoComp: ultimo?.competencia ?? null,
      previsto,
      previstoComp: proximo?.competencia ?? null,
      carteira,
    };
  }, [ag]);

  // Gráfico de linha: realizado (recebido PRT) cheio + previsto (PRT) tracejado.
  const chart = useMemo(() => {
    if (!ag || ag.meses.length === 0) return null;
    const ms = ag.meses;
    const vals: number[] = [];
    ms.forEach((m) => {
      if (m.recebidoPrt != null) vals.push(m.recebidoPrt);
      if (m.previstoPrt != null) vals.push(m.previstoPrt);
    });
    if (vals.length === 0) return null;
    const vMax = Math.max(...vals), vMin = Math.min(...vals);
    const yHi = vMax * 1.04, yLo = Math.max(0, vMin * 0.92);
    const W = 1000, H = 300, padL = 56, padR = 18, padT = 18, padB = 42;
    const x0 = padL, x1 = W - padR, y0 = padT, y1 = H - padB;
    const n = ms.length;
    const fx = (i: number) => x0 + (n === 1 ? (x1 - x0) / 2 : ((x1 - x0) * i) / (n - 1));
    const fy = (v: number) => y1 - (y1 - y0) * ((v - yLo) / (yHi - yLo || 1));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const v = yLo + (yHi - yLo) * t;
      return { v, y: fy(v) };
    });
    const realizado = ms.map((m, i) => (m.recebidoPrt != null ? { x: fx(i), y: fy(m.recebidoPrt) } : null)).filter(Boolean) as { x: number; y: number }[];
    const previsto = ms.map((m, i) => (m.previstoPrt != null ? { x: fx(i), y: fy(m.previstoPrt) } : null)).filter(Boolean) as { x: number; y: number }[];
    const toPath = (pts: { x: number; y: number }[]) =>
      pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const labels = ms.map((m, i) => ({ x: fx(i), t: fmtComp(m.competencia).split("/")[0], cur: m.competencia === ag.snapshotPrt }));
    return { W, H, x0, x1, y1, ticks, realizadoPath: toPath(realizado), previstoPath: toPath(previsto), realizado, labels };
  }, [ag]);

  return (
    <div className="rrfc">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <Link href="/dashboard">Dashboard</Link>
          <span className="sep">/</span>
          <span>Recebíveis</span>
        </nav>

        <HeaderNavy brand="GRUPO RR CRED" title="Recebíveis" subtitle="Previsão — direito contratado vs realizado">
          {ag && kpis ? (
            <KpiBand
              valueSize={26}
              items={[
                { label: "Recebido", value: brl(kpis.recebido), sub: kpis.recebidoComp ? `realizado · ${fmtComp(kpis.recebidoComp)}` : "—" },
                { label: "Previsto (próx. mês)", value: brl(kpis.previsto), sub: kpis.previstoComp ? `PRT + à vista + diferido · ${fmtComp(kpis.previstoComp)}` : "—", subTone: "gold" },
                { label: "Carteira PRT", value: brl(kpis.carteira), sub: "direito contratado mensal", subTone: "ok", accent: true },
              ]}
            />
          ) : null}
        </HeaderNavy>

        {error ? <Banner variant="warn">{error}</Banner> : null}
        {loading ? <div className="state">Carregando recebíveis…</div> : null}

        {!loading && ag ? (
          <>
            <Banner variant="info">
              <b>Previsão parcial — leitura honesta.</b> O previsto inclui <b>PRT</b> (agenda — direito
              contratado da carteira) e <b>à vista crédito PF</b> da produção aberta (
              {fmtComp(ag.competenciaProducaoAberta)} → caixa {fmtComp(ag.competenciaCaixaAvista)}, só o já
              realizado, cresce com novas diárias). <b>A incluir:</b> outros produtos (consórcio, bbcap,
              conta corrente, dental, lob) e {ag.avistaContratosSemTrp} contratos à vista sem match no
              motor TRP. O <b>gap PRT</b> é like-for-like (recebido vs agenda da mesma competência).{" "}
              <b>A curva de previsto é DIREITO JÁ CONTRATADO:</b> decai naturalmente conforme os
              contratos quitam e <b>NÃO projeta vendas futuras</b>. Só o mês da produção aberta
              ({fmtComp(ag.competenciaProducaoAberta)}) tem venda em curso; de {fmtComp(ag.competenciaProducaoAberta)}{" "}
              em diante é puro <i>runoff</i> das vendas já realizadas — por isso não "sobe" no futuro.
            </Banner>

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>PRT — realizado &amp; previsto</h2>
                  <p className="csub">Direito já contratado, mês a mês · snapshot {fmtComp(ag.snapshotPrt)} · a parte futura é o runoff das vendas já realizadas (decai conforme quita; sem vendas futuras)</p>
                </div>
                <span className="socio">SÓCIOS</span>
              </div>
              {chart ? (
                <>
                  <svg className="flux" viewBox={`0 0 ${chart.W} ${chart.H}`} role="img" aria-label="PRT realizado e previsto">
                    {chart.ticks.map((t, i) => (
                      <g key={i}>
                        <line x1={chart.x0} x2={chart.x1} y1={t.y} y2={t.y} stroke="#E9ECF1" strokeWidth={i === 0 ? 1.5 : 1} />
                        <text x={chart.x0 - 12} y={t.y + 4} textAnchor="end" fill="#9AA1B0" fontSize="13" fontFamily="'IBM Plex Mono', monospace">
                          {`${Math.round(t.v / 1000)}k`}
                        </text>
                      </g>
                    ))}
                    <path d={chart.previstoPath} fill="none" stroke="#D6A13F" strokeWidth={2.5} strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d={chart.realizadoPath} fill="none" stroke="#0F1F4A" strokeWidth={2.75} strokeLinecap="round" strokeLinejoin="round" />
                    {chart.realizado.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#0F1F4A" />
                    ))}
                    {chart.labels.map((l, i) => (
                      <text key={i} x={l.x} y={chart.H - 14} textAnchor="middle" fill={l.cur ? "#0F1F4A" : "#9AA1B0"} fontSize="12.5" fontWeight={l.cur ? 600 : 400}>
                        {l.t}
                      </text>
                    ))}
                  </svg>
                  <div className="legend">
                    <span><i className="re" />Realizado (recebido)</span>
                    <span><i className="pv" />Previsto (direito contratado — runoff, sem vendas futuras)</span>
                  </div>
                </>
              ) : (
                <div className="state">Sem dados de carteira PRT.</div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Quadro mês a mês</h2>
                  <p className="csub">Recebido por produto · previsto · gap PRT (acionável)</p>
                </div>
              </div>
              <Table className="fc-tbl">
                <thead>
                  <tr>
                    <th>Competência</th>
                    <th className="r">Recebido</th>
                    <th className="r">Prev. PRT</th>
                    <th className="r">Prev. à vista</th>
                    <th className="r">Prev. diferido</th>
                    <th className="r">Gap PRT</th>
                    <th>Cobertura</th>
                  </tr>
                </thead>
                <tbody>
                  {ag.meses.map((m) => {
                    const recebido = m.fechado ? (m.recebidoPrt ?? 0) + (m.recebidoAvista ?? 0) : null;
                    const gapTone = m.gapPrt == null ? "" : m.gapPrt < -0.005 ? "neg" : "pos";
                    return (
                      <tr key={m.competencia}>
                        <td>
                          <span className="comp">{fmtComp(m.competencia)}</span>{" "}
                          <Chip variant={m.fechado ? "ok" : "neutral"}>{m.fechado ? "fechado" : "futuro"}</Chip>
                        </td>
                        <Num>{brl(recebido)}</Num>
                        <Num>{brl(m.previstoPrt)}</Num>
                        <Num>{brl(m.previstoAvista)}</Num>
                        <Num>{brl(m.previstoDiferido)}</Num>
                        <Num className={`gap ${gapTone}`}>{m.gapPrt == null ? "—" : brl2(m.gapPrt)}</Num>
                        <td className="cob" title={m.cobertura.nota}>
                          {m.cobertura.incluido.length > 0 ? m.cobertura.incluido.map((x) => x.split(" (")[0]).join(" + ") : "—"}
                          {m.avistaFallback ? (
                            <span
                              className="fb-badge"
                              role="note"
                              title={fallbackDesc(m.avistaFallback.competenciaFornecedora)}
                              aria-label={fallbackDesc(m.avistaFallback.competenciaFornecedora)}
                            >
                              <Chip variant="warn">
                                Régua TRP · {fmtComp(m.avistaFallback.competenciaFornecedora)}
                                {m.avistaFallback.contratos > 0 ? (
                                  <span className="fb-n"> · {m.avistaFallback.contratos} contratos</span>
                                ) : null}
                              </Chip>
                            </span>
                          ) : null}
                          <span className="falta">+{m.cobertura.aIncluir.length} a incluir</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </section>

            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Inadimplência / parada antecipada</h2>
                  <p className="csub">
                    {inad ? `${fmtComp(inad.snapshotAnterior.competencia)} → ${fmtComp(inad.snapshotRecente.competencia)}` : ""} · contratos que pararam de pingar antes de quitar
                  </p>
                </div>
                <span className="socio gold">GANCHO DE AUDITORIA</span>
              </div>
              {inad && inad.paradaAntecipada > 0 ? (
                <>
                  <div className="inad-kpis">
                    <div className="ik">
                      <span className="kl">Contratos</span>
                      <span className="kv num">{inad.paradaAntecipada}</span>
                    </div>
                    <div className="ik">
                      <span className="kl">R$/mês que sumiu</span>
                      <span className="kv num gold">{brl2(inad.comissaoMensalPerdida)}</span>
                    </div>
                    <div className="ik">
                      <span className="kl">Parcelas futuras perdidas</span>
                      <span className="kv num">{inad.parcelasFuturasPerdidas}</span>
                    </div>
                  </div>
                  <Table className="fc-tbl">
                    <thead>
                      <tr>
                        <th>Nº Operação</th>
                        <th className="r">Comissão/mês</th>
                        <th className="r">Restantes</th>
                        <th className="r">Pgs / Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inad.itens.slice(0, 10).map((it) => (
                        <tr key={it.operacao}>
                          <td className="comp">{it.operacao}</td>
                          <Num>{brl2(it.comissaoMensal)}</Num>
                          <Num>{it.parcelasRestantes}</Num>
                          <Num>{it.parcelasPagas} / {it.parcelasTotal}</Num>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {inad.itens.length > 10 ? (
                    <p className="more">+{inad.itens.length - 10} contratos não exibidos.</p>
                  ) : null}
                </>
              ) : (
                <EmptyState
                  title="Nenhuma parada antecipada detectada"
                  description="Nenhum contrato vivo sumiu da carteira sem quitar entre os dois últimos fechamentos."
                />
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

const CSS = `
.rrfc{
  --navy:#0F1F4A; --gold:#D6A13F; --gold-deep:#B9842A; --green:#3C9D6B; --red:#C0443C;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C; --r-lg:20px; --r-md:16px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  background:var(--page);color:var(--ink);font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.45;
}
.rrfc *{box-sizing:border-box;}
.rrfc .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrfc .wrap{max-width:1080px;margin:0 auto;padding:34px 28px 56px;display:flex;flex-direction:column;gap:22px;}
.rrfc .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:-6px 2px -4px;}
.rrfc .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rrfc .crumb a:hover{color:var(--navy);}
.rrfc .crumb .sep{color:#C2C8D2;}
.rrfc .state{padding:24px 4px;font-size:13.5px;color:var(--ink-3);}
.rrfc .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:26px 28px;}
.rrfc .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px;}
.rrfc .card-head h2{font-size:16.5px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrfc .card-head .csub{font-size:12.5px;color:var(--ink-3);margin:5px 0 0;}
.rrfc .socio{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--gold-deep);white-space:nowrap;}
.rrfc .socio.gold{color:var(--gold-deep);}
.rrfc svg.flux{width:100%;height:auto;display:block;}
.rrfc .legend{display:flex;gap:18px;margin-top:14px;font-size:12px;color:var(--ink-2);}
.rrfc .legend span{display:inline-flex;align-items:center;gap:7px;}
.rrfc .legend i{width:18px;height:0;border-top-width:3px;border-top-style:solid;display:inline-block;border-radius:3px;}
.rrfc .legend i.re{border-top-color:var(--navy);}
.rrfc .legend i.pv{border-top-color:var(--gold);border-top-style:dashed;}
.rrfc .comp{font-weight:600;color:var(--ink);}
.rrfc table.rrui-table th.r,.rrfc table.rrui-table td.rrui-table__num{text-align:right;}
.rrfc .gap.pos{color:var(--green);font-weight:600;}
.rrfc .gap.neg{color:var(--red);font-weight:700;}
.rrfc .cob{font-size:12px;color:var(--ink-2);}
.rrfc .cob .falta{display:inline-block;margin-left:8px;font-size:11px;color:var(--gold-deep);font-weight:600;}
.rrfc .cob .fb-badge{display:inline-block;margin-left:8px;vertical-align:middle;}
.rrfc .cob .fb-n{opacity:.75;font-weight:500;}
.rrfc .inad-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px;}
.rrfc .ik{background:#F7F8FB;border:1px solid var(--bd-soft);border-radius:var(--r-md);padding:14px 16px;display:flex;flex-direction:column;gap:4px;}
.rrfc .ik .kl{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3);}
.rrfc .ik .kv{font-size:21px;font-weight:700;color:var(--ink);font-family:'IBM Plex Mono',monospace;}
.rrfc .ik .kv.gold{color:var(--gold-deep);}
.rrfc .more{font-size:12px;color:var(--ink-3);margin:12px 2px 0;}
@media (max-width:760px){
  .rrfc .wrap{padding:18px 16px 40px;gap:16px;}
  .rrfc .card{padding:20px 18px;}
  .rrfc .inad-kpis{grid-template-columns:1fr;}
}
`;
