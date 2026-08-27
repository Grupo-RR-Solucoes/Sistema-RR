/* READ-ONLY. Retrato do estado, para comparar antes/depois. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: proms } = await sb.from("promoters").select("id,name");
  const pn=Object.fromEntries(proms.map(p=>[p.id,p.name]));
  const deb = await pageAll(()=> sb.from("promoter_debits").select("*").eq("company_id",ADS).eq("start_year",2026).eq("start_month",7));
  console.log(`promoter_debits ADS 2026-07: ${deb.length} | Sigma ${f(deb.reduce((s,r)=>s+n(r.total_amount),0))}`);
  for (const r of deb) console.log(`   ${pn[r.promoter_id]} | ${f(r.total_amount)} | ${r.kind} | ${r.status}`);
  const disc = await pageAll(()=> sb.from("promoter_discounts").select("*").eq("company_id",ADS).eq("year",2026).eq("month",7));
  console.log(`promoter_discounts ADS 2026-07: ${disc.length} | Sigma ${f(disc.reduce((s,r)=>s+n(r.amount),0))}`);
  const fila = await pageAll(()=> sb.from("promoter_debit_assignments").select("*").eq("source_kind","DAILY_CANCEL").eq("status","PENDING"));
  console.log(`fila DAILY_CANCEL PENDING: ${fila.length} -> ${fila.map(r=>`${r.operation}(${f(r.estorno_amount)})`).join(", ")}`);
  const { data: pmrB } = await sb.from("promoter_monthly_results").select("promoter_id,final_commission_value,discount_value").eq("company_id",ADS).eq("year",2026).eq("month",7);
  const bruna=(pmrB||[]).find(r=>String(pn[r.promoter_id]).includes("BRUNA"));
  console.log(`PMR jul/26 BRUNA (ADS): final=${f(bruna?.final_commission_value)} desc=${f(bruna?.discount_value)}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
