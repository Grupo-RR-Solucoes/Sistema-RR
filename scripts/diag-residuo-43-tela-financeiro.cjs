/* READ-ONLY. A consulta que a TELA do financeiro faz, sem intermediario. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
  for (const [y, m] of [[2026, 7], [2026, 8]]) {
    const fin = await buildFinancialAnalytics(sb, { year: y, month: m });
    const s = fin.summary || {};
    console.log(`\n=== /api/financeiro ${y}-${String(m).padStart(2, "0")} (buildFinancialAnalytics) ===`);
    console.log(`    received          = ${f(s.received)}`);
    console.log(`    receivedClosing   = ${f(s.receivedClosing)}`);
    console.log(`    receivedEmpresa   = ${f(s.receivedEmpresa)}`);
    console.log(`    receivedInsurance = ${f(s.receivedInsurance)}`);
    console.log(`    comissoesPagas    = ${f(s.comissoesPagas)}`);
  }
  const { buildDre } = require("../lib/dre.ts");
  const dre = await buildDre(sb);
  const ads = (dre.companies || []).find((c) => /ADS/i.test(c.name || ""));
  console.log(`\n=== /api/dre  closed=${dre.closed}  periodo=${dre.period && dre.period.key}  empresas=${(dre.companies || []).length} ===`);
  if (ads) {
    console.log(`    ADS (${ads.name}): receita=${f(ads.receita)} fechamento=${f(ads.receitaFechamento)} ` +
      `seguro=${f(ads.receitaSeguro)} comissoes=${f(ads.comissoes)} resultado=${f(ads.resultadoLiquido)}`);
  }
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
