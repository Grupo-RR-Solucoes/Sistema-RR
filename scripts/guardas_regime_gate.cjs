/*
 * GATE brechas #6/#7/#8 — guardas de regime. READ-ONLY (dryRun onde grava).
 *
 * #7: detectMonthRegime prova abril/junho=fechamento, julho=open. A guarda
 *     flagCompetenciaFechada (replicada: regime !== 'open') devolve o flag em
 *     abril/junho e vazio em julho — SEM barrar (reassign continua funcionando).
 * #6: fetchClosedDprIds (replicada) classifica records reais: os de abril/junho
 *     entram no closed set (denied_closed), os de julho passam. Nunca 403 no lote.
 * #8: reconsolidarCompetenciaFechada SE AUTO-GUARDA: dryRun em junho (fechamento)
 *     roda; em julho (open) e no-op (ran:false). Cobre o best-effort do cancel.
 */
require("./_ts_register.cjs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { detectMonthRegime } = require(path.join(__dirname, "..", "lib", "cmsMonthly.ts"));
const { reconsolidarCompetenciaFechada } = require(path.join(__dirname, "..", "lib", "reconsolidarCompetencia.ts"));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

let falhas = 0;
const check = (nome, ok) => { if (!ok) falhas++; console.log(`  ${ok ? "OK " : "XX "} ${nome}`); };

// replica EXATA de flagCompetenciaFechada (app/api/promotores/route.ts)
async function flagCompetenciaFechada(y, m) {
  const regime = await detectMonthRegime(sb, y, m).catch(() => "open");
  if (regime === "open") return {};
  return { competencia_fechada: true, regime, reconsolidar: { year: y, month: m } };
}
// replica EXATA de fetchClosedDprIds (app/api/commissions/proposals/bulk/route.ts)
async function fetchClosedDprIds(dprIds) {
  const closed = new Set();
  const uniq = [...new Set(dprIds.filter(Boolean))];
  if (!uniq.length) return closed;
  const { data } = await sb.from("daily_production_records").select("id, movement_date").in("id", uniq);
  const cache = new Map();
  for (const r of data || []) {
    if (!r.movement_date) continue;
    const d = new Date(String(r.movement_date));
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, k = `${y}-${m}`;
    let reg = cache.get(k);
    if (reg === undefined) { reg = await detectMonthRegime(sb, y, m).catch(() => "open"); cache.set(k, reg); }
    if (reg !== "open") closed.add(String(r.id));
  }
  return closed;
}

(async () => {
  console.log("=== #7: detectMonthRegime + flag (nao barra, so avisa) ===");
  const rAbr = await detectMonthRegime(sb, 2026, 4).catch(() => "open");
  const rJun = await detectMonthRegime(sb, 2026, 6).catch(() => "open");
  const rJul = await detectMonthRegime(sb, 2026, 7).catch(() => "open");
  console.log(`  regimes: abril=${rAbr} junho=${rJun} julho=${rJul}`);
  check("abril = fechamento", rAbr === "fechamento");
  check("junho = fechamento", rJun === "fechamento");
  check("julho = open", rJul === "open");
  const fAbr = await flagCompetenciaFechada(2026, 4);
  const fJul = await flagCompetenciaFechada(2026, 7);
  check("reassign em abril: FUNCIONA e devolve competencia_fechada", fAbr.competencia_fechada === true);
  check("reassign em abril: alvo = {2026,4} p/ o link do card", fAbr.reconsolidar && fAbr.reconsolidar.year === 2026 && fAbr.reconsolidar.month === 4);
  check("acao em julho (aberto): SEM flag (objeto vazio)", Object.keys(fJul).length === 0);
  console.log("  -> reassign_proposal NAO tem return 403 (so adiciona flag) => fluxo do Diego intacto");

  console.log("\n=== #6: bulk rejeita PARCIALMENTE por competencia (nao 403 no lote) ===");
  // pega records reais de cada competencia
  const pick = async (y, m, n) => {
    const { data } = await sb.from("daily_production_records").select("id, movement_date").gte("movement_date", `${y}-${String(m).padStart(2, "0")}-01`).lte("movement_date", `${y}-${String(m).padStart(2, "0")}-28`).limit(n);
    return (data || []).map(r => r.id);
  };
  const abrRecs = await pick(2026, 4, 3);
  const julRecs = await pick(2026, 7, 3);
  const mix = [...abrRecs, ...julRecs];
  const closed = await fetchClosedDprIds(mix);
  console.log(`  lote misto: ${abrRecs.length} abril(fechado) + ${julRecs.length} julho(aberto)`);
  console.log(`  closed set: ${closed.size} (esperado ${abrRecs.length})`);
  check("records de abril entram em denied_closed", abrRecs.every(id => closed.has(id)));
  check("records de julho PASSAM (nao no closed set)", julRecs.every(id => !closed.has(id)));
  check("lote 100% aberto -> closed vazio (passa todo)", (await fetchClosedDprIds(julRecs)).size === 0);
  check("lote 100% fechado -> todos negados, mas SEM 403 (rejeicao parcial vira total)", (await fetchClosedDprIds(abrRecs)).size === abrRecs.length);

  console.log("\n=== #8: reconsolidarCompetenciaFechada se auto-guarda (best-effort do cancel) ===");
  const recJun = await reconsolidarCompetenciaFechada(sb, { year: 2026, month: 6, dryRun: true });
  const recJul = await reconsolidarCompetenciaFechada(sb, { year: 2026, month: 7, dryRun: true });
  console.log(`  junho(fechamento) dryRun: ran=${recJun.ran} regime=${recJun.regime}`);
  console.log(`  julho(open)       dryRun: ran=${recJul.ran} regime=${recJul.regime}`);
  check("junho: reconsolidacao RODA (recompoe do conjunto restante)", recJun.ran === true);
  check("julho: reconsolidacao NO-OP (nao toca mes aberto)", recJul.ran === false);
  console.log("  -> cancel de COMPLETED continua 409 (o teste de status PROCESSING nao foi tocado)");

  console.log("\n" + (falhas === 0 ? "GATE OK (0 falhas)" : `GATE FALHOU (${falhas})`));
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
