/* READ-ONLY. Houve duplicidade? De onde vem cada centavo dos descontos da ADS? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: proms } = await sb.from("promoters").select("id,name,company_id");
  const pn=Object.fromEntries(proms.map(p=>[p.id,p.name]));
  const { data: comps } = await sb.from("companies").select("id,name");
  const cn=Object.fromEntries(comps.map(c=>[c.id,c.name]));

  console.log("=== (1) A LINHA DE 1,40 EM promoter_debits (linha inteira) ===");
  const deb = await pageAll(()=> sb.from("promoter_debits").select("*").eq("company_id",ADS).eq("start_year",2026).eq("start_month",7));
  for (const r of deb) console.log(JSON.stringify({promotor:pn[r.promoter_id], empresa:cn[r.company_id], comp:`${r.start_year}-${String(r.start_month).padStart(2,"0")}`, valor:r.total_amount, kind:r.kind, debit_type:r.debit_type, status:r.status, parcelas:r.installments_total, criado:String(r.created_at).slice(0,19)}));

  console.log("\n=== (2) DUPLICIDADE? promoter_discounts da ADS em jul/26, linha a linha ===");
  const disc = await pageAll(()=> sb.from("promoter_discounts").select("*").eq("company_id",ADS).eq("year",2026).eq("month",7));
  let soma=0;
  for (const r of disc){ soma+=n(r.amount); console.log(`  ${pn[r.promoter_id].padEnd(16)} | ${f(r.amount).padStart(8)} | ${r.discount_type} | parcela ${r.installment_number}/${r.installments} | debit_id=${String(r.debit_id).slice(0,8)} | apply_to_company=${r.apply_to_company}`); }
  console.log(`  Sigma = ${f(soma)}`);
  const porOp={}; for(const r of disc){ const k=`${r.promoter_id}|${r.amount}`; porOp[k]=(porOp[k]||0)+1; }
  const rep=Object.entries(porOp).filter(([,v])=>v>1);
  console.log(`  linhas REPETIDAS (mesmo promotor+valor): ${rep.length}  ${rep.length?JSON.stringify(rep):"-> nenhuma duplicata"}`);
  console.log(`  1,40 aparece ${disc.filter(r=>Math.abs(n(r.amount)-1.40)<0.005).length} vez(es)`);

  console.log("\n=== PMR da ADS jul/26: discount_value ===");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results").select("promoter_id,final_commission_value,discount_value,production_commission_value,insurance_commission_value,calculated_at").eq("company_id",ADS).eq("year",2026).eq("month",7));
  let sf=0, sd=0;
  for (const r of pmr){ sf+=n(r.final_commission_value); sd+=n(r.discount_value); console.log(`  ${String(pn[r.promoter_id]).padEnd(28)} | final=${f(r.final_commission_value).padStart(10)} | discount_value=${f(r.discount_value)} | calc=${String(r.calculated_at).slice(0,16)}`); }
  console.log(`  Sigma final=${f(sf)} | Sigma discount_value=${f(sd)}   <- discount_value do PMR e SEMPRE 0 por desenho`);

  console.log("\n=== (3)(4) ALDALENE: tem linha de PMR na ADS? e o dono do 211689509? ===");
  const ald = proms.find(p=>String(p.name).toUpperCase().includes("ALDALENE"));
  const bru = proms.find(p=>String(p.name).toUpperCase().includes("BRUNA"));
  console.log(`  ALDALENE id=${ald.id.slice(0,8)} empresa cadastro=${cn[ald.company_id]}`);
  const pmrAld = await pageAll(()=> sb.from("promoter_monthly_results").select("company_id,year,month,source,final_commission_value").eq("promoter_id",ald.id).eq("year",2026).eq("month",7));
  console.log(`  linhas de PMR da ALDALENE em jul/26: ${pmrAld.length}`);
  for (const r of pmrAld) console.log(`     ${cn[r.company_id]} | src=${r.source} | final=${f(r.final_commission_value)}`);
  console.log(`  >>> tem linha na ADS? ${pmrAld.some(r=>r.company_id===ADS) ? "SIM" : "NAO"}`);
  const { data: cmsOp } = await sb.from("cms_promoter_entries").select("contract_number,promoter_id,j_key,prod_year,prod_month").eq("contract_number","211689509");
  console.log(`\n  dono do contrato 211689509 (cms): ${(cmsOp||[]).map(r=>`${pn[r.promoter_id]} (j_key ${r.j_key}, ${r.prod_year}-${String(r.prod_month).padStart(2,"0")})`).join(", ")}`);
  console.log(`  ALDALENE tem algo com esse contrato? ${(cmsOp||[]).some(r=>r.promoter_id===ald.id)?"SIM":"NAO"}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
