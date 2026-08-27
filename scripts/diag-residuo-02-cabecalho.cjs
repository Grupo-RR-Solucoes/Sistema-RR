/* READ-ONLY. O cabecalho "Valor para Emissao da Nota Fiscal" dos PDFs de credito
   da ADS, nas DUAS visoes:
   (A) por LINHA — exatamente o que extractLinesFromPdf entrega ao parser hoje;
   (B) por GEOMETRIA — cada fragmento com x,y, para parear ROTULO x VALOR. */
require("./_ts_register.cjs");
const fs = require("fs");

const PDFS = [
  ["2026-06", "C:/Users/diego/Downloads/Crédito ADS-BBTS.pdf"],
  ["2026-07", "C:/Users/diego/Downloads/pdf (1).pdf"],
];

(async () => {
  const { getDocumentProxy } = require("unpdf");
  const { extractLinesFromPdf } = require("../lib/trp/parseTrpPdf.ts");

  for (const [comp, f] of PDFS) {
    console.log("\n" + "=".repeat(78));
    console.log(`### ${comp}  —  ${f}`);
    console.log("=".repeat(78));

    // (A) visao por LINHA
    const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync(f)));
    const i = lines.findIndex((l) => /Pagamento\s+AVT/i.test(l));
    console.log(`\n--- (A) POR LINHA — indice da linha com "Pagamento AVT": ${i}`);
    for (let k = i - 2; k <= i + 3; k++) {
      if (k < 0 || k >= lines.length) continue;
      console.log(`  [${k}]${k === i ? " <ROTULOS>" : k === i + 1 ? " <VALORES lidos pelo parser>" : ""} ${JSON.stringify(lines[k])}`);
    }

    // (B) visao por GEOMETRIA
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(f)));
    const itens = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      for (const it of tc.items) {
        const s = (it.str ?? "").trim();
        if (s) itens.push({ p, x: it.transform[4], y: it.transform[5], s });
      }
    }
    const avt = itens.find((it) => /^Pagamento$/i.test(it.s) || /Pagamento\s*AVT/i.test(it.s));
    const yAvt = avt ? avt.y : null;
    console.log(`\n--- (B) GEOMETRIA — ancora "Pagamento" em p=${avt && avt.p} y=${yAvt}`);
    const banda = itens
      .filter((it) => it.p === (avt && avt.p) && yAvt !== null && Math.abs(it.y - yAvt) <= 32)
      .sort((a, b) => b.y - a.y || a.x - b.x);
    let yAtual = null;
    for (const it of banda) {
      if (yAtual === null || Math.abs(it.y - yAtual) > 0.6) { yAtual = it.y; console.log(`  --- y=${it.y.toFixed(1)}`); }
      console.log(`      x=${it.x.toFixed(1).padStart(7)}  ${JSON.stringify(it.s)}`);
    }
  }
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
