#!/usr/bin/env node
/**
 * scripts/seed_padrao_d.cjs — popula audit_v9_padrao_d_exclusoes com os 7
 * contratos identificados em CHECKPOINT B (Fase 4.3 D.1).
 *
 * Como rodar:
 *   node scripts/seed_padrao_d.cjs              # idempotente (ON CONFLICT DO NOTHING)
 *   node scripts/seed_padrao_d.cjs --validate   # apenas valida contagem após seed
 *
 * Idempotência: usa upsert com onConflict=contract_number,mes ignorando
 * duplicatas. Re-execução é segura.
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const argv = process.argv.slice(2);
const VALIDATE_ONLY = argv.includes("--validate");

/**
 * 7 contratos do Padrão D — origem: CHECKPOINT B (Fase 4.3) re-run.
 *
 * Subgrupos:
 *  - INCONSISTENCIA_CAMADA1_V9 (4 contratos): v9 humana calculou pct_avista_esperado
 *    pela cat_aplicada (TABELA 1) em vez de cat_devida (TABELA 2 via OPP099).
 *    Bug interno v9 com sua própria Camada 1.
 *  - TOLERANCIA_SILENCIOSA_VOLUME (3 contratos): regime VOLUME, pct_aplicado < teto,
 *    sem regra publicada que justifique a exclusão da cobrança.
 */
const PADRAO_D_CONTRATOS = [
  // INCONSISTENCIA_CAMADA1_V9 — Jul/2024
  { contract_number: "162288082", mes: "2024-07", produto: "NÃO CONSIGNADO",
    cat_aplicada: "TABELA 1", cat_devida: "TABELA 2",
    pct_aplicado: 0.054, pct_devido: 0.06, diferenca: -39.39,
    obs_v9: "pct_aplicado_bate_avista_esperado",
    motivo_exclusao: "INCONSISTENCIA_CAMADA1_V9" },
  { contract_number: "160726902", mes: "2024-07", produto: "NÃO CONSIGNADO",
    cat_aplicada: "TABELA 1", cat_devida: "TABELA 2",
    pct_aplicado: 0.054, pct_devido: 0.06, diferenca: -34.20,
    obs_v9: "pct_aplicado_bate_avista_esperado",
    motivo_exclusao: "INCONSISTENCIA_CAMADA1_V9" },
  // INCONSISTENCIA_CAMADA1_V9 — Set/2024
  { contract_number: "165536754", mes: "2024-09", produto: "CRÉDITO ADIANTAMENTO",
    cat_aplicada: "TABELA 1", cat_devida: "TABELA 2",
    pct_aplicado: 0.016, pct_devido: 0.018, diferenca: -1.60,
    obs_v9: "pct_aplicado_bate_avista_esperado",
    motivo_exclusao: "INCONSISTENCIA_CAMADA1_V9" },
  { contract_number: "165885833", mes: "2024-09", produto: "CONSIGNADO INSS",
    cat_aplicada: "TABELA 1", cat_devida: "TABELA 2",
    pct_aplicado: 0.058, pct_devido: 0.06, diferenca: -47.20,
    obs_v9: "avista_esperado_5.4000%_aplicado_5.8000%",
    motivo_exclusao: "INCONSISTENCIA_CAMADA1_V9" },
  // TOLERANCIA_SILENCIOSA_VOLUME — Jul-Set/2025 (regime VOLUME 6 perfis)
  { contract_number: "185322066", mes: "2025-07", produto: "NÃO CONSIGNADO",
    cat_aplicada: "UPPER MIDDLE", cat_devida: "UPPER MIDDLE",
    pct_aplicado: 0.058, pct_devido: 0.06, diferenca: -4.24,
    obs_v9: "avista_esperado_6.0000%_aplicado_5.8000%",
    motivo_exclusao: "TOLERANCIA_SILENCIOSA_VOLUME" },
  { contract_number: "187526853", mes: "2025-08", produto: "CONSIGNADO PUBLICO",
    cat_aplicada: "MIDDLE", cat_devida: "MIDDLE",
    pct_aplicado: 0.057, pct_devido: 0.06, diferenca: -24.00,
    obs_v9: "avista_esperado_6.0000%_aplicado_5.7000%",
    motivo_exclusao: "TOLERANCIA_SILENCIOSA_VOLUME" },
  { contract_number: "189734102", mes: "2025-09", produto: "NÃO CONSIGNADO",
    cat_aplicada: "UPPER MIDDLE", cat_devida: "UPPER MIDDLE",
    pct_aplicado: 0.058, pct_devido: 0.06, diferenca: -1.40,
    obs_v9: "avista_esperado_6.0000%_aplicado_5.8000%",
    motivo_exclusao: "TOLERANCIA_SILENCIOSA_VOLUME" },
];

(async () => {
  if (!VALIDATE_ONLY) {
    console.log("=== seed audit_v9_padrao_d_exclusoes ===");
    // upsert idempotente: onConflict=primary key (contract_number,mes), ignoreDuplicates=true.
    const { error } = await sb
      .from("audit_v9_padrao_d_exclusoes")
      .upsert(PADRAO_D_CONTRATOS, {
        onConflict: "contract_number,mes",
        ignoreDuplicates: true,
      });
    if (error) {
      console.error("Erro upsert:", error.message);
      process.exit(1);
    }
    console.log(`  upsert ${PADRAO_D_CONTRATOS.length} contratos OK`);
  }

  // Validação pós-seed
  const { count, error: errCount } = await sb
    .from("audit_v9_padrao_d_exclusoes")
    .select("*", { count: "exact", head: true });
  if (errCount) {
    console.error("Erro count:", errCount.message);
    process.exit(1);
  }
  console.log(`  count audit_v9_padrao_d_exclusoes = ${count} (esperado: 7)`);

  // Validação por motivo
  const { data, error: errSel } = await sb
    .from("audit_v9_padrao_d_exclusoes")
    .select("motivo_exclusao");
  if (errSel) {
    console.error("Erro select motivo:", errSel.message);
    process.exit(1);
  }
  const counts = new Map();
  for (const r of data) counts.set(r.motivo_exclusao, (counts.get(r.motivo_exclusao) || 0) + 1);
  for (const [m, c] of counts) console.log(`    ${m}: ${c}`);

  if (count !== 7) {
    console.error(`FAIL: count=${count} ≠ 7`);
    process.exit(1);
  }
  console.log("\nPASS — tabela populada com 7 contratos.");
  process.exit(0);
})();
