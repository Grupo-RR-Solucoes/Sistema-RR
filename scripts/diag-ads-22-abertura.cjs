/* READ-ONLY. O bloco de totais do PDF de credito, cru. */
require("./_ts_register.cjs");
const fs = require("fs");
(async()=>{
  const { extractText, getDocumentProxy } = require("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf (1).pdf")));
  const { text } = await extractText(doc, { mergePages: true });
  const t = String(text);
  for (const alvo of ["Abertura de Conta","Pagamento AVT","Pagamento PRT","Tabela da SRCC"]) {
    const i = t.indexOf(alvo);
    console.log(`\n=== "${alvo}" -> indice ${i} ===`);
    if (i >= 0) console.log(JSON.stringify(t.slice(Math.max(0,i-160), i+220)));
  }
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
