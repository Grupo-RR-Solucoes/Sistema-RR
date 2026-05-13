import type { CSSProperties } from "react";
import { redirect } from "next/navigation";

import BrandLogo from "../../components/BrandLogo";
import { getCurrentUser } from "../../lib/auth/getUser";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Se já logado, sai direto pra home.
  const session = await getCurrentUser();
  if (session) redirect("/");

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>
          <BrandLogo size={84} tone="dark" subtitle="Sistema operacional do Grupo RR Cred" />
        </div>

        <div style={styles.intro}>
          <h1 style={styles.title}>Acesse sua conta</h1>
          <p style={styles.subtitle}>
            Entre com seu e-mail corporativo e senha provisória. Promotores recebem
            credenciais individuais; sócios e funcionários têm acesso completo.
          </p>
        </div>

        <LoginForm />

        <div style={styles.footer}>
          <span style={styles.footerHint}>
            Esqueceu a senha? Solicite a um sócio para gerar nova credencial.
          </span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 20px",
  },
  card: {
    width: "100%",
    maxWidth: 440,
    display: "grid",
    gap: 22,
    padding: "32px 30px 26px",
    borderRadius: 28,
    background: "var(--rr-surface-elevated)",
    border: "1px solid var(--rr-line)",
    boxShadow: "var(--rr-shadow)",
    backdropFilter: "blur(18px)",
  },
  brand: {
    display: "flex",
    justifyContent: "center",
    paddingBottom: 4,
  },
  intro: {
    display: "grid",
    gap: 6,
    textAlign: "center",
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: "var(--rr-ink)",
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: "var(--rr-muted)",
    lineHeight: 1.5,
  },
  footer: {
    display: "flex",
    justifyContent: "center",
    paddingTop: 4,
  },
  footerHint: {
    fontSize: 12,
    color: "var(--rr-muted)",
    textAlign: "center",
  },
};
