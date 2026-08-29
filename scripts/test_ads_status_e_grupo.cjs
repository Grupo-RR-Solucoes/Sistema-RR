/*
 * Bug 1 — parser ADS grava status="Producao" (não LIQUIDADO) nas Contratação CDC.
 * Bug 2 — resolveCompanyScope traduz "grupo:ads"/"grupo:rr" em company_ids (sem 22P02).
 *
 * SEPARADO em 29/08/2026: a metade PERMANENTE (resolveCompanyScope) saiu daqui para
 * `scripts/companyscope_grupo_gate.cjs`, que e REGISTRADO e RODA. Este arquivo continua
 * ORFAO por construcao — depende de um xlsx de cliente que nao pode ser versionado
 * (repositorio publico). O que ficou aqui e o exercicio do parser sobre o arquivo real.
 * Tudo em DRY-RUN / leitura; não grava nada.
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
const { resolveCompanyScope } = require("../lib/companyScope.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const FILE = "C:/Users/diego/Downloads/Relatório (3).xlsx";

// espelho do isProductionStatus (promoterAnalytics:436-438)
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const isProductionStatus = (s) => { const n = norm(s); return n === "PRODUCAO" || n === "PRODUCTION"; };

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x ? "— " + x : ""}`)); };

async function main() {
  console.log("\n=== BUG 1 — parser ADS: status='Producao' (dry-run Relatório (3).xlsx) ===\n");
  const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Total"]);
  const res = await importBbtsDaily(sb, { rows, fileName: "Relatório (3).xlsx", aba: "Total", dryRun: true });
  console.log(`  processadas=${res.processadas} canceladas=${res.canceladas} transitorias=${res.transitorias} preview=${res.preview.length}`);

  // APOSENTADA em 29/08/2026 — CONTAGEM CONGELADA. Cravada sobre um "Relatório (3).xlsx"
  // de 18 linhas; o arquivo hoje tem 52 (proc=35 canc=9 trans=8). Numero de arquivo que
  // cresce nao e invariante — mede o tamanho do insumo, nao o comportamento do parser.
  console.log(`  [info] volume do arquivo hoje: proc=${res.processadas} canc=${res.canceladas} trans=${res.transitorias}`);
  const statuses = [...new Set(res.preview.map((p) => p.status))];
  // Reescrita em 29/08/2026: o "10" era o volume congelado. A INVARIANTE e que TODA
  // linha gravada saia com status 'Producao' — vale para 10, 35 ou 300.
  ok("TODA linha gravada sai com status='Producao' (invariante, sem volume cravado)",
    res.preview.length > 0 && statuses.length === 1 && statuses[0] === "Producao", JSON.stringify(statuses));
  ok("isProductionStatus aceita o status gravado (Producao -> PRODUCAO)", res.preview.every((p) => isProductionStatus(p.status)), "alguma linha não passa");
  ok("isProductionStatus REJEITA LIQUIDADO (não afrouxado)", isProductionStatus("LIQUIDADO") === false);
  console.log(`  amostra: ${JSON.stringify(res.amostra.map((a) => ({ p: a.proposal_number, status: a.status, sit: a.situacao_documento })))}`);

  console.log("\n=== BUG 2 — resolveCompanyScope traduz grupo (sem 22P02) ===\n");
  const { data: comps } = await sb.from("companies").select("id, name, group_name");
  const rrIds = (comps || []).filter((c) => c.group_name === "Grupo RR").map((c) => c.id);
  const bbtsIds = (comps || []).filter((c) => c.group_name === "BBTS").map((c) => c.id);

  const sAds = resolveCompanyScope("grupo:ads", comps);
  ok("grupo:ads -> company_ids do grupo BBTS (contém ADS)", Array.isArray(sAds.companyIds) && sAds.companyIds.includes(ADS) && sAds.companyIds.length === bbtsIds.length, JSON.stringify(sAds.companyIds));
  const sRr = resolveCompanyScope("grupo:rr", comps);
  ok(`grupo:rr -> ${rrIds.length} company_ids do Grupo RR`, Array.isArray(sRr.companyIds) && sRr.companyIds.length === rrIds.length && sRr.companyIds.every((id) => rrIds.includes(id)), JSON.stringify(sRr.companyIds));
  const sUuid = resolveCompanyScope(ADS, comps);
  ok("uuid individual -> [uuid]", JSON.stringify(sUuid.companyIds) === JSON.stringify([ADS]));
  const sNull = resolveCompanyScope("", comps);
  ok("'' (todas) -> null (sem restrição)", sNull.companyIds === null);
  const anyRaw = [sAds, sRr, sUuid].some((s) => (s.companyIds || []).some((id) => String(id).startsWith("grupo:")));
  ok("nenhum resultado carrega 'grupo:*' cru (que causaria 22P02)", !anyRaw);

  console.log(`\n=== ${pass} passaram, ${fail} falharam ===`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
