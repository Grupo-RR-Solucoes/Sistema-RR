import type { CSSProperties, ReactNode } from "react";

export type KpiSubTone = "gold" | "amber" | "ok" | "neutral";

export interface KpiStat {
  label: ReactNode;
  /** Valor — renderizado em var(--font-mono), tabular, branco. */
  value: ReactNode;
  /** Sublabel opcional (aceita link/markup custom). */
  sub?: ReactNode;
  /**
   * Cor do sublabel (legível sobre navy): gold = var(--gold) | amber =
   * var(--gold-soft) | ok = var(--ok-soft) | neutral (default) = branco translúcido.
   * Os semânticos escuros do kit (--warn/--ok) não entram aqui (ilegíveis no navy).
   */
  subTone?: KpiSubTone;
  /** Destaca este stat com realce var(--accent) (#FFF000). */
  accent?: boolean;
}

export interface KpiBandProps {
  items: KpiStat[];
  /** Nº de colunas (default = items.length). Colapsa 4→2→1 no responsivo. */
  columns?: number;
}

/**
 * Faixa multi-stat embutida no bloco navy: N stats (label claro + valor branco
 * em Mono + sub) separados por divisórias verticais. Use DENTRO de <HeaderNavy>.
 * Escopo `.rrui-kpiband`.
 */
export default function KpiBand({ items, columns }: KpiBandProps) {
  const cols = columns ?? items.length;
  const style = { ["--kpi-cols"]: String(cols) } as CSSProperties;
  return (
    <div className="rrui-kpiband" style={style}>
      {items.map((s, i) => (
        <div
          key={i}
          className={
            "rrui-kpiband__stat" + (s.accent ? " rrui-kpiband__stat--accent" : "")
          }
        >
          <p className="rrui-kpiband__label">{s.label}</p>
          <div className="rrui-kpiband__value">{s.value}</div>
          {s.sub != null ? (
            <div
              className={
                "rrui-kpiband__sub" +
                (s.subTone && s.subTone !== "neutral"
                  ? ` rrui-kpiband__sub--${s.subTone}`
                  : "")
              }
            >
              {s.sub}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
