// ============================================================================
// gate_teto_avista_rr.ts — GATE da divida latente 1 (teto a-vista 5,80%).
// Offline (nao toca o banco). Importa o MODULO REAL via _ts_register — nao uma
// copia transpilada a mao — entao o que passa aqui e o que roda em producao.
//
// Prova:
//   G1. Teto resolvido == 0.058 em TODA competencia viva (e no "CORRENTE").
//   G2. Cap novo == literal antigo, valor a valor, nos dois dialetos
//       (decimal 0.058 e percentual 5.8), bordas inclusas.
//   G3. Classificador novo == os DOIS literais antigos (0.058-0.00001 em
//       decimal e 5.8-0.001 em percentual), valor a valor.
//   G4. Nenhum literal de teto RR sobrou solto no codigo dos 5 arquivos.
//   G5. O teto da EMPRESA (6%) segue INTOCADO.
//
// Roda:
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/gate_teto_avista_rr.ts')"
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import {
  tetoAvistaRR,
  tetoAvistaRRPercent,
  capAvistaRR,
  capAvistaRRPercent,
  isFaixaTetoAvistaRR,
  isFaixaTetoAvistaRRPercent,
  tetoAvistaRRSnapshots,
} from "@/lib/tetoAvistaRR.ts";

const ROOT = path.resolve(__dirname, "..");
let falhas = 0;
const ok = (m: string) => console.log("  OK   " + m);
const fail = (m: string) => { console.log("  FALHA " + m); falhas++; };

// ---------- G1 ----------
console.log("\n=== G1. Teto resolvido == 0.058 em toda competencia viva ===");
let g1 = true;
let comps = 0;
for (let y = 2022; y <= 2027; y++) {
  for (let m = 1; m <= 12; m++) {
    comps++;
    if (tetoAvistaRR({ year: y, month: m }) !== 0.058) {
      fail("teto != 0.058 em " + y + "-" + m); g1 = false;
    }
    if (tetoAvistaRRPercent({ year: y, month: m }) !== 5.8) {
      fail("tetoPercent != 5.8 em " + y + "-" + m); g1 = false;
    }
  }
}
if (tetoAvistaRR("CORRENTE") !== 0.058) { fail('teto != 0.058 em "CORRENTE"'); g1 = false; }
if (tetoAvistaRRPercent("CORRENTE") !== 5.8) { fail('tetoPercent != 5.8 em "CORRENTE"'); g1 = false; }
if (g1) ok("2022-01..2027-12 (" + comps + " competencias) + CORRENTE: 0.058 / 5.8");
console.log("  snapshots: " + JSON.stringify(tetoAvistaRRSnapshots()));

// ---------- G2 ----------
console.log("\n=== G2. Cap novo == literal antigo, valor a valor ===");
const capAntigoDecimal = (v: number) => Math.min(Math.max(v, 0), 0.058);
const capAntigoPercent = (v: number) => Math.min(Math.max(v, 0), 5.8);
let difDec = 0, difPct = 0, n = 0;
for (let i = -2000; i <= 12000; i++) {
  const dec = i / 100000;
  const pct = i / 1000;
  n++;
  if (capAvistaRR(dec, { year: 2026, month: 7 }) !== capAntigoDecimal(dec)) difDec++;
  if (capAvistaRRPercent(pct, { year: 2026, month: 7 }) !== capAntigoPercent(pct)) difPct++;
}
for (const v of [0.058, 0.0579999, 0.0580001, 0, -1, 0.06]) {
  n++;
  if (capAvistaRR(v, "CORRENTE") !== capAntigoDecimal(v)) difDec++;
}
for (const v of [5.8, 5.7999, 5.8001, 0, -1, 6]) {
  if (capAvistaRRPercent(v, "CORRENTE") !== capAntigoPercent(v)) difPct++;
}
if (difDec === 0) ok("dialeto DECIMAL: " + n + " valores, 0 divergencia");
else fail("dialeto DECIMAL: " + difDec + " divergencias");
if (difPct === 0) ok("dialeto PERCENTUAL: " + n + " valores, 0 divergencia");
else fail("dialeto PERCENTUAL: " + difPct + " divergencias");

