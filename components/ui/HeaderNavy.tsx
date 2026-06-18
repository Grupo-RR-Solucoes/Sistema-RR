import type { ReactNode } from "react";

export interface HeaderNavyProps {
  /** Eyebrow acima do título (ex.: "GRUPO RR CRED") — renderizado em var(--accent). */
  brand?: ReactNode;
  /** Título principal (<h1>). */
  title: ReactNode;
  /** Lead/descrição opcional abaixo do título. */
  subtitle?: ReactNode;
  /** Chip à direita (ex.: período + dot). Aceita <Chip> ou markup custom. */
  badge?: ReactNode;
  /** Controles à direita: select de competência, abas, botões. */
  actions?: ReactNode;
  /** Linha dourada no topo (default true). */
  goldLine?: boolean;
  /** Área de stats abaixo do divisor: <KpiBand> ou <KpiHero>. Opcional (Relatórios não tem). */
  children?: ReactNode;
  className?: string;
}

/**
 * Bloco navy do topo das telas (marca + título + badge/ações + linha dourada),
 * com os KPIs embutidos via children (<KpiBand>/<KpiHero>). Consolida o padrão
 * `.header` navy que hoje vive duplicado em cada página. Escopo `.rrui-hnavy`.
 */
export default function HeaderNavy({
  brand,
  title,
  subtitle,
  badge,
  actions,
  goldLine = true,
  children,
  className,
}: HeaderNavyProps) {
  const cls = ["rrui-hnavy", goldLine ? "" : "rrui-hnavy--noline", className]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={cls}>
      <div className="rrui-hnavy__top">
        <div className="rrui-hnavy__head">
          {brand != null ? <p className="rrui-hnavy__brand">{brand}</p> : null}
          <h1 className="rrui-hnavy__title">{title}</h1>
          {subtitle != null ? (
            <p className="rrui-hnavy__subtitle">{subtitle}</p>
          ) : null}
        </div>
        {badge != null || actions != null ? (
          <div className="rrui-hnavy__aside">
            {badge}
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
