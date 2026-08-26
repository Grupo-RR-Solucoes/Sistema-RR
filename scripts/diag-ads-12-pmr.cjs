/* READ-ONLY. Itens 4 e 5: o PMR da ADS e a linha do tempo. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(build){const all=[];for(let x=0;;x+=1000){const{data,error}=await build().range(x,x+999);if(error)throw new Error(error.message);all.push(...data);if(data.length<1000)break;}return all;}

(async()=>{
  console.log("=== promoter_monthly_results da ADS ===");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results")
    .select("year, month, source, promoter_id, production_value, proposal_count, final_commission_value, discount_value, calculated_at, updated_at")
    .eq("company_id", ADS));
  console.log("total linhas ADS:", pmr.length);
  const g={};
  for(const r of pmr){const k=`${r.year}-${String(r.month).padStart(2,"0")} | source=${r.source}`; const b=g[k]||(g[k]={n:0,prod:0,com:0,calc:new Set()}); b.n++; b.prod+=n(r.production_value); b.com+=n(r.final_commission_value); b.calc.add(String(r.calculated_at).slice(0,16));}
  console.log("\ncompetencia | source | linhas | producao | comissao final | calculated_at");
  for(const [k,b] of Object.entries(g).sort()) console.log(`${k} | ${b.n} | ${f(b.prod)} | ${f(b.com)} | ${[...b.calc].sort().join(" ; ")}`);

  console.log("\n=== monthly_closing_imports de 2026-07 (quando julho fechou) ===");
  const { data: mci } = await sb.from("monthly_closing_imports").select("company_id, year, month, status, file_name, created_at").eq("year",2026).eq("month",7).order("created_at");
  const { data: comps } = await sb.from("companies").select("id,name,active");
  const nome = Object.fromEntries(comps.map(c=>[c.id,c.name]));
  for (const r of mci) console.log(`${String(r.created_at).slice(0,19)} | ${nome[r.company_id]} | ${r.status} | ${r.file_name}`);
  const ativas = comps.filter(c=>c.active).length;
  const cob = new Set(mci.filter(r=>r.status==="COMPLETED").map(r=>r.company_id));
  console.log(`\nempresas ativas: ${ativas} | cobertas por closing COMPLETED em jul: ${cob.size} => regime = ${cob.size>=ativas?"fechamento":"open"}`);

  console.log("\n=== LINHA DO TEMPO (UTC) ===");
  console.log("2026-08-03T19:43:45  import ADS 'pdf (1).pdf' #1 (43)   <- o do Diego");
  console.log("2026-08-04T08:51:12  import ADS 'pdf (1).pdf' #2 (43)");
  for (const r of mci) console.log(`${String(r.created_at).slice(0,19)}  fechamento RR ${nome[r.company_id]}`);
  console.log("2026-08-14T13:03:48  import ADS 'pdf (1).pdf' #3 (44)");
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
