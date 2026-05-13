"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseBrowserClient } from "../../lib/auth/supabaseBrowserClient";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(translateError(signInError.message));
      setSubmitting(false);
      return;
    }

    // Sessão criada — middleware vai re-checar e router.refresh força Server
    // Components a re-renderizar com o cookie novo.
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form} noValidate>
      <label style={styles.label}>
        <span style={styles.labelText}>E-mail</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
          disabled={submitting}
          placeholder="seu@email.com"
        />
      </label>

      <label style={styles.label}>
        <span style={styles.labelText}>Senha</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          disabled={submitting}
        />
      </label>

      {error ? (
        <div role="alert" style={styles.error}>
          {error}
        </div>
      ) : null}

      <button type="submit" disabled={submitting} style={styles.submit}>
        {submitting ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}

function translateError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (m.includes("email not confirmed")) return "E-mail não confirmado.";
  if (m.includes("rate limit")) return "Muitas tentativas. Aguarde alguns minutos.";
  return message;
}

const styles: Record<string, CSSProperties> = {
  form: {
    display: "grid",
    gap: 16,
  },
  label: {
    display: "grid",
    gap: 6,
  },
  labelText: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--rr-ink)",
    letterSpacing: "0.02em",
  },
  input: {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--rr-line-strong)",
    background: "#fff",
    fontSize: 15,
    color: "var(--rr-ink)",
    outline: "none",
    fontFamily: "inherit",
  },
  error: {
    padding: "10px 14px",
    borderRadius: 10,
    background: "rgba(180,30,30,0.08)",
    border: "1px solid rgba(180,30,30,0.24)",
    color: "#8a1717",
    fontSize: 13,
    fontWeight: 600,
  },
  submit: {
    marginTop: 4,
    padding: "13px 18px",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    background:
      "linear-gradient(135deg, var(--rr-blue) 0%, var(--rr-blue-deep) 100%)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    boxShadow: "0 12px 24px rgba(13,77,227,0.32)",
  },
};
