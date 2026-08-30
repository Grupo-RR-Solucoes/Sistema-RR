// ============================================================================
// bbtsPdfExtract — EXTRATOR server-side dos PDFs de fechamento da ADS/BBTS para
// as linhas estruturadas (BbtsCreditoRow[] / BbtsSeguroRow[]) que o
// bbtsClosingImport já consome. Reusa extractLinesFromPdf (unpdf, mesmo padrão
// provado do parseTrpPdf que roda serverless na Vercel).
//
// ANCORADO EM RÓTULO, nunca em posição fixa: as linhas de dados são reconhecidas
// por assinatura estável (proposta + R$ + R$ + data + %pct + srcc + chave J … +
// NÃO/SIM), e o convênio pelo rótulo do segmento (PUBLICO/PRIVADO). As ÂNCORAS
// vêm da seção "Valor para Emissão da Nota Fiscal" do próprio PDF:
//   crédito: "Pagamento AVT" (Σ pag à vista) · seguro: "TOTAL" (Σ pagamento).
// Se a Σ extraída não bater a âncora do PDF, LANÇA (extração inconsistente).
// extractText vazio (PDF imagem/escaneado) → erro claro, não adivinha.
// ============================================================================

import { getDocumentProxy } from "unpdf";

import { extractLinesFromPdf } from "@/lib/trp/parseTrpPdf";
// JUNCAO dos fragmentos de uma celula, com a LACUNA de glifo preservada.
import { juntarFragmentosPdf } from "@/lib/bbts/normalizarTextoPdf";
import type {
  BbtsClosingInput,
  BbtsCreditoRow,
  BbtsPrtRow,
  BbtsSeguroRow,
} from "@/lib/bbtsClosingImport";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// "R$ 5.000,00" / "R$ -" / "-R$ 20,70" / "24.000,00" -> number (respeita sinal).
/**
 * PRESERVA O SINAL. O traco vem ANTES do "R$" nos PDFs da BBTS ("-R$ 24,05"), e a
 * limpeza da linha 37 apaga qualquer sinal — por isso ele e capturado antes e
 * restaurado no return. NAO trocar por Math.abs nem por Number(): o sinal e
 * informacao do DOCUMENTO (linha CANCELADA do seguro vem negativa), nao
 * interpretacao nossa. Travado por scripts/bbts_sinal_negativo_gate.cjs.
 *
 * Exportada SO para o gate — nenhum consumidor de producao deve chamar direto.
 */
