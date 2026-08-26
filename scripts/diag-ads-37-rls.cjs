/* READ-ONLY. Estado de permissao de CADA tabela do caminho do financialAnalytics. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const adm  = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const JA_LIDAS = ["companies","expense_categories","fechamento_mensal_empresa","financial_expenses","cash_opening_balances","diferido_parcelas","promoter_monthly_results","receita_lancamento_manual","promoter_discounts"];
const INTRODUZIDAS = ["daily_production_records","bbts_prt_parcelas"];

async function probe(cli, t) {
  const { data, error, count } = await cli.from(t).select("*", { count: "exact", head: true });
  if (error) return { ok:false, msg: `${error.code || "?"} ${error.message}` };
  return { ok:true, msg: `count=${count}` };
}

(async()=>{
  console.log("=== pg_policies via PostgREST? ===");
  const { error: e } = await adm.from("pg_policies").select("*").limit(1);
  console.log("  " + (e ? `NAO exposta: ${e.code} ${e.message}` : "exposta"));

  console.log("\n=== PROBE por tabela: ANON (o cliente da pagina) x SERVICE_ROLE ===");
  console.log("tabela | ANON | SERVICE_ROLE | introduzida pela minha mudanca?");
  for (const [grupo, lista] of [["ja lida", JA_LIDAS], ["INTRODUZIDA", INTRODUZIDAS]]) {
    for (const t of lista) {
      const a = await probe(anon, t);
      const s = await probe(adm, t);
      console.log(`${t.padEnd(28)} | ${(a.ok?"OK "+a.msg:"NEGADO: "+a.msg).padEnd(46)} | ${(s.ok?"OK "+s.msg:"NEGADO: "+s.msg).padEnd(22)} | ${grupo==="INTRODUZIDA"?"SIM":"nao"}`);
    }
  }
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
