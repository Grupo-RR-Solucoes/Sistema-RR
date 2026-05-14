"use client";

import { useState, type CSSProperties } from "react";

import type { UsuarioRow } from "./UsuariosList";

interface Props {
  target: UsuarioRow;
  onClose: () => void;
}

export default function ResetPasswordModal({ target, onClose }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/usuarios/${target.id}/reset-password`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Falha ao resetar senha");
        return;
      }
      setNewPassword(data.password as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPassword() {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback manual
    }
  }

  const targetName = target.full_name ?? target.email;

  return (
    <div
      style={styles.overlay}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <header style={styles.header}>
          <h3 style={styles.title}>
            {newPassword ? "Nova senha gerada" : "Resetar senha"}
          </h3>
          <button
            type="button"
            style={styles.closeBtn}
            onClick={onClose}
            aria-label="Fechar"
          >
            ✕
          </button>
        </header>

        {newPassword ? (
          <div style={styles.successWrap}>
            <p style={styles.successText}>
              Nova senha provisória para <strong>{targetName}</strong> ({target.email}).
              As sessões ativas do usuário foram invalidadas — ele precisará logar de novo.
            </p>
            <div style={styles.passwordBox}>
              <code style={styles.passwordCode}>{newPassword}</code>
              <button
                type="button"
                style={styles.copyBtn}
                onClick={copyPassword}
              >
                {copied ? "Copiado!" : "Copiar"}
              </button>
            </div>
            <p style={styles.warning}>
              Esta senha não será exibida novamente. Após fechar, será preciso
              gerar nova senha para recuperar o acesso.
            </p>
            <button type="button" style={styles.primaryBtn} onClick={onClose}>
              Concluir
            </button>
          </div>
        ) : (
          <div style={styles.confirmWrap}>
            <p style={styles.confirmText}>
              Tem certeza que quer gerar nova senha para{" "}
              <strong>{targetName}</strong> ({target.email})?
            </p>
            <p style={styles.confirmDetail}>
              A senha atual será invalidada imediatamente e as sessões ativas do
              usuário serão encerradas. Ele precisará logar com a nova senha.
            </p>

            {error ? (
              <div role="alert" style={styles.error}>
                {error}
              </div>
            ) : null}

            <div style={styles.actions}>
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={onClose}
                disabled={submitting}
              >
                Cancelar
              </button>
              <button
                type="button"
                style={styles.primaryBtn}
                onClick={handleConfirm}
                disabled={submitting}
              >
                {submitting ? "Gerando..." : "Gerar nova senha"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(7, 19, 63, 0.42)",
    backdropFilter: "blur(4px)",
    display: "grid",
    placeItems: "center",
    zIndex: 100,
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    background: "var(--rr-surface-elevated)",
    border: "1px solid var(--rr-line)",
    borderRadius: 20,
    boxShadow: "var(--rr-shadow)",
    padding: "20px 22px 22px",
    display: "grid",
    gap: 14,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  title: { margin: 0, fontSize: 18, fontWeight: 800, color: "var(--rr-ink)" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-muted)",
    fontSize: 14,
    cursor: "pointer",
  },
  confirmWrap: { display: "grid", gap: 12 },
  confirmText: {
    margin: 0,
    fontSize: 14,
    color: "var(--rr-ink)",
    lineHeight: 1.5,
  },
  confirmDetail: {
    margin: 0,
    fontSize: 12,
    color: "var(--rr-muted)",
    lineHeight: 1.5,
  },
  successWrap: { display: "grid", gap: 12 },
  successText: {
    margin: 0,
    fontSize: 13,
    color: "var(--rr-ink)",
    lineHeight: 1.5,
  },
  passwordBox: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 12,
    background: "rgba(255,240,0,0.18)",
    border: "1px solid rgba(214,161,63,0.42)",
  },
  passwordCode: {
    flex: 1,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--rr-ink)",
    userSelect: "all",
  },
  copyBtn: {
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-blue-deep)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  warning: {
    margin: 0,
    fontSize: 12,
    color: "#8a4a17",
    fontWeight: 600,
    background: "rgba(214,161,63,0.10)",
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(214,161,63,0.22)",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 6,
  },
  primaryBtn: {
    padding: "10px 16px",
    borderRadius: 11,
    border: "none",
    cursor: "pointer",
    background:
      "linear-gradient(135deg, var(--rr-blue) 0%, var(--rr-blue-deep) 100%)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    boxShadow: "0 10px 20px rgba(13,77,227,0.28)",
  },
  secondaryBtn: {
    padding: "10px 16px",
    borderRadius: 11,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    color: "var(--rr-ink)",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  error: {
    padding: "10px 12px",
    borderRadius: 10,
    background: "rgba(180,30,30,0.08)",
    border: "1px solid rgba(180,30,30,0.24)",
    color: "#8a1717",
    fontSize: 13,
    fontWeight: 600,
  },
};
