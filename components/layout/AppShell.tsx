"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigationItems } from "@/lib/navigation";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const activeItem =
    navigationItems.find((item) =>
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
    ) ?? navigationItems[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <p className="sidebar-eyebrow">Grupo RR Solucoes</p>
          <h1 className="sidebar-title">Sistema RR</h1>
          <p className="sidebar-copy">
            Base de trabalho para producao, fechamento, promotores, auditoria e fluxo de caixa.
          </p>
        </div>

        <nav className="sidebar-nav" aria-label="Menu principal">
          {navigationItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link${isActive ? " active" : ""}`}
              >
                <span className="sidebar-link-label">{item.label}</span>
                <span className="sidebar-link-description">{item.description}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <strong>Fundacao do sistema</strong>
          <span>
            Branch de evolucao segura para transformar o prototipo em uma base profissional.
          </span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-copy">
            <p className="topbar-eyebrow">Modulo ativo</p>
            <h2 className="topbar-title">{activeItem.label}</h2>
          </div>

          <div className="topbar-chip">Stack atual: Next.js + Supabase</div>
        </header>

        <div className="workspace-body">{children}</div>
      </div>
    </div>
  );
}
