/* READ-ONLY. Chama buildFinancialAnalytics REAL e mostra o efeito da ADS. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = v => (Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const pct = (d,b) => b ? ((d/b)*100).toFixed(2)+"%" : "-";

// ANTES (medido antes do patch, 4 empresas RR): valores congelados so para EXIBIR
const ANTES = {
  "2026-08": { receivedNet: 299736.82, receivedEmpresa: 232525.62, receivedInsurance: 5131.69 },
};

(async()=>{
  for (const [y,m] of [[2026,6],[2026,7],[2026,8]]) {
    const r = await buildFinancialAnalytics(sb, { year: y, month: m });
    const s = r.summary;
    const k = `${y}-${String(m).padStart(2,"0")}`;
    console.log(`\n########## competencia ${k} (caixa: le fechamento de M-1) ##########`);
    console.log(`  receivedNet (card "Recebido") = ${f(s.receivedNet)}`);
    console.log(`  receivedEmpresa ("Comissoes recebidas") = ${f(s.receivedEmpresa)}`);
    console.log(`  receivedInsurance ("Seguro recebido")   = ${f(s.receivedInsurance)}`);
    console.log(`  comissoesPagas = ${f(s.comissoesPagas)} | despesas = ${f(s.totalExpenses)}`);
    console.log(`  Saldo de comissoes a vista = ${f(s.receivedEmpresa - s.comissoesPagas)}`);
    console.log(`  operatingResult (Saldo) = ${f(s.operatingResult)}`);
    const a = ANTES[k];
    if (a) {
      console.log(`  --- ANTES x DEPOIS ---`);
      for (const campo of ["receivedNet","receivedEmpresa","receivedInsurance"]) {
        const d = s[campo] - a[campo];
        console.log(`     ${campo}: ${f(a[campo])} -> ${f(s[campo])}  (delta ${f(d)} = ${pct(d,a[campo])})`);
      }
    }
  }
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
