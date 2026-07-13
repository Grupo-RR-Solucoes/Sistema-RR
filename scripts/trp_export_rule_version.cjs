#!/usr/bin/env node
/**
 * scripts/trp_export_rule_version.cjs — EXPORTA a regra ATIVA de uma competência
 * de trp_rule_versions (banco) para um JSON versionado em regras_promotiva/json/.
 *
 * POR QUE: as competências que nasceram de JSON curado (abr/mai/jun 2026) são
 * reconstrutíveis do git. As que entraram pela TELA (upload de PDF → commit
 * versionado, F6b.3) existem SÓ no banco — se o banco cair, a regra que o motor
 * usa em produção se perde. Este script fecha esse ponto único de falha:
 * baixa o regra_json da versão ATIVA e o versiona no repo, no MESMO formato dos
 * TRP35..37 (JSON pretty, 2 espaços), de modo que o seed possa reconstruí-la.
 *
 * READ-ONLY no banco. Só escreve o arquivo local.
 *
 * PROCESSO (fazer a cada TRP nova comitada pela tela):
 *   1) node scripts/trp_export_rule_version.cjs 2026-07 TRP38_2026-07.json
 *   2) node scripts/trp_seed_verify_deepequal.cjs   (prova arquivo == banco)
 *   3) adicionar a competência em scripts/trp_seed_rule_versions.gen.cjs
 *      (COMPETENCIAS) e commitar o JSON — daí a regra é reconstrutível do git.
 *
 * Requisitos: .env.local com NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
 * Se o service-role não estiver à mão, rode o SELECT que este script imprime no
 * erro (Studio) e salve o regra_json manualmente no mesmo caminho.
 *
 * Uso: node scripts/trp_export_rule_version.cjs <YYYY-MM> [arquivo.json]
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const JSON_DIR = path.join(ROOT, "regras_promotiva", "json");

function loadEnv() {
  for (const fname of [".env.local", ".env"]) {
    const p = path.join(ROOT, fname);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

function selectManual(firstDay) {
  return [
    "-- Rode no Studio (SQL editor) e salve a coluna regra_json em",
    "-- regras_promotiva/json/<ARQUIVO>.json (JSON puro, sem aspas externas):",
    "select competencia, version_no, regime, valid_from, valid_until,",
    "       trp_doc_ref, source_filename, source_sha256, parser_version,",
    "       jsonb_pretty(regra_json) as regra_json",
    "  from trp_rule_versions",
    ` where competencia = date '${firstDay}' and is_active;`,
  ].join("\n");
}

async function main() {
  const comp = process.argv[2];
  if (!comp || !/^\d{4}-\d{2}$/.test(comp)) {
    console.error("Uso: node scripts/trp_export_rule_version.cjs <YYYY-MM> [arquivo.json]");
    process.exit(1);
  }
  const firstDay = `${comp}-01`;
  const outName = process.argv[3] || `TRP_${comp}.json`;
  const outPath = path.join(JSON_DIR, outName);

  loadEnv();
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_KEY) {
    console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local.");
    console.error("");
    console.error(selectManual(firstDay));
    process.exit(1);
  }

  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("trp_rule_versions")
    .select(
      "id, competencia, version_no, regime, valid_from, valid_until, is_active, " +
        "trp_doc_ref, source_filename, source_sha256, parser_version, uploaded_at, notes, regra_json"
    )
    .eq("competencia", firstDay)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error(`ERRO na consulta: ${error.message}`);
    console.error("");
    console.error(selectManual(firstDay));
    process.exit(1);
  }
  if (!data) {
    console.error(`Sem versão ATIVA para ${comp} em trp_rule_versions.`);
    process.exit(1);
  }

  const texto = JSON.stringify(data.regra_json, null, 2) + "\n";
  fs.writeFileSync(outPath, texto, "utf8");

  console.log(`EXPORTADO: regras_promotiva/json/${outName}  (${texto.length} bytes)`);
  console.log("");
  console.log(`  competencia     ${data.competencia}`);
  console.log(`  version_no      ${data.version_no} (is_active=${data.is_active})`);
  console.log(`  regime          ${data.regime}`);
  console.log(`  vigência        ${data.valid_from} .. ${data.valid_until}`);
  console.log(`  trp_doc_ref     ${data.trp_doc_ref}`);
  console.log(`  source_filename ${data.source_filename}`);
  console.log(`  source_sha256   ${data.source_sha256}`);
  console.log(`  parser_version  ${data.parser_version}`);
  console.log(`  uploaded_at     ${data.uploaded_at}`);
  console.log(`  produtos        ${Object.keys(data.regra_json).filter((k) => k !== "_meta").join(", ")}`);
  console.log("");
  console.log("Próximo passo (prova de fidelidade): node scripts/trp_seed_verify_deepequal.cjs");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
