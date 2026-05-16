import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/getUser";
import type { UserRole } from "@/lib/auth/types";

export const dynamic = "force-dynamic";

type Shortcut = {
  href: string;
  category: string;
  title: string;
  description: string;
  icon: ReactNode;
  visibleTo: UserRole[];
};

const HOME_SHORTCUTS: Shortcut[] = [
  {
    href: "/promotores",
    category: "Comercial",
    title: "Promotores",
    description: "Gestão de promotores e comissões",
    icon: <IconUsers />,
    visibleTo: ["socio", "funcionario", "promotor"],
  },
  {
    href: "/producao",
    category: "Operação",
    title: "Produção",
    description: "Operação diária e carteira ativa",
    icon: <IconChartLine />,
    visibleTo: ["socio"],
  },
  {
    href: "/auditoria",
    category: "Controle",
    title: "Auditoria",
    description: "Divergências e conferências",
    icon: <IconShieldCheck />,
    visibleTo: ["socio"],
  },
  {
    href: "/financeiro",
    category: "Controle",
    title: "Financeiro",
    description: "Despesas, fluxo de caixa",
    icon: <IconWallet />,
    visibleTo: ["socio"],
  },
  {
    href: "/fechamento",
    category: "Operação",
    title: "Fechamento",
    description: "Conciliação mensal",
    icon: <IconFileCheck />,
    visibleTo: ["socio"],
  },
  {
    href: "/importacoes",
    category: "Dados",
    title: "Importações",
    description: "Cargas diárias e tabelas",
    icon: <IconUpload />,
    visibleTo: ["socio", "funcionario"],
  },
];

export default async function Home() {
  const session = await getCurrentUser();
  const role = session?.appUser.role;

  const visibleShortcuts = role
    ? HOME_SHORTCUTS.filter((shortcut) => shortcut.visibleTo.includes(role))
    : [];

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div style={styles.kicker}>ATALHOS RÁPIDOS</div>
        <h2 style={styles.title}>Operação Grupo RR Cred</h2>
        <p style={styles.description}>
          Acesso rápido aos módulos principais. Operação, controle e gestão
          centralizados em um único ambiente.
        </p>
      </header>

      {visibleShortcuts.length === 0 ? (
        <div style={styles.empty}>
          Você não tem atalhos disponíveis no momento.
        </div>
      ) : (
        <div style={styles.grid}>
          {visibleShortcuts.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              style={styles.card}
              className="rr-home-card"
            >
              <div style={styles.cardLabel}>
                <span style={styles.cardLabelNumber}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={styles.cardLabelDot}>·</span>
                <span style={styles.cardLabelCategory}>
                  {item.category.toUpperCase()}
                </span>
              </div>
              <span style={styles.cardIcon}>{item.icon}</span>
              <span style={styles.cardTitle}>{item.title}</span>
              <span style={styles.cardDescription}>{item.description}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function IconUsers() {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx={9} cy={8} r={3.5} />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx={17} cy={9} r={2.5} />
      <path d="M16 14c2.8 0 5 2.2 5 5" />
    </svg>
  );
}

function IconChartLine() {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 6-7" />
    </svg>
  );
}

function IconShieldCheck() {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l8 3v6c0 4.5-3.5 8.5-8 9-4.5-.5-8-4.5-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconWallet() {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x={3} y={6} width={18} height={13} rx={2} />
      <path d="M3 10h18" />
      <circle cx={17} cy={14} r={1.2} fill="currentColor" />
    </svg>
  );
}

function IconFileCheck() {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v12" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 18h16" />
    </svg>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "grid",
    gap: 28,
  },
  header: {
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
    fontSize: "clamp(2rem, 4vw, 2.6rem)",
    fontWeight: 700,
    color: "#0F1F4A",
    lineHeight: 1.1,
  },
  description: {
    margin: 0,
    fontSize: 15,
    color: "#5A6B82",
    lineHeight: 1.6,
    maxWidth: 720,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 16,
  },
  empty: {
    padding: 24,
    background: "#FFFFFF",
    border: "1px solid #D0D7E2",
    borderRadius: 20,
    color: "#5A6B82",
    fontSize: 14,
    lineHeight: 1.5,
  },
  card: {
    display: "grid",
    gap: 12,
    padding: 24,
    background: "#FFFFFF",
    border: "1px solid #D0D7E2",
    borderRadius: 20,
    textDecoration: "none",
    color: "#0F1F4A",
    transition:
      "border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease",
  },
  cardLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  cardLabelNumber: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "1.5px",
    color: "#0d4de3",
  },
  cardLabelDot: {
    color: "#0d4de3",
    fontWeight: 700,
  },
  cardLabelCategory: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "1.5px",
    color: "#0d4de3",
  },
  cardIcon: {
    color: "#0F1F4A",
    display: "inline-flex",
    marginTop: 4,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: 600,
    color: "#0F1F4A",
  },
  cardDescription: {
    fontSize: 14,
    color: "#5A6B82",
    lineHeight: 1.5,
  },
};
