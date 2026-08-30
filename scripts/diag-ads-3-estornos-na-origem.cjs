/* FASE A p5 — os 3 estornos "orfaos" aparecem nos PDFs de abril/maio? Com que
 * sinal? READ-ONLY, le so os PDFs. */
require("./_ts_register.cjs");
const fs = require("fs");
(async () => {
  const { extractLinesFromPdf } = require("@/lib/trp/parseTrpPdf.ts");
  const ORF = ["209621970", "209867885", "211689509"];
  for (const arq of ["Seguro ADS Abril 2026.pdf", "Seguro ADs Maio 2026.pdf", "ADS Abril 2026.pdf", "ADS Maio 2026.pdf"]) {
    const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/" + arq)));
    console.log(`\n### ${arq}`);
    let achou = false;
    for (const l of lines) for (const o of ORF) if (l.includes(o)) { console.log(`   ${JSON.stringify(l).slice(0, 260)}`); achou = true; }
    if (!achou) console.log("   nenhum dos 3.");
  }
  // e todas as 14 linhas do seguro de abril, para conferir a soma 213,47
  const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/Seguro ADS Abril 2026.pdf")));
  console.log("\n### todas as linhas de dado do seguro de ABRIL:");
  let soma = 0, n = 0;
  for (const l of lines) {
    if (!/^\d{6,9}\s/.test(l)) continue;
    const vals = l.match(/R\$\s*-?[\d.,]+/g) || [];
    const ult = vals[vals.length - 1];
    const v = Number(String(ult).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    soma += v; n++;
    console.log(`   ${l.match(/^(\d+)/)[1]} ultimo R$ = ${ult} | CANCELADO? ${/CANCELADO/i.test(l)}`);
  }
  console.log(`   -> ${n} contratos, soma dos ultimos R$ = ${soma.toFixed(2)} (ancora do PDF: 213,47)`);
})();
