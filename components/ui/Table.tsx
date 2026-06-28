import type { ReactNode, TdHTMLAttributes } from "react";

export interface TableProps {
  children?: ReactNode;
  /**
   * Modo viewport-bound: o wrapper vira uma "janela" com altura limitada
   * (max-height) e scroll vertical interno, e o <thead> fica STICKY no topo
   * dela. Sem isto a tabela cresce com a página e o cabeçalho some ao rolar.
   */
  scrollable?: boolean;
  /**
   * min-width da <table> (px). Garante o scroll HORIZONTAL: quando a viewport
   * é menor que minWidth, o .rr-table-wrap (overflow-x:auto) mostra a barra.
   * Sem min-width a tabela encolhe pra caber e o scroll nunca dispara.
   * Default: 720.
   */
  minWidth?: number;
  /**
   * Só no modo scrollable: desconto (px) na altura da janela —
   * max-height: calc(100vh - {maxHeightOffset}px). Telas com barras de ação
   * fixas (ex.: /comissoes/editar) precisam de offset maior. Default: 240.
   */
  maxHeightOffset?: number;
  className?: string;
}

const DEFAULT_MIN_WIDTH = 720;
const DEFAULT_MAX_HEIGHT_OFFSET = 240;

/**
 * Tabela densa do kit (ftable). Composição por markup nativo (thead/tbody/tfoot)
 * — flexível para colspans, filtros e células customizadas.
 *
 * Recursos:
 *  - `scrollable`  → janela com altura + thead STICKY no topo (vertical).
 *  - `minWidth`    → scroll HORIZONTAL quando a tabela estoura a largura.
 *  - `maxHeightOffset` → calibra a altura da janela (scrollable).
 *  - 1ª coluna fixa (horizontal): marque os <th>/<td> da coluna com a
 *    className "rr-sticky-col" (position:sticky;left:0 + z-index/bg corretos no
 *    CSS). Funciona junto com o thead sticky — ver hierarquia de z-index no
 *    globals.css.
 *
 * O CSS vive em app/globals.css (.rr-table-wrap / --scrollable / .rr-sticky-col)
 * e components/ui/uiCss.ts (.rrui-table). Use <Num> para células numéricas.
 *
 * @example
 *   // Tabela larga (despesas), com cabeçalho fixo e 1ª coluna congelada:
 *   <Table scrollable minWidth={920}>
 *     <thead><tr>
 *       <th className="rr-sticky-col">Descrição</th>
 *       <th>Empresa</th> … <th>Ações</th>
 *     </tr></thead>
 *     <tbody>
 *       {rows.map((r) => (
 *         <tr key={r.id}>
 *           <td className="rr-sticky-col">{r.descricao}</td>
 *           <td>{r.empresa}</td> … <Num>{r.valor}</Num>
 *         </tr>
 *       ))}
 *     </tbody>
 *   </Table>
 */
export function Table({
  children,
  scrollable,
  minWidth = DEFAULT_MIN_WIDTH,
  maxHeightOffset = DEFAULT_MAX_HEIGHT_OFFSET,
  className,
}: TableProps) {
  const wrap = [
    "rr-table-wrap",
    scrollable ? "rr-table-wrap--scrollable" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  // max-height inline só no modo scrollable (sobrepõe o default do CSS).
  const wrapStyle = scrollable
    ? { maxHeight: `calc(100vh - ${maxHeightOffset}px)` }
    : undefined;
  return (
    <div className={wrap} style={wrapStyle}>
      <table className="rrui-table" style={{ minWidth }}>
        {children}
      </table>
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
