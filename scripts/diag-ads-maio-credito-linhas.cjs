/* FASE A p4 (parte 3) — o credito de MAIO: quantas linhas de dado existem e
 * quantas a CREDITO_RE reconhece. READ-ONLY. */
require("./_ts_register.cjs");
const fs = require("fs");
(async () => {
  const { extractLinesFromPdf } = require("@/lib/trp/parseTrpPdf.ts");
  const { CREDITO_RE } = require("@/lib/bbtsPdfExtract.ts");
  for (const arq of ["ADS Maio 2026.pdf", "ADS Abril 2026.pdf"]) {
    const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/" + arq)));
    console.log(`\n##### ${arq}`);
    const cand = lines.map((l, i) => [i, l]).filter(([, l]) => /^\d{6,}\s+R\$/.test(l));
    console.log(`  candidatas (^digitos + R$): ${cand.length} | casam CREDITO_RE: ${cand.filter(([, l]) => CREDITO_RE.test(l)).length}`);
    let soma = 0, somaTodas = 0;
    for (const [i, l] of cand) {
      const ok = CREDITO_RE.test(l);
      const m = l.match(CREDITO_RE);
      if (m) soma += Number(String(m[3]).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) || 0;
      const vals = (l.match(/-?R\$\s*-?[\d.,]*/g) || []);
      if (vals[1]) somaTodas += Number(String(vals[1]).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) || 0;
      if (!ok) console.log(`   NAO CASA [${i}] ${JSON.stringify(l).slice(0, 260)}`);
    }
    console.log(`  soma pag_avista das que CASAM: ${soma.toFixed(2)}`);
    console.log(`  soma do 2o R$ de TODAS as candidatas: ${somaTodas.toFixed(2)}`);
  }
})();
