/*
 * GRAVA. Reproduz exatamente o que o import do fechamento da ADS de jul/2026 faz:
 * passa as TRES linhas `tratamento=debito` do PDF de seguro (as unicas negativas).
 *
 * POR QUE AS TRES, e nao so a que falta: a gravacao e delete-and-replace escopada a
 * (kind=AUTO, CANCELAMENTO_SEGURO, 2026-07, company=ADS). Chamar com um subconjunto
 * APAGARIA os debitos que ficaram de fora. Passar o conjunto completo e a unica
 * chamada correta — e e o que o importador faz.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { resolveAdsCancelDebits } = require("../lib/debitInsuranceResolver.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f=v=>(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});

// As 3 linhas CANCELADO do PDF de seguro de jul/2026 (medidas em 26/08, Sigma -49,45)
const DEBITOS = [
  { contrato: "211689509", valor_seguro: -1.40,  tipo: "ESTOQUE D0" },
  { contrato: "212205929", valor_seguro: -24.05, tipo: "ESTOQUE D0" },
  { contrato: "212146378", valor_seguro: -24.00, tipo: "ESTOQUE D0" },
];

(async()=>{
  const plan = await resolveAdsCancelDebits(sb, { year:2026, month:7, debitos:DEBITOS, dryRun:false, createdBy:"rotina-automatica" });
  console.log("=== GRAVADO ===");
  console.log(`  debitos: ${plan.debits.length}`);
  for (const d of plan.debits) console.log(`     ${d.promoterName} | ${f(d.total)} | fontes: ${d.sources.map(s=>`${s.operation}(${s.resolvedVia})`).join(", ")}`);
  console.log(`  fila: ${plan.fila.length} -> ${plan.fila.map(r=>r.operation).join(", ")}`);
  if (plan.avisos?.length) { console.log("  avisos:"); for (const a of plan.avisos) console.log(`     ${a}`); }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
