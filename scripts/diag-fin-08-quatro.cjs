/* READ-ONLY. Os 4 nomes citados: existem? em quais competencias? multi-empresa? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: comps } = await sb.from("companies").select("id,name");
  const nome=Object.fromEntries(comps.map(c=>[c.id,c.name]));
  const { data: proms } = await sb.from("promoters").select("id, name, active");
  const ALVOS=["FABIANA","LETICIA","LETÍCIA","CAMILA","KETLEY"];
  const achados=(proms||[]).filter(p=>ALVOS.some(a=>String(p.name||"").toUpperCase().includes(a)));
  console.log("=== promotores que casam os nomes citados ===");
  for (const p of achados) console.log(`  ${p.name} | id=${p.id.slice(0,8)} | active=${p.active}`);
  if (!achados.length) { console.log("  (nenhum)"); return; }

  const ids=achados.map(p=>p.id);
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results")
    .select("promoter_id, company_id, year, month, source, final_commission_value, production_value").in("promoter_id", ids));
  console.log(`\n=== linhas de PMR desses promotores: ${pmr.length} ===`);
  const byProm={};
  for (const r of pmr) (byProm[r.promoter_id]=byProm[r.promoter_id]||[]).push(r);
  for (const p of achados) {
    const rows=byProm[p.id]||[];
    if (!rows.length) { console.log(`\n  ${p.name}: SEM linha de PMR em nenhuma competencia`); continue; }
    const comps2=new Set(rows.map(r=>r.company_id));
    console.log(`\n  ${p.name}: ${rows.length} linha(s), ${comps2.size} empresa(s) distinta(s)`);
    const porComp={};
    for (const r of rows){ const k=`${r.year}-${String(r.month).padStart(2,"0")}`; (porComp[k]=porComp[k]||[]).push(r); }
    for (const [k,rs] of Object.entries(porComp).sort()) {
      const emps=new Set(rs.map(r=>r.company_id));
      console.log(`     ${k} | ${emps.size} empresa(s): ${rs.map(r=>`${nome[r.company_id]}=${f(r.final_commission_value)}`).join(" | ")}${emps.size>1?"   <<< MULTI":""}`);
    }
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
