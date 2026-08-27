/* GRAVA (idempotente). Roda a reconsolidacao de jul/2026 — o mesmo passo que o
 * import do fechamento dispara e que o "Recalcular competencia" exercita. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { reconsolidarCompetenciaFechada } = require("../lib/reconsolidarCompetencia.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async()=>{
  const r = await reconsolidarCompetenciaFechada(sb, { year:2026, month:7, dryRun:false });
  console.log("=== reconsolidarCompetenciaFechada(2026-07) ===");
  console.log(`  ran=${r.ran} regime=${r.regime} ${r.motivo?("motivo="+r.motivo):""}`);
  if (r.escritas !== undefined) console.log(`  escritas=${r.escritas} apagadas=${r.apagadas ?? "-"}`);
  console.log("  " + JSON.stringify(Object.keys(r)));
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
