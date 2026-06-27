// Preenchedor do ADITAMENTO PRT (OPP099) — espelha minutaAvista.ts, mas a
// moldura é de ADITAMENTO a uma cobrança já enviada (o questionamento V9 de
// 07/05/2026), NÃO uma cobrança nova autônoma.
//
// Natureza do erro: a face PRT do mesmo erro OPP099 (TAB1 vs TAB2) já apontado
// no à vista de jul/set-2024. A Promotiva, além de subpagar a comissão à vista,
// pagou o PRT/diferido abaixo do devido: o excedente (cheio − 6%) diferido pelo
// prazo, pela TRP da competência (regra TRP 2026/194). Como ~98% dos contratos
// seguem ATIVOS (parcelas correndo), pede-se correção das parcelas vincendas
// além do retroativo.
//
// Monta: a carta (modelo Minuta de tipos.ts) + o anexo .xlsx navy (construirXlsxNavy).
import { construirXlsxNavy, type Aba } from "../xlsxReport.ts";
import {
  brl,
  competenciaLabel,
  dataPorExtenso,
  formatCnpj,
  pct,
} from "./format.ts";
import type { Minuta, Secao } from "./tipos.ts";

const TOP_CARTA = 12;
const PRAZO_DIAS_UTEIS = 10;
/** Data do questionamento original (V9) que este documento adita. */
const DATA_QUESTIONAMENTO = "07/05/2026";

/**
 * Uma divergência de PRT cobrável (subpagamento do diferido). Campos por
 * contrato, alinhados ao dataset validado opp099-prt-adendo-347.json.
 */
export interface DivergenciaPrtCobravel {
  contrato: string;
  empresa: string;
  cnpj: string | null;
  produto: string | null;
  /** Competência de origem da operação (YYYY-MM). */
  competencia: string;
  /** Prazo contratual (parcelas). */
  prazo: number;
  /** Base de cálculo do PRT (valor líquido). */
  base: number;
  /** TRP cheio da competência (fração, ex. 0.192). */
  pctCheio: number;
  /** Excedente diferido = cheio − 6% (fração). */
  pctExcedente: number;
  /** PRT devido por parcela = excedente × base / prazo. */
  prtCalculadoParcela: number;
  /** PRT pago por parcela = prtPago / meses pagos. */
  prtPagoParcela: number;
  /** Diferença total retroativa = (calc − pago)/parcela × meses pagos. */
  diferencaTotal: number;
  /** Data final prevista do PRT (YYYY-MM-DD) — fim do cronograma. */
  dataFinalPrt: string | null;
  /** PRT ainda ativo hoje (parcelas vincendas correndo). */
  ativo: boolean;
}

export interface MinutaPrtAdendoInput {
  /** Divergências PRT cobráveis (ordenadas por diferença desc recomendado). */
  divergencias: DivergenciaPrtCobravel[];
  /** Σ a regularizar (= Σ diferencaTotal). Se ausente, soma das divergências. */
  somaACobrar?: number;
  /** Data de emissão da carta (caller passa — testável, sem Date.now()). */
  emissao: Date;
  /** Rótulo das competências da face PRT (ex. "julho e setembro de 2024"). */
  competenciasLabel?: string;
}

type ConsolidadoEmpresa = {
  cnpj: string | null;
  empresa: string;
  contratos: number;
  total: number;
};

/**
 * Agrupa por CNPJ (fallback: nome quando CNPJ ausente). Σ diferença total.
 * Espelha consolidarPorEmpresa de minutaAvista.ts (mesma semântica).
 */
