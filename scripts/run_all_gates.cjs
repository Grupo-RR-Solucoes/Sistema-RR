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
    arquivo: "scripts/no_brand_hardcoded_gate.cjs",
    nome: "marca institucional so na barra (FASE 4)",
    modo: "self-contained",
    motivo:
      "le os .ts/.tsx/.js de app, components e lib do proprio repo; sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/paridade_avista_trp_gate.cjs",
    nome: "paridade a-vista TRP (previsto x motor)",
    modo: "needs-db",
    motivo:
      "createClient + daily_production_records de PRODUCAO; exigiria service role no runner",
  },
  {
    arquivo: "scripts/gate-competencia-janela.cjs",
    nome: "competencia por janela de producao (volume da escala / Frente C)",
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
  // PRIMEIRO gate .ts/.mts do registro. So foi possivel depois que o runner
  // aprendeu a invocar TypeScript (ver comoInvocar). Ate 01/08/2026 ele so
  // rodava quando alguem digitava o caminho a mao — e prova a regua de
  // lideranca que entra em vigor na competencia 2026-08.
  // Os outros 15 .ts/.mts NAO entram aqui nesta fase: a classificacao dos 68
  // e decisao do Diego (FASE 2).
  {
    arquivo: "scripts/gate_remuneracao_lideranca.mts",
    nome: "remuneracao de lideranca (regua versionada, 2 regimes)",
    modo: "needs-db",
    motivo:
      "createClient + monthly_closing_entries/daily/leadership_rule_versions de PRODUCAO; exigiria service role no runner",
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

// ---------------------------------------------------------------------------
// COBERTURA DA TIPAGEM — gate rastreado que ficou de fora do tsconfig.gates
// ---------------------------------------------------------------------------
// O tsconfig.gates.json usa include EXPLICITO de proposito: um glob varreria o
// SISTEMA DE ARQUIVOS e pegaria os ~72 scratch untracked, reintroduzindo o
// problema de 27/06/2026 que pos scripts/ no exclude do build.
//
// O preco disso e que a lista NAO se atualiza sozinha: um gate novo fica sem
// tipagem ate alguem lembrar de acrescenta-lo. E exatamente esse esquecimento
// que deixou o gate_projecao_gestor MORTO por TypeError sem ninguem notar.
// Este bloco cobra o esquecimento em vez de confiar na memoria.
//
// FONTE DA VERDADE = git ls-files (nao o filesystem): so arquivo RASTREADO
// entra na conta, entao scratch untracked nunca reprova ninguem.
//
// SO .ts/.mts: .cjs nao e tipado pelo tsc aqui (checkJs esta desligado), entao
// exigir um .cjs no include seria pedir uma entrada que nao verifica nada.
const PREFIXOS_QUE_ASSEREM = ["gate", "golden", "test_"];
let coberturaFalhou = false;
{
  const r = spawnSync("git", ["ls-files", "scripts/"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    console.log("\n>>> COBERTURA DA TIPAGEM DOS GATES");
    console.log("    PULADO: `git ls-files` indisponivel (" + String(r.stderr || "").trim() + ")");
    console.log("    Sem git nao da para distinguir rastreado de scratch — nao reprovo por isso.");
  } else {
    const rastreados = r.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((f) => /\.(ts|mts)$/.test(f));

    const querTipagem = rastreados.filter((f) => {
      const base = path.basename(f);
      return PREFIXOS_QUE_ASSEREM.some((p) => base.startsWith(p));
    });

    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "tsconfig.gates.json"), "utf8"));
    const noInclude = new Set((cfg.include || []).map((s) => s.replace(/\\/g, "/")));
    const foraDoInclude = querTipagem.filter((f) => !noInclude.has(f.replace(/\\/g, "/")));
    // O inverso tambem e defeito: include apontando para arquivo que sumiu faz
    // o tsc silenciar sem avisar que perdeu cobertura.
    const inexistentes = [...noInclude].filter((f) => !fs.existsSync(path.join(ROOT, f)));

    console.log("\n>>> COBERTURA DA TIPAGEM DOS GATES  (tsconfig.gates.json)");
    console.log(
      "    rastreados .ts/.mts em scripts/: " + rastreados.length +
      " | com prefixo que assere (" + PREFIXOS_QUE_ASSEREM.join(", ") + "): " + querTipagem.length +
      " | no include: " + noInclude.size
    );

    if (foraDoInclude.length > 0) {
      coberturaFalhou = true;
      console.log("    FALHOU — gate RASTREADO fora do include (fica sem tipagem):");
      for (const f of foraDoInclude) console.log("      - " + f);
      console.log("    Conserto: acrescente o caminho em tsconfig.gates.json > include.");
    }
    if (inexistentes.length > 0) {
      coberturaFalhou = true;
      console.log("    FALHOU — include aponta para arquivo que NAO existe:");
      for (const f of inexistentes) console.log("      - " + f);
      console.log("    Conserto: remova a entrada morta de tsconfig.gates.json > include.");
    }
    if (!coberturaFalhou) {
      console.log("    OK — todo gate rastreado esta no include, e todo include existe.");
    }
  }
}

