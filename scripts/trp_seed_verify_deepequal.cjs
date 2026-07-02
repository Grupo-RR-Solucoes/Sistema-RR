#!/usr/bin/env node
/**
 * scripts/trp_seed_verify_deepequal.cjs — PROVA de deep-equal do seed.
 *
 * READ-ONLY. Para cada competência (abr/mai/jun 2026), lê regra_json da versão
 * ATIVA em trp_rule_versions (via service-role) e compara VALOR-A-VALOR contra o
 * JSON canônico do arquivo (o mesmo que o motor importa). Prova que o seed é
 * cópia fiel — a igualdade é SEMÂNTICA (jsonb canoniza ordem de chaves/espaços,
 * então o deep-equal é order-independent em objetos; arrays mantêm ordem).
 *
 * Requisitos: .env.local com NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
 * Uso: node scripts/trp_seed_verify_deepequal.cjs   (exit 0 = tudo deep-equal)
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const JSON_DIR = path.join(ROOT, "regras_promotiva", "json");

const COMPETENCIAS = [
  { comp: "2026-04", firstDay: "2026-04-01", file: "TRP35_2026-04.json" },
  { comp: "2026-05", firstDay: "2026-05-01", file: "TRP36_2026-05.json" },
  { comp: "2026-06", firstDay: "2026-06-01", file: "TRP37_2026-06.json" },
];

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

/**
 * Deep-equal semântico. Objetos: mesmo CONJUNTO de chaves + valores recursivos
 * (ordem irrelevante — jsonb reordena). Arrays: mesmo comprimento e ORDEM.
 * Retorna null se iguais, ou uma string com o primeiro caminho divergente.
 */
function deepDiff(a, b, pathStr = "$") {
  if (a === b) return null;
  const ta = Array.isArray(a) ? "array" : a === null ? "null" : typeof a;
  const tb = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;
  if (ta !== tb) return `${pathStr}: tipo ${ta} != ${tb}`;

  if (ta === "array") {
    if (a.length !== b.length) return `${pathStr}: array len ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = deepDiff(a[i], b[i], `${pathStr}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (ta === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) {
      return `${pathStr}: chaves diferem [${ka.join(",")}] != [${kb.join(",")}]`;
    }
    for (const k of ka) {
      const d = deepDiff(a[k], b[k], `${pathStr}.${k}`);
      if (d) return d;
    }
    return null;
  }
  if (ta === "number") {
    // jsonb preserva o número; compara exato após normalizar -0.
    return Object.is(a === 0 ? 0 : a, b === 0 ? 0 : b) ? null : `${pathStr}: ${a} != ${b}`;
  }
  return `${pathStr}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

async function main() {
  loadEnv();
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_KEY) {
    console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local");
    process.exit(1);
  }
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  let ok = 0;
  let fail = 0;
  for (const { comp, firstDay, file } of COMPETENCIAS) {
    const fileObj = JSON.parse(fs.readFileSync(path.join(JSON_DIR, file), "utf8"));
    const { data, error } = await sb
      .from("trp_rule_versions")
      .select("id, version_no, regra_json")
      .eq("competencia", firstDay)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.log(`  ${comp}  ERRO consulta: ${error.message}`);
      fail++;
      continue;
    }
    if (!data) {
      console.log(`  ${comp}  FAIL: sem versão ativa no banco (rodou o seed?)`);
      fail++;
      continue;
    }
    const diff = deepDiff(fileObj, data.regra_json);
    if (diff) {
      console.log(`  ${comp}  FAIL deep-equal (v${data.version_no}): ${diff}`);
      fail++;
    } else {
      console.log(`  ${comp}  OK deep-equal (v${data.version_no}, ${file})`);
      ok++;
    }
  }

  console.log("");
  console.log(`Resultado: ${ok} OK / ${fail} FAIL de ${COMPETENCIAS.length} competências.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
