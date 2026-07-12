/**
 * scripts/motor_credito_trp_db_gate_lib.cjs — harness compartilhado do gate da frente
 * "motor de crédito lê TRP do DB". READ-ONLY.
 *
 * Compila os entry points REAIS de produção (closingAnalytics, bbtsMonthly, motor,
 * creditTrpProvider) e os roda duas vezes trocando SÓ a env TRP_SOURCE. Nenhuma lógica
 * de cálculo é reimplementada aqui: o que roda é o código de produção.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
const EPS = 1e-9;

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

let CACHED = null;
function loadRepoLib() {
  if (CACHED) return CACHED;
  const OUT = fs.mkdtempSync(path.join(ROOT, ".motor-trp-out-"));
  process.on("exit", () => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_e) {} });
  const tsconfig = {
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node",
      esModuleInterop: true, resolveJsonModule: true,
      allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false,
      declaration: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: [
      path.join(ROOT, "lib/closingAnalytics.ts"),
      path.join(ROOT, "lib/bbtsMonthly.ts"),
      path.join(ROOT, "lib/promoterAnalytics.ts"),
      path.join(ROOT, "lib/closingMonthly.ts"),
      path.join(ROOT, "lib/bbtsOrchestrator.ts"),
      path.join(ROOT, "lib/motor.ts"),
      path.join(ROOT, "lib/trp/creditTrpProvider.ts"),
      path.join(ROOT, "lib/trp/resolveTrpRegraDb.ts"),
      path.join(ROOT, "lib/regrasLoader.ts"),
      path.join(ROOT, "lib/regrasData.ts"),
      path.join(ROOT, "lib/supabaseAdmin.ts"),
    ],
  };
  const cfg = path.join(OUT, "tsconfig.gate.json");
  fs.writeFileSync(cfg, JSON.stringify(tsconfig));
  try {
    execSync(`npx tsc -p "${cfg}"`, { cwd: ROOT, stdio: "inherit" });
  } catch (_e) {
    // erros de TIPO não impedem emit (noEmitOnError:false); a checagem abaixo decide.
  }
  for (const alvo of ["lib/closingAnalytics.js", "lib/bbtsMonthly.js", "lib/promoterAnalytics.js", "lib/motor.js", "lib/trp/creditTrpProvider.js"]) {
    if (!fs.existsSync(path.join(OUT, alvo))) throw new Error(`tsc não emitiu ${alvo}`);
  }
  fs.cpSync(path.join(ROOT, "regras_promotiva/json"), path.join(OUT, "regras_promotiva/json"), { recursive: true });

  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/")) request = path.join(OUT, request.slice(2));
    return origResolve.call(this, request, ...rest);
  };

  CACHED = {
    closing: require(path.join(OUT, "lib/closingAnalytics.js")),
    bbts: require(path.join(OUT, "lib/bbtsMonthly.js")),
    promoter: require(path.join(OUT, "lib/promoterAnalytics.js")),
    closingMonthly: require(path.join(OUT, "lib/closingMonthly.js")),
    orq: require(path.join(OUT, "lib/bbtsOrchestrator.js")),
    motor: require(path.join(OUT, "lib/motor.js")),
    provider: require(path.join(OUT, "lib/trp/creditTrpProvider.js")),
  };
  return CACHED;
}

/** Roda fn() com TRP_SOURCE fixo, capturando (e silenciando) os warns de DRIFT do motor. */
async function comFonte(src, fn) {
  const antes = process.env.TRP_SOURCE;
  process.env.TRP_SOURCE = src;
  const drifts = [];
  const origWarn = console.warn;
  console.warn = (...args) => {
    const msg = args.map(String).join(" ");
    if (msg.includes("DRIFT")) drifts.push(msg);
    else origWarn(...args);
  };
  try {
    const out = await fn();
    return { out, drifts };
  } finally {
    console.warn = origWarn;
    if (antes === undefined) delete process.env.TRP_SOURCE;
    else process.env.TRP_SOURCE = antes;
  }
}

/** Deep-diff JSON. Devolve caminhos divergentes (números com tolerância EPS). */
function deepDiff(a, b, base = "", acc = []) {
  if (acc.length >= 60) return acc;
  if (a === b) return acc;
  const ta = a === null ? "null" : Array.isArray(a) ? "array" : typeof a;
  const tb = b === null ? "null" : Array.isArray(b) ? "array" : typeof b;
  if (ta !== tb) { acc.push(`${base || "<root>"}: tipo ${ta} != ${tb}`); return acc; }
  if (ta === "number") {
    if (Math.abs(a - b) > EPS) acc.push(`${base}: ${a} != ${b} (Δ=${a - b})`);
    return acc;
  }
  if (ta === "array") {
    if (a.length !== b.length) { acc.push(`${base}: length ${a.length} != ${b.length}`); return acc; }
    for (let i = 0; i < a.length; i++) deepDiff(a[i], b[i], `${base}[${i}]`, acc);
    return acc;
  }
  if (ta === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      deepDiff(a[k], b[k], base ? `${base}.${k}` : k, acc);
    }
    return acc;
  }
  if (a !== b) acc.push(`${base}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  return acc;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const brl = (n) => Number(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

module.exports = { ROOT, EPS, loadEnv, loadRepoLib, comFonte, deepDiff, clone, brl };
