import PDFDocument from "pdfkit";

export function gerarRelatorio(fechamento: any[]) {
  const doc = new PDFDocument();

  fechamento.forEach((f) => {
    doc.text(`Empresa: ${f.empresa_cnpj}`);
    doc.text(`Total: ${f.valor_liquido}`);
    doc.moveDown();
  });

  doc.end();

  return doc;
}
