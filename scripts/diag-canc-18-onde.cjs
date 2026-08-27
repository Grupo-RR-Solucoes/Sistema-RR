/* READ-ONLY. Onde esta o debito de R$ 1,40? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: comps } = await sb.from("companies").select("id,name");
  const nome=Object.fromEntries(comps.map(c=>[c.id,c.name]));
  const { data: proms } = await sb.from("promoters").select("id,name,active");
  const pn=Object.fromEntries(proms.map(p=>[p.id,p.name]));
  const acha=t=>proms.filter(p=>String(p.name).toUpperCase().includes(t));

  console.log("=== (1) EXISTE debito de 1,40? ===");
  const deb = await pageAll(()=> sb.from("promoter_debits").select("*"));
  console.log(`  promoter_debits: ${deb.length} linha(s) no total`);
  const c140 = deb.filter(r=>Math.abs(n(r.total_amount)-1.40)<0.005);
  console.log(`  com total_amount = 1,40 : ${c140.length}`);
  for (const r of c140) console.log(`     ${pn[r.promoter_id]} | ${nome[r.company_id]} | ${r.start_year}-${String(r.start_month).padStart(2,"0")} | ${r.debit_type} | ${r.kind} | status=${r.status} | criado=${String(r.created_at).slice(0,19)}`);
  const src = await pageAll(()=> sb.from("promoter_debit_sources").select("*").eq("operation","211689509"));
  console.log(`  promoter_debit_sources com operacao 211689509: ${src.length}`);
  const fila = await pageAll(()=> sb.from("promoter_debit_assignments").select("*").eq("operation","211689509"));
  console.log(`  ainda na FILA (promoter_debit_assignments): ${fila.length}`);
  for (const r of fila) console.log(`     status=${r.status} | ${r.year}-${String(r.month).padStart(2,"0")} | ${f(r.estorno_amount)} | promoter_id=${r.promoter_id ?? "NULO"}`);

  console.log("\n=== (5) os -48,05 da ADS: quais operacoes? incluem o 1,40? ===");
  const disc = await pageAll(()=> sb.from("promoter_discounts").select("*").eq("company_id",ADS));
  console.log(`  promoter_discounts da ADS: ${disc.length} | Sigma ${f(disc.reduce((s,r)=>s+n(r.amount),0))}`);
  for (const r of disc) console.log(`     ${pn[r.promoter_id]} | ${r.year}-${String(r.month).padStart(2,"0")} | ${f(r.amount)} | ${r.discount_type} | debit_id=${r.debit_id?String(r.debit_id).slice(0,8):"NULO"}`);
  const sAds = await pageAll(()=> sb.from("promoter_debit_sources").select("*"));
  const idsAds=new Set(deb.filter(r=>r.company_id===ADS).map(r=>r.id));
  console.log(`  fontes ligadas a debitos da ADS:`);
  for (const r of sAds.filter(x=>idsAds.has(x.debit_id))) console.log(`     operacao ${r.operation} | ${f(r.estorno_amount)} | via ${r.resolved_via}`);

  console.log("\n=== ALDALENE e BRUNA: o que cada uma tem em jul/26 ===");
  for (const alvo of ["ALDALENE","BRUNA"]) {
    for (const p of acha(alvo)) {
      const d=deb.filter(x=>x.promoter_id===p.id);
      const di=await pageAll(()=> sb.from("promoter_discounts").select("*").eq("promoter_id",p.id));
      const pmr=await pageAll(()=> sb.from("promoter_monthly_results").select("year,month,company_id,source,final_commission_value,discount_value").eq("promoter_id",p.id).eq("year",2026).eq("month",7));
      console.log(`\n  ${p.name} (${p.id.slice(0,8)}, ativo=${p.active})`);
      console.log(`    promoter_debits          : ${d.length} ${d.map(x=>`[${nome[x.company_id]} ${x.start_year}-${String(x.start_month).padStart(2,"0")} ${f(x.total_amount)}]`).join(" ")}`);
      console.log(`    promoter_discounts       : ${di.length} ${di.map(x=>`[${x.year}-${String(x.month).padStart(2,"0")} ${f(x.amount)} ${x.discount_type}]`).join(" ")}`);
      console.log(`    PMR jul/26               : ${pmr.map(x=>`[${nome[x.company_id]} src=${x.source} final=${f(x.final_commission_value)} desc=${f(x.discount_value)}]`).join(" ") || "(nenhuma)"}`);
    }
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
