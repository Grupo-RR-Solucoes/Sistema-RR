#!/usr/bin/env node
/*
 * scripts/gate_pos_import_diag.cjs — O RASTRO DO POS-IMPORT NAO PODE SUMIR.
 *
 * O QUE ESTE PORTAO DEFENDE
 * -------------------------
 * Os blocos de efeito colateral dos imports de fechamento engoliam o proprio
 * erro num console.error. Custo medido: a materializacao da carteira PRT
 * falhava desde 2026-07-07 e passou DOIS fechamentos sem ninguem ver. O
 * conserto grava o resultado (ok/ms/erro CRU) na tabela `import_pos_diag`.
 *
 * TRES LADOS, todos no mesmo run:
 *   A. a regra (lib/diagnostico/posImportDiag.ts) preserva o erro, nao descarta
 *      bloco e deriva `houve_falha` — provado por MUTACAO DO FONTE REAL;
 *   B. a TABELA existe no banco. Sem ela o conserto e inerte (o insert falha e o
 *      rastro volta a ser invisivel), entao a ausencia REPROVA de proposito;
 *   C. AS DUAS ROTAS DE FECHAMENTO gravam. Este lado nasceu de um buraco REAL:
 *      a primeira versao instrumentou so app/api/import/closing/route.ts, e o
 *      fechamento da ADS de 02/09/2026 passou sem deixar foto — ele entra por
 *      app/api/import/closing/ads/route.ts e se registra em `daily_imports`,
 *      nao em `monthly_closing_imports`. Rastro que so existe numa das duas
 *      rotas nao e rastro, e um portao que so olhasse uma delas nao pegaria.
 *
 * modo: needs-db (le o banco; sem credencial ou sem alcancar o banco, REPROVA).
 */
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const { carregaReal, carregaMutante, ROOT } = require("./_mutanteTs.cjs");

const MODULO = "lib/diagnostico/posImportDiag.ts";
const falhas = [];
const ok = (n, cond, msg) => {
  console.log("  " + (cond ? "OK   " : "FALHA") + " [" + n + "] " + msg);
  if (!cond) falhas.push("[" + n + "] " + msg);
};

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

/** O cenario: um bloco morreu com mensagem, um passou. */
const CENARIO = [
  { nome: "materializacao_carteira_prt", ok: false, ms: 41230, erro: "canceling statement due to statement timeout" },
  { nome: "congelamento_previsao", ok: true, ms: 5500, extra: { linhas_gravadas: 0 } },
];

/** A assercao que o portao faz. Vale para o real E para o mutante. */
function avalia(montar) {
  const d = montar(CENARIO, "2026-09-02T00:00:00.000Z");
  const mat = d.blocos.find((b) => b.nome === "materializacao_carteira_prt") || {};
  return {
    preservaErro: !!mat.erro,
    erroCru: (mat.erro || "") === CENARIO[0].erro,
    manteveBlocos: d.blocos.length === CENARIO.length,
    houveFalha: d.houve_falha === true,
    nomeiaQuemFalhou: Array.isArray(d.falharam) && d.falharam.indexOf("materializacao_carteira_prt") >= 0,
    somaMs: d.ms_total === 41230 + 5500,
  };
}

