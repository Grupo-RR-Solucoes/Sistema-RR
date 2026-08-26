/* READ-ONLY. O cabecalho de totais e ESTAVEL entre competencias? */
require("./_ts_register.cjs");
const fs = require("fs");
const D = "C:/Users/diego/Downloads/";
(async()=>{
  const { extractText, getDocumentProxy } = require("unpdf");
  for (const nome of ["Crédito ADS-BBTS.pdf","pdf (1).pdf","ADS 40,56 MAIO.pdf","ADS COMPLEMENTAR JUNHO 1.698,54.pdf","Tabela_de_Pagamento_CréditoPF_Prestamista_30__anonymous.pdf"]) {
    const p = D + nome;
    if (!fs.existsSync(p)) { console.log(`\n### ${nome} — NAO EXISTE`); continue; }
    const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(p)));
    const { text } = await extractText(doc, { mergePages: true });
    const t = String(text).replace(/\s+/g," ");
    console.log(`\n########## ${nome} ##########`);
    const i = t.indexOf("Pagamento AVT");
    if (i >= 0) console.log("  CABECALHO: " + JSON.stringify(t.slice(i, i+200)));
    else console.log("  (sem 'Pagamento AVT') primeiros 300 chars: " + JSON.stringify(t.slice(0,300)));
  }
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
