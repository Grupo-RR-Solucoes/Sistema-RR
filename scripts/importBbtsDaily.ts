// ============================================================================
// scripts/importBbtsDaily.ts — BBTS-1, import manual da diária BBTS.
//
// Lê o XLSX (aba "Total"; "Feitas"/"Pendentes" ignoradas), mapeia para
// daily_production_records via lib/bbtsDailyImport.ts e imprime o diagnóstico.
//
// DRY-RUN por padrão (NÃO grava). Para gravar de verdade: BBTS_WRITE=1.
//
// Rodar:
//   BBTS_FILE="C:/caminho/diaria_bbts.xlsx" \
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/importBbtsDaily.ts')"
//   (grava: acrescente BBTS_WRITE=1)
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { importBbtsDaily } from "@/lib/bbtsDailyImport.ts";

// .env.local vence (chave de .env é legacy) — mesmo padrão dos outros scripts.
(function preferEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
})();

const FILE = process.env.BBTS_FILE;
const ABA = process.env.BBTS_ABA || "Total";
const DRY_RUN = process.env.BBTS_WRITE !== "1";

(async () => {
  if (!FILE) throw new Error("Informe o caminho do arquivo em BBTS_FILE.");
  if (!fs.existsSync(FILE)) throw new Error(`Arquivo não encontrado: ${FILE}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no env.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer" });
  const sheetName = wb.SheetNames.includes(ABA) ? ABA : wb.SheetNames[0];
  if (sheetName !== ABA) {
    console.warn(`[aviso] aba "${ABA}" não encontrada; usando "${sheetName}". Abas: ${wb.SheetNames.join(", ")}`);
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName]);

  console.log(`############ IMPORT diária BBTS — ${path.basename(FILE)} | aba "${sheetName}" | ${DRY_RUN ? "DRY-RUN (não grava)" : "GRAVANDO"} ############\n`);

  const res = await importBbtsDaily(supabase as any, {
    rows,
    fileName: path.basename(FILE),
    aba: sheetName,
    dryRun: DRY_RUN,
  });

  const L = (k: string, v: unknown) => console.log(`  ${k.padEnd(30)} ${v}`);
  L("linhas na aba", res.linhas_aba);
  L("processadas (c/ proposta)", res.processadas);
  L("individual (AUTO_J_KEY)", res.individual_auto);
  L("master balde (JJ552710)", res.master_balde);
  L("não identificadas (fora j_keys)", res.nao_identificadas);
  L("canceladas", res.canceladas);
  L("SRCC restritas (cd=1)", res.srcc_restritas);
  L("empresa não identificada (MCI)", res.empresa_nao_identificada);
  L("duplicadas no arquivo", res.duplicadas_no_arquivo);
  L("por empresa (company_id -> n)", JSON.stringify(res.por_empresa));
  if (!res.dry_run) {
    L("GRAVADAS (upsert)", res.gravadas);
    L("  inseridas", res.inseridas);
    L("  atualizadas", res.atualizadas);
  } else {
    L("gravadas", "0 (dry-run)");
  }
  console.log("\nAmostra mapeada (até 3):");
  for (const a of res.amostra) console.log("  " + JSON.stringify(a));
  console.log(`\n${res.dry_run ? "DRY-RUN: nada gravado." : "GRAVADO em daily_production_records."}`);
})().catch((e) => {
  console.error("ERRO:", e && e.message ? e.message : e);
  process.exit(1);
});
