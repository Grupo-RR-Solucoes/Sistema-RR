import type { ReactNode } from "react";

export type ChipVariant = "ok" | "warn" | "risk" | "neutral";

export interface ChipProps {
  /** ok (verde) | warn (âmbar) | risk (vermelho) | neutral (padrão). */
  variant?: ChipVariant;
  children?: ReactNode;
  /** Mostra a bolinha de status à esquerda (padrão true). */
  dot?: boolean;
  className?: string;
}

export default function Chip({
  variant = "neutral",
  children,
  dot = true,
  className,
}: ChipProps) {
  const cls = ["rrui-chip", `rrui-chip--${variant}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      {dot ? <span className="rrui-chip__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
