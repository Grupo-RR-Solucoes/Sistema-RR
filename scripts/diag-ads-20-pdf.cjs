/* READ-ONLY. Roda o extrator do repo sobre os 2 PDFs reais. Nao grava nada. */
require("./_ts_register.cjs");
const fs = require("fs");
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const CRED = "C:/Users/diego/Downloads/pdf (1).pdf";
const SEG  = "C:/Users/diego/Downloads/pdf.pdf";

(async()=>{
  const { extractBbtsClosingFromPdfs } = require("../lib/bbtsPdfExtract.ts");
  const input = await extractBbtsClosingFromPdfs(
    new Uint8Array(fs.readFileSync(CRED)),
    new Uint8Array(fs.readFileSync(SEG))
  );
  console.log("=== competencia lida do PDF: " + input.year + "-" + String(input.month).padStart(2,"0") + " ===");
  console.log("\n=== _ancoras (o que o proprio extrator declara) ===");
  console.log(JSON.stringify(input._ancoras, null, 2));

  console.log("\n=== CREDITO ===");
  console.log("linhas: " + input.credito.length);
  console.log("Sigma valor_financiado : " + f(input.credito.reduce((s,r)=>s+n(r.valor_financiado),0)));
  console.log("Sigma pag_avista       : " + f(input.credito.reduce((s,r)=>s+n(r.pag_avista),0)));

  console.log("\n=== PRT ===");
  const prt = input.prt || [];
  console.log("linhas: " + prt.length + " | Sigma valor_parcela: " + f(prt.reduce((s,r)=>s+n(r.valor_parcela),0)));

  console.log("\n=== SEGURO ===");
  const seg = input.seguro || [];
  console.log("linhas: " + seg.length);
  const porTrat = {};
  for (const s of seg) { const k = s.tratamento ?? "(null)"; const b = porTrat[k] || (porTrat[k]={n:0,v:0}); b.n++; b.v += n(s.valor_seguro); }
  console.log("tratamento | linhas | Sigma valor_seguro");
  for (const [k,b] of Object.entries(porTrat).sort()) console.log(`${k} | ${b.n} | ${f(b.v)}`);
  console.log("Sigma TOTAL do seguro (todos os tratamentos): " + f(seg.reduce((s,r)=>s+n(r.valor_seguro),0)));
  const neg = seg.filter(s=>n(s.valor_seguro)<0);
  console.log("\nlinhas NEGATIVAS (canceladas): " + neg.length + " | Sigma: " + f(neg.reduce((s,r)=>s+n(r.valor_seguro),0)));
  for (const s of neg) console.log(`   contrato=${s.contrato} | valor=${f(s.valor_seguro)} | tratamento=${s.tratamento} | tipo=${s.tipo}`);
  console.log("\n-- todas as linhas de seguro --");
  for (const s of seg) console.log(`   ${s.contrato} | ${f(s.valor_seguro)} | trat=${s.tratamento} | tipo=${s.tipo} | base=${f(s.valor_total_credito)}`);
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
