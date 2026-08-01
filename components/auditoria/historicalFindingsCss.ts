/**
 * CSS das tabelas de HistoricalFindings (Cash e Prt) — folha compartilhada.
 *
 * POR QUE EXISTE
 * Os dois componentes definiam largura e altura da tabela num objeto de estilo
 * INLINE:
 *
 *   tableWrap: { overflow:"auto", maxHeight:"calc(100vh - var(--chrome-offset))" }
 *   table:     { width:"100%", minWidth: 900 }
 *
 * `minWidth: 900` como PROPRIEDADE inline e inalcancavel por media query — o
 * mesmo defeito que o kit ja corrigiu em components/ui/Table.tsx, que passou a
 * gravar a variavel `--tbl-min` e a ler `min-width:var(--tbl-min,720px)` em
 * folha. Aqui repetimos o padrao com `--hf-min`.
 *
 * O QUE ESTE ARQUIVO **NAO** FAZ
 * Nao migra os componentes para o primitivo <Table>. Eles seguem com tabela
 * crua, thead sticky proprio e o resto dos estilos inline. O escopo e so tornar
 * largura e altura ALCANCAVEIS — a migracao e refatoracao maior e outra frente.
 *
 * --chrome-offset NAO muda: continua valendo no desktop. A media query do
 * telefone apenas deixa de consumi-lo, como o kit ja faz.
 */
export const HISTORICAL_FINDINGS_CSS = `
.hf-wrap{overflow:auto;max-height:calc(100vh - var(--chrome-offset));}
.hf-table{min-width:var(--hf-min,900px);}

@media (max-width:560px){
  /* A tabela para de exigir 900px contra 356px uteis, e a janela de rolagem
     vertical some — no telefone o --chrome-offset (calibrado para computador)
     empurra o inicio da tabela para baixo da dobra. */
  .hf-table{min-width:0;}
  .hf-wrap{max-height:none;}
}
`;