// ---------------------------------------------------------------------------
// COMO INVOCAR — .cjs roda direto, .ts/.mts precisa de tsx
// ---------------------------------------------------------------------------
// O runner fazia `spawnSync(process.execPath, [abs])`, ou seja `node arquivo`.
// Isso NAO executa TypeScript, entao nenhum gate .ts/.mts jamais poderia ter
// entrado no registro. Nao era esquecimento — era incapacidade. Consequencia
// medida em 01/08/2026: dos 68 gates rastreados, 6 registrados e 3 executados
// no modo padrao; os 16 .ts/.mts eram TODOS orfaos, incluindo os dois que
// provam a regua de lideranca que entra em vigor em agosto.
//
// POR QUE tsx E NAO O _ts_register.cjs QUE OS GATES JA USAM. Medido, 7
// execucoes de um arquivo trivial:
//     node arquivo.cjs            (baseline CJS)          227ms
//     node arquivo.mts            (strip nativo do Node)  307ms
//     node -r _ts_register a.ts                           756ms
//     tsx arquivo.mts                                     639ms
// tsx e mais RAPIDO que o _ts_register (639 x 756) e, decisivo, e o unico que
// resolve o alias "@/..." em import ESM: o _ts_register faz isso por
// Module._resolveFilename, que so vale para CommonJS, e devolve
// ERR_MODULE_NOT_FOUND num .mts com `import ... from "@/lib/..."` — que e
// exatamente como os gates .mts importam. O strip nativo do Node 24, apesar de
// ser o mais barato, tambem nao resolve o alias.
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
function comoInvocar(abs) {
  if (!/\.(ts|mts|cts)$/.test(abs)) return { args: [abs] };
  if (!fs.existsSync(TSX_CLI)) return { erro: "tsx nao encontrado em node_modules/tsx/dist/cli.mjs" };
  return { args: [TSX_CLI, abs] };
}

const resultados = [];
for (const g of aRodar) {
  const abs = path.join(ROOT, g.arquivo);
  if (!fs.existsSync(abs)) {
    console.log("\n>>> " + g.nome + "\n    ARQUIVO AUSENTE: " + g.arquivo);
    resultados.push({ ...g, status: "AUSENTE", code: null });
    continue;
  }
  const inv = comoInvocar(abs);
  if (inv.erro) {
    // FALHA, nao pulo: gate que nao consegue rodar tem de ficar VERMELHO. Pular
    // aqui reproduziria o defeito que esta frente existe para matar.
    console.log("\n>>> " + g.nome + "\n    NAO EXECUTAVEL: " + inv.erro);
    resultados.push({ ...g, status: "FALHOU", code: null });
    continue;
  }
  console.log("\n>>> " + g.nome + "  (" + g.arquivo + ")");
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, inv.args, {
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

console.log(
  "  " + (coberturaFalhou ? "FALHOU " : "PASSOU ") +
  " | cobertura da tipagem dos gates (tsconfig.gates.json)"
);

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

if (falhas.length > 0 || coberturaFalhou) {
  const motivos = falhas.map((f) => f.nome);
  if (coberturaFalhou) motivos.push("cobertura da tipagem dos gates");
  console.log("\n  RESULTADO: FALHOU — " + motivos.join(", "));
  process.exit(1);
}
console.log("\n  RESULTADO: OK — todos os gates executados passaram.");
process.exit(0);
