"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { UiStyles, HeaderNavy, KpiBand, Banner, Table, Num, Chip } from "@/components/ui";
import type { ChipVariant } from "@/components/ui";
import FatorRSection from "@/components/dashboard/FatorRSection";
import type { ResultadoDelta } from "@/lib/delta/calcularDelta";

// ============================================================
// DASHBOARD (Visão geral). Header = bloco navy com os 4 stats embutidos
// (formato original — KPI-sobre-navy, decisão do Diego). Piloto Etapa 3 parcial:
// alerta de projeção → <Banner variant="warn"> e "Simples por CNPJ" →
// <Table>/<Num>/<Chip> do kit; <UiStyles/> injeta a CSS dos primitivos. LÓGICA,
// FETCH e CÁLCULOS INALTERADOS. Gráfico = produção REALIZADA do grupo
// (promoter_monthly_results); jun = mês corrente PARCIAL, marcado.
//
// DELTA vs mes anterior (Frente DELTA, Fase 1) — 3 dos 6 KPIs:
//   COM delta: Producao do grupo, Comissao bruta (empresa), Comissao de seguro.
//   SEM delta, de proposito:
//     - Previsao de receita: e um pipeline ESTIMADO para frente (closingAnalytics
//       em fastDashboardMode), nao uma serie historica. Nao existe "previsao de
//       junho" guardada para comparar — o delta seria inventado.
//     - Limite Simples: RBT12 e janela movel de 12 meses. A variacao mes-a-mes
//       e estruturalmente pequena e a leitura util do card e "% do teto", nao a
//       variacao. Candidato de Fase 3 se o Diego quiser.
//     - Penetracao media (Seguridade): metrica percentual — variaria em p.p.
//       (o helper ja suporta), mas o M-1 exige um buildPromoterAnalytics inteiro
//       da competencia anterior, caro demais para pendurar no Dashboard agora.
//       Fase 3.
// A CONTA NAO MORA AQUI: os deltas chegam prontos de /api/dashboard, calculados
// por lib/delta/calcularDelta. Esta tela so repassa para o <KpiBand>.
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
  // MOV 2 (A): competência renderizada + regime dela ('cms' | 'fechamento' | 'open').
  year: number;
  month: number;
  regime: "cms" | "fechamento" | "open";
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
  // Seguridade (DB-driven). penetracaoSeguroGrupo = fração 0..1 (ponderada,
  // atribuído-only). seguroMasterSemRegra = contratos master sem regra de seguro.
  comissaoSeguroGrupo: number;
  penetracaoSeguroGrupo: number;
  seguroLabel: string;
  seguroMasterSemRegra: number;
  // DELTA vs mes anterior — vem PRONTO da rota (lib/delta/calcularDelta roda no
  // servidor). Esta tela so repassa para o <KpiBand delta=...>; nao ha conta de
  // delta aqui, nem pode haver (ver REGRA DE OURO no helper).
  deltaProducao: ResultadoDelta;
  deltaComissaoEmpresa: ResultadoDelta;
  deltaComissaoSeguro: ResultadoDelta;
  // 3b — previsao do mes cheio x receita REALIZADA do M-1 (tambem mes cheio).
  // Unico card cujas pontas sao metricas diferentes de proposito; por isso
  // fontesDivergentes vem true e nao ha rotulo de janela.
  deltaPrevisaoReceita: ResultadoDelta;
  receitaRealizadaAnterior: number | null;
};

function brl0(v?: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(
    Number(v || 0)
  );
}
/**
 * 4a — valor EXATO, com centavos. O grafico mostra o eixo em milhoes e o card
 * usa brl0 (sem centavos); o tooltip existe justamente para dar o numero cheio,
 * entao arredondar aqui anularia o motivo dele.
 */
