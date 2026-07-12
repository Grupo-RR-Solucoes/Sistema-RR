/*
 * CREDITO ADS = TRP SEMPRE (bbtsMonthly). Substitui o teste do gate jul+
 * (test_item5_gate_julplus), cujo gate/taxa_relatorio foi REMOVIDO.
 *   - junho: NO-OP (credito ADS ~5.153,53, ja era TRP; nao muda).
 *   - julho: NAO aborta mais; credito sai pela TRP (matriz), nao por taxa_relatorio.
 * So leitura (dryRun). Nao grava.
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
const { consolidateMonthlyGroup } = require("../lib/bbtsOrchestrator.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log(`  OK  ${n}`)) : (fail++, console.log(`  XX  ${n} ${x ? "- " + x : ""}`)); };
const near = (a, b, tol) => Math.abs((+a || 0) - (+b || 0)) <= (tol ?? 0.02);
const brl = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  console.log("\n=== CREDITO ADS = TRP SEMPRE ===\n");

  // --- JUNHO: no-op (ja era TRP). credito ADS (orquestrador) == 5.153,53 ---
  console.log("JUNHO 2026-06 (esperado no-op, credito ADS == 5.153,53):");
  let gJun = null, errGJun = null;
  try { gJun = await consolidateMonthlyGroup(sb, { year: 2026, month: 6, dryRun: true }); } catch (e) { errGJun = e; }
  ok("junho NAO aborta", !errGJun, errGJun && errGJun.message);
  if (gJun) {
    console.log(`   orquestrador: credito RR ${brl(gJun.totals.credito_rr)} | credito ADS ${brl(gJun.totals.credito_ads)}`);
    ok("junho credito ADS == 5.153,53 (no-op)", near(gJun.totals.credito_ads, 5153.53, 0.5), `${brl(gJun.totals.credito_ads)}`);
    ok("junho credito RR intocado (~109.538)", near(gJun.totals.credito_rr, 109538.42, 1), `${brl(gJun.totals.credito_rr)}`);
  }
  // aviso: nao ha mais o gate jul+
  const jun = await consolidateMonthlyFromBbts(sb, { year: 2026, month: 6, dryRun: true });
  ok("junho NAO tem mais o aviso do gate jul+", !(jun.avisos || []).some((a) => /Gate ativo|aborta/i.test(a)), JSON.stringify(jun.avisos));

  // --- JULHO: nao aborta (antes: gate abortava); credito pela TRP ---
  console.log("\nJULHO 2026-07 (esperado: NAO aborta; regua = TRP, nao taxa_relatorio):");
  let gJul = null, errGJul = null;
  try { gJul = await consolidateMonthlyGroup(sb, { year: 2026, month: 7, dryRun: true }); } catch (e) { errGJul = e; }
  ok("julho NAO aborta no orquestrador (antes: gate taxa_relatorio abortava)", !errGJul, errGJul && errGJul.message);
  if (gJul) console.log(`   orquestrador julho: credito ADS ${brl(gJul.totals.credito_ads)} (parcial, balde nao migrado)`);
  let jul = null, errJul = null;
  try { jul = await consolidateMonthlyFromBbts(sb, { year: 2026, month: 7, dryRun: true }); } catch (e) { errJul = e; }
  ok("julho NAO aborta (consolidador direto)", !errJul, errJul && errJul.message);
  if (jul) {
    const prod = (jul.propostas || []).filter((p) => Number(p.vfin) > 0);
    console.log(`   propostas com credito (gross>0): ${prod.length}`);
    console.log("   contrato        vfin          trp(TRP%)   avista(pos-teto)");
    for (const p of prod) {
      console.log(`   ${String(p.contrato).padEnd(14)} ${brl(p.vfin).padStart(12)}  ${(Number(p.trp) * 100).toFixed(4)}%   ${brl(p.avista).padStart(10)}`);
    }
    const credEmpresaJul = jul.table.reduce((a, t) => a + Number(t.comissao_empresa_credito || 0), 0);
    console.log(`   credito empresa julho (parcial, so atribuidos) = ${brl(credEmpresaJul)}`);
    ok("julho: ha proposta(s) de credito processada(s) pela TRP", prod.length >= 1, "nenhuma proposta atribuida com gross>0 (ok se balde nao migrado)");
    // TRP plausivel: 0 <= trp <= ~0.10 (matriz), nunca undefined/NaN
    const trpOk = prod.every((p) => Number.isFinite(Number(p.trp)) && Number(p.trp) >= 0 && Number(p.trp) <= 0.12);
    ok("julho: trp por contrato vem da matriz TRP (0..~10%, finito)", prod.length === 0 || trpOk);
  }

  console.log(`\n=== ${pass} passaram, ${fail} falharam ===`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
