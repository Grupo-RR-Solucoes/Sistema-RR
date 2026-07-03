#!/usr/bin/env node
/**
 * scripts/trp_parse_route_test.cjs — teste da SUB-FASE 1 (F6b), read-only.
 *
 * Exercita buildTrpDraft (a lógica pura da rota /api/trp/parse) SEM auth/DB:
 *  (1) TRP37 válido -> draft com 195 pct provados + validações passando.
 *  (2) PDF inválido/aleatório -> erro claro (TrpParseError), sem draft.
 * NÃO grava nada. EXIT 0 só se ambos os casos derem o esperado.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
const TRP37 = path.join(ROOT, "TRP37 - PROMOTIVA 062026.pdf");

function loadLib() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".trp-draft-out-"));
  process.on("exit", () => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_e) {} });
  const tsconfig = {
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true,
      resolveJsonModule: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false, declaration: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: [
      path.join(ROOT, "lib/trp/parseTrpDraft.ts"),
      path.join(ROOT, "lib/trp/parseTrpPdf.ts"),
      path.join(ROOT, "lib/trp/vigencia.ts"),
    ],
  };
  const cfg = path.join(OUT, "tsconfig.json");
  fs.writeFileSync(cfg, JSON.stringify(tsconfig));
  try { execSync(`npx tsc -p "${cfg}"`, { cwd: ROOT, stdio: "inherit" }); } catch (_e) {}
  if (!fs.existsSync(path.join(OUT, "lib/trp/parseTrpDraft.js"))) throw new Error("tsc não emitiu parseTrpDraft.js");
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    if (req.startsWith("@/")) req = path.join(OUT, req.slice(2));
    return orig.call(this, req, ...rest);
  };
  return require(path.join(OUT, "lib/trp/parseTrpDraft.js"));
}

let pass = 0, fail = 0;
function ok(label, cond, extra) { if (cond) { pass++; console.log(`  OK  ${label}${extra ? " — " + extra : ""}`); } else { fail++; console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); } }

async function main() {
  const lib = loadLib();

  console.log("== (1) TRP37 válido ==");
  const bytes = new Uint8Array(fs.readFileSync(TRP37));
  let draft = null, err1 = null;
  try { draft = await lib.buildTrpDraft(bytes, { competencia: "2026-06", sourceFilename: "TRP37 - PROMOTIVA 062026.pdf", sha256: "deadbeef" }); }
  catch (e) { err1 = e; }
  ok("não lançou (validações passaram)", err1 === null, err1 ? err1.message : "");
  if (draft) {
    ok("totalPct provado = 195", draft.confianca.provado.totalPct === 195, "total=" + draft.confianca.provado.totalPct);
    ok("11 produtos no draft", Object.keys(draft.regraDraft).filter((k) => k !== "_meta").length === 11);
    ok("_meta competência/vigência/regime", draft.meta.competencia === "2026-06" && draft.meta.vigencia_inicio === "2026-05-29" && draft.meta.vigencia_fim === "2026-06-29" && draft.meta.regime === "VOLUME_5_FAIXAS",
      `${draft.meta.competencia} ${draft.meta.vigencia_inicio}..${draft.meta.vigencia_fim} ${draft.meta.regime}`);
    ok("meta carrega sha256 + parser_version", draft.meta.sha256 === "deadbeef" && !!draft.meta.parser_version, "parser=" + draft.meta.parser_version);
    ok("itens 'conferir' presentes (estrutura)", draft.confianca.conferir.length > 0, draft.confianca.conferir.length + " itens");
    ok("CONSIG_PRIVADO marcado conferir (prazo à mão)", draft.confianca.conferir.some((c) => c.produto === "CONSIG_PRIVADO" && /prazo/.test(c.campo)));
  }

  console.log("== (2) PDF inválido/aleatório ==");
  const lixo = new Uint8Array(Buffer.from("isto nao e um PDF, so texto aleatorio ".repeat(20)));
  let draft2 = null, err2 = null;
  try { draft2 = await lib.buildTrpDraft(lixo, { competencia: "2026-06" }); }
  catch (e) { err2 = e; }
  ok("lançou erro (não retornou draft)", err2 !== null && draft2 === null);
  ok("é TrpParseError (falha clara)", err2 && err2.name === "TrpParseError", err2 ? `${err2.name}: ${err2.message}` : "");

  console.log("== (3) competência inválida -> TrpValidationError ==");
  let err3 = null;
  try { await lib.buildTrpDraft(bytes, { competencia: "1999-13" }); } catch (e) { err3 = e; }
  ok("rejeita competência absurda", err3 && err3.name === "TrpValidationError", err3 ? err3.message : "");

  console.log(`\nTESTE SUB-FASE 1: ${pass} OK / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
