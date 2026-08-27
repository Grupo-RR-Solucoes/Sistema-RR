/* READ-ONLY. (a) as 2 da fila e o cms. (b) o universo REAL de cancelamento da ADS. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  console.log("=== (a) AS 2 DA FILA: de quem sao, e o cms cobre? ===");
  const { data: fila } = await sb.from("promoter_debit_assignments").select("*").in("operation",["209867885","209621970"]);
  for (const r of fila) console.log(`  ${r.operation} | ${r.year}-${String(r.month).padStart(2,"0")} | source_kind=${r.source_kind} | ${f(r.estorno_amount)} | debit_type=${r.debit_type}`);
  console.log("\n  source_kind DAILY_CANCEL = caminho da ADS (resolveAdsCancelDebits). O cms e seed do RR.");
  const { data: emCms } = await sb.from("cms_promoter_entries").select("contract_number, prod_year, prod_month, promoter_credit, promoter_insurance").in("contract_number",["209867885","209621970"]);
  console.log(`  linhas dessas 2 operacoes no cms: ${(emCms||[]).length}`);
  const { data: emMce } = await sb.from("monthly_closing_entries").select("year,month,entry_type,sheet_name").in("operation_number",["209867885","209621970"]);
  console.log(`  linhas em monthly_closing_entries: ${(emMce||[]).length}`);
  console.log("  => nao existem no universo do RR. O cms nao as cobre porque elas nao sao do RR.");

  console.log("\n=== (b) UNIVERSO REAL DE CANCELAMENTO DA ADS ===");
  const asg = await pageAll(()=> sb.from("promoter_debit_assignments").select("*").eq("source_kind","DAILY_CANCEL"));
  const src = await pageAll(()=> sb.from("promoter_debit_sources").select("*").eq("source_kind","DAILY_CANCEL"));
  console.log(`  na FILA (sem dono)     : ${asg.length} op(s) | ${f(asg.reduce((s,r)=>s+n(r.estorno_amount),0))}`);
  for (const r of asg) console.log(`     ${r.operation} | ${r.year}-${String(r.month).padStart(2,"0")} | ${f(r.estorno_amount)}`);
  console.log(`  JA DEBITADAS           : ${src.length} op(s) | ${f(src.reduce((s,r)=>s+n(r.estorno_amount),0))}`);
  for (const r of src) console.log(`     ${r.operation} | ${f(r.estorno_amount)} | resolved_via=${r.resolved_via}`);
  const tot=asg.reduce((s,r)=>s+n(r.estorno_amount),0)+src.reduce((s,r)=>s+n(r.estorno_amount),0);
  console.log(`  TOTAL conhecido da ADS : ${asg.length+src.length} op(s) | ${f(tot)}`);

  console.log("\n=== a ADS tem OUTRO universo de cancelamento que eu nao vi? ===");
  const d = await pageAll(()=> sb.from("daily_production_records").select("proposal_number,status,cancellation_date,raw_payload").eq("company_id",ADS));
  console.log(`  daily da ADS: ${d.length}`);
  console.log(`    status CANCELADO           : ${d.filter(r=>String(r.status).toUpperCase()==="CANCELADO").length}`);
  console.log(`    cancellation_date != null  : ${d.filter(r=>r.cancellation_date).length}`);
  console.log(`    __bbts_meta.cancelado=true : ${d.filter(r=>r.raw_payload?.__bbts_meta?.cancelado===true).length}`);
  const segTipos={};
  for (const r of d){ const t=r.raw_payload?.__bbts_meta?.seguro_tipo; if(t) segTipos[t]=(segTipos[t]||0)+1; }
  console.log(`    __bbts_meta.seguro_tipo    : ${JSON.stringify(segTipos)}`);
  const prt = await pageAll(()=> sb.from("bbts_prt_parcelas").select("valor_parcela").eq("company_id",ADS));
  console.log(`    bbts_prt_parcelas negativas: ${prt.filter(r=>n(r.valor_parcela)<0).length} de ${prt.length}`);

  console.log("\n=== os 5 casam com promotor? ===");
  const ops=[...asg.map(r=>String(r.operation)),...src.map(r=>String(r.operation))];
  const { data: dd } = await sb.from("daily_production_records").select("proposal_number,assigned_promoter_id,company_id").in("proposal_number",ops);
  const { data: proms } = await sb.from("promoters").select("id,name,active,dismissed_at");
  const pm=new Map(proms.map(p=>[p.id,p]));
  const byOp=new Map((dd||[]).map(r=>[String(r.proposal_number),r]));
  let casam=0, naoCasam=0, vCasam=0, vNao=0;
  for (const r of [...asg,...src]) {
    const op=String(r.operation), v=n(r.estorno_amount);
    const d2=byOp.get(op);
    const pid=d2?.assigned_promoter_id;
    if (pid) { casam++; vCasam+=v; const p=pm.get(pid); console.log(`  ${op} | ${f(v).padStart(8)} | CASA -> ${p?.name} (${p?.active===false?`INATIVO ${p.dismissed_at}`:"ativo"})`); }
    else { naoCasam++; vNao+=v; console.log(`  ${op} | ${f(v).padStart(8)} | NAO CASA (sem linha no daily da ADS)`); }
  }
  console.log(`\n  casam: ${casam} (${f(vCasam)}) | nao casam: ${naoCasam} (${f(vNao)}) | total ${f(vCasam+vNao)}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
