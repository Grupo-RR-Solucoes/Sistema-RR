/* READ-ONLY. A Aldalene tem linha na ADS? E quem tem duas? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: comps } = await sb.from("companies").select("id,name");
  const cn=Object.fromEntries(comps.map(c=>[c.id,c.name]));
  const { data: proms } = await sb.from("promoters").select("id,name");
  const pn=Object.fromEntries(proms.map(p=>[p.id,p.name]));
  const ald = proms.find(p=>String(p.name).toUpperCase().includes("ALDALENE"));

  console.log("=== TODAS as linhas de PMR da ALDALENE, em TODAS as competencias ===");
  const t = await pageAll(()=> sb.from("promoter_monthly_results").select("year,month,company_id,source,final_commission_value,discount_value").eq("promoter_id",ald.id).order("year").order("month"));
  console.log(`  total: ${t.length}`);
  for (const r of t) console.log(`   ${r.year}-${String(r.month).padStart(2,"0")} | ${String(cn[r.company_id]).padEnd(26)} | src=${r.source} | final=${f(r.final_commission_value)} | discount_value=${f(r.discount_value)}`);
  console.log(`\n  >>> tem ALGUMA linha na ADS? ${t.some(r=>r.company_id===ADS)?"SIM":"NAO"} <<<`);

  console.log("\n=== e os descontos dela? ===");
  const d = await pageAll(()=> sb.from("promoter_discounts").select("*").eq("promoter_id",ald.id));
  for (const r of d) console.log(`   ${r.year}-${String(r.month).padStart(2,"0")} | ${cn[r.company_id]} | ${f(r.amount)} | ${r.discount_type}`);

  console.log("\n=== QUEM tem DUAS empresas em jul/26 (o caso que testa a tela) ===");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results").select("promoter_id,company_id,final_commission_value").eq("year",2026).eq("month",7).neq("source","daily"));
  const byP={}; for(const r of pmr) (byP[r.promoter_id]=byP[r.promoter_id]||[]).push(r);
  const multi=Object.entries(byP).filter(([,v])=>new Set(v.map(x=>x.company_id)).size>1);
  console.log(`  promotores com 2+ empresas: ${multi.length}`);
  for (const [pid,rows] of multi.slice(0,8)) console.log(`   ${String(pn[pid]).padEnd(28)} -> ${rows.map(r=>`${cn[r.company_id]}=${f(r.final_commission_value)}`).join(" | ")}`);

  console.log("\n=== o Sigma discount_value do PMR da ADS jul/26 (recontagem) ===");
  const pAds = await pageAll(()=> sb.from("promoter_monthly_results").select("promoter_id,discount_value").eq("company_id",ADS).eq("year",2026).eq("month",7));
  console.log(`  linhas: ${pAds.length} | Sigma discount_value = ${f(pAds.reduce((s,r)=>s+n(r.discount_value),0))}`);
  console.log(`  alguma != 0? ${pAds.filter(r=>n(r.discount_value)!==0).length}`);
  console.log(`  a ALDALENE esta entre elas? ${pAds.some(r=>r.promoter_id===ald.id)?"SIM":"NAO"}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
