/* READ-ONLY. Onde estao "340 parcelas" de PRT? E ha promotor multi-empresa? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, r2=v=>Math.round(v*100)/100, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: comps } = await sb.from("companies").select("id,name,cnpj");
  const nome=Object.fromEntries(comps.map(c=>[c.id,c.name]));
  const porCnpj={}; for(const c of comps) porCnpj[String(c.cnpj).replace(/\D/g,"")]=c.name;

  console.log("=== CANDIDATO: monthly_closing_entries com entry_type='PRT' ===");
  const { data: one, error } = await sb.from("monthly_closing_entries").select("*").limit(1);
  if (error) { console.log("  ERRO: "+error.message); }
  else {
    console.log("  colunas: " + Object.keys(one[0]||{}).join(", "));
    const prt = await pageAll(()=> sb.from("monthly_closing_entries").select("*").eq("year",2026).eq("month",7).eq("entry_type","PRT"));
    console.log(`  linhas PRT em 2026-07: ${prt.length}`);
    if (prt.length) {
      const cols=Object.keys(prt[0]);
      for (const c of ["company_id","promoter_id","j_key","empresa_cnpj","commission_value","value","amount"]) {
        if (!cols.includes(c)) { console.log(`    ${c.padEnd(20)} | coluna NAO existe`); continue; }
        console.log(`    ${c.padEnd(20)} | nao-nulo em ${prt.filter(r=>r[c]!==null&&r[c]!==undefined).length}/${prt.length}`);
      }
      const valCol = cols.find(c=>/commission_value|^value$|amount|valor/.test(c));
      if (valCol) console.log(`    Sigma ${valCol} = ${f(prt.reduce((s,r)=>s+n(r[valCol]),0))}`);
      console.log("    -- 2 linhas cruas --");
      console.log(JSON.stringify(prt.slice(0,2),null,2).slice(0,900));
    }
  }

  console.log("\n=== PMR jul/26: promotor com MAIS DE UMA empresa? ===");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results")
    .select("promoter_id, company_id, final_commission_value, production_value, source")
    .eq("year",2026).eq("month",7).neq("source","daily"));
  const porProm={};
  for (const r of pmr){ (porProm[r.promoter_id]=porProm[r.promoter_id]||[]).push(r); }
  const multi=Object.entries(porProm).filter(([,v])=>new Set(v.map(x=>x.company_id)).size>1);
  console.log(`  promotores distintos: ${Object.keys(porProm).length}`);
  console.log(`  com UMA empresa     : ${Object.keys(porProm).length-multi.length}`);
  console.log(`  com DUAS ou mais    : ${multi.length}`);
  const { data: proms } = await sb.from("promoters").select("id, full_name");
  const pn=Object.fromEntries((proms||[]).map(p=>[p.id,p.full_name]));
  for (const [pid,rows] of multi) {
    console.log(`    ${(pn[pid]||pid).slice(0,28).padEnd(28)} -> ${rows.map(r=>`${nome[r.company_id]}=${f(r.final_commission_value)}`).join(" | ")}`);
  }
  const nomesCitados=["FABIANA","MARIA LETICIA","CAMILA","KETLEY"];
  console.log("\n  os 4 citados pelo Diego, em jul/26:");
  for (const alvo of nomesCitados) {
    const hits=Object.entries(porProm).filter(([pid])=>String(pn[pid]||"").toUpperCase().includes(alvo));
    if (!hits.length) { console.log(`    ${alvo.padEnd(16)} -> sem linha de PMR em jul/26`); continue; }
    for (const [pid,rows] of hits) console.log(`    ${(pn[pid]||"").slice(0,28).padEnd(28)} -> ${new Set(rows.map(r=>r.company_id)).size} empresa(s): ${rows.map(r=>nome[r.company_id]).join(", ")}`);
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
