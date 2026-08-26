/* READ-ONLY. Onde foram parar 212205929 (24,05) e 212146378 (24,00)? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = v => (Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const CANC = ["211689509","212205929","212146378"];
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  console.log("=== promoter_debit_sources com essas operacoes ===");
  const { data: src, error } = await sb.from("promoter_debit_sources").select("*").in("operation", CANC);
  if (error) throw new Error(error.message);
  console.log("linhas: " + src.length);
  console.log(JSON.stringify(src, null, 2));

  console.log("\n=== esses 3 contratos existem no daily da ADS? tem promotor? ===");
  const { data: d } = await sb.from("daily_production_records")
    .select("proposal_number, movement_date, assigned_promoter_id, promoter_source, bbts_seguro_pago")
    .eq("company_id","375aea6d-3b9c-4490-87f0-e739e312c8ef").in("proposal_number", CANC);
  for (const r of (d||[])) console.log(`${r.proposal_number} | mov=${r.movement_date} | promotor=${r.assigned_promoter_id ? "SIM" : "NAO"} (${r.promoter_source}) | seg_pago=${f(r.bbts_seguro_pago)}`);
  const achados = new Set((d||[]).map(r=>String(r.proposal_number)));
  for (const c of CANC) if (!achados.has(c)) console.log(`${c} | NAO EXISTE em daily_production_records da ADS`);

  console.log("\n=== promoter_debits da ADS (company_id ADS), todos ===");
  const deb = await pageAll(()=> sb.from("promoter_debits").select("*").eq("company_id","375aea6d-3b9c-4490-87f0-e739e312c8ef"));
  console.log("linhas: " + deb.length);
  for (const r of deb) console.log(`${r.start_year}-${String(r.start_month).padStart(2,"0")} | ${r.debit_type} | ${f(r.total_amount)} | status=${r.status} | criado=${String(r.created_at).slice(0,19)} | notes=${r.notes}`);

  console.log("\n=== promoter_debit_assignments da ADS: TODAS as competencias ===");
  const asg = await pageAll(()=> sb.from("promoter_debit_assignments").select("*").eq("debit_type","CANCELAMENTO_SEGURO"));
  console.log("linhas CANCELAMENTO_SEGURO: " + asg.length);
  for (const r of asg) console.log(`${r.year}-${String(r.month).padStart(2,"0")} | ${r.source_kind} | op=${r.operation} | estorno=${f(r.estorno_amount)} | status=${r.status} | criado=${String(r.created_at).slice(0,19)}`);
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
