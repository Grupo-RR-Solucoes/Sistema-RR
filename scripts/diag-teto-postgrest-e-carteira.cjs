#!/usr/bin/env node
/*
 * scripts/diag-teto-postgrest-e-carteira.cjs — READ-ONLY.
 *
 * Duas perguntas, medidas antes de escrever qualquer conserto:
 *
 *   A. A CARTEIRA VOLTOU? Estado de producao_contrato / carteira_contrato depois
 *      da execucao manual no Studio, e — o que importa para o efeito (2) — qual
 *      vintage o congelamento calcularia AGORA, e se falta recongelar algo.
 *      congelarPrevisao roda em dryRun: calcula tudo e NAO grava.
 *
 *   B. QUAL O TETO REAL DO PostgREST NESTE PROJETO. Nao se cita documentacao:
 *      escala-se a carga de uma leitura ate ela MORRER, e anota-se em quanto
 *      tempo e com que codigo. 57014 = statement_timeout do Postgres (teto de
 *      SQL). Erro de rede/504 sem codigo = teto de GATEWAY, que e outro numero e
 *      nao se resolve mexendo no SQL.
 *      So SELECT. Nenhuma escrita, nenhuma RPC de escrita.
 *
 * POR QUE ISSO DECIDE A PROXIMA PECA: a proposta era escopar a materializacao
 * por competencia. Isso so encolhe a PRIMEIRA funcao. A segunda
 * (fn_materializar_carteira_contrato) e recomputo de historia inteira por
 * construcao — as CTEs `serie` (lag por contrato), `comp_max`, `ultima` e o
 * NOT EXISTS de `saida_transicao` varrem TODO o producao_contrato; so o SELECT
 * final e recortado (competencia >= '2026-01'). Ela nem tem parametro de
 * competencia, e nao poderia ter sem perder a deteccao de saida. Mais: ela
 * comeca com TRUNCATE, que toma ACCESS EXCLUSIVE. Se ela sozinha ja passa do
 * teto, escopar a primeira nao resolve — e por isso o teto e medido aqui.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const { execSync } = require("child_process");
const Module = require("module");

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

function carregaCongelar() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".teto-out-"));
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

const brl = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ============================================================ A. a carteira
  console.log("\n############ A. a carteira depois do run manual no Studio ############");
  for (const t of ["producao_contrato", "carteira_contrato"]) {
    const { count } = await sb.from(t).select("*", { count: "exact", head: true });
    const { data: mx } = await sb.from(t).select("competencia").order("competencia", { ascending: false }).limit(1);
    const { data: mn } = await sb.from(t).select("competencia").order("competencia", { ascending: true }).limit(1);
    console.log(`  ${t.padEnd(20)} linhas=${String(count).padStart(7)}   competencia ${mn && mn[0] ? mn[0].competencia : "?"} -> ${mx && mx[0] ? mx[0].competencia : "?"}`);
    for (const c of ["2026-06", "2026-07", "2026-08"]) {
      const { count: n } = await sb.from(t).select("*", { count: "exact", head: true }).eq("competencia", c);
      console.log(`      ${c}: ${n}`);
    }
    const cols = ["created_at"];
    for (const col of cols) {
      const { data: ult } = await sb.from(t).select(col).order(col, { ascending: false }).limit(1);
      const { data: pri } = await sb.from(t).select(col).order(col, { ascending: true }).limit(1);
      if (ult && ult[0]) console.log(`      ${col}: ${pri[0][col]} -> ${ult[0][col]}`);
    }
  }

  console.log("\n--- o congelamento: que vintage ele calcularia AGORA? (dryRun, nao grava) ---");
  const { data: vs } = await sb.from("previsao_snapshot").select("competencia_snapshot, competencia_alvo, data_congelamento");
  const vint = new Map();
  for (const r of vs || []) {
    const a = vint.get(r.competencia_snapshot) || { n: 0, ult: "" };
    a.n++;
    if (String(r.data_congelamento) > a.ult) a.ult = r.data_congelamento;
    vint.set(r.competencia_snapshot, a);
  }
  console.log("  vintages GRAVADOS hoje:");
  for (const kv of [...vint].sort()) console.log(`    ${kv[0]}: ${kv[1].n} linhas, ultimo ${String(kv[1].ult).slice(0, 19)}`);

  const mod = carregaCongelar();
  if (!mod || !mod.congelarPrevisao) {
    console.log("  (nao consegui carregar congelarPrevisao)");
  } else {
    const t0 = Date.now();
    const r = await mod.congelarPrevisao(sb, { dryRun: true });
    console.log(`  congelarPrevisao(dryRun) em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`    vintage que calcularia : ${r.competenciaSnapshot}`);
    console.log(`    linhas projetadas      : ${r.linhasProjetadas}`);
    console.log(`    vintageJaExistia       : ${r.vintageJaExistia}`);
    console.log(`    vintageIncompleto      : ${r.vintageIncompleto}`);
    console.log(`    gravaria               : ${r.vintageJaExistia ? 0 : r.linhasProjetadas} linha(s)`);
    for (const a of r.avisos || []) console.log(`    aviso: ${a}`);
  }

  // ============================================================ B. o teto
  console.log("\n############ B. o teto real do PostgREST neste projeto ############");
  const { count: totEntries } = await sb.from("monthly_closing_entries").select("*", { count: "exact", head: true });
  console.log(`  universo do teste: monthly_closing_entries = ${totEntries} linhas (com jsonb metadata)\n`);

  const niveis = [
    { nome: "1. count(*) simples", run: () => sb.from("monthly_closing_entries").select("*", { count: "exact", head: true }) },
    { nome: "2. count com filtro em coluna comum", run: () => sb.from("monthly_closing_entries").select("*", { count: "exact", head: true }).eq("entry_type", "PRT") },
    { nome: "3. count com ILIKE sobre jsonb (extrai chave em toda linha)", run: () => sb.from("monthly_closing_entries").select("*", { count: "exact", head: true }).ilike("metadata->>NRO OPERAÇÃO", "%1%") },
    { nome: "4. count com 2 ILIKE sobre jsonb", run: () => sb.from("monthly_closing_entries").select("*", { count: "exact", head: true }).ilike("metadata->>NRO OPERAÇÃO", "%1%").ilike("metadata->>CHAVE J", "%J%") },
    { nome: "5. ORDER BY expressao jsonb (ordena a tabela toda)", run: () => sb.from("monthly_closing_entries").select("id").order("metadata->>NRO OPERAÇÃO", { ascending: true }).limit(1) },
    { nome: "6. ORDER BY jsonb + ILIKE jsonb", run: () => sb.from("monthly_closing_entries").select("id, metadata").ilike("metadata->>CHAVE J", "%J%").order("metadata->>NRO OPERAÇÃO", { ascending: true }).limit(1000) },
    { nome: "7. count DISTINCT-ish: order por 2 expressoes jsonb", run: () => sb.from("monthly_closing_entries").select("id").order("metadata->>CHAVE J", { ascending: true }).order("metadata->>NRO OPERAÇÃO", { ascending: false }).limit(5000) },
  ];

  let teto = null;
  for (const n of niveis) {
    const t0 = Date.now();
    let res;
    try {
      res = await n.run();
    } catch (e) {
      const ms = Date.now() - t0;
      console.log(`  ${n.nome}\n      MORREU em ${(ms / 1000).toFixed(1)}s — EXCECAO (sem codigo do PostgREST): ${String(e.message).slice(0, 120)}`);
      console.log(`      >>> sem codigo = teto de GATEWAY/rede, nao statement_timeout`);
      teto = { ms, tipo: "gateway", detalhe: String(e.message).slice(0, 160) };
      break;
    }
    const ms = Date.now() - t0;
    if (res.error) {
      console.log(`  ${n.nome}\n      MORREU em ${(ms / 1000).toFixed(1)}s — ${res.error.code || "(sem codigo)"}: ${String(res.error.message).slice(0, 140)}`);
      teto = { ms, tipo: res.error.code === "57014" ? "statement_timeout" : "outro", detalhe: `${res.error.code} ${res.error.message}` };
      break;
    }
    console.log(`  ${n.nome}\n      OK em ${(ms / 1000).toFixed(1)}s  (count=${res.count ?? (res.data ? res.data.length : "?")})`);
  }

  console.log("\n  --- veredito do teto ---");
  if (!teto) {
    console.log("  NENHUM dos 7 niveis morreu. O teto esta ACIMA da carga que consegui gerar");
    console.log("  por leitura — a medicao e um PISO, nao o numero exato.");
  } else {
    console.log(`  MORREU aos ${(teto.ms / 1000).toFixed(1)}s — tipo: ${teto.tipo}`);
    console.log(`  ${teto.detalhe}`);
  }

  console.log("\n=== fim (nada foi gravado) ===");
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
});
