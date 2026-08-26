/* READ-ONLY. Achado 1, item 1: a linha inteira de daily_imports do "pdf (1).pdf". */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main(){
  // 1) por nome exato
  const { data: exato, error: e1 } = await sb.from("daily_imports").select("*").eq("file_name", "pdf (1).pdf");
  if (e1) throw new Error("exato: " + e1.message);
  console.log("=== eq(file_name,'pdf (1).pdf') -> " + exato.length + " linha(s) ===");
  console.log(JSON.stringify(exato, null, 2));

  // 2) qualquer arquivo com .pdf no nome (a coluna nao deveria ter PDF nenhum)
  const { data: pdfs, error: e2 } = await sb.from("daily_imports").select("*").ilike("file_name", "%.pdf%").order("created_at");
  if (e2) throw new Error("ilike: " + e2.message);
  console.log("\n=== ilike(file_name,'%.pdf%') -> " + pdfs.length + " linha(s) ===");
  console.log(JSON.stringify(pdfs, null, 2));
}
main().catch(e=>{console.error("ERRO:", e.message); process.exit(1);});
