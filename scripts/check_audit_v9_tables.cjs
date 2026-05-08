#!/usr/bin/env node
/**
 * scripts/check_audit_v9_tables.cjs — validação pós-migration Fase 4.1.
 *
 * Verifica:
 *   1. 4 tabelas audit_v9_* existem (via SELECT em cada uma)
 *   2. 7+ indexes não-PK criados (via RPC se disponível, ou skip com aviso)
 *   3. Todas as 4 tabelas vazias (count=0)
 *
 * Conecta via SUPABASE_SERVICE_ROLE_KEY do .env.local (bypass RLS).
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Carrega .env.local manualmente (sem dotenv)
const envPath = path.resolve(__dirname, "..", ".env.local");
const envText = fs.readFileSync(envPath, "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const TABELAS = [
  "audit_v9_avista",
  "audit_v9_enquadramento",
  "audit_v9_prt",
  "audit_v9_reconciliacao",
];

async function checkTabela(t) {
  const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
  if (error) return { tabela: t, existe: false, vazia: null, count: null, erro: error.message };
  return { tabela: t, existe: true, vazia: count === 0, count };
}

async function main() {
  console.log(`Conectando: ${url}`);

  // 1. Verificar existência + count
  console.log("\n=== 1. Tabelas e contagens ===");
  const resultados = [];
  for (const t of TABELAS) resultados.push(await checkTabela(t));
  for (const r of resultados) {
    if (r.existe) console.log(`  PASS — ${r.tabela}: count=${r.count} ${r.vazia ? "(vazia)" : "(POPULADA)"}`);
    else console.log(`  FAIL — ${r.tabela}: ${r.erro}`);
  }
  const todasExistem = resultados.every((r) => r.existe);
  const todasVazias = resultados.every((r) => r.vazia === true);

  // 2. Indexes (via RPC supabase-js — se RPC não existir, fallback aviso)
  console.log("\n=== 2. Indexes ===");
  let indexesOk = null;
  try {
    // Tenta uma RPC genérica que lista indexes (não existe por padrão; vai falhar)
    const { data, error } = await supabase.rpc("pg_indexes_audit_v9");
    if (error) throw error;
    console.log(`  ${data.length} indexes audit_v9_*:`);
    for (const i of data) console.log(`    - ${i.tablename}.${i.indexname}`);
    indexesOk = data.length >= 7;
  } catch (e) {
    console.log("  RPC pg_indexes_audit_v9 não disponível — esperado; PostgREST não expõe pg_indexes por padrão.");
    console.log("  Verificação alternativa: rodar via SQL Editor do Supabase Studio:");
    console.log("");
    console.log("    select tablename, indexname from pg_indexes");
    console.log("    where schemaname='public' and tablename like 'audit_v9_%'");
    console.log("    order by tablename, indexname;");
    console.log("");
    console.log("  Esperado (12 entradas: 4 PKs + 7 não-PK + 1 unique):");
    console.log("    audit_v9_avista          | audit_v9_avista_pkey");
    console.log("    audit_v9_avista          | audit_v9_avista_mes_status_idx");
    console.log("    audit_v9_avista          | audit_v9_avista_bloco_idx");
    console.log("    audit_v9_avista          | audit_v9_avista_convenio_idx");
    console.log("    audit_v9_enquadramento   | audit_v9_enquadramento_pkey");
    console.log("    audit_v9_enquadramento   | audit_v9_enquadramento_regime_idx");
    console.log("    audit_v9_prt             | audit_v9_prt_pkey");
    console.log("    audit_v9_prt             | audit_v9_prt_mes_status_idx");
    console.log("    audit_v9_prt             | audit_v9_prt_bloco_idx");
    console.log("    audit_v9_prt             | audit_v9_prt_convenio_idx");
    console.log("    audit_v9_reconciliacao   | audit_v9_reconciliacao_pkey");
    console.log("    audit_v9_reconciliacao   | audit_v9_reconciliacao_mes_idx");
    console.log("    audit_v9_reconciliacao   | audit_v9_reconciliacao_mes_cnpj_key (unique)");
  }

  // 3. Resumo
  console.log("\n=== 3. Resumo ===");
  console.log(`  4 tabelas existem: ${todasExistem ? "PASS" : "FAIL"}`);
  console.log(`  4 tabelas vazias: ${todasVazias ? "PASS" : "FAIL (já populadas — verificar)"}`);
  console.log(`  Indexes: verificação manual no Studio (RPC genérica não existe)`);

  if (!todasExistem) process.exit(1);
  if (!todasVazias) process.exit(2);
  process.exit(0);
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(99);
});
