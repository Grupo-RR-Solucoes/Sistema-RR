/* READ-ONLY. Ha despesa de escopo GRUPO? Ha lancamento em junho/26? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { count } = await sb.from("financial_expenses").select("id",{count:"exact",head:true});
  console.log("=== financial_expenses: contagem exata = " + count + " ===");
  const exp = await pageAll(()=> sb.from("financial_expenses").select("*").order("year").order("month"));
  console.log("linhas trazidas: " + exp.length);
  const { data: comps } = await sb.from("companies").select("id,name");
  const nome=Object.fromEntries(comps.map(c=>[c.id,c.name]));
  const { data: cats } = await sb.from("expense_categories").select("id,name");
  const cn=Object.fromEntries(cats.map(c=>[c.id,c.name]));
  console.log("\ncompetencia | empresa | categoria | scope | status | valor");
  for (const r of exp) console.log(`  ${r.year}-${String(r.month).padStart(2,"0")} | ${(r.company_id?nome[r.company_id]:">>> SEM EMPRESA <<<").padEnd(18)} | ${(cn[r.category_id]||"?").padEnd(12)} | ${String(r.scope).padEnd(8)} | ${r.status} | ${f(r.amount).padStart(12)}`);

  const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase();
  const grupo = exp.filter(r=> norm(r.scope)==="GROUP" || norm(r.scope)==="GRUPO" || !r.company_id);
  console.log(`\n=== despesas de escopo GRUPO (regra de financialAnalytics:1058) ===`);
  console.log(`  linhas: ${grupo.length} | Sigma ${f(grupo.reduce((s,r)=>s+n(r.amount),0))}`);
  console.log(`\n=== junho/2026 especificamente ===`);
  const jun = exp.filter(r=>r.year===2026 && r.month===6);
  console.log(`  linhas: ${jun.length} | Sigma ${f(jun.reduce((s,r)=>s+n(r.amount),0))}`);
  console.log(`\n=== procurando 33.180,03 em qualquer competencia/recorte ===`);
  const porComp={}; for(const r of exp){const k=`${r.year}-${String(r.month).padStart(2,"0")}`; porComp[k]=(porComp[k]||0)+n(r.amount);}
  for (const [k,v] of Object.entries(porComp).sort()) console.log(`  ${k} | ${f(v)}${Math.abs(v-33180.03)<0.02?"   <<< BATE":""}`);
  console.log(`  (nenhuma bate 33.180,03)` );
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
