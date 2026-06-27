"use client";

import { useMemo, useState } from "react";

import { canManageUserRole } from "@/lib/auth/permissions";
import { UiStyles, HeaderNavy, KpiBand } from "@/components/ui";

import CreateUsuarioModal from "./CreateUsuarioModal";
import EditUsuarioModal from "./EditUsuarioModal";
import ResetPasswordModal from "./ResetPasswordModal";
import {
  RRADMIN_CSS,
  initials,
  roleClass,
  roleLabel,
} from "./usuariosStyles";
import {
  IcoSearch, IcoPlus, IcoPencil, IcoKey, IcoTrash, IcoBan, IcoUndo, IcoX,
  IcoAlertTri, IcoInfo,
} from "./icons";

export interface UsuarioRow {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string | null;
  role: "socio" | "funcionario" | "promotor";
  cnpj_id: string | null;
  promoter_id: string | null;
  cpf: string | null;
  active: boolean;
  created_at: string;
  created_by: string | null;
}

interface Props {
  initialUsers: UsuarioRow[];
  loadError: string | null;
  currentUserId: string;
  currentUserRole: UsuarioRow["role"];
  currentUserEmail: string;
  // Parte C — true apenas para a conta do administrador principal
  // (SUPER_ADMIN_EMAIL). Computado no server; aqui é só gating de UI. A
  // trava real do delete físico é validada no backend (DELETE 403).
  isSuperAdmin: boolean;
}

type RoleFilter = "todos" | "socio" | "funcionario" | "promotor";
type StatusFilter = "ativos" | "inativos" | "todos";

