"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import BrandLogo from "./BrandLogo";
import { useUser } from "../lib/auth/useUser";

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: string;
};

type NavGroup = {
  id: string;
  label: string;
  description: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    id: "painel",
    label: "Painel",
    description: "Visao executiva e entrada principal",
    items: [
      {
        href: "/",
        label: "Visao geral",
        description: "Entrada principal da operacao e atalhos da plataforma",
        icon: "VG",
      },
      {
        href: "/dashboard",
        label: "Dashboard",
        description: "Visao executiva com previsto, recebido e consolidado",
        icon: "DB",
      },
    ],
  },
  {
    id: "operacao",
    label: "Operacao",
    description: "Carga, producao e conciliacao",
    items: [
      {
        href: "/producao",
        label: "Producao",
        description: "Operacao diaria, consolidacao mensal e carteira ativa",
        icon: "PD",
      },
      {
        href: "/importacoes",
        label: "Importacoes",
        description: "Carga diaria, tabelas mensais e fechamento por empresa",
        icon: "IM",
      },
      {
        href: "/fechamento",
        label: "Fechamento",
        description: "Conciliacao entre a vista, seguro, PRT e estornos",
        icon: "FC",
      },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    description: "Equipe, base cadastral e repasses",
    items: [
      {
        href: "/promotores",
        label: "Promotores",
        description: "Metas, comissoes, descontos e acordos comerciais",
        icon: "PM",
      },
      {
        href: "/cadastros",
        label: "Cadastros",
        description: "Empresas, promotores, Chaves J e parametros estruturais",
        icon: "CD",
      },
    ],
  },
  {
    id: "controle",
    label: "Controle",
    description: "Financeiro, auditoria e governanca",
    items: [
      {
        href: "/financeiro",
        label: "Financeiro",
        description: "Despesas, PRT, saldo inicial e fluxo de caixa",
        icon: "FN",
      },
      {
        href: "/auditoria",
        label: "Auditoria",
        description: "Divergencias, seguranca dos calculos e conferencias",
        icon: "AU",
      },
      {
        href: "/relatorios",
        label: "Relatorios",
        description: "Saidas em PDF e Excel para diretoria e operacao",
        icon: "RL",
      },
      {
        href: "/configuracoes",
        label: "Configuracoes",
        description: "Competencias, perfis de acesso e preferencias gerais",
        icon: "CF",
      },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    description: "Gestao de usuarios e acesso ao sistema",
    items: [
      {
        href: "/admin/usuarios",
        label: "Usuarios",
        description:
          "Criar, ativar, resetar senha e remover usuarios do sistema",
        icon: "US",
      },
    ],
  },
];

const quickItems: NavItem[] = [
  {
    href: "/importacao-diaria",
    label: "Subir producao",
    description: "Enviar a planilha diaria e atualizar propostas",
    icon: "SP",
  },
  {
    href: "/comissoes/editar",
    label: "Ajustar proposta",
    description: "Aplicar excecoes manuais nas comissoes dos promotores",
    icon: "AP",
  },
  {
    href: "/comissoes/produto",
    label: "Regra por produto",
    description: "Configurar repasse por produto e percentual recebido",
    icon: "RP",
  },
];

const initialOpenGroups = {
  painel: true,
  operacao: true,
  comercial: true,
  controle: true,
  admin: false,
  atalhos: false,
};

const SIDEBAR_STORAGE_KEY = "rr-shell-sidebar-collapsed";
const GROUPS_STORAGE_KEY = "rr-shell-open-groups";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useUser();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpenGroups);

  function readStoredSidebarCollapsed() {
    try {
      const storedSidebar = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (storedSidebar === "true") return true;
      if (storedSidebar === "false") return false;
    } catch {
      // Ignore local persistence issues and keep default navigation state.
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
        setSidebarCollapsed(readStoredSidebarCollapsed());
        setMobileOpen(false);
      }
    };

    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    try {
      const storedGroups = window.localStorage.getItem(GROUPS_STORAGE_KEY);

      if (!window.matchMedia("(max-width: 1024px)").matches) {
        setSidebarCollapsed(readStoredSidebarCollapsed());
      }

      if (storedGroups) {
        const parsed = JSON.parse(storedGroups) as Record<string, boolean>;
        setOpenGroups((current) => ({
          ...current,
          ...parsed,
        }));
      }
    } catch {
      // Ignore local persistence issues and keep default navigation state.
    }
  }, []);

  const isItemActive = (item: NavItem) => {
    if (item.href === "/") return pathname === "/";
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  // Grupo "admin" so aparece para socio. Demais grupos sao visiveis a todos
  // os roles autenticados. Durante o loading inicial (user === null), admin
  // fica oculto ate confirmarmos a role.
  const visibleNavGroups = useMemo(
    () =>
      navGroups.filter((g) => g.id !== "admin" || user?.role === "socio"),
    [user?.role]
  );

  const currentItem =
    [...visibleNavGroups.flatMap((group) => group.items), ...quickItems].find(
      (item) => isItemActive(item)
    ) || visibleNavGroups[0]?.items[0] || navGroups[0].items[0];

  const currentGroup = useMemo(
    () =>
      visibleNavGroups.find((group) =>
        group.items.some((item) => isItemActive(item))
      ) || visibleNavGroups[0] || navGroups[0],
    [pathname, visibleNavGroups]
  );

  useEffect(() => {
    setOpenGroups((current) => ({
      ...current,
      [currentGroup.id]: true,
      ...(quickItems.some((item) => isItemActive(item)) ? { atalhos: true } : {}),
    }));

    if (isMobile) {
      setMobileOpen(false);
    }
  }, [pathname, isMobile, currentGroup.id]);

  useEffect(() => {
    if (isMobile) {
      return;
    }

    try {
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEY,
        sidebarCollapsed ? "true" : "false"
      );
    } catch {
      // Ignore persistence failure.
    }
  }, [sidebarCollapsed, isMobile]);

  useEffect(() => {
    try {
      window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(openGroups));
    } catch {
      // Ignore persistence failure.
    }
  }, [openGroups]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = mobileOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobile, mobileOpen]);

  const shellDataset = {
    "data-sidebar-collapsed": sidebarCollapsed ? "true" : "false",
    "data-mobile-open": mobileOpen ? "true" : "false",
  } as const;

  function toggleSidebar() {
    if (isMobile) {
      setMobileOpen((current) => !current);
      return;
    }

    setSidebarCollapsed((current) => !current);
  }

  function toggleGroup(groupId: string) {
    setOpenGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  }

  // Página de login renderiza sem sidebar/header — layout próprio.
  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="rr-shell" {...shellDataset}>
      <button
        type="button"
        className="rr-sidebar-backdrop"
        aria-label="Fechar menu lateral"
        onClick={() => setMobileOpen(false)}
      />

      <aside className="rr-sidebar" style={styles.sidebar}>
        <div style={styles.sidebarInner}>
          <div style={styles.sidebarHeader}>
            <div style={styles.brandPanel}>
              <BrandLogo
                size={sidebarCollapsed ? 56 : 74}
                tone="light"
                subtitle={
                  sidebarCollapsed
                    ? undefined
                    : "Operacao, auditoria, comissoes e financeiro em um unico ambiente"
                }
              />

              {!sidebarCollapsed ? (
                <div style={styles.brandSupportRow}>
                  <span style={styles.brandSupportPill}>Operacao integrada</span>
                  <span style={styles.brandSupportPillMuted}>Menu retratil</span>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={toggleSidebar}
              style={styles.sidebarControl}
              aria-label={sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
              title={sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            >
              {sidebarCollapsed ? ">>" : "<<"}
            </button>
          </div>

          <div style={styles.sidebarMeta}>
            <div style={styles.sidebarMetaLabel}>Estrutura</div>
            <div style={styles.sidebarMetaValue}>
              {sidebarCollapsed ? "RR" : "Menus organizados por area"}
            </div>
          </div>

          <nav style={styles.navWrap}>
            {visibleNavGroups.map((group) => {
              const groupActive = group.items.some((item) => isItemActive(item));
              const groupOpen = sidebarCollapsed ? true : Boolean(openGroups[group.id]);

              return (
                <section key={group.id} style={styles.groupCard}>
                  {!sidebarCollapsed ? (
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      style={{
                        ...styles.groupButton,
                        ...(groupActive ? styles.groupButtonActive : {}),
                      }}
                    >
                      <div>
                        <div style={styles.groupLabel}>{group.label}</div>
                        <div style={styles.groupDescription}>{group.description}</div>
                      </div>
                      <div style={styles.groupControl}>
                        <span style={styles.groupCount}>{group.items.length}</span>
                        <span style={styles.groupChevron}>{groupOpen ? "-" : "+"}</span>
                      </div>
                    </button>
                  ) : null}

                  {groupOpen ? (
                    <div style={styles.navList}>
                      {group.items.map((item) => {
                        const active = isItemActive(item);

                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            title={sidebarCollapsed ? `${item.label} - ${item.description}` : item.label}
                            style={{
                              ...styles.navItem,
                              ...(active ? styles.navItemActive : {}),
                              ...(sidebarCollapsed ? styles.navItemCollapsed : {}),
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

                            {!sidebarCollapsed ? (
                              <span style={styles.navCopy}>
                                <span style={styles.navLabel}>{item.label}</span>
                                <span style={styles.navDescription}>{item.description}</span>
                              </span>
                            ) : null}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </nav>

          <section style={styles.quickPanel}>
            {!sidebarCollapsed ? (
              <button
                type="button"
                onClick={() => toggleGroup("atalhos")}
                style={styles.groupButton}
              >
                <div>
                  <div style={styles.groupLabel}>Atalhos rapidos</div>
                  <div style={styles.groupDescription}>Acoes operacionais frequentes</div>
                </div>
                <span style={styles.groupChevron}>{openGroups.atalhos ? "-" : "+"}</span>
              </button>
            ) : null}

            {(sidebarCollapsed || openGroups.atalhos) && (
              <div style={styles.quickList}>
                {quickItems.map((item) => {
                  const active = isItemActive(item);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={sidebarCollapsed ? `${item.label} - ${item.description}` : item.label}
                      style={{
                        ...styles.quickItem,
                        ...(active ? styles.quickItemActive : {}),
                        ...(sidebarCollapsed ? styles.navItemCollapsed : {}),
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

                      {!sidebarCollapsed ? (
                        <span style={styles.navCopy}>
                          <span style={styles.navLabel}>{item.label}</span>
                          <span style={styles.navDescription}>{item.description}</span>
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </aside>

      <div className="rr-content">
        <header className="rr-topbar" style={styles.topbar}>
          <div
            style={{
              ...styles.topbarLead,
              ...(isMobile ? styles.topbarLeadMobile : {}),
            }}
          >
            <button
              type="button"
              onClick={toggleSidebar}
              style={styles.topbarToggle}
              aria-label={isMobile ? "Abrir menu lateral" : "Alternar menu lateral"}
            >
              {isMobile ? "≡" : sidebarCollapsed ? ">>" : "<<"}
            </button>

            <div style={styles.topbarCopy}>
              <div style={styles.topbarBreadcrumb}>
                <span style={styles.topbarSection}>{currentGroup.label}</span>
                <span style={styles.topbarSeparator}>/</span>
                <span style={styles.topbarTrail}>Grupo RR Cred</span>
              </div>
              <h1 style={styles.topbarTitle}>{currentItem.label}</h1>
              <p style={styles.topbarDescription}>{currentItem.description}</p>
              <div style={styles.topbarPillRow}>
                <span style={styles.topbarPill}>{currentGroup.label}</span>
                <span style={styles.topbarPillMuted}>{currentItem.label}</span>
                <span style={styles.topbarPillMuted}>Workspace local</span>
                {isMobile ? (
                  <span style={styles.topbarPillMuted}>Menu em gaveta</span>
                ) : (
                  <span style={styles.topbarPillMuted}>
                    {sidebarCollapsed ? "Menu recolhido" : "Menu expandido"}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              ...styles.topbarAside,
              ...(isMobile ? styles.topbarAsideMobile : {}),
            }}
          >
            <div style={styles.topbarBadge}>
              <span style={styles.topbarBadgeLabel}>Area ativa</span>
              <strong style={styles.topbarBadgeValue}>{currentGroup.label}</strong>
            </div>
            <div style={styles.topbarBadge}>
              <span style={styles.topbarBadgeLabel}>Itens visiveis</span>
              <strong style={styles.topbarBadgeValue}>{currentGroup.items.length} modulos</strong>
            </div>
            {user ? (
              <div style={styles.userChip} title={user.email}>
                <div style={styles.userInfo}>
                  <span style={styles.userName}>{user.fullName ?? user.email}</span>
                  <span style={styles.userRole}>{user.role}</span>
                </div>
                <form action="/api/auth/logout" method="post" style={styles.userLogoutForm}>
                  <button
                    type="submit"
                    style={styles.userLogoutButton}
                    aria-label="Sair"
                    title="Sair"
                  >
                    ↩
                  </button>
                </form>
              </div>
            ) : null}
            <div style={styles.brandChip}>
              <BrandLogo compact size={34} />
            </div>
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
    padding: "16px 14px",
    background:
      "linear-gradient(180deg, rgba(7,37,125,0.98) 0%, rgba(13,77,227,0.98) 48%, rgba(8,26,89,0.98) 100%)",
    borderRight: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "24px 0 60px rgba(7, 37, 125, 0.12)",
    zIndex: 20,
  },
  sidebarInner: {
    display: "grid",
    gap: "14px",
  },
  sidebarHeader: {
    display: "grid",
    gap: "10px",
  },
  brandPanel: {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: "24px",
    padding: "14px",
    display: "grid",
    gap: "12px",
    backdropFilter: "blur(12px)",
    boxShadow: "0 18px 34px rgba(6, 19, 63, 0.12)",
  },
  brandSupportRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  brandSupportPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "7px 10px",
    borderRadius: "999px",
    background: "rgba(255,240,0,0.14)",
    border: "1px solid rgba(255,240,0,0.18)",
    color: "#fff9d9",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  brandSupportPillMuted: {
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 10px",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: "rgba(255,255,255,0.76)",
    fontSize: "11px",
    fontWeight: 700,
  },
  sidebarControl: {
    height: "38px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.08)",
    color: "#ffffff",
    fontSize: "18px",
    fontWeight: 800,
    cursor: "pointer",
  },
  sidebarMeta: {
    display: "grid",
    gap: "4px",
    padding: "0 2px",
  },
  sidebarMetaLabel: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "rgba(255,255,255,0.6)",
    fontWeight: 700,
  },
  sidebarMetaValue: {
    fontSize: "13px",
    color: "rgba(255,255,255,0.88)",
    lineHeight: 1.45,
  },
  navWrap: {
    display: "grid",
    gap: "10px",
  },
  groupCard: {
    display: "grid",
    gap: "8px",
  },
  groupButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    width: "100%",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "18px",
    background: "rgba(255,255,255,0.04)",
    color: "#ffffff",
    padding: "11px 12px",
    textAlign: "left",
    cursor: "pointer",
  },
  groupControl: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  groupCount: {
    minWidth: "28px",
    height: "28px",
    padding: "0 8px",
    borderRadius: "999px",
    display: "grid",
    placeItems: "center",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.84)",
    fontSize: "11px",
    fontWeight: 800,
  },
  groupButtonActive: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.14)",
  },
  groupLabel: {
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "rgba(255,255,255,0.82)",
    fontWeight: 800,
    marginBottom: "4px",
  },
  groupDescription: {
    fontSize: "12px",
    lineHeight: 1.4,
    color: "rgba(255,255,255,0.62)",
  },
  groupChevron: {
    color: "var(--rr-yellow)",
    fontWeight: 800,
    fontSize: "18px",
  },
  navList: {
    display: "grid",
    gap: "8px",
  },
  navItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "12px 13px",
    borderRadius: "18px",
    textDecoration: "none",
    color: "#f9fbff",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.08)",
    minWidth: 0,
  },
  navItemCollapsed: {
    justifyContent: "center",
    alignItems: "center",
    padding: "12px 8px",
  },
  navItemActive: {
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.98) 0%, rgba(214,161,63,0.92) 100%)",
    color: "var(--rr-blue-deep)",
    border: "1px solid rgba(255,240,0,0.92)",
    boxShadow: "0 16px 32px rgba(214, 161, 63, 0.22)",
  },
  navIcon: {
    width: "34px",
    minWidth: "34px",
    height: "34px",
    borderRadius: "12px",
    display: "grid",
    placeItems: "center",
    background: "rgba(255,255,255,0.12)",
    color: "#ffffff",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
  },
  navIconActive: {
    background: "rgba(7,37,125,0.1)",
    color: "var(--rr-blue-deep)",
  },
  navCopy: {
    display: "grid",
    gap: "4px",
    minWidth: 0,
  },
  navLabel: {
    fontSize: "14px",
    fontWeight: 800,
    fontFamily: "var(--font-heading)",
  },
  navDescription: {
    fontSize: "12px",
    lineHeight: 1.42,
    opacity: 0.88,
  },
  quickPanel: {
    marginTop: "2px",
    display: "grid",
    gap: "8px",
    paddingTop: "4px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
  },
  quickList: {
    display: "grid",
    gap: "8px",
  },
  quickItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "12px 13px",
    borderRadius: "18px",
    textDecoration: "none",
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.14) 0%, rgba(255,255,255,0.08) 100%)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#ffffff",
  },
  quickItemActive: {
    background:
      "linear-gradient(135deg, rgba(255,240,0,0.98) 0%, rgba(214,161,63,0.92) 100%)",
    color: "var(--rr-blue-deep)",
    border: "1px solid rgba(255,240,0,0.92)",
  },
  topbar: {
    margin: "10px 18px 0",
    padding: "16px 20px 14px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "18px",
    flexWrap: "wrap",
    background: "linear-gradient(135deg, rgba(255,255,255,0.88) 0%, rgba(248,251,255,0.92) 100%)",
    backdropFilter: "blur(18px)",
    border: "1px solid rgba(13,77,227,0.1)",
    borderRadius: "24px",
    boxShadow: "var(--rr-shadow-soft)",
  },
  topbarLead: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    minWidth: 0,
    flex: 1,
  },
  topbarLeadMobile: {
    width: "100%",
  },
  topbarToggle: {
    width: "42px",
    minWidth: "42px",
    height: "42px",
    borderRadius: "14px",
    border: "1px solid var(--rr-line)",
    background: "rgba(255,255,255,0.92)",
    color: "var(--rr-blue-deep)",
    fontSize: "18px",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "var(--rr-shadow-soft)",
  },
  topbarCopy: {
    display: "grid",
    gap: "4px",
    minWidth: 0,
  },
  topbarBreadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  topbarSection: {
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.16em",
    color: "var(--rr-blue)",
    fontWeight: 800,
  },
  topbarSeparator: {
    color: "var(--rr-line-strong)",
    fontWeight: 700,
  },
  topbarTrail: {
    fontSize: "12px",
    color: "var(--rr-muted)",
    fontWeight: 600,
  },
  topbarTitle: {
    margin: 0,
    fontSize: "clamp(1.65rem, 2.4vw, 2.45rem)",
    color: "var(--rr-ink)",
    lineHeight: 1.02,
  },
  topbarDescription: {
    margin: 0,
    maxWidth: 760,
    fontSize: "14px",
    lineHeight: 1.6,
    color: "var(--rr-muted)",
  },
  topbarPillRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "6px",
  },
  topbarPill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 10px",
    borderRadius: "999px",
    background: "rgba(13,77,227,0.08)",
    border: "1px solid rgba(13,77,227,0.14)",
    color: "var(--rr-blue-deep)",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  topbarPillMuted: {
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 10px",
    borderRadius: "999px",
    background: "rgba(13,77,227,0.04)",
    border: "1px solid rgba(13,77,227,0.08)",
    color: "var(--rr-muted)",
    fontSize: "11px",
    fontWeight: 700,
  },
  topbarAside: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
  topbarAsideMobile: {
    width: "100%",
    justifyContent: "space-between",
  },
  topbarBadge: {
    display: "grid",
    gap: "4px",
    padding: "11px 13px",
    borderRadius: "18px",
    background: "rgba(255,255,255,0.94)",
    border: "1px solid rgba(13,77,227,0.1)",
    boxShadow: "var(--rr-shadow-soft)",
  },
  topbarBadgeLabel: {
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    color: "var(--rr-muted)",
    fontWeight: 700,
  },
  topbarBadgeValue: {
    fontSize: "13px",
    color: "var(--rr-blue-deep)",
    fontWeight: 800,
  },
  brandChip: {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(13,77,227,0.1)",
    borderRadius: "20px",
    padding: "8px 12px",
    boxShadow: "var(--rr-shadow-soft)",
  },
  userChip: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 20,
    background: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(13,77,227,0.12)",
    boxShadow: "var(--rr-shadow-soft)",
    maxWidth: 280,
  },
  userInfo: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  userName: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--rr-ink)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 200,
  },
  userRole: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--rr-muted)",
  },
  userLogoutForm: {
    margin: 0,
    display: "inline-flex",
  },
  userLogoutButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    border: "1px solid rgba(13,77,227,0.18)",
    background: "linear-gradient(135deg, rgba(13,77,227,0.08) 0%, rgba(255,240,0,0.10) 100%)",
    color: "var(--rr-blue-deep)",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "transform 120ms ease",
  },
};
