/* READ-ONLY. O que o parser VE nas linhas canceladas do PDF de seguro. */
require("./_ts_register.cjs");
const fs = require("fs");
const SEG = "C:/Users/diego/Downloads/pdf.pdf";
const SEGURO_RE = /^(\d{6,})\s+([\d.,]+)\s+(\d+)\s+(ESTOQUE D0|ESTOQUE|SLIP NOVO|SLIP)\s+(\d+)\s+([\d.,]+)\s+(POSITIVO|CANCELADO)\s+(\S+)\s+(JJ\d+)\s+([\d.,]+)%\s+(-?R\$\s*[\d.,]+)\s*$/i;
(async()=>{
  const { extractLinesFromPdf } = require("../lib/trp/parseTrpPdf.ts");
  const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync(SEG)));
  console.log("linhas de texto no PDF de seguro: " + lines.length);

  console.log("\n=== ancora do proprio PDF (PAGAMENTO DESCONTO TOTAL) ===");
  for (let i=0;i<lines.length;i++) if (/PAGAMENTO\s+DESCONTO\s+TOTAL/i.test(lines[i])) {
    console.log("  cabecalho: " + lines[i].trim());
    console.log("  valores  : " + String(lines[i+1]||"").trim());
    break;
  }

  console.log("\n=== TODAS as linhas que casam SEGURO_RE, com os grupos ===");
  console.log("contrato | g7 (Tipo de Lancamento) | g11 (valor cru) | tratamento que o parser atribui");
  let nPos=0,nCan=0;
  for (const ln of lines) {
    const m = ln.match(SEGURO_RE);
    if (!m) continue;
    const cancelado = /CANCELADO/i.test(m[7]);
    cancelado ? nCan++ : nPos++;
    console.log(`${m[1]} | ${m[7]} | ${m[11]} | ${cancelado ? "debito" : "calculo"}`);
  }
  console.log(`\nPOSITIVO: ${nPos} | CANCELADO: ${nCan}`);

  console.log("\n=== as 3 linhas CANCELADAS, TEXTO CRU COMPLETO ===");
  for (const ln of lines) {
    const m = ln.match(SEGURO_RE);
    if (m && /CANCELADO/i.test(m[7])) console.log("  " + ln.trim());
  }

  console.log("\n=== o sinal e o rotulo concordam sempre? ===");
  let discord = 0;
  for (const ln of lines) {
    const m = ln.match(SEGURO_RE);
    if (!m) continue;
    const cancelado = /CANCELADO/i.test(m[7]);
    const negativo = /^-/.test(m[11].trim());
    if (cancelado !== negativo) { discord++; console.log(`  DISCORDA: ${m[1]} | rotulo=${m[7]} | valor=${m[11]}`); }
  }
  console.log(discord === 0 ? "  rotulo e sinal concordam em 100% das linhas" : `  ${discord} linha(s) discordam`);
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
