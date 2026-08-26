/* READ-ONLY. Achado 1, itens 4 e 5. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
async function pageAll(build){const all=[];for(let f=0;;f+=1000){const{data,error}=await build().range(f,f+999);if(error)throw new Error(error.message);all.push(...data);if(data.length<1000)break;}return all;}

async function main(){
  console.log("=== monthly_closing_imports: TODAS as linhas (empresa, ano, mes, status) ===");
  const mci = await pageAll(()=> sb.from("monthly_closing_imports").select("id, company_id, year, month, file_name, status, created_at").order("created_at"));
  const { data: comps } = await sb.from("companies").select("id,name");
  const nome = Object.fromEntries(comps.map(c=>[c.id,c.name]));
  console.log("total:", mci.length);
  for (const r of mci) console.log(`${String(r.created_at).slice(0,19)} | ${nome[r.company_id]||r.company_id} | ${r.year}-${String(r.month).padStart(2,"0")} | ${r.status} | ${r.file_name}`);
  console.log("\nlinhas com company_id = ADS:", mci.filter(r=>r.company_id===ADS).length);

  console.log("\n=== duplicacao? contagem de daily_production_records da ADS por (proposal_number) ===");
  const rows = await pageAll(()=> sb.from("daily_production_records").select("proposal_number, movement_date").eq("company_id", ADS));
  console.log("total linhas ADS:", rows.length);
  const c = {}; for(const r of rows) c[r.proposal_number]=(c[r.proposal_number]||0)+1;
  const dup = Object.entries(c).filter(([,v])=>v>1);
  console.log("propostas com mais de 1 linha:", dup.length);
  if (dup.length) console.log(JSON.stringify(dup.slice(0,20)));

  console.log("\n=== ADS: linhas por competencia (movement_date) ===");
  const m={}; for(const r of rows){const k=r.movement_date?String(r.movement_date).slice(0,7):"(null)"; m[k]=(m[k]||0)+1;}
  for(const [k,v] of Object.entries(m).sort()) console.log(`${k} | ${v}`);

  console.log("\n=== promoter_monthly_results da ADS ===");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results").select("year, month, source, company_id, promoter_id, total_production, payable").eq("company_id", ADS));
  const p={}; for(const r of pmr){const k=`${r.year}-${String(r.month).padStart(2,"0")} src=${r.source}`; const b=p[k]||(p[k]={n:0,prod:0,pay:0}); b.n++; b.prod+=Number(r.total_production)||0; b.pay+=Number(r.payable)||0;}
  console.log("competencia | source | linhas | producao | payable");
  for(const [k,b] of Object.entries(p).sort()) console.log(`${k} | ${b.n} | ${b.prod.toFixed(2)} | ${b.pay.toFixed(2)}`);
}
main().catch(e=>{console.error("ERRO:", e.message); process.exit(1);});
