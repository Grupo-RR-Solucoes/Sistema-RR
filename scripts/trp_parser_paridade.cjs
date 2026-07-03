#!/usr/bin/env node
/**
 * scripts/trp_parser_paridade.cjs — GATE do parser Node (F6a), read-only.
 *
 * Roda lib/trp/parseTrpPdf.ts (unpdf) sobre os 3 PDFs históricos (TRP35/36/37) e
 * prova que os VALORES de pct extraídos batem 195/195 × 3 com os JSONs canônicos
 * (regras_promotiva/json). É o gate corrigido (aprovado): o parser prova os
 * percentuais (comissão correta); a estrutura curada à mão da Etapa 2 (prazo do
 * CONSIG_PRIVADO, nomes de array, observações) NÃO entra — é finalizada na
 * revisão/diff da tela (F6b).
 *
 * EXIT 0 só com 195/195 em cada PDF. Qualquer valor divergente -> lista
 * produto/índice/esperado/obtido e exit 1.
 * Uso: node scripts/trp_parser_paridade.cjs
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
const JSON_DIR = path.join(ROOT, "regras_promotiva", "json");

// PDF histórico + JSON canônico correspondente.
const CASOS = [
  {
    pdf: path.join(ROOT, "stress_test_workspace_local", "pdfs_trps_2024_2026", "TRPs_Promotiva_2024-2026", "TRP35_2026-04.pdf"),
    canon: "TRP35_2026-04.json",
    label: "TRP35_2026-04",
  },
  { pdf: path.join(ROOT, "TRP36 - PROMOTIVA 052026.pdf"), canon: "TRP36_2026-05.json", label: "TRP36_2026-05" },
  { pdf: path.join(ROOT, "TRP37 - PROMOTIVA 062026.pdf"), canon: "TRP37_2026-06.json", label: "TRP37_2026-06" },
];

const FAIXA_KEYS = ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5", "pct_geral"];

// valores de pct do JSON canônico, achatados na ordem célula×faixa (+ pct_geral de produto).
function canonVals(prod) {
  const cellKey = ["celulas_taxa", "celulas_prazo", "celulas_taxa_prazo", "celulas"].find((c) => prod[c]);
  const out = [];
  if (cellKey) {
    for (const cel of prod[cellKey]) for (const k of FAIXA_KEYS) if (cel[k] !== undefined) out.push(cel[k]);
  }
  if (prod.pct_geral !== undefined && !cellKey) out.push(prod.pct_geral);
  return out;
}

function loadParser() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".trp-parser-out-"));
  process.on("exit", () => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_e) {} });
  const tsconfig = {
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true,
      resolveJsonModule: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false, declaration: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: [path.join(ROOT, "lib/trp/parseTrpPdf.ts"), path.join(ROOT, "lib/trp/vigencia.ts")],
  };
  const cfg = path.join(OUT, "tsconfig.json");
  fs.writeFileSync(cfg, JSON.stringify(tsconfig));
  try { execSync(`npx tsc -p "${cfg}"`, { cwd: ROOT, stdio: "inherit" }); } catch (_e) {}
  if (!fs.existsSync(path.join(OUT, "lib/trp/parseTrpPdf.js"))) throw new Error("tsc não emitiu parseTrpPdf.js");
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    if (req.startsWith("@/")) req = path.join(OUT, req.slice(2));
    return orig.call(this, req, ...rest);
  };
  return require(path.join(OUT, "lib/trp/parseTrpPdf.js"));
}

async function main() {
  const parser = loadParser();
  let totalDiv = 0;

  for (const caso of CASOS) {
    if (!fs.existsSync(caso.pdf)) { console.log(`\n${caso.label}: PDF não encontrado (${caso.pdf}) — PULADO`); totalDiv++; continue; }
    const data = new Uint8Array(fs.readFileSync(caso.pdf));
    const lines = await parser.extractLinesFromPdf(data);
    const produtos = parser.parseMatrix(lines);
    const canon = JSON.parse(fs.readFileSync(path.join(JSON_DIR, caso.canon), "utf8"));

    let vOK = 0, vTot = 0, prodOK = 0, prodTot = 0;
    const divs = [];
    for (const k of Object.keys(canon)) {
      if (k === "_meta") continue;
      prodTot++;
      const ext = produtos[k] ? produtos[k].rows.flat() : [];
      const can = canonVals(canon[k]);
      vTot += can.length;
      let same = ext.length === can.length;
      for (let i = 0; i < Math.max(ext.length, can.length); i++) {
        if (ext[i] === can[i]) vOK++;
        else { same = false; divs.push(`${k}[${i}] esperado=${can[i]} obtido=${ext[i]}`); }
      }
      if (same) prodOK++;
    }
    const pass = vOK === vTot && divs.length === 0;
    console.log(`\n===== ${caso.label} (linhas=${lines.length}) =====`);
    console.log(`  produtos idênticos: ${prodOK}/${prodTot} | valores de pct: ${vOK}/${vTot} ${pass ? "✓" : "✗"}`);
    for (const d of divs.slice(0, 20)) console.log(`   DIVERGE ${d}`);
    if (!pass) totalDiv++;
  }

  console.log("\n========================================");
  console.log(`GATE parser (195 valores × 3 PDFs): ${totalDiv === 0 ? "PASSOU — 195/195 × 3, 0 divergências" : `FALHOU (${totalDiv} PDF com divergência)`}`);
  console.log("========================================");
  process.exit(totalDiv === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
