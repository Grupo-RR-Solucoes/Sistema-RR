/* READ-ONLY. O que a reconsolidacao mudou alem do 1,40? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results").select("*").eq("company_id",ADS).eq("year",2026).eq("month",7));
  const S=k=>pmr.reduce((s,r)=>s+n(r[k]),0);
  console.log("=== PMR da ADS jul/26 AGORA ===");
  console.log(`  producao        = ${f(S("production_value"))}`);
  console.log(`  com_producao    = ${f(S("production_commission_value"))}`);
  console.log(`  com_seguro      = ${f(S("insurance_commission_value"))}`);
  console.log(`  com_final       = ${f(S("final_commission_value"))}`);
  console.log(`  base segurada   = ${f(S("insured_production_value"))}`);
  console.log("\n  MEDIDO EM 26/08 (antes de eu rodar a reconsolidacao):");
  console.log("    com_seguro = 83,54 | com_final = 10.533,76");
  console.log(`  DELTA com_final = ${f(S("final_commission_value") - 10533.76)}`);

  console.log("\n=== a causa: a linha so-seguro 221262790 ===");
  const { data: so } = await sb.from("daily_production_records").select("proposal_number,movement_date,insurance_value,bbts_seguro_pago,updated_at,raw_payload").eq("company_id",ADS).eq("proposal_number","221262790");
  for (const r of (so||[])) {
    const p=getProductionPeriodFromValue(r.movement_date);
    console.log(`  movement_date=${r.movement_date} -> competencia ${p?getProductionPeriodKey(p.year,p.month):"?"} | insurance_value=${f(r.insurance_value)} | atualizada=${String(r.updated_at).slice(0,19)}`);
    console.log(`  fonte=${r.raw_payload?.__bbts_meta?.fonte}`);
  }
  console.log("\n  (em 26/08 ela estava em 2026-07-15 -> competencia julho, e somava 89.415,39 de base)");

  console.log("\n=== quantas linhas a ADS tem agora, por competencia ===");
  const d = await pageAll(()=> sb.from("daily_production_records").select("movement_date,contract_date,proposal_date").eq("company_id",ADS));
  const g={}; for(const r of d){ const p=getProductionPeriodFromValue(r.movement_date)||getProductionPeriodFromValue(r.contract_date)||getProductionPeriodFromValue(r.proposal_date); const k=p?getProductionPeriodKey(p.year,p.month):"?"; g[k]=(g[k]||0)+1; }
  for (const [k,v] of Object.entries(g).sort()) console.log(`  ${k}: ${v}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
