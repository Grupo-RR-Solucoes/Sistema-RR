// Preenchedor da MINUTA DE COBRANÇA À VISTA (mensal). Consome as divergências
// cobráveis da auditoria viva (subpagamentos: Promotiva pagou menos que a TRP da
// competência) e monta:
//   - a Minuta (carta de cobrança, modelo genérico de tipos.ts);
//   - o anexo .xlsx com a lista COMPLETA das divergências.
// Tom: cobrança firme ancorada na TRP (não "esclarecimento"). Decisões: top-12
// na carta, consolidação por CNPJ, prazo 10 dias úteis.
import * as XLSX from "xlsx";

import type { DivergenciaCobravel } from "../auditoriaAvistaViva.ts";
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

/** Anexo .xlsx com a lista COMPLETA das divergências (toolkit xlsx do projeto). */
export function construirAnexoAvistaXlsx(
  ym: string,
  divergencias: DivergenciaCobravel[]
): Buffer {
  const rows = divergencias.map((d) => ({
    Contrato: d.contrato,
    Empresa: d.empresa || "",
    CNPJ: formatCnpj(d.cnpj),
    Produto: d.produto ?? "",
    "Tx. juros": d.txJuros,
    Prazo: d.prazo,
    "Valor líquido": Number(d.valorLiquido.toFixed(2)),
    "Comissão paga": Number(d.comissaoPaga.toFixed(2)),
    "Comissão devida": Number(d.comissaoDevida.toFixed(2)),
    "Diferença (a cobrar)": Number(Math.abs(d.diferenca).toFixed(2)),
    "% devido": d.pctDevido != null ? Number((d.pctDevido * 100).toFixed(4)) : "",
    "Regra TRP": d.regraTrp,
  }));

  const normalizadas =
    rows.length > 0 ? rows : [{ Info: "Sem divergências cobráveis nesta competência." }];

  const ws = XLSX.utils.json_to_sheet(normalizadas);
  ws["!cols"] = Object.keys(normalizadas[0]).map((k) => ({
    wch: Math.max(12, k.length + 2),
  }));
  const wb = XLSX.utils.book_new();
  // Nome de aba não pode conter : \ / ? * [ ] — usa o ym ISO (2026-03).
  XLSX.utils.book_append_sheet(wb, ws, `Divergencias ${ym}`.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Texto de uso interno (debug/log): resumo das peças geradas. */
export { TOP_CARTA, PRAZO_DIAS_UTEIS };
