import PDFDocument from "pdfkit";

export function gerarRelatorio(fechamento: any[]) {
  const doc = new PDFDocument();

  fechamento.forEach((f) => {
    doc.text(`Empresa: ${f.empresa_cnpj}`);
    doc.text(`À Vista: ${f.valor_avista}`);
    doc.text(`Diferido: ${f.valor_diferido}`);
    doc.text(`Seguro: ${f.valor_seguro}`);
    doc.text(`Total: ${f.valor_liquido}`);
    doc.moveDown();
  });

  doc.end();

  return doc;
}
