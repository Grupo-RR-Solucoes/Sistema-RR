/*
 * ITEM 5 — teste do GATE jul+ do crédito BBTS (consolidateMonthlyFromBbts).
 * Cobre os dois branches novos do creditoDriver em competência 2026-07:
 *   a) gross>0 COM taxa_relatorio válida -> calcula taxa/100, NÃO aborta
 *   b) gross>0 SEM taxa_relatorio (ausente/null) -> ABORTA nomeando o contrato
 *   c) gross>0 com taxa_relatorio=0 (zero legítimo) -> NÃO aborta, trata como 0
 *   d) linha só-seguro gross=0 -> FORA do gate, não exige taxa_relatorio
 * + junho (2026-06) segue congelado (TRP_CREDITO_CONGELADO), no-op.
 * Usa linhas sandbox (ZZGATE-*) na empresa ADS e LIMPA no fim. dryRun (não grava PMR).
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
const { consolidateMonthlyFromBbts } = require("../lib/bbtsMonthly.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const MOV = "2026-07-15";

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x ? "— " + x : ""}`)); };
const near = (a, b) => Math.abs((+a || 0) - (+b || 0)) <= 0.01;

function row(suffix, gross, rawPayload, pid) {
  return {
    company_id: ADS, proposal_number: `ZZGATE-${suffix}`, contract_number: `ZZGATE-${suffix}`,
    j_key: "JJ552710", promoter_id: pid, original_promoter_id: pid, assigned_promoter_id: pid,
    promoter_source: "AUTO_J_KEY",
    gross_value: gross, net_value: gross,
    status: "PRODUCAO", movement_date: MOV, contract_date: MOV, proposal_date: MOV,
    is_srcc_restricted: false, term_months: 108, installments: 108, interest_rate: 1.85,
    raw_payload: rawPayload,
  };
}
async function insert(rows) {
  const { error } = await sb.from("daily_production_records").upsert(rows, { onConflict: "company_id,proposal_number" });
  if (error) throw error;
}
async function cleanup() {
  await sb.from("daily_production_records").delete().eq("company_id", ADS).like("proposal_number", "ZZGATE-%");
}

async function main() {
  console.log("\n=== ITEM 5 — GATE jul+ (2026-07) ===\n");
  await cleanup();
  const { data: prom } = await sb.from("promoters").select("id, name").limit(1).single();
  const PID = prom.id;
  console.log(`promotor sandbox: ${prom.name} [${PID}]\n`);

  const meta = { __bbts_meta: { cancelado: false } };
  const A = row("A", 10000, { taxa_relatorio: 2.87, ...meta }, PID);   // taxa válida
  const C = row("C", 8000, { taxa_relatorio: 0, ...meta }, PID);        // zero legítimo
  const D = row("D", 0, { ...meta }, PID);                              // só-seguro (gross=0), sem taxa
  const B = row("B", 5000, { ...meta }, PID);                           // gross>0 SEM taxa -> aborta

  // ---- RUN 1: a + c + d (sem b) => NÃO aborta ----
  console.log("RUN 1 — a(taxa 2,87) + c(taxa 0) + d(gross 0): espera SUCESSO");
  await insert([A, C, D]);
  let res1 = null, err1 = null;
  try { res1 = await consolidateMonthlyFromBbts(sb, { year: 2026, month: 7, dryRun: true }); }
  catch (e) { err1 = e; }
  ok("(a/c/d) NÃO aborta", !err1, err1 && err1.message);
  if (res1) {
    const byC = new Map(res1.propostas.map((p) => [p.contrato, p]));
    const pa = byC.get("ZZGATE-A"), pc = byC.get("ZZGATE-C"), pd = byC.get("ZZGATE-D");
    ok("(a) taxa_relatorio 2,87 -> trp 0,0287 e avista 287,00", pa && near(pa.trp, 0.0287) && near(pa.avista, 287.0), pa && JSON.stringify({ trp: pa.trp, avista: pa.avista }));
    ok("(c) taxa 0 -> trp 0 e avista 0 (zero legítimo, NÃO ausente)", pc && near(pc.trp, 0) && near(pc.avista, 0), pc && JSON.stringify({ trp: pc.trp, avista: pc.avista }));
    ok("(d) só-seguro gross=0 processado sem gate (vfin 0, trp 0)", pd && near(pd.vfin, 0) && near(pd.trp, 0), pd ? JSON.stringify({ vfin: pd.vfin, trp: pd.trp }) : "ausente");
    ok("(jul+) creditoDrift contou os gross>0 (a e c = 2)", res1.credito_drift_jul === 2, `drift=${res1.credito_drift_jul}`);
  }

  // ---- RUN 2: + b => ABORTA nomeando o contrato ----
  console.log("\nRUN 2 — adiciona b(gross 5000 SEM taxa): espera ABORT nomeando ZZGATE-B");
  await insert([B]);
  let res2 = null, err2 = null;
  try { res2 = await consolidateMonthlyFromBbts(sb, { year: 2026, month: 7, dryRun: true }); }
  catch (e) { err2 = e; }
  ok("(b) ABORTA (lança erro, não grava)", Boolean(err2) && !res2, err2 ? "" : "não lançou");
  ok("(b) o erro NOMEIA o contrato ZZGATE-B", err2 && /ZZGATE-B/.test(err2.message || ""), err2 && (err2.message || "").slice(0, 160));
  ok("(b) o erro fala de taxa_relatorio ausente", err2 && /taxa_relatorio/.test(err2.message || ""), err2 && (err2.message || "").slice(0, 160));
  if (err2) console.log(`     msg: ${err2.message}`);

  await cleanup();

  // ---- JUNHO no-op: segue congelado, sem gate, sem drift ----
  console.log("\nJUNHO 2026-06 — TRP_CREDITO_CONGELADO (no-op, sem gate jul+):");
  let resJun = null, errJun = null;
  try { resJun = await consolidateMonthlyFromBbts(sb, { year: 2026, month: 6, dryRun: true }); }
  catch (e) { errJun = e; }
  ok("junho NÃO aborta", !errJun, errJun && errJun.message);
  if (resJun) {
    ok("junho creditoDrift_jul = 0 (não usa o caminho jul+)", resJun.credito_drift_jul === 0, `drift=${resJun.credito_drift_jul}`);
    const temAvisoJul = (resJun.avisos || []).some((a) => /relat[oó]rio BBTS|taxa_relatorio/i.test(a));
    ok("junho NÃO emite o aviso do gate jul+", !temAvisoJul, JSON.stringify(resJun.avisos));
  }

  console.log(`\n=== ${pass} passaram, ${fail} falharam ===`);
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { try { await cleanup(); } catch {} console.error("ERRO:", e.message || e); process.exit(1); });
