"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import BrandLogo from "./BrandLogo";
import { useUser } from "../lib/auth/useUser";
import type { UserRole } from "../lib/auth/types";

// Icones Lucide (stroke 1.8) — paths verbatim do mock aprovado.
const ICON_PATHS: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/>',
  gauge: '<path d="m13 13 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  lock: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  trending: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  wallet: '<path d="M3 6a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2"/><path d="M3 6v12a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"/><path d="M21 11h-5a2 2 0 0 0 0 4h5a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1z"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  arrowdown: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="m8 12 4 4 4-4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  filechart: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/><path d="M8 18v-3"/><path d="M12 18v-6"/><path d="M16 18v-2"/>',
  usercog: '<circle cx="18" cy="15" r="3"/><circle cx="9" cy="7" r="4"/><path d="M10 15H6a4 4 0 0 0-4 4v2"/><path d="m21.7 16.4-.9-.3"/><path d="m15.2 13.9-.9-.3"/><path d="m16.6 18.7.3-.9"/><path d="m19.1 12.2.3-.9"/><path d="m19.6 18.7-.4-1"/><path d="m16.8 12.3-.4-1"/><path d="m14.3 16.6 1-.4"/><path d="m20.7 13.8 1-.4"/>',
  network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  linechart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
};

function NavIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] ?? "" }}
    />
  );
}

const CHEVRON: Record<"left" | "right", string> = {
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
};

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: CHEVRON[dir] }}
    />
  );
}

// Logout (Lucide log-out) + Menu (Lucide menu) — mesmo idioma dos ícones da nav.
const LOGOUT_PATH =
  '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>';
function LogoutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: LOGOUT_PATH }}
    />
  );
}

const MENU_PATH = '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>';
function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: MENU_PATH }}
    />
  );
}

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
      { href: "/dashboard", label: "Dashboard", icon: "gauge", visibleTo: ["socio"] },
    ],
  },
  {
    id: "operacao",
    label: "Operação",
    items: [
      { href: "/importacoes", label: "Importações", icon: "upload", visibleTo: ["socio", "funcionario"] },
      { href: "/fechamento", label: "Fechamento", icon: "lock", visibleTo: ["socio"] },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    items: [
      { href: "/promotores", label: "Promotores", icon: "users", visibleTo: ["socio", "funcionario", "promotor"] },
      { href: "/projecao", label: "Projeção", icon: "trending", visibleTo: ["socio", "funcionario", "promotor"] },
      { href: "/cadastros", label: "Cadastros", icon: "clipboard", visibleTo: ["socio", "funcionario"] },
    ],
  },
  {
    id: "controle",
    label: "Controle",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: "wallet", visibleTo: ["socio"] },
      { href: "/recebiveis", label: "Recebíveis", icon: "linechart", visibleTo: ["socio"] },
      { href: "/receitas", label: "Receita & Simples", icon: "percent", visibleTo: ["socio", "funcionario"] },
      { href: "/despesas", label: "Despesas", icon: "arrowdown", visibleTo: ["socio", "funcionario"] },
      { href: "/auditoria", label: "Auditoria", icon: "shield", visibleTo: ["socio"] },
      { href: "/relatorios", label: "Relatórios", icon: "filechart", visibleTo: ["socio", "funcionario"] },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { href: "/admin/usuarios", label: "Usuários", icon: "usercog", visibleTo: ["socio", "funcionario"] },
      { href: "/admin/equipes", label: "Equipes", icon: "network", visibleTo: ["socio", "funcionario"] },
      { href: "/produtos/atribuicao", label: "Atribuição de produtos", icon: "clipboard", visibleTo: ["socio", "funcionario"] },
      { href: "/admin/gestor-consorcio", label: "Gestor de Consórcio", icon: "usercog", visibleTo: ["socio"] },
    ],
  },
  {
    // Visão restrita do gestor (F4): supervisor/gerente_regional só enxergam
    // este grupo. Itens sensíveis (Dashboard, Financeiro, Auditoria, Projeção,
    // Promotores) NÃO incluem os roles de gestão no visibleTo.
    id: "gestao",
    label: "Gestão",
    items: [
      { href: "/equipe", label: "Minha Equipe", icon: "users", visibleTo: ["supervisor", "gerente_regional"] },
      // Gestor de consorcio (M3): ve producao geral + o proprio 10%, nunca a
      // comissao dos promotores.
      { href: "/gestor-consorcio", label: "Consórcio (10%)", icon: "percent", visibleTo: ["gestor_consorcio"] },
    ],
  },
];

const SIDEBAR_STORAGE_KEY = "rr-shell-sidebar-collapsed";

const ROLE_LABEL: Record<string, string> = {
  socio: "Sócio",
  funcionario: "Auxiliar Financeiro",
  promotor: "Promotor",
  supervisor: "Supervisor",
  gerente_regional: "Gerente Regional",
  gestor_consorcio: "Gestor de Consórcio",
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

      <aside className="rr-sidebar">
        {/* Header do sidebar: logo + toggle (fixos no topo) */}
        <div className="rr-sb-head">
          {collapsed ? (
            <BrandLogo size="sm" tone="dark" />
          ) : (
            <BrandLogo size="md" tone="dark" />
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            className="rr-sb-toggle"
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
            <Chevron dir={collapsed ? "right" : "left"} />
          </button>
        </div>

        <div className="rr-sb-divider" />

        {/* So a nav rola; header + divisor ficam fixos */}
        <nav className="rr-sb-nav">
          {visibleNavGroups.map((group) => (
            <section key={group.id} className="rr-sb-group">
              <div className="rr-sb-sect">{group.label}</div>
              <ul className="rr-sb-list">
                {group.items.map((item) => {
                  const active = isItemActive(item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`rr-sb-item${active ? " active" : ""}`}
                        title={collapsed ? item.label : undefined}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="rr-sb-ic">
                          <NavIcon name={item.icon} />
                        </span>
                        <span className="rr-sb-lbl">{item.label}</span>
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
                <MenuIcon />
              </button>
            ) : null}
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
                    <LogoutIcon />
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
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: 20,
    height: 40,
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
    color: "var(--navy)",
    fontSize: 18,
    fontWeight: 700,
    cursor: "pointer",
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
    background: "var(--navy)",
    color: "var(--accent)",
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
    color: "var(--navy)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 200,
  },
  userRole: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--gold)",
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
    color: "var(--navy)",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
};
