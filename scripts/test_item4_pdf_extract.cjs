/*
 * ITEM 4 — o extrator de PDF deve REPRODUZIR o JSON de junho montado à mão.
 * Compara extractBbtsClosingFromPdfs(Crédito ADS-BBTS.pdf, Seguro ADs-BBTS.pdf)
 * contra bbts_junho_fechamento.json, campo a campo + somatórios/âncoras.
 */
require("./_ts_register.cjs");
const fs = require("fs");
const { extractBbtsClosingFromPdfs } = require("../lib/bbtsPdfExtract.ts");
const DL = "C:/Users/diego/Downloads";

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x ? "— " + x : ""}`)); };
const near = (a, b) => Math.abs((+a || 0) - (+b || 0)) <= 0.01;
const sum = (arr, f) => Math.round(arr.reduce((a, r) => a + (+f(r) || 0), 0) * 100) / 100;

(async () => {
  const cred = new Uint8Array(fs.readFileSync(DL + "/Crédito ADS-BBTS.pdf"));
  const seg = new Uint8Array(fs.readFileSync(DL + "/Seguro ADs-BBTS.pdf"));
  const out = await extractBbtsClosingFromPdfs(cred, seg);
  const gold = JSON.parse(fs.readFileSync(DL + "/bbts_junho_fechamento.json", "utf8"));

  console.log("\n=== ITEM 4 — extrator PDF × JSON junho ===\n");
  console.log(`extraído: year=${out.year} month=${out.month} | credito=${out.credito.length} seguro=${out.seguro.length}`);
  console.log(`_ancoras: ${JSON.stringify(out._ancoras)}`);

  // --- somatórios / contagens ---
  ok("19 propostas de crédito", out.credito.length === 19, `got ${out.credito.length}`);
  ok("Σ valor_financiado = 271.210,84", near(sum(out.credito, (r) => r.valor_financiado), 271210.84), sum(out.credito, (r) => r.valor_financiado));
  ok("Σ pag_avista = 7.707,03", near(sum(out.credito, (r) => r.pag_avista), 7707.03), sum(out.credito, (r) => r.pag_avista));
  ok("9 linhas de seguro", out.seguro.length === 9, `got ${out.seguro.length}`);
  ok("Σ seguro = 58,11 (7 pos + 2 neg)", near(sum(out.seguro, (r) => r.valor_seguro), 58.11), sum(out.seguro, (r) => r.valor_seguro));
  const neg = out.seguro.filter((r) => r.valor_seguro < 0);
  ok("2 seguros cancelados (negativos)", neg.length === 2 && out.seguro.filter((r) => r.tratamento === "debito").length === 2, JSON.stringify(neg.map((r) => r.contrato)));

  // --- crédito campo-a-campo (por contrato) ---
  const cByC = new Map(out.credito.map((r) => [String(r.contrato), r]));
  let credOk = 0, credBad = [];
  for (const g of gold.credito) {
    const e = cByC.get(String(g.contrato));
    if (!e) { credBad.push(`${g.contrato} ausente`); continue; }
    const good =
      near(e.valor_financiado, g.valor_financiado) &&
      near(e.pag_avista, g.pag_avista) &&
      e.data === g.data &&
      near(e.taxa_relatorio, g.taxa_relatorio) &&
      Number(e.srcc_cd) === Number(g.srcc_cd) &&
      near(e.juros_mensal, g.juros_mensal) &&
      Number(e.parcelas) === Number(g.parcelas) &&
      String(e.nr_convenio) === String(g.nr_convenio) &&
      e.chave_j === g.chave_j &&
      Boolean(e.cancelamento) === Boolean(g.cancelamento);
    if (good) credOk++;
    else credBad.push(`${g.contrato}: ext=${JSON.stringify({ vf: e.valor_financiado, pa: e.pag_avista, d: e.data, tx: e.taxa_relatorio, srcc: e.srcc_cd, jm: e.juros_mensal, p: e.parcelas, cv: e.nr_convenio, cj: e.chave_j, c: e.cancelamento })} gold=${JSON.stringify({ vf: g.valor_financiado, pa: g.pag_avista, d: g.data, tx: g.taxa_relatorio, srcc: g.srcc_cd, jm: g.juros_mensal, p: g.parcelas, cv: g.nr_convenio, cj: g.chave_j, c: g.cancelamento })}`);
  }
  ok(`crédito: 19/19 contratos idênticos ao JSON`, credOk === gold.credito.length, credBad.slice(0, 5).join(" || "));

  // --- seguro campo-a-campo (por contrato) ---
  const sByC = new Map(out.seguro.map((r) => [String(r.contrato), r]));
  let segOk = 0, segBad = [];
  for (const g of gold.seguro) {
    const e = sByC.get(String(g.contrato));
    if (!e) { segBad.push(`${g.contrato} ausente`); continue; }
    const good =
      near(e.valor_total_credito, g.valor_total_credito) &&
      String(e.tipo).toUpperCase() === String(g.tipo).toUpperCase() &&
      near(e.valor_seguro, g.valor_seguro) &&
      e.tratamento === g.tratamento;
    if (good) segOk++;
    else segBad.push(`${g.contrato}: ext=${JSON.stringify(e)} gold=${JSON.stringify({ vtc: g.valor_total_credito, tipo: g.tipo, vs: g.valor_seguro, tr: g.tratamento })}`);
  }
  ok(`seguro: 9/9 contratos idênticos ao JSON`, segOk === gold.seguro.length, segBad.slice(0, 5).join(" || "));

  console.log(`\n=== ${pass} passaram, ${fail} falharam ===`);
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
