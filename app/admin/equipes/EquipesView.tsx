"use client";

import { useMemo, useState } from "react";

import { UiStyles, HeaderNavy, KpiBand, Table } from "@/components/ui";
import type { UserRole } from "@/lib/auth/types";
import type { EquipesModel } from "@/lib/equipes/model";

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
      </div>

      <div className={`toast${toast ? " show" : ""}`}>
        <span className="ck-i"><IcoInfo /></span>
        <span>{toast}</span>
      </div>
    </div>
  );
}

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
