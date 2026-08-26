/* READ-ONLY. Os 3 cancelados de julho viraram DEBITO no banco? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = v => (Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const CANC = ["211689509","212205929","212146378"];
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  for (const t of ["promoter_debits","promoter_debit_sources","promoter_debit_assignments"]) {
    const { data, error } = await sb.from(t).select("*").limit(1);
    if (error) { console.log(`\n### ${t}: ${error.message}`); continue; }
    console.log(`\n### ${t} — colunas: ${Object.keys(data[0]||{}).join(", ") || "(vazia)"}`);
  }

  console.log("\n=== promoter_debits: linhas que citam os 3 contratos cancelados ===");
  const deb = await pageAll(()=> sb.from("promoter_debits").select("*"));
  console.log("total de linhas em promoter_debits: " + deb.length);
  const hit = deb.filter(r => CANC.some(c => JSON.stringify(r).includes(c)));
  console.log("linhas citando 211689509 / 212205929 / 212146378: " + hit.length);
  console.log(JSON.stringify(hit, null, 2));

  console.log("\n=== promoter_debit_assignments para 2026-07 ===");
  const { data: asg, error: e2 } = await sb.from("promoter_debit_assignments").select("*").eq("year",2026).eq("month",7);
  if (e2) console.log(e2.message); else { console.log("linhas: " + asg.length); console.log(JSON.stringify(asg, null, 2)); }
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
