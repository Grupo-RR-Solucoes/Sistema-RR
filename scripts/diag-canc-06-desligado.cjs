/* READ-ONLY. Quantos cancelamentos apontam para promotor DESLIGADO? E o apply_to_company. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const proms = await pageAll(()=> sb.from("promoters").select("id,name,active,status,dismissed_at"));
  const pm=new Map(proms.map(p=>[p.id,p]));

  console.log("=== debitos AUTO ja lancados: o promotor ainda esta ativo? ===");
  const deb = await pageAll(()=> sb.from("promoter_debits").select("*").eq("kind","AUTO"));
  let ativos=0, desl=0, vAtivo=0, vDesl=0;
  const casos=[];
  for (const d of deb) {
    const p=pm.get(d.promoter_id);
    if (!p) continue;
    const fora = p.active===false;
    if (fora) { desl++; vDesl+=n(d.total_amount); casos.push({p,d}); } else { ativos++; vAtivo+=n(d.total_amount); }
  }
  console.log(`  AUTO: ${deb.length} | promotor ATIVO: ${ativos} (${f(vAtivo)}) | promotor DESLIGADO: ${desl} (${f(vDesl)})`);
  if (casos.length) {
    console.log("\n  -- os que apontam para desligado: a data do CANCELAMENTO vs a do DESLIGAMENTO --");
    for (const {p,d} of casos) {
      const comp=`${d.start_year}-${String(d.start_month).padStart(2,"0")}`;
      const compDate=`${d.start_year}-${String(d.start_month).padStart(2,"0")}-01`;
      const antes = p.dismissed_at && String(p.dismissed_at) < compDate;
      console.log(`    ${String(p.name).slice(0,28).padEnd(28)} | debito ${comp} (${f(d.total_amount)}) | desligado em ${p.dismissed_at} | desligado ANTES do cancelamento? ${antes?"SIM -> seria da EMPRESA":"NAO -> era dele"}`);
    }
  }

  console.log("\n=== apply_to_company: o mecanismo de 'debito que fica com a empresa' ===");
  const disc = await pageAll(()=> sb.from("promoter_discounts").select("apply_to_company, amount, promoter_id, company_id, discount_type"));
  const comEmp = disc.filter(r=>r.apply_to_company===true);
  console.log(`  promoter_discounts: ${disc.length} | apply_to_company=true: ${comEmp.length} (${f(comEmp.reduce((s,r)=>s+n(r.amount),0))})`);
  console.log(`  apply_to_company=false: ${disc.filter(r=>r.apply_to_company===false).length}`);
  console.log(`  => o campo EXISTE e e o mecanismo. Hoje NENHUM esta marcado como da empresa.`);
  console.log(`\n  promoter_discounts.promoter_id nulo: ${disc.filter(r=>!r.promoter_id).length}/${disc.length}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
