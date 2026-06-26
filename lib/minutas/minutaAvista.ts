// Preenchedor da MINUTA DE COBRANÇA À VISTA (mensal). Consome as divergências
// cobráveis da auditoria viva (subpagamentos: Promotiva pagou menos que a TRP da
// competência) e monta:
//   - a Minuta (carta de cobrança, modelo genérico de tipos.ts);
//   - o anexo .xlsx com a lista COMPLETA das divergências.
// Tom: cobrança firme ancorada na TRP (não "esclarecimento"). Decisões: top-12
// na carta, consolidação por CNPJ, prazo 10 dias úteis.
import type { DivergenciaCobravel } from "../auditoriaAvistaViva.ts";
import { construirXlsxNavy, type Aba } from "../xlsxReport.ts";
import {
  brl,
  competenciaLabel,
  competenciaNumerica,
  dataPorExtenso,
  formatCnpj,
  pctUnidade,
} from "./format.ts";
import type { Minuta, Secao } from "./tipos.ts";

const TOP_CARTA = 12;
const PRAZO_DIAS_UTEIS = 10;

export interface MinutaAvistaInput {
  /** ISO YYYY-MM da competência auditada. */
  ym: string;
  /** Faixa de meta aplicada na competência (ex. "Faixa 3"). */
  faixa: string;
  /** Divergências cobráveis (já ordenadas por diferença asc). */
  divergencias: DivergenciaCobravel[];
  /** Σ a cobrar (magnitude positiva; = resumo.somaSubpagamento). */
  somaACobrar: number;
  /** Data de emissão da carta (caller passa — testável, sem Date.now()). */
  emissao: Date;
}

type ConsolidadoEmpresa = {
  cnpj: string | null;
  empresa: string;
  contratos: number;
  total: number;
};

