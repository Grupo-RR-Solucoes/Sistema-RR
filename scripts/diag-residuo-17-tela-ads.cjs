/* READ-ONLY. A LINHA DA ADS como a tela /financeiro a monta (buildFinancialAnalytics),
   por competencia. E o numero que vai mudar quando a migration rodar. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
  for (const [y, m] of [[2026, 7], [2026, 8], [2026, 9]]) {
    const p = await buildFinancialAnalytics(sb, { year: y, month: m });
    const s = p.summary || {};
    console.log(`\n### /financeiro ${y}-${String(m).padStart(2, "0")}  (caixa: o "Recebido" de M vem do fechamento de M-1)`);
    console.log("  summary:", Object.entries(s).filter(([k]) => /receiv|cash|total/i.test(k)).map(([k, v]) => `${k}=${f(v)}`).join("  "));
    const linhaAds = ((p.detalhamento && p.detalhamento.entrada && p.detalhamento.entrada.linhas) || []).find((l) => /ADS/i.test(l.rotulo || ""));
    if (linhaAds) {
      console.log(`  linha ADS na matriz de ENTRADA: ${linhaAds.rotulo}`);
      console.log("      celulas: " + JSON.stringify(linhaAds.celulas));
    } else {
      console.log("  (sem linha ADS na matriz de entrada nesta competencia)");
    }
  }
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
