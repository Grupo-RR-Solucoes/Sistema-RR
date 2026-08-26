/* READ-ONLY. Mapeamento: cada fonte do Financeiro tem empresa? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const TAB = ["fechamento_mensal_empresa","receita_lancamento_manual","promoter_monthly_results","promoter_discounts","financial_expenses","bbts_prt_parcelas","daily_production_records"];
(async()=>{
  console.log("=== COLUNAS DE EMPRESA em cada fonte ===");
  for (const t of TAB) {
    const { data, error } = await sb.from(t).select("*").limit(1);
    if (error) { console.log(`${t.padEnd(28)} | ERRO ${error.message}`); continue; }
    const cols = Object.keys(data[0]||{});
    const emp = cols.filter(c=>/company|empresa|cnpj/i.test(c));
    console.log(`${t.padEnd(28)} | ${emp.length? emp.join(", ") : ">>> NENHUMA <<<"}`);
  }
  console.log("\n=== receita_lancamento_manual: linhas e valores (jul e ago/2026) ===");
  const { data: man } = await sb.from("receita_lancamento_manual").select("*");
  console.log("colunas: " + Object.keys(man[0]||{}).join(", "));
  console.log("total de linhas: " + man.length);
  for (const r of man) console.log("  " + JSON.stringify(r));
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
