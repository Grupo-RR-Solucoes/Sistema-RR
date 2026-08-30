/* Acha, entre os PDFs em disco, quais sao FECHAMENTOS de seguro da ADS — para
 * provar NAO-REGRESSAO do conserto contra junho e julho. READ-ONLY. */
require("./_ts_register.cjs");
const fs = require("fs");
(async () => {
  const { extractLinesFromPdf } = require("@/lib/trp/parseTrpPdf.ts");
  const DL = "C:/Users/diego/Downloads";
  for (const f of fs.readdirSync(DL).filter(f => /\.pdf$/i.test(f))) {
    let lines;
    try { lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync(DL + "/" + f))); } catch { continue; }
    const ehSeguro = lines.some(l => /propostas de seguros/i.test(l));
    if (!ehSeguro) continue;
    const comp = lines.find(l => /m[eê]s\s+\d{2}\/\d{2}/i.test(l));
    const cab = lines.find(l => /^CNPJ\s+RAZ/i.test(l));
    const dados = lines.filter(l => /^\d{6,9}\s/.test(l)).length;
    console.log(`${f}\n   comp=${comp ? comp.match(/m[eê]s\s+(\d{2}\/\d{2})/i)[1] : "?"} | cabecalho: ${JSON.stringify(cab)} | linhas de dado: ${dados}`);
  }
})();
