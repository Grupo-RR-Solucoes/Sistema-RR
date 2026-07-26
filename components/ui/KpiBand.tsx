import type { CSSProperties, ReactNode } from "react";

import type { ResultadoDelta } from "@/lib/delta/calcularDelta";
import DeltaBadge from "./DeltaBadge";

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
  /**
   * Variacao vs mes anterior. Recebe o resultado de lib/delta/calcularDelta e
   * renderiza o <DeltaBadge/> entre o valor e o sub.
   *
   * SLOT PROPRIO de proposito: todo stat do sistema ja usa `sub` para outra
   * informacao (rotulo de fonte, link de pendencia, "do qual..."). Empilhar o
   * delta dentro do `sub` obrigaria cada tela a remontar o texto — e a conta
   * voltaria a ser feita fora do helper canonico.
   *
   * O proprio badge some quando nao ha comparacao honesta (M-1 zero/ausente),
   * entao a tela pode passar o delta sem condicional.
   */
  delta?: ResultadoDelta;
}

export interface KpiBandProps {
  items: KpiStat[];
  /** Nº de colunas (default = items.length). Colapsa 4→2→1 no responsivo. */
  columns?: number;
  /** Tamanho do valor em px (default 30). Mantém o tamanho original de cada tela. */
  valueSize?: number;
}

/**
 * Faixa multi-stat embutida no bloco navy: N stats (label claro + valor branco
 * em Mono + sub) separados por divisórias verticais. Use DENTRO de <HeaderNavy>.
 * Escopo `.rrui-kpiband`.
 */
export default function KpiBand({ items, columns, valueSize }: KpiBandProps) {
  const cols = columns ?? items.length;
  const style = {
    ["--kpi-cols"]: String(cols),
    ...(valueSize != null ? { ["--kpi-value"]: `${valueSize}px` } : {}),
  } as CSSProperties;
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
          {s.delta ? (
            <div className="rrui-kpiband__delta">
              <DeltaBadge delta={s.delta} />
            </div>
          ) : null}
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
