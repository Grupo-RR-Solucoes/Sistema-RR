#!/usr/bin/env node
// ============================================================================
// run_all_gates.cjs — RUNNER dos gates de regressao.
//
// Por padrao roda SO os gates SELF-CONTAINED (sem banco, sem arquivo fora do
// repo). E o modo que o CI usa: qualquer maquina com o repo clonado reproduz.
// Os demais sao PULADOS com motivo nominal e NAO influenciam o exit code -
// pular nao pode reprovar, senao o CI fica vermelho por algo que ele nunca
// teve como rodar.
//
//   node scripts/run_all_gates.cjs          -> so os self-contained (CI)
//   node scripts/run_all_gates.cjs --full   -> TODOS (local, exige .env.local
//                                              e os PDFs da TRP em disco)
//
// Exit: 0 = todos os gates EXECUTADOS passaram. 1 = algum falhou.
//       Pulados nunca reprovam.
//
// ---------------------------------------------------------------------------
// REGISTRO EXPLICITO, NAO GLOB
// ---------------------------------------------------------------------------
// Varrer scripts/*_gate.cjs pegaria os 29 gates do repo, e a maioria le o banco
// de PRODUCAO. Um glob transformaria o CI num cliente do banco vivo. Cada gate
// entra aqui a mao, com o motivo da classificacao escrito.
//
// COMO CLASSIFICAR UM GATE NOVO:
//   self-contained  -> nao chama createClient E nao le caminho absoluto/fora do
//                      repo. Entra no CI de graca.
//   needs-db        -> chama createClient. NUNCA vai pro CI: exigiria a service
//                      role de producao num runner publico.
//   needs-local     -> le arquivo que nao esta versionado (ex.: PDF no
//                      Downloads). So vira CI-avel quando a entrada entrar no
//                      repo (ou virar fixture).
// ============================================================================

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const FULL = process.argv.includes("--full");

const GATES = [
  {
    arquivo: "scripts/tiquete_min_regua_gate.cjs",
    nome: "tiquete_min (regua x hardcode)",
    modo: "self-contained",
    motivo:
      "le regras_promotiva/json (49 JSONs versionados) + lib/motor.ts; sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/venda_propria_gestao_gate.cjs",
    nome: "venda propria de gestao (no-op + isolamento do PMR)",
    modo: "self-contained",
    motivo:
      "monta um Supabase falso em memoria e roda as funcoes reais do repo; sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/paridade_avista_trp_gate.cjs",
    nome: "paridade a-vista TRP (previsto x motor)",
    modo: "needs-db",
    motivo:
      "createClient + daily_production_records de PRODUCAO; exigiria service role no runner",
  },
  {
    arquivo: "scripts/trp_parser_escalares_gate.cjs",
    nome: "parser TRP - escalares de categoria",
    modo: "needs-local",
    motivo:
      "le 3 PDFs de C:/Users/diego/Downloads; o repo tem 0 PDFs versionados",
  },
];

const SELF = GATES.filter((g) => g.modo === "self-contained");
const OUTROS = GATES.filter((g) => g.modo !== "self-contained");
const aRodar = FULL ? GATES : SELF;
const aPular = FULL ? [] : OUTROS;

const linha = (c) => c.repeat(74);
console.log(linha("="));
console.log("RUNNER DE GATES" + (FULL ? "  [--full: inclui banco e arquivos locais]" : "  [self-contained]"));
console.log(linha("="));

const resultados = [];
for (const g of aRodar) {
  const abs = path.join(ROOT, g.arquivo);
  if (!fs.existsSync(abs)) {
    console.log("\n>>> " + g.nome + "\n    ARQUIVO AUSENTE: " + g.arquivo);
    resultados.push({ ...g, status: "AUSENTE", code: null });
    continue;
  }
  console.log("\n>>> " + g.nome + "  (" + g.arquivo + ")");
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [abs], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
  const code = r.status;
  resultados.push({
    ...g,
    status: code === 0 ? "PASSOU" : "FALHOU",
    code,
    ms,
  });
}

console.log("\n" + linha("="));
console.log("RESUMO");
console.log(linha("="));

for (const r of resultados) {
  const tag = r.status === "PASSOU" ? "PASSOU " : r.status === "FALHOU" ? "FALHOU " : "AUSENTE";
  const extra =
    r.status === "FALHOU" ? "  (exit " + r.code + ")" : r.ms != null ? "  (" + r.ms + "ms)" : "";
  console.log("  " + tag + " | " + r.nome + extra);
}
for (const g of aPular) {
  console.log("  PULADO  | " + g.nome);
  console.log("          | motivo: " + g.motivo);
}

const falhas = resultados.filter((r) => r.status !== "PASSOU");
console.log(linha("-"));
console.log(
  "  executados: " + resultados.length +
  " | passaram: " + resultados.filter((r) => r.status === "PASSOU").length +
  " | falharam: " + falhas.length +
  " | pulados: " + aPular.length
);

if (aPular.length > 0) {
  console.log(
    "\n  " + aPular.length + " gate(s) PULADO(S) — nao rodam em CI e NAO reprovam aqui."
  );
  console.log("  Para roda-los nesta maquina: npm run gates:full");
  console.log("  (exige .env.local com a service role e os PDFs da TRP em disco)");
}

if (falhas.length > 0) {
  console.log("\n  RESULTADO: FALHOU — " + falhas.map((f) => f.nome).join(", "));
  process.exit(1);
}
console.log("\n  RESULTADO: OK — todos os gates executados passaram.");
process.exit(0);
