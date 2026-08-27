/* READ-ONLY (dryRun). A cascata nova resolve o R$ 1,40? E as 2 de junho seguem sem dono? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { resolveAdsCancelDebits } = require("../lib/debitInsuranceResolver.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f=v=>(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  const CASOS = [
    { rot:"jul/2026 — a operacao 211689509 (R$ 1,40)", year:2026, month:7, debitos:[{contrato:"211689509", valor_seguro:-1.40, tipo:"ESTOQUE D0"}] },
    { rot:"jun/2026 — as 2 sem producao (R$ 41,53)",   year:2026, month:6, debitos:[{contrato:"209867885", valor_seguro:-20.70, tipo:"ESTOQUE D0"},{contrato:"209621970", valor_seguro:-20.83, tipo:"ESTOQUE D0"}] },
    { rot:"jul/2026 — as 2 que JA tem debito (idempotencia)", year:2026, month:7, debitos:[{contrato:"212205929", valor_seguro:-24.05},{contrato:"212146378", valor_seguro:-24.00}] },
  ];
  for (const c of CASOS) {
    console.log(`\n##### ${c.rot} #####`);
    const plan = await resolveAdsCancelDebits(sb, { year:c.year, month:c.month, debitos:c.debitos, dryRun:true });
    console.log(`  debitos montados : ${plan.debits.length}`);
    for (const d of plan.debits) console.log(`     -> ${d.promoterName} | ${f(d.total)} | fontes: ${d.sources.map(s=>`${s.operation}(${s.resolvedVia})`).join(", ")}`);
    console.log(`  na FILA          : ${plan.fila.length}`);
    for (const r of plan.fila) console.log(`     -> ${r.operation} | ${f(r.estorno)} | sem dono`);
    if (plan.avisos?.length) { console.log("  AVISOS:"); for (const a of plan.avisos) console.log(`     ${a}`); }
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
