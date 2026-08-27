/* READ-ONLY. Prova do BLOCO 1: o extrator novo reproduz as ancoras antigas e
   captura a Abertura de Conta, nas DUAS competencias em disco. */
require("./_ts_register.cjs");
const fs = require("fs");
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PDFS = [["2026-06", "C:/Users/diego/Downloads/Crédito ADS-BBTS.pdf"], ["2026-07", "C:/Users/diego/Downloads/pdf (1).pdf"]];
(async () => {
  const { extractBbtsCreditoPdf } = require("../lib/bbtsPdfExtract.ts");
  for (const [comp, p] of PDFS) {
    const r = await extractBbtsCreditoPdf(new Uint8Array(fs.readFileSync(p)));
    console.log(`\n### ${comp}  (${r.year}-${String(r.month).padStart(2, "0")})  propostas=${r.rows.length}  prt=${r.prt.length}`);
    console.log(`  pagAvistaAnchor = ${f(r.pagAvistaAnchor)}   pagPrtAnchor = ${f(r.pagPrtAnchor)}`);
    console.log(`  cabecalho.rotulos (CRU, na ordem):`);
    for (const x of r.cabecalho.rotulos) console.log(`     ${String(x.rotulo).padEnd(20)} = ${f(x.valor).padStart(12)}`);
    console.log(`  -> pagamentoAvt=${f(r.cabecalho.pagamentoAvt)}  pagamentoPrt=${f(r.cabecalho.pagamentoPrt)}  aberturaConta=${f(r.cabecalho.aberturaConta)}  outrasDeducoes=${f(r.cabecalho.outrasDeducoes)}  pagamentoTotal=${f(r.cabecalho.pagamentoTotal)}`);
    const soma = r.cabecalho.pagamentoAvt + r.cabecalho.pagamentoPrt + r.cabecalho.aberturaConta + r.cabecalho.outrasDeducoes;
    console.log(`  IDENTIDADE: ${f(soma)} vs total ${f(r.cabecalho.pagamentoTotal)}  -> ${Math.abs(soma - r.cabecalho.pagamentoTotal) <= 0.01 ? "FECHA" : "NAO FECHA"}`);
  }
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
