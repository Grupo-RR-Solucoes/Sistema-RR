#!/usr/bin/env node
/**
 * scripts/diag-materializar-tempo.cjs — separar o bloco (1) do bloco (2) pelo
 * RELOGIO. READ-ONLY (congelarPrevisao roda em dryRun; nada e gravado).
 *
 * O QUE JA CAIU (todas medidas, nao supostas):
 *   1. `if fileType === "TODOS"`      -> a planilha vai inteira; produto e sempre TODOS
 *   2. migration nao aplicada         -> OpenAPI expoe as DUAS funcoes ao service_role
 *   3. chave do metadata renomeada    -> chaves identicas em 06/07/08
 *   4. indice unico ausente (42P10)   -> declarado na DDL; 0 duplicatas em 249.740
 *   5. FK orfa (23503)                -> 0 orfaos em 270.198 entries
 *   6. valor que estoura cast (22003) -> faixas identicas as de junho, 0 estouros
 *   7. NRO OPERACAO em branco         -> 0
 *
 * Sobra causa de EXECUCAO. E ha um numero no banco que a aponta: entre o
 * finished_at do import e a primeira escrita do monitor de inadimplencia
 * (bloco 3) passam ~43-57s nos QUATRO imports. Nesse intervalo so cabem os
 * blocos (1) e (2). Se (1) falhasse instantaneamente (erro tipo PGRST202), o
 * intervalo seria quase todo do (2). Se (2) for rapido, o intervalo e do (1) —
 * e ai a leitura natural e TIMEOUT de statement na camada da API, nao defeito
 * de dado.
 *
 * Este script cronometra o (2) sozinho, em dryRun, e subtrai.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");
const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

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

function carrega() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".tempo-out-"));
  process.on("exit", () => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_e) {} });
  fs.writeFileSync(path.join(OUT, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true,
      resolveJsonModule: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: [path.join(ROOT, "lib/recebiveis/congelarPrevisao.ts")],
  }));
  try { execSync('npx tsc -p "' + path.join(OUT, "tsconfig.json") + '"', { cwd: ROOT, stdio: "pipe" }); } catch (_e) {}
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (r, ...rest) {
    if (r.startsWith("@/")) r = path.join(OUT, r.slice(2));
    return orig.call(this, r, ...rest);
  };
  const p1 = path.join(OUT, "lib/recebiveis/congelarPrevisao.js");
  return fs.existsSync(p1) ? require(p1) : null;
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  console.log("\n### 1. o intervalo observado nos 4 imports de 2026-08 ###");
  const { data: imps } = await sb.from("monthly_closing_imports")
    .select("company_id,created_at,finished_at").eq("year", 2026).eq("month", 8).order("created_at");
  const { data: comps } = await sb.from("companies").select("id,name");
  const nome = (id) => ((comps || []).find((c) => c.id === id) || {}).name || "-";
  const { data: mon } = await sb.from("prt_inadimplencia_monitor")
    .select("atualizado_em").eq("competencia", "2026-08").order("atualizado_em");
  const carimbos = [...new Set((mon || []).map((r) => String(r.atualizado_em)))].sort();
  console.log("  import                     duracao   finished_at -> 1a escrita do monitor");
  for (const i of imps || []) {
    const fin = new Date(i.finished_at).getTime();
    const dur = (fin - new Date(i.created_at).getTime()) / 1000;
    const prox = carimbos.map((c) => new Date(c).getTime()).filter((t) => t > fin).sort((a, b) => a - b)[0];
    console.log("  " + nome(i.company_id).padEnd(24) + String(dur.toFixed(0) + "s").padStart(7) +
      "   " + (prox ? ((prox - fin) / 1000).toFixed(1) + "s nos blocos (1)+(2)" : "-"));
  }

  console.log("\n### 2. cronometrando o bloco (2) sozinho, em dryRun ###");
  const mod = carrega();
  if (!mod || !mod.congelarPrevisao) { console.log("  (nao consegui carregar congelarPrevisao)"); return; }
  const t0 = Date.now();
  const r = await mod.congelarPrevisao(sb, { dryRun: true });
  const dt = (Date.now() - t0) / 1000;
  console.log("  congelarPrevisao(dryRun) levou " + dt.toFixed(1) + "s");
  console.log("    vintage que ele calcularia : " + r.competenciaSnapshot);
  console.log("    linhas projetadas          : " + r.linhasProjetadas);
  console.log("    linhas que gravaria        : " + (r.vintageJaExistia ? "0 (vintage ja existia — write-once descarta)" : r.linhasProjetadas));
  console.log("    vintageIncompleto          : " + r.vintageIncompleto);
  for (const a of r.avisos || []) console.log("    aviso: " + a);

  console.log("\n### 3. leitura ###");
  console.log("  Se (2) explica quase todo o intervalo, o bloco (1) falhou RAPIDO");
  console.log("  (erro imediato). Se (2) e rapido, o intervalo e do (1) — e ai a");
  console.log("  hipotese viva e TIMEOUT de statement na camada da API.");

  console.log("\n=== fim (nada foi gravado) ===");
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
