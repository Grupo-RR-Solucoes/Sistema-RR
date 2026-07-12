#!/usr/bin/env node
/**
 * scripts/debitos_dryrun_julho.cjs — DRY-RUN do débito automático (tipo A) de uma
 * competência. NÃO GRAVA NADA (dryRun: true). Mostra estorno a estorno o que o
 * import do fechamento RR faria: quem resolve individual, quem cai na fila (MASTER)
 * e quanto desce de cada um pela regra VERSIONADA da competência.
 *
 * Como a regra de julho ainda pode estar com threshold=100 no banco (o UPDATE para
 * 150 é manual, no Studio), o script mostra as DUAS colunas: a regra como está hoje
 * no banco e a regra proposta (threshold 150).
 *
 * Uso: node scripts/debitos_dryrun_julho.cjs [ano] [mes]   (default 2026 7)
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const year = Number(process.argv[2] || 2026);
const month = Number(process.argv[3] || 7);
const competencia = `${year}-${String(month).padStart(2, "0")}`;
const THRESHOLD_PROPOSTO = 150;

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
    try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_e) {}
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
    include: [path.join(ROOT, "lib/debitInsuranceResolver.ts"), path.join(ROOT, "lib/debitRules.ts")],
  };
  const cfg = path.join(OUT, "tsconfig.debitos.json");
  fs.writeFileSync(cfg, JSON.stringify(tsconfig));
  try { execSync(`npx tsc -p "${cfg}"`, { cwd: ROOT, stdio: "pipe" }); } catch (_e) {}
  const alvo = path.join(OUT, "lib/debitInsuranceResolver.js");
  if (!fs.existsSync(alvo)) throw new Error("tsc nao emitiu debitInsuranceResolver.js");
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/")) request = path.join(OUT, request.slice(2));
    return origResolve.call(this, request, ...rest);
  };
  return require(alvo);
}

const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Régua proposta (threshold 150) aplicada sobre o estorno — só p/ comparação. */
function comThreshold(estorno, threshold, above = 0.8, below = 1.0) {
  return estorno * (estorno > threshold ? above : below);
}

(async () => {
  const resolver = loadResolver();

  // O fechamento RR de julho já entrou?
  const { count: seguroCount } = await sb
    .from("monthly_closing_entries")
    .select("*", { count: "exact", head: true })
    .eq("year", year).eq("month", month).eq("entry_type", "INSURANCE").eq("sheet_name", "Seguro");
  const { count: entriesCount } = await sb
    .from("monthly_closing_entries")
    .select("*", { count: "exact", head: true })
    .eq("year", year).eq("month", month);

  console.log(`\n=== DRY-RUN debito automatico de seguro — ${competencia} (NAO GRAVA) ===\n`);
  console.log(`  monthly_closing_entries em ${competencia}: ${entriesCount ?? 0} (aba Seguro: ${seguroCount ?? 0})`);

  if (!seguroCount) {
    console.log(`\n  >> O fechamento RR de ${competencia} AINDA NAO FOI IMPORTADO (nenhuma linha da aba Seguro).`);
    console.log(`     Nao ha o que processar. O fluxo esta PRONTO: assim que o fechamento entrar pela tela`);
    console.log(`     de import, o tipo A roda sozinho (a trava so libera de ${"2026-07"} em diante).`);
    console.log(`     Para conferir antes de gravar, rode este mesmo script depois do import.\n`);
    process.exit(0);
  }

  const plan = await resolver.resolveInsuranceDebits(sb, { year, month, dryRun: true });
  const ruleDb = plan.rule || {};
  const thrDb = Number(ruleDb.threshold ?? 100);

  console.log(`  regra vigente no BANCO: ${JSON.stringify(ruleDb)}`);
  console.log(`  regra PROPOSTA (SQL do threshold): PER_OPERATION threshold=${THRESHOLD_PROPOSTO} above=0.8 below=1.0\n`);
  console.log(`  estornos CANCELADOS: ${plan.totals.individuais + plan.totals.fila}`);
  console.log(`     resolvem individual: ${plan.totals.individuais}  (soma estornos ${brl(plan.totals.somaIndividuais)})`);
  console.log(`     vao pra FILA (master): ${plan.totals.fila}  (soma estornos ${brl(plan.totals.somaFila)})`);

  const linhas = [];
  for (const d of plan.debits) for (const s of d.sources) linhas.push({ ...s, promoter: d.promoterName });
  linhas.sort((a, b) => b.estorno - a.estorno);

  const rotuloDb = ruleDb.mode === "PER_OPERATION" ? `banco thr=${thrDb}` : `banco ${ruleDb.mode ?? "sem regra"}`;
  console.log(`\n  --- INDIVIDUAIS (viram debito) ---`);
  console.log(`     operacao        | promotor                  | estorno   | desce (${rotuloDb}) | desce (proposto thr=${THRESHOLD_PROPOSTO})`);
  let somaDb = 0, somaProp = 0;
  for (const l of linhas) {
    const dbAmount = l.debitAmount;
    const propAmount = comThreshold(l.estorno, THRESHOLD_PROPOSTO);
    somaDb += dbAmount;
    somaProp += propAmount;
    const muda = Math.abs(dbAmount - propAmount) > 0.005 ? "  <-- muda" : "";
    console.log(
      `     ${String(l.operation).padEnd(15)} | ${String(l.promoter ?? "?").slice(0, 25).padEnd(25)} | ${brl(l.estorno).padStart(9)} | ${brl(dbAmount).padStart(19)} | ${brl(propAmount).padStart(12)}${muda}`
    );
  }
  console.log(`     ${"".padEnd(15)} | ${"TOTAL".padEnd(25)} | ${brl(plan.totals.somaIndividuais).padStart(9)} | ${brl(somaDb).padStart(19)} | ${brl(somaProp).padStart(12)}`);

  if (plan.fila.length) {
    console.log(`\n  --- FILA (MASTER, sem dono — Diego atribui na tela) ---`);
    for (const f of plan.fila) {
      console.log(`     ${String(f.operation).padEnd(15)} | chaveJ=${String(f.chaveJ ?? "-").padEnd(12)} | estorno ${brl(f.estorno)}`);
    }
  }
  for (const a of plan.avisos) console.log(`\n  AVISO: ${a}`);
  console.log(`\n  (dry-run: nada gravado)\n`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
