/* READ-ONLY. A conta das TRES matrizes fecha? E qual a competencia de cada uma? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, r2=v=>Math.round(v*100)/100, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  console.log("=== o seletor de caixa oferece maio/26? ===");
  const p5 = await buildFinancialAnalytics(sb,{year:2026,month:5});
  console.log("  periodos: " + p5.periods.map(x=>x.key).join(", "));
  console.log("  selecionado: " + p5.selectedPeriod.key);

  for (const [y,m] of [[2026,5],[2026,6],[2026,7],[2026,8]]) {
    const p = await buildFinancialAnalytics(sb,{year:y,month:m});
    const s = p.summary;
    const k = `${y}-${String(m).padStart(2,"0")}`;
    const ent = p.detalhamento.entrada.total, sai = p.detalhamento.saida.total;
    const saldoCalc = r2(ent - sai - s.totalExpenses);
    console.log(`\n### caixa ${k}`);
    console.log(`  Recebido (M-1)        = ${f(ent).padStart(13)}   [matriz entrada]`);
    console.log(`  Comissoes pagas (M-1) = ${f(sai).padStart(13)}   [matriz saida]`);
    console.log(`  Despesas (M)          = ${f(s.totalExpenses).padStart(13)}   [matriz despesa]`);
    console.log(`  ------------------------------------------`);
    console.log(`  Saldo calculado       = ${f(saldoCalc).padStart(13)}`);
    console.log(`  card operatingResult  = ${f(s.operatingResult).padStart(13)}   ${Math.abs(saldoCalc-s.operatingResult)<0.005?"[FECHA]":">>> NAO FECHA <<<"}`);
  }

  console.log("\n=== despesas de 2026-05, linha a linha ===");
  const { data: comps } = await sb.from("companies").select("id,name");
  const nome=Object.fromEntries(comps.map(c=>[c.id,c.name]));
  const { data: cats } = await sb.from("expense_categories").select("id,name");
  const cn=Object.fromEntries(cats.map(c=>[c.id,c.name]));
  const { data: exp } = await sb.from("financial_expenses").select("*").eq("year",2026).eq("month",5);
  console.log("empresa | categoria | scope | status | valor");
  for (const r of exp) console.log(`  ${(nome[r.company_id]||"SEM").padEnd(16)} | ${(cn[r.category_id]||"?").padEnd(12)} | ${r.scope} | ${r.status} | ${f(r.amount).padStart(12)}`);
  console.log(`  TOTAL = ${f(exp.reduce((s,r)=>s+n(r.amount),0))}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
