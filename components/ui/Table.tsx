import type { CSSProperties, ReactNode, TdHTMLAttributes } from "react";

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
   *
   * NÃO vira mais `style={{minWidth}}`: sai como a variável --tbl-min, lida por
   * `.rrui-table{min-width:var(--tbl-min,720px)}` (uiCss.ts). Como propriedade
   * inline ela era inalcançável — nenhuma media query conseguia zerá-la no
   * telefone. Como variável, a regra de 560px sobrescreve a PROPRIEDADE e o
   * inline deixa de mandar. Mesmo mecanismo do --kpi-cols do KpiBand.
   */
  minWidth?: number;
  /**
   * Só no modo scrollable: desconto (px) na altura da janela —
   * max-height: calc(100vh - {maxHeightOffset}px).
   *
   * OMITIR é o normal: sem este prop a janela vem do CSS
   * (.rr-table-wrap--scrollable → calc(100vh - var(--chrome-offset))), que é a
   * fonte ÚNICA da altura do chrome. Antes o default era um 240 repetido aqui,
   * que duplicava o valor do CSS — dois lugares para manter em sincronia, e o
   * inline sempre ganhando.
   *
   * Passe um número só quando a tela tiver chrome EXTRA que o token não conhece
   * (ex.: uma barra de ação fixa no rodapé). Hoje nenhuma passa.
   */
  maxHeightOffset?: number;
  /**
   * MODO CARTÃO no telefone (<=560px): cada <tr> do corpo vira um cartão
   * empilhado, o <thead> some e cada <td> mostra o próprio rótulo. OPT-IN —
   * tabela sem a prop continua idêntica ao que era (rolagem lateral).
   *
   * EXIGE `data-l="<rótulo da coluna>"` em CADA <td>: é o attr(data-l) do
   * ::before que substitui o cabeçalho escondido. Sem o atributo o cartão sai
   * sem rótulo — a célula não some, mas fica sem contexto.
   *
   * O padrão não é novo: é o de app/promotores (PromotoresClient.tsx:2716-2737
   * e PromotorView.tsx:666-683), escrito à mão em tabela crua. Aqui ele vira
   * mecanismo do kit; o CSS vive em uiCss.ts (.rr-table-cards).
   */
  cards?: boolean;
  className?: string;
}

const DEFAULT_MIN_WIDTH = 720;

/**
 * Tabela densa do kit (ftable). Composição por markup nativo (thead/tbody/tfoot)
 * — flexível para colspans, filtros e células customizadas.
 *
 * Recursos:
 *  - `scrollable`  → janela com altura + thead STICKY no topo (vertical).
 *  - `minWidth`    → scroll HORIZONTAL quando a tabela estoura a largura.
 *  - `maxHeightOffset` → calibra a altura da janela (scrollable).
 *  - `cards`       → no telefone (<=560px) as linhas viram cartões empilhados.
 *    Exige data-l em cada <td>. OPT-IN: sem a prop, nada muda.
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
  maxHeightOffset,
  cards,
  className,
}: TableProps) {
  const wrap = [
    "rr-table-wrap",
    scrollable ? "rr-table-wrap--scrollable" : "",
    cards ? "rr-table-cards" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  // max-height inline SÓ quando a tela pede offset próprio. Sem ele a altura
  // vem do CSS (var(--chrome-offset)) — um valor, um lugar.
  const wrapStyle =
    scrollable && maxHeightOffset != null
      ? { maxHeight: `calc(100vh - ${maxHeightOffset}px)` }
      : undefined;
  return (
    <div className={wrap} style={wrapStyle}>
      <table
        className="rrui-table"
        style={{ ["--tbl-min"]: `${minWidth}px` } as CSSProperties}
      >
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
