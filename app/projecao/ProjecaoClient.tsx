"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "../../lib/auth/useUser";
import FeedbackBanner from "../../components/FeedbackBanner";
import { UiStyles, HeaderNavy, KpiBand, Table } from "@/components/ui";
// A regua NAO mora mais em codigo: vem versionada de leadership_rule_versions,
// resolvida por lib/remuneracaoLideranca e servida pronta pela rota. Esta tela
// so RENDERIZA — nao ha percentual literal nem conta aqui.
type ComissaoLideranca = {
  percentual: number;
  piso: number;
  base_calculo: "PRODUCAO_LIQUIDA" | "AVISTA_CREDITO_PF";
  criterio: "aliquota" | "piso";
  valor: number;
  valor_aliquota: number;
  valor_piso: number;
  base_comissao_avista: number;
  base_producao_liquida: number;
  comissao_media: number | null;
  fonte: "fechamento" | "motor";
  parcial: boolean;
  ads_producao_sem_comissao_apurada: number;
  ads_linhas_sem_comissao_apurada: number;
};

// ============================================================
// /projecao — Painel de Metas & Projeção (identidade .rrproj).
// SO EXIBE: dados vêm de GET /api/projecao (motor lib/projecaoMetas.ts).
// Nada é recalculado no front; role-gating é do backend.
// ============================================================

type Semaforo = "verde" | "amarelo" | "vermelho" | "sem_meta";
type Tendencia = "crescimento" | "queda" | "estavel" | "sem_historico";

const SEMA_LABEL: Record<Semaforo, string> = {
  verde: "No alvo",
  amarelo: "Atenção",
  vermelho: "Risco",
  sem_meta: "Sem meta",
};
// classe de chip/badge por semáforo (g/a/r verde/amarelo/vermelho; n neutro)
const CHIP: Record<Semaforo, "g" | "a" | "r" | "n"> = {
  verde: "g",
  amarelo: "a",
  vermelho: "r",
  sem_meta: "n",
};

type Promotor = {
  promoter_id: string;
  promoter_name: string;
  company_id: string;
  company_name: string;
  company_cnpj: string;
  producao_acumulada: number;
  dias_uteis_decorridos: number; // EXIBIDO: dias uteis vencidos, hoje INCLUIDO
  dias_uteis_ritmo: number; // DIVISOR da projecao: decorridos menos o dia corrente
  dias_uteis_totais: number;
  projecao: number;
  meta: number;
  percent_projetado: number | null;
  media_3m: number;
  tendencia: Tendencia;
  tendencia_percent: number | null;
  semaforo: Semaforo;
  seguro_comissao_acumulada: number; // EMPRESA (§188) — usado no consolidado do grupo
  seguro_comissao_projecao: number;
  seguro_share_acumulada: number; // SHARE do promotor — PromotorView
  seguro_share_projecao: number;
  seguro_penetracao: number | null;
};
type NaoAtribuido = { acumulada: number; projecao: number; count: number };
type Grupo = {
  estado: "AL" | "SE" | "PE" | "BA" | null;
  estado_label: string;
  producao_acumulada: number;
  projecao: number;
  meta: number;
  percent_projetado: number | null;
  semaforo: Semaforo;
  promotores: Promotor[];
  nao_atribuido?: NaoAtribuido | null;
};

// ---------- drill-down histórico (jan/2026 → corrente) ----------
type HistMesPromotor = {
  year: number;
  month: number;
  label: string;
  producao: number;
  penetracao_seg: number | null;
  meta: number;
  percent: number | null;
};
type PromotorHist = {
  promoter_id: string;
  promoter_name: string;
  estado: string | null;
  company_id: string;
  company_name: string;
  meses: HistMesPromotor[];
};
type HistMesEstado = {
  year: number;
  month: number;
  label: string;
  producao: number;
  penetracao_seg: number | null;
};
type EstadoHist = {
  estado: string | null;
  estado_label: string;
  promotor_count: number;
  meses: HistMesEstado[];
};

// ---------- ordenação (ranking de promotores) ----------
type SortKey = "percent" | "acumulado" | "projecao" | "meta" | "seguro_pen";
type SortDir = "asc" | "desc";

// "sem meta" = meta 0 → percent_projetado === null.
const semMeta = (p: Promotor) => p.percent_projetado === null;
const valorDe = (p: Promotor, key: SortKey): number => {
  switch (key) {
    case "percent":
      return p.percent_projetado ?? 0; // sem-meta é tratado à parte (vai pro fim)
    case "acumulado":
      return p.producao_acumulada;
    case "projecao":
      return p.projecao;
    case "meta":
      return p.meta;
    case "seguro_pen":
      return p.seguro_penetracao ?? 0; // null (sem base) trata como 0 → cai no fim no desc
  }
};

// Ordena uma CÓPIA de g.promotores. Regras:
//  - 'percent' e 'meta': promotores SEM meta vão SEMPRE pro fim (entre eles,
//    produção acumulada desc), independente de sortDir.
//  - 'acumulado' e 'projecao': todos entram juntos (sem-meta têm valor real).
function sortPromotores(list: Promotor[], key: SortKey, dir: SortDir): Promotor[] {
  const mult = dir === "asc" ? 1 : -1;
  const forceBottom = key === "percent" || key === "meta";
  return [...list].sort((a, b) => {
    if (forceBottom) {
      const sa = semMeta(a);
      const sb = semMeta(b);
      if (sa && sb) return b.producao_acumulada - a.producao_acumulada;
      if (sa) return 1; // a (sem meta) vai pro fim
      if (sb) return -1; // b (sem meta) vai pro fim
    }
    const diff = valorDe(a, key) - valorDe(b, key);
    if (diff !== 0) return diff * mult;
    // desempate estável: acumulado desc, depois nome.
    if (a.producao_acumulada !== b.producao_acumulada) {
      return b.producao_acumulada - a.producao_acumulada;
    }
    return a.promoter_name.localeCompare(b.promoter_name, "pt-BR");
  });
}

const brl = (n: number) =>
  "R$ " + new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const pctTxt = (r: number | null) => (r === null ? "—" : `${(r * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
// Percentual de REGUA e de comissao media: precisa de mais casas que o pctTxt.
// Com 1 casa, o piso de 0,07% viraria 0,1% e a comissao media de 3,5956%
// perderia justamente a parte que decide alíquota x piso.
const pctReg = (r: number | null) =>
  r === null
    ? "—"
    : `${(r * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
const mes = (y: number, m: number) =>
  `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][m - 1]}/${String(y).slice(-2)}`;
const ddmm = (iso: string | null | undefined) => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : "—";
};

// ---------- icones inline ----------
function IcoClock() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}
function IcoAlert() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.3 2 18a1.5 1.5 0 0 0 1.3 2.2h17.4A1.5 1.5 0 0 0 22 18L13.7 3.3a1.5 1.5 0 0 0-2.6 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  );
}
function IcoCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function ArrowUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7" /><path d="M9 7h8v8" />
    </svg>
  );
}
function ArrowDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7 17 17" /><path d="M17 9v8H9" />
    </svg>
  );
}

function Chip({ s, label, onNavy }: { s: Semaforo; label?: string; onNavy?: boolean }) {
  return (
    <span className={`chip ${CHIP[s]}${onNavy ? " on-navy" : ""}`}>
      <span className="d" />
      {label ?? SEMA_LABEL[s]}
    </span>
  );
}

function TrendCell({ p }: { p: Promotor }) {
  if (p.tendencia === "crescimento") return <span className="trend up"><ArrowUp /></span>;
  if (p.tendencia === "queda") return <span className="trend down"><ArrowDown /></span>;
  if (p.tendencia === "estavel") return <span className="trend flat">→</span>;
  return <span className="trend none">—</span>;
}

// ---------- gráfico de linha SVG (espelha o LineChart do /equipe) ----------
// `projected` (opcional) desenha um segmento PONTILHADO AMARELO do último ponto
// real até a projeção do mês corrente + marcador vazado dourado.
function LineChart({
  points,
  color = "#0F1F4A",
  height = 128,
  fmt,
  projected = null,
  projLabel = "proj",
}: {
  points: Array<{ label: string; value: number }>;
  color?: string;
  height?: number;
  fmt: (n: number) => string;
  projected?: number | null;
  projLabel?: string;
}) {
  const W = 680;
  const H = height;
  const padL = 10;
  const padR = 12;
  const padT = 14;
  const padB = 24;
  const n = points.length;
  const hasProj = projected != null && n > 0;
  const slots = n + (hasProj ? 1 : 0);
  const max = Math.max(1, ...points.map((p) => p.value), ...(hasProj ? [projected as number] : []));
  const x = (i: number) => (slots <= 1 ? padL : padL + (i * (W - padL - padR)) / (slots - 1));
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area =
    n > 0
      ? `${line} L${x(n - 1).toFixed(1)},${(H - padB).toFixed(1)} L${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z`
      : "";
  const projSeg = hasProj
    ? `M${x(n - 1).toFixed(1)},${y(points[n - 1].value).toFixed(1)} L${x(n).toFixed(1)},${y(projected as number).toFixed(1)}`
    : "";
  const last = points[n - 1];
  return (
    <div className="lc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Série mensal" preserveAspectRatio="none">
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#E4E7EC" strokeWidth={1} />
        {area ? <path d={area} fill={color} opacity={0.08} /> : null}
        {line ? <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /> : null}
        {projSeg ? <path d={projSeg} fill="none" stroke="#F2C200" strokeWidth={2.5} strokeDasharray="5 4" strokeLinecap="round" /> : null}
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={2.6} fill={color} />
        ))}
        {hasProj ? <circle cx={x(n)} cy={y(projected as number)} r={3.4} fill="#fff" stroke="#D6A13F" strokeWidth={2} /> : null}
      </svg>
      <div className="lc-x">
        {points.map((p, i) => (
          <span key={i} className={!hasProj && i === n - 1 ? "on" : ""}>
            {p.label.split("/")[0]}
          </span>
        ))}
        {hasProj ? <span className="on proj">{projLabel}</span> : null}
      </div>
      {last ? (
        <div className="lc-cap">
          Último ({last.label}): <b>{fmt(last.value)}</b>
          {hasProj ? <> · proj <b>{fmt(projected as number)}</b></> : null} · pico {fmt(max)}
        </div>
      ) : null}
    </div>
  );
}

