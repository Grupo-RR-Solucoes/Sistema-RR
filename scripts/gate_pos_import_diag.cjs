#!/usr/bin/env node
/*
 * scripts/gate_pos_import_diag.cjs — O RASTRO DO POS-IMPORT NAO PODE SUMIR.
 *
 * O QUE ESTE PORTAO DEFENDE
 * -------------------------
 * Os 4 blocos best-effort do import de fechamento engoliam o proprio erro num
 * console.error. Custo medido: a materializacao da carteira PRT falhava desde
 * 2026-07-07 e passou DOIS fechamentos sem ninguem ver. O conserto grava o
 * resultado (ok/ms/erro CRU) em monthly_closing_imports.pos_import_diag.
 *
 * O portao tem DOIS lados, e os dois rodam no mesmo run:
 *   A. a regra (lib/diagnostico/posImportDiag.ts) preserva o erro, nao descarta
 *      bloco e deriva `houve_falha` — provado por MUTACAO DO FONTE REAL;
 *   B. a coluna EXISTE no banco. Sem ela o conserto e inerte: a rota tenta o
 *      UPDATE, leva 42703 e o rastro volta a ser invisivel. Um portao verde com
 *      a coluna faltando seria a mesma mentira que o conserto veio desfazer —
 *      por isso ausencia da coluna REPROVA.
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
  console.log(`  ${cond ? "OK   " : "FALHA"} [${n}] ${msg}`);
  if (!cond) falhas.push(`[${n}] ${msg}`);
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
  return {
    preservaErro: !!(d.blocos.find((b) => b.nome === "materializacao_carteira_prt") || {}).erro,
    erroCru:
      ((d.blocos.find((b) => b.nome === "materializacao_carteira_prt") || {}).erro || "") ===
      CENARIO[0].erro,
    manteveBlocos: d.blocos.length === CENARIO.length,
    houveFalha: d.houve_falha === true,
    nomeiaQuemFalhou: Array.isArray(d.falharam) && d.falharam.indexOf("materializacao_carteira_prt") >= 0,
    somaMs: d.ms_total === 41230 + 5500,
  };
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

  // bloco sem mensagem: falha muda ainda tem de aparecer COMO falha
  const semMsg = real.montarPosImportDiag([{ nome: "x", ok: false, ms: 1 }]);
  ok("A7", !!semMsg.blocos[0].erro,
    "falha SEM mensagem grava placeholder em vez de omitir o campo");
  // `ok` ausente nao pode virar sucesso por descuido
  const semOk = real.montarPosImportDiag([{ nome: "y", ms: 1 }]);
  ok("A8", semOk.houve_falha === true, "`ok` ausente conta como FALHA, nunca como sucesso");

  // ------------------------------------------------------------- MUTACAO
  // Tres mutacoes, uma por invariante. Se o portao continuar verde com
  // qualquer uma delas, a assercao correspondente nao tem dente.
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
    ok("MUT", pegou, `mutante "${m.nome}" e PEGO pelas assercoes${detalhe}`);
  }

  // ---------------------------------------------------------------- B. banco
  console.log("\n[B] a coluna existe no banco? (sem ela o conserto e inerte)");
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    ok("B0", false, "credencial do Supabase ausente — needs-db sem banco REPROVA (nao passa por vacuidade)");
  } else {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const coluna = real.COLUNA_POS_IMPORT_DIAG;
    ok("B1", coluna === "pos_import_diag", `a constante do modulo aponta a coluna certa (${coluna})`);
    const { error } = await sb.from("monthly_closing_imports").select(`id, ${coluna}`).limit(1);
    if (error) {
      ok("B2", false,
        `coluna ${coluna} NAO existe/legivel (${error.code || ""} ${error.message}). ` +
        "APLIQUE supabase/migrations/20260902_000001_pos_import_diag.sql no Studio — " +
        "sem ela a rota leva erro no UPDATE e o rastro continua invisivel");
    } else {
      ok("B2", true, `coluna ${coluna} existe e e legivel`);
      // Telemetria (nao reprova): o rastro so aparece nos imports FUTUROS.
      const { data: comDiag } = await sb
        .from("monthly_closing_imports")
        .select("id, year, month, " + coluna)
        .not(coluna, "is", null)
        .limit(5);
      console.log(`       imports ja com rastro gravado: ${(comDiag || []).length}` +
        ((comDiag || []).length === 0 ? "  (esperado ate o proximo import rodar)" : ""));
      for (const i of comDiag || []) {
        const d = i[coluna] || {};
        console.log(`         ${i.year}-${String(i.month).padStart(2, "0")}  houve_falha=${d.houve_falha}  falharam=${JSON.stringify(d.falharam)}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  if (falhas.length === 0) {
    console.log("GATE pos_import_diag: PASSOU");
    process.exitCode = 0;
    return;
  }
  console.log(`GATE pos_import_diag: REPROVOU (${falhas.length})`);
  for (const f of falhas) console.log("  - " + f);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error("GATE pos_import_diag: ERRO", e.message);
  process.exitCode = 1;
});
