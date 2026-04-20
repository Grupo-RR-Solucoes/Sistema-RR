"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  description: string;
};

const navItems: NavItem[] = [
  {
    href: "/",
    label: "Visao geral",
    description: "Resumo do sistema e atalhos principais",
  },
  {
    href: "/importacao-diaria",
    label: "Importacao diaria",
    description: "Carga diaria de producao e atualizacao de propostas",
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    description: "Recebimento consolidado e visao financeira",
  },
  {
    href: "/financeiro",
    label: "Financeiro",
    description: "Diferido, PRT e acompanhamento de parcelas",
  },
  {
    href: "/auditoria",
    label: "Auditoria",
    description: "Conferencia de divergencias e calculos",
  },
  {
    href: "/comissoes/editar",
    label: "Comissao por proposta",
    description: "Overrides manuais por proposta",
  },
  {
    href: "/comissoes/produto",
    label: "Regra por produto",
    description: "Regras mensais e acordos de repasse",
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <div style={styles.brandBlock}>
          <div style={styles.kicker}>Grupo RR Solucoes</div>
          <div style={styles.brandTitle}>Sistema RR</div>
          <div style={styles.brandSubtitle}>
            Producao, comissoes, auditoria e financeiro em um unico lugar
          </div>
        </div>

        <nav style={styles.nav}>
          {navItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  ...styles.navItem,
                  ...(active ? styles.navItemActive : {}),
                }}
              >
                <span style={styles.navLabel}>{item.label}</span>
                <span style={styles.navDescription}>{item.description}</span>
              </Link>
            );
          })}
        </nav>

        <div style={styles.sidebarFooter}>
          Base atual em evolucao para o modelo final do sistema.
        </div>
      </aside>

      <div style={styles.contentArea}>
        <header style={styles.topbar}>
          <div>
            <div style={styles.topbarKicker}>Painel administrativo</div>
            <h1 style={styles.topbarTitle}>RR Comissoes</h1>
          </div>
          <div style={styles.topbarBadge}>Branch: codex/foundation-setup</div>
        </header>

        <main style={styles.main}>{children}</main>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100vh",
    display: "grid",
    gridTemplateColumns: "320px 1fr",
    background:
      "linear-gradient(135deg, #eff3ea 0%, #f7f5ee 42%, #f3f7fb 100%)",
  },
  sidebar: {
    background:
      "linear-gradient(180deg, #173527 0%, #1d4a37 58%, #133025 100%)",
    color: "#f3f2e8",
    padding: "28px 22px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    borderRight: "1px solid rgba(255,255,255,0.08)",
    position: "sticky",
    top: 0,
    height: "100vh",
    boxSizing: "border-box",
  },
  brandBlock: {
    display: "grid",
    gap: "8px",
  },
  kicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "rgba(243,242,232,0.7)",
  },
  brandTitle: {
    fontSize: "30px",
    fontWeight: 700,
    lineHeight: 1.05,
  },
  brandSubtitle: {
    fontSize: "14px",
    lineHeight: 1.5,
    color: "rgba(243,242,232,0.82)",
  },
  nav: {
    display: "grid",
    gap: "10px",
  },
  navItem: {
    display: "grid",
    gap: "4px",
    padding: "14px 14px",
    borderRadius: "14px",
    textDecoration: "none",
    color: "#f3f2e8",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  navItemActive: {
    background: "#f3f2e8",
    color: "#173527",
    border: "1px solid #f3f2e8",
    boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
  },
  navLabel: {
    fontSize: "15px",
    fontWeight: 700,
  },
  navDescription: {
    fontSize: "12px",
    lineHeight: 1.45,
    opacity: 0.85,
  },
  sidebarFooter: {
    marginTop: "auto",
    fontSize: "12px",
    lineHeight: 1.5,
    color: "rgba(243,242,232,0.72)",
    paddingTop: "10px",
  },
  contentArea: {
    minWidth: 0,
    display: "grid",
    gridTemplateRows: "auto 1fr",
  },
  topbar: {
    padding: "26px 32px 12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
  },
  topbarKicker: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "#57646f",
    marginBottom: "6px",
  },
  topbarTitle: {
    margin: 0,
    fontSize: "32px",
    color: "#111827",
  },
  topbarBadge: {
    background: "#ffffff",
    border: "1px solid #d9dfd6",
    color: "#1f3a2d",
    padding: "10px 14px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  main: {
    padding: "8px 32px 32px",
  },
};