function brlExato(v?: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v || 0));
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
  // MOV 2 (A): competência selecionada. null = mês corrente (a rota resolve o
  // default), preservando exatamente o comportamento anterior no primeiro load.
  const [comp, setComp] = useState<{ year: number; month: number } | null>(null);

  useEffect(() => {
    let cancel = false;
    const qs = comp ? `?year=${comp.year}&month=${comp.month}` : "";
    setError("");
    fetch(`/api/dashboard${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Erro ao carregar o dashboard."))))
      .then((j) => { if (!cancel) setData(j); })
      .catch((e) => { if (!cancel) setError(e.message || "Erro ao carregar o dashboard."); });
    return () => { cancel = true; };
  }, [comp]);

  return (
    <div className="rrdash">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <Header data={data} comp={comp} onComp={setComp} />
        <Seguridade data={data} />
        {data?.projecao?.show ? <AlertProjecao p={data.projecao} /> : null}
        <ChartCard data={data} error={error} />
        <CnpjCard rows={data?.cnpjs ?? []} />
        <FatorRSection />
        <Shortcuts />
      </main>
    </div>
  );
}

const REGIME_LABEL: Record<string, string> = {
  fechamento: "fechado",
  cms: "fechado (cms)",
  open: "produção corrente",
};

function Header({
  data,
  comp,
  onComp,
}: {
  data: Payload | null;
  comp: { year: number; month: number } | null;
  onComp: (c: { year: number; month: number } | null) => void;
}) {
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
  const prodSub = (
    <>
      mês corrente · parcial
      {data && data.producaoNaoAtribuidaCount > 0 ? (
        <>
          <br />
          <Link className="pending" href="/promotores?tab=migracao&unassigned=1">
            {brl0(data.producaoNaoAtribuida)} em {data.producaoNaoAtribuidaCount} proposta
            {data.producaoNaoAtribuidaCount > 1 ? "s" : ""} aguardando atribuição →
          </Link>
        </>
      ) : null}
    </>
  );
  // MOV 2 (A): opções do seletor = os meses que a própria série já traz (não
  // inventa lista: se o mês não tem dado, não aparece). O valor selecionado é a
  // competência que a rota devolveu — assim o seletor reflete o que está na tela.
  const ano = data?.year ?? new Date().getFullYear();
  const opcoes = (data?.producaoMensal || []).map((p) => ({ month: p.month, label: p.mes }));
  const selKey = data ? `${data.year}-${data.month}` : "";
  const regimeTxt = data ? REGIME_LABEL[data.regime] ?? data.regime : "—";

  return (
    <HeaderNavy
      eyebrow="GRUPO RR CRED"
      title="Dashboard"
      badge={
        <span className="badge">
          <span className="dot" />
          {opcoes.length > 0 ? (
            <select
              className="compsel"
              value={selKey}
              onChange={(e) => {
                const [y, m] = e.target.value.split("-").map(Number);
                // Voltar ao mês corrente = limpar a query (comp = null).
                const corrente = !comp && data && y === data.year && m === data.month;
                onComp(corrente ? null : { year: y, month: m });
              }}
              aria-label="Competência"
            >
              {opcoes.map((o) => (
                <option key={o.month} value={`${ano}-${o.month}`}>
                  {o.label}/{ano}
                </option>
              ))}
            </select>
          ) : (
            <>{data?.periodoLabel ?? "—"}</>
          )}
          {" · "}
          {regimeTxt}
        </span>
      }
    >
      {/* delta vs mes anterior: vem pronto da rota (data.delta*), a tela so passa
          adiante. Previsao de receita GANHOU delta (3b): previsao do mes cheio
          contra a receita realizada do M-1, tambem mes cheio — as duas pontas
          sao metricas diferentes de proposito, e o sub do card diz isso.
          Limite Simples segue SEM delta: e um percentual de teto fiscal, nao
          uma grandeza do mes; "subiu 2 p.p." ali nao significa desempenho. */}
      <KpiBand
        items={[
          {
            label: "Produção do grupo · mês",
            value: prod,
            sub: prodSub,
            accent: true,
            delta: data?.deltaProducao,
          },
          {
            label: "Comissão bruta (empresa)",
            value: brutaEmpresa,
            sub: brutaSub,
            subTone: "gold",
            delta: data?.deltaComissaoEmpresa,
          },
          {
            label: "Previsão de receita",
            value: prev,
            // O sub diz o que o delta esta comparando. Este card e o UNICO que
            // compara metricas diferentes (previsao x realizado) e o unico em
            // mes-cheio dos dois lados — por isso nao ganha rotulo "1-N" e por
            // isso o sub e explicito, para ninguem ler como os outros.
            sub: data?.deltaPrevisaoReceita?.mostrar
              ? `estimado · vs ${data.deltaPrevisaoReceita.labelAnterior} realizado (mês cheio)`
              : "estimado",
            subTone: "amber",
            delta: data?.deltaPrevisaoReceita,
          },
          { label: "Limite Simples", value: lim, sub: limSub, subTone: "ok" },
        ]}
      />
    </HeaderNavy>
  );
}

function Seguridade({ data }: { data: Payload | null }) {
  const comissao = data ? brl0(data.comissaoSeguroGrupo) : "—";
  const penetracao = data ? pct1(data.penetracaoSeguroGrupo) : "—";
  const label = data?.seguroLabel ?? "—";
  const semRegra = data?.seguroMasterSemRegra ?? 0;
  // Sinalização discreta (sem alarme): nº de contratos master com seguro sem
  // regra TRP casada (não somados). Fica acessível via tooltip/sub.
  const comissaoSub = (
    <>
      {label}
      {semRegra > 0 ? (
        <>
          {" · "}
          <span
            title={`${semRegra} contrato(s) master com seguro sem regra TRP casada — não somado(s)`}
            style={{ textDecoration: "underline dotted", cursor: "help" }}
          >
            {semRegra} s/ regra
          </span>
        </>
      ) : null}
    </>
  );
  return (
    <HeaderNavy
      eyebrow="SEGURIDADE"
      title="Seguro · grupo"
      badge={
        <span className="badge">
          <span className="dot" />
          {label}
        </span>
      }
    >
      <KpiBand
        columns={2}
        items={[
          {
            label: "Comissão de seguro",
            value: comissao,
            sub: comissaoSub,
            subTone: "gold",
            accent: true,
            delta: data?.deltaComissaoSeguro,
          },
          {
            label: "Penetração média",
            value: penetracao,
            sub: "ponderada · atribuído",
            subTone: "ok",
          },
        ]}
      />
    </HeaderNavy>
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
  // 4a — indice do ponto sob o cursor (ou com foco de teclado). null = nenhum.
  const [hover, setHover] = useState<number | null>(null);
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
                {/* ALVO DE HOVER invisivel, r=18: o ponto desenhado tem 4,5px de
                    raio e acertar isso com o mouse e trabalhoso. O alvo grande
                    resolve sem mudar o desenho. focusable p/ chegar por teclado. */}
                <circle
                  cx={d.x}
                  cy={d.y}
                  r={18}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${d.mes}: ${brlExato(d.valor)}${d.parcial ? " (parcial)" : ""}`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover((h) => (h === i ? null : h))}
                />
              </g>
            ))}
            {/* TOOLTIP — desenhado por ultimo para ficar acima de tudo. SVG puro:
                o grafico e SVG e um balao em HTML precisaria converter coordenada
                de viewBox para pixel, que quebra quando o card muda de largura. */}
            {hover != null && chart.dots[hover] ? (() => {
              const d = chart.dots[hover];
              const texto = brlExato(d.valor);
              // Largura estimada pela contagem de caracteres (SVG nao mede texto
              // antes de renderizar). 8,2px por caractere na mono de 15px.
              const w = Math.max(132, texto.length * 8.2 + 28);
              const h = d.parcial ? 54 : 40;
              // Vira para dentro nas pontas, para o balao nao sair do viewBox.
              const x = Math.min(Math.max(d.x - w / 2, chart.x0 - 40), chart.x1 + 40 - w);
              // Acima do ponto; abaixo quando nao ha espaco em cima.
              const acima = d.y - h - 14 > 0;
              const y = acima ? d.y - h - 14 : d.y + 14;
              return (
                <g pointerEvents="none">
                  <rect x={x} y={y} width={w} height={h} rx={8} fill="#0F1F4A" opacity="0.96" />
                  <text x={x + w / 2} y={y + 17} textAnchor="middle" fill="#9AA1B0" fontSize="11" fontWeight="600" letterSpacing="0.04em">
                    {d.mes.toUpperCase()}
                  </text>
                  <text x={x + w / 2} y={y + 33} textAnchor="middle" fill="#FFFFFF" fontSize="15" fontWeight="700" className="mono">
                    {texto}
                  </text>
                  {d.parcial ? (
                    <text x={x + w / 2} y={y + 47} textAnchor="middle" fill="#D6A13F" fontSize="10" fontWeight="600">
                      parcial · mês em curso
                    </text>
                  ) : null}
                </g>
              );
            })() : null}
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
  // valor/mes viajam no dot para o tooltip (4a) nao precisar reindexar a serie.
  const dots = serie.map((d, i) => ({
    x: pts[i][0],
    y: pts[i][1],
    parcial: d.parcial,
    valor: d.valor,
    mes: d.mes,
  }));
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
/* bloco navy + marca + h1 agora vêm do <HeaderNavy> do kit */
.rrdash .badge{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;font-weight:500;color:#C9D2E8;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);padding:7px 13px;border-radius:999px;white-space:nowrap;}
.rrdash .badge .dot{width:6px;height:6px;border-radius:50%;background:var(--green-soft);}
/* MOV 2 (A): seletor de competencia embutido no badge do header (navy). */
.rrdash .badge .compsel{appearance:none;background:transparent;border:0;color:#fff;font:inherit;font-weight:600;cursor:pointer;padding:0 16px 0 0;outline:none;background-image:linear-gradient(45deg,transparent 50%,#C9D2E8 50%),linear-gradient(135deg,#C9D2E8 50%,transparent 50%);background-position:right 6px center,right 1px center;background-size:5px 5px,5px 5px;background-repeat:no-repeat;}
.rrdash .badge .compsel:focus-visible{outline:2px solid var(--accent,#FFF000);outline-offset:2px;border-radius:4px;}
.rrdash .badge .compsel option{color:#14213d;background:#fff;}
/* faixa de stats agora vem do <KpiBand> do kit; .pending (link custom no sub) fica */
.rrdash .pending{display:inline-block;margin-top:7px;font-size:11.5px;font-weight:500;color:var(--gold-soft,#E7BE6A);text-decoration:none;border-bottom:1px dashed rgba(231,190,106,.45);padding-bottom:1px;transition:color .14s,border-color .14s;}
.rrdash .pending:hover{color:#fff;border-color:rgba(255,255,255,.5);}
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
/* responsivo dos KPIs agora vem do KpiBand (920→2 col, 560→1 col) */
@media (max-width:720px){
  .rrdash .card{padding:20px 18px;}
  .rrdash .shortcuts{grid-template-columns:repeat(2,1fr);}
}
`;
