import type { CSSProperties, ReactNode } from "react";

export type KpiHeroTone = "white" | "gold";
export type Semaforo = "ok" | "warn" | "risk";

export interface KpiHeroMeter {
  /** 0..1 (clampeado). Largura da barra de preenchimento. */
  percent: number;
  /** Cor da barra: var(--ok) | var(--warn) | var(--risk). */
  semaforo: Semaforo;
  caption?: ReactNode;
}

export interface KpiHeroProps {
  label: ReactNode;
  /** Nº grande dominante — renderizado em var(--font-mono), tabular. */
  value: ReactNode;
  /** white = #fff (Receitas) | gold = var(--gold) (Auditoria). */
  valueTone?: KpiHeroTone;
  sub?: ReactNode;
  /** Barra semáforo opcional (Receitas). */
  meter?: KpiHeroMeter;
  className?: string;
}

/**
 * Indicador único grande embutido no bloco navy (hero). Use DENTRO de
 * <HeaderNavy>. Escopo `.rrui-kpihero`.
 */
export default function KpiHero({
  label,
  value,
  valueTone = "white",
  sub,
  meter,
  className,
}: KpiHeroProps) {
  const cls = ["rrui-kpihero", `rrui-kpihero--${valueTone}`, className]
    .filter(Boolean)
    .join(" ");
  const fillStyle: CSSProperties | undefined = meter
    ? { width: `${Math.max(0, Math.min(1, meter.percent)) * 100}%` }
    : undefined;
  return (
    <div className={cls}>
      <p className="rrui-kpihero__label">{label}</p>
      <div className="rrui-kpihero__value">{value}</div>
      {sub != null ? <div className="rrui-kpihero__sub">{sub}</div> : null}
      {meter ? (
        <>
          <div className={`rrui-kpihero__meter rrui-kpihero__meter--${meter.semaforo}`}>
            <div className="rrui-kpihero__meter-fill" style={fillStyle} />
          </div>
          {meter.caption != null ? (
            <div className="rrui-kpihero__meter-cap">{meter.caption}</div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
