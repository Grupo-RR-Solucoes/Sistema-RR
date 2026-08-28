/* READ-ONLY. (1) bbts_seguro_pago e bruto ou liquido, e onde estao os cancelamentos.
   (2) bruto + estornos = 155,07? (3) o DRE/Financeiro usa bruto ou liquido. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

(async () => {
  console.log("=== (1a) existe bbts_seguro_pago NEGATIVO em algum lugar? ===");
  const { data: neg } = await sb.from("daily_production_records").select("id, proposal_number, bbts_seguro_pago").lt("bbts_seguro_pago", 0);
  console.log(`  linhas com bbts_seguro_pago < 0: ${neg ? neg.length : 0}  -> a coluna so guarda POSITIVO (bruto)`);

  console.log("\n=== (1b) as 3 propostas CANCELADAS do PDF de julho estao em daily_production_records? ===");
  for (const p of ["211689509", "212205929", "212146378"]) {
    const { data } = await sb.from("daily_production_records").select("id, proposal_number, bbts_seguro_pago, insurance_value").eq("company_id", ADS).eq("proposal_number", p);
    console.log(`  ${p}: ${data && data.length ? `existe, bbts_seguro_pago=${data[0].bbts_seguro_pago === null ? "NULL" : f(data[0].bbts_seguro_pago)}` : "NAO existe como linha de producao"}`);
  }

  console.log("\n=== (1c) onde os cancelamentos FORAM parar: promoter_debits da ADS ===");
  const { data: deb } = await sb.from("promoter_debits").select("id, debit_type, start_year, start_month, total_amount, status, kind").eq("company_id", ADS);
  console.log(`  promoter_debits da ADS: ${deb ? deb.length : 0}`);
  let somaDeb = 0;
  for (const r of deb || []) { somaDeb += Number(r.total_amount) || 0; console.log(`    ${r.start_year}-${String(r.start_month).padStart(2, "0")} ${r.debit_type} kind=${r.kind} status=${r.status} ${f(r.total_amount)}`); }
  console.log(`  >>> Sigma = ${f(somaDeb)}`);

  console.log("\n=== (2) a identidade: bruto - estornos = liquido do PDF ===");
  const bruto = 115.10 + 89.42;
  console.log(`  bruto no banco APOS o UPDATE : 115,10 (12 linhas) + 89,42 (a 13a) = ${f(bruto)}`);
  console.log(`  estornos (promoter_debits ADS)                                   = ${f(somaDeb)}`);
  console.log(`  bruto - estornos = ${f(bruto - somaDeb)}   |  ancora TOTAL do PDF = 155,07  -> ${Math.abs(bruto - somaDeb - 155.07) < 0.01 ? "FECHA" : "NAO FECHA"}`);

  console.log("\n=== (3) o que o DRE/Financeiro somam ===");
  console.log("  lib/dre.ts:348              receitaAds += toNum(r.bbts_pag_avista) + toNum(r.bbts_seguro_pago)");
  console.log("  lib/financialAnalytics.ts:425  b.seguro += toNumber(r.bbts_seguro_pago)");
  console.log("  -> os dois somam a COLUNA, que e BRUTA. Nenhum dos dois subtrai estorno.");
  const { data: cab } = await sb.from("daily_production_records").select("bbts_seguro_pago").eq("company_id", ADS).gte("movement_date", "2026-07-01").lte("movement_date", "2026-07-31").not("bbts_seguro_pago", "is", null);
  const hoje = (cab || []).reduce((a, r) => a + (Number(r.bbts_seguro_pago) || 0), 0);
  console.log(`\n  exibido HOJE para julho : ${f(hoje)}`);
  console.log(`  exibido APOS o UPDATE   : ${f(bruto)}   (bruto)`);
  console.log(`  o que a BBTS PAGOU      : ${f(155.07)}   (liquido)`);
  console.log(`  diferenca nao abatida   : ${f(bruto - 155.07)}  -> cobrada do PROMOTOR via promoter_debits`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
