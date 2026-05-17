"use client";

import { useState, type CSSProperties } from "react";

import { canManageUserRole } from "@/lib/auth/permissions";

import CreateUsuarioModal from "./CreateUsuarioModal";
import ResetPasswordModal from "./ResetPasswordModal";

export interface UsuarioRow {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string | null;
  role: "socio" | "funcionario" | "promotor";
  cnpj_id: string | null;
  promoter_id: string | null;
  active: boolean;
  created_at: string;
  created_by: string | null;
}

interface Props {
  initialUsers: UsuarioRow[];
  loadError: string | null;
  currentUserId: string;
  // Disc.14 Etapa 14.2: propagado do server. Consumo visual (filtros de
  // dropdown, ocultar botoes para alvos fora do escopo) fica na Etapa 14.3.
  currentUserRole: UsuarioRow["role"];
}

export default function UsuariosList({
  initialUsers,
  loadError,
  currentUserId,
  currentUserRole,
}: Props) {
  const [users, setUsers] = useState<UsuarioRow[]>(initialUsers);
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<UsuarioRow | null>(null);
  const [error, setError] = useState<string | null>(loadError);
  const [busyId, setBusyId] = useState<string | null>(null);

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
        const body = await res.json();
        setError(body.error ?? "Falha ao atualizar status");
        return;
      }
      await refetch();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteUser(u: UsuarioRow) {
    if (u.id === currentUserId) {
      setError("Voce nao pode deletar seu proprio usuario");
      return;
    }
    const ok = window.confirm(
      `Confirma DELETAR ${u.email} (${u.role})? Esta acao remove o login e nao pode ser desfeita. Considere 'Desativar' em vez de deletar.`
    );
    if (!ok) return;

    setBusyId(u.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/usuarios/${u.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? "Falha ao deletar usuario");
        return;
      }
      await refetch();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerCopy}>
          <div style={styles.kicker}>GESTÃO DE ACESSO</div>
          <h2 style={styles.title}>Usuários do sistema</h2>
          <p style={styles.subtitle}>
            Sócios gerenciam todos os usuários do sistema. Funcionários podem
            cadastrar e gerenciar promotores. Toda criação, edição, reset de
            senha e remoção é auditada automaticamente.
          </p>
        </div>
        <button
          type="button"
          style={styles.primaryBtn}
          onClick={() => setShowCreate(true)}
        >
          + Novo usuário
        </button>
      </header>

      {error ? (
        <div role="alert" style={styles.errorBanner}>
          {error}
        </div>
      ) : null}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Nome</th>
              <th style={styles.th}>E-mail</th>
              <th style={styles.th}>Perfil</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Criado em</th>
              <th style={styles.thActions}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} style={styles.empty}>
                  Nenhum usuário cadastrado.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const canManage = canManageUserRole(currentUserRole, u.role);
                const isSelf = u.id === currentUserId;
                const showActions = canManage && !isSelf;
                return (
                  <tr key={u.id} style={u.active ? undefined : styles.rowInactive}>
                    <td style={styles.td}>{u.full_name ?? "—"}</td>
                    <td style={styles.td}>{u.email}</td>
                    <td style={styles.td}>
                      <span style={roleChip(u.role)}>{u.role.toUpperCase()}</span>
                    </td>
                    <td style={styles.td}>
                      <span style={u.active ? styles.activeChip : styles.inactiveChip}>
                        {u.active ? (
                          <>
                            <span style={styles.activeDot} aria-hidden="true" />
                            Ativo
                          </>
                        ) : (
                          "Inativo"
                        )}
                      </span>
                    </td>
                    <td style={styles.td}>{formatDate(u.created_at)}</td>
                    <td style={styles.tdActions}>
                      {showActions ? (
                        <>
                          <button
                            type="button"
                            style={styles.actionBtn}
                            disabled={busyId === u.id}
                            onClick={() => setResetTarget(u)}
                            title="Gerar nova senha provisória"
                          >
                            Resetar senha
                          </button>
                          <button
                            type="button"
                            style={styles.actionBtn}
                            disabled={busyId === u.id}
                            onClick={() => toggleActive(u)}
                            title={u.active ? "Desativar usuário" : "Ativar usuário"}
                          >
                            {u.active ? "Desativar" : "Ativar"}
                          </button>
                          <button
                            type="button"
                            style={styles.dangerBtn}
                            disabled={busyId === u.id}
                            onClick={() => deleteUser(u)}
                            title="Deletar usuário"
                          >
                            Deletar
                          </button>
                        </>
                      ) : (
                        <span style={styles.actionsEmpty}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showCreate ? (
        <CreateUsuarioModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await refetch();
          }}
          currentUserRole={currentUserRole}
        />
      ) : null}

      {resetTarget ? (
        <ResetPasswordModal
          target={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      ) : null}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function roleChip(role: UsuarioRow["role"]): CSSProperties {
  const base: CSSProperties = {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.3px",
  };
  if (role === "socio")
    return { ...base, background: "#0d4de3", color: "#FFFFFF" };
  if (role === "funcionario")
    return { ...base, background: "#d6a13f", color: "#FFFFFF" };
  return { ...base, background: "rgba(40,140,80,0.14)", color: "#185a36" };
}

const styles: Record<string, CSSProperties> = {
  page: { display: "grid", gap: 24 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 20,
    flexWrap: "wrap",
    marginBottom: 4,
  },
  headerCopy: {
    display: "grid",
    gap: 8,
    maxWidth: 760,
  },
  kicker: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "2.5px",
    textTransform: "uppercase",
    color: "#0d4de3",
  },
  title: {
    margin: 0,
    fontSize: "clamp(2rem, 3.5vw, 2.4rem)",
    fontWeight: 700,
    color: "#0F1F4A",
    lineHeight: 1.1,
  },
  subtitle: {
    margin: 0,
    fontSize: 15,
    color: "#5A6B82",
    maxWidth: 720,
    lineHeight: 1.6,
  },
  primaryBtn: {
    padding: "12px 20px",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    background: "#0d4de3",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.5px",
    textTransform: "uppercase",
    boxShadow: "0 4px 12px rgba(13,77,227,0.18)",
    alignSelf: "flex-start",
  },
  errorBanner: {
    padding: "10px 14px",
    borderRadius: 10,
    background: "rgba(180,30,30,0.08)",
    border: "1px solid rgba(180,30,30,0.24)",
    color: "#8a1717",
    fontSize: 13,
    fontWeight: 600,
  },
  tableWrap: {
    overflowX: "auto",
    background: "var(--rr-surface-elevated)",
    border: "1px solid var(--rr-line)",
    borderRadius: 16,
    boxShadow: "var(--rr-shadow-soft)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 14,
  },
  th: {
    textAlign: "left",
    padding: "12px 14px",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#0F1F4A",
    borderBottom: "1px solid var(--rr-line)",
    background: "#E8EDF5",
  },
  thActions: {
    textAlign: "right",
    padding: "12px 14px",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#0F1F4A",
    borderBottom: "1px solid var(--rr-line)",
    background: "#E8EDF5",
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid var(--rr-line)",
    color: "var(--rr-ink)",
    verticalAlign: "middle",
  },
  tdActions: {
    padding: "10px 14px",
    borderBottom: "1px solid var(--rr-line)",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  rowInactive: {
    opacity: 0.55,
  },
  empty: {
    padding: "28px 14px",
    textAlign: "center",
    color: "var(--rr-muted)",
    fontStyle: "italic",
  },
  activeChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 12px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: "#fff000",
    color: "#0F1F4A",
    letterSpacing: "0.3px",
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#1f9d55",
  },
  inactiveChip: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: "#E8EDF5",
    color: "#5A6B82",
    letterSpacing: "0.3px",
  },
  actionBtn: {
    marginLeft: 8,
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-blue-deep)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  dangerBtn: {
    marginLeft: 8,
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid rgba(180,30,30,0.32)",
    background: "rgba(180,30,30,0.06)",
    color: "#8a1717",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  actionsEmpty: {
    color: "var(--rr-muted)",
    fontSize: 13,
  },
};
