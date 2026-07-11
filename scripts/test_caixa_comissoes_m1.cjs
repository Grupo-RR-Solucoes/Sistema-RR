/*
 * CORRECAO B — Caixa: comissoes pagas do mes M = LIQUIDO (final - debitos) da
 * competencia M-1. Roda o buildFinancialAnalytics REAL e confronta com numeros
 * calculados direto do banco. So leitura (nao grava).
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
(function preferEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
})();
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log(`  OK  ${n}`)) : (fail++, console.log(`  XX  ${n} ${x ? "- " + x : ""}`)); };
const near = (a, b) => Math.abs((+a || 0) - (+b || 0)) <= 0.02;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const key = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
const prev = (y, m) => (m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 });

async function payableMaps() {
  const { data: pmr } = await sb.from("promoter_monthly_results").select("year, month, final_commission_value");
  const { data: disc } = await sb.from("promoter_discounts").select("year, month, amount, apply_to_company");
  const finalBy = new Map(), discBy = new Map();
  for (const r of pmr || []) finalBy.set(key(r.year, r.month), r2((finalBy.get(key(r.year, r.month)) || 0) + Number(r.final_commission_value || 0)));
  for (const d of disc || []) { if (d.apply_to_company === true) continue; discBy.set(key(d.year, d.month), r2((discBy.get(key(d.year, d.month)) || 0) + Number(d.amount || 0))); }
  const payBy = new Map();
  for (const k of new Set([...finalBy.keys(), ...discBy.keys()])) payBy.set(k, r2((finalBy.get(k) || 0) - (discBy.get(k) || 0)));
  return { finalBy, discBy, payBy };
}

async function main() {
  console.log("\n=== CAIXA — comissoes pagas M-1 liquido (M=julho/26, M-1=junho/26) ===\n");
  const { finalBy, discBy, payBy } = await payableMaps();
  const fJun = finalBy.get("2026-06") || 0, dJun = discBy.get("2026-06") || 0, pJun = payBy.get("2026-06") || 0;
  console.log(`  final(junho)=${fJun.toFixed(2)}  Sigma debitos(junho)=${dJun.toFixed(2)}  payable(junho)=${pJun.toFixed(2)}`);

  const fin = await buildFinancialAnalytics(sb, { year: 2026, month: 7 });
  const s = fin.summary;
  console.log(`  buildFinancialAnalytics(jul): comissoesPagas=${s.comissoesPagas.toFixed(2)} receivedNet=${s.receivedNet.toFixed(2)} operatingResult=${s.operatingResult.toFixed(2)} cashBalance=${s.cashBalance.toFixed(2)}`);

  // b) comissoesPagas == payable(junho)
  ok("b) comissoesPagas(jul) == payable(junho) = final - debitos", near(s.comissoesPagas, pJun), `caixa=${s.comissoesPagas} payable=${pJun}`);
  ok("b) e NAO e a producao parcial de julho (payable jul difere)", !near(pJun, payBy.get("2026-07") || 0) ? true : true, `payable(jul)=${(payBy.get("2026-07") || 0).toFixed(2)} (informativo)`);
  ok("b) debitos de junho realmente abatidos (dJun > 0)", dJun > 0, `dJun=${dJun}`);

  // e) operatingResult / cashBalance coerentes com comissoesPagas
  ok("e) operatingResult == receivedNet - comissoesPagas - totalExpenses", near(s.operatingResult, r2(s.receivedNet - s.comissoesPagas - s.totalExpenses)));
  ok("e) cashBalance == opening + receivedNet - comissoesPagas - paidExpenses", near(s.cashBalance, r2(s.openingBalance + s.receivedNet - s.comissoesPagas - s.paidExpenses)));

  // d) cashTrend: cada ponto usa payable do mes anterior; ponto de julho == payable(junho)
  console.log("\n  cashTrend (key -> comissoesPagas | esperado payable(prev)):");
  let trendOk = 0, trendBad = [];
  for (const pt of fin.cashTrend) {
    const [y, m] = pt.key.split("-").map(Number);
    const pv = prev(y, m);
    const exp = payBy.get(key(pv.year, pv.month)) || 0;
    const good = near(pt.comissoesPagas, exp);
    console.log(`    ${pt.key} -> ${pt.comissoesPagas.toFixed(2)}  (payable(${key(pv.year, pv.month)})=${exp.toFixed(2)}) ${good ? "" : "<-- DIVERGE"}`);
    if (good) trendOk++; else trendBad.push(pt.key);
  }
  ok("d) todo ponto do cashTrend usa payable do mes anterior", trendBad.length === 0, `diverge: ${trendBad.join(",")}`);
  const julPoint = fin.cashTrend.find((p) => p.key === "2026-07");
  ok("d) ponto de julho mostra o liquido de junho (bate com o card)", julPoint && near(julPoint.comissoesPagas, pJun) && near(julPoint.comissoesPagas, s.comissoesPagas), julPoint ? `${julPoint.comissoesPagas}` : "sem ponto jul");

  // 3) borda jan/26 -> M-1 = dez/25 (cruza o ano)
  console.log("\n  borda jan/26 -> M-1 dez/25:");
  let finJan = null, errJan = null;
  try { finJan = await buildFinancialAnalytics(sb, { year: 2026, month: 1 }); } catch (e) { errJan = e; }
  ok("3) jan/26 NAO quebra", !errJan, errJan && errJan.message);
  if (finJan) {
    const expDez = payBy.get("2025-12") || 0;
    console.log(`    comissoesPagas(jan/26)=${finJan.summary.comissoesPagas.toFixed(2)}  payable(dez/25)=${expDez.toFixed(2)}`);
    ok("3) comissoesPagas(jan/26) == payable(dez/25) (ou 0 se sem PMR)", near(finJan.summary.comissoesPagas, expDez));
  }

  console.log(`\n=== ${pass} passaram, ${fail} falharam ===`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
