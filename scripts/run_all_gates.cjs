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
const DB_ONLY = process.argv.includes("--db");

const GATES = [
  {
    arquivo: "scripts/tiquete_min_regua_gate.cjs",
    nome: "tiquete_min (regua x hardcode)",
    modo: "self-contained",
    motivo:
      "le regras_promotiva/json + lib/motor.ts; sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/venda_propria_gestao_gate.cjs",
    nome: "venda propria de gestao (no-op + isolamento do PMR)",
    modo: "self-contained",
    motivo:
      "Supabase falso em memoria + funcoes reais do repo",
  },
  {
    arquivo: "scripts/no_brand_hardcoded_gate.cjs",
    nome: "marca institucional so na barra",
    modo: "self-contained",
    motivo:
      "le .ts/.tsx/.js do proprio repo",
  },
  {
    arquivo: "scripts/detector_regua_camada2_gate.cjs",
    nome: "detector de regua - camada 2",
    modo: "self-contained",
    motivo:
      "puro sobre codigo do repo",
  },
  {
    arquivo: "scripts/check_regrasLoader.cjs",
    nome: "regrasLoader (resolucao de vigencia)",
    modo: "self-contained",
    motivo:
      "le os JSONs versionados",
  },
  {
    arquivo: "scripts/check_tx_juros_min.cjs",
    nome: "tx_juros_min derivado da matriz",
    modo: "self-contained",
    motivo:
      "le os JSONs versionados",
  },
  {
    arquivo: "scripts/verifica_data_l.cjs",
    nome: "data-l nas tabelas (kit mobile)",
    modo: "self-contained",
    motivo:
      "le os .tsx do repo",
  },
  {
    arquivo: "scripts/bbts_seguro_regua_gate.cjs",
    nome: "regua de seguro BBTS",
    modo: "self-contained",
    motivo:
      "le fixture versionada; sem banco",
  },
  {
    arquivo: "scripts/test_item4_pdf_extract.cjs",
    nome: "extrator de PDF do fechamento ADS",
    modo: "self-contained",
    motivo:
      "fixture versionada; sem banco",
  },
  {
    arquivo: "scripts/test_debitos_edicao.cjs",
    nome: "edicao de debitos (regras puras)",
    modo: "self-contained",
    motivo:
      "funcoes puras de lib/debitRules",
  },
  {
    arquivo: "scripts/gate-import-percentual.mts",
    nome: "percentual no import (invariante)",
    modo: "self-contained",
    motivo:
      "puro sobre o parser",
  },
  {
    arquivo: "scripts/gate_teto_avista_rr.ts",
    nome: "teto a-vista RR versionado por competencia",
    modo: "self-contained",
    motivo:
      "puro sobre lib/tetoAvistaRR",
  },
  {
    arquivo: "scripts/golden_carteira_vs_metadata.ts",
    nome: "golden carteira x metadata",
    modo: "self-contained",
    motivo:
      "fixture versionada; sem banco",
  },
  {
    arquivo: "scripts/test_equipe_dashboard.ts",
    nome: "montagem do payload do /equipe",
    modo: "self-contained",
    motivo:
      "assembleTeamProduction com entrada em memoria",
  },
  {
    arquivo: "scripts/test_equipes_socio_gestor.ts",
    nome: "escopo de equipes socio x gestor",
    modo: "self-contained",
    motivo:
      "puro sobre as funcoes de escopo",
  },
  {
    arquivo: "scripts/test_gestor_meta.ts",
    nome: "meta do gestor (override x derivada)",
    modo: "self-contained",
    motivo:
      "puro sobre resolveGestorMeta",
  },
  {
    arquivo: "scripts/test_inadimplencia_solucionado.ts",
    nome: "inadimplencia SOLUCIONADO sai dos agregados",
    modo: "self-contained",
    motivo:
      "puro sobre inadimplenciaAgregados",
  },
  {
    arquivo: "scripts/check_condicoes_seed.cjs",
    nome: "condicoes do seed (JSON curado)",
    modo: "self-contained",
    motivo:
      "varre os JSONs versionados; ninguem revisa JSON curado editado a mao",
  },
  {
    arquivo: "scripts/check_lookup_vs_v9.cjs",
    nome: "lookup x v9 (JSON curado)",
    modo: "self-contained",
    motivo:
      "idem; fica no CI por decisao de 01/08/2026",
  },
  {
    arquivo: "scripts/gate-competencia-janela.cjs",
    nome: "competencia por janela de producao",
    modo: "needs-db",
    motivo:
      "createClient; le daily_production_records de PRODUCAO",
  },
  {
    arquivo: "scripts/paridade_avista_trp_gate.cjs",
    nome: "paridade a-vista TRP (previsto x motor)",
    modo: "needs-db",
    motivo:
      "createClient; daily_production_records de PRODUCAO",
  },
  {
    arquivo: "scripts/gate_escala_seguro_tabela.cjs",
    nome: "escala de seguro nasce da tabela",
    modo: "needs-db",
    motivo:
      "createClient; share_scale de PRODUCAO",
  },
  {
    arquivo: "scripts/gate_daily_nao_toca_ads.cjs",
    nome: "import diario RR nao toca a ADS",
    modo: "needs-db",
    motivo:
      "createClient; daily_production_records de PRODUCAO",
  },
  {
    arquivo: "scripts/test_caixa_recebido_empresa.cjs",
    nome: "caixa - recebido empresa",
    modo: "needs-db",
    motivo:
      "createClient; fechamento de PRODUCAO",
  },
  {
    arquivo: "scripts/test_caixa_comissoes_m1.cjs",
    nome: "caixa - comissoes M1 liquido",
    modo: "needs-db",
    motivo:
      "createClient; PMR de PRODUCAO",
  },
  {
    arquivo: "scripts/test_item3_ads_seguro.cjs",
    nome: "seguro ADS por proposta",
    modo: "needs-db",
    motivo:
      "createClient; daily da ADS de PRODUCAO",
  },
  {
    arquivo: "scripts/trp_tx_juros_min_gate.cjs",
    nome: "TRP - tx_juros_min derivado",
    modo: "needs-db",
    motivo:
      "createClient; trp_rule_versions de PRODUCAO",
  },
  {
    arquivo: "scripts/check_enquadramento.cjs",
    nome: "enquadramento por faixa (audit_v9)",
    modo: "needs-db",
    motivo:
      "createClient; audit_v9_avista de PRODUCAO",
  },
  {
    arquivo: "scripts/gate_regua_bbts_independe_do_client.ts",
    nome: "regua BBTS independe do client",
    modo: "needs-db",
    motivo:
      "createClient; bbts_rule_versions de PRODUCAO",
  },
  {
    arquivo: "scripts/gate_ads_julho_dois_bugs.ts",
    nome: "ADS julho - os dois bugs fechados",
    modo: "needs-db",
    motivo:
      "createClient; daily da ADS de PRODUCAO",
  },
  {
    arquivo: "scripts/detector_regua_camada1_gate.cjs",
    nome: "detector de regua - camada 1",
    modo: "needs-db",
    motivo:
      "createClient (smoke live); consolidadores gravam versao TRP",
  },
  {
    arquivo: "scripts/janela_ritmo_paridade_gate.cjs",
    nome: "janela de ritmo - paridade /projecao x /equipe",
    modo: "needs-db-lento",
    motivo:
      "17,7s; createClient; daily de PRODUCAO",
  },
  {
    arquivo: "scripts/test_debitos_junho_congelado.cjs",
    nome: "debitos de junho congelados",
    modo: "needs-db-lento",
    motivo:
      "19,0s; createClient; debitos de PRODUCAO",
  },
  {
    arquivo: "scripts/fix_truncamento_gate.cjs",
    nome: "truncamento na projecao/metas/caixa",
    modo: "needs-db-lento",
    motivo:
      "21,3s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/guardas_regime_gate.cjs",
    nome: "guardas de regime (bulk/cancel)",
    modo: "needs-db-lento",
    motivo:
      "21,1s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/projecao_dias_ritmo_gate.cjs",
    nome: "projecao - dias uteis do ritmo",
    modo: "needs-db-lento",
    motivo:
      "24,3s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/projecao_rank_sem_master_gate.cjs",
    nome: "projecao - master fora do rank",
    modo: "needs-db-lento",
    motivo:
      "44,9s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/mov1_ledger_gate.cjs",
    nome: "ledger MOV1 - PMR por rota",
    modo: "needs-db-lento",
    motivo:
      "52s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/mov2_grupoA_gate.cjs",
    nome: "ledger MOV2 - grupo A",
    modo: "needs-db-lento",
    motivo:
      "57s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/mov2_dashboard_gate.cjs",
    nome: "ledger MOV2 - dashboard",
    modo: "needs-db-lento",
    motivo:
      "60s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/gate_remuneracao_lideranca.mts",
    nome: "remuneracao de lideranca (regua versionada, 2 regimes)",
    modo: "needs-db-lento",
    motivo:
      "59s; createClient; monthly_closing_entries/leadership_rule_versions de PRODUCAO",
  },
  {
    arquivo: "scripts/trp_parser_escalares_gate.cjs",
    nome: "parser TRP - escalares de categoria",
    modo: "needs-local",
    motivo:
      "le 3 PDFs de C:/Users/diego/Downloads; o repo tem 0 PDFs versionados",
  },
];

