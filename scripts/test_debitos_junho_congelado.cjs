#!/usr/bin/env node
/**
 * scripts/test_debitos_junho_congelado.cjs — PROVA de que plugar o débito automático
 * no import do fechamento RR não mexe em junho. READ-ONLY (não grava nada).
 *
 * O que faz:
 *   1. Snapshot (hash) do estado de junho ANTES.
 *   2. Roda o resolvedor de junho em DRY-RUN e mostra o que ele FARIA se rodasse
 *      (é isso que a trava impede).
 *   3. Roda a MESMA trava de competência que o import usa e prova que ela recusa junho.
 *   4. Snapshot DEPOIS: hash idêntico => nada foi tocado.
 *
 * Uso: node scripts/test_debitos_junho_congelado.cjs
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const Module = require("module");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const DEBITO_AUTO_PRIMEIRA_COMPETENCIA = "2026-07"; // espelha lib/monthlyClosingImport

for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function loadResolver() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".debitos-out-"));
  process.on("exit", () => {
    try {
      fs.rmSync(OUT, { recursive: true, force: true });
    } catch (_e) {}
  });
  const tsconfig = {
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node",
      esModuleInterop: true, resolveJsonModule: true,
      allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: [
      path.join(ROOT, "lib/debitInsuranceResolver.ts"),
      path.join(ROOT, "lib/debitRules.ts"),
      path.join(ROOT, "lib/debitsData.ts"),
    ],
  };
  const cfg = path.join(OUT, "tsconfig.debitos.json");
  fs.writeFileSync(cfg, JSON.stringify(tsconfig));
  try {
    execSync(`npx tsc -p "${cfg}"`, { cwd: ROOT, stdio: "pipe" });
  } catch (_e) {}
  const alvo = path.join(OUT, "lib/debitInsuranceResolver.js");
  if (!fs.existsSync(alvo)) throw new Error("tsc nao emitiu debitInsuranceResolver.js");
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/")) request = path.join(OUT, request.slice(2));
    return origResolve.call(this, request, ...rest);
  };
  return require(alvo);
}

async function snapshot(year, month) {
  const { data: debits } = await sb
    .from("promoter_debits")
    .select("id, promoter_id, company_id, kind, debit_type, total_amount, status")
    .eq("start_year", year).eq("start_month", month).order("id", { ascending: true });
  const { data: discounts } = await sb
    .from("promoter_discounts")
    .select("id, promoter_id, discount_type, amount, status, debit_id")
    .eq("year", year).eq("month", month).order("id", { ascending: true });
  const { data: fila } = await sb
    .from("promoter_debit_assignments")
    .select("operation, status, estorno_amount, promoter_id")
    .eq("year", year).eq("month", month).order("operation", { ascending: true });
  const hash = crypto.createHash("sha256").update(JSON.stringify({ debits, discounts, fila })).digest("hex");
  return { debits: debits || [], discounts: discounts || [], fila: fila || [], hash };
}

/** A MESMA trava do import (lib/monthlyClosingImport.persistAutoInsuranceDebits). */
function travaDeCompetencia(year, month) {
  const competencia = `${year}-${String(month).padStart(2, "0")}`;
  if (competencia < DEBITO_AUTO_PRIMEIRA_COMPETENCIA) {
    return { executado: false, motivo: `competencia ${competencia} congelada (anterior a ${DEBITO_AUTO_PRIMEIRA_COMPETENCIA})` };
  }
  return { executado: true };
}

let falhas = 0;
function ok(cond, msg) {
  console.log(`  ${cond ? "OK  " : "FALHOU  "}${msg}`);
  if (!cond) falhas++;
}

(async () => {
  const resolver = loadResolver();

  console.log("\n=== JUNHO/2026 CONGELADO — prova de no-op (read-only) ===\n");

  const antes = await snapshot(2026, 6);
  console.log(`  estado ANTES: ${antes.debits.length} debitos, ${antes.discounts.length} parcelas, ${antes.fila.length} na fila`);
  console.log(`  hash ANTES:  ${antes.hash}`);

  // 1. O que o resolvedor FARIA em junho (dry-run) — é isso que a trava impede.
  const plan = await resolver.resolveInsuranceDebits(sb, { year: 2026, month: 6, dryRun: true });
  console.log(`\n  [dry-run] o resolvedor em junho geraria: ${plan.debits.length} debito(s), ${plan.fila.length} na fila (regra ${JSON.stringify(plan.rule)})`);
  console.log(`  [dry-run] se isso rodasse no import, faria delete-and-replace dos ${antes.debits.filter((d) => d.kind === "AUTO").length} AUTO ja gravados.`);

  // 2. A trava recusa junho.
  const trava = travaDeCompetencia(2026, 6);
  ok(trava.executado === false, `a trava do import RECUSA junho -> ${trava.motivo}`);
  ok(travaDeCompetencia(2026, 7).executado === true, "a trava do import LIBERA julho (2026-07)");
  ok(travaDeCompetencia(2026, 5).executado === false, "a trava do import RECUSA maio (2026-05)");

  // 3. Nada mudou.
  const depois = await snapshot(2026, 6);
  console.log(`\n  hash DEPOIS: ${depois.hash}`);
  ok(antes.hash === depois.hash, "junho INTOCADO (hash identico: debitos + parcelas + fila)");
  ok(depois.debits.length === 22, `junho segue com 22 debitos (15 AUTO + 7 MANUAL) — tem ${depois.debits.length}`);
  ok(depois.discounts.length === 25, `junho segue com 25 parcelas — tem ${depois.discounts.length}`);
  const somaAuto = depois.debits.filter((d) => d.kind === "AUTO").reduce((s, d) => s + Number(d.total_amount), 0);
  ok(Math.abs(somaAuto - 872.71) < 0.005, `soma dos AUTO de junho segue 872,71 — tem ${somaAuto.toFixed(2)}`);

  console.log(`\n=== ${falhas === 0 ? "PASSOU" : "FALHOU"} — ${falhas} falha(s) ===\n`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
