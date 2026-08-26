/* READ-ONLY. Existe discriminador de tipo em daily_imports sem mudar esquema? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const rows = await pageAll(()=> sb.from("daily_imports").select("*").order("created_at"));
  console.log("total de linhas em daily_imports: " + rows.length);
  console.log("colunas: " + Object.keys(rows[0]).join(", "));

  const setCount = {};
  for (const c of Object.keys(rows[0])) setCount[c] = rows.filter(r=>r[c]!==null && r[c]!==undefined).length;
  console.log("\ncoluna | linhas com valor NAO-nulo (de " + rows.length + ")");
  for (const [k,v] of Object.entries(setCount)) console.log(`${k} | ${v}`);

  console.log("\n=== import_date: preenchido em algum lugar? ===");
  const comData = rows.filter(r=>r.import_date);
  console.log("linhas com import_date preenchido: " + comData.length);

  console.log("\n=== distribuicao de extensao do file_name ===");
  const ext = {};
  for (const r of rows) { const m = String(r.file_name||"").match(/\.([A-Za-z0-9]+)$/); const e = m?m[1].toLowerCase():"(sem extensao)"; ext[e]=(ext[e]||0)+1; }
  for (const [k,v] of Object.entries(ext).sort()) console.log(`.${k} | ${v}`);

  console.log("\n=== processing_notes: usado para tipo? amostra dos nao-nulos ===");
  const pn = rows.filter(r=>r.processing_notes).slice(0,3);
  console.log(pn.length ? JSON.stringify(pn.map(r=>({file:r.file_name, notes:String(r.processing_notes).slice(0,120)})), null, 2) : "(nenhum)");
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
