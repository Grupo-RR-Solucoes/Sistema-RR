/* READ-ONLY. Item 8: extremos da janela de competencia. */
require("./_ts_register.cjs");
const { getProductionWindow, getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
for (const [y,m] of [[2026,7],[2026,8]]) {
  const w = getProductionWindow(y,m);
  console.log(`competencia ${y}-${String(m).padStart(2,"0")}: start=${w.start} (inclusivo)  endExclusive=${w.endExclusive}`);
}
console.log("\ndata -> competencia (regra getProductionPeriodFromValue):");
for (const d of ["2026-06-29","2026-06-30","2026-07-01","2026-07-29","2026-07-30","2026-07-31","2026-08-01"]) {
  const p = getProductionPeriodFromValue(d);
  console.log(`  ${d} -> ${getProductionPeriodKey(p.year,p.month)}`);
}
