import type { ReactNode } from "react";

export interface HeaderNavyProps {
  /**
   * Eyebrow acima do título — renderizado em var(--accent).
   *
   * É rótulo de CONTEXTO, não marca: "SEGURIDADE", "AUDITORIA", "MONITOR PRT",
   * "GESTOR CONSÓRCIO". A prop se chamava `brand` e o nome mentia — a marca do
   * grupo passa a viver só na barra do topo, permanente, e sai daqui.
   */
  eyebrow?: ReactNode;
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
 * Bloco navy do topo das telas (eyebrow + título + badge/ações + linha dourada),
 * com os KPIs embutidos via children (<KpiBand>/<KpiHero>). Consolida o padrão
 * `.header` navy que hoje vive duplicado em cada página. Escopo `.rrui-hnavy`.
 */
export default function HeaderNavy({
  eyebrow,
  title,
  subtitle,
  badge,
  actions,
  goldLine = true,
  children,
  className,
}: HeaderNavyProps) {
  // FASE 4 — sem eyebrow, o titulo vira o primeiro elemento do bloco e sobe
  // ~21px (11,5px de fonte a line-height normal + 7px de margem). O padding de
  // 30px no topo foi calibrado para um bloco que comecava com o eyebrow: com o
  // titulo de 27px encostando nele, sobra menos ar em cima (30px) do que
  // embaixo (34px), e o bloco fica visualmente desequilibrado.
  //
  // O modificador reequilibra em 34/34. NAO devolve os 21px — o bloco ainda
  // encolhe 17px, que e o ganho da fase; so tira o aperto.
  //
  // As 8 telas que mantem eyebrow SEMANTICO (SEGURIDADE, AUDITORIA, MONITOR
  // PRT, ...) nao recebem a classe e ficam exatamente como estavam.
  const cls = [
    "rrui-hnavy",
    goldLine ? "" : "rrui-hnavy--noline",
    eyebrow == null ? "rrui-hnavy--sem-eyebrow" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={cls}>
      <div className="rrui-hnavy__top">
        <div className="rrui-hnavy__head">
          {eyebrow != null ? <p className="rrui-hnavy__eyebrow">{eyebrow}</p> : null}
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
