/* READ-ONLY. Existe rodape com Estoque D0 / Slip / Portabilidade INSS no PDF de CREDITO? */
require("./_ts_register.cjs");
const fs = require("fs");
const D="C:/Users/diego/Downloads/";
(async()=>{
  const { extractLinesFromPdf } = require("../lib/trp/parseTrpPdf.ts");
  const { extractText, getDocumentProxy } = require("unpdf");
  for (const nome of ["pdf (1).pdf","pdf.pdf","Crédito ADS-BBTS.pdf"]) {
    const p = D+nome;
    const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(p)));
    const { text } = await extractText(doc, { mergePages: true });
    const t = String(text);
    console.log(`\n########## ${nome} ##########`);
    for (const termo of ["Estoque","ESTOQUE","Slip","SLIP","Portabilidade","PORTABILIDADE","INSS","3.338","3338","Rodape","Resumo","Totais"]) {
      const i = t.indexOf(termo);
      if (i>=0) console.log(`  "${termo}" -> indice ${i}  ...${JSON.stringify(t.slice(Math.max(0,i-70), i+90))}`);
    }
    const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync(p)));
    console.log(`  -- ULTIMAS 12 LINHAS (o rodape) --`);
    for (const ln of lines.slice(-12)) console.log("     " + ln.trim().slice(0,150));
  }
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
