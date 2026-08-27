/* READ-ONLY. O cms traz o desconto EMBUTIDO no valor (sem coluna propria)? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
const norm=v=>String(v??"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toUpperCase();
const md=(m,k)=>{ if(!m) return undefined; for(const [kk,vv] of Object.entries(m)) if(norm(kk)===norm(k)) return vv; return undefined; };
(async()=>{
  const cms = await pageAll(()=> sb.from("cms_promoter_entries").select("prod_year,prod_month,contract_number,promoter_credit,promoter_insurance,company_commission,raw_payload"));
  console.log(`=== cms_promoter_entries: ${cms.length} linhas ===`);
  const negC = cms.filter(r=>n(r.promoter_credit)<0);
  const negI = cms.filter(r=>n(r.promoter_insurance)<0);
  console.log(`  promoter_credit  < 0 : ${negC.length}  ${negC.length?"("+f(negC.reduce((s,r)=>s+n(r.promoter_credit),0))+")":""}`);
  console.log(`  promoter_insurance < 0: ${negI.length}  ${negI.length?"("+f(negI.reduce((s,r)=>s+n(r.promoter_insurance),0))+")":""}`);
  console.log(`  => se o desconto viesse EMBUTIDO, esperava-se linha negativa ou estorno. `);

  console.log("\n=== o raw_payload do cms tem alguma chave de estorno/cancelamento? ===");
  const chaves=new Set();
  for (const r of cms.slice(0,400)) if (r.raw_payload) for (const k of Object.keys(r.raw_payload)) chaves.add(k);
  const suspeitas=[...chaves].filter(k=>/CANCEL|ESTORN|DESCONT|DEDU|ABATE|DEVOL/i.test(norm(k)));
  console.log(`  chaves distintas no raw_payload: ${chaves.size}`);
  console.log(`  com cara de estorno/desconto: ${suspeitas.length? suspeitas.join(", ") : ">>> NENHUMA <<<"}`);
  console.log("  amostra de chaves: " + [...chaves].slice(0,22).join(" | "));

  console.log("\n=== TESTE DIRETO: contratos CANCELADOS em jan/26 aparecem no cms? com que valor? ===");
  const seg = await pageAll(()=> sb.from("monthly_closing_entries").select("commission_value, metadata").eq("year",2026).eq("month",1).eq("entry_type","INSURANCE").eq("sheet_name","Seguro"));
  const canc=[...new Map(seg.filter(e=>norm(md(e.metadata,"STATUS"))==="CANCELADO").map(e=>[String(md(e.metadata,"OPERACAO")),e])).values()];
  const ops=new Set(canc.map(e=>String(md(e.metadata,"OPERACAO"))));
  const noCms = cms.filter(r=>ops.has(String(r.contract_number)));
  console.log(`  canceladas em jan/26: ${ops.size} | com linha no cms (qualquer competencia): ${noCms.length}`);
  for (const r of noCms.slice(0,10)) console.log(`     ${r.contract_number} | cms ${r.prod_year}-${String(r.prod_month).padStart(2,"0")} | credito=${f(r.promoter_credit)} | seguro=${f(r.promoter_insurance)}`);

  console.log("\n=== o PMR do cms bate com a SOMA CRUA do cms (sem desconto)? ===");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results").select("promoter_id,year,month,source,final_commission_value").eq("source","cms"));
  for (const [y,m] of [[2026,1],[2026,2],[2026,3],[2026,5]]) {
    const c=cms.filter(r=>r.prod_year===y&&r.prod_month===m);
    const somaCms=c.reduce((s,r)=>s+n(r.promoter_credit)+n(r.promoter_insurance),0);
    const somaPmr=pmr.filter(r=>r.year===y&&r.month===m).reduce((s,r)=>s+n(r.final_commission_value),0);
    console.log(`  ${y}-${String(m).padStart(2,"0")} | cms cru (credito+seguro) = ${f(somaCms).padStart(13)} | PMR final = ${f(somaPmr).padStart(13)} | delta ${f(somaPmr-somaCms)}`);
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
