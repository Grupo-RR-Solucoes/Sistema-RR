"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import BrandLogo from "./BrandLogo";
import TopNav, { Glyph, LOGOUT_PATH, NavIcon, type TopNavItem } from "./TopNav";
import { useUser } from "../lib/auth/useUser";
import type { UserRole } from "../lib/auth/types";

// ============================================================================
// SHELL — barra do topo (permanente) + drawer sob demanda + conteudo.
//
// A sidebar lateral fixa saiu: a marca vive agora SO na barra, sempre visivel,
// e o menu completo mora num drawer. Ganho medido: +220px de largura util na
// maioria dos viewports, por 15px de altura permanente a mais.
//
// O DRAWER NAO E NOVO. E a sidebar mobile de sempre (position:fixed,
// translateX(-100%), backdrop, Escape, trava de scroll) PROMOVIDA para todos os
// breakpoints. A mecanica ja estava escrita e rodando em producao; aqui ela
// so deixou de ser exclusiva do <=1024px.
// ============================================================================

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
      // Mesma tela de /produtos/atribuicao, com escopo RESTRITO a CONSORCIO (o guard
      // da rota decide). Fica aqui, no grupo Gestao, porque o item de Admin nao e
      // visivel para ele.
      { href: "/produtos/atribuicao", label: "Atribuir consórcio", icon: "clipboard", visibleTo: ["gestor_consorcio"] },
    ],
  },
];

/**
 * OS 6 DA BARRA — destinos frequentes. O resto vai para o drawer.
 *
 * Ordem = a da barra. O filtro por papel continua sendo o visibleTo de cada
 * item; isto aqui so escolhe QUAIS dos visiveis sobem para a barra. Papel com
 * poucos destinos (promotor 2, supervisor 1, gestor_consorcio 2) nao tem nada
 * fora desta lista, entao nem ve hamburguer.
 */
const NAV_BARRA = [
  "/dashboard",
  "/promotores",
  "/projecao",
  "/financeiro",
  "/fechamento",
  "/auditoria",
] as const;

/**
 * Chave morta da sidebar retratil. A sidebar nao recolhe mais (drawer e
 * aberto/fechado, nao expandido/recolhido), mas a chave esta gravada no browser
 * de todo usuario que usou o sistema. Limpamos uma vez, no mount.
 */
const LEGACY_SIDEBAR_KEY = "rr-shell-sidebar-collapsed";

/** Rotas publicas: renderizam SEM navegacao em volta. */
const ROTAS_SEM_SHELL = ["/login", "/definir-senha"];

const ROLE_LABEL: Record<string, string> = {
  socio: "Sócio",
  funcionario: "Auxiliar Financeiro",
  promotor: "Promotor",
  supervisor: "Supervisor",
  gerente_regional: "Gerente Regional",
  gestor_consorcio: "Gestor de Consórcio",
};

const CLOSE_PATH = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useUser();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Limpeza da chave legada da sidebar retratil (ver LEGACY_SIDEBAR_KEY).
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_SIDEBAR_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Trava o scroll do body enquanto o drawer esta aberto.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Navegou => fecha o drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const isItemActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

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

  const visibleItems = useMemo(
    () => visibleNavGroups.flatMap((g) => g.items),
    [visibleNavGroups]
  );

  /**
   * O QUE VAI PARA A BARRA.
   *
   * NAV_BARRA e lista de PREFERENCIA, nao lista de permissao: ela so decide o
   * corte quando o papel tem MAIS destinos do que cabem. Quem tem ate
   * NAV_BARRA.length destinos ve TODOS na barra, e ai nao ha hamburguer.
   *
   * Sem essa distincao, papeis cujos destinos nao estao entre os 6 escolhidos
   * (supervisor -> /equipe, gestor_consorcio -> /gestor-consorcio) ficariam com
   * a BARRA VAZIA e o unico destino escondido atras do hamburguer — o pior
   * resultado possivel justamente para quem tem menos a navegar.
   */
  const barItems: TopNavItem[] = useMemo(() => {
    if (visibleItems.length <= NAV_BARRA.length) return visibleItems;
    const porHref = new Map(visibleItems.map((i) => [i.href, i]));
    const preferidos = NAV_BARRA.map((href) => porHref.get(href)).filter(
      (i): i is NavItem => i != null
    );
    // COMPLETA ATE 6 na ordem de declaracao dos grupos. Sem isso o funcionario
    // (10 destinos, mas so 2 entre os preferidos — Dashboard, Financeiro,
    // Fechamento e Auditoria sao socio-only) ficaria com a barra quase vazia e
    // 8 itens escondidos, justamente o segundo papel mais ativo do sistema.
    const naBarra = new Set(preferidos.map((i) => i.href));
    const resto = visibleItems.filter((i) => !naBarra.has(i.href));
    return [...preferidos, ...resto.slice(0, NAV_BARRA.length - preferidos.length)];
  }, [visibleItems]);

  // Hamburguer CONDICIONAL: so quando ha destino que a barra nao mostra.
  const showHamburger = useMemo(() => {
    const naBarra = new Set(barItems.map((i) => i.href));
    return visibleItems.some((i) => !naBarra.has(i.href));
  }, [visibleItems, barItems]);

  // Rotas publicas renderizam sem shell.
  if (ROTAS_SEM_SHELL.includes(pathname)) {
    return <>{children}</>;
  }

  const avatarInitial =
    (user?.fullName ?? user?.email ?? "?").trim().charAt(0).toUpperCase();

  const logoutAction = (
    <form action="/api/auth/logout" method="post" className="rr-nav__logoutform">
      <button
        type="submit"
        className="rr-nav__logout"
        aria-label="Sair"
        title="Sair"
      >
        <Glyph d={LOGOUT_PATH} size={16} />
      </button>
    </form>
  );

  return (
    <div className="rr-shell" data-drawer-open={drawerOpen ? "true" : "false"}>
      <TopNav
        items={barItems}
        showHamburger={showHamburger}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((c) => !c)}
        isActive={isItemActive}
        userName={user ? user.fullName ?? user.email : null}
        userRoleLabel={user ? ROLE_LABEL[user.role] ?? user.role : null}
        avatarInitial={avatarInitial}
        logoutAction={logoutAction}
      />

      <button
        type="button"
        className="rr-sidebar-backdrop"
        aria-label="Fechar menu"
        tabIndex={drawerOpen ? 0 : -1}
        onClick={() => setDrawerOpen(false)}
      />

      {/* DRAWER — a sidebar de sempre, agora sob demanda em todo breakpoint.
          Mostra o menu COMPLETO (inclusive os 6 que ja estao na barra), para
          quem abre o menu nao ter de lembrar onde cada destino mora. */}
      <aside
        className="rr-sidebar"
        aria-hidden={drawerOpen ? undefined : true}
        aria-label="Menu completo"
      >
        <div className="rr-sb-head">
          <BrandLogo size="md" tone="dark" />
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="rr-sb-toggle"
            aria-label="Fechar menu"
            title="Fechar menu"
          >
            <Glyph d={CLOSE_PATH} size={16} />
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
                  const active = isItemActive(item.href);
                  return (
                    <li key={`${group.id}-${item.href}`}>
                      <Link
                        href={item.href}
                        className={`rr-sb-item${active ? " active" : ""}`}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                        tabIndex={drawerOpen ? 0 : -1}
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

      <main className="rr-main">
        <div className="rr-main-shell">{children}</div>
      </main>
    </div>
  );
}
