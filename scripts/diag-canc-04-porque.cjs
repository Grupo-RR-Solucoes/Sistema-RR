/* READ-ONLY. Por que jan-mar nao casam? E: desligamento, estrutura de debito, ADS. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
const norm=v=>String(v??"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toUpperCase();
const md=(m,k)=>{ if(!m) return undefined; for(const [kk,vv] of Object.entries(m)) if(norm(kk)===norm(k)) return vv; return undefined; };
async function inChunks(tab,col,sel,vals){const out=[];for(let i=0;i<vals.length;i+=200){const{data,error}=await sb.from(tab).select(sel).in(col,vals.slice(i,i+200));if(error)throw new Error(error.message);out.push(...data);}return out;}
(async()=>{
  console.log("=== (A) POR QUE jan/2026 nao casa (141 canceladas, 120 sem dono) ===");
  const seg = await pageAll(()=> sb.from("monthly_closing_entries").select("metadata, commission_value").eq("year",2026).eq("month",1).eq("entry_type","INSURANCE").eq("sheet_name","Seguro"));
  const canc=[...new Map(seg.filter(e=>norm(md(e.metadata,"STATUS"))==="CANCELADO").map(e=>[String(md(e.metadata,"OPERACAO")),e])).values()];
  const ops=canc.map(e=>String(md(e.metadata,"OPERACAO")));
  const cms = await inChunks("cms_promoter_entries","contract_number","contract_number, j_key, promoter_id", ops);
  const daily = await inChunks("daily_production_records","proposal_number","proposal_number, j_key, assigned_promoter_id", ops);
  const prt = await pageAll(()=> sb.from("monthly_closing_entries").select("j_key, metadata").eq("year",2026).eq("month",1).eq("entry_type","PRT"));
  console.log(`  operacoes canceladas: ${ops.length}`);
  console.log(`  com linha em cms_promoter_entries   : ${new Set(cms.map(e=>String(e.contract_number))).size}`);
  console.log(`     dessas, com promoter_id          : ${new Set(cms.filter(e=>e.promoter_id).map(e=>String(e.contract_number))).size}`);
  console.log(`  com linha em daily_production_records: ${new Set(daily.map(e=>String(e.proposal_number))).size}`);
  console.log(`  linhas PRT na competencia           : ${prt.length}`);
  const prtOps=new Set(prt.map(e=>String(md(e.metadata,"NRO OPERACAO")??"")));
  console.log(`  operacoes canceladas presentes no PRT: ${ops.filter(o=>prtOps.has(o)).length}`);

  console.log("\n=== (B) o DIARIO comeca quando? ===");
  const { data: d1 } = await sb.from("daily_production_records").select("movement_date").order("movement_date",{ascending:true}).limit(1);
  console.log(`  movement_date mais antigo em daily_production_records: ${d1?.[0]?.movement_date}`);

  console.log("\n=== (C) PROMOTOR DESLIGADO: que campos existem e o que esta preenchido ===");
  const proms = await pageAll(()=> sb.from("promoters").select("id,name,active,status,hired_at,dismissed_at,is_master"));
  console.log(`  total de promotores: ${proms.length}`);
  const st={}; for(const p of proms) st[String(p.status)]=(st[String(p.status)]||0)+1;
  console.log(`  status: ${JSON.stringify(st)}`);
  console.log(`  active=true: ${proms.filter(p=>p.active===true).length} | active=false: ${proms.filter(p=>p.active===false).length}`);
  console.log(`  dismissed_at preenchido: ${proms.filter(p=>p.dismissed_at).length}`);
  console.log(`  hired_at preenchido: ${proms.filter(p=>p.hired_at).length}`);
  const desl = proms.filter(p=>p.active===false || p.dismissed_at || norm(p.status).includes("DESLIG") || norm(p.status).includes("INATIV"));
  console.log(`\n  candidatos a DESLIGADO (${desl.length}):`);
  for (const p of desl) console.log(`    ${String(p.name).slice(0,34).padEnd(34)} | active=${p.active} | status=${p.status} | dismissed_at=${p.dismissed_at ?? "NULO"}`);

  console.log("\n=== (D) ESTRUTURA DE DEBITO ===");
  for (const t of ["promoter_debits","promoter_debit_sources","promoter_debit_assignments","promoter_discounts"]) {
    const { data, error } = await sb.from(t).select("*").limit(1);
    const { count } = await sb.from(t).select("id",{count:"exact",head:true});
    console.log(`  ${t.padEnd(28)} | ${count} linha(s) | ${error?error.message:Object.keys(data[0]||{}).join(", ")}`);
  }
  const deb = await pageAll(()=> sb.from("promoter_debits").select("*"));
  const dt={}; for(const r of deb) dt[String(r.debit_type)]=(dt[String(r.debit_type)]||0)+1;
  console.log(`  promoter_debits por debit_type: ${JSON.stringify(dt)}`);
  const kd={}; for(const r of deb) kd[String(r.kind)]=(kd[String(r.kind)]||0)+1;
  console.log(`  promoter_debits por kind: ${JSON.stringify(kd)}`);
  console.log(`  promoter_debits com company_id: ${deb.filter(r=>r.company_id).length}/${deb.length}`);
  console.log(`  promoter_debits com promoter_id NULO: ${deb.filter(r=>!r.promoter_id).length}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