// ---------- drill-down por TELA CHEIA (substitui os drawers do PR #76) ----------
type SupervisorHist = {
  supervisor_user_id: string | null;
  supervisor_name: string;
  supervisor_role: string | null;
  promotor_count: number;
  meses: HistMesEstado[];
};
type GrupoSupervisor = {
  supervisor_user_id: string | null;
  supervisor_name: string;
  supervisor_role: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
  producao_acumulada: number;
  projecao: number;
  meta: number;
  percent_projetado: number | null;
  semaforo: Semaforo;
  promotores: Promotor[];
};

type Nav = {
  goEstado: (key: string) => void;
  goSupervisor: (key: string) => void;
  goPromotor: (id: string, from?: string) => void;
  back: (from: string | null) => void;
};

const estadoKey = (e: string | null | undefined) => e ?? "__NULL__";
const supKeyOf = (s: string | null | undefined) => s ?? "__NULL__";
const iniciais = (nome: string) =>
  nome.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "—";

function DrillHeader({ title, subtitle, badge, onBack }: { title: string; subtitle: string; badge?: ReactNode; onBack: () => void }) {
  return (
    <div className="drillhead">
      <button className="backbtn" onClick={onBack}>← Voltar</button>
      <div className="dh-row">
        <div className="dh-id">
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {badge ? <div className="dh-badge">{badge}</div> : null}
      </div>
    </div>
  );
}

function DrillMissing({ onBack }: { onBack: () => void }) {
  return (
    <>
      <DrillHeader title="Não encontrado" subtitle="Este item não existe nesta competência." onBack={onBack} />
      <div className="card"><div className="state">Selecione outro item ou volte à lista.</div></div>
    </>
  );
}

function KpiCheia({ acumulada, projecao, meta, percent }: { acumulada: number; projecao: number; meta: number; percent: number | null }) {
  return (
    <div className="kpiwrap-navy">
      <KpiBand
        valueSize={24}
        items={[
          { label: "Produção acumulada", value: brl(acumulada) },
          { label: "Projeção", value: brl(projecao), sub: "estimativa de fechamento", accent: true },
          { label: "Meta", value: meta > 0 ? brl(meta) : "Sem meta" },
          { label: "% meta", value: pctTxt(percent) },
        ]}
      />
    </div>
  );
}

