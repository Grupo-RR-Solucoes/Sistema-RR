#!/usr/bin/env node
/**
 * scripts/diag-rpc-existe-openapi.cjs — a RPC EXISTE no banco? READ-ONLY, e sem
 * executar a funcao.
 *
 * POR QUE NAO SE CHAMA A FUNCAO PARA DESCOBRIR
 * --------------------------------------------
 * fn_materializar_producao_contrato() e fn_materializar_carteira_contrato()
 * ESCREVEM (a segunda faz TRUNCATE + INSERT). Chama-las nao seria medicao: seria
 * o proprio conserto. E nao ha psql/CLI/URL direta neste ambiente, entao nao da
 * para envolver a chamada num BEGIN/ROLLBACK.
 *
 * TENTATIVA ANTERIOR, DESCARTADA: chamar a RPC com um argumento inventado (o
 * PostgREST falha antes de executar). Nao serve — o controle POSITIVO
 * detect_rules_stale, que sabidamente roda, tambem devolveu "nao existe". Esta
 * versao nao emite a dica "Perhaps you meant to call the function". Falso
 * negativo para tudo. Ver scripts/diag-probe-rpc-materializar.cjs.
 *
 * O QUE FUNCIONA: o PostgREST publica um documento OpenAPI na raiz do /rest/v1/,
 * com um path /rpc/<nome> para CADA funcao exposta ao papel autenticado. Ler o
 * catalogo nao executa nada.
 *
 * LIMITE HONESTO desta medicao: o catalogo lista o que esta EXPOSTO (schema
 * public + EXECUTE para o papel). Ausencia = "nao existe OU nao esta exposta a
 * este papel" — sao coisas diferentes e o script nao as separa. Por isso os
 * controles: detect_rules_stale (existe, service_role) tem de APARECER.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(url + "/rest/v1/", {
    headers: { apikey: key, Authorization: "Bearer " + key, Accept: "application/openapi+json" },
  });
  console.log("\nGET /rest/v1/  ->  HTTP " + res.status + "  (papel: service_role)");
  const spec = await res.json();
  const paths = Object.keys(spec.paths || {});
  const rpcs = paths.filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5)).sort();
  console.log("funcoes RPC expostas: " + rpcs.length + "\n");

  const alvos = [
    ["fn_materializar_producao_contrato", "ALVO"],
    ["fn_materializar_carteira_contrato", "ALVO"],
    ["detect_rules_stale", "CONTROLE + (sabemos que roda: o ledgerHealth a consome)"],
    ["compute_rules_fingerprint", "CONTROLE + (mesma migration da detect_rules_stale)"],
    ["fn_nao_existe_de_jeito_nenhum_xyz_9911", "CONTROLE - (inventada)"],
  ];
  for (const [fn, papel] of alvos) {
    const tem = rpcs.indexOf(fn) >= 0;
    console.log("  " + (tem ? "PRESENTE " : "AUSENTE  ") + fn.padEnd(38) + " " + papel);
  }

  console.log("\n  --- toda RPC cujo nome lembra materializacao/carteira ---");
  const parecidas = rpcs.filter((r) => /materializ|carteira|producao_contrato|prt/i.test(r));
  console.log("  " + (parecidas.length ? parecidas.join("\n  ") : "(nenhuma)"));

  console.log("\n  --- catalogo completo, para o caso de a funcao ter outro nome ---");
  for (const r of rpcs) console.log("    " + r);

  console.log("\n  --- as tabelas da carteira estao expostas? (contraste) ---");
  for (const t of ["producao_contrato", "carteira_contrato", "previsao_snapshot"]) {
    console.log("    " + t.padEnd(20) + (paths.indexOf("/" + t) >= 0 ? "PRESENTE" : "AUSENTE"));
  }

  console.log("\n=== fim (nada foi gravado, nenhuma funcao foi executada) ===");
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
