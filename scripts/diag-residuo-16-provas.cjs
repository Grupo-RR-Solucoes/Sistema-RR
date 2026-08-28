/* READ-ONLY. Provas dos 3 blocos, sem escrever nada. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { extractBbtsClosingFromPdfs } = require("../lib/bbtsPdfExtract.ts");
  const { ownedColumnsFor } = require("../lib/dailyRecordMerge.ts");
  const CRED = "C:/Users/diego/Downloads/pdf (1).pdf", SEG = "C:/Users/diego/Downloads/pdf.pdf";

  console.log("========== BLOCO 1 — o cabecalho chega ao BbtsClosingInput ==========");
  const in2 = await extractBbtsClosingFromPdfs(new Uint8Array(fs.readFileSync(CRED)), new Uint8Array(fs.readFileSync(SEG)));
  console.log(`  cabecalho.aberturaConta = ${f(in2.cabecalho.aberturaConta)}   pagamentoTotal = ${f(in2.cabecalho.pagamentoTotal)}`);
  console.log(`  seguro_pdf_ausente = ${in2.seguro_pdf_ausente}`);

  console.log("\n========== BLOCO 3 — a bandeira de ausencia ==========");
  const in1 = await extractBbtsClosingFromPdfs(new Uint8Array(fs.readFileSync(CRED)), null);
  console.log(`  com os 2 PDFs -> seguro_pdf_ausente = ${in2.seguro_pdf_ausente}`);
  console.log(`  so o credito  -> seguro_pdf_ausente = ${in1.seguro_pdf_ausente}   <-- ausencia agora e DISTINGUIVEL de zero`);

  // o que o merge FULL escreveria, com e sem as chaves de seguro no registro
  const comSeguro = { company_id: "x", proposal_number: "1", bbts_pag_avista: 1, bbts_seguro_pago: 2, insurance_value: 3, insurance_net_value: 3, has_insurance: true, insurance_type: "ESTOQUE" };
  const semSeguro = { company_id: "x", proposal_number: "1", bbts_pag_avista: 1 };
  const colsCom = ownedColumnsFor("FULL", comSeguro);
  const colsSem = ownedColumnsFor("FULL", semSeguro);
  console.log(`  ownedColumnsFor(FULL, registro COM seguro) = ${colsCom.join(", ")}`);
  console.log(`  ownedColumnsFor(FULL, registro SEM seguro) = ${colsSem.join(", ")}`);
  const apagaveis = ["bbts_seguro_pago", "insurance_value", "insurance_net_value", "has_insurance", "insurance_type"];
  console.log(`  colunas de seguro que o UPDATE tocaria sem o PDF: ${colsSem.filter((c) => apagaveis.includes(c)).length} (antes: ${colsCom.filter((c) => apagaveis.includes(c)).length})`);

  console.log("\n========== BLOCO 3 — ledgerHealth, ao vivo ==========");
  const { detectFechamentoParcial } = require("../lib/diagnostico/fechamentoParcial.ts");
  for (const c of await detectFechamentoParcial(sb)) {
    console.log(`\n  [${c.id}] severity=${c.severity} count=${c.count}`);
    console.log(`    ${c.descricao}`);
    for (const d of c.detalhe || []) console.log(`      ${JSON.stringify(d)}`);
  }

  console.log("\n========== NAO-REGRESSAO — a query que as TELAS fazem ==========");
  const { buildDre } = require("../lib/dre.ts");
  const dre = await buildDre(sb);
  console.log(`  /api/dre  -> closed=${dre.closed} periodo=${dre.period && dre.period.key} empresas=${(dre.companies || []).length}`);
  const ads = (dre.companies || []).find((c) => /ADS/i.test(c.name || ""));
  if (ads) console.log(`     ADS: ${JSON.stringify((ads.lines || []).slice(0, 3))}`);
  const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
  for (const [y, m] of [[2026, 7], [2026, 8]]) {
    const fin = await buildFinancialAnalytics(sb, { year: y, month: m });
    const s = fin.summary || {};
    console.log(`  /api/financeiro ${y}-${String(m).padStart(2, "0")} -> received=${f(s.received)} receivedClosing=${f(s.receivedClosing)} receivedInsurance=${f(s.receivedInsurance)}`);
  }
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
