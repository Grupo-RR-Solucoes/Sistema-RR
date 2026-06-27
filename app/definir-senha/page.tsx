"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import BrandLogo from "../../components/BrandLogo";
import { getSupabaseBrowserClient } from "../../lib/auth/supabaseBrowserClient";
import { RRLOGIN_CSS } from "../login/loginStyles";

/**
 * Página de definição de senha — destino do /auth/callback após convite ou
 * recuperação. A sessão já foi criada no callback (exchangeCodeForSession);
 * aqui o usuário só escolhe a senha (supabase.auth.updateUser).
 *
 * Acesso direto (sem link) → sem sessão → mostra aviso de link inválido.
 * Reaproveita o design system do login (.rrlogin / RRLOGIN_CSS).
 */
export default function DefinirSenhaPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setHasSession(Boolean(data.session));
      setChecking(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("A senha deve ter ao menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setSubmitting(true);
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError("Não foi possível definir a senha. Tente novamente.");
      setSubmitting(false);
      return;
    }
    setDone(true);
    // A sessão já existe (veio do callback) → segue direto para o sistema.
    setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 900);
  }

  return (
    <div className="rrlogin">
      <style dangerouslySetInnerHTML={{ __html: RRLOGIN_CSS }} />
      <main className="stage">
        <div className="auth">
          <form className="card" onSubmit={handleSubmit} noValidate>
            <div className="brandmark">
              <BrandLogo size="lg" />
            </div>

            <div className="head">
              <h1>Definir senha</h1>
              <p>Escolha uma senha para acessar o sistema do Grupo RR Cred</p>
            </div>

            {checking ? (
              <div className="alert" role="status">
                <span>Validando o link…</span>
              </div>
            ) : !hasSession ? (
              <>
                <div className="alert warn" role="alert">
                  <svg className="ai" viewBox="0 0 24 24" fill="none" stroke="#B07A12" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13.5" /><line x1="12" y1="17" x2="12" y2="17" /></svg>
                  <span><b>Link inválido ou expirado.</b> Solicite um novo convite ou redefinição de senha.</span>
                </div>
                <a className="btn" href="/login">Ir para o login</a>
              </>
            ) : done ? (
              <div className="alert" role="status" style={{ borderColor: "#BBE3C4", background: "#EAF7EE" }}>
                <span><b>Senha definida com sucesso.</b> Redirecionando…</span>
              </div>
            ) : (
              <>
                {error ? (
                  <div className="alert err" role="alert">
                    <svg className="ai" viewBox="0 0 24 24" fill="none" stroke="#C0392B" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16.5" x2="12" y2="16.5" /></svg>
                    <span><b>{error}</b></span>
                  </div>
                ) : null}

                <div className="field pw">
                  <label htmlFor="senha">Nova senha</label>
                  <div className="control">
                    <svg className="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /></svg>
                    <input
                      id="senha"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={submitting}
                      placeholder="Mínimo 8 caracteres"
                    />
                    <button
                      type="button"
                      className="reveal"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      aria-pressed={showPassword}
                      disabled={submitting}
                    >
                      {showPassword ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 4.1-.9" /><path d="M9.5 9.5a3 3 0 0 0 4.2 4.2" /><line x1="3" y1="3" x2="21" y2="21" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="field pw">
                  <label htmlFor="confirma">Confirmar nova senha</label>
                  <div className="control">
                    <svg className="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /></svg>
                    <input
                      id="confirma"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      disabled={submitting}
                      placeholder="Repita a senha"
                    />
                  </div>
                </div>

                <button type="submit" className="btn" disabled={submitting}>
                  {submitting ? (
                    <>
                      <span className="spin" aria-hidden="true" />
                      Salvando…
                    </>
                  ) : (
                    "Definir senha e entrar"
                  )}
                </button>
              </>
            )}
          </form>

          <p className="pagefoot"><span className="dot" />Grupo RR Cred · acesso restrito</p>
        </div>
      </main>
    </div>
  );
}