export function money(raw: unknown): number {
  let s = String(raw ?? "").trim();
  if (s === "") return 0;
  const negative = s.includes("-");
  s = s.replace(/[^\d,.]/g, ""); // tira R$, sinais, espaços
  if (s === "") return 0;
  s = s.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."); // milhar . / decimal ,
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

function pct(raw: unknown): number {
  const n = Number(String(raw ?? "").replace("%", "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}

function moneysIn(line: string): number[] {
  return (line.match(/-?R\$\s*-?[\d.,]*/g) || []).map(money);
}

class BbtsPdfError extends Error {}

// ---- CRÉDITO ----------------------------------------------------------------
// Ex.: "212539496 R$ 5.000,00 R$ 143,50 08/06/2026 2,8700% 2 JJ552710 Novo Não
//       Crédito Novo PUBLICO 1640 INSS Novo 1,85 108 109 NÃO"
// Exportada so para o gate de sinal. O grupo 3 aceita `R$ -` (placeholder de
// "sem valor", visto em junho/2026) E `-R$ 1.234,56` (negativo).
export const CREDITO_RE =
  /^(\d{6,})\s+R\$\s*([\d.,]+)\s+(R\$\s*-|-?R\$\s*[\d.,]+)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.,]+)%\s+(\d)\s+(JJ\d+)\s+(.*?)\s+(N[ÃA]O|SIM)\s*$/i;

// ---------------------------------------------------------------------------
// COLUNAS QUEBRADAS (produto / linha de crédito / nome do convênio)
//
// PROBLEMA: no PDF, três colunas têm o texto QUEBRADO EM VÁRIAS LINHAS ("Linha do
// Produto", "Linha do Crédito", "Nome do Convênio"). A reconstrução por linha
// (extractLinesFromPdf) espalha esses pedaços em linhas vizinhas — e pedaços de
// uma linha de dados aparecem ACIMA e ABAIXO dela, misturados com os da linha
// seguinte. Por isso a regex de linha NÃO consegue lê-las (e é por isso que o
// produto ficava null, e o 137478 — que é 13o salário — roteava como Público).
//
// SOLUÇÃO: ler por GEOMETRIA, não por linha.
//   - Cada linha de dados tem uma ÂNCORA: o nº da proposta, na 1a coluna (x baixo).
//   - Cada pedaço de texto pertence à linha cuja âncora está MAIS PRÓXIMA em y
//     (as âncoras distam ~38-43; os pedaços ficam a ~5-14 da sua âncora — nunca
//     há empate).
//   - A COLUNA sai do x: as fronteiras são os pontos médios entre os rótulos do
//     CABEÇALHO ("Produto", "Crédito", "Convênio" x3, "de Juros"), lidos do próprio
//     PDF. Nada de x hardcoded: se a BBTS mexer no layout, as fronteiras andam junto.
// ---------------------------------------------------------------------------

interface PdfItem {
  x: number;
  y: number;
  str: string;
}

/** Itens de texto com coordenadas, por página. */
async function extractItemsByPage(data: Uint8Array): Promise<PdfItem[][]> {
  const pdf = await getDocumentProxy(data);
  const pages: PdfItem[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const it of tc.items as Array<{ str?: string; transform: number[] }>) {
      const str = (it.str ?? "").trim();
      if (!str) continue;
      items.push({ x: it.transform[4], y: it.transform[5], str });
    }
    pages.push(items);
  }
  return pages;
}

/**
 * Texto de uma coluna (x em [lo, hi)) dentro da linha de uma ancora, de cima p/
 * baixo.
 *
 * A JUNCAO mora em lib/bbts/normalizarTextoPdf.ts. Aqui so ordenamos e
 * entregamos os fragmentos CRUS — inclusive os itens de 1 caractere de controle,
 * que sao o SINAL de ligadura perdida e NAO podem ser apagados antes da juncao.
 *
 * O QUE SAIU DAQUI (03/08/2026):
 *   - a limpeza dos caracteres de controle APAGAVA o NUL, e o join(" ") ja
 *     tinha metido um espaco no lugar dele: era dai que nascia "Automa co".
 *   - o replace de Corren/sta -> Correntista era remendo manual para UMA
 *     palavra. As outras 5 ocorrencias do MESMO fenomeno, no MESMO arquivo,
 *     seguiam quebradas. Agora todas passam pelo helper.
 */
function textoDaColuna(itens: PdfItem[], lo: number, hi: number): string {
  const fragmentos = itens
    .filter((i) => i.x >= lo && i.x < hi)
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((i) => i.str);
  return juntarFragmentosPdf(fragmentos).texto;
}

export interface ColunasCredito {
  produto: string | null; // "Linha do Produto"  — "Consignado Novo Correntista"
  linha_credito: string | null; // "Linha do Crédito"  — "Crédito Novo" / "Crédito Renovação"
  nome_convenio: string | null; // "Nome do Convênio"  — "INSS Novo" / "Não Consignado - 13º salário"
}


/**
 * A LINHA a que um fragmento pertence, ou -1 quando ele nao pertence a nenhuma.
 *
 * REGRA: a ancora mais proxima em y, aceita se a distancia couber em METADE DO
 * VAO ATE A ANCORA VIZINHA DAQUELE LADO. E o diagrama de Voronoi em 1D: o maior
 * criterio que nunca deixa um fragmento cair na faixa de duas linhas.
 *
 * DUAS TENTATIVAS ANTERIORES ERRARAM, e ficam registradas porque o erro e
 * instrutivo:
 *
 *   1. `dist > 20` — constante magica. Medido no fechamento de julho/2026: as
 *      ancoras da tabela de credito distam 51,7 a 66,7 e as celulas de 5 linhas
 *      do "Nome do Convenio" chegam a +-24. Morriam 28 fragmentos em silencio
 *      ("Nao", "Bene", <NUL>, "cio" nos 7 contratos CDC) — e com o "Nao" ia
 *      embora justamente o que distingue "Nao Consignado" de "Consignado".
 *
 *   2. metade do MENOR passo da PAGINA — pior que a constante. A pagina 5 tem a
 *      secao PRT logo abaixo, com propostas espacadas ~19, e o menor passo
 *      GLOBAL passou a sair de outra tabela: raio 9,4, perdas subiram de 28
 *      para 46. Vao GLOBAL nao serve; o vao e LOCAL.
 *
 * Por que nao alargar mais: perda deixa a celula curta e visivel; contaminacao
 * deixa a celula ERRADA e plausivel. Ver scripts/bbts_conservacao_celula_gate.cjs.
 */
export function linhaDoFragmento(y: number, ancoras: readonly PdfItem[]): number {
  if (ancoras.length === 0) return -1;
  let idx = -1;
  let dist = Infinity;
  for (let k = 0; k < ancoras.length; k++) {
    const d = Math.abs(y - ancoras[k].y);
    if (d < dist) { dist = d; idx = k; }
  }
  if (idx < 0) return -1;
  if (ancoras.length === 1) return dist <= 20 ? idx : -1;   // sem vao para medir

  // ancoras vem ordenadas por y DECRESCENTE (de cima para baixo na pagina).
  const acima = y > ancoras[idx].y;
  const vizinho = acima ? ancoras[idx - 1] : ancoras[idx + 1];
  const vao = vizinho
    ? Math.abs(vizinho.y - ancoras[idx].y)
    : Math.abs((acima ? ancoras[idx + 1] : ancoras[idx - 1]).y - ancoras[idx].y);
  return dist <= vao / 2 ? idx : -1;
}

/**
 * Lê, por geometria, as 3 colunas quebradas de cada proposta do PDF de crédito.
 * Retorna um mapa proposta -> colunas. Página sem cabeçalho reconhecível é pulada
 * (as demais continuam) — e o chamador avisa se alguma proposta ficou sem produto.
 */
export async function extractColunasCredito(data: Uint8Array): Promise<Map<string, ColunasCredito>> {
  const out = new Map<string, ColunasCredito>();
  const pages = await extractItemsByPage(data);

  for (const itens of pages) {
    // fronteiras de coluna a partir do CABEÇALHO desta página
    const hdr = (rx: RegExp): number | null => {
      const hit = itens.find((i) => rx.test(i.str));
      return hit ? hit.x : null;
    };
    const xChave = hdr(/^Chave J$/i);
    const xProduto = hdr(/^Produto$/i);
    const xCredito = hdr(/^Crédito$/i);
    const xJuros = hdr(/^de Juros/i);
    const convs = itens
      .filter((i) => /^Convênio$/i.test(i.str))
      .map((i) => i.x)
      .sort((a, b) => a - b); // [segmento, número, nome]
    if (xChave == null || xProduto == null || xCredito == null || xJuros == null || convs.length < 3) {
      continue; // página sem a tabela de crédito (ex.: capa) — segue
    }
    const mid = (a: number, b: number) => (a + b) / 2;
    const bandaProduto: [number, number] = [mid(xChave, xProduto), mid(xProduto, xCredito)];
    const bandaCredito: [number, number] = [mid(xProduto, xCredito), mid(xCredito, convs[0])];
    const bandaNome: [number, number] = [mid(convs[1], convs[2]), mid(convs[2], xJuros)];

    // âncoras: nº da proposta na 1a coluna (x < início do Chave J, com folga)
    const ancoras = itens
      .filter((i) => /^\d{6,}$/.test(i.str) && i.x < xChave - 100)
      .sort((a, b) => b.y - a.y);
    if (ancoras.length === 0) continue;

    // RAIO DE ATRIBUICAO — derivado do PROPRIO espacamento das ancoras.
    //
    // Era `dist > 20`: constante magica, e errada. Medido no fechamento de
    // julho/2026: as ancoras distam 51,7 a 66,7, e as celulas de 5 linhas do
    // "Nome do Convenio" se estendem a +-24 — 4 unidades alem do corte. Morriam
    // 28 fragmentos em silencio ("Nao", "Bene", <NUL>, "cio" nos 7 contratos
    // CDC), e com eles o "Nao" que distingue "Nao Consignado" de "Consignado".
    //
    // O criterio agora e METADE DO MENOR PASSO entre ancoras vizinhas: e o maior
    // raio que ainda torna IMPOSSIVEL um fragmento cair na faixa de duas linhas
    // ao mesmo tempo. Alargar mais seria trocar perda por contaminacao, que e
    // pior — perda deixa a celula curta e visivel, contaminacao deixa a celula
    // errada e plausivel. Ver scripts/bbts_conservacao_celula_gate.cjs, que
    // mede as duas coisas.


    // cada item pertence à âncora mais próxima em y
    const porAncora = new Map<string, PdfItem[]>();
    for (const it of itens) {
      const idxLinha = linhaDoFragmento(it.y, ancoras);
      if (idxLinha < 0) continue;            // fora de qualquer linha (cabeçalho/rodapé)
      const melhor = ancoras[idxLinha];
      const arr = porAncora.get(melhor.str) ?? [];
      arr.push(it);
      porAncora.set(melhor.str, arr);
    }

    for (const [proposta, itensDaLinha] of porAncora) {
      out.set(proposta, {
        produto: textoDaColuna(itensDaLinha, bandaProduto[0], bandaProduto[1]) || null,
        linha_credito: textoDaColuna(itensDaLinha, bandaCredito[0], bandaCredito[1]) || null,
        nome_convenio: textoDaColuna(itensDaLinha, bandaNome[0], bandaNome[1]) || null,
      });
    }
  }
  return out;
}

// ---- CABEÇALHO "Valor para Emissão da Nota Fiscal" --------------------------
//
// O bloco de totais do PDF de crédito. O parser LIA só as duas primeiras colunas,
// por POSIÇÃO (vals[0], vals[1]), e usava "Abertura de Conta" apenas como marcador
// de parada da seção PRT — o valor ia para o lixo (R$ 100,00 em jul/2026).
//
// LER POR POSIÇÃO NÃO SERVE: o próprio código já admitia que o conjunto de colunas
// varia ("PDF sem coluna PRT (mês sem PRT)"). Num mês sem PRT, o 3o valor deixaria
// de ser a Abertura e passaria a ser o Pagamento Total — errado e plausível.
// LER POR NOME TAMBÉM NÃO BASTA: medido nos dois PDFs em disco (27/08/2026), o 4o
// rótulo mudou de "Valor Descontado" (06/26) para "Glosa" (07/26).
//
// Então: pareia RÓTULO com VALOR por GEOMETRIA e VALIDA pela IDENTIDADE DA SOMA.
//   06/26   7.707,03 + 7,01 +   0,00 + 0,00 =  7.714,04 = Pagamento Total   fecha
//   07/26  18.737,33 + 7,01 + 100,00 + 0,00 = 18.844,34 = Pagamento Total   fecha
// Se a BBTS renomear, reordenar ou acrescentar coluna e o pareamento sair errado,
// a identidade QUEBRA e isto LANÇA — em vez de gravar um número plausível e errado.
// É a mesma disciplina das âncoras AVT/PRT que já existiam.
//
// UM DETALHE MEDIDO que mata o pareamento ingênuo "o rótulo mais à esquerda do
// valor": em 07/26 o rótulo "Glosa" começa em x=565,1, à DIREITA do seu próprio
// valor (x=562,6). Por isso o desempate é por |Δx| (proximidade), não por ordem de
// x. Quando as contagens batem (5 e 5 nas duas competências) o pareamento é
// ORDINAL, que é exato; a proximidade é só o plano B.

export interface CabecalhoNf {
  /** rótulo -> valor, CRU e na ordem de leitura. Guarda o layout como ele veio. */
  rotulos: Array<{ rotulo: string; valor: number }>;
  pagamentoAvt: number;
  pagamentoPrt: number;
  aberturaConta: number;
  /** "Valor Descontado" (06/26) / "Glosa" (07/26) e o que mais aparecer. */
  outrasDeducoes: number;
  pagamentoTotal: number;
}

const RX_AVT = /Pagamento\s*AVT/i;
const RX_PRT = /Pagamento\s*PRT/i;
const RX_ABERTURA = /Abertura\s*de\s*Conta/i;
const RX_TOTAL = /Pagamento\s*Total/i;

/** Itens na mesma linha do PDF (o y de uma linha varia por arredondamento). */
function mesmaLinhaPdf(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1;
}

export async function extractCabecalhoNf(data: Uint8Array): Promise<CabecalhoNf> {
  const pages = await extractItemsByPage(data);
  for (const itens of pages) {
    const avt = itens.find((i) => RX_AVT.test(i.str));
    if (!avt) continue;

    const rotulos = itens.filter((i) => mesmaLinhaPdf(i.y, avt.y)).sort((a, b) => a.x - b.x);
    // linha de VALORES = a faixa de y imediatamente ABAIXO dos rótulos que traga "R$"
    const abaixo = itens.filter((i) => i.y < avt.y - 1 && /R\$/.test(i.str));
    if (abaixo.length === 0) break;
    const yValores = Math.max(...abaixo.map((i) => i.y));
    const valores = abaixo.filter((i) => mesmaLinhaPdf(i.y, yValores)).sort((a, b) => a.x - b.x);

    const pares: Array<{ rotulo: string; valor: number }> = [];
    if (rotulos.length === valores.length) {
      for (let k = 0; k < rotulos.length; k++) {
        pares.push({ rotulo: rotulos[k].str, valor: money(valores[k].str) });
      }
    } else {
      // contagens diferentes (rótulo fragmentado?): cada valor vai ao rótulo mais
      // próximo em x. A identidade da soma, abaixo, é quem diz se deu certo.
      for (const v of valores) {
        let melhor = rotulos[0];
        let d = Infinity;
        for (const r of rotulos) {
          const dd = Math.abs(v.x - r.x);
          if (dd < d) {
            d = dd;
            melhor = r;
          }
        }
        pares.push({ rotulo: melhor ? melhor.str : "", valor: money(v.str) });
      }
    }

    const achar = (rx: RegExp) => pares.find((p) => rx.test(p.rotulo));
    const hitAvt = achar(RX_AVT);
    if (!hitAvt) break; // o rótulo existe na página mas não casou com valor nenhum
    const hitTotal = achar(RX_TOTAL);
    const conhecido = (r: string) =>
      RX_AVT.test(r) || RX_PRT.test(r) || RX_ABERTURA.test(r) || RX_TOTAL.test(r);
    const outrasDeducoes = round2(
      pares.filter((p) => !conhecido(p.rotulo)).reduce((a, p) => a + p.valor, 0)
    );

    const cab: CabecalhoNf = {
      rotulos: pares,
      pagamentoAvt: hitAvt.valor,
      pagamentoPrt: achar(RX_PRT)?.valor ?? 0, // PDF sem coluna PRT (mês sem PRT)
      aberturaConta: achar(RX_ABERTURA)?.valor ?? 0,
      outrasDeducoes,
      pagamentoTotal: hitTotal?.valor ?? 0,
    };

    // IDENTIDADE — só quando o PDF traz o "Pagamento Total" para conferir contra.
    if (hitTotal) {
      const soma = round2(
        cab.pagamentoAvt + cab.pagamentoPrt + cab.aberturaConta + cab.outrasDeducoes
      );
      if (Math.abs(soma - cab.pagamentoTotal) > 0.01) {
        throw new BbtsPdfError(
          `Cabeçalho da NF: Σ dos componentes ${soma} != "Pagamento Total" ` +
            `${cab.pagamentoTotal} do PDF — pareamento rótulo/valor inconsistente ` +
            `(layout mudou?). Lido: ` +
            pares.map((p) => `${p.rotulo}=${p.valor}`).join(" | ")
        );
      }
    }
    return cab;
  }
  throw new BbtsPdfError("Âncora 'Pagamento AVT' não encontrada no PDF de crédito.");
}

// ---- PRT --------------------------------------------------------------------
// Seção "Propostas do PAGAMENTO PRT" (a 2a perna do pagamento: o excedente do teto
// de 6% que a BBTS paga a prazo, uma parcela por mês).
// Ex.: "208966373 01/07/2026 2 R$ 0,44 #N/D"  |  "210594528 01/07/2026 1 R$ 1,17"
const PRT_RE = /^(\d{6,})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(-?R\$\s*[\d.,]+)\s*(.*)$/;

export type CreditoExtract = {
  rows: BbtsCreditoRow[];
  prt: BbtsPrtRow[];
  cabecalho: CabecalhoNf;
  pagAvistaAnchor: number;
  pagPrtAnchor: number;
  year: number;
  month: number;
};

export async function extractBbtsCreditoPdf(data: Uint8Array): Promise<CreditoExtract> {
  // O unpdf TRANSFERE o buffer para o worker (fica detached depois da 1a leitura).
  // Como lemos o PDF duas vezes (por linha e por coordenada), cada leitura recebe
  // a sua própria cópia — senão a 2a estoura DataCloneError.
  const bytesParaColunas = new Uint8Array(data);
  const bytesParaCabecalho = new Uint8Array(data);
  const lines = await extractLinesFromPdf(data);
  if (lines.length === 0) {
    throw new BbtsPdfError("PDF de crédito sem texto (imagem/escaneado?) — extração abortada.");
  }

  // competência: "referente ao mês 06/26" / "Pagamento total no mês 06/26"
  let year = 0, month = 0;
  for (const ln of lines) {
    const m = ln.match(/m[eê]s\s+(\d{2})\/(\d{2})/i);
    if (m) { month = Number(m[1]); year = 2000 + Number(m[2]); break; }
  }
  if (!year || !month) throw new BbtsPdfError("Competência não encontrada no PDF de crédito (rótulo 'mês MM/AA').");

  // âncoras: vêm do CABEÇALHO, pareadas rótulo<->valor por geometria e validadas
  // pela identidade da soma (ver extractCabecalhoNf). Antes era por POSIÇÃO na
  // linha de valores — o que só funciona enquanto o conjunto de colunas não muda,
  // e ele muda: o 4o rótulo virou "Glosa" em 07/26.
  const cabecalho = await extractCabecalhoNf(bytesParaCabecalho);
  const pagAvistaAnchor = cabecalho.pagamentoAvt;
  const pagPrtAnchor = cabecalho.pagamentoPrt;

  // colunas quebradas (produto / linha de crédito / nome do convênio), por geometria
  const colunas = await extractColunasCredito(bytesParaColunas);

  const rows: BbtsCreditoRow[] = [];
  for (const ln of lines) {
    const m = ln.match(CREDITO_RE);
    if (!m) continue;
    const middle = m[8].trim();
    const toks = middle.split(/\s+/);
    // últimos 3 tokens estáveis: juros_mensal, parcelas, prazo
    const prazo = parseInt(toks[toks.length - 1], 10);
    const parcelas = parseInt(toks[toks.length - 2], 10);
    const jurosMensal = Number((toks[toks.length - 3] || "").replace(",", "."));
    // convênio ancorado no rótulo do segmento
    const segIdx = toks.findIndex((t) => /^(PUBLICO|PRIVADO)$/i.test(t));
    const segmento = segIdx >= 0 ? toks[segIdx].toUpperCase() : null;
    const nrConvenio = segIdx >= 0 && toks[segIdx + 1] ? toks[segIdx + 1] : null;

    const col = colunas.get(m[1]);
    rows.push({
      contrato: m[1],
      valor_financiado: money(m[2]),
      pag_avista: money(m[3]),
      data: m[4],
      taxa_relatorio: pct(m[5]),
      srcc_cd: Number(m[6]),
      chave_j: m[7],
      // colunas quebradas, lidas por geometria (antes: sempre null)
      produto: col?.produto ?? null,
      linha_credito: col?.linha_credito ?? null,
      categoria: col?.nome_convenio ?? null, // "Nome do Convênio" — o produto semântico
      segmento,
      nr_convenio: nrConvenio,
      juros_mensal: Number.isFinite(jurosMensal) ? jurosMensal : null,
      parcelas: Number.isFinite(parcelas) ? parcelas : null,
      // "Prazo da Operação" — era LIDO e DESCARTADO. A tabela da BBTS indexa os
      // produtos NÃO consignados (13o salário, CDC FGTS) por "Prazo (meses)", não
      // por "Parcelas": sem este campo, o 13o (1 parcela / 19 meses) cairia fora da
      // tabela por engano. Ver conferenciaBbts.prazoDaTabela().
      prazo_operacao: Number.isFinite(prazo) ? prazo : null,
      cancelamento: /^SIM$/i.test(m[9]),
    });
  }
  if (rows.length === 0) throw new BbtsPdfError("Nenhuma proposta de crédito reconhecida no PDF.");

  // Sem produto NENHUM = a leitura por geometria falhou (layout mudou). O roteamento
  // da auditoria depende disso -> falha VISÍVEL, não silenciosa.
  if (rows.every((r) => !r.produto && !r.categoria)) {
    throw new BbtsPdfError(
      "Nenhuma proposta trouxe produto/nome do convênio — a leitura por coluna falhou " +
        "(cabeçalho não reconhecido?). O roteamento da auditoria depende desses campos.",
    );
  }

  // self-âncora: Σ pag à vista extraída deve bater "Pagamento AVT".
  const somaPag = round2(rows.reduce((a, r) => a + (r.pag_avista || 0), 0));
  if (Math.abs(somaPag - pagAvistaAnchor) > 0.01) {
    throw new BbtsPdfError(
      `Crédito: Σ pag à vista extraída ${somaPag} ≠ âncora 'Pagamento AVT' ${pagAvistaAnchor} do PDF — extração inconsistente.`
    );
  }

  // ---- PRT: seção "Propostas do PAGAMENTO PRT" ----
  const prt: BbtsPrtRow[] = [];
  let emPrt = false;
  for (const ln of lines) {
    if (/Propostas do PAGAMENTO PRT/i.test(ln)) {
      emPrt = true;
      continue;
    }
    if (!emPrt) continue;
    // a seção acaba no próximo rótulo (Abertura de Conta / Tabela da SRCC)
    if (/^(Abertura de Conta|Tabela da SRCC)/i.test(ln)) break;
    const m = ln.match(PRT_RE);
    if (!m) continue;
    const qt = parseInt(String(m[5]).replace(/[^\d]/g, ""), 10); // "#N/D" -> NaN
    prt.push({
      contrato: m[1],
      data: m[2],
      n_parcela: Number(m[3]),
      valor_parcela: money(m[4]),
      qt_parcela: Number.isFinite(qt) ? qt : null,
    });
  }

  // self-âncora do PRT: Σ das parcelas deve bater "Pagamento PRT" do cabeçalho.
  const somaPrt = round2(prt.reduce((a, r) => a + (r.valor_parcela || 0), 0));
  if (Math.abs(somaPrt - pagPrtAnchor) > 0.01) {
    throw new BbtsPdfError(
      `PRT: Σ das parcelas extraída ${somaPrt} ≠ âncora 'Pagamento PRT' ${pagPrtAnchor} do PDF — extração inconsistente.`
    );
  }

  return { rows, prt, cabecalho, pagAvistaAnchor, pagPrtAnchor, year, month };
}

// ---- SEGURO -----------------------------------------------------------------
// Ex.: "212146378 24.000,00 108 ESTOQUE D0 82442550 4.594,71 POSITIVO 03Jun2026
//       JJ552710 0,10% R$ 24,00"  (cancelado: "… CANCELADO … -R$ 20,70")
// Exportada so para o gate de sinal. O `-?` do grupo 11 e o que faz a linha
// CANCELADA CASAR: sem ele a linha nao casaria e seria descartada em silencio.
export const SEGURO_RE =
  /^(\d{6,})\s+([\d.,]+)\s+(\d+)\s+(ESTOQUE D0|ESTOQUE|SLIP NOVO|SLIP)\s+(\d+)\s+([\d.,]+)\s+(POSITIVO|CANCELADO)\s+(\S+)\s+(JJ\d+)\s+([\d.,]+)%\s+(-?R\$\s*[\d.,]+)\s*$/i;

export type SeguroExtract = { rows: BbtsSeguroRow[]; totalAnchor: number };

export async function extractBbtsSeguroPdf(data: Uint8Array): Promise<SeguroExtract> {
  const lines = await extractLinesFromPdf(data);
  if (lines.length === 0) {
    throw new BbtsPdfError("PDF de seguro sem texto (imagem/escaneado?) — extração abortada.");
  }

  // âncora: cabeçalho "… PAGAMENTO DESCONTO TOTAL" → valores na próxima linha; ÚLTIMO R$ = TOTAL.
  let totalAnchor = NaN;
  for (let i = 0; i < lines.length; i++) {
    if (/PAGAMENTO\s+DESCONTO\s+TOTAL/i.test(lines[i])) {
      const vals = moneysIn(lines[i + 1] || "");
      if (vals.length) totalAnchor = vals[vals.length - 1];
      break;
    }
  }
  if (!Number.isFinite(totalAnchor)) {
    throw new BbtsPdfError("Âncora 'TOTAL' (Valor para Emissão da Nota Fiscal) não encontrada no PDF de seguro.");
  }

  const rows: BbtsSeguroRow[] = [];
  for (const ln of lines) {
    const m = ln.match(SEGURO_RE);
    if (!m) continue;
    const cancelado = /CANCELADO/i.test(m[7]);
    rows.push({
      contrato: m[1],
      valor_total_credito: money(m[2]),
      tipo: m[4].toUpperCase(),
      valor_seguro: money(m[11]),
      tratamento: cancelado ? "debito" : "calculo",
    });
  }
  if (rows.length === 0) throw new BbtsPdfError("Nenhuma linha de seguro reconhecida no PDF.");

  // self-âncora: Σ pagamento (calculo + debito) deve bater o "TOTAL" do PDF.
  const somaTotal = round2(rows.reduce((a, r) => a + (r.valor_seguro || 0), 0));
  if (Math.abs(somaTotal - totalAnchor) > 0.01) {
    throw new BbtsPdfError(
      `Seguro: Σ pagamento extraída ${somaTotal} ≠ âncora 'TOTAL' ${totalAnchor} do PDF — extração inconsistente.`
    );
  }
  return { rows, totalAnchor };
}

// ---- combinação → BbtsClosingInput (o que bbtsClosingImport consome) ---------

/**
 * Extrai os DOIS PDFs (crédito + seguro) e monta o BbtsClosingInput com _ancoras
 * self-describing. As âncoras internas (Pagamento AVT / TOTAL) já foram validadas
 * em cada extrator. O gate FINAL (propostas / Σ vfin / Σ pag / Σ seguro cálculo)
 * é o do próprio importBbtsClosing, que ABORTA sem gravar se não fechar.
 */
export async function extractBbtsClosingFromPdfs(
  creditoData: Uint8Array,
  seguroData: Uint8Array | null
): Promise<BbtsClosingInput> {
  const cred = await extractBbtsCreditoPdf(creditoData);
  const seg = seguroData ? await extractBbtsSeguroPdf(seguroData) : { rows: [] as BbtsSeguroRow[], totalAnchor: 0 };

  const somaVfin = round2(cred.rows.reduce((a, r) => a + (Number(r.valor_financiado) || 0), 0));
  const somaPag = round2(cred.rows.reduce((a, r) => a + (Number(r.pag_avista) || 0), 0));
  const somaSeguroCalculo = round2(
    seg.rows.filter((r) => r.tratamento === "calculo").reduce((a, r) => a + (Number(r.valor_seguro) || 0), 0)
  );

  return {
    year: cred.year,
    month: cred.month,
    credito: cred.rows,
    seguro: seg.rows,
    prt: cred.prt,
    cabecalho: cred.cabecalho,
    // AUSENCIA != ZERO. As ancoras saem do proprio arquivo, entao sem esta
    // bandeira "nao mandaram o PDF de seguro" e "mandaram e nao tinha seguro"
    // sao a MESMA coisa para o gate. Ver BbtsClosingInput.seguro_pdf_ausente.
    seguro_pdf_ausente: seguroData === null,
    _ancoras: {
      credito_propostas: cred.rows.length,
      credito_valor_financiado: somaVfin,
      credito_pag_avista: somaPag,
      seguro_calculo: somaSeguroCalculo,
      // O TOTAL DO CABECALHO — a ancora do DEPOSITO, que ate 30/08/2026 era lida,
      // conferida (:568-572) e jogada fora aqui. `seguro_calculo` e so a soma das
      // linhas POSITIVAS; `seguro_total` e o que a BBTS efetivamente depositou,
      // ja liquido do estorno. Em julho/2026: 204,52 e 155,07.
      // Sem o PDF de seguro o extrator devolve totalAnchor=0; nesse caso a ancora
      // e OMITIDA em vez de virar zero — "nao mandaram o PDF" e "mandaram e nao
      // tinha seguro" nao podem colapsar no mesmo numero (mesma razao do
      // seguro_pdf_ausente logo acima).
      ...(seguroData === null ? {} : { seguro_total: round2(seg.totalAnchor) }),
      prt_valor: cred.pagPrtAnchor,
    },
  };
}
