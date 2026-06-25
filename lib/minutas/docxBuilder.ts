// Construtor genérico de .docx a partir do modelo Minuta. SEM regra de negócio:
// só conhece o modelo (tipos.ts) e o traduz para a lib `docx`. Formatação
// navy/profissional (Grupo RR): fonte serifada no corpo, headings navy em
// caixa-alta, tabela com cabeçalho navy preenchido e bordas finas.
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

import type {
  AlinhamentoColuna,
  Minuta,
  Paragrafo,
  Secao,
  Trecho,
} from "./tipos.ts";

const NAVY = "0F1F4A";
const INK = "1A1A1A";
const BORDER = "C9CEDA";
const FONT = "Georgia"; // serifada, documental
const FONT_TABELA = "Calibri";

const SIZE_BODY = 21; // half-points → 10.5pt
const SIZE_TITULO = 30; // 15pt
const SIZE_HEADING = 23; // 11.5pt
const SIZE_TABELA = 18; // 9pt

function alignMap(a: AlinhamentoColuna | undefined): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (a === "direita") return AlignmentType.RIGHT;
  if (a === "centro") return AlignmentType.CENTER;
  return AlignmentType.LEFT;
}

/** Converte um Paragrafo (string ou Trecho[]) em runs do docx. */
function runsDe(p: Paragrafo, opts?: { color?: string; size?: number; font?: string }): TextRun[] {
  const color = opts?.color ?? INK;
  const size = opts?.size ?? SIZE_BODY;
  const font = opts?.font ?? FONT;
  if (typeof p === "string") {
    return [new TextRun({ text: p, color, size, font })];
  }
  return p.map(
    (t: Trecho) =>
      new TextRun({
        text: t.texto,
        bold: t.negrito,
        italics: t.italico,
        color,
        size,
        font,
      })
  );
}

function paragrafo(p: Paragrafo, opts?: { spacingAfter?: number; align?: AlinhamentoColuna }): Paragraph {
  return new Paragraph({
    children: runsDe(p),
    alignment: alignMap(opts?.align),
    spacing: { after: opts?.spacingAfter ?? 120, line: 276 },
  });
}

function heading(texto: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: texto.toUpperCase(),
        bold: true,
        color: NAVY,
        size: SIZE_HEADING,
        font: FONT,
      }),
    ],
    spacing: { before: 240, after: 100 },
  });
}

function celula(
  texto: string,
  opts: { header?: boolean; align?: AlinhamentoColuna; widthPct?: number }
): TableCell {
  const color = opts.header ? "FFFFFF" : INK;
  return new TableCell({
    width: opts.widthPct ? { size: opts.widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header
      ? { type: ShadingType.CLEAR, color: "auto", fill: NAVY }
      : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: alignMap(opts.align),
        children: [
          new TextRun({
            text: texto,
            bold: opts.header,
            color,
            size: SIZE_TABELA,
            font: FONT_TABELA,
          }),
        ],
      }),
    ],
  });
}

function tabela(secao: Extract<Secao, { tipo: "tabela" }>): Table {
  const pesoTotal = secao.colunas.reduce((s, c) => s + (c.peso ?? 1), 0);
  const widthPct = secao.colunas.map((c) => ((c.peso ?? 1) / pesoTotal) * 100);

  const headerRow = new TableRow({
    tableHeader: true,
    children: secao.colunas.map((c, i) =>
      celula(c.titulo, { header: true, align: c.alinhamento, widthPct: widthPct[i] })
    ),
  });

  const bodyRows = secao.linhas.map(
    (linha) =>
      new TableRow({
        children: secao.colunas.map((c, i) =>
          celula(linha[i] ?? "", { align: c.alinhamento, widthPct: widthPct[i] })
        ),
      })
  );

  const borda = { style: BorderStyle.SINGLE, size: 2, color: BORDER };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: borda,
      bottom: borda,
      left: borda,
      right: borda,
      insideHorizontal: borda,
      insideVertical: borda,
    },
    rows: [headerRow, ...bodyRows],
  });
}

function blocosDeSecao(secao: Secao): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  if (secao.heading) out.push(heading(secao.heading));
  if (secao.tipo === "texto") {
    for (const p of secao.paragrafos) out.push(paragrafo(p));
  } else if (secao.tipo === "bullets") {
    for (const item of secao.itens) {
      out.push(
        new Paragraph({
          children: runsDe(item),
          bullet: { level: 0 },
          spacing: { after: 80, line: 276 },
        })
      );
    }
  } else {
    out.push(tabela(secao));
    if (secao.rodape) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: secao.rodape,
              italics: true,
              color: "5A6172",
              size: SIZE_TABELA,
              font: FONT,
            }),
          ],
          spacing: { before: 80, after: 120 },
        })
      );
    }
  }
  return out;
}

/** Renderiza uma Minuta em um Buffer .docx. Única responsabilidade. */
export async function construirDocx(m: Minuta): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  // Título
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({ text: m.titulo, bold: true, color: NAVY, size: SIZE_TITULO, font: FONT }),
      ],
    })
  );

  // Cabeçalho (destinatário, data, Ref.)
  for (const p of m.cabecalho) children.push(paragrafo(p, { spacingAfter: 80 }));
  children.push(new Paragraph({ text: "", spacing: { after: 120 } }));

  // Seções
  for (const secao of m.secoes) {
    for (const bloco of blocosDeSecao(secao)) children.push(bloco);
  }

  // Assinatura
  children.push(new Paragraph({ text: "", spacing: { before: 360 } }));
  for (const p of m.assinatura) children.push(paragrafo(p, { spacingAfter: 40 }));

  const doc = new Document({
    creator: "Grupo RR Soluções",
    title: m.titulo,
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE_BODY, color: INK } },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
