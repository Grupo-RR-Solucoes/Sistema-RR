/* READ-ONLY. O casamento na ADS. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  console.log("=== ADS: daily_production_records tem numero e promotor? ===");
  const d = await pageAll(()=> sb.from("daily_production_records").select("proposal_number, j_key, assigned_promoter_id, promoter_source, movement_date").eq("company_id",ADS));
  console.log(`  linhas: ${d.length}`);
  console.log(`  com proposal_number      : ${d.filter(r=>r.proposal_number).length}`);
  console.log(`  com assigned_promoter_id : ${d.filter(r=>r.assigned_promoter_id).length}`);
  console.log(`  com j_key                : ${d.filter(r=>r.j_key).length}`);
  const ps={}; for(const r of d) ps[String(r.promoter_source)]=(ps[String(r.promoter_source)]||0)+1;
  console.log(`  promoter_source: ${JSON.stringify(ps)}`);

  console.log("\n=== o resolvedor da ADS usa QUAL cascata? (debitInsuranceResolver:387-395) ===");
  console.log("  so `dailyByOp.get(op)?.assigned_promoter_id` e a fila manual — sem j_key, sem cms, sem PRT");

  console.log("\n=== os cancelados da ADS achariam dono? ===");
  const asg = await pageAll(()=> sb.from("promoter_debit_assignments").select("*").eq("source_kind","DAILY_CANCEL"));
  const src = await pageAll(()=> sb.from("promoter_debit_sources").select("*").eq("source_kind","DAILY_CANCEL"));
  const ops=[...new Set([...asg.map(r=>String(r.operation)), ...src.map(r=>String(r.operation))])];
  console.log(`  operacoes DAILY_CANCEL conhecidas: ${ops.length} (${asg.length} na fila + ${src.length} resolvidas)`);
  const dByOp=new Map(d.map(r=>[String(r.proposal_number),r]));
  for (const op of ops) {
    const r=dByOp.get(op);
    const naFila = asg.find(a=>String(a.operation)===op);
    console.log(`    ${op} | ${naFila?"FILA":"resolvida"} | daily da ADS: ${r?`existe (assigned=${r.assigned_promoter_id?"SIM":"NULO"}, mov=${r.movement_date})`:"NAO EXISTE"}`);
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
