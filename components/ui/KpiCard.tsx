import type { ReactNode } from "react";

export type KpiVariant = "normal" | "destaque" | "alerta";

export interface KpiCardProps {
  label: ReactNode;
  /** Valor — renderizado em IBM Plex Mono (var(--font-mono)), tabular. */
  value: ReactNode;
  sublabel?: ReactNode;
  /**
   * normal (padrão) | destaque (barra 4px var(--accent) à esquerda + valor
   * maior em navy) | alerta (fundo warn).
   */
  variant?: KpiVariant;
  className?: string;
}

const VARIANT_CLASS: Record<KpiVariant, string> = {
  normal: "",
  destaque: "rrui-kpi--destaque",
  alerta: "rrui-kpi--alerta",
};

export default function KpiCard({
  label,
  value,
  sublabel,
  variant = "normal",
  className,
}: KpiCardProps) {
  const cls = ["rrui-kpi", VARIANT_CLASS[variant], className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <span className="rrui-kpi__label">{label}</span>
      <span className="rrui-kpi__value">{value}</span>
      {sublabel != null ? (
        <span className="rrui-kpi__sub">{sublabel}</span>
      ) : null}
    </div>
  );
}
