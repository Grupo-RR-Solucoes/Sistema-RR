/*
 * TESTE do MERGE POR DONO DE COLUNA (lib/dailyRecordMerge.ts) — prova b/c/d.
 * Usa uma proposta sandbox (prefixo ZZTEST-MERGE-) na empresa ADS e LIMPA no fim.
 * Só colunas existentes (insurance_value/gross_value/assigned_promoter_id) — o
 * caminho de prod_segurada/insurance_number é o MESMO mecanismo (coluna do dono
 * INSURANCE), e roda igual assim que a migration estiver aplicada.
 *
 * BLINDAGEM 2026-07: este teste ESCREVE em daily_production_records de PRODUCAO
 * (linhas sandbox ZZTEST-MERGE-*, criadas e apagadas por ele — o DELETE e escopado
 * ao prefixo, NUNCA toca dado real). Como nao ha staging, a escrita e opt-in: sem
 * --apply o teste NAO roda e explica o que faria. Rode com --apply para executar.
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
// _ts_register (branch main) carrega .env antes de .env.local sem override — a
// chave legada venceria. Força .env.local (sb_secret_) p/ o teste conectar.
(function preferEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
})();
const { createClient } = require("@supabase/supabase-js");
const { mergeDailyProductionRecords } = require("../lib/dailyRecordMerge.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra ? "— " + extra : ""}`); }
}

function creditRecord(proposal, gross, opts = {}) {
  return {
    company_id: ADS, proposal_number: proposal,
    j_key: opts.jKey ?? "JJTEST", promoter_id: opts.pid ?? null,
    original_promoter_id: opts.pid ?? null, assigned_promoter_id: opts.pid ?? null,
    promoter_source: opts.source ?? "AUTO_J_KEY",
    contract_number: proposal, gross_value: gross, net_value: gross,
    status: "PRODUCAO", movement_date: "2026-06-15", contract_date: "2026-06-15", proposal_date: "2026-06-15",
    is_srcc_restricted: false,
    raw_payload: { __credit: true },
  };
}
function insuranceRecord(proposal, insVal, createIfMissing = true) {
  return {
    company_id: ADS, proposal_number: proposal,
    insurance_value: insVal, insurance_net_value: insVal,
    insurance_type: "SLIP", has_insurance: insVal > 0,
    // defaults de criação (linha só-seguro no balde) — NÃO sobrescrevem no update
    contract_number: proposal, j_key: "JJ552710",
    promoter_id: null, original_promoter_id: null, assigned_promoter_id: null,
    promoter_source: "MASTER_REASSIGNED",
    gross_value: 0, net_value: 0, status: "PRODUCAO",
    movement_date: "2026-06-15", contract_date: "2026-06-15", proposal_date: "2026-06-15",
    is_srcc_restricted: false,
    raw_payload: { __seguro: true },
    __createIfMissing: createIfMissing,
  };
}
async function readRow(proposal) {
  const { data } = await sb.from("daily_production_records")
    .select("gross_value, insurance_value, assigned_promoter_id, promoter_source, raw_payload")
    .eq("company_id", ADS).eq("proposal_number", proposal).maybeSingle();
  return data;
}
async function cleanup() {
  await sb.from("daily_production_records").delete().eq("company_id", ADS).like("proposal_number", "ZZTEST-MERGE-%");
}

async function main() {
  if (!process.argv.includes("--apply")) {
    console.log("\n=== TESTE MERGE POR DONO DE COLUNA (blindado) ===\n");
    console.log("  Este teste ESCREVE linhas sandbox (ZZTEST-MERGE-*) em daily_production_records");
    console.log("  de PRODUCAO e as apaga no fim (DELETE escopado ao prefixo — nao toca dado real).");
    console.log("  Nao ha staging. Para executar de fato, rode com --apply:");
    console.log("    node scripts/test_merge_dono_coluna.cjs --apply");
    console.log("\n  DRY-RUN: nada foi escrito.");
    process.exit(0);
  }
  console.log("\n=== TESTE MERGE POR DONO DE COLUNA (--apply) ===\n");
  await cleanup();
  const { data: prom } = await sb.from("promoters").select("id, name").limit(1).single();
  const PID = prom.id;

  // ---- b) crédito → seguro → crédito : insurance_value sobrevive às 3 rodadas ----
  console.log("b) crédito → seguro → crédito (insurance_value sobrevive):");
  const B = "ZZTEST-MERGE-B";
  await mergeDailyProductionRecords(sb, { records: [creditRecord(B, 1000)], owner: "CREDIT" });
  let r = await readRow(B);
  check("crédito criou linha (gross=1000, insurance=0 default)", r && Number(r.gross_value) === 1000 && Number(r.insurance_value) === 0, JSON.stringify(r));
  await mergeDailyProductionRecords(sb, { records: [insuranceRecord(B, 55.5)], owner: "INSURANCE" });
  r = await readRow(B);
  check("seguro anexou (insurance=55.5, gross intacto=1000)", r && Number(r.insurance_value) === 55.5 && Number(r.gross_value) === 1000, JSON.stringify(r));
  await mergeDailyProductionRecords(sb, { records: [creditRecord(B, 1000)], owner: "CREDIT" });
  r = await readRow(B);
  check("RE-subir crédito NÃO zerou o seguro (insurance ainda 55.5)", r && Number(r.insurance_value) === 55.5, JSON.stringify(r));
  check("raw_payload mesclou os dois lados (__credit + __seguro)", r && r.raw_payload && r.raw_payload.__credit === true && r.raw_payload.__seguro === true, JSON.stringify(r && r.raw_payload));

  // ---- c) seguro → crédito → seguro : gross_value sobrevive ----
  console.log("\nc) seguro → crédito → seguro (gross_value sobrevive):");
  const C = "ZZTEST-MERGE-C";
  await mergeDailyProductionRecords(sb, { records: [insuranceRecord(C, 77)], owner: "INSURANCE" });
  r = await readRow(C);
  check("seguro-antes criou linha só-seguro (gross=0, insurance=77)", r && Number(r.gross_value) === 0 && Number(r.insurance_value) === 77, JSON.stringify(r));
  await mergeDailyProductionRecords(sb, { records: [creditRecord(C, 2000)], owner: "CREDIT" });
  r = await readRow(C);
  check("crédito preencheu (gross=2000, insurance intacto=77)", r && Number(r.gross_value) === 2000 && Number(r.insurance_value) === 77, JSON.stringify(r));
  await mergeDailyProductionRecords(sb, { records: [insuranceRecord(C, 77)], owner: "INSURANCE" });
  r = await readRow(C);
  check("RE-subir seguro NÃO zerou o crédito (gross ainda 2000)", r && Number(r.gross_value) === 2000, JSON.stringify(r));

  // ---- d) assigned_promoter_id preservado (MANUAL_REASSIGNMENT) ----
  console.log("\nd) assigned_promoter_id preservado em todas as rodadas:");
  const D = "ZZTEST-MERGE-D";
  await mergeDailyProductionRecords(sb, { records: [creditRecord(D, 500)], owner: "CREDIT" });
  // simula atribuição manual na aba Migração
  await sb.from("daily_production_records").update({ assigned_promoter_id: PID, promoter_source: "MANUAL_REASSIGNMENT" })
    .eq("company_id", ADS).eq("proposal_number", D);
  await mergeDailyProductionRecords(sb, { records: [creditRecord(D, 500, { source: "AUTO_J_KEY" })], owner: "CREDIT" });
  r = await readRow(D);
  check("crédito re-subido preservou assigned (=promotor manual)", r && r.assigned_promoter_id === PID && r.promoter_source === "MANUAL_REASSIGNMENT", JSON.stringify(r));
  await mergeDailyProductionRecords(sb, { records: [insuranceRecord(D, 33)], owner: "INSURANCE" });
  r = await readRow(D);
  check("seguro (dono não toca promotor) manteve assigned", r && r.assigned_promoter_id === PID && r.promoter_source === "MANUAL_REASSIGNMENT", JSON.stringify(r));

  // ---- e) não-segurada sem crédito NÃO cria fantasma (__createIfMissing=false) ----
  console.log("\ne) não-segurada sem crédito não vira fantasma:");
  const E = "ZZTEST-MERGE-E";
  const res = await mergeDailyProductionRecords(sb, { records: [insuranceRecord(E, 0, false)], owner: "INSURANCE" });
  r = await readRow(E);
  check("linha NÃO criada (skipped=1, sem row)", res.skipped === 1 && !r, JSON.stringify({ res, r }));

  await cleanup();
  console.log(`\n=== ${passed} passaram, ${failed} falharam ===`);
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
