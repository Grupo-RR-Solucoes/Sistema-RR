/* READ-ONLY. Achado 1, item 2: onde foi parar o dado do "pdf (1).pdf". */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function pageAll(build){const all=[];for(let f=0;;f+=1000){const{data,error}=await build().range(f,f+999);if(error)throw new Error(error.message);all.push(...data);if(data.length<1000)break;}return all;}

async function main(){
  const { data: comps } = await sb.from("companies").select("id, name, cnpj").order("name");
  const nome = Object.fromEntries(comps.map(c=>[c.id, c.name]));
  console.log("=== companies ===");
  for (const c of comps) console.log(`${c.id} | ${c.name} | ${c.cnpj}`);

  const rows = await pageAll(()=> sb.from("daily_production_records")
    .select("id, company_id, proposal_number, movement_date, contract_date, proposal_date, created_at, updated_at, daily_import_id, promoter_source, gross_value, bbts_pag_avista, bbts_seguro_pago, raw_payload")
    .eq("daily_import_id","256fd49c-62d1-448f-9780-7bf3b5e6f0f5"));
  console.log("\n=== 43 linhas carimbadas com 256fd49c (14/08, mesmo 'pdf (1).pdf') ===");
  console.log("total:", rows.length);
  const by = {};
  for (const r of rows) {
    const k = `${nome[r.company_id]||r.company_id} | mov=${r.movement_date? String(r.movement_date).slice(0,7):"null"} | ctr=${r.contract_date? String(r.contract_date).slice(0,7):"null"} | criada=${String(r.created_at).slice(0,10)}`;
    by[k] = (by[k]||0)+1;
  }
  console.log("\nempresa | competencia(movement) | contract_date | data de CRIACAO da linha | qtd");
  for (const [k,v] of Object.entries(by).sort()) console.log(`${k} | ${v}`);
  console.log("\n-- 3 linhas cruas --");
  console.log(JSON.stringify(rows.slice(0,3), null, 2));
}
main().catch(e=>{console.error("ERRO:", e.message); process.exit(1);});
