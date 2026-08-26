require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
async function pageAll(build){const all=[];for(let f=0;;f+=1000){const{data,error}=await build().range(f,f+999);if(error)throw new Error(error.message);all.push(...data);if(data.length<1000)break;}return all;}
(async()=>{
  const { data: one, error } = await sb.from("promoter_monthly_results").select("*").limit(1);
  if (error) throw new Error(error.message);
  console.log("colunas de promoter_monthly_results:\n" + Object.keys(one[0]).join(", "));

  console.log("\n=== ADS: updated_at das 97 linhas de daily_production_records ===");
  const rows = await pageAll(()=> sb.from("daily_production_records")
    .select("proposal_number, movement_date, updated_at, daily_import_id, raw_payload").eq("company_id", ADS));
  const u={}; for(const r of rows){const k=String(r.updated_at).slice(0,16); u[k]=(u[k]||0)+1;}
  for(const [k,v] of Object.entries(u).sort()) console.log(`${k} | ${v}`);

  console.log("\n=== ADS: fonte do __bbts_meta por competencia ===");
  const f={}; for(const r of rows){
    const fonte = r.raw_payload && r.raw_payload.__bbts_meta ? r.raw_payload.__bbts_meta.fonte : "(sem __bbts_meta)";
    const k=`${r.movement_date?String(r.movement_date).slice(0,7):"null"} | ${fonte}`; f[k]=(f[k]||0)+1;
  }
  for(const [k,v] of Object.entries(f).sort()) console.log(`${k} | ${v}`);
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
