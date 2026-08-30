/* FASE A p5 (parte 2) — o PDF de seguro de JUNHO realmente traz os 2 contratos
 * como CANCELADO? E o de julho traz o 211689509? READ-ONLY, so PDFs. */
require("./_ts_register.cjs");
const fs = require("fs");
(async () => {
  const { extractLinesFromPdf } = require("@/lib/trp/parseTrpPdf.ts");
  const ORF = ["209621970", "209867885", "211689509"];
  for (const arq of ["ADS 58,11 JUNHO.pdf", "ADS COMPLEMENTAR JUNHO 1.698,54.pdf", "ADS JUNHO 7.714,04.pdf", "ADS JULHO 18.844,34.pdf", "Crédito ADS-BBTS.pdf"]) {
    const p = "C:/Users/diego/Downloads/" + arq;
    if (!fs.existsSync(p)) { console.log(`\n### ${arq} — NAO EXISTE`); continue; }
    const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync(p)));
    console.log(`\n### ${arq} (${lines.length} linhas)`);
    const comp = lines.find(l => /m[eê]s\s+\d{2}\/\d{2}/i.test(l));
    console.log(`   competencia no documento: ${comp ? comp.match(/m[eê]s\s+(\d{2}\/\d{2})/i)[1] : "?"}`);
    let achou = false;
    for (const l of lines) for (const o of ORF) if (l.includes(o)) { console.log(`   ${JSON.stringify(l).slice(0, 250)}`); achou = true; }
    if (!achou) console.log("   nenhum dos 3.");
  }
})();
