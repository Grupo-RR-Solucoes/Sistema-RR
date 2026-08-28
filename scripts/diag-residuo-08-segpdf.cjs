/* READ-ONLY. O PDF de seguro de julho: ancora TOTAL, linhas 'calculo', e quais
   contratos batem com credito do MESMO PDF de credito. */
require("./_ts_register.cjs");
const fs = require("fs");
(async () => {
  const { extractBbtsSeguroPdf, extractBbtsCreditoPdf } = require("../lib/bbtsPdfExtract.ts");
  const seg = await extractBbtsSeguroPdf(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf.pdf")));
  const cred = await extractBbtsCreditoPdf(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf (1).pdf")));
  const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  console.log(`SEGURO 07/26 — linhas=${seg.rows.length}  ancora TOTAL=${f(seg.totalAnchor)}`);
  const porTrat = new Map();
  for (const r of seg.rows) porTrat.set(r.tratamento, (porTrat.get(r.tratamento) || 0) + 1);
  console.log(`  tratamentos: ${[...porTrat].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  const contratosCred = new Set(cred.rows.map((r) => String(r.contrato).trim()));
  let comCred = 0, semCred = 0, vComCred = 0, vSemCred = 0;
  console.log(`\n  contrato        valor_seguro  tratamento   tem credito no PDF de credito?`);
  for (const r of seg.rows) {
    const tem = contratosCred.has(String(r.contrato).trim());
    if (r.tratamento === "calculo") { if (tem) { comCred++; vComCred += Number(r.valor_seguro) || 0; } else { semCred++; vSemCred += Number(r.valor_seguro) || 0; } }
    console.log(`  ${String(r.contrato).padEnd(14)} ${f(r.valor_seguro).padStart(10)}   ${String(r.tratamento).padEnd(10)}  ${tem ? "SIM" : "NAO  <-- SO-SEGURO"}`);
  }
  console.log(`\n  'calculo' COM credito: ${comCred} linhas, Σ ${f(vComCred)}`);
  console.log(`  'calculo' SEM credito: ${semCred} linhas, Σ ${f(vSemCred)}   <-- o bloco so-seguro`);
  console.log(`  Σ total 'calculo' = ${f(vComCred + vSemCred)}   (ancora TOTAL do PDF = ${f(seg.totalAnchor)})`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
