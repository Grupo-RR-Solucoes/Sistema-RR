import type { CSSProperties, ReactNode } from "react";

export type KpiHeroTone = "white" | "gold";
export type Semaforo = "ok" | "warn" | "risk";

export interface KpiHeroMeter {
  /** 0..1 (clampeado). Largura da barra. */
  percent: number;
  /** Cor da barra: gradiente saturado→soft (var(--sem-X) → X-soft). */
  semaforo: Semaforo;
  /** Legenda abaixo da barra (ex.: escala "R$ 0 … teto"). Aceita N spans. */
  caption?: ReactNode;
}

export interface KpiHeroSecondary {
  /** Valor grande à direita (ex.: % do teto em Receitas). */
  value: ReactNode;
  /** Cor (soft, legível sobre navy): ok=--ok-soft | warn=--gold-soft | risk=--risk-soft. */
  tone?: Semaforo;
  /** Legenda opcional sob o valor secundário. */
  label?: ReactNode;
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
  // ---- aditivos (two-column / heroes ricos) ----
  /** Sufixo no valor, ex.: "/ R$ 4,80MM" (Receitas). Renderiza como <small>. */
  valueSuffix?: ReactNode;
  /** Bolinha semáforo (saturada + glow) antes do label (Receitas). */
  labelDot?: Semaforo;
  /** Parágrafo lateral à direita (Auditoria). */
  aside?: ReactNode;
  /** Valor grande à direita + legenda (Receitas). */
  secondary?: KpiHeroSecondary;
  /** Tamanho do valor em px (default 42). Auditoria=52, Receitas=42. */
  valueSize?: number;
}

/**
 * Indicador grande embutido no bloco navy (hero). Use DENTRO de <HeaderNavy>.
 * Sem os props aditivos, layout vertical idêntico ao original (label/value/sub/meter).
 * Com `aside`/`secondary`, vira two-column (número à esquerda, aside/secondary à
 * direita). Escopo `.rrui-kpihero`.
 */
export default function KpiHero({
  label,
  value,
  valueTone = "white",
  sub,
  meter,
  className,
  valueSuffix,
  labelDot,
  aside,
  secondary,
  valueSize,
}: KpiHeroProps) {
  const cls = ["rrui-kpihero", `rrui-kpihero--${valueTone}`, className]
    .filter(Boolean)
    .join(" ");
  const rootStyle: CSSProperties | undefined =
    valueSize != null
      ? ({ ["--hero-value"]: `${valueSize}px` } as CSSProperties)
      : undefined;
  const fillStyle: CSSProperties | undefined = meter
    ? { width: `${Math.max(0, Math.min(1, meter.percent)) * 100}%` }
    : undefined;
  const hasSide = aside != null || secondary != null;
  return (
    <div className={cls} style={rootStyle}>
      <div className="rrui-kpihero__row">
        <div className="rrui-kpihero__main">
          <p className="rrui-kpihero__label">
            {labelDot ? (
              <span
                className={`rrui-kpihero__dot rrui-kpihero__dot--${labelDot}`}
                aria-hidden="true"
              />
            ) : null}
            {label}
          </p>
          <div className="rrui-kpihero__value">
            {value}
            {valueSuffix != null ? (
              <small className="rrui-kpihero__suffix">{valueSuffix}</small>
            ) : null}
          </div>
          {sub != null ? <div className="rrui-kpihero__sub">{sub}</div> : null}
        </div>
        {hasSide ? (
          <div className="rrui-kpihero__side">
            {secondary ? (
              <div className="rrui-kpihero__secondary">
                <div
                  className={
                    "rrui-kpihero__secondary-value" +
                    (secondary.tone
                      ? ` rrui-kpihero__secondary-value--${secondary.tone}`
                      : "")
                  }
                >
                  {secondary.value}
                </div>
                {secondary.label != null ? (
                  <div className="rrui-kpihero__secondary-label">
                    {secondary.label}
                  </div>
                ) : null}
              </div>
            ) : null}
            {aside != null ? (
              <p className="rrui-kpihero__aside">{aside}</p>
            ) : null}
          </div>
        ) : null}
      </div>
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
