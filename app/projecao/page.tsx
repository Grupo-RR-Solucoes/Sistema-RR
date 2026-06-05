"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useUser } from "../../lib/auth/useUser";
import FeedbackBanner from "../../components/FeedbackBanner";

// Paleta: navy / yellow / golden + semaforo.
const NAVY = "#0F1F4A";
const YELLOW = "#fff000";
const GOLDEN = "#d6a13f";
const SEMA = {
  verde: { bg: "#16a34a", soft: "#dcfce7", ink: "#065f46", label: "No alvo" },
  amarelo: { bg: "#f59e0b", soft: "#fef3c7", ink: "#92400e", label: "Atencao" },
  vermelho: { bg: "#dc2626", soft: "#fee2e2", ink: "#991b1b", label: "Risco" },
  sem_meta: { bg: "#9ca3af", soft: "#f3f4f6", ink: "#4b5563", label: "Sem meta" },
} as const;

type Semaforo = keyof typeof SEMA;

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
  tendencia: "crescimento" | "queda" | "estavel" | "sem_historico";
  tendencia_percent: number | null;
  semaforo: Semaforo;
};
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
};

const brl = (n: number) =>
  "R$ " + new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const pctTxt = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);
const mes = (y: number, m: number) =>
  `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][m - 1]}/${String(y).slice(-2)}`;

function tendBadge(p: Promotor) {
  if (p.tendencia === "sem_historico") return <span style={{ color: "#9ca3af" }}>s/ histórico</span>;
  const up = p.tendencia === "crescimento";
  const flat = p.tendencia === "estavel";
  const color = flat ? "#6b7280" : up ? "#16a34a" : "#dc2626";
  const arrow = flat ? "→" : up ? "▲" : "▼";
  return (
    <span style={{ color, fontWeight: 800 }}>
      {arrow} {p.tendencia_percent === null ? "" : `${Math.abs(Math.round(p.tendencia_percent * 100))}%`}
    </span>
  );
}

