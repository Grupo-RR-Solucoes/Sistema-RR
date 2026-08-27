/* READ-ONLY. Estado final: fila, telas, e sobrevivencia. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildPromoterAnalytics } = require("../lib/promoterAnalytics.ts");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: proms } = await sb.from("promoters").select("id,name");
  const pn=Object.fromEntries(proms.map(p=>[p.id,p.name]));
  console.log("=== A FILA AGORA ===");
  const fila = await pageAll(()=> sb.from("promoter_debit_assignments").select("*").order("year").order("month"));
  console.log(`  ${fila.length} linha(s) (era 7)`);
  for (const r of fila) console.log(`   ${r.year}-${String(r.month).padStart(2,"0")} | ${r.source_kind.padEnd(18)} | ${String(r.operation).padEnd(11)} | ${f(r.estorno_amount).padStart(8)} | ${r.status}`);
  console.log(`\n  211689509 (o de 1,40) ainda na fila? ${fila.some(r=>String(r.operation)==="211689509")?">>> SIM <<<":"NAO — saiu"}`);

  console.log("\n=== SOBREVIVEU AO RECALCULO? ===");
  const src = await pageAll(()=> sb.from("promoter_debit_sources").select("*").eq("operation","211689509"));
  console.log(`  promoter_debit_sources p/ 211689509: ${src.length}`);
  const deb = await pageAll(()=> sb.from("promoter_debits").select("*").eq("company_id",ADS).eq("start_year",2026).eq("start_month",7));
  console.log(`  promoter_debits ADS jul: ${deb.length} | Sigma ${f(deb.reduce((s,r)=>s+n(r.total_amount),0))}`);
  for (const r of deb) console.log(`     ${pn[r.promoter_id]} | ${f(r.total_amount)} | ${r.status}`);

  console.log("\n=== TELAS ===");
  const pa = await buildPromoterAnalytics(sb, { year:2026, month:7, closed:true, closedSource:"fechamento" });
  for (const alvo of ["ALDALENE","BRUNA","MARIA LETICIA"]) {
    const r=(pa.summaryRows||[]).find(x=>String(x.promoter_name).toUpperCase().includes(alvo));
    if (r) console.log(`  ${String(r.promoter_name).slice(0,26).padEnd(26)} | ${String(r.company_name).padEnd(24)} | final=${f(r.final_commission_value).padStart(9)} | desconto=${f(r.discount_value).padStart(7)} | liquido=${f(n(r.final_commission_value)-n(r.discount_value))}`);
  }
  const fin = await buildFinancialAnalytics(sb,{year:2026,month:8});
  const sa=fin.detalhamento.saida, ads=sa.linhas.find(l=>l.chave===ADS);
  console.log(`\n  /financeiro ago/26: ADS descontos=${f(ads?.celulas?.descontos)} | total comissoes pagas=${f(sa.total)} | delta ${f(sa.delta)}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
