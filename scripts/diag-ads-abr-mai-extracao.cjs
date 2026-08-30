/* FASE A pergunta 4 — o extrator de PRODUCAO aceita os 4 PDFs de abr/mai da ADS?
 * READ-ONLY: nao toca banco, nao grava nada. So roda extractBbtsClosingFromPdfs
 * (o MESMO que a rota /api/import/closing/ads chama) e imprime o que saiu.
 * Escreve o resultado em JSON no scratchpad para os diags seguintes cruzarem
 * as propostas contra o daily sem reextrair. */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");

const DL = "C:/Users/diego/Downloads";
const OUT = process.env.OUT_DIR || ".";
const PARES = [
  ["abril", "ADS Abril 2026.pdf", "Seguro ADS Abril 2026.pdf"],
  ["maio", "ADS Maio 2026.pdf", "Seguro ADs Maio 2026.pdf"],
];

const brl = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { extractBbtsClosingFromPdfs, extractBbtsCreditoPdf, extractBbtsSeguroPdf } = require("@/lib/bbtsPdfExtract.ts");
  const dump = {};
  for (const [rotulo, fCred, fSeg] of PARES) {
    console.log(`\n=================== ${rotulo.toUpperCase()} ===================`);
    const pCred = path.join(DL, fCred), pSeg = path.join(DL, fSeg);
    for (const p of [pCred, pSeg]) {
      console.log(`  arquivo: ${path.basename(p)} — ${fs.existsSync(p) ? fs.statSync(p).size + " bytes" : "NAO EXISTE"}`);
    }
    if (!fs.existsSync(pCred) || !fs.existsSync(pSeg)) { console.log("  PULADO (arquivo ausente)"); continue; }

    // 1) credito isolado
    try {
      const c = await extractBbtsCreditoPdf(new Uint8Array(fs.readFileSync(pCred)));
      console.log(`  CREDITO  competencia lida: ${String(c.month).padStart(2,"0")}/${c.year}`);
      console.log(`           propostas reconhecidas: ${c.rows.length} | canceladas(SIM): ${c.rows.filter(r=>r.cancelamento).length}`);
      console.log(`           cabecalho NF: ${c.cabecalho.rotulos.map(x=>`${x.rotulo}=${brl(x.valor)}`).join(" | ")}`);
      console.log(`           AVT=${brl(c.cabecalho.pagamentoAvt)} PRT=${brl(c.cabecalho.pagamentoPrt)} Abertura=${brl(c.cabecalho.aberturaConta)} Total=${brl(c.cabecalho.pagamentoTotal)}`);
      console.log(`           linhas PRT: ${c.prt.length} (soma ${brl(c.prt.reduce((a,r)=>a+r.valor_parcela,0))})`);
      const semProduto = c.rows.filter(r=>!r.produto && !r.categoria).length;
      console.log(`           sem produto/convenio: ${semProduto}`);
    } catch (e) { console.log(`  CREDITO  LANCOU: ${e.message}`); }

    // 2) seguro isolado
    try {
      const s = await extractBbtsSeguroPdf(new Uint8Array(fs.readFileSync(pSeg)));
      console.log(`  SEGURO   linhas reconhecidas: ${s.rows.length} | ancora TOTAL=${brl(s.totalAnchor)}`);
      console.log(`           calculo(POSITIVO): ${s.rows.filter(r=>r.tratamento==="calculo").length} = ${brl(s.rows.filter(r=>r.tratamento==="calculo").reduce((a,r)=>a+r.valor_seguro,0))}`);
      console.log(`           debito(CANCELADO): ${s.rows.filter(r=>r.tratamento==="debito").length} = ${brl(s.rows.filter(r=>r.tratamento==="debito").reduce((a,r)=>a+r.valor_seguro,0))}`);
    } catch (e) { console.log(`  SEGURO   LANCOU: ${e.message}`); }

    // 3) o caminho REAL da rota
    try {
      const input = await extractBbtsClosingFromPdfs(
        new Uint8Array(fs.readFileSync(pCred)),
        new Uint8Array(fs.readFileSync(pSeg))
      );
      console.log(`  COMBINADO OK — year=${input.year} month=${input.month}`);
      console.log(`           ancoras: ${JSON.stringify(input._ancoras)}`);
      dump[rotulo] = {
        year: input.year, month: input.month,
        credito: input.credito.map(r => ({ contrato: r.contrato, pag_avista: r.pag_avista, vfin: r.valor_financiado, data: r.data, chave_j: r.chave_j, cancelamento: r.cancelamento, categoria: r.categoria })),
        seguro: input.seguro.map(r => ({ contrato: r.contrato, valor_seguro: r.valor_seguro, tratamento: r.tratamento, base: r.valor_total_credito })),
        prt: input.prt, ancoras: input._ancoras,
      };
    } catch (e) { console.log(`  COMBINADO LANCOU: ${e.message}`); }
  }
  fs.writeFileSync(path.join(OUT, "ads_abr_mai_extraido.json"), JSON.stringify(dump, null, 1));
  console.log(`\nJSON: ${path.join(OUT, "ads_abr_mai_extraido.json")}`);
})();
