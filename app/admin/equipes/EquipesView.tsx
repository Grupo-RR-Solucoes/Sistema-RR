"use client";

import { useEffect, useMemo, useState } from "react";

import { UiStyles, HeaderNavy, KpiBand, Table } from "@/components/ui";
import type { UserRole } from "@/lib/auth/types";
import type { EquipesModel } from "@/lib/equipes/model";
import type { GestorMetaEditorRow } from "@/lib/equipe/gestorMeta";

import { RRADMIN_CSS, initials } from "../usuarios/usuariosStyles";
import { IcoAlertTri, IcoInfo, IcoUsers } from "../usuarios/icons";
import { RREQUIPES_CSS } from "./equipesStyles";

interface Props {
  initialModel: EquipesModel | null;
  loadError: string | null;
  currentUserRole: UserRole;
  currentUserEmail: string;
}

const EMPTY_MODEL: EquipesModel = {
  gerentes: [],
  supervisores: [],
  promotores: [],
  supervisorOptions: [],
  gerenteOptions: [],
  tree: { gerentes: [], supervisoresSemGerente: [], promotoresSemSupervisor: [] },
};

function gestorName(full_name: string | null, email: string): string {
  return (full_name && full_name.trim()) || email;
}

// Rótulo do gestor nos selects/árvore: sócio ganha sufixo "(sócio)" para
// distinguir de supervisores/gerentes de verdade (sócio-como-gestor).
function gestorLabel(g: { full_name: string | null; email: string; role: string }): string {
  const base = gestorName(g.full_name, g.email);
  return g.role === "socio" ? `${base} (sócio)` : base;
}

