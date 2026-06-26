// Helper GENÉRICO de .xlsx no padrão visual navy do Grupo RR (relatório
// profissional), data-agnóstico e reutilizável (anexo à vista, PRT, etc).
//
// Por que exceljs e não a SheetJS (xlsx) já usada em lib/report.ts: a SheetJS
// Community NÃO escreve estilo de célula (fill/fonte/borda) — o write path tem
// um literal `/* TODO: cell style */` e emite styles.xml fixo. Mantemos a
// SheetJS onde já roda; aqui usamos exceljs (pure-JS, runtime nodejs, gera
// Buffer) que cobre fill, fonte, borda, numFmt, autofilter e freeze panes.
//
// A paleta espelha lib/minutas/docxBuilder.ts (NAVY 0F1F4A) para que .docx e
// .xlsx da mesma minuta tenham identidade visual consistente.
import ExcelJS from "exceljs";

// ARGB (exceljs usa AARRGGBB; AA=FF opaco). Espelha docxBuilder.ts.
const NAVY = "FF0F1F4A";
const AMARELO = "FFFFF000";
const DOURADO = "FFD6A13F";
const BRANCO = "FFFFFFFF";
const INK = "FF1A1A1A";
const BORDA = "FFC9CEDA";
const ZEBRA = "FFF4F6FA"; // fundo bem claro das linhas alternadas

export type FormatoCol = "texto" | "moeda" | "percent" | "numero" | "data";

export interface Coluna {
  /** Chave da linha (objeto) de onde sai o valor desta coluna. */
  chave: string;
  /** Cabeçalho exibido. */
  titulo: string;
  /** Largura fixa (caracteres). Se ausente, auto pelo maior conteúdo. */
  largura?: number;
  /** Tipo de formatação → numFmt + alinhamento default. */
  formato: FormatoCol;
  /** Sobrescreve o alinhamento default do formato. */
  alinhamento?: "esquerda" | "direita" | "centro";
}

export interface Aba {
  /** Nome da aba (será sanitizado: ≤31 chars, sem : \ / ? * [ ]). */
  nome: string;
  /** Título do banner (linha 1, mesclada). */
  titulo: string;
  /** Colunas (ordem = ordem na planilha). */
  colunas: Coluna[];
  /** Linhas de dados (cada objeto chaveado por Coluna.chave). */
  linhas: Array<Record<string, unknown>>;
  /** Linha TOTAL opcional (modo tabela): valores por chave, acento dourado. */
  totais?: Record<string, unknown>;
  /** 'tabela' = grade com header+autofilter+freeze; 'kpi' = label/valor vertical. */
  modo: "tabela" | "kpi";
}

const NUM_FMT: Record<FormatoCol, string | undefined> = {
  texto: undefined,
  moeda: 'R$ #,##0.00',
  percent: '0.00%',
  numero: '#,##0',
  data: 'dd/mm/yyyy',
};

function alinhamentoDe(col: Coluna): "left" | "right" | "center" {
  if (col.alinhamento === "esquerda") return "left";
  if (col.alinhamento === "direita") return "right";
  if (col.alinhamento === "centro") return "center";
  // Default por formato: numéricos à direita, resto à esquerda.
  return col.formato === "moeda" || col.formato === "percent" || col.formato === "numero"
    ? "right"
    : "left";
}

const BORDA_FINA: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDA } },
  left: { style: "thin", color: { argb: BORDA } },
  bottom: { style: "thin", color: { argb: BORDA } },
  right: { style: "thin", color: { argb: BORDA } },
};

/** Nome de aba válido no Excel: ≤31 chars, sem : \ / ? * [ ]. */
export function sanitizarNomeAba(nome: string): string {
  const limpo = nome.replace(/[:\\/?*[\]]/g, " ").trim().replace(/\s+/g, " ");
  return (limpo || "Planilha").slice(0, 31);
}

// Aplica valor + formato numérico a uma célula. Números são gravados como
// NÚMERO REAL (filtrável/somável); só o numFmt muda a exibição. % grava a
// fração (0,1234) com numFmt '0.00%' — o usuário passa o valor já em fração.
function escreverCelula(cell: ExcelJS.Cell, valor: unknown, col: Coluna) {
  const fmt = NUM_FMT[col.formato];
  if (
    (col.formato === "moeda" || col.formato === "percent" || col.formato === "numero") &&
    typeof valor === "number" &&
    Number.isFinite(valor)
  ) {
    cell.value = valor;
    if (fmt) cell.numFmt = fmt;
  } else if (col.formato === "data" && valor instanceof Date) {
    cell.value = valor;
    if (fmt) cell.numFmt = fmt;
  } else {
    // texto, ou numérico ausente/vazio → string (ou vazio).
    cell.value = valor == null || valor === "" ? null : String(valor);
  }
  cell.alignment = { horizontal: alinhamentoDe(col), vertical: "middle" };
}

