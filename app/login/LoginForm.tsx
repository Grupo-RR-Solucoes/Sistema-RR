"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import BrandLogo from "../../components/BrandLogo";
import { getSupabaseBrowserClient } from "../../lib/auth/supabaseBrowserClient";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Parte B: conta desativada -> mensagem âmbar própria (evita o loop /<->/login).
  const [inactive, setInactive] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInactive(false);
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      // Parte C: conta banida no Auth (desativada) -> mensagem de conta desativada.
      if (/ban/i.test(signInError.message)) {
        setInactive(true);
      } else {
        setError(translateError(signInError.message));
      }
      setSubmitting(false);
      return;
    }

    // Parte B: ANTES de rotear, confirmar que a conta está ativa em app_users.
    // Um desativado que ainda autentique no Auth (ex.: ban não aplicado) é
    // barrado aqui com mensagem clara — sem cair no loop /<->/login.
    const authUserId = data.user?.id;
    if (authUserId) {
      const { data: row } = await supabase
        .from("app_users")
        .select("active")
        .eq("auth_user_id", authUserId)
        .maybeSingle();

      if (!row || row.active === false) {
        await supabase.auth.signOut();
        setInactive(true);
        setSubmitting(false);
        return;
      }
    }

    // Ativo: fluxo idêntico ao original — "/" roteia por papel.
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="auth">
      <form className="card" onSubmit={handleSubmit} noValidate>
        <div className="brandmark">
          <BrandLogo size="lg" />
        </div>

        <div className="head">
          <h1>Acesse sua conta</h1>
          <p>Sistema operacional do Grupo RR Cred</p>
        </div>

        {error ? (
          <div className="alert err" role="alert">
            <svg className="ai" viewBox="0 0 24 24" fill="none" stroke="#C0392B" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16.5" x2="12" y2="16.5" /></svg>
            <span><b>{error}</b> Verifique os dados e tente novamente.</span>
          </div>
        ) : null}

        {inactive ? (
          <div className="alert warn" role="alert">
            <svg className="ai" viewBox="0 0 24 24" fill="none" stroke="#B07A12" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13.5" /><line x1="12" y1="17" x2="12" y2="17" /></svg>
            <span><b>Conta desativada.</b> Procure um sócio para reativar seu acesso.</span>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="email">E-mail</label>
          <div className="control">
            <svg className="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              placeholder="voce@gruporrcred.com.br"
            />
          </div>
        </div>

        <div className="field pw">
          <label htmlFor="senha">Senha</label>
          <div className="control">
            <svg className="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /></svg>
            <input
              id="senha"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              placeholder="••••••••"
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

        <button type="submit" className="btn" disabled={submitting || inactive}>
          {submitting ? (
            <>
              <span className="spin" aria-hidden="true" />
              Entrando…
            </>
          ) : (
            "Entrar"
          )}
        </button>

        <p className="resethint">
          Esqueceu a senha? <b>Solicite a um sócio</b> para gerar uma nova credencial.
        </p>
      </form>

      <p className="pagefoot"><span className="dot" />Grupo RR Cred · acesso restrito</p>
    </div>
  );
}

function translateError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (m.includes("email not confirmed")) return "E-mail não confirmado.";
  if (m.includes("rate limit")) return "Muitas tentativas. Aguarde alguns minutos.";
  return message;
}