export default function EquipesView({
  initialModel,
  loadError,
  currentUserRole,
  currentUserEmail,
}: Props) {
  const [model, setModel] = useState<EquipesModel>(initialModel ?? EMPTY_MODEL);
  const [error, setError] = useState<string | null>(loadError);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function refetch() {
    const res = await fetch("/api/admin/equipes", { cache: "no-store" });
    if (!res.ok) {
      setError((await res.json()).error ?? "Falha ao recarregar equipes");
      return;
    }
    setModel((await res.json()) as EquipesModel);
  }

  async function patchLink(
    entity: "promoter" | "supervisor",
    id: string,
    value: string | null
  ) {
    const key = `${entity}:${id}`;
    setBusyKey(key);
    setError(null);
    try {
      const payload =
        entity === "promoter"
          ? { entity, id, supervisor_user_id: value }
          : { entity, id, manager_user_id: value };
      const res = await fetch("/api/admin/equipes", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Falha ao gravar vínculo");
        return;
      }
      await refetch();
      showToast(value ? "Vínculo atualizado" : "Vínculo removido");
    } finally {
      setBusyKey(null);
    }
  }

  const kpi = useMemo(() => {
    const vinculados = model.promotores.filter((p) => p.supervisor_user_id).length;
    return {
      gerentes: model.gerentes.length,
      supervisores: model.supervisores.length,
      promotores: model.promotores.length,
      vinculados,
      semSupervisor: model.promotores.length - vinculados,
    };
  }, [model]);

  return (
    <div className="rradmin">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: RRADMIN_CSS + RREQUIPES_CSS }} />
      <div className="wrap">
        <nav className="crumb">
          <a href="/dashboard">Dashboard</a>
          <span className="sep">/</span>
          <span>Admin</span>
          <span className="sep">/</span>
          <span className="cur">Equipes</span>
        </nav>

        <HeaderNavy
          brand="GRUPO RR CRED"
          title="Equipes"
          subtitle="Hierarquia de gestão · gerente · supervisor · promotor"
          actions={
            <div className="role">
              <span className="d prom" />
              {currentUserEmail} · {currentUserRole === "socio" ? "Sócio" : "Auxiliar Financeiro"}
            </div>
          }
        >
          <KpiBand
            valueSize={28}
            items={[
              { label: "Gerentes regionais", value: kpi.gerentes, sub: "raiz da árvore", accent: true },
              { label: "Supervisores", value: kpi.supervisores, sub: "nível intermediário" },
              { label: "Promotores vinculados", value: kpi.vinculados, sub: `${kpi.promotores} no total` },
              { label: "Sem supervisor", value: kpi.semSupervisor, sub: "aguardando vínculo" },
            ]}
          />
        </HeaderNavy>

        {error ? (
          <div className="errbar" role="alert">
            <span className="bic"><IcoAlertTri /></span>
            <div>{error}</div>
          </div>
        ) : null}

        {/* ---- VÍNCULO 1: promotor -> supervisor ---- */}
        <div className="tcard lnkcard">
          <div className="tcard-head">
            <div>
              <h2>Vincular promotor → supervisor</h2>
              <p className="csub">Escolha o supervisor responsável por cada promotor.</p>
            </div>
          </div>
          <Table scrollable minWidth={620}>
            <thead>
              <tr>
                <th className="rr-sticky-col">Promotor</th>
                <th>Supervisor responsável</th>
              </tr>
            </thead>
            <tbody>
              {model.promotores.length === 0 ? (
                <tr><td colSpan={2} className="emptyrow">Nenhum promotor operacional cadastrado.</td></tr>
              ) : (
                model.promotores.map((p) => {
                  const key = `promoter:${p.id}`;
                  return (
                    <tr key={p.id}>
                      <td className="rr-sticky-col">
                        <div className="nm">
                          <span className="av">{initials(p.name)}</span>
                          {p.name}
                        </div>
                      </td>
                      <td>
                        <select
                          className={`linksel${p.supervisor_user_id ? "" : " unset"}`}
                          value={p.supervisor_user_id ?? ""}
                          disabled={busyKey === key}
                          onChange={(e) => patchLink("promoter", p.id, e.target.value || null)}
                          aria-label={`Supervisor de ${p.name}`}
                        >
                          <option value="">— Sem supervisor —</option>
                          {model.supervisorOptions.map((s) => (
                            <option key={s.id} value={s.id}>{gestorLabel(s)}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </div>

        {/* ---- VÍNCULO 2: supervisor -> gerente ---- */}
        <div className="tcard lnkcard">
          <div className="tcard-head">
            <div>
              <h2>Vincular supervisor → gerente regional</h2>
              <p className="csub">Escolha o gerente regional de cada supervisor.</p>
            </div>
          </div>
          <Table scrollable minWidth={620}>
            <thead>
              <tr>
                <th className="rr-sticky-col">Supervisor</th>
                <th>Gerente regional</th>
              </tr>
            </thead>
            <tbody>
              {model.supervisores.length === 0 ? (
                <tr><td colSpan={2} className="emptyrow">Nenhum supervisor cadastrado.</td></tr>
              ) : (
                model.supervisores.map((s) => {
                  const key = `supervisor:${s.id}`;
                  return (
                    <tr key={s.id}>
                      <td className="rr-sticky-col">
                        <div className="nm">
                          <span className="av">{initials(s.full_name, s.email)}</span>
                          {gestorName(s.full_name, s.email)}
                        </div>
                      </td>
                      <td>
                        <select
                          className={`linksel${s.manager_user_id ? "" : " unset"}`}
                          value={s.manager_user_id ?? ""}
                          disabled={busyKey === key || model.gerenteOptions.length === 0}
                          onChange={(e) => patchLink("supervisor", s.id, e.target.value || null)}
                          aria-label={`Gerente de ${gestorName(s.full_name, s.email)}`}
                        >
                          <option value="">— Sem gerente —</option>
                          {model.gerenteOptions.map((g) => (
                            <option key={g.id} value={g.id}>{gestorLabel(g)}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </div>

        {/* ---- ÁRVORE ---- */}
        <div className="tcard">
          <div className="tcard-head">
            <div>
              <h2>Árvore de equipes</h2>
              <p className="csub">Gerente regional → supervisores → promotores</p>
            </div>
            <div className="leg">
              <span className="lg"><span className="sw" style={{ background: "var(--navy)" }} />Gerente</span>
              <span className="lg"><span className="sw" style={{ background: "var(--gold)" }} />Supervisor</span>
              <span className="lg"><span className="sw" style={{ background: "var(--green)" }} />Promotor</span>
            </div>
          </div>
          <div className="tree">
            {model.tree.gerentes.length === 0 &&
            model.tree.supervisoresSemGerente.length === 0 &&
            model.tree.promotoresSemSupervisor.length === 0 ? (
              <div className="tempty">Nenhuma equipe montada ainda. Use os vínculos acima.</div>
            ) : null}

            {model.tree.gerentes.map((g) => {
              const promCount = g.supervisores.reduce((n, s) => n + s.promoters.length, 0);
              return (
                <div key={g.id} className="tnode ger">
                  <div className="tnode-head">
                    <span className="tav">{initials(g.full_name, g.email)}</span>
                    <span className="tinfo">
                      <span className="tnm">{gestorLabel(g)}</span>
                      <span className="tem">{g.email}</span>
                    </span>
                    <span className="tcount">{g.supervisores.length} sup · {promCount} prom</span>
                  </div>
                  <div className="tbranch">
                    {g.supervisores.length === 0 ? (
                      <div className="tempty">Sem supervisores vinculados.</div>
                    ) : (
                      g.supervisores.map((s) => <SupervisorBlock key={s.id} s={s} />)
                    )}
                  </div>
                </div>
              );
            })}

            {model.tree.supervisoresSemGerente.length > 0 ? (
              <div className="tnode torphan">
                <div className="tnode-head">
                  <span className="tav"><IcoUsers /></span>
                  <span className="tinfo">
                    <span className="tnm">Supervisores sem gerente</span>
                    <span className="tem">ainda não vinculados a um gerente regional</span>
                  </span>
                  <span className="tcount">{model.tree.supervisoresSemGerente.length}</span>
                </div>
                <div className="tbranch">
                  {model.tree.supervisoresSemGerente.map((s) => <SupervisorBlock key={s.id} s={s} />)}
                </div>
              </div>
            ) : null}

            {model.tree.promotoresSemSupervisor.length > 0 ? (
              <div className="tnode torphan">
                <div className="tnode-head">
                  <span className="tav"><IcoUsers /></span>
                  <span className="tinfo">
                    <span className="tnm">Promotores sem supervisor</span>
                    <span className="tem">ainda não vinculados a um supervisor</span>
                  </span>
                  <span className="tcount">{model.tree.promotoresSemSupervisor.length}</span>
                </div>
                <div className="tproms">
                  {model.tree.promotoresSemSupervisor.map((p) => (
                    <span key={p.id} className="tprom"><span className="pd" style={{ background: "var(--ink-3)" }} />{p.name}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* ---- META DO GESTOR (Entrega 2) — edição socio-only ---- */}
        {currentUserRole === "socio" ? <GestorMetaEditor /> : null}
      </div>

      <div className={`toast${toast ? " show" : ""}`}>
        <span className="ck-i"><IcoInfo /></span>
        <span>{toast}</span>
      </div>
    </div>
  );
}

// ---------- Editor de META DO GESTOR (socio-only; grava via /api/equipe/meta) ----------
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function brlMeta(n: number) {
  return "R$ " + new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n || 0);
}
function ROLE_PT(role: string) {
  return role === "gerente_regional" ? "Gerente Regional" : "Supervisor";
}

function GestorMetaEditor() {
  const [comp, setComp] = useState<{ year: number; month: number } | null>(null);
  const [rows, setRows] = useState<GestorMetaEditorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  // competência atual só no cliente (evita mismatch de SSR com Date).
  useEffect(() => {
    const d = new Date();
    setComp({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }, []);

  const options = useMemo(() => {
    if (!comp) return [];
    const out: Array<{ year: number; month: number }> = [];
    let y = 2026;
    let m = 1;
    for (let g = 0; g < 240; g++) {
      out.push({ year: y, month: m });
      if (y === comp.year && m === comp.month) break;
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return out.reverse();
  }, [comp]);

  function load(c: { year: number; month: number }) {
    setLoading(true);
    setError("");
    fetch(`/api/equipe/meta?year=${c.year}&month=${c.month}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j?.error || "Falha ao carregar metas.")))))
      .then((j: { gestores: GestorMetaEditorRow[] }) => {
        setRows(j.gestores ?? []);
        setDrafts({});
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Falha ao carregar."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (comp) load(comp);
  }, [comp]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }

  async function save(userId: string, meta: string | null) {
    if (!comp) return;
    setBusy(userId);
    setError("");
    try {
      const res = await fetch("/api/equipe/meta", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId, year: comp.year, month: comp.month, meta }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Falha ao gravar a meta.");
      }
      load(comp);
      showToast(meta === null ? "Override removido" : "Meta ajustada");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao gravar.");
    } finally {
      setBusy(null);
    }
  }

  const compLabel = (c: { year: number; month: number }) => `${MESES[c.month - 1]}/${String(c.year).slice(-2)}`;

  return (
    <div className="tcard lnkcard">
      <div className="tcard-head">
        <div>
          <h2>Meta do gestor</h2>
          <p className="csub">
            Padrão = soma das metas dos promotores do time (derivada). Ajuste um override por gestor/competência; limpar volta à derivada.
          </p>
        </div>
        <div className="comp comp--light" style={{ position: "relative" }}>
          <select
            aria-label="Competência da meta do gestor"
            value={comp ? `${comp.year}-${comp.month}` : ""}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              setComp({ year: y, month: m });
            }}
          >
            {options.map((o) => (
              <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                {compLabel(o)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="errbar" role="alert" style={{ margin: "0 16px 12px" }}>
          <span className="bic"><IcoAlertTri /></span>
          <div>{error}</div>
        </div>
      ) : null}

      <Table scrollable minWidth={720}>
        <thead>
          <tr>
            <th className="rr-sticky-col">Gestor</th>
            <th>Papel</th>
            <th className="r">Meta derivada</th>
            <th className="r">Meta efetiva</th>
            <th>Override (R$)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={6} className="emptyrow">Carregando…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={6} className="emptyrow">Nenhum gestor cadastrado.</td></tr>
          ) : (
            rows.map((g) => {
              const efetiva = g.meta_override ?? g.meta_derivada;
              const draft = drafts[g.user_id] ?? (g.meta_override != null ? String(g.meta_override) : "");
              return (
                <tr key={g.user_id}>
                  <td className="rr-sticky-col"><div className="nm"><span className="av">{initials(g.name)}</span>{g.name}</div></td>
                  <td>{ROLE_PT(g.role)}</td>
                  <td className="r">{brlMeta(g.meta_derivada)}</td>
                  <td className="r">
                    {brlMeta(efetiva)}
                    {g.meta_override != null ? <span className="metatag">ajustada</span> : null}
                  </td>
                  <td>
                    <input
                      className="metainput"
                      inputMode="numeric"
                      placeholder={brlMeta(g.meta_derivada)}
                      value={draft}
                      disabled={busy === g.user_id}
                      onChange={(e) => setDrafts((d) => ({ ...d, [g.user_id]: e.target.value.replace(/[^\d]/g, "") }))}
                    />
                  </td>
                  <td>
                    <div className="metaacts">
                      <button
                        className="mbtn save"
                        disabled={busy === g.user_id || draft === ""}
                        onClick={() => save(g.user_id, draft)}
                      >
                        Salvar
                      </button>
                      <button
                        className="mbtn clear"
                        disabled={busy === g.user_id || g.meta_override == null}
                        onClick={() => save(g.user_id, null)}
                      >
                        Limpar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </Table>

      <div className={`toast${toast ? " show" : ""}`}>
        <span className="ck-i"><IcoInfo /></span>
        <span>{toast}</span>
      </div>

      <style dangerouslySetInnerHTML={{ __html: METAEDITOR_CSS }} />
    </div>
  );
}

const METAEDITOR_CSS = `
.rradmin .metatag{margin-left:8px;font-size:10px;font-weight:600;color:var(--gold-deep,#B9842A);background:rgba(214,161,63,.14);border:1px solid rgba(214,161,63,.34);padding:1px 6px;border-radius:999px;vertical-align:middle;}
.rradmin .metainput{width:130px;border:1px solid var(--bd,#E4E7EC);border-radius:8px;padding:6px 10px;font-family:inherit;font-size:12.5px;font-variant-numeric:tabular-nums;}
.rradmin .metainput:focus{outline:none;border-color:var(--gold,#D6A13F);}
.rradmin .metaacts{display:flex;gap:6px;}
.rradmin .mbtn{appearance:none;border-radius:8px;padding:6px 12px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--bd,#E4E7EC);background:#fff;}
.rradmin .mbtn.save{background:var(--navy,#0F1F4A);color:#fff;border-color:var(--navy,#0F1F4A);}
.rradmin .mbtn.save:hover{background:#16285C;}
.rradmin .mbtn.clear:hover{border-color:var(--red,#DC2626);color:var(--red,#DC2626);}
.rradmin .mbtn[disabled]{opacity:.45;cursor:default;}
`;

function SupervisorBlock({ s }: { s: EquipesModel["tree"]["gerentes"][number]["supervisores"][number] }) {
  return (
    <div className="tsup">
      <div className="tsup-head">
        <span className="sdot" />
        <span className="snm">{gestorLabel(s)}</span>
        <span className="sem"> · {s.email}</span>
        <span className="scount">{s.promoters.length} promotor{s.promoters.length === 1 ? "" : "es"}</span>
      </div>
      {s.promoters.length === 0 ? (
        <div className="tempty">Sem promotores vinculados.</div>
      ) : (
        <div className="tproms">
          {s.promoters.map((p) => (
            <span key={p.id} className="tprom"><span className="pd" />{p.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}
