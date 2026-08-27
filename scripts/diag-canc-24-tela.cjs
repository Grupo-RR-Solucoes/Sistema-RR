/* READ-ONLY. Com "Empresa: todas", a tela mostra UMA linha por promotor ou uma por empresa? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildPromoterAnalytics } = require("../lib/promoterAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f=v=>(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  // "Empresa: todas" = companyId undefined
  const pa = await buildPromoterAnalytics(sb, { year:2026, month:7, closed:true, closedSource:"fechamento" });
  const rows = pa.summaryRows ?? pa.rows ?? [];
  console.log(`=== summaryRows com "Empresa: todas": ${rows.length} linhas ===`);
  console.log("  colunas de uma linha: " + Object.keys(rows[0]||{}).slice(0,14).join(", "));

  for (const alvo of ["MARIA LETICIA","ALDALENE","BRUNA"]) {
    const meus = rows.filter(r=>String(r.promoter_name||r.name||"").toUpperCase().includes(alvo));
    console.log(`\n  ${alvo}: ${meus.length} linha(s) no resumo`);
    for (const r of meus) console.log(`     company=${r.company_name ?? r.company_id ?? "(sem)"} | final=${f(r.final_commission_value ?? r.payable)} | desconto=${f(r.discount_value)}`);
  }

  console.log("\n=== MARIA LETICIA tem ADS(104,27) + RR AL3(302,39) no PMR. A tela mostra as duas? ===");
  const ml = rows.filter(r=>String(r.promoter_name||r.name||"").toUpperCase().includes("MARIA LETICIA"));
  console.log(`  -> ${ml.length===2?"DUAS linhas (uma por empresa)":ml.length===1?"UMA linha (agregada ou so uma empresa)":"nenhuma"}`);
  if (ml.length===1) {
    const v = Number(ml[0].final_commission_value ?? ml[0].payable ?? 0);
    console.log(`     valor exibido = ${f(v)}`);
    console.log(`     soma das duas = ${f(104.27+302.39)}  -> ${Math.abs(v-406.66)<0.02?"AGREGA as duas":"mostra SO UMA"}`);
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
