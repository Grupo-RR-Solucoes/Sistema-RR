// ============================================================================
// scripts/importBbtsClosing.ts — BBTS-2b: carga do fechamento BBTS junho em
// daily_production_records (company ADS, JJ552710 -> balde).
//
// Entrada: um JSON estruturado { year, month, credito:[...], seguro:[...] }
// (as 18 linhas extraídas do PDF — o extrator PDF->linhas é acoplado depois;
// por ora o JSON é a interface). Caminho em BBTS_CLOSING_JSON.
//
// DRY-RUN por padrão (NÃO grava). Grava só com BBTS_WRITE=1. Valida as âncoras
// (Σ valor financiado 266.210,84 / Σ pag à vista 7.707,03 / Σ seguro 58,11)
// ANTES de gravar; se não fecharem, ABORTA sem escrever.
//
// Rodar:
//   BBTS_CLOSING_JSON="C:/.../fechamento_bbts_junho.json" \
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/importBbtsClosing.ts')"
//   (grava: acrescente BBTS_WRITE=1)
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { importBbtsClosing } from "@/lib/bbtsClosingImport.ts";

(function preferEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
})();

const JSON_PATH = process.env.BBTS_CLOSING_JSON;
const DRY_RUN = process.env.BBTS_WRITE !== "1";
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  if (!JSON_PATH) throw new Error("Informe o JSON estruturado em BBTS_CLOSING_JSON.");
  if (!fs.existsSync(JSON_PATH)) throw new Error(`Arquivo não encontrado: ${JSON_PATH}`);
  const input = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no env.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`############ CARGA fechamento BBTS ${input.year}/${String(input.month).padStart(2, "0")} — ${DRY_RUN ? "DRY-RUN (não grava)" : "GRAVANDO"} ############\n`);

  let res;
  try {
    res = await importBbtsClosing(supabase as any, input, { dryRun: DRY_RUN });
  } catch (e: any) {
    console.error("ABORTADO:", e?.message || e);
    process.exit(1);
    return;
  }

  const L = (k: string, v: unknown) => console.log(`  ${k.padEnd(30)} ${v}`);
  L("propostas parseadas", res.propostas);
  L("Σ valor financiado", brl(res.soma_valor_financiado));
  L("Σ pag à vista (âncora)", brl(res.soma_pag_avista));
  L("Σ seguro (âncora)", brl(res.soma_seguro));
  L("master balde (JJ552710)", res.master_balde);
  L("individual (AUTO_J_KEY)", res.individual);
  L("canceladas", res.canceladas);
  L("SRCC restritas (cd=1)", res.srcc_restritas);
  L("com seguro", res.com_seguro);
  console.log("\n  Validação de âncora:");
  for (const [k, d] of Object.entries(res.ancora_detalhe)) {
    console.log(`    ${k.padEnd(18)} esperado=${d.esperado}  obtido=${d.obtido}  Δ=${d.delta}  ${d.ok ? "OK" : "FALHOU"}`);
  }
  console.log(`  ÂNCORA GERAL: ${res.ancora_ok ? "OK ✔" : "FALHOU ✖"}`);

  console.log("\n  Amostra mapeada (até 3):");
  for (const a of res.amostra) console.log("    " + JSON.stringify(a));

  if (res.dry_run) console.log("\nDRY-RUN: nada gravado.");
  else console.log(`\nGRAVADO em daily_production_records: ${res.gravadas} linhas (company ADS).`);
})().catch((e) => {
  console.error("ERRO:", e && e.message ? e.message : e);
  process.exit(1);
});
