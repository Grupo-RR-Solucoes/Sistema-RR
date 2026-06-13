import type { ReactNode } from "react";

export type CardVariant = "neutro" | "navy" | "gold";

export interface CardProps {
  /** Título opcional (renderiza o cabeçalho uppercase do card). */
  title?: ReactNode;
  /** neutro (padrão) | navy (fundo escuro) | gold (borda esquerda dourada). */
  variant?: CardVariant;
  children?: ReactNode;
  /** Classe extra opcional (ex.: grid span da página). */
  className?: string;
}

const VARIANT_CLASS: Record<CardVariant, string> = {
  neutro: "",
  navy: "rrui-card--navy",
  gold: "rrui-card--gold",
};

export default function Card({
  title,
  variant = "neutro",
  children,
  className,
}: CardProps) {
  const cls = ["rrui-card", VARIANT_CLASS[variant], className]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={cls}>
      {title != null ? <div className="rrui-card__title">{title}</div> : null}
      <div className="rrui-card__body">{children}</div>
    </section>
  );
}