// ---- TELA CHEIA: PROMOTOR ----
function DrillPromotor({ data, id, from, nav }: { data: any; id: string; from: string | null; nav: Nav }) {
  const allP: Promotor[] = (data.grupos || []).flatMap((g: Grupo) => g.promotores);
  const p = allP.find((x) => x.promoter_id === id) || null;
  const hist: PromotorHist | null = (data.perPromoterMonthly || []).find((h: PromotorHist) => h.promoter_id === id) || null;
  const back = () => nav.back(from);
  if (!p) return <DrillMissing onBack={back} />;
  const meses = hist?.meses ?? [];
  const prodPts = meses.map((m) => ({ label: m.label, value: m.producao }));
  const histRows = [...meses].reverse().filter((m) => m.producao > 0 || m.meta > 0);
  return (
    <>
      <DrillHeader
        title={p.promoter_name}
        subtitle={`${p.company_name}${hist?.estado ? ` · ${hist.estado}` : ""} · histórico jan → corrente`}
        badge={<Chip s={p.semaforo} onNavy />}
        onBack={back}
      />
      <KpiCheia acumulada={p.producao_acumulada} projecao={p.projecao} meta={p.meta} percent={p.percent_projetado} />
      <section className="card"><div className="card-pad">
        <h3 className="drill-h">Produção líquida mês a mês</h3>
        <LineChart points={prodPts} color="#0F1F4A" fmt={brl} projected={p.projecao} projLabel="proj" />
      </div></section>
      <section className="card"><div className="card-pad">
        <h3 className="drill-h">Meta vs realizado (histórico)</h3>
        <Table scrollable minWidth={560} cards>
          <thead><tr><th>Mês</th><th className="r">Produção</th><th className="r">Meta</th><th className="r">% meta</th><th className="r">Penetração seg.</th></tr></thead>
          <tbody>
            {histRows.length === 0 ? (
              <tr><td colSpan={5} className="drill-empty">Sem histórico de produção ou meta.</td></tr>
            ) : (
              histRows.map((m) => (
                <tr key={`${m.year}-${m.month}`}>
                  <td data-l="Mês">{m.label}</td>
                  <td className="r" data-l="Produção">{brl(m.producao)}</td>
                  <td className="r" data-l="Meta">{m.meta > 0 ? brl(m.meta) : "—"}</td>
                  <td className="r" data-l="% meta">{pctTxt(m.percent)}</td>
                  <td className="r" data-l="Penetração seg.">{pctTxt(m.penetracao_seg)}</td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div></section>
    </>
  );
}

// ---- TELA CHEIA: ESTADO ----
function DrillEstado({ data, id, nav }: { data: any; id: string; nav: Nav }) {
  const g: Grupo | null = (data.grupos || []).find((x: Grupo) => estadoKey(x.estado) === id) || null;
  const hist: EstadoHist | null = (data.perEstadoMonthly || []).find((e: EstadoHist) => estadoKey(e.estado) === id) || null;
  const back = () => nav.back(null);
  if (!g) return <DrillMissing onBack={back} />;
  const prodPts = (hist?.meses ?? []).map((m) => ({ label: m.label, value: m.producao }));
  return (
    <>
      <DrillHeader
        title={g.estado ? `${g.estado} · ${g.estado_label}` : g.estado_label}
        subtitle={`${g.estado ? `Estado ${g.estado}` : "Sem estado atribuído"} · ${g.promotores.length} promotor${g.promotores.length === 1 ? "" : "es"} · histórico jan → corrente`}
        badge={<Chip s={g.semaforo} onNavy />}
        onBack={back}
      />
      <KpiCheia acumulada={g.producao_acumulada} projecao={g.projecao} meta={g.meta} percent={g.percent_projetado} />
      <section className="card"><div className="card-pad">
        <h3 className="drill-h">Produção do estado mês a mês</h3>
        <LineChart points={prodPts} color="#0F1F4A" fmt={brl} projected={g.projecao} projLabel="proj" />
      </div></section>
      <section className="card"><div className="card-pad">
        <h3 className="drill-h">Promotores do estado <span className="drill-hint">clique para abrir</span></h3>
        <Table scrollable minWidth={480} cards>
          <thead><tr><th>Promotor</th><th className="r">Acumulado</th><th className="r">Projeção</th><th className="r">% meta</th></tr></thead>
          <tbody>
            {g.promotores.map((pr) => (
              <tr key={pr.promoter_id} className="clickrow" onClick={() => nav.goPromotor(pr.promoter_id, `estado:${id}`)}>
                <td className="pname" data-l="Promotor">{pr.promoter_name}</td>
                <td className="r" data-l="Acumulado">{brl(pr.producao_acumulada)}</td>
                <td className="r" data-l="Projeção">{brl(pr.projecao)}</td>
                <td className="r" data-l="% meta">{pctTxt(pr.percent_projetado)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div></section>
    </>
  );
}

// ---- TELA CHEIA: SUPERVISOR ----
function DrillSupervisor({ data, id, nav }: { data: any; id: string; nav: Nav }) {
  const g: GrupoSupervisor | null = (data.gruposSupervisor || []).find((x: GrupoSupervisor) => supKeyOf(x.supervisor_user_id) === id) || null;
  const hist: SupervisorHist | null = (data.perSupervisorMonthly || []).find((s: SupervisorHist) => supKeyOf(s.supervisor_user_id) === id) || null;
  const back = () => nav.back(null);
  if (!g) return <DrillMissing onBack={back} />;
  const prodPts = (hist?.meses ?? []).map((m) => ({ label: m.label, value: m.producao }));
  const roleLabel = g.supervisor_role === "gerente_regional" ? "Gerente regional" : g.supervisor_role === "socio" ? "Gestora (sócio)" : g.supervisor_user_id === null ? "Sem supervisor" : "Supervisor";
  return (
    <>
      <DrillHeader
        title={g.supervisor_name}
        subtitle={`${roleLabel}${g.manager_name ? ` · gerente ${g.manager_name}` : ""} · ${g.promotores.length} promotor${g.promotores.length === 1 ? "" : "es"} · histórico jan → corrente`}
        badge={<Chip s={g.semaforo} onNavy />}
        onBack={back}
      />
      <KpiCheia acumulada={g.producao_acumulada} projecao={g.projecao} meta={g.meta} percent={g.percent_projetado} />
      <section className="card"><div className="card-pad">
        <h3 className="drill-h">Produção da equipe mês a mês</h3>
        <LineChart points={prodPts} color="#0F1F4A" fmt={brl} projected={g.projecao} projLabel="proj" />
      </div></section>
      <section className="card"><div className="card-pad">
        <h3 className="drill-h">Promotores da equipe <span className="drill-hint">clique para abrir</span></h3>
        <Table scrollable minWidth={480} cards>
          <thead><tr><th>Promotor</th><th className="r">Acumulado</th><th className="r">Projeção</th><th className="r">% meta</th></tr></thead>
          <tbody>
            {g.promotores.map((pr) => (
              <tr key={pr.promoter_id} className="clickrow" onClick={() => nav.goPromotor(pr.promoter_id, `supervisor:${id}`)}>
                <td className="pname" data-l="Promotor">{pr.promoter_name}</td>
                <td className="r" data-l="Acumulado">{brl(pr.producao_acumulada)}</td>
                <td className="r" data-l="Projeção">{brl(pr.projecao)}</td>
                <td className="r" data-l="% meta">{pctTxt(pr.percent_projetado)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div></section>
    </>
  );
}

function DrillScreen({ data, view, id, from, nav }: { data: any; view: string; id: string; from: string | null; nav: Nav }) {
  if (view === "promotor") return <DrillPromotor data={data} id={id} from={from} nav={nav} />;
  if (view === "estado") return <DrillEstado data={data} id={id} nav={nav} />;
  if (view === "supervisor") return <DrillSupervisor data={data} id={id} nav={nav} />;
  return null;
}

export default function ProjecaoClient() {
  // useSearchParams exige boundary de Suspense no app router (build estático).
  return (
    <Suspense fallback={<div className="rrproj"><div className="wrap" style={{ padding: 34 }}>Carregando…</div></div>}>
      <ProjecaoContent />
    </Suspense>
  );
}

function ProjecaoContent() {
  const { user, loading: userLoading } = useUser();
  // COMPETENCIA CANONICA — mes corrente pelo relogio LOCAL, nao pelos getters
  // UTC. `new Date()` no browser ja e local; ler getUTCMonth() dela devolve o
  // mes em UTC e, das 21h BRT em diante no ultimo dia do mes, a tela abria na
  // competencia SEGUINTE por 3 horas. Mesmo defeito que lib/dateFortaleza
  // resolve no servidor; aqui as demais telas (/receitas, /financeiro,
  // /promotores) ja usam os getters locais, entao isto tambem alinha o cliente.
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [companyId, setCompanyId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isPromotor = user?.role === "promotor";

  // Competencias recentes (atual + 5 anteriores). Mesmo relogio LOCAL do estado
  // acima: se a lista partisse do mes em UTC e o estado do mes local, os dois
  // discordariam na virada e o <select> nao acharia a competencia selecionada —
  // o React marcaria a primeira opcao e a tela exibiria um mes sob o rotulo de
  // outro, que e o defeito que esta frente esta matando.
  const periodOptions = useMemo(() => {
    const out: Array<{ key: string; label: string; y: number; m: number }> = [];
    for (let k = 0; k < 6; k++) {
      const dt = new Date(now.getFullYear(), now.getMonth() - k, 1);
      const y = dt.getFullYear();
      const m = dt.getMonth() + 1;
      out.push({ key: `${y}-${m}`, label: mes(y, m), y, m });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (userLoading) return;
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError("");
        const params = new URLSearchParams({ year: String(year), month: String(month) });
        if (!isPromotor && companyId) params.set("companyId", companyId);
        const res = await fetch(`/api/projecao?${params.toString()}`);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || "Erro ao carregar projecao.");
        if (!cancelled) setData(payload);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Erro ao carregar projecao.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [year, month, companyId, isPromotor, userLoading]);

  const janela = data?.janela;
  const fechado = Boolean(data?.fechado);

  // dados do promotor (p/ header badge)
  const prom: Promotor | null = isPromotor ? data?.promotor ?? null : null;

  // ---- drill por query param (?view=&id=&from=) — sobrevive a refresh + back ----
  const router = useRouter();
  const sp = useSearchParams();
  const view = sp.get("view") || "";
  const drillId = sp.get("id") || "";
  const drillFrom = sp.get("from");
  const isDrill = !isPromotor && (view === "estado" || view === "supervisor" || view === "promotor") && Boolean(drillId);
  const nav: Nav = useMemo(
    () => ({
      goEstado: (key) => router.push(`/projecao?view=estado&id=${encodeURIComponent(key)}`),
      goSupervisor: (key) => router.push(`/projecao?view=supervisor&id=${encodeURIComponent(key)}`),
      goPromotor: (id, fromKey) =>
        router.push(`/projecao?view=promotor&id=${encodeURIComponent(id)}${fromKey ? `&from=${encodeURIComponent(fromKey)}` : ""}`),
      back: (fromKey) => {
        if (fromKey && fromKey.startsWith("estado:")) router.push(`/projecao?view=estado&id=${encodeURIComponent(fromKey.slice(7))}`);
        else if (fromKey && fromKey.startsWith("supervisor:")) router.push(`/projecao?view=supervisor&id=${encodeURIComponent(fromKey.slice(11))}`);
        else router.push("/projecao");
      },
    }),
    [router]
  );

  return (
    <div className="rrproj">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <Link href="/dashboard">Dashboard</Link>
          <span className="sep">/</span>
          <span>Comercial</span>
          <span className="sep">/</span>
          {isDrill ? <Link href="/projecao">Projeção</Link> : <span>Projeção</span>}
          {isDrill ? (<><span className="sep">/</span><span>Detalhe</span></>) : null}
        </nav>

        {isDrill ? (
          loading || !data ? (
            <div className="card" style={{ padding: "26px 28px" }}>
              <div className="loading-row"><span className="spinner" />Carregando…</div>
            </div>
          ) : (
            <DrillScreen data={data} view={view} id={drillId} from={drillFrom} nav={nav} />
          )
        ) : (
        <>
        {/* HEADER navy (kit) — badge semáforo no slot badge, pills no slot actions */}
        <HeaderNavy
          title={isPromotor ? (prom?.promoter_name ?? "Minha projeção") : "Projeção da equipe"}
          subtitle={
            isPromotor
              ? `${prom?.company_name ?? "—"} · projeção individual · ${mes(year, month)}`
              : "Estimativa de fechamento por ritmo linear · todos os estados"
          }
          badge={
            isPromotor && prom ? (
              <span className={`badge-lg ${CHIP[prom.semaforo]}`}>
                <span className="d" />
                {SEMA_LABEL[prom.semaforo]}
              </span>
            ) : null
          }
          actions={
            <div className="selectors">
              <div className="pill">
                <span className="plabel">Competência</span>
                <select
                  aria-label="Competência"
                  value={`${year}-${month}`}
                  onChange={(e) => {
                    const [y, m] = e.target.value.split("-").map(Number);
                    setYear(y);
                    setMonth(m);
                  }}
                >
                  {periodOptions.map((p) => (
                    <option key={p.key} value={`${p.y}-${p.m}`}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <span className="chev">▾</span>
              </div>
              {!isPromotor && data?.companies ? (
                <div className="pill">
                  <span className="plabel">Empresa</span>
                  <select aria-label="Empresa" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                    <option value="">Todas as empresas</option>
                    {data.companies.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="chev">▾</span>
                </div>
              ) : null}
            </div>
          }
        />

        {error ? (
          <FeedbackBanner variant="error" eyebrow="Erro" title="Não foi possível carregar a projeção." description={error} />
        ) : null}

        {janela ? (
          <div className="winnote">
            <span className="ic"><IcoClock /></span>
            <span>Janela <b>{ddmm(janela.inicio)} → {ddmm(janela.fim)}</b></span>
            <span className="sepd">·</span>
            <span>dias úteis <b>{janela.dias_uteis_decorridos}/{janela.dias_uteis_totais}</b></span>
            <span className="sepd">·</span>
            <span>
              competência <b>{fechado ? "fechada" : "aberta"}</b>{" "}
              <span style={{ color: "var(--ink-3)" }}>({fechado ? "produção final" : "ritmo linear"})</span>
            </span>
          </div>
        ) : null}

        {loading ? (
          <div className="card" style={{ padding: "26px 28px" }}>
            <div className="loading-row"><span className="spinner" />Carregando projeção…</div>
          </div>
        ) : isPromotor ? (
          <PromotorView data={data} />
        ) : (
          <EquipeView data={data} nav={nav} />
        )}
        </>
        )}
      </main>
    </div>
  );
}

// ============================================================
// VISÃO EQUIPE (socio / funcionario)
// ============================================================
function EquipeView({ data, nav }: { data: any; nav: Nav }) {
  if (!data || data.scope !== "equipe") return null;
  const cons = data.consolidado;
  const grupos: Grupo[] = data.grupos || [];
  const gruposSupervisor: GrupoSupervisor[] = data.gruposSupervisor || [];
  const risco: Promotor[] = data.risco || [];
  const jan = data.janela;
  // Presença do CAMPO, não do valor: o sócio pode legitimamente ter R$ 0,00 de
  // comissão de seguro num mês; o gestor não recebe a chave. Ver o bloco de KPIs.
  const temSeguroEmpresa = "seguro_comissao_grupo_empresa" in data;
  // Só o ramo do gestor manda este campo. Sócio/funcionário não têm comissão de
  // gestão e o card nem chega a existir para eles.
  const comissao: ComissaoLideranca | null = data.comissao_gestao ?? null;

  // Segmented control: agrupa por ESTADO (atual) ou por SUPERVISOR (novo). Drill
  // (estado/supervisor/promotor) abre TELA CHEIA via nav (query param).
  const [tab, setTab] = useState<"estado" | "supervisor">("estado");

  // Ordenação GLOBAL (mesmo critério para todos os CNPJs). Default: ranking por
  // produção acumulada, maior primeiro (sem-meta não vão pro fim aqui — entram
  // junto pelo valor real; R$ 0,00 cai no fim naturalmente).
  const [sortKey, setSortKey] = useState<SortKey>("acumulado");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc"); // nova coluna → maior primeiro
    }
  };
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" =>
    sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  return (
    <>
      {/* KPIs — faixa navy (kit).
          AUSÊNCIA, NUNCA ZERO: o ramo do gestor OMITE seguro_comissao_grupo_empresa
          (comissão da empresa não é dele, e a coluna está fora da vw_team_production).
          Sem o campo, a segunda faixa não existe e a penetração — que o gestor TEM —
          sobe para a faixa principal como 5º item. `in` e não truthiness: R$ 0,00 é
          um valor legítimo para o sócio num mês sem seguro. */}
      <div className="kpiwrap-navy">
        <KpiBand
          valueSize={24}
          items={[
            {
              label: "Produção acumulada",
              value: brl(cons.producao_acumulada),
              sub: (
                <>
                  {jan ? `${jan.dias_uteis_decorridos} de ${jan.dias_uteis_totais} dias úteis` : ""}
                  {cons.nao_atribuido && cons.nao_atribuido.count > 0 ? (
                    <Link className="pend" href="/promotores?tab=migracao&unassigned=1">
                      inclui {brl(cons.nao_atribuido.acumulada)} em {cons.nao_atribuido.count} não atribuída
                      {cons.nao_atribuido.count > 1 ? "s" : ""} →
                    </Link>
                  ) : null}
                </>
              ),
            },
            { label: "Projeção do grupo", value: brl(cons.projecao), sub: "estimativa de fechamento", accent: true },
            { label: "Meta do grupo", value: brl(cons.meta), sub: "soma das metas por estado" },
            { label: "% projetado do grupo", value: pctTxt(cons.percent_projetado), sub: <Chip s={cons.semaforo} onNavy /> },
            ...(temSeguroEmpresa
              ? []
              : [
                  {
                    label: "Penetração seguro",
                    value: pctTxt(cons.seguro_penetracao),
                    sub: "atual, ponderada",
                  },
                ]),
          ]}
        />
        {/* Seguro (DB-driven). KPI do GRUPO = comissão-EMPRESA (aberto §188; fechado
            fechamento.valor_seguro), MESMA fonte do dashboard/financeiro. Penetracao =
            card proprio (atual, ponderada); SEM meta/semaforo. */}
        {temSeguroEmpresa ? (
          <KpiBand
            valueSize={24}
            columns={2}
            items={[
              {
                label: "Comissão seguro (empresa)",
                value: brl(data.seguro_comissao_grupo_empresa),
              },
              {
                label: "Penetração seguro",
                value: pctTxt(cons.seguro_penetracao),
                sub: "atual, ponderada",
              },
            ]}
          />
        ) : null}
      </div>

      {/* COMISSAO DE GESTAO — so existe no payload do gestor (supervisor/
          gerente_regional). Ausencia do campo = card nao existe, mesma regra do
          resto da tela. E a comissao DELE sobre a producao da rede; NAO ha
          repasse de promotor em lugar nenhum desta tela. */}
      {comissao ? (
        <section className="card cgest">
          <div className="cgest-head">
            <div>
              <h3>Sua comissão de gestão</h3>
              <p className="csub">
                {pctReg(comissao.percentual)} sobre a comissão à vista da rede, com piso de{" "}
                {pctReg(comissao.piso)} sobre a produção líquida — vale o maior
              </p>
            </div>
            {comissao.parcial ? (
              <span className="cgest-tag parcial">parcial · competência aberta</span>
            ) : null}
          </div>
          <div className="cgest-body">
            <div className="cgest-fig">
              <span className="l">
                {comissao.parcial ? "Comissão até aqui" : "Comissão da competência"}
              </span>
              <span className="v num">{brl(comissao.valor)}</span>
              <span className="s">
                venceu o critério <b>{comissao.criterio === "piso" ? "piso" : "alíquota"}</b>
                {" · "}
                {comissao.criterio === "piso"
                  ? `alíquota daria ${brl(comissao.valor_aliquota)}`
                  : `piso daria ${brl(comissao.valor_piso)}`}
              </span>
            </div>
            <div className="cgest-fig">
              <span className="l">Comissão média da rede</span>
              <span className="v num">
                {comissao.comissao_media == null ? "—" : pctReg(comissao.comissao_media)}
              </span>
              {/* O criterio depende SO desta razao: volume nao muda nada, porque
                  alíquota e piso escalam juntos. Abaixo do ponto de virada o piso
                  passa a valer, e isso e sinal de competencia fraca, nao de mes
                  pequeno. */}
              <span className="s">
                {brl(comissao.base_comissao_avista)} sobre {brl(comissao.base_producao_liquida)}
                {comissao.criterio === "piso" ? " · abaixo do ponto de virada" : ""}
              </span>
            </div>
          </div>
          {comissao.ads_linhas_sem_comissao_apurada > 0 ? (
            <p className="cgest-lacuna">
              <b>{brl(comissao.ads_producao_sem_comissao_apurada)}</b> de produção ADS em{" "}
              {comissao.ads_linhas_sem_comissao_apurada} contrato
              {comissao.ads_linhas_sem_comissao_apurada === 1 ? "" : "s"}{" "}
              <b>ainda vai gerar comissão</b> — ela é apurada pela régua da BBTS, que só chega
              no fechamento. Esta produção está <b>fora</b> da conta acima, dos dois lados: não
              entra na comissão nem na base do piso. Quando a competência fechar, entra nos
              dois e o seu valor sobe.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* RISCO */}
      <section className="card">
        <div className="risk-head">
          <div className="lt">
            <span className="ic"><IcoAlert /></span>
            <div>
              <h3>Puxando o grupo pra baixo</h3>
              <p className="csub">Promotores com projeção mais distante da meta</p>
            </div>
          </div>
          {risco.length > 0 ? <span className="cnt">{risco.length} em risco</span> : null}
        </div>
        {risco.length === 0 ? (
          <div className="risk-empty">
            <span className="ic"><IcoCheck /></span>
            <div><b>Nenhum promotor em risco.</b> Toda a equipe está dentro do ritmo da meta nesta janela.</div>
          </div>
        ) : (
          <div className="risk-list">
            {risco.map((p, i) => (
              <div key={p.promoter_id} className="risk-row">
                <span className="rank">{i + 1}</span>
                <div className="who">
                  <div className="nm">{p.promoter_name}</div>
                  <div className="emp">{p.company_name}</div>
                </div>
                <div className="proj num">
                  {brl(p.projecao)}
                  <small>proj · meta {p.meta > 0 ? brl(p.meta) : "—"}</small>
                </div>
                <Chip s={p.semaforo} label={pctTxt(p.percent_projetado)} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SEGMENTED CONTROL — por estado (atual) | por supervisor (novo) */}
      <div className="seg2" role="tablist" aria-label="Agrupar por">
        <button role="tab" aria-selected={tab === "estado"} className={tab === "estado" ? "on" : ""} onClick={() => setTab("estado")}>Por estado</button>
        <button role="tab" aria-selected={tab === "supervisor"} className={tab === "supervisor" ? "on" : ""} onClick={() => setTab("supervisor")}>Por supervisor</button>
      </div>

      {/* TABELAS POR ESTADO */}
      {tab === "estado" && grupos.map((g) => (
        <section key={g.estado ?? "nao-classificado"} className="card">
          <div
            className="emp-head clickhead"
            role="button"
            tabIndex={0}
            aria-label={`Abrir histórico de ${g.estado_label}`}
            onClick={() => nav.goEstado(estadoKey(g.estado))}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nav.goEstado(estadoKey(g.estado)); } }}
          >
            <div className="left">
              <span className={`st ${CHIP[g.semaforo]}`} />
              <div>
                <div className="nm">{g.estado_label} <span className="drill">histórico →</span></div>
                <div className="cnpj">{g.estado ? `Estado ${g.estado}` : "sem estado atribuído"} · {g.promotores.length} promotor{g.promotores.length === 1 ? "" : "es"}</div>
              </div>
            </div>
            <div className="right">
              <div className="pm">
                <div className="v num">{brl(g.projecao)} / {brl(g.meta)}</div>
                <div className="l">projeção / meta</div>
              </div>
              <div className="pct num">{pctTxt(g.percent_projetado)}</div>
              <Chip s={g.semaforo} />
            </div>
          </div>
          <Table scrollable minWidth={880} cards>
              <thead>
                <tr>
                  <th className="rr-sticky-col">Promotor</th>
                  <th
                    className="r"
                    role="button"
                    tabIndex={0}
                    style={{ cursor: "pointer" }}
                    aria-sort={ariaSort("acumulado")}
                    onClick={() => onSort("acumulado")}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort("acumulado"); } }}
                  >
                    Acumulado{arrow("acumulado")}
                  </th>
                  <th
                    className="r"
                    role="button"
                    tabIndex={0}
                    style={{ cursor: "pointer" }}
                    aria-sort={ariaSort("projecao")}
                    onClick={() => onSort("projecao")}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort("projecao"); } }}
                  >
                    Projeção{arrow("projecao")}
                  </th>
                  <th
                    className="r"
                    role="button"
                    tabIndex={0}
                    style={{ cursor: "pointer" }}
                    aria-sort={ariaSort("meta")}
                    onClick={() => onSort("meta")}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort("meta"); } }}
                  >
                    Meta{arrow("meta")}
                  </th>
                  <th
                    className="r"
                    role="button"
                    tabIndex={0}
                    style={{ cursor: "pointer" }}
                    aria-sort={ariaSort("percent")}
                    onClick={() => onSort("percent")}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort("percent"); } }}
                  >
                    % projetado{arrow("percent")}
                  </th>
                  <th className="c">Tendência</th>
                  <th className="c">Semáforo</th>
                  <th
                    className="r"
                    role="button"
                    tabIndex={0}
                    style={{ cursor: "pointer" }}
                    aria-sort={ariaSort("seguro_pen")}
                    onClick={() => onSort("seguro_pen")}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSort("seguro_pen"); } }}
                  >
                    Penetração seg.{arrow("seguro_pen")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortPromotores(g.promotores, sortKey, sortDir).map((p) => (
                  <tr key={p.promoter_id} className="clickrow" onClick={() => nav.goPromotor(p.promoter_id, `estado:${estadoKey(g.estado)}`)}>
                    {/* data-l = rotulo do thead. Os 5 ordenaveis rendem
                        {label}{arrow(...)}; a seta e estado de ordenacao, nao
                        entra no rotulo. */}
                    <td className="rr-sticky-col pname" data-l="Promotor">{p.promoter_name}</td>
                    <td className="r" data-l="Acumulado">{brl(p.producao_acumulada)}</td>
                    <td className="r" data-l="Projeção">{brl(p.projecao)}</td>
                    <td className="r" data-l="Meta">{p.meta > 0 ? brl(p.meta) : "—"}</td>
                    <td className="pctcell" data-l="% projetado">{pctTxt(p.percent_projetado)}</td>
                    <td className="c" data-l="Tendência"><TrendCell p={p} /></td>
                    <td className="c" data-l="Semáforo"><Chip s={p.semaforo} /></td>
                    <td className="r" data-l="Penetração seg.">{pctTxt(p.seguro_penetracao)}</td>
                  </tr>
                ))}
                {g.nao_atribuido && g.nao_atribuido.acumulada > 0 ? (
                  <tr className="na-row">
                    <td className="rr-sticky-col pname" data-l="Promotor">
                      Não atribuído · chave master
                      <span className="na-tag">{g.nao_atribuido.count} prop · aguardando Migração</span>
                    </td>
                    <td className="r" data-l="Acumulado">{brl(g.nao_atribuido.acumulada)}</td>
                    <td className="r" data-l="Projeção">{brl(g.nao_atribuido.projecao)}</td>
                    <td className="r" data-l="Meta">—</td>
                    <td className="pctcell" data-l="% projetado">—</td>
                    <td className="c" data-l="Tendência">—</td>
                    <td className="c" data-l="Semáforo">—</td>
                    <td className="r" data-l="Penetração seg.">—</td>
                  </tr>
                ) : null}
              </tbody>
          </Table>
        </section>
      ))}

      {/* CARDS POR SUPERVISOR */}
      {tab === "supervisor" ? (
        <div className="supgrid">
          {gruposSupervisor.map((g) => {
            const semSup = g.supervisor_user_id === null;
            const roleTag = g.supervisor_role === "gerente_regional" ? "Gerente" : g.supervisor_role === "socio" ? "Gestora" : semSup ? "" : "Supervisor";
            if (semSup) {
              return (
                <div key="__sem__" className="supcard dashed">
                  <div className="sc-top">
                    <span className="sc-av none">—</span>
                    <div className="sc-id"><div className="sc-nm">Sem supervisor</div><div className="sc-sub">{g.promotores.length} promotor{g.promotores.length === 1 ? "" : "es"} · aguardando vínculo</div></div>
                  </div>
                  <div className="sc-mid"><div className="sc-fig"><span className="l">Projeção</span><span className="v num">{brl(g.projecao)}</span></div><div className="sc-fig"><span className="l">% meta</span><span className="v num">{pctTxt(g.percent_projetado)}</span></div></div>
                  <Link className="sc-assign" href="/admin/equipes">Atribuir supervisor →</Link>
                </div>
              );
            }
            return (
              <button key={g.supervisor_user_id ?? "__x__"} className="supcard" onClick={() => nav.goSupervisor(supKeyOf(g.supervisor_user_id))}>
                <div className="sc-top">
                  <span className="sc-av">{iniciais(g.supervisor_name)}</span>
                  <div className="sc-id">
                    <div className="sc-nm">{g.supervisor_name}{roleTag ? <span className="sc-role">{roleTag}</span> : null}</div>
                    <div className="sc-sub">{g.promotores.length} promotor{g.promotores.length === 1 ? "" : "es"}{g.manager_name ? ` · ${g.manager_name}` : ""}</div>
                  </div>
                  <Chip s={g.semaforo} />
                </div>
                <div className="sc-mid">
                  <div className="sc-fig"><span className="l">Projeção</span><span className="v num">{brl(g.projecao)}</span></div>
                  <div className="sc-fig"><span className="l">Meta</span><span className="v num">{g.meta > 0 ? brl(g.meta) : "—"}</span></div>
                  <div className="sc-fig"><span className="l">% meta</span><span className="v num">{pctTxt(g.percent_projetado)}</span></div>
                </div>
                <span className="sc-go">Ver equipe →</span>
              </button>
            );
          })}
          {gruposSupervisor.length === 0 ? (
            <div className="card"><div className="state">Nenhum supervisor com promotores nesta competência. Atribua em <Link href="/admin/equipes" className="ilink">Equipes</Link>.</div></div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// ============================================================
// VISÃO PROMOTOR (perfil) — só a própria projeção
// ============================================================
function PromotorView({ data }: { data: any }) {
  if (!data || data.scope !== "promotor") return null;
  const p: Promotor | null = data.promotor;
  if (!p) {
    return (
      <FeedbackBanner
        variant="warning"
        eyebrow="Sem dados"
        title="Não encontramos sua produção nesta competência."
        description="Assim que a produção for lançada, sua projeção aparece aqui."
      />
    );
  }

  const max = Math.max(p.projecao, p.meta, 1);
  const fillPct = Math.min(100, Math.round((p.projecao / max) * 100));
  const metaPct = p.meta > 0 ? Math.min(100, Math.round((p.meta / max) * 100)) : 0;
  const diff = p.projecao - p.meta;

  const historico: Array<{ key: string; production: number }> = data.historico || [];
  const maxHist = Math.max(p.projecao, ...historico.map((h) => h.production), 1);

  const bignumClass = p.semaforo === "verde" ? "" : p.semaforo === "amarelo" ? "a" : p.semaforo === "vermelho" ? "r" : "n";
  const tendUp = p.tendencia === "crescimento";
  const tendDown = p.tendencia === "queda";

  return (
    <>
      {/* HERO */}
      <section className="card">
        <div className="phero">
          <div className="pleft">
            <p className="hk">% projetado da sua meta</p>
            <div className={`bignum num ${bignumClass}`}>{pctTxt(p.percent_projetado)}</div>
            <div className="trendline">
              {p.tendencia === "sem_historico" ? (
                <span style={{ color: "var(--ink-3)" }}>sem histórico para comparar</span>
              ) : (
                <>
                  <span className={`tag ${tendUp ? "up" : tendDown ? "down" : "flat"}`}>
                    {tendUp ? <ArrowUp /> : tendDown ? <ArrowDown /> : <>→</>}
                    {p.tendencia_percent === null ? "" : ` ${diff >= 0 || tendUp ? "+" : ""}${(p.tendencia_percent * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                  </span>
                  <span>
                    {tendUp ? "acima" : tendDown ? "abaixo" : "em linha com"} da sua média dos últimos 3 meses
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="pright">
            <div className="metabar">
              <div className="mlabels">
                <span>Projeção <b>{brl(p.projecao)}</b></span>
                <span>Meta <b>{p.meta > 0 ? brl(p.meta) : "—"}</b></span>
              </div>
              <div className="track">
                <div className="fill" style={{ width: `${fillPct}%` }}>{brl(p.projecao)}</div>
                {p.meta > 0 ? <div className="metamark" style={{ left: `${metaPct}%` }} /> : null}
              </div>
              <div className="mfoot">
                {p.meta > 0 ? (
                  <>No ritmo atual você fecha <b>{brl(Math.abs(diff))} {diff >= 0 ? "acima" : "abaixo"} da meta</b>.</>
                ) : (
                  "Sem meta definida para esta competência."
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4 KPIs — faixa navy (kit) */}
      <div className="kpiwrap-navy">
        <KpiBand
          valueSize={24}
          items={[
            { label: "Produção acumulada", value: brl(p.producao_acumulada), sub: `até hoje · ${p.dias_uteis_decorridos}/${p.dias_uteis_totais} dias` },
            { label: "Projeção do mês", value: brl(p.projecao), sub: "estimativa de fechamento", accent: true },
            { label: "Sua meta", value: p.meta > 0 ? brl(p.meta) : "Sem meta", sub: mes(data.year, data.month) },
            { label: "Dias úteis", value: `${p.dias_uteis_decorridos} / ${p.dias_uteis_totais}`, sub: data.fechado ? "competência fechada" : "janela aberta" },
          ]}
        />
        {/* Seguro do PROPRIO promotor (route ja filtra: p = so o dele). SEM meta.
            Mostra o SHARE dele (repasse), nao a comissao-empresa: aberto = empresa
            × share_scale(penetracao); fechado = PMR (share gravado). */}
        <KpiBand
          valueSize={24}
          columns={2}
          items={[
            { label: "Comissão seguro proj.", value: brl(p.seguro_share_projecao), sub: "seu repasse · estimativa de fechamento", accent: true },
            { label: "Penetração seg.", value: pctTxt(p.seguro_penetracao), sub: "atual (não projetada)" },
          ]}
        />
      </div>

      {/* RITMO DIARIO — so aqui, na tela do promotor. Ver RitmoCard. */}
      <RitmoCard ritmo={data.ritmo ?? null} />

      {/* COMPARATIVO */}
      <section className="card">
        <div className="card-pad">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, marginBottom: 22 }}>
            <div>
              <h3 style={{ fontSize: 15.5, fontWeight: 600, margin: 0, color: "var(--ink)" }}>Comparativo de produção</h3>
              <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "5px 0 0" }}>Meses anteriores + projeção atual</p>
            </div>
            <span className={`chip ${tendUp ? "g" : tendDown ? "r" : p.tendencia === "estavel" ? "a" : "n"}`} style={{ alignSelf: "center" }}>
              <span className="d" />
              {tendUp ? "Tendência de alta" : tendDown ? "Tendência de queda" : p.tendencia === "estavel" ? "Estável" : "Sem histórico"}
            </span>
          </div>
          <div className="compbars">
            {historico.map((h) => (
              <div key={h.key} className="cbar">
                <span className="val num">{brl(h.production)}</span>
                <div className="plot"><div className="bar" style={{ height: `${Math.max(4, Math.round((h.production / maxHist) * 100))}%` }} /></div>
                <span className="ml">{h.key}</span>
              </div>
            ))}
            <div className="cbar proj">
              <span className="val num">{brl(p.projecao)}</span>
              <div className="plot"><div className="bar" style={{ height: `${Math.max(4, Math.round((p.projecao / maxHist) * 100))}%` }} /></div>
              <span className="ml">{mes(data.year, data.month).split("/")[0]}<small>PROJEÇÃO</small></span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

// ============================================================
// RITMO DIARIO NECESSARIO — SO na tela do promotor.
//
// DECISAO DIEGO (02/08): nao aparece em /equipe, nem na visao do gestor, nem
// em tabela nenhuma. A rota so monta o campo no ramo `role === "promotor"`
// (app/api/projecao/route.ts), entao nao ha como vazar por descuido de tela:
// nos outros ramos o dado nem existe no payload.
//
// A CONTA NAO MORA AQUI. `ritmo` chega pronto de lib/ritmoNecessario.ts — se
// voce precisou dividir algo antes de chegar neste componente, a conta esta no
// lugar errado (mesma regra do delta em lib/delta/calcularDelta.ts).
// ============================================================
type RitmoPayload = {
  estado: "SEM_META" | "META_BATIDA" | "MES_FECHADO" | "SEM_DIAS" | "ULTIMO_DIA" | "NORMAL";
  meta: number;
  acumulado: number;
  falta: number;
  excedente: number;
  diasRestantes: number;
  diasTotais: number;
  ritmoDiario: number | null;
  percent: number | null;
  semaforo: "verde" | "amarelo" | "vermelho" | "sem_meta";
};

function toneDoSemaforo(s: RitmoPayload["semaforo"]): "g" | "a" | "r" | "n" {
  return s === "verde" ? "g" : s === "amarelo" ? "a" : s === "vermelho" ? "r" : "n";
}

function RitmoCard({ ritmo }: { ritmo: RitmoPayload | null }) {
  if (!ritmo) return null;

  // TODO ESTADO VIRA TEXTO, nunca numero estranho: sem meta nao exibe
  // "R$ 0,00/dia", meta batida nao exibe ritmo negativo, e zero dia restante
  // nao divide por zero (o helper ja devolveu ritmoDiario null nesses casos).
  const dias = ritmo.diasRestantes;
  const plural = dias === 1 ? "dia útil restante" : "dias úteis restantes";

  const { titulo, valor, sub, tone } = (() => {
    switch (ritmo.estado) {
      case "SEM_META":
        return {
          titulo: "Ritmo diário necessário",
          valor: "Sem meta cadastrada",
          sub: "sua meta desta competência ainda não foi cadastrada",
          tone: "n" as const,
        };
      case "META_BATIDA":
        return {
          titulo: "Meta batida",
          valor: `+${brl(ritmo.excedente)}`,
          sub: `acima da meta de ${brl(ritmo.meta)}`,
          tone: "g" as const,
        };
      case "MES_FECHADO":
        return {
          titulo: "Competência fechada",
          valor: `Faltou ${brl(ritmo.falta)}`,
          sub: `de uma meta de ${brl(ritmo.meta)}`,
          tone: "r" as const,
        };
      case "SEM_DIAS":
        return {
          titulo: "Janela encerrada",
          valor: `Faltou ${brl(ritmo.falta)}`,
          sub: "aguardando o fechamento da competência",
          tone: "r" as const,
        };
      case "ULTIMO_DIA":
        return {
          titulo: "Último dia útil",
          valor: brl(ritmo.ritmoDiario ?? 0),
          sub: `é o que falta para bater a meta de ${brl(ritmo.meta)}`,
          tone: toneDoSemaforo(ritmo.semaforo),
        };
      default:
        return {
          titulo: "Ritmo diário necessário",
          valor: `${brl(ritmo.ritmoDiario ?? 0)}/dia`,
          sub: `${dias} ${plural} · faltam ${brl(ritmo.falta)} de ${brl(ritmo.meta)}`,
          tone: toneDoSemaforo(ritmo.semaforo),
        };
    }
  })();

  return (
    <section className="card">
      <div className="card-pad ritmo">
        <p className="rk">{titulo}</p>
        <div className={`rnum num ${tone}`}>{valor}</div>
        <p className="rsub">{sub}</p>
      </div>
    </section>
  );
}

const CSS = `
.rrproj{
  --navy:#0F1F4A; --navy-bar:#1E3066;
  --yellow:#FFF000; --gold:#D6A13F; --gold-deep:#B9842A; --gold-soft:#E7BE6A;
  --page:#EDEFF3; --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C;
  --green:#16A34A; --amber:#F59E0B; --red:#DC2626;
  --green-tx:#15803D; --amber-tx:#B45309; --red-tx:#B91C1C;
  --r-lg:20px; --r-md:16px;
  --shadow:0 1px 2px rgba(15,31,74,.04), 0 8px 24px rgba(15,31,74,.05);
  background:var(--page);color:var(--ink);font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.45;
}
.rrproj *{box-sizing:border-box;}
.rrproj .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;}
.rrproj .wrap{max-width:1180px;margin:0 auto;padding:30px 28px 60px;display:flex;flex-direction:column;gap:20px;}

.rrproj .crumb{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink-3);margin:-4px 2px -2px;}
.rrproj .crumb a{color:var(--ink-2);text-decoration:none;font-weight:500;}
.rrproj .crumb a:hover{color:var(--navy);}
.rrproj .crumb .sep{color:#C2C8D2;}

.rrproj .selectors{display:flex;gap:9px;flex-wrap:wrap;}
.rrproj .pill{position:relative;}
.rrproj .pill select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);color:#E4E9F4;padding:8px 34px 8px 14px;border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:500;cursor:pointer;}
.rrproj .pill select:focus{outline:none;border-color:rgba(255,255,255,.35);}
.rrproj .pill select option{color:#16203A;}
.rrproj .pill .chev{position:absolute;right:13px;top:50%;transform:translateY(-50%);pointer-events:none;color:#9DA9C6;font-size:10px;}
.rrproj .pill .plabel{position:absolute;top:-7px;left:13px;font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#7C88A8;background:var(--navy);padding:0 5px;}

.rrproj .badge-lg{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;padding:7px 14px;border-radius:999px;border:1px solid;letter-spacing:.01em;white-space:nowrap;}
.rrproj .badge-lg .d{width:9px;height:9px;border-radius:50%;}
.rrproj .badge-lg.g{background:rgba(22,163,74,.16);border-color:rgba(22,163,74,.4);color:#86EFAC;}
.rrproj .badge-lg.g .d{background:#4ADE80;}
.rrproj .badge-lg.a{background:rgba(245,158,11,.16);border-color:rgba(245,158,11,.42);color:#FCD34D;}
.rrproj .badge-lg.a .d{background:#FBBF24;}
.rrproj .badge-lg.r{background:rgba(220,38,38,.18);border-color:rgba(220,38,38,.42);color:#FCA5A5;}
.rrproj .badge-lg.r .d{background:#F87171;}
.rrproj .badge-lg.n{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.2);color:#C9D2E6;}
.rrproj .badge-lg.n .d{background:#9DA9C6;}

.rrproj .winnote{display:flex;align-items:center;gap:11px;background:#E7EAF0;border:1px solid #DCE0E8;border-radius:var(--r-md);padding:12px 18px;font-size:12.5px;color:var(--ink-2);flex-wrap:wrap;}
.rrproj .winnote .ic{flex:none;width:22px;height:22px;border-radius:6px;background:#fff;border:1px solid var(--bd);display:grid;place-items:center;color:var(--navy);}
.rrproj .winnote b{color:var(--ink);font-weight:600;}
.rrproj .winnote .sepd{color:#B6BDC9;}

.rrproj .chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:4px 11px;border-radius:999px;border:1px solid;white-space:nowrap;}
.rrproj .chip .d{width:6px;height:6px;border-radius:50%;}
.rrproj .chip.g{background:rgba(22,163,74,.10);border-color:rgba(22,163,74,.28);color:var(--green-tx);}
.rrproj .chip.g .d{background:var(--green);}
.rrproj .chip.a{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.30);color:var(--amber-tx);}
.rrproj .chip.a .d{background:var(--amber);}
.rrproj .chip.r{background:rgba(220,38,38,.09);border-color:rgba(220,38,38,.26);color:var(--red-tx);}
.rrproj .chip.r .d{background:var(--red);}
.rrproj .chip.n{background:#F1F3F7;border-color:var(--bd);color:var(--ink-3);}
.rrproj .chip.n .d{background:#9CA3AF;}

.rrproj .kpiwrap-navy{background:var(--navy);border-radius:var(--r-lg);padding:24px 28px 26px;position:relative;overflow:hidden;}
/* KpiBand foi desenhado p/ viver SOB o cabeçalho do HeaderNavy (margin-top + borda-topo
   separam do título). Standalone, neutralizo esse divisor: */
.rrproj .kpiwrap-navy .rrui-kpiband{margin-top:0;border-top:none;padding-top:0;}
/* link "não atribuído" (P2) legível sobre navy (gold-soft tracejado claro) */
.rrproj .kpiwrap-navy .pend{display:block;width:fit-content;margin-top:6px;font-size:11.5px;font-weight:500;color:var(--gold-soft);text-decoration:none;border-bottom:1px dashed rgba(231,190,106,.5);padding-bottom:1px;transition:color .14s,border-color .14s;}
.rrproj .kpiwrap-navy .pend:hover{color:#fff;border-color:rgba(255,255,255,.6);}
/* Chip semáforo on-navy — mesma paleta do .badge-lg (legível sobre navy) */
.rrproj .chip.on-navy.g{background:rgba(22,163,74,.16);border-color:rgba(22,163,74,.4);color:#86EFAC;}
.rrproj .chip.on-navy.g .d{background:#4ADE80;}
.rrproj .chip.on-navy.a{background:rgba(245,158,11,.16);border-color:rgba(245,158,11,.42);color:#FCD34D;}
.rrproj .chip.on-navy.a .d{background:#FBBF24;}
.rrproj .chip.on-navy.r{background:rgba(220,38,38,.18);border-color:rgba(220,38,38,.42);color:#FCA5A5;}
.rrproj .chip.on-navy.r .d{background:#F87171;}
.rrproj .chip.on-navy.n{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.2);color:#C9D2E6;}
.rrproj .chip.on-navy.n .d{background:#9DA9C6;}
.rrproj tr.na-row td{background:#FBFAF7;color:var(--ink-2);}
.rrproj tr.na-row .pname{font-weight:600;color:var(--ink-2);}
.rrproj tr.na-row .na-tag{display:block;font-size:10.5px;font-weight:500;color:var(--gold-deep,#B9842A);margin-top:2px;}

.rrproj .card{background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);overflow:hidden;}
.rrproj .card-pad{padding:24px 26px;}

.rrproj .risk-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:16px 24px;background:rgba(220,38,38,.05);border-bottom:1px solid rgba(220,38,38,.16);}
.rrproj .risk-head .lt{display:flex;align-items:center;gap:11px;}
.rrproj .risk-head .ic{width:30px;height:30px;border-radius:9px;background:rgba(220,38,38,.10);border:1px solid rgba(220,38,38,.22);display:grid;place-items:center;color:var(--red);flex:none;}
.rrproj .risk-head h3{font-size:15px;font-weight:600;margin:0;color:var(--ink);}
.rrproj .risk-head .csub{font-size:12px;color:var(--ink-3);margin-top:1px;}
.rrproj .risk-head .cnt{font-size:12px;font-weight:600;color:var(--red-tx);background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.2);padding:4px 11px;border-radius:999px;}
.rrproj .risk-list{display:flex;flex-direction:column;}
.rrproj .risk-row{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:16px;padding:14px 24px;border-top:1px solid var(--bd-soft);}
.rrproj .risk-row:first-child{border-top:none;}
.rrproj .risk-row .rank{width:24px;height:24px;border-radius:7px;background:#F3F5F8;border:1px solid var(--bd);display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--ink-2);flex:none;}
.rrproj .risk-row .who{min-width:0;}
.rrproj .risk-row .nm{font-size:14px;font-weight:600;color:var(--ink);}
.rrproj .risk-row .emp{font-size:12px;color:var(--ink-3);margin-top:1px;}
.rrproj .risk-row .proj{text-align:right;font-size:13.5px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap;}
.rrproj .risk-row .proj small{display:block;font-size:11px;font-weight:500;color:var(--ink-3);margin-top:1px;}
.rrproj .risk-empty{display:flex;align-items:center;gap:12px;padding:22px 24px;color:var(--ink-2);font-size:13px;}
.rrproj .risk-empty .ic{width:30px;height:30px;border-radius:9px;background:rgba(22,163,74,.1);border:1px solid rgba(22,163,74,.24);display:grid;place-items:center;color:var(--green);flex:none;}
.rrproj .risk-empty b{color:var(--ink);font-weight:600;}

.rrproj .emp-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;border-bottom:1px solid var(--bd-soft);flex-wrap:wrap;}
.rrproj .emp-head .left{display:flex;align-items:center;gap:13px;}
.rrproj .emp-head .st{width:10px;height:10px;border-radius:50%;flex:none;}
.rrproj .emp-head .st.g{background:var(--green);box-shadow:0 0 0 4px rgba(22,163,74,.16);}
.rrproj .emp-head .st.a{background:var(--amber);box-shadow:0 0 0 4px rgba(245,158,11,.16);}
.rrproj .emp-head .st.r{background:var(--red);box-shadow:0 0 0 4px rgba(220,38,38,.16);}
.rrproj .emp-head .st.n{background:#9CA3AF;box-shadow:0 0 0 4px rgba(156,163,175,.16);}
.rrproj .emp-head .nm{font-size:16px;font-weight:600;color:var(--ink);}
.rrproj .emp-head .cnpj{font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums;margin-top:2px;}
.rrproj .emp-head .right{display:flex;align-items:center;gap:18px;}
.rrproj .emp-head .pm{text-align:right;}
.rrproj .emp-head .pm .v{font-size:14px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;}
.rrproj .emp-head .pm .l{font-size:11px;color:var(--ink-3);margin-top:1px;}
.rrproj .emp-head .pct{font-size:18px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;}

/* Tabela migrada para o kit (<Table scrollable minWidth={760}>): scroll horizontal,
   min-width, thead/td base, zebra, hover e coluna fixa vêm do kit
   (.rr-table-wrap / .rrui-table / .rr-sticky-col). Mantidos só ajustes da tela:
   alinhamento dos cabeçalhos .r/.c, números tabulares, a divisória da 1ª coluna
   e o fundo próprio da linha "Não atribuído" na coluna congelada. */
.rrproj .rrui-table thead th.r{text-align:right;}
.rrproj .rrui-table thead th.c{text-align:center;}
.rrproj .rrui-table tbody td{vertical-align:middle;font-variant-numeric:tabular-nums;}
.rrproj .rrui-table .rr-sticky-col::after{content:"";position:absolute;top:0;right:0;bottom:0;width:1px;background:var(--bd-soft);}
.rrproj tr.na-row .rr-sticky-col{background:#FBFAF7;}
.rrproj .pname{font-weight:600;color:var(--ink);min-width:150px;}
.rrproj td.r{text-align:right;}
.rrproj td.c{text-align:center;}
.rrproj td.pctcell{font-weight:600;color:var(--ink);text-align:right;}
.rrproj .trend{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;font-weight:700;}
.rrproj .trend.up{color:var(--green);background:rgba(22,163,74,.1);}
.rrproj .trend.down{color:var(--red);background:rgba(220,38,38,.09);}
.rrproj .trend.flat{color:var(--ink-3);background:#F1F3F7;}
.rrproj .trend.none{color:#C2C8D2;}

.rrproj .phero{display:grid;grid-template-columns:1fr 1.25fr;gap:0;}
.rrproj .phero .pleft{padding:28px 30px;border-right:1px solid var(--bd-soft);}
.rrproj .phero .pright{padding:28px 30px;display:flex;flex-direction:column;justify-content:center;}
.rrproj .phero .hk{font-size:12px;font-weight:500;color:var(--ink-3);margin:0 0 6px;}
.rrproj .bignum{font-size:56px;font-weight:700;letter-spacing:-.03em;line-height:.95;color:var(--green-tx);font-variant-numeric:tabular-nums;}
.rrproj .bignum.a{color:var(--amber-tx);}
.rrproj .bignum.r{color:var(--red-tx);}
.rrproj .bignum.n{color:var(--ink-3);}
/* RITMO DIARIO — reusa as MESMAS cores semanticas do bignum (uma escala so).
   Sem largura fixa: o card ocupa a coluna e o numero encolhe no telefone. */
.rrproj .ritmo{display:flex;flex-direction:column;gap:6px;}
.rrproj .ritmo .rk{font-size:12.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3);margin:0;}
.rrproj .ritmo .rnum{font-size:40px;font-weight:700;letter-spacing:-.02em;line-height:1.05;color:var(--green-tx);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
.rrproj .ritmo .rnum.a{color:var(--amber-tx);}
.rrproj .ritmo .rnum.r{color:var(--red-tx);}
.rrproj .ritmo .rnum.n{color:var(--ink-3);}
.rrproj .ritmo .rsub{font-size:13px;color:var(--ink-2);margin:0;}
.rrproj .trendline{display:inline-flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:var(--ink-2);flex-wrap:wrap;}
.rrproj .trendline .tag{display:inline-flex;align-items:center;gap:6px;font-weight:700;}
.rrproj .trendline .tag.up{color:var(--green-tx);}
.rrproj .trendline .tag.down{color:var(--red-tx);}
.rrproj .trendline .tag.flat{color:var(--ink-2);}
.rrproj .trendline .tag svg{display:block;}
.rrproj .metabar .mlabels{display:flex;justify-content:space-between;font-size:12px;color:var(--ink-3);margin-bottom:10px;}
.rrproj .metabar .mlabels b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums;}
.rrproj .metabar .track{height:34px;border-radius:10px;background:#F1F3F7;border:1px solid var(--bd);position:relative;overflow:hidden;}
.rrproj .metabar .fill{position:absolute;left:0;top:0;bottom:0;border-radius:9px 0 0 9px;background:linear-gradient(90deg,#16A34A,#22C55E);display:flex;align-items:center;padding-left:13px;color:#fff;font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;}
.rrproj .metabar .metamark{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--navy);}
.rrproj .metabar .metamark::after{content:"Meta";position:absolute;top:-17px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;color:var(--navy);white-space:nowrap;}
.rrproj .metabar .mfoot{margin-top:13px;font-size:12px;color:var(--ink-3);}
.rrproj .metabar .mfoot b{color:var(--green-tx);font-weight:600;}

.rrproj .compbars{display:flex;align-items:flex-end;gap:20px;padding:0 6px;}
.rrproj .cbar{flex:1;display:flex;flex-direction:column;align-items:center;}
.rrproj .cbar .val{font-size:12px;font-weight:600;color:var(--ink-2);margin-bottom:8px;font-variant-numeric:tabular-nums;}
.rrproj .cbar .plot{width:100%;height:170px;display:flex;align-items:flex-end;justify-content:center;}
.rrproj .cbar .bar{width:100%;max-width:62px;border-radius:8px 8px 0 0;background:#D4DAE6;flex-shrink:0;}
.rrproj .cbar.proj .bar{background:linear-gradient(180deg,var(--navy-bar),var(--navy));}
.rrproj .cbar .ml{font-size:12px;color:var(--ink-3);margin-top:10px;text-align:center;}
.rrproj .cbar.proj .ml{color:var(--navy);font-weight:700;}
.rrproj .cbar .ml small{display:block;font-size:10px;font-weight:600;color:var(--gold-deep);letter-spacing:.04em;margin-top:1px;}

.rrproj .loading-row{display:flex;align-items:center;gap:12px;color:var(--ink-2);font-size:13.5px;font-weight:500;}
.rrproj .spinner{width:22px;height:22px;border-radius:50%;border:2.5px solid #E4E7EC;border-top-color:var(--navy);animation:rrproj-spin .8s linear infinite;flex:none;}
@keyframes rrproj-spin{to{transform:rotate(360deg);}}

@media (max-width:900px){
  .rrproj .phero{grid-template-columns:1fr;}
  .rrproj .phero .pleft{border-right:none;border-bottom:1px solid var(--bd-soft);}
}
@media (max-width:640px){
  .rrproj .wrap{padding:20px 16px 44px;}
  .rrproj .emp-head .right{width:100%;justify-content:space-between;}
  .rrproj .compbars{gap:10px;}
}

/* TELEFONE — os grids que nao colapsavam em nenhum breakpoint.

   .dw-kpis: repeat(3,1fr) direto para 1fr. Sao 3 valores monetarios; a 384px
   cada trilha ficava com ~90px.

   .risk-row: escolhi REFLUXO EM DUAS LINHAS (grid-area explicito), nao a
   reducao de padding sozinha. Motivo: a linha tem 4 trilhas, e tres delas sao
   de largura fixa por conteudo — .rank 24px, .proj com white-space:nowrap
   (linha 1205) segurando um BRL inteiro, e o .chip do semaforo, tambem nowrap.
   Quem absorve a sobra e o .who, que tem min-width:0 (linha 1202) e portanto
   encolhe ATE ZERO. Ou seja: o nome do promotor, que e a identidade da linha,
   era o unico item que sumia. Trocar 24px de padding por 14px devolve 20px —
   nao muda esse desfecho, so adia. Na forma escolhida o .who fica sozinho na
   primeira linha com a largura toda, e .proj + semaforo dividem a segunda.
   O padding lateral cai para 14px junto, porque ai ele e ganho liquido.

   .pname: o min-width:150px travava a coluna do nome nas tabelas. */
@media (max-width:560px){
  .rrproj .dw-kpis{grid-template-columns:1fr;}

  /* RITMO — a 356px uteis, "R$ 250.000,00/dia" a 40px estoura a linha. 28px
     cabe inteiro; o overflow-wrap do bloco base cobre os valores maiores. */
  .rrproj .ritmo .rnum{font-size:28px;}

  .rrproj .risk-row{grid-template-columns:auto 1fr auto;row-gap:10px;column-gap:12px;padding:14px 14px;}
  .rrproj .risk-row .rank{grid-area:1 / 1;}
  .rrproj .risk-row .who{grid-area:1 / 2 / auto / 4;}
  .rrproj .risk-row .proj{grid-area:2 / 2;text-align:left;}
  .rrproj .risk-row > .chip{grid-area:2 / 3;justify-self:end;}

  .rrproj .pname{min-width:0;}

  /* comissao de gestao: uma coluna e valor menor. O auto-fit ja empilharia por
     falta de espaco, mas o minmax(0,1fr) permite duas colunas de 170px cada a
     356px uteis — legivel demais nao fica. Forca 1fr e reduz o padding lateral. */
  .rrproj .cgest-body{grid-template-columns:1fr;gap:16px;padding:14px 16px 18px;}
  .rrproj .cgest-head{padding:16px 16px 0;}
  .rrproj .cgest-fig .v{font-size:22px;}
  .rrproj .cgest-lacuna{padding:12px 16px 16px;}
}

@media (max-width:430px){ .rrproj .wrap{padding:16px 12px 36px;} }

/* ---------- drill-down histórico (aditivo): clicáveis, gráfico de linha, drawer ---------- */
.rrproj .emp-head.clickhead{cursor:pointer;}
.rrproj .emp-head.clickhead:hover{background:rgba(15,31,74,.02);}
.rrproj .emp-head .drill{font-size:11px;font-weight:600;color:var(--gold-deep);opacity:0;transition:opacity .15s;margin-left:6px;}
.rrproj .emp-head.clickhead:hover .drill{opacity:1;}
.rrproj tr.clickrow{cursor:pointer;}
.rrproj tr.clickrow:hover td{background:rgba(15,31,74,.035);}
.rrproj .lc svg{width:100%;height:auto;display:block;}
.rrproj .lc-x{display:flex;justify-content:space-between;margin-top:4px;padding:0 2px;}
.rrproj .lc-x span{font-size:10px;color:var(--ink-3);font-variant-numeric:tabular-nums;}
.rrproj .lc-x span.on{color:var(--navy);font-weight:700;}
.rrproj .lc-x span.on.proj{color:var(--gold-deep);}
.rrproj .lc-cap{font-size:11.5px;color:var(--ink-3);margin-top:8px;}
.rrproj .lc-cap b{color:var(--ink);font-weight:600;}
.rrproj .drawer{position:fixed;inset:0;background:rgba(15,31,74,.32);display:flex;justify-content:flex-end;z-index:60;}
.rrproj .dw-panel{width:min(580px,94vw);height:100%;background:var(--page);box-shadow:-8px 0 30px rgba(15,31,74,.18);display:flex;flex-direction:column;animation:rrproj-slide .2s ease;}
@keyframes rrproj-slide{from{transform:translateX(24px);opacity:.6;}to{transform:translateX(0);opacity:1;}}
.rrproj .dw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 22px;background:var(--navy);color:#fff;}
.rrproj .dw-head h3{margin:0;font-size:16px;font-weight:600;}
.rrproj .dw-sub{margin:5px 0 0;font-size:11.5px;color:#B7C0D8;line-height:1.4;}
.rrproj .dw-x{background:rgba(255,255,255,.1);border:none;color:#fff;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px;}
.rrproj .dw-x:hover{background:rgba(255,255,255,.2);}
.rrproj .dw-body{padding:18px 20px 40px;overflow-y:auto;display:flex;flex-direction:column;gap:18px;}
.rrproj .dw-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.rrproj .dwk{background:#fff;border:1px solid var(--bd);border-radius:var(--r-md);padding:12px 14px;display:flex;flex-direction:column;gap:3px;}
.rrproj .dwk .l{font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink-3);}
.rrproj .dwk .v{font-size:16px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;}
.rrproj .dw-block{background:#fff;border:1px solid var(--bd);border-radius:var(--r-md);padding:16px 18px;}
.rrproj .dw-block h4{margin:0 0 12px;font-size:12.5px;font-weight:600;color:var(--ink-2);display:flex;align-items:baseline;gap:8px;}
.rrproj .dw-block .dw-hint{font-size:10.5px;font-weight:500;color:var(--ink-3);text-transform:none;letter-spacing:0;}
.rrproj .dw-empty{padding:16px 4px;color:var(--ink-3);font-size:12.5px;text-align:center;}

/* ---------- comissao de gestao (so no ramo do gestor) ----------
   SEM largura fixa em lugar nenhum: o grid e auto-fit com minmax(0,1fr), entao
   os dois numeros dividem o espaco disponivel e nunca pedem mais do que ha.
   A 560px vira uma coluna, junto com o resto da tela. */
.rrproj .cgest{border-left:4px solid var(--gold);}
.rrproj .cgest-head{padding:18px 24px 0;}
.rrproj .cgest-head h3{font-size:14.5px;font-weight:600;margin:0;color:var(--ink);}
.rrproj .cgest-head .csub{font-size:12px;color:var(--ink-3);margin:3px 0 0;}
.rrproj .cgest-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(0,1fr));gap:18px;padding:16px 24px 22px;}
.rrproj .cgest-fig{display:flex;flex-direction:column;gap:3px;min-width:0;}
.rrproj .cgest-fig .l{font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink-3);}
.rrproj .cgest-fig .v{font-size:26px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1.1;}
.rrproj .cgest-fig.proj .v{color:var(--gold-deep);}
.rrproj .cgest-fig .s{font-size:11.5px;color:var(--ink-3);}
.rrproj .cgest-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.rrproj .cgest-tag{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px;white-space:nowrap;}
.rrproj .cgest-tag.parcial{color:var(--gold-deep);background:rgba(214,161,63,.14);border:1px solid rgba(214,161,63,.34);}
.rrproj .cgest-lacuna{margin:0;padding:12px 24px 18px;font-size:12px;line-height:1.5;color:var(--ink-2);border-top:1px solid var(--bd-soft);}
.rrproj .cgest-lacuna b{color:var(--ink);font-weight:600;}

/* ---------- segmented control (por estado | por supervisor) ---------- */
.rrproj .seg2{display:inline-flex;gap:4px;background:#E7EAF0;border:1px solid var(--bd);border-radius:999px;padding:4px;width:fit-content;margin:-4px 2px 0;}
.rrproj .seg2 button{appearance:none;border:none;background:transparent;color:var(--ink-2);font-family:inherit;font-size:12.5px;font-weight:600;padding:8px 18px;border-radius:999px;cursor:pointer;transition:.15s;white-space:nowrap;}
.rrproj .seg2 button:hover{color:var(--navy);}
.rrproj .seg2 button.on{background:var(--navy);color:var(--yellow);}

/* ---------- cards por supervisor ---------- */
.rrproj .supgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;}
.rrproj .supcard{text-align:left;background:var(--card);border:1px solid var(--bd);border-radius:var(--r-lg);box-shadow:var(--shadow);padding:18px 20px;display:flex;flex-direction:column;gap:14px;cursor:pointer;font-family:inherit;transition:box-shadow .15s,transform .05s;}
.rrproj .supcard:hover{box-shadow:0 2px 4px rgba(15,31,74,.06),0 12px 30px rgba(15,31,74,.09);}
.rrproj .supcard:active{transform:translateY(1px);}
.rrproj .supcard.dashed{border-style:dashed;background:#FBFAF7;cursor:default;}
.rrproj .supcard.dashed:hover{box-shadow:var(--shadow);}
.rrproj .supcard .sc-top{display:flex;align-items:center;gap:12px;}
.rrproj .supcard .sc-av{flex:none;width:42px;height:42px;border-radius:12px;background:var(--navy);color:#fff;display:grid;place-items:center;font-size:14px;font-weight:700;letter-spacing:.02em;}
.rrproj .supcard .sc-av.none{background:#EEF0F4;color:var(--ink-3);}
.rrproj .supcard .sc-id{flex:1;min-width:0;}
.rrproj .supcard .sc-nm{font-size:14.5px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.rrproj .supcard .sc-role{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--gold-deep);background:rgba(214,161,63,.14);border:1px solid rgba(214,161,63,.32);padding:1px 7px;border-radius:999px;}
.rrproj .supcard .sc-sub{font-size:12px;color:var(--ink-3);margin-top:2px;}
.rrproj .supcard .sc-mid{display:flex;gap:18px;padding-top:12px;border-top:1px solid var(--bd-soft);}
.rrproj .supcard .sc-fig{display:flex;flex-direction:column;gap:2px;}
.rrproj .supcard .sc-fig .l{font-size:10.5px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink-3);}
.rrproj .supcard .sc-fig .v{font-size:15px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;}
.rrproj .supcard .sc-go{font-size:12px;font-weight:600;color:var(--navy);}
.rrproj .supcard .sc-assign{font-size:12.5px;font-weight:600;color:var(--gold-deep);text-decoration:none;border-bottom:1px dashed rgba(185,132,42,.5);width:fit-content;padding-bottom:1px;}
.rrproj .supcard .sc-assign:hover{color:var(--navy);}

/* ---------- tela cheia (drill) ---------- */
.rrproj .drillhead{display:flex;flex-direction:column;gap:14px;background:var(--navy);border-radius:var(--r-lg);padding:20px 24px 22px;color:#fff;}
.rrproj .backbtn{appearance:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#E4E9F4;font-family:inherit;font-size:12.5px;font-weight:600;padding:7px 14px;border-radius:999px;cursor:pointer;width:fit-content;}
.rrproj .backbtn:hover{background:rgba(255,255,255,.14);}
.rrproj .drillhead .dh-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.rrproj .drillhead .dh-id h2{margin:0;font-size:22px;font-weight:700;letter-spacing:-.01em;color:#fff;}
.rrproj .drillhead .dh-id p{margin:5px 0 0;font-size:12.5px;color:#B7C0D8;}
.rrproj .drill-h{font-size:14.5px;font-weight:600;margin:0 0 14px;color:var(--ink);display:flex;align-items:baseline;gap:8px;}
.rrproj .drill-hint{font-size:11px;font-weight:500;color:var(--ink-3);}
.rrproj .drill-empty{padding:16px 4px;color:var(--ink-3);font-size:12.5px;text-align:center;}
`;
