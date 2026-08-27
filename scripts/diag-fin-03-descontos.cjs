/* READ-ONLY. Os 1.664,99 do gap: promoter_discounts de jul/26, e da para atribuir a empresa? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, r2=v=>Math.round(v*100)/100, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: comps } = await sb.from("companies").select("id,name");
  const nome=Object.fromEntries(comps.map(c=>[c.id,c.name]));
  const { data: proms } = await sb.from("promoters").select("id, name, full_name");
  const pn=Object.fromEntries((proms||[]).map(p=>[p.id,p.full_name||p.name]));

  const desc = await pageAll(()=> sb.from("promoter_discounts").select("*").eq("year",2026).eq("month",7));
  console.log("=== promoter_discounts de 2026-07 ===");
  console.log("total de linhas: " + desc.length);
  console.log("colunas: " + Object.keys(desc[0]||{}).join(", ") + "\n");
  let somaAbate=0, somaEmpresa=0;
  console.log("empresa | promotor | amount | apply_to_company | status | tipo");
  for (const r of desc) {
    const abate = r.apply_to_company !== true;
    if (abate) somaAbate+=n(r.amount); else somaEmpresa+=n(r.amount);
    console.log(`  ${(nome[r.company_id]||">>> SEM company_id <<<").padEnd(26)} | ${(pn[r.promoter_id]||"(sem promotor)").slice(0,22).padEnd(22)} | ${f(r.amount).padStart(10)} | ${String(r.apply_to_company)} | ${r.status||"-"} | ${r.debit_type||r.kind||"-"}`);
  }
  console.log(`\n  Sigma que ABATE o repasse (apply_to_company != true) = ${f(somaAbate)}`);
  console.log(`  Sigma da EMPRESA (apply_to_company = true, NAO abate)  = ${f(somaEmpresa)}`);
  console.log(`  gap medido entre matriz e card                        = 1.664,99`);
  console.log(`  bate? ${Math.abs(somaAbate-1664.99)<0.02 ? "SIM — o gap sao os descontos" : "NAO"}`);

  console.log("\n=== por empresa (da para atribuir?) ===");
  const porEmp={}; let semEmp=0;
  for (const r of desc) { if (r.apply_to_company===true) continue;
    if (!r.company_id) { semEmp+=n(r.amount); continue; }
    porEmp[nome[r.company_id]||r.company_id]=r2((porEmp[nome[r.company_id]||r.company_id]||0)+n(r.amount)); }
  for (const [k,v] of Object.entries(porEmp).sort()) console.log(`  ${k.padEnd(26)} | ${f(v).padStart(12)}`);
  console.log(`  ${"(SEM company_id)".padEnd(26)} | ${f(semEmp).padStart(12)}  <- viraria linha 'nao atribuido'`);

  console.log("\n=== PMR de jul/26: alguma linha SEM company_id? ===");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results").select("company_id, final_commission_value, source").eq("year",2026).eq("month",7).neq("source","daily"));
  const semCid = pmr.filter(r=>!r.company_id);
  console.log(`  linhas: ${pmr.length} | sem company_id: ${semCid.length} | valor: ${f(semCid.reduce((s,r)=>s+n(r.final_commission_value),0))}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