function SemaBadge({ s, big }: { s: Semaforo; big?: boolean }) {
  const c = SEMA[s];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: c.bg,
        color: "#fff",
        fontWeight: 800,
        borderRadius: 999,
        padding: big ? "8px 18px" : "3px 10px",
        fontSize: big ? 16 : 12,
        letterSpacing: 0.3,
      }}
    >
      <span style={{ width: big ? 12 : 8, height: big ? 12 : 8, borderRadius: 999, background: "#fff" }} />
      {c.label}
    </span>
  );
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

  return (
    <section style={styles.page}>
      <header style={styles.hero}>
        <div>
          <div style={styles.kicker}>Metas & Projeção</div>
          <h2 style={styles.title}>
            {isPromotor ? "Minha projeção do mês" : "Projeção da equipe"}
          </h2>
          <p style={styles.subtitle}>
            Ritmo de produção projetado para o fim do período vs. a meta da competência.
          </p>
        </div>
        <div style={styles.filters}>
          <label style={styles.filterLabel}>
            Competência
            <select
              value={`${year}-${month}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split("-").map(Number);
                setYear(y);
                setMonth(m);
              }}
              style={styles.select}
            >
              {periodOptions.map((p) => (
                <option key={p.key} value={`${p.y}-${p.m}`}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {!isPromotor && data?.companies ? (
            <label style={styles.filterLabel}>
              Empresa
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={styles.select}>
                <option value="">Todas</option>
                {data.companies.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </header>

      {error ? (
        <FeedbackBanner variant="error" eyebrow="Erro" title="Não foi possível carregar a projeção." description={error} />
      ) : null}

      {data?.janela ? (
        <div style={styles.windowNote}>
          Janela {data.janela.inicio} → {data.janela.fim} · dias úteis {data.janela.dias_uteis_decorridos}/
          {data.janela.dias_uteis_totais}
          {data.fechado ? " · competência fechada (produção final)" : " · competência aberta (ritmo linear)"}
        </div>
      ) : null}

      {loading ? (
        <div style={styles.loading}>Carregando projeção…</div>
      ) : isPromotor ? (
        <PromotorView data={data} />
      ) : (
        <EquipeView data={data} />
      )}
    </section>
  );
}

// ============================================================
// TELA EQUIPE (socio/funcionario)
// ============================================================
function EquipeView({ data }: { data: any }) {
  if (!data || data.scope !== "equipe") return null;
  const cons = data.consolidado;
  const grupos: Grupo[] = data.grupos || [];
  const risco: Promotor[] = data.risco || [];

  return (
    <>
      {/* CONSOLIDADO DO GRUPO */}
      <div style={styles.cardsRow}>
        <ConsCard label="Produção acumulada" value={brl(cons.producao_acumulada)} />
        <ConsCard label="Projeção do grupo" value={brl(cons.projecao)} accent />
        <ConsCard label="Meta do grupo" value={brl(cons.meta)} />
        <ConsCard
          label="% projetado do grupo"
          value={pctTxt(cons.percent_projetado)}
          semaforo={cons.semaforo}
        />
      </div>

      {/* PUXANDO O GRUPO PRA BAIXO */}
      <article style={styles.riskCard}>
        <div style={styles.sectionKicker}>Puxando o grupo pra baixo</div>
        <h3 style={styles.sectionTitle}>Promotores em risco (projeção &lt; 80% da meta)</h3>
        {risco.length === 0 ? (
          <p style={{ color: "#16a34a", fontWeight: 700, margin: "8px 0 0" }}>
            Nenhum promotor em risco nesta competência. 🎯
          </p>
        ) : (
          <div style={styles.riskList}>
            {risco.map((p, i) => (
              <div key={p.promoter_id} style={styles.riskRow}>
                <span style={styles.riskRank}>{i + 1}</span>
                <span style={{ flex: 1, fontWeight: 700, color: NAVY }}>{p.promoter_name}</span>
                <span style={{ color: "#6b7280", fontSize: 13 }}>{p.company_name}</span>
                <span style={{ width: 130, textAlign: "right", color: "#6b7280", fontSize: 13 }}>
                  proj {brl(p.projecao)}
                </span>
                <span style={{ width: 90, textAlign: "right", fontWeight: 800, color: SEMA.vermelho.bg }}>
                  {pctTxt(p.percent_projetado)}
                </span>
              </div>
            ))}
          </div>
        )}
      </article>

      {/* TABELA POR CNPJ */}
      {grupos.map((g) => (
        <article key={g.company_id || g.company_cnpj} style={styles.groupCard}>
          <div style={styles.groupHead}>
            <div>
              <div style={styles.groupName}>{g.company_name}</div>
              <div style={styles.groupCnpj}>{g.company_cnpj}</div>
            </div>
            <div style={styles.groupTotals}>
              <span style={{ color: "#6b7280", fontSize: 13 }}>
                proj {brl(g.projecao)} / meta {brl(g.meta)}
              </span>
              <strong style={{ fontSize: 20, color: NAVY }}>{pctTxt(g.percent_projetado)}</strong>
              <SemaBadge s={g.semaforo} />
            </div>
          </div>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Promotor</th>
                  <th style={styles.thR}>Acumulado</th>
                  <th style={styles.thR}>Projeção</th>
                  <th style={styles.thR}>Meta</th>
                  <th style={styles.thR}>% projetado</th>
                  <th style={styles.thC}>Tendência</th>
                  <th style={styles.thC}>Semáforo</th>
                </tr>
              </thead>
              <tbody>
                {g.promotores.map((p) => (
                  <tr key={p.promoter_id} style={{ background: SEMA[p.semaforo].soft }}>
                    <td style={styles.td}>{p.promoter_name}</td>
                    <td style={styles.tdR}>{brl(p.producao_acumulada)}</td>
                    <td style={styles.tdR}>{brl(p.projecao)}</td>
                    <td style={styles.tdR}>{p.meta > 0 ? brl(p.meta) : "—"}</td>
                    <td style={{ ...styles.tdR, fontWeight: 800, color: SEMA[p.semaforo].ink }}>
                      {pctTxt(p.percent_projetado)}
                    </td>
                    <td style={styles.tdC}>{tendBadge(p)}</td>
                    <td style={styles.tdC}>
                      <SemaBadge s={p.semaforo} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </>
  );
}

function ConsCard({
  label,
  value,
  accent,
  semaforo,
}: {
  label: string;
  value: string;
  accent?: boolean;
  semaforo?: Semaforo;
}) {
  const sema = semaforo ? SEMA[semaforo] : null;
  return (
    <article
      style={{
        ...styles.consCard,
        ...(accent ? { borderColor: GOLDEN, boxShadow: `0 0 0 2px ${GOLDEN}33` } : {}),
        ...(sema ? { background: sema.soft, borderColor: sema.bg } : {}),
      }}
    >
      <div style={styles.consLabel}>{label}</div>
      <div style={{ ...styles.consValue, ...(sema ? { color: sema.ink } : {}) }}>{value}</div>
      {sema ? (
        <div style={{ marginTop: 8 }}>
          <SemaBadge s={semaforo as Semaforo} />
        </div>
      ) : null}
    </article>
  );
}

// ============================================================
// TELA PROMOTOR (perfil) — so a propria projecao
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
  const sema = SEMA[p.semaforo];
  const fill = p.meta > 0 ? Math.min(100, Math.round((p.projecao / p.meta) * 100)) : 0;
  const historico: Array<{ key: string; production: number }> = data.historico || [];
  const maxHist = Math.max(p.projecao, ...historico.map((h) => h.production), 1);

  return (
    <>
      <article style={{ ...styles.promoHero, borderColor: sema.bg }}>
        <div style={styles.promoHeroTop}>
          <div>
            <div style={styles.promoName}>{p.promoter_name}</div>
            <div style={styles.promoCompany}>{p.company_name}</div>
          </div>
          <SemaBadge s={p.semaforo} big />
        </div>

        <div style={styles.promoBig}>
          <div>
            <div style={styles.promoBigLabel}>% projetado da meta</div>
            <div style={{ ...styles.promoBigValue, color: sema.bg }}>{pctTxt(p.percent_projetado)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={styles.promoBigLabel}>Tendência vs. média 3 meses</div>
            <div style={{ fontSize: 22 }}>{tendBadge(p)}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>média {brl(p.media_3m)}</div>
          </div>
        </div>

        {/* barra meta vs projecao */}
        <div style={styles.barTrack}>
          <div style={{ ...styles.barFill, width: `${fill}%`, background: sema.bg }} />
          <div style={styles.barMark}>meta</div>
        </div>
        <div style={styles.barLegend}>
          <span>Projeção {brl(p.projecao)}</span>
          <span>Meta {p.meta > 0 ? brl(p.meta) : "—"}</span>
        </div>
      </article>

      <div style={styles.cardsRow}>
        <ConsCard label="Produção acumulada" value={brl(p.producao_acumulada)} />
        <ConsCard label="Projeção do mês" value={brl(p.projecao)} accent />
        <ConsCard label="Sua meta" value={p.meta > 0 ? brl(p.meta) : "Sem meta"} />
        <ConsCard
          label="Dias úteis"
          value={`${p.dias_uteis_decorridos} / ${p.dias_uteis_totais}`}
        />
      </div>

      <article style={styles.groupCard}>
        <div style={styles.sectionKicker}>Comparativo</div>
        <h3 style={styles.sectionTitle}>Seus últimos meses vs. projeção atual</h3>
        <div style={styles.histRow}>
          {historico.map((h) => (
            <HistBar key={h.key} label={h.key} value={h.production} max={maxHist} color={GOLDEN} />
          ))}
          <HistBar label="projeção" value={p.projecao} max={maxHist} color={sema.bg} highlight />
        </div>
      </article>
    </>
  );
}

function HistBar({
  label,
  value,
  max,
  color,
  highlight,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  highlight?: boolean;
}) {
  const h = Math.max(4, Math.round((value / max) * 140));
  return (
    <div style={styles.histCol}>
      <div style={styles.histValue}>{brl(value)}</div>
      <div style={{ ...styles.histBar, height: h, background: color, opacity: highlight ? 1 : 0.65 }} />
      <div style={{ ...styles.histLabel, fontWeight: highlight ? 800 : 600 }}>{label}</div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { display: "grid", gap: 18 },
  hero: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 16,
    flexWrap: "wrap",
    background: `linear-gradient(135deg, ${NAVY} 0%, #07103080 100%), ${NAVY}`,
    borderRadius: 24,
    padding: "26px 28px",
    color: "#fff",
    borderTop: `4px solid ${YELLOW}`,
  },
  kicker: { fontSize: 12, textTransform: "uppercase", letterSpacing: "0.18em", color: YELLOW, fontWeight: 800 },
  title: { margin: "8px 0 0", fontSize: "clamp(1.6rem,3vw,2.4rem)", lineHeight: 1.1 },
  subtitle: { margin: "8px 0 0", color: "rgba(255,255,255,0.78)", fontSize: 14, maxWidth: 560 },
  filters: { display: "flex", gap: 12, flexWrap: "wrap" },
  filterLabel: { display: "grid", gap: 6, fontSize: 11, fontWeight: 800, color: YELLOW, textTransform: "uppercase", letterSpacing: "0.08em" },
  select: { borderRadius: 12, border: "1px solid rgba(255,255,255,0.25)", padding: "10px 12px", fontSize: 14, background: "#fff", color: NAVY, minWidth: 160 },
  windowNote: { fontSize: 13, color: "#4b5563", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 12, padding: "8px 14px" },
  loading: { padding: 40, textAlign: "center", color: "#6b7280" },

  cardsRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 },
  consCard: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 18, boxShadow: "0 1px 3px rgba(15,31,74,0.06)" },
  consLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: "#6b7280", fontWeight: 800 },
  consValue: { fontSize: 26, fontWeight: 800, color: NAVY, marginTop: 8 },

  riskCard: { background: "#fff", border: `1px solid ${SEMA.vermelho.bg}33`, borderLeft: `5px solid ${SEMA.vermelho.bg}`, borderRadius: 18, padding: 20 },
  riskList: { display: "grid", gap: 8, marginTop: 12 },
  riskRow: { display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: SEMA.vermelho.soft, borderRadius: 12 },
  riskRank: { width: 24, height: 24, borderRadius: 999, background: SEMA.vermelho.bg, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 13 },

  groupCard: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 20, boxShadow: "0 1px 3px rgba(15,31,74,0.06)" },
  groupHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", borderBottom: `2px solid ${YELLOW}`, paddingBottom: 12, marginBottom: 12 },
  groupName: { fontSize: 18, fontWeight: 800, color: NAVY },
  groupCnpj: { fontSize: 12, color: "#9ca3af" },
  groupTotals: { display: "flex", alignItems: "center", gap: 14 },

  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "8px 10px", color: "#fff", background: NAVY, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", position: "sticky", top: 0 },
  thR: { textAlign: "right", padding: "8px 10px", color: "#fff", background: NAVY, fontSize: 11, textTransform: "uppercase" },
  thC: { textAlign: "center", padding: "8px 10px", color: "#fff", background: NAVY, fontSize: 11, textTransform: "uppercase" },
  td: { padding: "8px 10px", color: NAVY, fontWeight: 600, borderBottom: "1px solid #eef2f7" },
  tdR: { padding: "8px 10px", textAlign: "right", color: "#374151", borderBottom: "1px solid #eef2f7" },
  tdC: { padding: "8px 10px", textAlign: "center", borderBottom: "1px solid #eef2f7" },

  sectionKicker: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: GOLDEN, fontWeight: 800 },
  sectionTitle: { margin: "6px 0 0", fontSize: 18, color: NAVY },

  promoHero: { background: "#fff", border: "2px solid", borderRadius: 24, padding: 26, boxShadow: "0 4px 18px rgba(15,31,74,0.08)" },
  promoHeroTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  promoName: { fontSize: 24, fontWeight: 800, color: NAVY },
  promoCompany: { fontSize: 14, color: "#6b7280" },
  promoBig: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, margin: "22px 0 14px", flexWrap: "wrap" },
  promoBigLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280", fontWeight: 800 },
  promoBigValue: { fontSize: 56, fontWeight: 900, lineHeight: 1 },
  barTrack: { position: "relative", height: 26, background: "#eef2f7", borderRadius: 999, overflow: "hidden", border: "1px solid #e5e7eb" },
  barFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 999 },
  barMark: { position: "absolute", right: 10, top: 4, fontSize: 11, fontWeight: 800, color: "#6b7280" },
  barLegend: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#374151", marginTop: 8, fontWeight: 700 },

  histRow: { display: "flex", alignItems: "flex-end", gap: 18, marginTop: 18, minHeight: 190, paddingBottom: 4 },
  histCol: { display: "grid", justifyItems: "center", gap: 6, flex: 1 },
  histValue: { fontSize: 12, color: "#374151", fontWeight: 700 },
  histBar: { width: "70%", maxWidth: 90, borderRadius: "8px 8px 0 0" },
  histLabel: { fontSize: 12, color: NAVY },
};
