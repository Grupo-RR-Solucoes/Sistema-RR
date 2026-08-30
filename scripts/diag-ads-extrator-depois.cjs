/* Depois do conserto: os 4 PDFs de abr/mai passam, e junho/julho NAO regridem.
 * READ-ONLY (so PDFs). Compara contra os numeros ja conhecidos do banco. */
require("./_ts_register.cjs");
const fs = require("fs");
const DL = "C:/Users/diego/Downloads";
const brl = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PARES = [
  ["ABRIL  (novo)", "ADS Abril 2026.pdf", "Seguro ADS Abril 2026.pdf", { avt: 9780.86, prt: 0, abert: 225, total: 10005.86, segTotal: 213.47, props: 37, seg: 14, prtN: 0 }],
  ["MAIO   (novo)", "ADS Maio 2026.pdf", "Seguro ADs Maio 2026.pdf", { avt: 634.31, prt: 5.84, abert: 25, total: 665.15, segTotal: 40.56, props: 10, seg: 6, prtN: 7 }],
  ["JUNHO  (nao pode regredir)", "Crédito ADS-BBTS.pdf", null, { avt: 7707.03, prt: 7.01, abert: 0, total: 7714.04, props: 19, prtN: 8 }],
  // julho: 43 propostas de CREDITO no PDF. As 46 linhas que julho tem no diario
  // incluem as linhas SO-SEGURO, que o importador cria a parte — contagem de
  // BANCO nao serve de esperado para contagem de DOCUMENTO. Medido igual antes
  // e depois do conserto (git stash), que e o que prova a nao-regressao.
  ["JULHO  (nao pode regredir)", "pdf (1).pdf", "pdf.pdf", { avt: 18737.33, prt: 7.01, abert: 100, total: 18844.34, props: 43, seg: 16, segTotal: 155.07, prtN: 8 }],
];
(async () => {
  const X = require("@/lib/bbtsPdfExtract.ts");
  let falhas = 0;
  const eq = (rot, obtido, esperado) => {
    const ok = esperado === undefined || Math.abs(Number(obtido) - Number(esperado)) < 0.005;
    if (!ok) falhas++;
    console.log(`      ${ok ? "OK  " : "ERRO"} ${rot.padEnd(26)} ${String(obtido).padStart(12)}${esperado === undefined ? "" : `  (esperado ${esperado})`}`);
  };
  for (const [rot, fc, fs_, esp] of PARES) {
    console.log(`\n### ${rot}`);
    const pc = DL + "/" + fc, ps = fs_ ? DL + "/" + fs_ : null;
    if (!fs.existsSync(pc) || (ps && !fs.existsSync(ps))) { console.log("   arquivo ausente — PULADO"); continue; }
    try {
      const input = await X.extractBbtsClosingFromPdfs(
        new Uint8Array(fs.readFileSync(pc)),
        ps ? new Uint8Array(fs.readFileSync(ps)) : null
      );
      console.log(`   COMBINADO OK — competencia ${input.year}-${String(input.month).padStart(2, "0")}`);
      eq("propostas de credito", input.credito.length, esp.props);
      eq("ancora AVT", input._ancoras.credito_pag_avista, esp.avt);
      eq("cabecalho AVT", input.cabecalho.pagamentoAvt, esp.avt);
      eq("cabecalho PRT", input.cabecalho.pagamentoPrt, esp.prt);
      eq("cabecalho Abertura", input.cabecalho.aberturaConta, esp.abert);
      eq("cabecalho Total", input.cabecalho.pagamentoTotal, esp.total);
      eq("linhas PRT", input.prt.length, esp.prtN);
      eq("ancora PRT (soma)", input.prt.reduce((a, r) => a + r.valor_parcela, 0), esp.prt);
      if (ps) {
        eq("linhas de seguro", input.seguro.length, esp.seg);
        eq("ancora seguro TOTAL", input._ancoras.seguro_total, esp.segTotal);
      }
      const semParcela = input.prt.filter(r => r.n_parcela === 0).length;
      console.log(`      ..   PRT com parcela '#N/D' (n_parcela=0): ${semParcela} de ${input.prt.length}`);
      const canc = input.seguro.filter(r => r.tratamento === "debito");
      console.log(`      ..   seguro CANCELADO: ${canc.length} (${brl(canc.reduce((a, r) => a + r.valor_seguro, 0))})`);
    } catch (e) { falhas++; console.log(`   LANCOU: ${e.message}`); }
  }
  console.log(`\n${falhas === 0 ? "TODAS AS CONFERENCIAS PASSARAM" : `${falhas} CONFERENCIA(S) FALHARAM`}`);
  process.exit(falhas === 0 ? 0 : 1);
})();
