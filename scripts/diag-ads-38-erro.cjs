/* READ-ONLY. O ERRO CRU por tabela, via REST direto (mostra status HTTP e code). */
require("./_ts_register.cjs");
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TAB = ["fechamento_mensal_empresa","promoter_monthly_results","promoter_discounts","daily_production_records","bbts_prt_parcelas","diferido_parcelas","receita_lancamento_manual"];
(async()=>{
  console.log("=== GET /rest/v1/<tabela>?limit=1  com a chave ANON (sem sessao) ===");
  console.log("tabela | HTTP | corpo");
  for (const t of TAB) {
    const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
    const body = await r.text();
    console.log(`${t.padEnd(28)} | ${r.status} | ${body.slice(0,160)}`);
  }
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
