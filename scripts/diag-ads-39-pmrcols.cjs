require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f=v=>(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  const { data } = await sb.from("promoter_monthly_results").select("*").limit(1);
  const cols = Object.keys(data[0]);
  console.log("=== colunas de promoter_monthly_results ("+cols.length+") ===");
  console.log(cols.join("\n"));
  console.log("\n=== as duas colunas pedidas existem? ===");
  for (const c of ["bbts_prt_total","bbts_avista_total"]) {
    const { error } = await sb.from("promoter_monthly_results").select(c).limit(1);
    console.log(`  ${c}: ${error ? "NAO EXISTE -> " + error.message : "existe"}`);
  }
  console.log("\n=== o PMR da ADS jul/26 mede a MESMA grandeza que o card? ===");
  const { data: p } = await sb.from("promoter_monthly_results")
    .select("production_commission_value, insurance_commission_value, final_commission_value, production_value")
    .eq("company_id","375aea6d-3b9c-4490-87f0-e739e312c8ef").eq("year",2026).eq("month",7);
  const s = (k)=>p.reduce((a,r)=>a+(Number(r[k])||0),0);
  console.log(`  Sigma production_commission_value = ${f(s("production_commission_value"))}  <- comissao do PROMOTOR`);
  console.log(`  Sigma insurance_commission_value  = ${f(s("insurance_commission_value"))}`);
  console.log(`  Sigma final_commission_value      = ${f(s("final_commission_value"))}`);
  console.log(`  Sigma production_value            = ${f(s("production_value"))}  <- volume financiado`);
  console.log(`\n  o card precisa de: bbts_pag_avista 18.737,33 (o que a BBTS pagou a EMPRESA)`);
  console.log(`  nenhum agregado do PMR e esse numero.`);
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
