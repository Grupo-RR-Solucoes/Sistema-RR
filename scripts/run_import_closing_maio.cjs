/*
 * AUDITORIA 1 — PASSO A: importa o fechamento de MAIO/2026 (4 CNPJs).
 * Usa a LIB REAL importMonthlyClosingWorkbook (mesma da rota /api/import/closing).
 * Idempotente (delete-then-insert por company/year/month). Relatório CASH/PRT/DEBIT.
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { importMonthlyClosingWorkbook } = require("../lib/monthlyClosingImport.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DOWNLOADS = "C:/Users/diego/Downloads";
const FILES = [
  "C96141_48357275000103_Todos_5_2026.xlsx", // AL1
  "C96140_56140658000153_Todos_5_2026.xlsx", // AL2
  "C96139_55867409000100_Todos_5_2026.xlsx", // AL3
  "C96142_51457289000103_Todos_5_2026.xlsx", // PE
];
const fmt = (x) => Number(x || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  console.log("===== PASSO A — IMPORT fechamento MAIO/2026 =====\n");
  for (const name of FILES) {
    const full = path.join(DOWNLOADS, name);
    if (!fs.existsSync(full)) { console.log("!! AUSENTE:", name); continue; }
    const fileBase64 = fs.readFileSync(full).toString("base64");
    const r = await importMonthlyClosingWorkbook({ fileBase64, fileName: name, year: 2026, month: 5, createdBy: "runner:auditoria1" });
    console.log(`OK ${r.company.name} (${r.company.cnpj}) | sheets=${r.processedSheets} entries=${r.processedEntries} | importId=${r.importId}`);
  }

  // relatório por CNPJ / entry_type
  console.log("\n===== monthly_closing_entries MAIO/2026 (do banco) =====");
  let f = 0, rows = [];
  for (;;) { const { data, error } = await sb.from("monthly_closing_entries").select("company_cnpj,entry_type,net_value,commission_value").eq("year", 2026).eq("month", 5).range(f, f + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) break; f += 1000; }
  const by = {};
  for (const r of rows) { const c = String(r.company_cnpj || "").trim(); (by[c] = by[c] || {})[r.entry_type] = ((by[c] || {})[r.entry_type] || 0) + 1; }
  for (const [c, types] of Object.entries(by)) {
    console.log(`  ${c}:`, JSON.stringify(types));
  }
  const totalByType = {};
  for (const r of rows) totalByType[r.entry_type] = (totalByType[r.entry_type] || 0) + 1;
  console.log("  TOTAL maio:", JSON.stringify(totalByType), "| linhas:", rows.length);
  console.log("\nPASSO A concluído.");
})().catch((e) => { console.error(e); process.exit(1); });
