"use client";

import { useState } from "react";

import type { UsuarioRow } from "./UsuariosList";
import { initials } from "./usuariosStyles";
import { IcoKey, IcoX, IcoCopy, IcoCheck, IcoAlertTri } from "./icons";

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
      const res = await fetch(`/api/admin/usuarios/${target.id}/reset-password`, { method: "POST" });
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
    <div className="rradmin">
      <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          {newPassword ? (
            <>
              <div className="dialog-head">
                <div className="dt2">
                  <span className="di green"><IcoCheck /></span>
                  <div>
                    <h3>Nova senha gerada</h3>
                    <p className="dsub">{target.email}</p>
                  </div>
                </div>
                <button className="x" onClick={onClose} aria-label="Fechar"><IcoX /></button>
              </div>
              <div className="dialog-body">
                <p className="pwlead">
                  Nova senha provisória para <b>{targetName}</b>. As sessões ativas do usuário
                  foram <b>invalidadas</b> — ele precisará logar de novo.
                </p>
                <div className="pwbox">
                  <code>{newPassword}</code>
                  <button type="button" className="copy" onClick={copyPassword}>
                    {copied ? <><IcoCheck />Copiado</> : <><IcoCopy />Copiar</>}
                  </button>
                </div>
                <div className="pwwarn">
                  <IcoAlertTri />
                  <span><b>Esta senha não será exibida novamente.</b> Copie agora — depois só gerando uma nova.</span>
                </div>
              </div>
              <div className="dialog-foot">
                <button type="button" className="btn-primary" onClick={onClose}><IcoCheck />Concluir</button>
              </div>
            </>
          ) : (
            <>
              <div className="dialog-head">
                <div className="dt2">
                  <span className="di"><IcoKey /></span>
                  <div>
                    <h3>Resetar senha</h3>
                    <p className="dsub">Gera uma nova senha provisória</p>
                  </div>
                </div>
                <button className="x" onClick={onClose} aria-label="Fechar"><IcoX /></button>
              </div>
              <div className="dialog-body">
                <p className="cfm">Gerar nova senha para <b>{targetName}</b>?</p>
                <div className="userbox">
                  <span className="av">{initials(target.full_name, target.email)}</span>
                  <div>
                    <div className="ub-n">{targetName}</div>
                    <div className="ub-e">{target.email}</div>
                  </div>
                </div>
                <div className="infobanner">
                  <IcoAlertTri />
                  <span>A senha atual será invalidada e <b>as sessões ativas do usuário serão encerradas</b>. Ele precisará logar de novo.</span>
                </div>
                {error ? <div className="errbox">{error}</div> : null}
              </div>
              <div className="dialog-foot">
                <button type="button" className="btn-primary" onClick={handleConfirm} disabled={submitting}>
                  {submitting ? <><span className="spinner" />Gerando…</> : <><IcoKey />Gerar nova senha</>}
                </button>
                <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>Cancelar</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
