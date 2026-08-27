/* READ-ONLY (dryRun). O caso de INATIVO para com aviso? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { resolveAdsCancelDebits } = require("../lib/debitInsuranceResolver.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f=v=>(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  console.log("##### CASO REAL DE INATIVO: 212540080 (ANA CLARA, saiu 2026-06-13) #####");
  const p = await resolveAdsCancelDebits(sb, { year:2026, month:7, debitos:[{contrato:"212540080", valor_seguro:-1.00, tipo:"ESTOQUE D0"}], dryRun:true });
  console.log(`  debitos lancados: ${p.debits.length}   <- tem de ser 0`);
  console.log(`  na fila         : ${p.fila.length}`);
  for (const r of p.fila) console.log(`     ${r.operation} | ${f(r.estorno)} | motivo: ${r.motivo ?? "(sem motivo)"}`);
  console.log("  AVISOS:");
  for (const a of (p.avisos||[])) console.log(`     ${a}`);

  console.log("\n##### CONTROLE: promotor ATIVO segue lancando #####");
  const q = await resolveAdsCancelDebits(sb, { year:2026, month:7, debitos:[{contrato:"211689509", valor_seguro:-1.40}], dryRun:true });
  console.log(`  debitos lancados: ${q.debits.length} -> ${q.debits.map(d=>`${d.promoterName} ${f(d.total)}`).join(", ")}`);
  console.log(`  na fila         : ${q.fila.length}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