// ---------- G3 ----------
console.log("\n=== G3. Classificador novo == os DOIS literais antigos ===");
const faixaAntigaClosing = (v: number) => v >= 0.058 - 0.00001;
const faixaAntigaProposal = (v: number) => v >= 5.8 - 0.001;
let difC = 0, difP = 0;
for (let i = -2000; i <= 12000; i++) {
  const dec = i / 100000;
  const pct = i / 1000;
  if (isFaixaTetoAvistaRR(dec, { year: 2026, month: 6 }) !== faixaAntigaClosing(dec)) difC++;
  if (isFaixaTetoAvistaRRPercent(pct, { year: 2026, month: 6 }) !== faixaAntigaProposal(pct)) difP++;
}
for (const v of [0.05799, 0.057991, 0.058, 0.0579899]) {
  if (isFaixaTetoAvistaRR(v, "CORRENTE") !== faixaAntigaClosing(v)) difC++;
}
for (const v of [5.799, 5.7991, 5.8, 5.7989]) {
  if (isFaixaTetoAvistaRRPercent(v, "CORRENTE") !== faixaAntigaProposal(v)) difP++;
}
if (difC === 0) ok("closingMonthly (0.058-0.00001): 0 divergencia");
else fail("closingMonthly: " + difC + " divergencias");
if (difP === 0) ok("proposalDetailing (5.8-0.001): 0 divergencia");
else fail("proposalDetailing: " + difP + " divergencias");
if (difC === 0 && difP === 0) {
  ok("confirmado: os dois epsilons eram EQUIVALENTES (1e-5 decimal == 1e-3 percentual)");
}

// ---------- G4 ----------
console.log("\n=== G4. Nenhum literal de teto RR solto ===");
for (const f of [
  "lib/bbtsMonthly.ts",
  "lib/closingMonthly.ts",
  "lib/proposalDetailing.ts",
  "lib/promoterAnalytics.ts",
]) {
  const s = fs.readFileSync(path.join(ROOT, f), "utf8");
  // so linhas de CODIGO — comentario cita o valor de proposito.
  const codigo = s.split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const achados = codigo.match(/(?<![\d.])(?:0\.058|5\.8)(?![\d])/g) || [];
  if (achados.length === 0) ok(f + " — sem literal de teto no codigo");
  else fail(f + " — ainda tem literal: " + achados.join(", "));
}

// ---------- G5 ----------
console.log("\n=== G5. Teto da EMPRESA (6%) intocado ===");
const motor = fs.readFileSync(path.join(ROOT, "lib/motor.ts"), "utf8");
if (!/tetoAvistaRR/.test(motor)) ok("lib/motor.ts NAO importa a fonte do teto RR");
else fail("lib/motor.ts passou a importar tetoAvistaRR — conceitos misturados");
if (/cashCapPercent/.test(motor)) ok("motor segue no cashCapPercent (teto Promotiva 6%)");
else fail("motor perdeu o cashCapPercent");
// A COMPARACAO DE BRANCH FALHA QUANDO NAO PODE SER FEITA.
//
// Ate 18/08/2026 este bloco engolia o erro do git num catch que so imprimia
// "(git diff indisponivel)" e seguia — sem chamar fail(). No CI isso era
// silencioso e permanente: actions/checkout@v4 usa fetch-depth: 1 por padrao,
// `origin/main` nao vira ref no runner, o execFileSync lanca, e o gate imprimia
// "GATE PASSOU (no-op provado)" tendo verificado ZERO sobre lib/motor.ts. Verde
// que nao mediu nada — a mesma familia da vw_team_production que devolve 0
// linhas para service_role e do gate de PDF que se declara pulado sem PDF.
//
// AUSENCIA DE MEDICAO NAO E APROVACAO. Se a ref nao resolve, isto REPROVA, e a
// mensagem diz que a comparacao nao aconteceu — nunca que esta tudo certo.
// O conserto do outro lado (fetch-depth: 0) esta em .github/workflows/gates.yml.
const REF_BASE = "origin/main";
const ARQUIVOS_INTOCADOS = ["lib/promotivaCashPolicy.ts", "lib/motor.ts"];
{
  let diff: string[] | null = null;
  let erroGit = "";
  try {
    diff = execFileSync("git", ["diff", "--name-only", REF_BASE + "...HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).split(/\r?\n/);
  } catch (e) {
    const err = e as { message?: string; stderr?: string };
    erroGit = String(err.stderr || err.message || e).trim().split(/\r?\n/)[0];
  }

  if (diff === null) {
    fail(
      "COMPARACAO DE BRANCH NAO REALIZADA — a ref '" + REF_BASE + "' nao resolve " +
      "neste checkout. NAO foi verificado se " + ARQUIVOS_INTOCADOS.join(" e ") +
      " mudaram; este bloco nao mediu nada e por isso REPROVA. Isto NAO significa " +
      "que os arquivos estao intactos. Causa tipica: checkout raso " +
      "(actions/checkout com fetch-depth: 1) — use fetch-depth: 0. git: " + erroGit
    );
  } else {
    for (const f of ARQUIVOS_INTOCADOS) {
      if (!diff.includes(f)) ok(f + " NAO foi alterado na branch (vs " + REF_BASE + ")");
      else fail(f + " foi alterado (vs " + REF_BASE + ")");
    }
  }
}

console.log("\n=== RESULTADO: " +
  (falhas === 0 ? "GATE PASSOU (no-op provado)" : falhas + " FALHA(S)") + " ===");
process.exit(falhas === 0 ? 0 : 1);
