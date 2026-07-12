#!/usr/bin/env node
/**
 * scripts/forecast_recongelar_dryrun.cjs — READ-ONLY (dryRun). NÃO grava nada.
 *
 * Prova o conserto do vintage jun/2026 ANTES de mexer no banco:
 *   1. mostra o que está GRAVADO hoje em previsao_snapshot (SELECT de conferência);
 *   2. roda congelarPrevisao em DRY-RUN e mostra o que o RECONGELAMENTO produziria;
 *   3. confronta linha a linha: o único delta esperado é previsto_diferido saindo de
 *      NULL para o valor real. previsto_prt / previsto_avista devem BATER com o
 *      gravado — se mudarem, o recongelamento não é um conserto, é outra curva, e
 *      isso precisa aparecer.
 *   4. exibe o aviso anti-silêncio (vintage já existia / incompleto).
 *
 * Uso: TRP_SOURCE=db node scripts/forecast_recongelar_dryrun.cjs
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
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

function loadLib() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".fc-out-"));
  process.on("exit", () => {
    try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_e) {}
  });
  const cfg = path.join(OUT, "tsconfig.json");
  fs.writeFileSync(
    cfg,
    JSON.stringify({
      compilerOptions: {
        target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true,
        resolveJsonModule: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
        skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false,
        typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
        baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
      },
      include: [path.join(ROOT, "lib/recebiveis/congelarPrevisao.ts")],
    })
  );
  try { execSync(`npx tsc -p "${cfg}"`, { cwd: ROOT, stdio: "pipe" }); } catch (_e) {}
  const alvo = path.join(OUT, "lib/recebiveis/congelarPrevisao.js");
  if (!fs.existsSync(alvo)) throw new Error("tsc nao emitiu congelarPrevisao.js");
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (r, ...a) {
    if (r.startsWith("@/")) r = path.join(OUT, r.slice(2));
    return orig.call(this, r, ...a);
  };
  return require(alvo);
}

const n = (v) => (v === null || v === undefined ? "     null" : Number(v).toFixed(2).padStart(10));

(async () => {
  const lib = loadLib();
  console.log(`\nTRP_SOURCE: ${process.env.TRP_SOURCE || "(vazio -> json)"}`);

  // 1. O que esta GRAVADO hoje.
  const { data: gravado } = await sb
    .from("previsao_snapshot")
    .select("competencia_snapshot, competencia_alvo, previsto_prt, previsto_avista, previsto_diferido")
    .eq("competencia_snapshot", "2026-06")
    .order("competencia_alvo", { ascending: true });

  console.log(`\n=== 1) GRAVADO hoje (vintage 2026-06): ${gravado.length} linha(s) ===`);
  const semDiferido = gravado.filter((r) => r.previsto_diferido === null).length;
  console.log(`    previsto_diferido NULL em ${semDiferido}/${gravado.length} linhas`);

  // 2. O que o RECONGELAMENTO produziria (dry-run, nao grava).
  const res = await lib.congelarPrevisao(sb, { dryRun: true });
  console.log(`\n=== 2) DRY-RUN do recongelamento (vintage ${res.competenciaSnapshot}) ===`);
  console.log(`    dryRun=${res.dryRun} | linhasGravadas=${res.linhasGravadas} | linhasProjetadas=${res.linhasProjetadas}`);
  console.log(`    vintageJaExistia=${res.vintageJaExistia} | vintageIncompleto=${res.vintageIncompleto} | descartadas=${res.linhasDescartadas}`);
  console.log("\n    --- AVISO ANTI-SILENCIO ---");
  for (const a of res.avisos) console.log(`    > ${a}`);

  // 3. Confronto linha a linha.
  const novasPorAlvo = new Map(res.linhas.map((r) => [r.competencia_alvo, r]));
  console.log(`\n=== 3) CONFRONTO (gravado x recongelado) ===`);
  console.log("    alvo    |  prt GRAVADO | prt NOVO   |  avista GRAV | avista NOVO |  dif GRAVADO | dif NOVO");
  let deltaPrt = 0, deltaAvista = 0, difPreenchidos = 0;
  for (const g of gravado) {
    const nv = novasPorAlvo.get(g.competencia_alvo);
    if (!nv) { console.log(`    ${g.competencia_alvo} | (alvo sumiu do recalculo)`); continue; }
    const dPrt = Math.abs(Number(g.previsto_prt ?? 0) - Number(nv.previsto_prt ?? 0));
    const dAv = Math.abs(Number(g.previsto_avista ?? 0) - Number(nv.previsto_avista ?? 0));
    if (dPrt > 0.005) deltaPrt++;
    if (dAv > 0.005) deltaAvista++;
    if (g.previsto_diferido === null && nv.previsto_diferido !== null) difPreenchidos++;
    const flag = dPrt > 0.005 || dAv > 0.005 ? "  <-- MUDOU (nao e so o diferido!)" : "";
    console.log(
      `    ${g.competencia_alvo} | ${n(g.previsto_prt)} | ${n(nv.previsto_prt)} | ${n(g.previsto_avista)} | ${n(nv.previsto_avista)} | ${n(g.previsto_diferido)} | ${n(nv.previsto_diferido)}${flag}`
    );
  }
  const alvosNovos = res.linhas.filter((r) => !gravado.some((g) => g.competencia_alvo === r.competencia_alvo));

  console.log(`\n=== VEREDITO ===`);
  console.log(`    previsto_prt    : ${deltaPrt === 0 ? "IDENTICO ao gravado (0 divergencias)" : `MUDOU em ${deltaPrt} linha(s)`}`);
  console.log(`    previsto_avista : ${deltaAvista === 0 ? "IDENTICO ao gravado (0 divergencias)" : `MUDOU em ${deltaAvista} linha(s)`}`);
  console.log(`    previsto_diferido: sai de NULL para valor real em ${difPreenchidos}/${gravado.length} linha(s)`);
  console.log(`    alvos NOVOS que o vintage gravado nao tinha: ${alvosNovos.length}${alvosNovos.length ? ` (${alvosNovos.slice(0, 5).map((r) => r.competencia_alvo).join(", ")}${alvosNovos.length > 5 ? ", ..." : ""})` : ""}`);
  const ok = deltaPrt === 0 && deltaAvista === 0 && difPreenchidos > 0;
  console.log(`\n    ${ok ? "CONSERTO LIMPO: o unico delta e o diferido saindo de NULL." : "ATENCAO: o recongelamento muda mais que o diferido — conferir antes de apagar o vintage."}`);
  console.log("\n    (dry-run: nada gravado)\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
