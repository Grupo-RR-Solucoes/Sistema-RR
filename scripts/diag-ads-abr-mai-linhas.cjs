/* FASE A pergunta 4 (parte 2) — POR QUE cada PDF e recusado. READ-ONLY.
 * Despeja as linhas cruas nas zonas que as ancoras/regex procuram e testa as
 * regex de producao linha a linha, para a recusa virar CAUSA e nao sintoma. */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const DL = "C:/Users/diego/Downloads";

(async () => {
  const { extractLinesFromPdf } = require("@/lib/trp/parseTrpPdf.ts");
  const { SEGURO_RE, CREDITO_RE } = require("@/lib/bbtsPdfExtract.ts");
  const PRT_RE = /^(\d{6,})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(-?R\$\s*[\d.,]+)\s*(.*)$/;

  const casos = [
    ["SEGURO ABRIL", "Seguro ADS Abril 2026.pdf", "seguro"],
    ["SEGURO MAIO", "Seguro ADs Maio 2026.pdf", "seguro"],
    ["CREDITO MAIO", "ADS Maio 2026.pdf", "credito"],
    ["CREDITO ABRIL (referencia, passa)", "ADS Abril 2026.pdf", "credito"],
  ];

  for (const [rot, arq, tipo] of casos) {
    console.log(`\n########## ${rot} — ${arq}`);
    const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync(path.join(DL, arq))));
    console.log(`  total de linhas: ${lines.length}`);

    if (tipo === "seguro") {
      console.log("  --- linhas com 'PAGAMENTO' / 'DESCONTO' / 'TOTAL' / 'Nota Fiscal' ---");
      lines.forEach((l, i) => {
        if (/PAGAMENTO|DESCONTO|TOTAL|Nota Fiscal|Emiss/i.test(l))
          console.log(`   [${i}] ${JSON.stringify(l).slice(0, 240)}`);
      });
      console.log("  --- candidatas a linha de dado (comeca com >=6 digitos) ---");
      let n = 0;
      lines.forEach((l, i) => {
        if (!/^\d{6,}\s/.test(l)) return;
        n++;
        if (n <= 6) console.log(`   [${i}] casa=${SEGURO_RE.test(l)} ${JSON.stringify(l).slice(0, 300)}`);
      });
      console.log(`   ...total de candidatas: ${n} | que CASAM: ${lines.filter(l => SEGURO_RE.test(l)).length}`);
      console.log("  --- cabecalho de colunas (linha com 'Chave' ou 'Movimenta') ---");
      lines.forEach((l, i) => { if (/Movimenta|Chave|Ap[oó]lice|S[ií]tuac|Situa/i.test(l)) console.log(`   [${i}] ${JSON.stringify(l).slice(0, 300)}`); });
    } else {
      console.log("  --- secao PRT ---");
      const idx = lines.findIndex(l => /Propostas do PAGAMENTO PRT/i.test(l));
      console.log(`   indice do rotulo 'Propostas do PAGAMENTO PRT': ${idx}`);
      if (idx >= 0) {
        for (let i = idx; i < Math.min(idx + 14, lines.length); i++)
          console.log(`   [${i}] casaPRT=${PRT_RE.test(lines[i])} ${JSON.stringify(lines[i]).slice(0, 240)}`);
      }
      console.log("  --- toda linha que menciona PRT ---");
      lines.forEach((l, i) => { if (/\bPRT\b/i.test(l)) console.log(`   [${i}] ${JSON.stringify(l).slice(0, 240)}`); });
      console.log(`  --- linhas de credito que casam: ${lines.filter(l => CREDITO_RE.test(l)).length} ---`);
    }
  }
})();