// Largura: explícita, ou auto pelo maior conteúdo (título + valores), com
// folga e teto. Para colunas de moeda dá um mínimo confortável.
function larguraColuna(col: Coluna, linhas: Array<Record<string, unknown>>): number {
  if (col.largura != null) return col.largura;
  let max = col.titulo.length;
  for (const linha of linhas) {
    const v = linha[col.chave];
    const txt =
      v == null
        ? ""
        : col.formato === "moeda"
          ? `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
          : String(v);
    if (txt.length > max) max = txt.length;
  }
  const base = col.formato === "moeda" ? Math.max(max + 2, 14) : max + 2;
  return Math.min(Math.max(base, 10), 48);
}

// ---- Aba modo TABELA: banner + header(navy, autofilter, freeze) + zebra + TOTAL.
function montarAbaTabela(ws: ExcelJS.Worksheet, aba: Aba) {
  const nCols = aba.colunas.length;

  // Larguras.
  aba.colunas.forEach((col, i) => {
    ws.getColumn(i + 1).width = larguraColuna(col, aba.linhas);
  });

  // Linha 1: banner mesclado.
  ws.mergeCells(1, 1, 1, nCols);
  const banner = ws.getCell(1, 1);
  banner.value = aba.titulo;
  banner.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  banner.font = { name: "Calibri", size: 14, bold: true, color: { argb: BRANCO } };
  banner.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(1).height = 26;

  // Linha 2: header das colunas.
  const headerRow = ws.getRow(2);
  aba.colunas.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.titulo;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: BRANCO } };
    cell.alignment = { horizontal: alinhamentoDe(col), vertical: "middle", wrapText: true };
    cell.border = BORDA_FINA;
  });
  headerRow.height = 20;

  // Linhas de dados (zebra nas pares relativas).
  aba.linhas.forEach((linha, idx) => {
    const row = ws.getRow(3 + idx);
    const zebra = idx % 2 === 1;
    aba.colunas.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      escreverCelula(cell, linha[col.chave], col);
      cell.font = { name: "Calibri", size: 10, color: { argb: INK } };
      cell.border = BORDA_FINA;
      if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      }
    });
  });

  // Linha TOTAL (dourado/bold).
  if (aba.totais) {
    const totalRow = ws.getRow(3 + aba.linhas.length);
    aba.colunas.forEach((col, i) => {
      const cell = totalRow.getCell(i + 1);
      escreverCelula(cell, aba.totais![col.chave], col);
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: NAVY } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DOURADO } };
      cell.border = BORDA_FINA;
    });
    totalRow.height = 18;
  }

  // Autofiltro na faixa do header + freeze (congela banner + header).
  const lastCol = ws.getColumn(nCols).letter;
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: nCols } };
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 2, showGridLines: false }];
  // marca lastCol como usado para evitar lint de variável não lida
  void lastCol;
}

// ---- Aba modo KPI: banner + pares label/valor empilhados (Resumo Executivo).
function montarAbaKpi(ws: ExcelJS.Worksheet, aba: Aba) {
  ws.getColumn(1).width = 32;
  ws.getColumn(2).width = 30;

  // Banner mesclado nas 2 colunas.
  ws.mergeCells(1, 1, 1, 2);
  const banner = ws.getCell(1, 1);
  banner.value = aba.titulo;
  banner.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  banner.font = { name: "Calibri", size: 14, bold: true, color: { argb: BRANCO } };
  banner.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(1).height = 26;

  // Cada coluna = um KPI (chave = label, formato define a exibição do valor).
  aba.colunas.forEach((col, idx) => {
    const row = ws.getRow(3 + idx);
    const labelCell = row.getCell(1);
    labelCell.value = col.titulo;
    labelCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: NAVY } };
    labelCell.alignment = { horizontal: "left", vertical: "middle" };
    labelCell.border = BORDA_FINA;

    const valCell = row.getCell(2);
    // Em KPI a única linha de dados é aba.linhas[0] (chaveada por col.chave).
    escreverCelula(valCell, aba.linhas[0]?.[col.chave], { ...col, alinhamento: "esquerda" });
    valCell.font = { name: "Calibri", size: 11, color: { argb: INK } };
    valCell.border = BORDA_FINA;
    row.height = 18;
  });

  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1, showGridLines: false }];
}

/**
 * Constrói um .xlsx no padrão navy com N abas e retorna o Buffer. Não conhece
 * domínio nenhum — quem chama monta as abas (KPI e/ou tabela).
 */
export async function construirXlsxNavy(input: { abas: Aba[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Grupo RR";

  const usados = new Set<string>();
  for (const aba of input.abas) {
    // Dedup de nome (Excel não aceita abas com nome repetido).
    let nome = sanitizarNomeAba(aba.nome);
    if (usados.has(nome.toLowerCase())) {
      const base = nome.slice(0, 28);
      let n = 2;
      while (usados.has(`${base} ${n}`.toLowerCase())) n++;
      nome = `${base} ${n}`;
    }
    usados.add(nome.toLowerCase());

    const ws = wb.addWorksheet(nome, {
      views: [{ showGridLines: false }],
    });
    if (aba.modo === "kpi") montarAbaKpi(ws, aba);
    else montarAbaTabela(ws, aba);
  }

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}