// ---------------------------------------------------------------------------
// TRES FAIXAS, SEPARADAS POR CUSTO (nao por dominio)
// ---------------------------------------------------------------------------
// Dominio nao e o que faz alguem deixar de rodar; TEMPO e. Medido em
// 01/08/2026: rodar tudo passa de 10 minutos, e um comando de 10 minutos vira
// coisa que ninguem executa — trocariamos gate MORTO por gate IGNORADO, que da
// no mesmo.
//
//   npm run gates       self-contained            ~55s    CI
//   npm run gates:db    needs-db rapido           ~90s    antes do PR
//   npm run gates:full  tudo, inclusive os lentos ~11min  antes do merge
const SELF = GATES.filter((g) => g.modo === "self-contained");
const DB_RAPIDO = GATES.filter((g) => g.modo === "needs-db");
const aRodar = FULL ? GATES : DB_ONLY ? DB_RAPIDO : SELF;
const aPular = FULL ? [] : GATES.filter((g) => !aRodar.includes(g));

// TETO DA FAIXA --db. Sem teto ela cresce sozinha ate virar o --full, e ai o
// problema volta inteiro. Se estourar, FALHA: alguem tem de tirar um gate da
// faixa ou promove-lo a needs-db-lento.
const TETO_DB_MS = Number(process.env.GATES_DB_TETO_MS || 90000);