export default function UsuariosList({
  initialUsers,
  loadError,
  currentUserId,
  currentUserRole,
  currentUserEmail,
  isSuperAdmin,
}: Props) {
  const [users, setUsers] = useState<UsuarioRow[]>(initialUsers);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<UsuarioRow | null>(null);
  const [resetTarget, setResetTarget] = useState<UsuarioRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UsuarioRow | null>(null);
  const [error, setError] = useState<string | null>(loadError);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState("");

  // Parte B — filtros client-side.
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("todos");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ativos");

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2400);
  }

  async function refetch() {
    const res = await fetch("/api/admin/usuarios", { cache: "no-store" });
    if (!res.ok) {
      setError((await res.json()).error ?? "Falha ao recarregar lista");
      return;
    }
    const body = await res.json();
    setUsers(body.users ?? []);
  }

  async function toggleActive(u: UsuarioRow) {
    setBusyId(u.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/usuarios/${u.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !u.active }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Falha ao atualizar status");
        return;
      }
      await refetch();
      showToast(u.active ? "Acesso cortado · conta preservada" : "Acesso reativado");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.id === currentUserId) {
      setError("Voce nao pode deletar seu proprio usuario");
      setDeleteTarget(null);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/usuarios/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Falha ao deletar usuario");
        return;
      }
      setDeleteTarget(null);
      await refetch();
      showToast("Usuário excluído permanentemente");
    } finally {
      setDeleting(false);
    }
  }

  // ---------- KPIs (sobre a lista completa visível ao operador) ----------
  const kpi = useMemo(() => {
    let socios = 0, funcionarios = 0, promotores = 0, ativos = 0;
    for (const u of users) {
      if (u.role === "socio") socios += 1;
      else if (u.role === "funcionario") funcionarios += 1;
      else promotores += 1;
      if (u.active) ativos += 1;
    }
    return { total: users.length, socios, funcionarios, promotores, ativos, inativos: users.length - ativos };
  }, [users]);

  // ---------- filtros encadeados ----------
  const q = query.trim().toLowerCase();
  const searched = useMemo(
    () =>
      users.filter(
        (u) =>
          !q ||
          (u.full_name ?? "").toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      ),
    [users, q]
  );
  const roleCounts = {
    todos: searched.length,
    socio: searched.filter((u) => u.role === "socio").length,
    funcionario: searched.filter((u) => u.role === "funcionario").length,
    promotor: searched.filter((u) => u.role === "promotor").length,
  };
  const afterRole = useMemo(
    () => (roleFilter === "todos" ? searched : searched.filter((u) => u.role === roleFilter)),
    [searched, roleFilter]
  );
  const statusCounts = {
    ativos: afterRole.filter((u) => u.active).length,
    inativos: afterRole.filter((u) => !u.active).length,
    todos: afterRole.length,
  };
  const view = afterRole.filter((u) =>
    statusFilter === "ativos" ? u.active : statusFilter === "inativos" ? !u.active : true
  );

  // só socio existe na lista? funcionario vê apenas promotores (server já filtra),
  // então a pílula de papel some pra funcionário (não há o que filtrar).
  const showRoleFilter = currentUserRole === "socio";

  return (
    <div className="rradmin">
      <UiStyles />
      <style dangerouslySetInnerHTML={{ __html: RRADMIN_CSS }} />
      <div className="wrap">
        {/* breadcrumb */}
        <nav className="crumb">
          <a href="/dashboard">Dashboard</a>
          <span className="sep">/</span>
          <span>Admin</span>
          <span className="sep">/</span>
          <span className="cur">Usuários</span>
        </nav>

        {/* HEADER */}
        <HeaderNavy
          brand="GRUPO RR CRED"
          title="Usuários"
          subtitle="Gestão de acesso · contas e papéis"
          actions={
            <div className="role">
              <span className={`d ${roleClass(currentUserRole)}`} />
              {currentUserEmail} · {roleLabel(currentUserRole)}
            </div>
          }
        >
          <KpiBand
            valueSize={28}
            items={[
              { label: "Total de usuários", value: kpi.total, sub: `${kpi.ativos} ativos · ${kpi.inativos} inativo${kpi.inativos === 1 ? "" : "s"}`, accent: true },
              { label: "Sócios", value: kpi.socios, sub: "acesso completo" },
              { label: "Funcionários", value: kpi.funcionarios, sub: "operacional" },
              { label: "Promotores", value: kpi.promotores, sub: "acesso aos próprios dados" },
            ]}
          />
        </HeaderNavy>

        {error ? (
          <div className="errbar" role="alert">
            <span className="bic"><IcoAlertTri /></span>
            <div>{error}</div>
          </div>
        ) : null}

        {/* ACTION BAR */}
        <div className="actionbar">
          <div className="search">
            <IcoSearch />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou e-mail…"
              aria-label="Buscar usuário"
            />
          </div>

          {showRoleFilter ? (
            <div className="seg" aria-label="Filtro por papel">
              {(["todos", "socio", "funcionario", "promotor"] as RoleFilter[]).map((r) => (
                <button key={r} className={roleFilter === r ? "on" : ""} onClick={() => setRoleFilter(r)}>
                  {r !== "todos" ? (
                    <span className="dt" style={{ background: r === "socio" ? "var(--blue)" : r === "funcionario" ? "var(--gold)" : "var(--green)" }} />
                  ) : null}
                  {r === "todos" ? "Todos" : roleLabel(r as UsuarioRow["role"])}
                  <span className="cnt">{roleCounts[r]}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="seg" aria-label="Filtro por status">
            {(["ativos", "inativos", "todos"] as StatusFilter[]).map((s) => (
              <button key={s} className={statusFilter === s ? "on" : ""} onClick={() => setStatusFilter(s)}>
                {s === "ativos" ? "Ativos" : s === "inativos" ? "Inativos" : "Todos"}
                <span className="cnt">{statusCounts[s]}</span>
              </button>
            ))}
          </div>

          <button className="newbtn" onClick={() => setShowCreate(true)}>
            <span className="ic"><IcoPlus /></span>
            Novo usuário
          </button>
        </div>

        {/* TABLE */}
        <div className="tcard">
          <div className="tcard-head">
            <div>
              <h2>Contas de acesso</h2>
              <p className="csub">{view.length} de {users.length} {users.length === 1 ? "usuário" : "usuários"}</p>
            </div>
            <div className="leg">
              <span className="lg"><span className="sw" style={{ background: "var(--blue)" }} />Sócio</span>
              <span className="lg"><span className="sw" style={{ background: "var(--gold)" }} />Funcionário</span>
              <span className="lg"><span className="sw" style={{ background: "var(--green)" }} />Promotor</span>
            </div>
          </div>
          <div className="tscroll">
            <table className="dt">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Status</th>
                  <th>Criado em</th>
                  <th className="r">Ações</th>
                </tr>
              </thead>
              <tbody>
                {view.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="emptyrow">
                      {query || roleFilter !== "todos" || statusFilter !== "ativos"
                        ? "Nenhum usuário para os filtros atuais."
                        : "Nenhum usuário cadastrado."}
                    </td>
                  </tr>
                ) : (
                  view.map((u) => {
                    const canManage = canManageUserRole(currentUserRole, u.role);
                    const isSelf = u.id === currentUserId;
                    const showActions = canManage && !isSelf;
                    return (
                      <tr key={u.id} className={u.active ? undefined : "inactive"}>
                        <td>
                          <div className="nm">
                            <span className="av">{initials(u.full_name, u.email)}</span>
                            {u.full_name ?? "—"}
                            {isSelf ? <span className="self">Você</span> : null}
                          </div>
                        </td>
                        <td><span className="em">{u.email}</span></td>
                        <td><span className={`rolechip ${roleClass(u.role)}`}><span className="d" />{u.role.toUpperCase()}</span></td>
                        <td>
                          <span className={`chip ${u.active ? "on" : "off"}`}>
                            <span className="d" />{u.active ? "Ativo" : "Inativo"}
                          </span>
                        </td>
                        <td className="num">{formatDate(u.created_at)}</td>
                        <td className="actcell">
                          {showActions ? (
                            <div className="acts">
                              <button className="iconact" title="Editar nome e papel" disabled={busyId === u.id} onClick={() => setEditTarget(u)}><IcoPencil /></button>
                              <button className="iconact" title="Resetar senha" disabled={busyId === u.id} onClick={() => setResetTarget(u)}><IcoKey /></button>
                              {u.active ? (
                                <button className="txtact warn" title="Desativar (cortar acesso)" disabled={busyId === u.id} onClick={() => toggleActive(u)}><IcoBan />Desativar</button>
                              ) : (
                                <button className="txtact go" title="Reativar (restaurar acesso)" disabled={busyId === u.id} onClick={() => toggleActive(u)}><IcoUndo />Reativar</button>
                              )}
                              <span className="actsep" />
                              {/* Parte C — Excluir só habilitado para o admin
                                  principal (SUPER_ADMIN_EMAIL). Para os demais
                                  fica desabilitado com tooltip; a trava real é
                                  validada no servidor (DELETE 403). */}
                              <button
                                className="iconact danger"
                                title={isSuperAdmin ? "Excluir permanentemente" : "Exclusão restrita ao administrador principal"}
                                disabled={busyId === u.id || !isSuperAdmin}
                                onClick={() => setDeleteTarget(u)}
                              ><IcoTrash /></button>
                            </div>
                          ) : (
                            <span className="dash">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* nota Desativar x Excluir */}
        <div className="rules">
          <span className="rlab">Desativar × Excluir</span>
          <span className="rchip"><IcoBan /><b>Desativar</b> corta o acesso (demissão) — reversível</span>
          <span className="rchip"><IcoTrash /><b>Excluir</b> apaga a conta de vez — permanente</span>
        </div>
      </div>

      {showCreate ? (
        <CreateUsuarioModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await refetch();
            showToast("Usuário criado");
          }}
          currentUserRole={currentUserRole}
        />
      ) : null}

      {editTarget ? (
        <EditUsuarioModal
          target={editTarget}
          currentUserRole={currentUserRole}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            setEditTarget(null);
            await refetch();
            showToast("Usuário atualizado");
          }}
        />
      ) : null}

      {resetTarget ? (
        <ResetPasswordModal target={resetTarget} onClose={() => setResetTarget(null)} />
      ) : null}

      {deleteTarget ? (
        <div className="rradmin">
          <div className="overlay" role="dialog" aria-modal="true" onClick={() => !deleting && setDeleteTarget(null)}>
            <div className="dialog" onClick={(e) => e.stopPropagation()}>
              <div className="dialog-head red">
                <div className="dt2">
                  <span className="di red"><IcoTrash /></span>
                  <div>
                    <h3 className="red">Excluir usuário</h3>
                    <p className="dsub">Ação permanente</p>
                  </div>
                </div>
                <button className="x" onClick={() => !deleting && setDeleteTarget(null)} aria-label="Fechar"><IcoX /></button>
              </div>
              <div className="dialog-body">
                <div className="dangerbanner">
                  <span className="di"><IcoAlertTri /></span>
                  <div className="dx">
                    <b>Esta ação é permanente e apaga a conta.</b> Para apenas cortar o acesso,
                    use <b>Desativar</b> — é reversível. Exclusão é restrita ao administrador principal.
                  </div>
                </div>
                <p className="cfm">Confirma excluir definitivamente este usuário?</p>
                <div className="userbox">
                  <span className="av">{initials(deleteTarget.full_name, deleteTarget.email)}</span>
                  <div>
                    <div className="ub-n">{deleteTarget.full_name ?? deleteTarget.email} · {roleLabel(deleteTarget.role)}</div>
                    <div className="ub-e">{deleteTarget.email}</div>
                  </div>
                </div>
                {error ? <div className="errbox">{error}</div> : null}
              </div>
              <div className="dialog-foot">
                <button className="btn-primary danger" disabled={deleting} onClick={confirmDelete}>
                  {deleting ? <><span className="spinner" />Excluindo…</> : <><IcoTrash />Excluir permanentemente</>}
                </button>
                <button className="btn-ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className={`toast${toast ? " show" : ""}`}>
        <span className="ck-i"><IcoInfo /></span>
        <span>{toast}</span>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return iso;
  }
}