/** Fonte sem comentarios — evita casar assercao com texto de comentario. */
function fonteSemComentario(rel) {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

async function main() {
  console.log("\n=== GATE pos_import_diag — o rastro do pos-import ===");

  // ---------------------------------------------------------------- A. regra
  console.log("\n[A] a regra, com o FONTE REAL");
  const real = carregaReal(MODULO);
  const r = avalia(real.montarPosImportDiag);
  ok("A1", r.preservaErro, "bloco que falhou sai COM `erro`");
  ok("A2", r.erroCru, "a mensagem vai CRUA, sem resumir nem traduzir");
  ok("A3", r.manteveBlocos, "nenhum bloco e descartado (o que passou tambem fica)");
  ok("A4", r.houveFalha, "`houve_falha` deriva dos blocos");
  ok("A5", r.nomeiaQuemFalhou, "`falharam` nomeia o bloco quebrado");
  ok("A6", r.somaMs, "`ms_total` soma o tempo dos blocos (foi o ms que revelou o defeito)");

  const semMsg = real.montarPosImportDiag([{ nome: "x", ok: false, ms: 1 }]);
  ok("A7", !!semMsg.blocos[0].erro, "falha SEM mensagem grava placeholder em vez de omitir o campo");
  const semOk = real.montarPosImportDiag([{ nome: "y", ms: 1 }]);
  ok("A8", semOk.houve_falha === true, "`ok` ausente conta como FALHA, nunca como sucesso");

  // ------------------------------------------------------------- MUTACAO
  console.log("\n[MUT] quebrando a regra de proposito — o portao TEM de ficar vermelho");
  const mutantes = [
    {
      nome: "descarta a mensagem do erro",
      trocas: [['saida.erro = b.erro && String(b.erro).trim() !== "" ? String(b.erro) : "(erro sem mensagem)";', "saida.erro = undefined;"]],
      espera: (x) => !x.preservaErro || !x.erroCru,
    },
    {
      nome: "esconde os blocos que falharam",
      trocas: [["const lista = (blocos || []).map((b) => {", "const lista = (blocos || []).filter((b) => b.ok === true).map((b) => {"]],
      espera: (x) => !x.manteveBlocos || !x.houveFalha,
    },
    {
      nome: "crava houve_falha em false",
      trocas: [["houve_falha: lista.some((b) => !b.ok),", "houve_falha: false,"]],
      espera: (x) => !x.houveFalha,
    },
  ];
  for (const m of mutantes) {
    let pegou = false;
    let detalhe = "";
    try {
      const mut = carregaMutante(MODULO, m.trocas);
      pegou = m.espera(avalia(mut.montarPosImportDiag));
    } catch (e) {
      detalhe = " (" + e.message.split("\n")[0] + ")";
      pegou = false;
    }
    ok("MUT", pegou, 'mutante "' + m.nome + '" e PEGO pelas assercoes' + detalhe);
  }

  // ------------------------------------------------- C. as DUAS rotas gravam
  console.log("\n[C] as DUAS rotas de fechamento gravam o rastro?");
  const ROTAS = [
    ["app/api/import/closing/route.ts", "closing_rr"],
    ["app/api/import/closing/ads/route.ts", "closing_ads"],
  ];
  for (const par of ROTAS) {
    const arq = par[0];
    const origem = par[1];
    const src = fonteSemComentario(arq);
    ok("C1", /registrarPosImportDiag\s*\(/.test(src), arq + " chama registrarPosImportDiag()");
    ok("C2", src.indexOf('"' + origem + '"') >= 0, arq + " grava com origem='" + origem + "'");
  }
  // A rota da ADS e FAIL-LOUD nos dois blocos. Instrumentar NAO pode te-la
  // tornado best-effort: o catch da reconsolidacao tem de RELANCAR, e a recusa
  // 422 da ancora tem de registrar ANTES do return.
  {
    const src = fs.readFileSync(path.join(ROOT, "app/api/import/closing/ads/route.ts"), "utf8");
    const i = src.indexOf("reconsolidarCompetenciaFechada(supabase");
    const trecho = i >= 0 ? src.slice(i, i + 1800) : "";
    ok("C3", /throw e;/.test(trecho),
      "a rota da ADS RELANCA depois de registrar (registrar nao virou engolir)");
    ok("C4", /await gravarDiag\(null\);[\s\S]{0,400}status: 422/.test(src),
      "a recusa 422 da ancora registra ANTES de devolver (depois do return nao ha instante)");
  }

  // ---------------------------------------------------------------- B. banco
  console.log("\n[B] a tabela existe no banco? (sem ela o conserto e inerte)");
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    ok("B0", false, "credencial do Supabase ausente — needs-db sem banco REPROVA (nao passa por vacuidade)");
  } else {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const tabela = real.TABELA_POS_IMPORT_DIAG;
    ok("B1", tabela === "import_pos_diag", "a constante do modulo aponta a tabela certa (" + tabela + ")");
    const { data: linhas, error } = await sb
      .from(tabela)
      .select("origem, import_id, year, month, houve_falha, falharam, ms_total, criado_em")
      .order("criado_em", { ascending: false })
      .limit(10);
    if (error) {
      ok("B2", false,
        "tabela " + tabela + " NAO existe/legivel (" + (error.code || "") + " " + error.message + "). " +
        "APLIQUE supabase/migrations/20260903_000001_import_pos_diag.sql no Studio — " +
        "sem ela o insert falha e o rastro continua invisivel");
    } else {
      ok("B2", true, "tabela " + tabela + " existe e e legivel");
      console.log("       linhas de rastro ja gravadas: " + (linhas || []).length +
        ((linhas || []).length === 0 ? "  (esperado ate o proximo import rodar)" : ""));
      for (const l of linhas || []) {
        console.log("         " + String(l.criado_em).slice(0, 19) + "  " + l.origem +
          "  " + l.year + "-" + String(l.month).padStart(2, "0") +
          "  houve_falha=" + l.houve_falha + "  falharam=" + JSON.stringify(l.falharam) +
          "  " + l.ms_total + "ms");
      }
      const origens = [...new Set((linhas || []).map((l) => l.origem))];
      if (origens.length) console.log("       origens vistas: " + origens.join(", "));
    }
  }

  console.log("\n" + "=".repeat(60));
  if (falhas.length === 0) {
    console.log("GATE pos_import_diag: PASSOU");
    process.exitCode = 0;
    return;
  }
  console.log("GATE pos_import_diag: REPROVOU (" + falhas.length + ")");
  for (const f of falhas) console.log("  - " + f);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error("GATE pos_import_diag: ERRO", e.message);
  process.exitCode = 1;
});
