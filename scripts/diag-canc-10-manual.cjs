/* READ-ONLY. O desconto MANUAL do financeiro ja esta no sistema? Onde? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  console.log("=== (1) PMR: discount_value por competencia e source ===");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results").select("year,month,source,discount_value,final_commission_value,promoter_id,company_id"));
  const g={};
  for (const r of pmr){ const k=`${r.year}-${String(r.month).padStart(2,"0")} src=${r.source}`; const b=g[k]||(g[k]={n:0,d:0,fin:0,comD:0}); b.n++; b.d+=n(r.discount_value); b.fin+=n(r.final_commission_value); if(n(r.discount_value)>0) b.comD++; }
  console.log("competencia | linhas | com discount_value>0 | Sigma discount_value | Sigma final");
  for (const [k,b] of Object.entries(g).sort()) console.log(`  ${k.padEnd(26)} | ${String(b.n).padStart(4)} | ${String(b.comD).padStart(4)} | ${f(b.d).padStart(12)} | ${f(b.fin).padStart(13)}`);

  console.log("\n=== (2) cms_promoter_entries: tem campo de desconto/estorno? ===");
  const { data: c1 } = await sb.from("cms_promoter_entries").select("*").limit(1);
  console.log("  colunas: " + Object.keys(c1[0]||{}).join(", "));

  console.log("\n=== (3) promoter_discounts por competencia (o canal que o payable abate) ===");
  const disc = await pageAll(()=> sb.from("promoter_discounts").select("year,month,amount,discount_type,apply_to_company,status,debit_id"));
  const gd={};
  for (const r of disc){ const k=`${r.year}-${String(r.month).padStart(2,"0")}`; const b=gd[k]||(gd[k]={n:0,v:0,tipos:{}}); b.n++; b.v+=n(r.amount); b.tipos[r.discount_type]=(b.tipos[r.discount_type]||0)+1; }
  for (const [k,b] of Object.entries(gd).sort()) console.log(`  ${k} | ${String(b.n).padStart(3)} | ${f(b.v).padStart(11)} | ${JSON.stringify(b.tipos)}`);

  console.log("\n=== (4) as DUAS vias de desconto sobrepoem? ===");
  console.log("  payableByCompetencia (financialAnalytics:300-321) usa: final_commission_value - Sigma promoter_discounts");
  console.log("  ou seja: o campo PMR.discount_value NAO e usado pelo Caixa.");
  const somaDV = pmr.reduce((s,r)=>s+n(r.discount_value),0);
  const somaPD = disc.reduce((s,r)=>s+n(r.amount),0);
  console.log(`  Sigma PMR.discount_value  = ${f(somaDV)}`);
  console.log(`  Sigma promoter_discounts  = ${f(somaPD)}`);

  console.log("\n=== (5) quem LE PMR.discount_value? ===");
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
