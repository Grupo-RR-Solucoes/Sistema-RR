/*
 * CORREÇÃO parser ads-credito — competência por efetivação + só "Contratação CDC".
 * Usa o arquivo REAL "Relatório (3).xlsx" (aba Total) em DRY-RUN (não grava nada).
 * Verifica via result.preview (proposta + movement_date) + productionPeriod.
 *   a) 213994592 (ts_movimento 06/07) -> competência 2026-07
 *   b) 213304584 (Cancelamento) -> NÃO gravada
 *   c) Proposta CDC (219509685/219421812/219351243) -> NÃO gravada
 *   d) uma Contratação CDC de julho -> gravada em 2026-07
 *   e) NENHUMA linha cai em 2026-06 (junho intocado)
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
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");
const { importBbtsDaily } = require("../lib/bbtsDailyImport.ts");
const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const FILE = "C:/Users/diego/Downloads/Relatório (3).xlsx";

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x ? "— " + x : ""}`)); };
const compOf = (mv) => { const p = getProductionPeriodFromValue(mv); return p ? getProductionPeriodKey(p.year, p.month) : null; };

async function main() {
  console.log("\n=== CORREÇÃO ads-credito — competência por efetivação + só Contratação CDC ===\n");
  const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Total"]);
  console.log(`arquivo: ${rows.length} linhas na aba Total`);

  // DRY-RUN: não grava. result.preview lista as gravadas (proposta + efetivação).
  const res = await importBbtsDaily(sb, { rows, fileName: "Relatório (3).xlsx", aba: "Total", dryRun: true });
  console.log(`import(dry): processadas=${res.processadas} canceladas=${res.canceladas} transitorias=${res.transitorias} | preview=${res.preview.length}\n`);

  const previewByProp = new Map(res.preview.map((p) => [p.proposal_number, p]));
  const gravada = (prop) => previewByProp.has(String(prop));

  // gate agregado
  ok("18 linhas -> 10 gravadas (Contratação CDC), 4 canceladas, 4 transitórias", res.linhas_aba === 18 && res.processadas === 10 && res.canceladas === 4 && res.transitorias === 4, `linhas=${res.linhas_aba} proc=${res.processadas} canc=${res.canceladas} trans=${res.transitorias}`);

  // a) 213994592 -> competência 2026-07
  const a = previewByProp.get("213994592");
  ok("(a) 213994592 gravada com competência 2026-07 (efetivação 06/07)", a && compOf(a.movement_date) === "2026-07", a ? `mov=${a.movement_date} comp=${compOf(a.movement_date)}` : "não gravada");

  // b) 213304584 (Cancelamento) -> NÃO gravada
  ok("(b) 213304584 (Cancelamento) NÃO gravada", !gravada("213304584"));

  // c) Proposta CDC -> NÃO gravada
  ok("(c) Proposta CDC (219509685/219421812/219351243) NÃO gravadas", !gravada("219509685") && !gravada("219421812") && !gravada("219351243"));

  // d) uma Contratação CDC de julho -> gravada em 2026-07 (213977398, efetivação 06/07)
  const d = previewByProp.get("213977398");
  ok("(d) Contratação CDC de julho (213977398) gravada em 2026-07", d && compOf(d.movement_date) === "2026-07", d ? `mov=${d.movement_date} comp=${compOf(d.movement_date)}` : "não gravada");

  // e) NENHUMA linha cai em 2026-06
  const emJunho = res.preview.filter((p) => compOf(p.movement_date) === "2026-06");
  ok("(e) NENHUMA gravada cai em 2026-06 (junho intocado)", emJunho.length === 0, `em junho: ${JSON.stringify(emJunho)}`);

  // informativo: 30/06 resolve para qual competência? (NÃO forçar)
  const b30 = previewByProp.get("213983877");
  console.log(`\n  [info] 213983877 efetivação ${b30 ? b30.movement_date : "?"} -> competência ${b30 ? compOf(b30.movement_date) : "?"} (a janela do productionPeriod decide; não forçado)`);

  // distribuição de competências das 10 gravadas
  const dist = {};
  for (const p of res.preview) { const c = compOf(p.movement_date); dist[c] = (dist[c] || 0) + 1; }
  console.log(`  [info] competências das gravadas: ${JSON.stringify(dist)}`);

  console.log(`\n=== ${pass} passaram, ${fail} falharam ===`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
