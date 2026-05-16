"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import BrandLogo from "./BrandLogo";
import { useUser } from "../lib/auth/useUser";
import type { UserRole } from "../lib/auth/types";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  visibleTo: UserRole[];
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    id: "painel",
    label: "Painel",
    items: [
      { href: "/", label: "Visão geral", icon: "VG", visibleTo: ["socio"] },
      { href: "/dashboard", label: "Dashboard", icon: "DB", visibleTo: ["socio"] },
    ],
  },
  {
    id: "operacao",
    label: "Operação",
    items: [
      { href: "/producao", label: "Produção", icon: "PD", visibleTo: ["socio"] },
      { href: "/importacoes", label: "Importações", icon: "IM", visibleTo: ["socio", "funcionario"] },
      { href: "/fechamento", label: "Fechamento", icon: "FC", visibleTo: ["socio"] },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    items: [
      { href: "/promotores", label: "Promotores", icon: "PM", visibleTo: ["socio", "funcionario", "promotor"] },
      { href: "/cadastros", label: "Cadastros", icon: "CD", visibleTo: ["socio", "funcionario"] },
    ],
  },
  {
    id: "controle",
    label: "Controle",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: "FN", visibleTo: ["socio"] },
      { href: "/auditoria", label: "Auditoria", icon: "AU", visibleTo: ["socio"] },
      { href: "/relatorios", label: "Relatórios", icon: "RL", visibleTo: ["socio", "funcionario"] },
      { href: "/configuracoes", label: "Configurações", icon: "CF", visibleTo: ["socio"] },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [{ href: "/admin/usuarios", label: "Usuários", icon: "US", visibleTo: ["socio"] }],
  },
];

const SIDEBAR_STORAGE_KEY = "rr-shell-sidebar-collapsed";

