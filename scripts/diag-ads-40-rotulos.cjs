/* READ-ONLY. "Seguro repassado" e SUBCONJUNTO das comissoes pagas, ou 'a mais'? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const s=(await buildFinancialAnalytics(sb,{year:2026,month:8})).summary;
  console.log("=== ago/26 (competencia M-1 = julho) ===");
  console.log(`  Comissoes pagas   = ${f(s.comissoesPagas)}`);
  console.log(`  Seguro repassado  = ${f(s.paidInsuranceShare)}`);
  console.log(`  Recebido          = ${f(s.receivedNet)}`);
  console.log(`  Comissoes recebidas = ${f(s.receivedEmpresa)}`);
  console.log(`  Seguro recebido   = ${f(s.receivedInsurance)}`);

  const pmr = await pageAll(()=> sb.from("promoter_monthly_results")
    .select("production_commission_value, insurance_commission_value, final_commission_value, discount_value")
    .eq("year",2026).eq("month",7).neq("source","daily"));
  const sp=pmr.reduce((a,r)=>a+n(r.production_commission_value),0);
  const si=pmr.reduce((a,r)=>a+n(r.insurance_commission_value),0);
  const sf=pmr.reduce((a,r)=>a+n(r.final_commission_value),0);
  const sd=pmr.reduce((a,r)=>a+n(r.discount_value),0);
  console.log("\n=== o PMR de julho ===");
  console.log(`  Sigma production_commission_value = ${f(sp)}`);
  console.log(`  Sigma insurance_commission_value  = ${f(si)}`);
  console.log(`  Sigma final_commission_value      = ${f(sf)}`);
  console.log(`  producao + seguro == final?       = ${Math.abs(sp+si-sf)<0.02 ? "SIM" : "NAO (delta "+f(sp+si-sf)+")"}`);
  console.log(`  Sigma discount_value              = ${f(sd)}`);
  console.log(`  final - descontos                 = ${f(sf-sd)}  (== Comissoes pagas? ${Math.abs(sf-sd-s.comissoesPagas)<0.02?"SIM":"NAO"})`);
  console.log(`\n  => 'Seguro repassado' esta DENTRO das 'Comissoes pagas': ${Math.abs(si-s.paidInsuranceShare)<0.02 && Math.abs(sp+si-sf)<0.02 ? "SIM, e SUBCONJUNTO" : "verificar"}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