const linha = (c) => c.repeat(74);
console.log(linha("="));
console.log("RUNNER DE GATES" + (FULL ? "  [--full: tudo, inclusive os lentos]" : DB_ONLY ? "  [--db: needs-db rapido, teto " + (TETO_DB_MS / 1000) + "s]" : "  [self-contained]"));
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
// PREFIXOS que marcam "arquivo que ASSERE". Renomes de 01/08/2026 tiraram do
// alcance deste criterio, DE PROPOSITO:
//   MUTA_merge_dono_coluna.manual.cjs  — ESCREVE em producao; o antigo prefixo
//     `test_` o incluia aqui, e um runner por prefixo o executaria contra o
//     banco vivo. Nunca pode voltar a casar.
//   diag_auditoria_avista.cjs, dump_candidate_list_motor.cjs,
//   dump_pmr_fechado_hash.cjs — exigem flag/argumento por natureza; nao sao
//     gates e nao devem cobrar tipagem nem execucao.
const PREFIXOS_QUE_ASSEREM = ["gate", "golden", "test_"];
// Guarda explicita: nenhum arquivo que muta pode entrar no criterio, mesmo que
// alguem o renomeie de volta por engano.
const NUNCA_AUTOMATIZAR = /^MUTA_|\.manual\./;
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
      if (NUNCA_AUTOMATIZAR.test(base)) return false;
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

// TETO DA FAIXA --db: verificado pelo PROPRIO runner, sobre o tempo MEDIDO.
// Sem isso o teto seria so um numero num comentario, e a faixa cresceria ate
// virar o --full — que e exatamente o que esta separacao existe para impedir.
let tetoEstourou = false;
if (DB_ONLY) {
  const somaMs = resultados.reduce((s, r) => s + (r.ms || 0), 0);
  const ok = somaMs <= TETO_DB_MS;
  if (!ok) tetoEstourou = true;
  console.log(
    "  " + (ok ? "PASSOU " : "FALHOU ") + " | teto da faixa --db: " +
    (somaMs / 1000).toFixed(1) + "s de " + (TETO_DB_MS / 1000) + "s"
  );
  if (!ok) {
    const ordenados = [...resultados].sort((a, b) => (b.ms || 0) - (a.ms || 0));
    console.log("          A faixa --db estourou o teto. Tire um gate dela ou");
    console.log("          promova-o a needs-db-lento (so no --full). Mais lentos:");
    for (const r of ordenados.slice(0, 3)) {
      console.log("            " + ((r.ms || 0) / 1000).toFixed(1) + "s  " + r.nome);
    }
  }
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

if (falhas.length > 0 || coberturaFalhou || tetoEstourou) {
  const motivos = falhas.map((f) => f.nome);
  if (coberturaFalhou) motivos.push("cobertura da tipagem dos gates");
  if (tetoEstourou) motivos.push("teto de tempo da faixa --db");
  console.log("\n  RESULTADO: FALHOU — " + motivos.join(", "));
  process.exit(1);
}
console.log("\n  RESULTADO: OK — todos os gates executados passaram.");
process.exit(0);
