"use client";

import { useState } from "react";

import type { UsuarioRow } from "./UsuariosList";
import { initials } from "./usuariosStyles";
import { IcoKey, IcoX, IcoCheck, IcoAlertTri } from "./icons";

interface Props {
  target: UsuarioRow;
  onClose: () => void;
}

export default function ResetPasswordModal({ target, onClose }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/usuarios/${target.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Falha ao enviar redefinição");
        return;
      }
      setResetSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setSubmitting(false);
    }
  }

  const targetName = target.full_name ?? target.email;

  return (
    <div className="rradmin">
      <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          {resetSent ? (
            <>
              <div className="dialog-head">
                <div className="dt2">
                  <span className="di green"><IcoCheck /></span>
                  <div>
                    <h3>Link de redefinição enviado</h3>
                    <p className="dsub">{target.email}</p>
                  </div>
                </div>
                <button className="x" onClick={onClose} aria-label="Fechar"><IcoX /></button>
              </div>
              <div className="dialog-body">
                <p className="pwlead">
                  Link de redefinição enviado para <b>{target.email}</b>. {targetName} vai
                  receber um e-mail com o link para criar uma nova senha.
                </p>
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
                    <h3>Redefinir senha</h3>
                    <p className="dsub">Envia um link de redefinição por e-mail</p>
                  </div>
                </div>
                <button className="x" onClick={onClose} aria-label="Fechar"><IcoX /></button>
              </div>
              <div className="dialog-body">
                <p className="cfm">Enviar link de redefinição para <b>{targetName}</b>?</p>
                <div className="userbox">
                  <span className="av">{initials(target.full_name, target.email)}</span>
                  <div>
                    <div className="ub-n">{targetName}</div>
                    <div className="ub-e">{target.email}</div>
                  </div>
                </div>
                <div className="infobanner">
                  <IcoAlertTri />
                  <span>Um e-mail será enviado para <b>{target.email}</b> com um link para o usuário criar uma nova senha.</span>
                </div>
                {error ? <div className="errbox">{error}</div> : null}
              </div>
              <div className="dialog-foot">
                <button type="button" className="btn-primary" onClick={handleConfirm} disabled={submitting}>
                  {submitting ? <><span className="spinner" />Enviando…</> : <><IcoKey />Enviar link</>}
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
