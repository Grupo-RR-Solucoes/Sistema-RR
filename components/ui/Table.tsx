import type { ReactNode, TdHTMLAttributes } from "react";

export interface TableProps {
  children?: ReactNode;
  /** Aplica o modo viewport-bound (thead sticky + scroll interno) do globals.css. */
  scrollable?: boolean;
  className?: string;
}

/**
 * Tabela densa do kit (ftable). Composição por markup nativo (thead/tbody/tfoot)
 * — mais flexível para as tabelas financeiras existentes (colspans, ColumnFilter,
 * células customizadas) do que uma API colunas+dados rígida.
 *
 * - thead th: neutro, uppercase (estilizado pela CSS do kit).
 * - tbody: linhas zebradas + hover.
 * - tfoot td: total com barra 4px var(--accent) no topo (automático).
 * - Reaproveita o wrapper `.rr-table-wrap` do globals.css (scroll horizontal).
 *
 * Use <Num> para células numéricas (IBM Plex Mono, alinhadas à direita, tabular).
 */
export function Table({ children, scrollable, className }: TableProps) {
  const wrap = [
    "rr-table-wrap",
    scrollable ? "rr-table-wrap--scrollable" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={wrap}>
      <table className="rrui-table">{children}</table>
    </div>
  );
}

/** Célula numérica: IBM Plex Mono, alinhada à direita, tabular-nums. */
export function Num({
  children,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement>) {
  const cls = ["rrui-table__num", className].filter(Boolean).join(" ");
  return (
    <td className={cls} {...rest}>
      {children}
    </td>
  );
}