function consolidarPorEmpresa(
  divs: DivergenciaPrtCobravel[]
): ConsolidadoEmpresa[] {
  const mapa = new Map<string, ConsolidadoEmpresa>();
  for (const d of divs) {
    const chave = d.cnpj ?? `nome:${d.empresa}`;
    const atual =
      mapa.get(chave) ??
      ({ cnpj: d.cnpj, empresa: d.empresa, contratos: 0, total: 0 } as ConsolidadoEmpresa);
    atual.contratos += 1;
    atual.total += Math.abs(d.diferencaTotal);
    if (!atual.empresa && d.empresa) atual.empresa = d.empresa;
    mapa.set(chave, atual);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

/** Monta a carta de ADITAMENTO PRT (modelo Minuta genérico). */
export function montarMinutaPrtAdendo(input: MinutaPrtAdendoInput): Minuta {
  const { divergencias, emissao } = input;
  const nContratos = divergencias.length;
  const soma =
    input.somaACobrar ??
    divergencias.reduce((s, d) => s + Math.abs(d.diferencaTotal), 0);
  const ativos = divergencias.filter((d) => d.ativo).length;
  const pctAtivos = nContratos > 0 ? Math.round((100 * ativos) / nContratos) : 0;
  const consolidado = consolidarPorEmpresa(divergencias);
  const topN = divergencias.slice(0, TOP_CARTA);
  const restantes = Math.max(0, nContratos - topN.length);
  const compLabel = input.competenciasLabel ?? "julho e setembro de 2024";

  const secoes: Secao[] = [
    {
      tipo: "texto",
      heading: "Objeto",
      paragrafos: [
        [
          { texto: "Em aditamento ao questionamento de " },
          { texto: DATA_QUESTIONAMENTO, negrito: true },
          {
            texto:
              ", identificou-se a face PRT do mesmo erro (OPP099 — aplicação de TABELA 1 em vez de TABELA 2) já apontado na divergência de comissão à vista das competências de ",
          },
          { texto: compLabel, negrito: true },
          {
            texto:
              ". Além de subpagar a comissão à vista, a Promotiva pagou o PRT/diferido em valor inferior ao devido: o excedente (percentual cheio menos o teto de 6% à vista), diferido ao longo do prazo contratual, foi remunerado abaixo da Tabela de Remuneração Padrão (TRP) vigente na competência. O presente aditamento tem por objeto essas diferenças de PRT, relativas aos mesmos contratos já apontados à vista.",
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
              "Aplica-se a regra de remuneração vigente (TRP 2026/194): a comissão à vista é limitada ao teto de 6%, e o percentual que excede esse teto (excedente = cheio − 6%) é diferido e pago ao longo do prazo contratual, enquanto a operação permanece ativa e adimplente. Para cada contrato, compara-se o PRT devido por parcela (",
          },
          { texto: "excedente × base ÷ prazo", italico: true },
          {
            texto:
              ") com o efetivamente pago, apurando-se a diferença no período já decorrido. O critério e os contratos são os mesmos da carta de 07/05/2026 (questionamento V9), ora examinados pela face do diferido.",
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
          { texto: " com subpagamento de PRT, totalizando " },
          { texto: brl(soma), negrito: true },
          {
            texto:
              " de diferença retroativa apurada, conforme consolidação por CNPJ abaixo e detalhamento contrato a contrato no anexo.",
          },
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
        { titulo: "Diferença PRT", alinhamento: "direita", peso: 3 },
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
          ? `Maiores divergências de PRT (${topN.length} de ${nContratos})`
          : "Divergências de PRT apuradas",
      colunas: [
        { titulo: "Contrato", peso: 3 },
        { titulo: "Produto", peso: 4 },
        { titulo: "Compet.", alinhamento: "centro", peso: 2 },
        { titulo: "Base", alinhamento: "direita", peso: 3 },
        { titulo: "% cheio", alinhamento: "direita", peso: 2 },
        { titulo: "% exced.", alinhamento: "direita", peso: 2 },
        { titulo: "Diferença PRT", alinhamento: "direita", peso: 3 },
        { titulo: "Ativo", alinhamento: "centro", peso: 2 },
      ],
      linhas: topN.map((d) => [
        d.contrato,
        d.produto ?? "—",
        d.competencia,
        brl(d.base),
        pct(d.pctCheio),
        pct(d.pctExcedente),
        brl(Math.abs(d.diferencaTotal)),
        d.ativo ? "Sim" : "Não",
      ]),
      rodape:
        restantes > 0
          ? `Demais ${restantes} contrato(s) na lista completa do anexo (.xlsx).`
          : undefined,
    },
    {
      tipo: "texto",
      heading: "Contratos ativos — parcelas vincendas",
      paragrafos: [
        [
          { texto: `${pctAtivos}% dos contratos (${ativos} de ${nContratos})` , negrito: true },
          {
            texto:
              " permanecem ATIVOS, com parcelas de PRT ainda em curso. Para esses, além do retroativo apurado, solicita-se a correção das parcelas vincendas, de modo a remunerar o excedente diferido pelo percentual correto (TRP) até o término do cronograma.",
          },
        ],
      ],
    },
    {
      tipo: "texto",
      heading: "Solicitação de regularização",
      paragrafos: [
        [
          {
            texto:
              "Solicitamos a regularização das diferenças de PRT apuradas — retroativo e parcelas vincendas — no prazo de ",
          },
          { texto: `${PRAZO_DIAS_UTEIS} (dez) dias úteis`, negrito: true },
          {
            texto:
              ", contados do recebimento deste aditamento, mediante pagamento ou apresentação de contestação documental que justifique a divergência frente à TRP da competência.",
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
              "A lista completa das divergências de PRT, contrato a contrato, integra o anexo ",
          },
          { texto: "anexo-divergencias-prt-opp099.xlsx", negrito: true },
          { texto: ", parte integrante deste aditamento." },
        ],
      ],
    },
  ];

  return {
    titulo: "ADITAMENTO AO QUESTIONAMENTO DE 07/05/2026 — FACE PRT (OPP099)",
    cabecalho: [
      "[DESTINATÁRIO]",
      dataPorExtenso(emissao),
      [
        {
          texto: `Ref.: Em aditamento ao questionamento de ${DATA_QUESTIONAMENTO} — face PRT (OPP099)`,
          negrito: true,
        },
      ],
    ],
    secoes,
    assinatura: [
      "Atenciosamente,",
      [{ texto: "Diretor Executivo", negrito: true }],
      "Grupo RR Soluções",
    ],
    nomeArquivo: "aditamento-prt-opp099",
  };
}

/**
 * Anexo .xlsx no padrão navy, 3 abas:
 *   - "Resumo Executivo" (KPI): nº contratos, ativos, Σ diferença PRT.
 *   - "Divergências PRT" (tabela completa): contrato, produto, competência,
 *     base, % cheio, % excedente, PRT calc/parcela, PRT pago/parcela,
 *     diferença, data final, ativo.
 *   - "Consolidado por CNPJ" (tabela + TOTAL GERAL).
 * Delega toda a formatação ao helper genérico construirXlsxNavy.
 */
export async function construirAnexoPrtAdendoXlsx(
  divergencias: DivergenciaPrtCobravel[]
): Promise<Buffer> {
  const soma = divergencias.reduce((s, d) => s + Math.abs(d.diferencaTotal), 0);
  const ativos = divergencias.filter((d) => d.ativo).length;

  // Aba 1 — Resumo Executivo (KPI).
  const abaResumo: Aba = {
    nome: "Resumo Executivo",
    titulo: "Resumo Executivo — Aditamento PRT (OPP099)",
    modo: "kpi",
    colunas: [
      { chave: "ref", titulo: "Documento", formato: "texto" },
      { chave: "competencias", titulo: "Competências (face PRT)", formato: "texto" },
      { chave: "contratos", titulo: "Contratos com subpagamento PRT", formato: "numero" },
      { chave: "ativos", titulo: "Contratos ativos (parcelas correndo)", formato: "numero" },
      { chave: "soma", titulo: "Σ diferença PRT (retroativo)", formato: "moeda" },
    ],
    linhas: [
      {
        ref: `Aditamento ao questionamento de ${DATA_QUESTIONAMENTO}`,
        competencias: "jul/2024 e set/2024",
        contratos: divergencias.length,
        ativos,
        soma: Number(soma.toFixed(2)),
      },
    ],
  };

  // Aba 2 — Divergências PRT (lista completa). % em FRAÇÃO (numFmt 0.00%).
  const abaDivergencias: Aba = {
    nome: "Divergências PRT",
    titulo: "Divergências de PRT — Aditamento OPP099",
    modo: "tabela",
    colunas: [
      { chave: "contrato", titulo: "Contrato", formato: "texto" },
      { chave: "empresa", titulo: "Empresa", formato: "texto" },
      { chave: "cnpj", titulo: "CNPJ", formato: "texto" },
      { chave: "produto", titulo: "Produto", formato: "texto" },
      { chave: "competencia", titulo: "Competência", formato: "texto" },
      { chave: "prazo", titulo: "Prazo", formato: "numero" },
      { chave: "base", titulo: "Base (líquido)", formato: "moeda" },
      { chave: "pctCheio", titulo: "% cheio (TRP)", formato: "percent" },
      { chave: "pctExcedente", titulo: "% excedente", formato: "percent" },
      { chave: "prtCalculadoParcela", titulo: "PRT calc/parcela", formato: "moeda" },
      { chave: "prtPagoParcela", titulo: "PRT pago/parcela", formato: "moeda" },
      { chave: "diferencaTotal", titulo: "Diferença PRT", formato: "moeda" },
      { chave: "dataFinalPrt", titulo: "Data final PRT", formato: "texto" },
      { chave: "ativo", titulo: "Ativo", formato: "texto" },
    ],
    linhas: divergencias.map((d) => ({
      contrato: d.contrato,
      empresa: d.empresa || "",
      cnpj: formatCnpj(d.cnpj),
      produto: d.produto ?? "",
      competencia: d.competencia,
      prazo: d.prazo,
      base: Number(d.base.toFixed(2)),
      pctCheio: Number.isFinite(d.pctCheio) ? d.pctCheio : "",
      pctExcedente: Number.isFinite(d.pctExcedente) ? d.pctExcedente : "",
      prtCalculadoParcela: Number(d.prtCalculadoParcela.toFixed(2)),
      prtPagoParcela: Number(d.prtPagoParcela.toFixed(2)),
      diferencaTotal: Number(Math.abs(d.diferencaTotal).toFixed(2)),
      dataFinalPrt: d.dataFinalPrt ?? "—",
      ativo: d.ativo ? "Sim" : "Não",
    })),
    totais: {
      contrato: "TOTAL",
      diferencaTotal: Number(soma.toFixed(2)),
    },
  };

  // Aba 3 — Consolidado por CNPJ.
  const consolidado = consolidarPorEmpresa(divergencias);
  const abaConsolidado: Aba = {
    nome: "Consolidado por CNPJ",
    titulo: "Consolidado por CNPJ — Aditamento PRT (OPP099)",
    modo: "tabela",
    colunas: [
      { chave: "cnpj", titulo: "CNPJ", formato: "texto" },
      { chave: "empresa", titulo: "Empresa", formato: "texto" },
      { chave: "contratos", titulo: "Contratos", formato: "numero" },
      { chave: "total", titulo: "Diferença PRT", formato: "moeda" },
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
      total: Number(soma.toFixed(2)),
    },
  };

  return construirXlsxNavy({
    abas: [abaResumo, abaDivergencias, abaConsolidado],
  });
}

export { TOP_CARTA, PRAZO_DIAS_UTEIS, consolidarPorEmpresa };
