/* FASE A p4 (parte 4) — de onde sai o CARIMBO: a competencia e lida SO do PDF
 * de credito (rotulo "mes MM/AA"). Confere o rotulo nos 4 documentos. READ-ONLY. */
require("./_ts_register.cjs");
const fs = require("fs");
(async () => {
  const { extractLinesFromPdf } = require("@/lib/trp/parseTrpPdf.ts");
  for (const arq of ["ADS Abril 2026.pdf", "Seguro ADS Abril 2026.pdf", "ADS Maio 2026.pdf", "Seguro ADs Maio 2026.pdf"]) {
    const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/" + arq)));
    const hit = lines.find(l => /m[eê]s\s+(\d{2})\/(\d{2})/i.test(l));
    const m = hit && hit.match(/m[eê]s\s+(\d{2})\/(\d{2})/i);
    console.log(`  ${arq.padEnd(28)} -> ${m ? `mes ${m[1]}/${m[2]} => carimbo 20${m[2]}-${m[1]}-01, movement_date 20${m[2]}-${m[1]}-15` : "SEM rotulo de competencia"}`);
    if (hit) console.log(`      linha: ${JSON.stringify(hit).slice(0,140)}`);
  }
})();
