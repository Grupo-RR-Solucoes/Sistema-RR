"use client";

import { useEffect, useMemo, useState } from "react";

import { UiStyles, HeaderNavy, KpiBand, Table } from "@/components/ui";
import type { UserRole } from "@/lib/auth/types";
import type {
  TeamProductionPayload,
  TeamPromoterRow,
  PromoterMonthly,
  MonthPoint,
  TargetStatus,
} from "@/lib/equipe/teamProduction";

import { RRTEAM_CSS } from "./equipeStyles";

interface Props {
  role: UserRole;
  email: string;
  fullName: string | null;
}

const brl = (n: number) =>
  "R$ " +
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const brl0 = (n: number) =>
  "R$ " + new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number | null) =>
  n === null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const STATUS_LABEL: Record<TargetStatus, string> = {
  META_2: "Meta 2",
  META_1: "Meta 1",
  META: "Bateu a meta",
  BELOW_META: "Abaixo",
  SEM_META: "Sem meta",
};

const ROLE_LABEL: Record<string, string> = {
  supervisor: "Supervisor",
  gerente_regional: "Gerente Regional",
};

// Semáforo de COR pelo % de atingimento (net/meta) — MESMA regra da Projeção
// (semaforoFromPercent de lib/projecaoMetas): >=100 verde, >=80 amarelo, <80
// vermelho, sem meta = neutro. (Aqui o valor é percentual, não ratio.)
function semColor(attainmentPercent: number | null): "g" | "a" | "r" | "n" {
  if (attainmentPercent === null) return "n";
  if (attainmentPercent >= 100) return "g";
  if (attainmentPercent >= 80) return "a";
  return "r";
}