/** Agrupa por CNPJ (fallback: nome quando CNPJ ausente). Σ |diferença|. */
function consolidarPorEmpresa(divs: DivergenciaCobravel[]): ConsolidadoEmpresa[] {
  const mapa = new Map<string, ConsolidadoEmpresa>();
  for (const d of divs) {
    const chave = d.cnpj ?? `nome:${d.empresa}`;
    const atual =
      mapa.get(chave) ??
      ({ cnpj: d.cnpj, empresa: d.empresa, contratos: 0, total: 0 } as ConsolidadoEmpresa);
    atual.contratos += 1;
    atual.total += Math.abs(d.diferenca);
    if (!atual.empresa && d.empresa) atual.empresa = d.empresa;
    mapa.set(chave, atual);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

/** Monta a carta de cobrança à vista (modelo Minuta genérico). */
export function montarMinutaAvista(input: MinutaAvistaInput): Minuta {
  const { ym, faixa, divergencias, somaACobrar, emissao } = input;
  const nContratos = divergencias.length;
  const compLabel = competenciaLabel(ym); // "abril/2026"
  const compNum = competenciaNumerica(ym); // "04/2026"
  const consolidado = consolidarPorEmpresa(divergencias);
  const topN = divergencias.slice(0, TOP_CARTA);
  const restantes = Math.max(0, nContratos - topN.length);

  const secoes: Secao[] = [
    {
      tipo: "texto",
      heading: "Objeto",
      paragrafos: [
        [
          { texto: "A auditoria da competência " },
          { texto: compLabel, negrito: true },
          {
            texto:
              " identificou subpagamentos de comissão em operações à vista, com remuneração paga em valor inferior ao devido pela Tabela de Remuneração Padrão (TRP) vigente na competência. A presente notificação tem por objeto a cobrança das diferenças apuradas.",
          },
        ],
      ],
    },
    {
      tipo: "texto",
      heading: "Critério de apuração",
      paragrafos: [
        [
          {
            texto:
              "A apuração compara, contrato a contrato, a comissão efetivamente paga com a comissão devida segundo a TRP da competência, observado o teto regulatório (BACEN). A base de cálculo é o fechamento mensal (valores efetivamente pagos), enquadrado na ",
          },
          { texto: faixa, negrito: true },
          {
            texto:
              ". Considera-se divergência cobrável o contrato cujo valor pago foi inferior ao devido pela TRP (subpagamento).",
          },
        ],
      ],
    },
    {
      tipo: "texto",
      heading: "Total apurado",
      paragrafos: [
        [
          { texto: "Foram identificados " },
          { texto: `${nContratos} contrato(s)`, negrito: true },
          { texto: " com subpagamento, totalizando " },
          { texto: brl(somaACobrar), negrito: true },
          { texto: " a regularizar, conforme detalhamento a seguir e anexo." },
        ],
      ],
    },
    {
      tipo: "tabela",
      heading: "Consolidado por empresa (CNPJ)",
      colunas: [
        { titulo: "CNPJ", peso: 3 },
        { titulo: "Empresa", peso: 4 },
        { titulo: "Contratos", alinhamento: "direita", peso: 2 },
        { titulo: "Total a cobrar", alinhamento: "direita", peso: 3 },
      ],
      linhas: consolidado.map((c) => [
        formatCnpj(c.cnpj),
        c.empresa || "—",
        String(c.contratos),
        brl(c.total),
      ]),
    },
    {
      tipo: "tabela",
      heading:
        restantes > 0
          ? `Maiores divergências (${topN.length} de ${nContratos})`
          : "Divergências apuradas",
      colunas: [
        { titulo: "Contrato", peso: 3 },
        { titulo: "Produto", peso: 4 },
        { titulo: "Tx. juros", alinhamento: "direita", peso: 2 },
        { titulo: "Prazo", alinhamento: "direita", peso: 2 },
        { titulo: "Pago", alinhamento: "direita", peso: 3 },
        { titulo: "Devido", alinhamento: "direita", peso: 3 },
        { titulo: "Diferença", alinhamento: "direita", peso: 3 },
        { titulo: "Regra TRP", peso: 4 },
      ],
      linhas: topN.map((d) => [
        d.contrato,
        d.produto ?? "—",
        pctUnidade(d.txJuros),
        String(d.prazo),
        brl(d.comissaoPaga),
        brl(d.comissaoDevida),
        brl(Math.abs(d.diferenca)),
        d.regraTrp,
      ]),
      rodape:
        restantes > 0
          ? `Demais ${restantes} contrato(s) na lista completa do anexo (.xlsx).`
          : undefined,
    },
    {
      tipo: "texto",
      heading: "Solicitação de regularização",
      paragrafos: [
        [
          { texto: "Solicitamos a regularização dos valores apurados no prazo de " },
          { texto: `${PRAZO_DIAS_UTEIS} (dez) dias úteis`, negrito: true },
          {
            texto:
              ", contados do recebimento desta, mediante pagamento das diferenças ou apresentação de contestação documental que justifique a divergência frente à TRP da competência.",
          },
        ],
      ],
    },
    {
      tipo: "texto",
      paragrafos: [
        [
          {
            texto:
              "A lista completa das divergências, contrato a contrato, integra o anexo ",
          },
          { texto: `anexo-divergencias-avista-${ym}.xlsx`, negrito: true },
          { texto: ", parte integrante desta notificação." },
        ],
      ],
    },
  ];

  return {
    titulo: "NOTIFICAÇÃO DE COBRANÇA — COMISSÃO À VISTA",
    cabecalho: [
      "[DESTINATÁRIO]",
      dataPorExtenso(emissao),
      [{ texto: `Ref.: Cobrança à vista — competência ${compNum}`, negrito: true }],
    ],
    secoes,
    assinatura: [
      "Atenciosamente,",
      [{ texto: "Diretor Executivo", negrito: true }],
      "Grupo RR Soluções",
    ],
    nomeArquivo: `minuta-cobranca-avista-${ym}`,
  };
}

/**
 * Anexo .xlsx no padrão navy (relatório profissional), 3 abas:
 *   - "Resumo Executivo" (KPIs): competência, faixa, nº contratos, Σ a cobrar,
 *     batimento Σpaga × Σdevida.
 *   - "Divergências" (tabela + autofilter + freeze + TOTAL dourado): a lista
 *     completa contrato a contrato.
 *   - "Consolidado por CNPJ" (tabela + TOTAL GERAL): Σ |diferença| por empresa.
 * Delegação total da formatação ao helper genérico construirXlsxNavy.
 */
export async function construirAnexoAvistaXlsx(
  ym: string,
  divergencias: DivergenciaCobravel[],
  faixa?: string
): Promise<Buffer> {
  const somaACobrar = divergencias.reduce((s, d) => s + Math.abs(d.diferenca), 0);
  const somaPaga = divergencias.reduce((s, d) => s + d.comissaoPaga, 0);
  const somaDevida = divergencias.reduce((s, d) => s + d.comissaoDevida, 0);

  // Aba 1 — Resumo Executivo (modo KPI: 1 linha de dados, label/valor vertical).
  const abaResumo: Aba = {
    nome: "Resumo Executivo",
    titulo: `Resumo Executivo — Cobrança à vista ${competenciaLabel(ym)}`,
    modo: "kpi",
    colunas: [
      { chave: "competencia", titulo: "Competência", formato: "texto" },
      { chave: "faixa", titulo: "Faixa aplicada", formato: "texto" },
      { chave: "contratos", titulo: "Contratos com subpagamento", formato: "numero" },
      { chave: "somaPaga", titulo: "Σ comissão paga", formato: "moeda" },
      { chave: "somaDevida", titulo: "Σ comissão devida (TRP)", formato: "moeda" },
      { chave: "somaACobrar", titulo: "Σ a cobrar (diferença)", formato: "moeda" },
    ],
    linhas: [
      {
        competencia: competenciaLabel(ym),
        faixa: faixa ?? "—",
        contratos: divergencias.length,
        somaPaga,
        somaDevida,
        somaACobrar,
      },
    ],
  };

  // Aba 2 — Divergências (lista completa). % em FRAÇÃO (numFmt '0.00%' multiplica
  // por 100): pctDevido já é fração; txJuros vem em unidade percentual (1,65) →
  // /100. Valores ficam números reais (filtráveis/somáveis).
  const abaDivergencias: Aba = {
    nome: `Divergências ${ym}`,
    titulo: `Divergências à vista — ${competenciaLabel(ym)}`,
    modo: "tabela",
    colunas: [
      { chave: "contrato", titulo: "Contrato", formato: "texto" },
      { chave: "empresa", titulo: "Empresa", formato: "texto" },
      { chave: "cnpj", titulo: "CNPJ", formato: "texto" },
      { chave: "produto", titulo: "Produto", formato: "texto" },
      { chave: "txJuros", titulo: "Tx. juros", formato: "percent" },
      { chave: "prazo", titulo: "Prazo", formato: "numero" },
      { chave: "valorLiquido", titulo: "Valor líquido", formato: "moeda" },
      { chave: "comissaoPaga", titulo: "Comissão paga", formato: "moeda" },
      { chave: "comissaoDevida", titulo: "Comissão devida", formato: "moeda" },
      { chave: "diferenca", titulo: "Diferença a cobrar", formato: "moeda" },
      { chave: "pctDevido", titulo: "% devido", formato: "percent" },
      { chave: "regraTrp", titulo: "Regra TRP", formato: "texto" },
    ],
    linhas: divergencias.map((d) => ({
      contrato: d.contrato,
      empresa: d.empresa || "",
      cnpj: formatCnpj(d.cnpj),
      produto: d.produto ?? "",
      txJuros: Number.isFinite(d.txJuros) ? d.txJuros / 100 : "",
      prazo: d.prazo,
      valorLiquido: Number(d.valorLiquido.toFixed(2)),
      comissaoPaga: Number(d.comissaoPaga.toFixed(2)),
      comissaoDevida: Number(d.comissaoDevida.toFixed(2)),
      diferenca: Number(Math.abs(d.diferenca).toFixed(2)),
      pctDevido: d.pctDevido != null ? d.pctDevido : "",
      regraTrp: d.regraTrp,
    })),
    totais: {
      contrato: "TOTAL",
      comissaoPaga: Number(somaPaga.toFixed(2)),
      comissaoDevida: Number(somaDevida.toFixed(2)),
      diferenca: Number(somaACobrar.toFixed(2)),
    },
  };

  // Aba 3 — Consolidado por CNPJ (reusa consolidarPorEmpresa; já ordenado desc).
  const consolidado = consolidarPorEmpresa(divergencias);
  const abaConsolidado: Aba = {
    nome: "Consolidado por CNPJ",
    titulo: `Consolidado por CNPJ — ${competenciaLabel(ym)}`,
    modo: "tabela",
    colunas: [
      { chave: "cnpj", titulo: "CNPJ", formato: "texto" },
      { chave: "empresa", titulo: "Empresa", formato: "texto" },
      { chave: "contratos", titulo: "Contratos", formato: "numero" },
      { chave: "total", titulo: "Total a cobrar", formato: "moeda" },
    ],
    linhas: consolidado.map((c) => ({
      cnpj: formatCnpj(c.cnpj),
      empresa: c.empresa || "—",
      contratos: c.contratos,
      total: Number(c.total.toFixed(2)),
    })),
    totais: {
      cnpj: "TOTAL GERAL",
      contratos: consolidado.reduce((s, c) => s + c.contratos, 0),
      total: Number(somaACobrar.toFixed(2)),
    },
  };

  return construirXlsxNavy({
    abas: [abaResumo, abaDivergencias, abaConsolidado],
  });
}

/** Texto de uso interno (debug/log): resumo das peças geradas. */
export { TOP_CARTA, PRAZO_DIAS_UTEIS };
