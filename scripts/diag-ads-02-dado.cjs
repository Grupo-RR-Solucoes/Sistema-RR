/* READ-ONLY. Achado 1, item 2: as 43 linhas foram gravadas em daily_production_records? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const IDS = {
  "8a33c524-76e8-4e42-8877-949d5153a1e4": "pdf (1).pdf 03/08 16:43 (o do Diego) 43",
  "316d6251-c4a6-4c9a-b197-5ed00d67ca23": "pdf (1).pdf 04/08 05:51 43",
  "256fd49c-62d1-448f-9780-7bf3b5e6f0f5": "pdf (1).pdf 14/08 10:03 44",
  "704d3505-eea8-4400-8570-9644fc1a24b0": "fechamento_bbts_junho.pdf 08/07 19",
  "2d29691e-a721-4590-85b5-f4dc5e75fbec": "fechamento_bbts_junho.pdf 08/07 19",
  "2c481ce9-1979-474e-a95f-10fb2a1c4e05": "fechamento_bbts_junho.pdf 08/07 20",
  "901e4e78-106d-496b-a665-45801aa542ae": "Credito ADS-BBTS.pdf 13/07 20",
};

async function pageAll(build){const all=[];for(let f=0;;f+=1000){const{data,error}=await build().range(f,f+999);if(error)throw new Error(error.message);all.push(...data);if(data.length<1000)break;}return all;}

async function main(){
  for (const [id, rot] of Object.entries(IDS)) {
    const { count, error } = await sb.from("daily_production_records").select("id", { count: "exact", head: true }).eq("daily_import_id", id);
    if (error) throw new Error(error.message);
    console.log(`daily_import_id=${id}  [${rot}]  -> daily_production_records: ${count}`);
  }

  console.log("\n=== detalhe do registro do Diego (8a33c524) ===");
  const rows = await pageAll(()=> sb.from("daily_production_records").select("*").eq("daily_import_id","8a33c524-76e8-4e42-8877-949d5153a1e4"));
  console.log("linhas:", rows.length);
  if (rows.length) {
    console.log("colunas:", Object.keys(rows[0]).join(", "));
    console.log("\n-- primeira linha crua --");
    console.log(JSON.stringify(rows[0], null, 2));
  }
}
main().catch(e=>{console.error("ERRO:", e.message); process.exit(1);});
