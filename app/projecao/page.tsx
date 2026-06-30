"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser } from "../../lib/auth/useUser";
import FeedbackBanner from "../../components/FeedbackBanner";
import { UiStyles, HeaderNavy, KpiBand, Table } from "@/components/ui";

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
  dias_uteis_decorridos: number;
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
  company_id: string;
  company_name: string;
  company_cnpj: string;
  producao_acumulada: number;
  projecao: number;
  meta: number;
  percent_projetado: number | null;
  semaforo: Semaforo;
  promotores: Promotor[];
  nao_atribuido?: NaoAtribuido | null;
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

export default function ProjecaoPage() {
  const { user, loading: userLoading } = useUser();
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [companyId, setCompanyId] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isPromotor = user?.role === "promotor";

  // Competencias recentes (atual + 5 anteriores).
  const periodOptions = useMemo(() => {
    const out: Array<{ key: string; label: string; y: number; m: number }> = [];
    for (let k = 0; k < 6; k++) {
      const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth() + 1;
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
          <span>Projeção</span>
        </nav>

        {/* HEADER navy (kit) — badge semáforo no slot badge, pills no slot actions */}
        <HeaderNavy
          brand="GRUPO RR CRED"
          title={isPromotor ? (prom?.promoter_name ?? "Minha projeção") : "Projeção da equipe"}
          subtitle={
            isPromotor
              ? `${prom?.company_name ?? "—"} · projeção individual · ${mes(year, month)}`
              : "Estimativa de fechamento por ritmo linear · todos os CNPJ"
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
          <EquipeView data={data} />
        )}
      </main>
    </div>
  );
}

// ============================================================
// VISÃO EQUIPE (socio / funcionario)
// ============================================================
function EquipeView({ data }: { data: any }) {
  if (!data || data.scope !== "equipe") return null;
  const cons = data.consolidado;
  const grupos: Grupo[] = data.grupos || [];
  const risco: Promotor[] = data.risco || [];
  const jan = data.janela;

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
      {/* KPIs — faixa navy (kit) */}
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
                    <Link className="pend" href="/promotores?tab=migracao">
                      inclui {brl(cons.nao_atribuido.acumulada)} em {cons.nao_atribuido.count} não atribuída
                      {cons.nao_atribuido.count > 1 ? "s" : ""} →
                    </Link>
                  ) : null}
                </>
              ),
            },
            { label: "Projeção do grupo", value: brl(cons.projecao), sub: "estimativa de fechamento", accent: true },
            { label: "Meta do grupo", value: brl(cons.meta), sub: "soma das metas por CNPJ" },
            { label: "% projetado do grupo", value: pctTxt(cons.percent_projetado), sub: <Chip s={cons.semaforo} onNavy /> },
          ]}
        />
        {/* Seguro (DB-driven). KPI do GRUPO = comissão-EMPRESA (aberto §188; fechado
            fechamento.valor_seguro), MESMA fonte do dashboard/financeiro. Penetracao =
            card proprio (atual, ponderada); SEM meta/semaforo. */}
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
      </div>

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

      {/* TABELAS POR CNPJ */}
      {grupos.map((g) => (
        <section key={g.company_id || g.company_cnpj} className="card">
          <div className="emp-head">
            <div className="left">
              <span className={`st ${CHIP[g.semaforo]}`} />
              <div>
                <div className="nm">{g.company_name}</div>
                <div className="cnpj">{g.company_cnpj ? `CNPJ ${g.company_cnpj}` : "—"}</div>
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
          <Table scrollable minWidth={880}>
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
                  <tr key={p.promoter_id}>
                    <td className="rr-sticky-col pname">{p.promoter_name}</td>
                    <td className="r">{brl(p.producao_acumulada)}</td>
                    <td className="r">{brl(p.projecao)}</td>
                    <td className="r">{p.meta > 0 ? brl(p.meta) : "—"}</td>
                    <td className="pctcell">{pctTxt(p.percent_projetado)}</td>
                    <td className="c"><TrendCell p={p} /></td>
                    <td className="c"><Chip s={p.semaforo} /></td>
                    <td className="r">{pctTxt(p.seguro_penetracao)}</td>
                  </tr>
                ))}
                {g.nao_atribuido && g.nao_atribuido.acumulada > 0 ? (
                  <tr className="na-row">
                    <td className="rr-sticky-col pname">
                      Não atribuído · chave master
                      <span className="na-tag">{g.nao_atribuido.count} prop · aguardando Migração</span>
                    </td>
                    <td className="r">{brl(g.nao_atribuido.acumulada)}</td>
                    <td className="r">{brl(g.nao_atribuido.projecao)}</td>
                    <td className="r">—</td>
                    <td className="pctcell">—</td>
                    <td className="c">—</td>
                    <td className="c">—</td>
                    <td className="r">—</td>
                  </tr>
                ) : null}
              </tbody>
          </Table>
        </section>
      ))}
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
`;