const ROLE_LABEL: Record<string, string> = {
  socio: "Sócio",
  funcionario: "Funcionário",
  promotor: "Promotor",
};

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useUser();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  function readStoredCollapsed() {
    try {
      const v = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (v === "true") return true;
      if (v === "false") return false;
    } catch {
      /* ignore */
    }
    return false;
  }

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1024px)");
    const sync = () => {
      setIsMobile(media.matches);
      if (media.matches) {
        setSidebarCollapsed(false);
      } else {
        setSidebarCollapsed(readStoredCollapsed());
        setMobileOpen(false);
      }
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (isMobile) return;
    try {
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEY,
        sidebarCollapsed ? "true" : "false"
      );
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed, isMobile]);

  useEffect(() => {
    if (isMobile) {
      document.body.style.overflow = mobileOpen ? "hidden" : "";
      return () => {
        document.body.style.overflow = "";
      };
    }
    document.body.style.overflow = "";
  }, [isMobile, mobileOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [pathname, isMobile]);

  const isItemActive = (item: NavItem) => {
    if (item.href === "/") return pathname === "/";
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  // Filtro item-a-item por role. Durante loading (user?.role undefined) o
  // menu fica vazio para nao vazar visibilidade. Grupos sem itens visiveis
  // sao removidos para nao mostrar cabecalho de grupo orfao.
  const visibleNavGroups = useMemo(() => {
    const role = user?.role;
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => role && item.visibleTo.includes(role)),
      }))
      .filter((group) => group.items.length > 0);
  }, [user?.role]);

  const allItems = visibleNavGroups.flatMap((g) => g.items);
  const currentItem =
    allItems.find((item) => isItemActive(item)) ??
    visibleNavGroups[0]?.items[0] ??
    navGroups[0].items[0];
  const currentGroup =
    visibleNavGroups.find((group) =>
      group.items.some((item) => isItemActive(item))
    ) ?? visibleNavGroups[0] ?? navGroups[0];

  function toggleSidebar() {
    if (isMobile) {
      setMobileOpen((c) => !c);
      return;
    }
    setSidebarCollapsed((c) => !c);
  }

  // Login renderiza sem shell
  if (pathname === "/login") {
    return <>{children}</>;
  }

  const shellDataset = {
    "data-sidebar-collapsed": sidebarCollapsed ? "true" : "false",
    "data-mobile-open": mobileOpen ? "true" : "false",
  } as const;

  const collapsed = !isMobile && sidebarCollapsed;
  const avatarInitial =
    (user?.fullName ?? user?.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div className="rr-shell" {...shellDataset}>
      <button
        type="button"
        className="rr-sidebar-backdrop"
        aria-label="Fechar menu lateral"
        onClick={() => setMobileOpen(false)}
      />

      <aside className="rr-sidebar" style={styles.sidebar}>
        {/* Header do sidebar: logo + toggle */}
        <div style={styles.sidebarHeader}>
          {collapsed ? (
            <BrandLogo size="sm" tone="dark" />
          ) : (
            <BrandLogo size="md" tone="dark" />
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            style={styles.toggleBtn}
            aria-label={
              isMobile
                ? "Fechar menu"
                : sidebarCollapsed
                ? "Expandir menu"
                : "Recolher menu"
            }
            title={
              isMobile
                ? "Fechar menu"
                : sidebarCollapsed
                ? "Expandir menu"
                : "Recolher menu"
            }
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>

        <div style={styles.sidebarDivider} />

        <nav style={styles.nav}>
          {visibleNavGroups.map((group) => (
            <section key={group.id} style={styles.groupSection}>
              {!collapsed ? (
                <div style={styles.groupLabel}>{group.label}</div>
              ) : null}
              <ul style={styles.itemsList}>
                {group.items.map((item) => {
                  const active = isItemActive(item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        style={{
                          ...styles.navItem,
                          ...(active ? styles.navItemActive : {}),
                          ...(collapsed ? styles.navItemCollapsed : {}),
                        }}
                      >
                        <span
                          style={{
                            ...styles.navIcon,
                            ...(active ? styles.navIconActive : {}),
                          }}
                        >
                          {item.icon}
                        </span>
                        {!collapsed ? (
                          <span style={styles.navLabel}>{item.label}</span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>
      </aside>

      <div className="rr-content">
        <header className="rr-topbar" style={styles.topbar}>
          <div style={styles.topbarLeft}>
            {isMobile ? (
              <button
                type="button"
                onClick={() => setMobileOpen((c) => !c)}
                style={styles.mobileToggle}
                aria-label="Abrir menu"
              >
                ≡
              </button>
            ) : null}
            <nav aria-label="Trilha" style={styles.breadcrumb}>
              <span style={styles.crumbSection}>{currentGroup.label}</span>
              <span style={styles.crumbSep}>›</span>
              <span style={styles.crumbActive}>{currentItem.label}</span>
            </nav>
          </div>

          <div style={styles.topbarRight}>
            {user ? (
              <>
                <div style={styles.avatar} aria-hidden="true">
                  {avatarInitial}
                </div>
                <div style={styles.userInfo}>
                  <span style={styles.userName}>
                    {user.fullName ?? user.email}
                  </span>
                  <span style={styles.userRole}>
                    {ROLE_LABEL[user.role] ?? user.role}
                  </span>
                </div>
                <form
                  action="/api/auth/logout"
                  method="post"
                  style={styles.logoutForm}
                >
                  <button
                    type="submit"
                    style={styles.logoutBtn}
                    aria-label="Sair"
                    title="Sair"
                  >
                    ↩
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </header>

        <main className="rr-main">
          <div className="rr-main-shell">{children}</div>
        </main>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  sidebar: {
    padding: "16px 12px",
    color: "rgba(255,255,255,0.88)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  sidebarHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingInline: 0,
    paddingTop: 24,
    paddingBottom: 20,
    width: "100%",
    boxSizing: "border-box",
    overflow: "visible",
  },
  toggleBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.85)",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  sidebarDivider: {
    height: 1,
    background: "rgba(255,255,255,0.1)",
    marginInline: 4,
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    paddingTop: 12,
  },
  groupSection: {
    display: "grid",
    gap: 4,
  },
  groupLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "1px",
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.5)",
    paddingInline: 12,
    marginBottom: 4,
  },
  itemsList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "grid",
    gap: 2,
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 12px 7px 16px",
    borderLeft: "4px solid transparent",
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    transition: "background 120ms ease, color 120ms ease",
  },
  navItemActive: {
    borderLeft: "4px solid #fff000",
    background: "rgba(13,77,227,0.45)",
    color: "#FFFFFF",
    fontWeight: 700,
  },
  navItemCollapsed: {
    justifyContent: "center",
    padding: "7px 8px 7px 8px",
    borderLeft: "4px solid transparent",
  },
  navIcon: {
    width: 22,
    height: 22,
    borderRadius: 4,
    display: "grid",
    placeItems: "center",
    color: "rgba(255,255,255,0.65)",
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.04em",
    flexShrink: 0,
  },
  navIconActive: {
    background: "#fff000",
    color: "#0F1F4A",
  },
  navLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: 20,
    height: 56,
    gap: 16,
  },
  topbarLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  mobileToggle: {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: "1px solid var(--rr-line)",
    background: "#fff",
    color: "var(--rr-navy)",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  crumbSection: {
    color: "var(--rr-muted)",
    fontWeight: 500,
  },
  crumbSep: {
    color: "var(--rr-line-strong)",
    fontWeight: 400,
  },
  crumbActive: {
    color: "#0d4de3",
    fontWeight: 600,
  },
  topbarRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "#0d4de3",
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: 700,
    display: "grid",
    placeItems: "center",
  },
  userInfo: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    lineHeight: 1.15,
  },
  userName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--rr-navy)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 200,
  },
  userRole: {
    fontSize: 11,
    fontWeight: 700,
    color: "#d6a13f",
    letterSpacing: "0.04em",
  },
  logoutForm: {
    margin: 0,
    display: "inline-flex",
  },
  logoutBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: "1px solid var(--rr-line)",
    background: "#fff",
    color: "var(--rr-navy)",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
};
