/* READ-ONLY. Efeito da Abertura de Conta no card, e a diferenca contra o que a
   BBTS DECLAROU ter pago. Simula o seed sem escrever nada. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { extractBbtsCreditoPdf, extractBbtsSeguroPdf } = require("../lib/bbtsPdfExtract.ts");
  const cred = await extractBbtsCreditoPdf(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf (1).pdf")));
  const seg = await extractBbtsSeguroPdf(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf.pdf")));

  console.log("=== O QUE A BBTS DECLAROU PAGAR em 07/2026 ===");
  console.log(`  PDF de credito, "Pagamento Total" : ${f(cred.cabecalho.pagamentoTotal)}`);
  console.log(`     = AVT ${f(cred.cabecalho.pagamentoAvt)} + PRT ${f(cred.cabecalho.pagamentoPrt)} + Abertura ${f(cred.cabecalho.aberturaConta)} + Glosa ${f(cred.cabecalho.outrasDeducoes)}`);
  console.log(`  PDF de seguro, ancora "TOTAL"     : ${f(seg.totalAnchor)}   (204,52 de calculo - 49,45 de cancelamento)`);
  const declarado = cred.cabecalho.pagamentoTotal + seg.totalAnchor;
  console.log(`  >>> DEPOSITO TOTAL DECLARADO       : ${f(declarado)}`);

  console.log("\n=== O QUE O SISTEMA MOSTRA para a competencia 2026-07 ===");
  const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
  const p = await buildFinancialAnalytics(sb, { year: 2026, month: 8 }); // caixa de ago le fechamento de jul
  const linha = ((p.detalhamento && p.detalhamento.entrada && p.detalhamento.entrada.linhas) || []).find((l) => /ADS/i.test(l.rotulo || ""));
  const c = linha ? linha.celulas : {};
  const hoje = (c.avista || 0) + (c.prt || 0) + (c.seguro || 0) + (c.outros || 0);
  console.log(`  HOJE   : avista ${f(c.avista)} + prt ${f(c.prt)} + seguro ${f(c.seguro)} + outros ${f(c.outros)} = ${f(hoje)}`);
  const depois = hoje + cred.cabecalho.aberturaConta;
  console.log(`  DEPOIS : outros passa a ${f(cred.cabecalho.aberturaConta)}  ->  ${f(depois)}`);
  console.log(`\n  receivedClosing 2026-08 hoje  : ${f(p.summary.receivedClosing)}`);
  console.log(`  receivedClosing 2026-08 depois: ${f(p.summary.receivedClosing + cred.cabecalho.aberturaConta)}`);

  console.log("\n=== A DIFERENCA CONTRA O DECLARADO ===");
  console.log(`  hoje   : ${f(hoje)} - ${f(declarado)} = ${f(hoje - declarado)}`);
  console.log(`  depois : ${f(depois)} - ${f(declarado)} = ${f(depois - declarado)}`);
  console.log(`\n  os ${f(Math.abs(depois - declarado))} restantes sao os cancelamentos do PDF de seguro,`);
  console.log(`  que NAO sao abatidos da receita de proposito: viram promoter_debits (item 3).`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
