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

import { extractLinesFromPdf } from "@/lib/trp/parseTrpPdf";
import type { BbtsClosingInput, BbtsCreditoRow, BbtsSeguroRow } from "@/lib/bbtsClosingImport";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// "R$ 5.000,00" / "R$ -" / "-R$ 20,70" / "24.000,00" -> number (respeita sinal).
function money(raw: unknown): number {
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
const CREDITO_RE =
  /^(\d{6,})\s+R\$\s*([\d.,]+)\s+(R\$\s*-|-?R\$\s*[\d.,]+)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.,]+)%\s+(\d)\s+(JJ\d+)\s+(.*?)\s+(N[ÃA]O|SIM)\s*$/i;

export type CreditoExtract = { rows: BbtsCreditoRow[]; pagAvistaAnchor: number; year: number; month: number };

export async function extractBbtsCreditoPdf(data: Uint8Array): Promise<CreditoExtract> {
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

  // âncora: linha "Pagamento AVT …" (rótulos) → valores na PRÓXIMA linha; 1º R$.
  let pagAvistaAnchor = NaN;
  for (let i = 0; i < lines.length; i++) {
    if (/Pagamento\s+AVT/i.test(lines[i])) {
      const vals = moneysIn(lines[i + 1] || "");
      if (vals.length) pagAvistaAnchor = vals[0];
      break;
    }
  }
  if (!Number.isFinite(pagAvistaAnchor)) {
    throw new BbtsPdfError("Âncora 'Pagamento AVT' não encontrada no PDF de crédito.");
  }

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

    rows.push({
      contrato: m[1],
      valor_financiado: money(m[2]),
      pag_avista: money(m[3]),
      data: m[4],
      taxa_relatorio: pct(m[5]),
      srcc_cd: Number(m[6]),
      chave_j: m[7],
      segmento,
      nr_convenio: nrConvenio,
      juros_mensal: Number.isFinite(jurosMensal) ? jurosMensal : null,
      parcelas: Number.isFinite(parcelas) ? parcelas : null,
      cancelamento: /^SIM$/i.test(m[9]),
    });
  }
  if (rows.length === 0) throw new BbtsPdfError("Nenhuma proposta de crédito reconhecida no PDF.");

  // self-âncora: Σ pag à vista extraída deve bater "Pagamento AVT".
  const somaPag = round2(rows.reduce((a, r) => a + (r.pag_avista || 0), 0));
  if (Math.abs(somaPag - pagAvistaAnchor) > 0.01) {
    throw new BbtsPdfError(
      `Crédito: Σ pag à vista extraída ${somaPag} ≠ âncora 'Pagamento AVT' ${pagAvistaAnchor} do PDF — extração inconsistente.`
    );
  }
  return { rows, pagAvistaAnchor, year, month };
}

// ---- SEGURO -----------------------------------------------------------------
// Ex.: "212146378 24.000,00 108 ESTOQUE D0 82442550 4.594,71 POSITIVO 03Jun2026
//       JJ552710 0,10% R$ 24,00"  (cancelado: "… CANCELADO … -R$ 20,70")
const SEGURO_RE =
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
    _ancoras: {
      credito_propostas: cred.rows.length,
      credito_valor_financiado: somaVfin,
      credito_pag_avista: somaPag,
      seguro_calculo: somaSeguroCalculo,
    },
  };
}
