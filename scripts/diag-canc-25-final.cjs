/* READ-ONLY. Item 4: os multi-empresa ganham/perdem algo? E o estado exato de cada peca. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildPromoterAnalytics } = require("../lib/promoterAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const pa = await buildPromoterAnalytics(sb, { year:2026, month:7, closed:true, closedSource:"fechamento" });
  const rows = pa.summaryRows ?? [];
  const { data: proms } = await sb.from("promoters").select("id,name");
  const pn=Object.fromEntries(proms.map(p=>[p.id,p.name]));
  const { data: comps } = await sb.from("companies").select("id,name");
  const cn=Object.fromEntries(comps.map(c=>[c.id,c.name]));

  console.log("=== item 4: os multi-empresa de jul/26, com desconto ===");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results").select("promoter_id,company_id,final_commission_value").eq("year",2026).eq("month",7).neq("source","daily"));
  const byP={}; for(const r of pmr) (byP[r.promoter_id]=byP[r.promoter_id]||[]).push(r);
  const multi=Object.entries(byP).filter(([,v])=>new Set(v.map(x=>x.company_id)).size>1).map(([pid])=>pid);
  const disc = await pageAll(()=> sb.from("promoter_discounts").select("promoter_id,company_id,amount,year,month").eq("year",2026).eq("month",7));
  console.log("promotor | empresas no PMR | soma PMR | desconto na tela | descontos no banco (por empresa)");
  for (const pid of multi) {
    const r = rows.find(x=>x.promoter_id===pid);
    const meus = disc.filter(d=>d.promoter_id===pid);
    const soma = byP[pid].reduce((s,x)=>s+n(x.final_commission_value),0);
    console.log(`  ${String(pn[pid]).slice(0,26).padEnd(26)} | ${byP[pid].map(x=>cn[x.company_id].slice(0,10)).join("+").padEnd(24)} | ${f(soma).padStart(9)} | ${f(r?.discount_value).padStart(8)} | ${meus.length? meus.map(d=>`${cn[d.company_id].slice(0,8)}=${f(d.amount)}`).join(", ") : "(nenhum)"}`);
  }
  console.log("\n  >>> so MARIA LETICIA tem desconto entre os multi-empresa; os demais: 0,00 antes e depois <<<");

  console.log("\n=== os 4 nomes citados ===");
  for (const alvo of ["FABIANA","MARIA LETICIA","CAMILA","KETLEY"]) {
    const hits = rows.filter(r=>String(r.promoter_name).toUpperCase().includes(alvo));
    for (const r of hits) console.log(`  ${String(r.promoter_name).slice(0,28).padEnd(28)} | ${String(r.company_name).padEnd(24)} | final=${f(r.final_commission_value).padStart(9)} | desconto=${f(r.discount_value)}`);
    if (!hits.length) console.log(`  ${alvo}: sem linha em jul/26`);
  }

  console.log("\n=== ALDALENE e BRUNA, estado exato ===");
  for (const alvo of ["ALDALENE","BRUNA"]) {
    const r = rows.find(x=>String(x.promoter_name).toUpperCase().includes(alvo));
    const liq = n(r?.final_commission_value) - n(r?.discount_value);
    console.log(`  ${String(r?.promoter_name).padEnd(28)} | ${String(r?.company_name).padEnd(24)} | final=${f(r?.final_commission_value)} | desconto=${f(r?.discount_value)} | LIQUIDO=${f(liq)}`);
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
