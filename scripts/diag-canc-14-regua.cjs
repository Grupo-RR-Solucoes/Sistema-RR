/* READ-ONLY. As 3 da fila: o promotor CHEGOU a receber comissao por elas? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const OPS=["209867885","209621970","211689509"];
(async()=>{
  console.log("=== as 3 da fila: existiram como PRODUCAO em algum lugar? ===");
  for (const op of OPS) {
    console.log(`\n  ${op}:`);
    for (const [t,col] of [["daily_production_records","proposal_number"],["cms_promoter_entries","contract_number"],["bbts_prt_parcelas","proposal_number"]]) {
      const { data } = await sb.from(t).select("*").eq(col,op);
      console.log(`    ${t.padEnd(28)}: ${(data||[]).length} linha(s)`);
      for (const r of (data||[])) {
        if (t==="daily_production_records") console.log(`       company=${r.company_id===ADS?"ADS":r.company_id.slice(0,8)} mov=${r.movement_date} insurance_value=${f(r.insurance_value)} bbts_seguro_pago=${f(r.bbts_seguro_pago)} assigned=${r.assigned_promoter_id?"SIM":"NULO"}`);
      }
    }
    const { data: mce } = await sb.from("monthly_closing_entries").select("year,month,entry_type,sheet_name,commission_value").or(`operation_number.eq.${op},contract_number.eq.${op}`);
    console.log(`    monthly_closing_entries     : ${(mce||[]).length} linha(s)`);
  }
  console.log("\n=== CONCLUSAO ===");
  console.log("  Se a operacao NUNCA existiu como producao, o promotor NUNCA recebeu");
  console.log("  comissao por ela -> nao ha o que estornar. O debito seria cobranca indevida.");

  console.log("\n=== e as 2 JA DEBITADAS? existiam como producao? ===");
  for (const op of ["212205929","212146378"]) {
    const { data } = await sb.from("daily_production_records").select("company_id,movement_date,insurance_value,bbts_seguro_pago,assigned_promoter_id").eq("proposal_number",op);
    for (const r of (data||[])) console.log(`  ${op} | mov=${r.movement_date} | insurance_value=${f(r.insurance_value)} | bbts_seguro_pago=${f(r.bbts_seguro_pago)} | assigned=${r.assigned_promoter_id?"SIM":"NULO"}`);
  }
  console.log("  => essas SIM existiam (junho), o promotor recebeu, e o estorno faz sentido.");
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
