/* READ-ONLY. A fila de cancelamentos sem dono, item a item. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: comps } = await sb.from("companies").select("id,name");
  const nome=Object.fromEntries(comps.map(c=>[c.id,c.name]));
  const { data: proms } = await sb.from("promoters").select("id,name,active,status,dismissed_at,hired_at,company_id");
  const pn=Object.fromEntries(proms.map(p=>[p.id,p.name]));

  console.log("=== promoter_debit_assignments (a FILA) ===");
  const fila = await pageAll(()=> sb.from("promoter_debit_assignments").select("*").order("year").order("month"));
  console.log("colunas: " + Object.keys(fila[0]||{}).join(", "));
  console.log("total: " + fila.length);
  console.log("\ncomp | source_kind | operacao | estorno | status | promotor | criado");
  for (const r of fila) {
    console.log(`  ${r.year}-${String(r.month).padStart(2,"0")} | ${String(r.source_kind).padEnd(18)} | ${String(r.operation).padEnd(12)} | ${f(r.estorno_amount).padStart(9)} | ${String(r.status).padEnd(8)} | ${r.promoter_id?pn[r.promoter_id]:"(sem dono)"} | ${String(r.created_at).slice(0,10)}`);
  }
  const pend = fila.filter(r=>r.status==="PENDING");
  console.log(`\n  PENDING: ${pend.length} | Sigma ${f(pend.reduce((s,r)=>s+n(r.estorno_amount),0))}`);
  const porKind={};
  for (const r of pend){ const k=r.source_kind; const b=porKind[k]||(porKind[k]={n:0,v:0}); b.n++; b.v+=n(r.estorno_amount); }
  for (const [k,b] of Object.entries(porKind)) console.log(`    ${k}: ${b.n} op(s), ${f(b.v)}`);

  console.log("\n=== POR QUE cada PENDING nao tem dono ===");
  const ops = pend.map(r=>String(r.operation));
  const daily = ops.length ? await pageAll(()=> sb.from("daily_production_records").select("proposal_number, j_key, assigned_promoter_id, company_id, movement_date").in("proposal_number", ops)) : [];
  const dByOp = new Map(daily.map(r=>[String(r.proposal_number), r]));
  const cms = ops.length ? await pageAll(()=> sb.from("cms_promoter_entries").select("contract_number, j_key, promoter_id").in("contract_number", ops)) : [];
  const cByOp = new Map(cms.map(r=>[String(r.contract_number), r]));
  const { data: jk } = await sb.from("j_keys").select("j_key, promoter_id, key_type");
  const jkMap = new Map((jk||[]).map(k=>[String(k.j_key).toUpperCase(), k]));
  for (const r of pend) {
    const op=String(r.operation);
    const d=dByOp.get(op), c=cByOp.get(op);
    const partes=[];
    partes.push(`daily: ${d?`EXISTE (j_key=${d.j_key||"-"}, assigned=${d.assigned_promoter_id?pn[d.assigned_promoter_id]:"NULO"}, ${nome[d.company_id]})`:"NAO EXISTE"}`);
    partes.push(`cms: ${c?`EXISTE (j_key=${c.j_key||"-"}, promoter=${c.promoter_id?pn[c.promoter_id]:"NULO"})`:"NAO EXISTE"}`);
    const cj = (d&&d.j_key)||(c&&c.j_key);
    if (cj) { const info=jkMap.get(String(cj).toUpperCase()); partes.push(`j_key ${cj}: ${info?`key_type=${info.key_type}, promoter=${info.promoter_id?pn[info.promoter_id]:"NULO"}`:"NAO CADASTRADA"}`); }
    console.log(`\n  ${op} (${f(r.estorno_amount)}, ${r.year}-${String(r.month).padStart(2,"0")}, ${r.source_kind})`);
    for (const p of partes) console.log(`     ${p}`);
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
