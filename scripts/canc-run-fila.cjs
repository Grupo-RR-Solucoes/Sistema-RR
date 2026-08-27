/* GRAVA. Reprocessa jun e jul nos DOIS resolvedores, com o conjunto COMPLETO. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { resolveInsuranceDebits, resolveAdsCancelDebits } = require("../lib/debitInsuranceResolver.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f=v=>(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
// ADS: as 3 linhas CANCELADO do PDF de jul. Junho: as 2 conhecidas (sem fonte).
const ADS_JUL = [
  { contrato:"211689509", valor_seguro:-1.40,  tipo:"ESTOQUE D0" },
  { contrato:"212205929", valor_seguro:-24.05, tipo:"ESTOQUE D0" },
  { contrato:"212146378", valor_seguro:-24.00, tipo:"ESTOQUE D0" },
];
const ADS_JUN = [
  { contrato:"209867885", valor_seguro:-20.70, tipo:"ESTOQUE D0" },
  { contrato:"209621970", valor_seguro:-20.83, tipo:"ESTOQUE D0" },
];
(async()=>{
  for (const [y,m] of [[2026,6],[2026,7]]) {
    console.log(`\n##### RR — resolveInsuranceDebits(${y}-${String(m).padStart(2,"0")}) #####`);
    const r = await resolveInsuranceDebits(sb, { year:y, month:m, dryRun:false, createdBy:"rotina-automatica" });
    console.log(`  debitos: ${r.debits.length} -> ${r.debits.map(d=>`${d.promoterName} ${f(d.total)}`).join(", ") || "(nenhum)"}`);
    console.log(`  fila   : ${r.fila.length} -> ${r.fila.map(x=>`${x.operation}${x.motivo?` [${x.motivo}]`:""}`).join(", ") || "(vazia)"}`);
    for (const a of (r.avisos||[])) console.log(`  AVISO: ${a}`);
  }
  for (const [y,m,deb] of [[2026,6,ADS_JUN],[2026,7,ADS_JUL]]) {
    console.log(`\n##### ADS — resolveAdsCancelDebits(${y}-${String(m).padStart(2,"0")}) #####`);
    const r = await resolveAdsCancelDebits(sb, { year:y, month:m, debitos:deb, dryRun:false, createdBy:"rotina-automatica" });
    console.log(`  debitos: ${r.debits.length} -> ${r.debits.map(d=>`${d.promoterName} ${f(d.total)}`).join(", ") || "(nenhum)"}`);
    console.log(`  fila   : ${r.fila.length} -> ${r.fila.map(x=>x.operation).join(", ") || "(vazia)"}`);
    for (const a of (r.avisos||[])) console.log(`  AVISO: ${a}`);
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
