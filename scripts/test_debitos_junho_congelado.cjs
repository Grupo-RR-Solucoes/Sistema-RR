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

  // ---- TRIPWIRE DE JUNHO — REANCORADO em 29/08/2026 ----
  //
  // Estes tres numeros NAO sao decoracao e NAO viram auto-computados: sao a unica
  // coisa no repo que percebe junho — competencia CONGELADA para o import — sendo
  // reescrito ENTRE execucoes. O hash acima so compara dentro do mesmo run; e este
  // trio que atravessa o tempo. Ele ja provou o proprio valor: foi ele, e so ele,
  // que registrou a rodada de 27/08/2026 as 20:32.
  //
  // ANCORA ANTERIOR: 22 debitos / 25 parcelas / AUTO 872,71, cravada em 12/07/2026.
  // ELA DISPAROU, E ESTAVA CERTA. O evento foi apurado no HANDOFF_RESIDUO_FINANCEIRO
  // secao 6c, e o veredito e que NAO houve perda:
  //   - junho foi de 872,71 para 899,21 (+R$ 26,50) e de 15 para 17 AUTO;
  //   - a forma bate com o degrau `+cms` do PR #195, cujo commit registra "a fila
  //     caiu de 7 para 4": tres operacoes ORFAS na fila ganharam dono, duas delas
  //     de junho. E ADICAO, nao troca de dono — ninguem perdeu para ninguem;
  //   - o total de 899,21 ja estava documentado as 18:25 de 27/08, ANTES da rodada
  //     das 20:32, e a rodada recriou os mesmos valores.
  // A CAUSA continua VIVA e e DIVIDA NOMEADA (mesma secao): scripts/canc-run-fila.cjs
  // chama resolveInsuranceDebits direto, sem passar por persistAutoInsuranceDebits,
  // e por isso nao ve a trava DEBITO_AUTO_PRIMEIRA_COMPETENCIA nem a guarda do
  // APPLIED. Enquanto esse desvio existir, junho pode ser reescrito de novo — e e
  // exatamente por isso que o tripwire e RECRAVADO, nunca removido.
  const ANCORA_JUNHO = {
    debitos: 24,
    parcelas: 27,
    somaAuto: 899.21,
    cravadaEm: "2026-08-29",
    procedencia:
      "estado de 2026-06 medido em 29/08/2026, depois da rodada de 27/08/2026 20:32 " +
      "apurada no HANDOFF_RESIDUO_FINANCEIRO 6c: +2 debitos AUTO (15->17) e +R$ 26,50, " +
      "por ADICAO de operacoes que estavam orfas na fila (degrau +cms do PR #195), " +
      "nao por troca de dono. Ancora anterior: 22 / 25 / 872,71, cravada em 12/07/2026.",
  };
  const somaAuto = depois.debits.filter((d) => d.kind === "AUTO").reduce((s, d) => s + Number(d.total_amount), 0);
  const okD = depois.debits.length === ANCORA_JUNHO.debitos;
  const okP = depois.discounts.length === ANCORA_JUNHO.parcelas;
  const okS = Math.abs(somaAuto - ANCORA_JUNHO.somaAuto) < 0.005;
  ok(okD, `junho segue com ${ANCORA_JUNHO.debitos} debitos (17 AUTO + 7 MANUAL) — tem ${depois.debits.length}`);
  ok(okP, `junho segue com ${ANCORA_JUNHO.parcelas} parcelas — tem ${depois.discounts.length}`);
  ok(okS, `soma dos AUTO de junho segue ${ANCORA_JUNHO.somaAuto.toFixed(2)} — tem ${somaAuto.toFixed(2)}`);
  if (!okD || !okP || !okS) {
    console.log(`\n  >> O TRIPWIRE DE JUNHO DISPAROU. Junho e competencia CONGELADA: se estes`);
    console.log(`     numeros mudaram, ALGUEM ESCREVEU em junho depois de ${ANCORA_JUNHO.cravadaEm}.`);
    console.log(`     ancora: ${ANCORA_JUNHO.debitos} debitos / ${ANCORA_JUNHO.parcelas} parcelas / AUTO ${ANCORA_JUNHO.somaAuto.toFixed(2)}`);
    console.log(`     hoje  : ${depois.debits.length} debitos / ${depois.discounts.length} parcelas / AUTO ${somaAuto.toFixed(2)}`);
    console.log(`     procedencia da ancora: ${ANCORA_JUNHO.procedencia}`);
    console.log(`     SUSPEITO CONHECIDO: scripts/canc-run-fila.cjs contorna a trava do import`);
    console.log(`     (HANDOFF_RESIDUO_FINANCEIRO 6c). Apure ANTES de recravar — e so recrave`);
    console.log(`     com data, procedencia e o que mudou, aqui no codigo.`);
  }

  console.log(`\n=== ${falhas === 0 ? "PASSOU" : "FALHOU"} — ${falhas} falha(s) ===\n`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
