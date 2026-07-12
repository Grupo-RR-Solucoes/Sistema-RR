/*
 * Loader CommonJS para require(*.ts) com resolucao do alias "@/...".
 * Permite que os runners de execucao (import/PMR) chamem a LIB REAL
 * (lib/cmsImport.ts, lib/cmsMonthly.ts), sem duplicar logica — garante que o
 * que roda aqui e identico ao que a rota Next executa.
 *
 * Tambem carrega .env para process.env (Supabase service role).
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");

// .env -> process.env
// PRECEDÊNCIA (igual ao Next.js): env do shell > .env.local > .env. Por isso o
// .env.local é lido PRIMEIRO e o guard !process.env[...] impede o .env de
// sobrescrever. (Ordem inversa fazia a chave LEGADA/JWT desativada do .env vencer
// a sb_secret_ do .env.local -> "Legacy API keys are disabled" em qualquer script.)
for (const file of [".env.local", ".env"]) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// resolve "@/x" -> <root>/x
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    request = path.join(ROOT, request.slice(2));
  }
  return origResolve.call(this, request, parent, isMain, options);
};

// transpila .ts on-the-fly para CommonJS
require.extensions[".ts"] = function (module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
    fileName: filename,
  });
  module._compile(out.outputText, filename);
};

module.exports = { ROOT };