// ---------- Gráfico de linha (SVG inline, mesmo idiom de Recebíveis/Projeção) ----------
function LineChart({
  points,
  color = "#0F1F4A",
  height = 128,
  fmt,
}: {
  points: Array<{ label: string; value: number }>;
  color?: string;
  height?: number;
  fmt: (n: number) => string;
}) {
  const W = 680;
  const H = height;
  const padL = 10;
  const padR = 12;
  const padT = 14;
  const padB = 24;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => (n <= 1 ? padL : padL + (i * (W - padL - padR)) / (n - 1));
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area =
    n > 0
      ? `${line} L${x(n - 1).toFixed(1)},${(H - padB).toFixed(1)} L${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z`
      : "";
  const last = points[n - 1];
  return (
    <div className="lc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Produção mensal" preserveAspectRatio="none">
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#E4E7EC" strokeWidth={1} />
        {area ? <path d={area} fill={color} opacity={0.08} /> : null}
        {line ? <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /> : null}
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={2.6} fill={color} />
        ))}
      </svg>
      <div className="lc-x">
        {points.map((p, i) => (
          <span key={i} className={i === n - 1 ? "on" : ""}>
            {p.label.split("/")[0]}
          </span>
        ))}
      </div>
      {last ? (
        <div className="lc-cap">
          Último ({last.label}): <b>{fmt(last.value)}</b> · pico {fmt(max)}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Tabela-ranking de promotores (clicável → detalhe) ----------
type SortKey = "prod" | "pen" | "att";
function RankingTable({
  rows,
  onSelect,
}: {
  rows: TeamPromoterRow[];
  onSelect: (promoterId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("prod");
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const val = (r: TeamPromoterRow) =>
      sortKey === "prod" ? r.production_value : sortKey === "pen" ? r.insurance_penetration_percent : r.attainment_percent ?? -1;
    const arr = [...rows].sort((a, b) => val(a) - val(b));
    return asc ? arr : arr.reverse();
  }, [rows, sortKey, asc]);

  const head = (key: SortKey, label: string) => (
    <th
      className={`r sortable${sortKey === key ? " on" : ""}`}
      onClick={() => {
        if (sortKey === key) setAsc((v) => !v);
        else {
          setSortKey(key);
          setAsc(false);
        }
      }}
    >
      {label}
      {sortKey === key ? <span className="arr">{asc ? "▲" : "▼"}</span> : null}
    </th>
  );

  return (
    <Table scrollable minWidth={760} cards>
      <thead>
        <tr>
          <th className="rr-sticky-col">Promotor</th>
          {head("prod", "Produção")}
          {head("pen", "Penetração seg.")}
          {head("att", "% meta")}
          <th className="c">Status</th>
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr>
            <td colSpan={5} className="emptyrow">
              Nenhuma produção nesta competência.
            </td>
          </tr>
        ) : (
          sorted.map((p) => (
            <tr key={p.promoter_id} className="clickrow" onClick={() => onSelect(p.promoter_id)}>
              {/* data-l = rotulo EXATO do thead acima. Os tres do meio saem do
                  helper head(), que renderiza {label} + a seta de ordenacao; a
                  seta e estado, nao rotulo, entao fica de fora do data-l. */}
              <td className="rr-sticky-col pname" data-l="Promotor">{p.promoter_name}</td>
              <td className="r" data-l="Produção">{brl(p.production_value)}</td>
              <td className="r" data-l="Penetração seg.">{pct(p.insurance_penetration_percent)}</td>
              <td className="r" data-l="% meta">{pct(p.attainment_percent)}</td>
              <td className="c" data-l="Status">
                <span className={`chip ${semColor(p.attainment_percent)}`}>
                  <span className="d" />
                  {STATUS_LABEL[p.target_status]}
                </span>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </Table>
  );
}

// ---------- Detalhe do promotor (drawer) — só produção/penetração/meta ----------
function PromoterDetail({
  row,
  monthly,
  onClose,
}: {
  row: TeamPromoterRow;
  monthly: PromoterMonthly | null;
  onClose: () => void;
}) {
  const months = monthly?.months ?? [];
  const prodPts = months.map((m) => ({ label: m.label, value: m.production_value }));
  const penPts = months.map((m) => ({ label: m.label, value: m.insurance_penetration_percent }));
  const hist = [...months].reverse().filter((m) => m.production_value > 0 || m.meta > 0);

  return (
    <div className="drawer" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dw-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dw-head">
          <div>
            <h3>{row.promoter_name}</h3>
            <p className="dw-sub">
              {row.supervisor_name ? `Supervisor: ${row.supervisor_name} · ` : ""}produção, penetração e meta — sem
              comissão.
            </p>
          </div>
          <button className="dw-x" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="dw-body">
          <div className="dw-block">
            <h4>Produção líquida mês a mês</h4>
            <LineChart points={prodPts} color="#0F1F4A" fmt={brl0} />
          </div>
          <div className="dw-block">
            <h4>Penetração de seguro por mês</h4>
            <LineChart points={penPts} color="#D6A13F" fmt={(n) => pct(n)} height={110} />
          </div>
          <div className="dw-block">
            <h4>Meta vs realizado (histórico)</h4>
            <Table scrollable minWidth={520} cards>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="r">Produção</th>
                  <th className="r">Meta</th>
                  <th className="r">% atingido</th>
                  <th className="c">Status</th>
                </tr>
              </thead>
              <tbody>
                {hist.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="emptyrow">
                      Sem histórico de produção ou meta.
                    </td>
                  </tr>
                ) : (
                  hist.map((m) => (
                    <tr key={`${m.year}-${m.month}`}>
                      <td data-l="Mês">{m.label}</td>
                      <td className="r" data-l="Produção">{brl(m.production_value)}</td>
                      <td className="r" data-l="Meta">{m.meta > 0 ? brl(m.meta) : "—"}</td>
                      <td className="r" data-l="% atingido">{pct(m.attainment_percent)}</td>
                      <td className="c" data-l="Status">
                        <span className={`chip ${semColor(m.attainment_percent)}`}>
                          <span className="d" />
                          {m.meta > 0 ? (m.attainment_percent != null && m.attainment_percent >= 100 ? "Bateu" : "Abaixo") : "Sem meta"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Bloco de supervisor expansível (visão gerente) ----------
interface SupervisorAgg {
  id: string;
  name: string;
  rows: TeamPromoterRow[];
  production: number;
  meta: number;
  projection: number;
  attainment_percent: number | null;
}

function SupervisorBlock({
  sup,
  open,
  onToggle,
  onSelect,
}: {
  sup: SupervisorAgg;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={`suprow${open ? " open" : ""}`}>
      <button className="sup-head" onClick={onToggle}>
        <span className="sup-chev">{open ? "▾" : "▸"}</span>
        <span className="sup-nm">{sup.name}</span>
        <span className="sup-meta">
          {sup.rows.length} promotor{sup.rows.length === 1 ? "" : "es"}
        </span>
        <span className="sup-prod num">{brl0(sup.production)}</span>
        <span className={`chip ${semColor(sup.attainment_percent)}`}>
          <span className="d" />
          {sup.attainment_percent != null ? pct(sup.attainment_percent) : "sem meta"}
        </span>
      </button>
      {open ? (
        <div className="sup-body">
          <RankingTable rows={sup.rows} onSelect={onSelect} />
        </div>
      ) : null}
    </div>
  );
}

export default function EquipeVisao({ role, email, fullName }: Props) {
  const [data, setData] = useState<TeamProductionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<{ year: number; month: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [openSup, setOpenSup] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError("");
        const params = new URLSearchParams();
        if (sel) {
          params.set("year", String(sel.year));
          params.set("month", String(sel.month));
        }
        const qs = params.toString();
        const res = await fetch(`/api/equipe${qs ? `?${qs}` : ""}`, { cache: "no-store" });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || "Erro ao carregar a equipe.");
        if (!cancelled) setData(payload as TeamProductionPayload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar a equipe.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sel]);

  const period = data?.period;
  const totals = data?.totals;
  const rows: TeamPromoterRow[] = data?.rows ?? [];
  const isGerente = role === "gerente_regional";

  const periodOptions = useMemo(() => {
    const list = data?.periods ? [...data.periods] : [];
    if (period && !list.some((p) => p.year === period.year && p.month === period.month)) {
      list.unshift(period);
    }
    return list;
  }, [data?.periods, period]);

  // Entrega 2 — meta EFETIVA do gestor (override ?? derivada). Sem override,
  // efetiva === totals.meta → % e projeção idênticos ao anterior (não-regressão).
  const efetiva = data?.gestor_meta?.efetiva ?? totals?.meta ?? 0;
  const overrideMeta = data?.gestor_meta?.override ?? null;
  const projPercent = totals && efetiva > 0 ? (data!.period_projection.production_value / efetiva) * 100 : null;
  const realizadoPercent = totals && efetiva > 0 ? (totals.production_value / efetiva) * 100 : null;

  const anualPts: Array<{ label: string; value: number }> = (data?.monthlySeries ?? []).map((m: MonthPoint) => ({
    label: m.label,
    value: m.production_value,
  }));

  // Agrupamento por supervisor (visão gerente).
  const supervisors: SupervisorAgg[] = useMemo(() => {
    const map = new Map<string, SupervisorAgg>();
    for (const r of rows) {
      const id = r.supervisor_id ?? "__none__";
      const g =
        map.get(id) ??
        ({ id, name: r.supervisor_name ?? "Sem supervisor", rows: [], production: 0, meta: 0, projection: 0, attainment_percent: null } as SupervisorAgg);
      g.rows.push(r);
      g.production += r.production_value;
      g.meta += r.meta;
      g.projection += r.projection_value;
      map.set(id, g);
    }
    const list = Array.from(map.values()).map((g) => ({
      ...g,
      attainment_percent: g.meta > 0 ? (g.production / g.meta) * 100 : null,
    }));
    return list.sort((a, b) => b.production - a.production);
  }, [rows]);

  const selectedRow = rows.find((r) => r.promoter_id === selected) ?? null;
  const selectedMonthly = data?.perPromoterMonthly.find((m) => m.promoter_id === selected) ?? null;

  const monthLabel = period ? `${MONTHS[period.month - 1]}/${String(period.year).slice(-2)}` : "";

  return (
    <div className="rrteam">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: RRTEAM_CSS + EXTRA_CSS }} />
      <main className="wrap">
        <nav className="crumb">
          <span>Gestão</span>
          <span className="sep">/</span>
          <span className="cur">Minha Equipe</span>
        </nav>

        <HeaderNavy
          title="Minha Equipe"
          subtitle={
            isGerente
              ? "Produção e desempenho da sua regional — supervisores e promotores"
              : "Produção e desempenho dos seus promotores"
          }
          actions={
            <div className="selectors">
              <div className="pill">
                <span className="plabel">Competência</span>
                <select
                  aria-label="Competência"
                  value={period ? `${period.year}-${period.month}` : ""}
                  onChange={(e) => {
                    const [y, m] = e.target.value.split("-").map(Number);
                    setSel({ year: y, month: m });
                    setSelected(null);
                  }}
                >
                  {periodOptions.map((p) => (
                    <option key={p.key} value={`${p.year}-${p.month}`}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <span className="chev">▾</span>
              </div>
              <span className="role">
                <span className="d" />
                {fullName ?? email} · {ROLE_LABEL[role] ?? role}
              </span>
            </div>
          }
        >
          <KpiBand
            valueSize={24}
            items={[
              {
                label: isGerente ? "Produção da regional" : "Produção do time",
                value: brl(totals?.production_value ?? 0),
                sub: `${totals?.promoters ?? 0} promotor${(totals?.promoters ?? 0) === 1 ? "" : "es"} · ${totals?.proposal_count ?? 0} propostas`,
                accent: true,
                // Delta vem PRONTO de buildTeamProduction (lib/delta/calcularDelta
                // roda no servidor). Aqui não há conta nenhuma — só repasse.
                delta: data?.deltaProducao,
              },
              {
                label: "% da meta",
                value: pct(realizadoPercent),
                sub: efetiva > 0 ? `meta ${brl0(efetiva)}${overrideMeta != null ? " · ajustada" : ""}` : "sem meta",
              },
              {
                label: "Projeção fim do mês",
                value: brl(data?.period_projection.production_value ?? 0),
                sub: projPercent != null ? `${pct(projPercent)} da meta` : "ritmo atual",
              },
              {
                label: "Penetração seguro",
                value: pct(totals?.insurance_penetration_percent ?? 0),
                sub: "% do bruto com seguro",
              },
            ]}
          />
        </HeaderNavy>

        {error ? (
          <div className="card" style={{ padding: "16px 20px", color: "var(--red-tx)" }}>
            {error}
          </div>
        ) : null}

        {/* META vs REALIZADO + projeção */}
        <div className="card metacard">
          <div className="tcard-head">
            <div>
              <h2>Meta vs realizado {monthLabel ? `· ${monthLabel}` : ""}</h2>
              <p className="csub">Realizado = produção líquida no período (status produção, sem SRCC)</p>
            </div>
          </div>
          <div className="metabody">
            <div className="mb-track">
              <div
                className="mb-fill"
                style={{ width: `${Math.min(100, realizadoPercent ?? 0)}%` }}
              />
              {projPercent != null ? (
                <div className="mb-proj" style={{ left: `${Math.min(100, projPercent)}%` }} title="Projeção">
                  <span className="mb-proj-dot" />
                </div>
              ) : null}
            </div>
            <p className="mb-cap">
              {efetiva > 0 ? (
                <>
                  Realizado <b>{brl(totals?.production_value ?? 0)}</b> de <b>{brl(efetiva)}</b>
                  {overrideMeta != null ? <span className="metatag">meta ajustada</span> : null} (
                  {pct(realizadoPercent)}). No ritmo atual, {isGerente ? "a regional" : "o time"} fecha em{" "}
                  <b>{brl(data?.period_projection.production_value ?? 0)}</b>
                  {projPercent != null ? <> ({pct(projPercent)} da meta)</> : null}.
                </>
              ) : (
                <>
                  Sem meta cadastrada. No ritmo atual, {isGerente ? "a regional" : "o time"} fecha em{" "}
                  <b>{brl(data?.period_projection.production_value ?? 0)}</b>.
                </>
              )}
            </p>
          </div>
        </div>

        {/* GRÁFICO ANUAL (linha) */}
        <div className="card">
          <div className="tcard-head">
            <div>
              <h2>Produção mensal {isGerente ? "da regional" : "do time"} · 2026</h2>
              <p className="csub">Produção líquida mês a mês (jan → competência corrente)</p>
            </div>
          </div>
          <div className="chartwrap">
            {loading ? (
              <p className="loadmsg">
                <span className="spinner" />Carregando…
              </p>
            ) : (
              <LineChart points={anualPts} color="#0F1F4A" fmt={brl0} height={150} />
            )}
          </div>
        </div>

        {/* TABELA / LISTA */}
        {isGerente ? (
          <div className="card">
            <div className="tcard-head">
              <div>
                <h2>Supervisores</h2>
                <p className="csub">Clique para expandir os promotores de cada supervisor · promotor clicável abre o detalhe</p>
              </div>
            </div>
            <div className="suplist">
              {loading ? (
                <p className="loadmsg">
                  <span className="spinner" />Carregando…
                </p>
              ) : supervisors.length === 0 ? (
                <p className="loadmsg">Nenhuma produção da sua regional nesta competência.</p>
              ) : (
                supervisors.map((sup) => (
                  <SupervisorBlock
                    key={sup.id}
                    sup={sup}
                    open={openSup.has(sup.id)}
                    onToggle={() =>
                      setOpenSup((prev) => {
                        const next = new Set(prev);
                        if (next.has(sup.id)) next.delete(sup.id);
                        else next.add(sup.id);
                        return next;
                      })
                    }
                    onSelect={setSelected}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="tcard-head">
              <div>
                <h2>Metas vs realizado por promotor</h2>
                <p className="csub">Ordenável · clique numa linha para ver o detalhe do promotor</p>
              </div>
            </div>
            {loading ? (
              <p className="loadmsg">
                <span className="spinner" />Carregando…
              </p>
            ) : (
              <RankingTable rows={rows} onSelect={setSelected} />
            )}
          </div>
        )}
      </main>

      {selectedRow ? (
        <PromoterDetail row={selectedRow} monthly={selectedMonthly} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

// CSS aditivo (charts, meta bar, supervisor expansível, drawer). Escopo .rrteam;
// reusa os tokens existentes — nada de design novo, só composição.
const EXTRA_CSS = `
.rrteam .card{padding-bottom:6px;}
.rrteam .metacard .metabody{padding:18px 24px 22px;}
.rrteam .mb-track{position:relative;height:14px;border-radius:999px;background:#EEF0F4;border:1px solid var(--bd);overflow:visible;}
.rrteam .mb-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--navy),var(--navy-bar));transition:width .3s;}
.rrteam .mb-proj{position:absolute;top:-5px;bottom:-5px;width:0;}
.rrteam .mb-proj-dot{position:absolute;top:0;bottom:0;left:-1px;width:2.5px;background:var(--gold);box-shadow:0 0 0 2px rgba(214,161,63,.22);border-radius:2px;}
.rrteam .mb-cap{font-size:13px;color:var(--ink-2);margin:14px 0 0;line-height:1.5;}
.rrteam .mb-cap b{color:var(--ink);font-weight:600;}
.rrteam .metatag{display:inline-block;margin-left:7px;font-size:10px;font-weight:600;color:var(--gold-deep);background:rgba(214,161,63,.14);border:1px solid rgba(214,161,63,.34);padding:1px 7px;border-radius:999px;vertical-align:middle;}
.rrteam .chartwrap,.rrteam .suplist{padding:14px 20px 20px;}
.rrteam .loadmsg{display:flex;align-items:center;gap:9px;justify-content:center;color:var(--ink-3);font-size:13px;padding:22px 0;}
.rrteam .lc svg{width:100%;height:auto;display:block;}
.rrteam .lc-x{display:flex;justify-content:space-between;margin-top:4px;padding:0 2px;}
.rrteam .lc-x span{font-size:10px;color:var(--ink-3);font-variant-numeric:tabular-nums;}
.rrteam .lc-x span.on{color:var(--navy);font-weight:700;}
.rrteam .lc-cap{font-size:11.5px;color:var(--ink-3);margin-top:8px;}
.rrteam .lc-cap b{color:var(--ink);font-weight:600;}
.rrteam th.sortable{cursor:pointer;user-select:none;white-space:nowrap;}
.rrteam th.sortable.on{color:var(--navy);}
.rrteam th.sortable .arr{font-size:9px;margin-left:3px;}
.rrteam tr.clickrow{cursor:pointer;}
.rrteam tr.clickrow:hover td{background:rgba(15,31,74,.035);}
.rrteam .suprow{border:1px solid var(--bd);border-radius:var(--r-md);margin-bottom:10px;overflow:hidden;background:#fff;}
.rrteam .suprow.open{box-shadow:var(--shadow);}
.rrteam .sup-head{display:flex;align-items:center;gap:12px;width:100%;background:none;border:none;padding:14px 16px;cursor:pointer;font-family:inherit;text-align:left;}
.rrteam .sup-head:hover{background:rgba(15,31,74,.02);}
.rrteam .sup-chev{color:var(--ink-3);font-size:11px;width:12px;}
.rrteam .sup-nm{font-weight:600;color:var(--ink);font-size:13.5px;}
.rrteam .sup-meta{font-size:11.5px;color:var(--ink-3);}
.rrteam .sup-prod{margin-left:auto;font-weight:600;color:var(--ink);font-size:13.5px;}
.rrteam .sup-body{border-top:1px solid var(--bd-soft);padding:6px 6px 10px;}
.rrteam .chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap;}
.rrteam .chip .d{width:6px;height:6px;border-radius:50%;}
.rrteam .chip.g{background:#E7F6EE;color:var(--green-tx);}.rrteam .chip.g .d{background:var(--green);}
.rrteam .chip.a{background:#FCF3E2;color:var(--amber-tx);}.rrteam .chip.a .d{background:var(--amber);}
.rrteam .chip.r{background:#FBEBEB;color:var(--red-tx);}.rrteam .chip.r .d{background:var(--red);}
.rrteam .chip.n{background:#EEF0F4;color:var(--ink-3);}.rrteam .chip.n .d{background:var(--ink-3);}
.rrteam .spinner{width:15px;height:15px;border:2px solid var(--bd);border-top-color:var(--navy);border-radius:50%;animation:rrspin .7s linear infinite;display:inline-block;}
@keyframes rrspin{to{transform:rotate(360deg);}}
.rrteam .drawer{position:fixed;inset:0;background:rgba(15,31,74,.32);display:flex;justify-content:flex-end;z-index:60;}
.rrteam .dw-panel{width:min(560px,94vw);height:100%;background:var(--page);box-shadow:-8px 0 30px rgba(15,31,74,.18);display:flex;flex-direction:column;animation:rrslide .2s ease;}
@keyframes rrslide{from{transform:translateX(24px);opacity:.6;}to{transform:translateX(0);opacity:1;}}
.rrteam .dw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 22px;background:var(--navy);color:#fff;}
.rrteam .dw-head h3{margin:0;font-size:16px;font-weight:600;}
.rrteam .dw-sub{margin:5px 0 0;font-size:11.5px;color:#B7C0D8;line-height:1.4;}
.rrteam .dw-x{background:rgba(255,255,255,.1);border:none;color:#fff;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px;}
.rrteam .dw-x:hover{background:rgba(255,255,255,.2);}
.rrteam .dw-body{padding:18px 20px 40px;overflow-y:auto;display:flex;flex-direction:column;gap:20px;}
.rrteam .dw-block{background:#fff;border:1px solid var(--bd);border-radius:var(--r-md);padding:16px 18px;}
.rrteam .dw-block h4{margin:0 0 12px;font-size:12.5px;font-weight:600;color:var(--ink-2);}
`;
