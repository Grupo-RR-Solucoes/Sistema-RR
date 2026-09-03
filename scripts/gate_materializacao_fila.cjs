#!/usr/bin/env node
/*
 * scripts/gate_materializacao_fila.cjs — A MATERIALIZACAO ASSINCRONA NAO PODE
 * VIRAR SILENCIO.
 *
 * O QUE ESTE PORTAO DEFENDE
 * -------------------------
 * A materializacao da carteira PRT era chamada pelo PostgREST e nao podia
 * terminar: MEDIDO, o role `authenticator` corta em 8s (statement_timeout e
 * lock_timeout) e as duas funcoes queimam 38-51s. Ficou morta de 2026-07-07 a
 * 2026-09-02 (dois fechamentos). O conserto tira a execucao da API: a rota
 * INSERE numa fila e um job pg_cron roda dentro do banco, sem teto.
 *
 * MAS TROCAR SINCRONO POR ASSINCRONO TEM UM PRECO, E ELE E O SILENCIO. "Enfileirei"
 * nao e "funcionou": se o job do cron nao existir, nao estiver ativo ou estiver
 * falhando, o insert continua devolvendo 200 e a carteira envelhece calada — o
 * MESMO defeito, so mudado de lugar. Metade das assercoes deste portao existe
 * por causa disso.
 *
 * QUATRO LADOS, todos no mesmo run, porque cada um sozinho passa por engano:
 *   A. as REGRAS (lib/materializacao/filaRegras.ts) — congelar so sobre
 *      materializacao OK, ordem cronologica, flag lida em ESTRITO, e
 *      "enfileirei" NAO virando ok=true — provado por MUTACAO DO FONTE REAL;
 *   B. as ROTAS — a de import nao chama mais fn_materializar_* direto, enfileira;
 *      e o congelamento recebe a competencia da FILA, nunca do max da carteira
 *      (foi o max que deixou o vintage de 2026-07 inalcancavel);
 *   C. a MIGRATION em disco — sem `statement_timeout = 0`, sem lock de
 *      concorrencia e sem os revokes, o worker seria inerte ou perigoso;
 *   D. o BANCO — a tabela, a RPC de diagnostico, o job do cron ATIVO e com
 *      execucao registrada. Sem isso a rota enfileira para ninguem, e um verde
 *      aqui seria a mentira que a frente veio desfazer.
 *
 * modo: needs-db (le o banco; sem credencial ou sem alcancar o banco, REPROVA).
 */
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const { carregaReal, carregaMutante, ROOT } = require("./_mutanteTs.cjs");

const MODULO = "lib/materializacao/filaRegras.ts";
const MIGRATION = "supabase/migrations/20260903_000002_materializacao_fila.sql";
const ROTA_IMPORT = "app/api/import/closing/route.ts";
const ROTA_CONGELAR = "app/api/recebiveis/congelar/route.ts";

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

/** Fonte sem comentarios — evita casar assercao com texto de comentario. */
function fonteSemComentario(rel) {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

// ---------------------------------------------------------------- o cenario --
// Uma fila realista: julho JA materializado e devendo congelamento, agosto
// materializado DEPOIS e tambem devendo, junho ja congelado, uma linha PENDENTE
// velha (o worker nao rodou) e uma com ERRO.
const AGORA = Date.parse("2026-09-03T12:00:00.000Z");
const min = (n) => new Date(AGORA - n * 60000).toISOString();

const CENARIO = [
  { id: "j-ago", origem: "closing_rr", year: 2026, month: 8, status: "OK",
    congelamento_pendente: true, criado_em: min(60), ms: 44120, erro: null },
  { id: "j-jul", origem: "closing_rr", year: 2026, month: 7, status: "OK",
    congelamento_pendente: true, criado_em: min(120), ms: 41880, erro: null },
  { id: "j-jun", origem: "closing_rr", year: 2026, month: 6, status: "OK",
    congelamento_pendente: false, criado_em: min(180), ms: 39900, erro: null },
  { id: "j-velha", origem: "closing_rr", year: 2026, month: 9, status: "PENDENTE",
    congelamento_pendente: true, criado_em: min(45), ms: null, erro: null },
  { id: "j-erro", origem: "closing_rr", year: 2026, month: 5, status: "ERRO",
    congelamento_pendente: true, criado_em: min(200), ms: 8010,
    erro: "canceling statement due to statement timeout" },
  // Linha com a flag NULL, e ela esta aqui de proposito: quase todo o historico
  // tem flag nula, e uma leitura frouxa (`!== false`) classificaria o passado
  // inteiro como devendo congelamento. Sem esta linha no cenario, o mutante da
  // leitura frouxa nao muda resultado nenhum e o portao passaria sem mutar nada.
  { id: "j-nulo", origem: "closing_rr", year: 2026, month: 3, status: "OK",
    congelamento_pendente: null, criado_em: min(300), ms: 38010, erro: null },
];

/** A assercao que o portao faz. Vale para o real E para o mutante. */
function avalia(mod) {
  const pend = mod.congelamentosPendentes(CENARIO);
  const diag = mod.diagnosticoFila(CENARIO, AGORA);
  const blocoBom = mod.blocoEnfileiramento({
    jobId: "abc",
    ms: 12,
    diagnostico: { atrasadas: [], comErro: [], pendentes: 1, rodando: 0, ok: 3, saudavel: true, mensagem: null },
  });
  const blocoDoente = mod.blocoEnfileiramento({ jobId: "abc", ms: 12, diagnostico: diag });
  const blocoSemInsert = mod.blocoEnfileiramento({
    jobId: null,
    ms: 12,
    erro: "42P01 relation does not exist",
    diagnostico: null,
  });
  return {
    // so OK + pendente entram (nem PENDENTE, nem ERRO, nem o ja congelado)
    soOkPendente:
      pend.length === 2 &&
      pend.every((p) => p.competencia === "2026-07" || p.competencia === "2026-08"),
    // ordem: julho ANTES de agosto
    ordemCronologica: pend.length === 2 && pend[0].competencia === "2026-07",
    // a mais velha (PENDENTE ha 45 min) e denunciada
    denunciaAtraso: diag.atrasadas.length === 1 && diag.atrasadas[0].id === "j-velha",
    // o ERRO e denunciado COM a mensagem crua
    denunciaErro:
      diag.comErro.length === 1 &&
      !!diag.mensagem &&
      diag.mensagem.indexOf("canceling statement due to statement timeout") >= 0,
    naoSaudavel: diag.saudavel === false,
    // "enfileirei" com fila saudavel = ok
    blocoOkQuandoSaudavel: blocoBom.ok === true && !blocoBom.erro,
    // "enfileirei" com fila DOENTE = FALHA (este e o coracao do portao)
    blocoFalhaQuandoDoente: blocoDoente.ok === false && !!blocoDoente.erro,
    // insert que falhou = FALHA, com a mensagem crua
    blocoFalhaSemInsert:
      blocoSemInsert.ok === false &&
      !!blocoSemInsert.erro &&
      blocoSemInsert.erro.indexOf("42P01") >= 0,
  };
}

async function main() {
  console.log("\n=== GATE materializacao_fila — assincrono nao pode virar silencio ===");

  // ------------------------------------------------------------- A. as regras
  console.log("\n[A] as regras, com o FONTE REAL");
  const real = carregaReal(MODULO);
  const r = avalia(real);
  ok("A1", r.soOkPendente, "congela SO competencia com status='OK' e congelamento_pendente=true");
  ok("A2", r.ordemCronologica, "ordem cronologica: julho antes de agosto");
  ok("A3", r.denunciaAtraso, "linha PENDENTE velha e DENUNCIADA (o job do cron nao rodou)");
  ok("A4", r.denunciaErro, "linha com ERRO sai com a mensagem CRUA do banco");
  ok("A5", r.naoSaudavel, "fila com atraso ou erro NAO e saudavel");
  ok("A6", r.blocoOkQuandoSaudavel, "insert ok + fila saudavel => bloco ok=true");
  ok("A7", r.blocoFalhaQuandoDoente, '"enfileirei" com fila DOENTE => bloco ok=FALSE');
  ok("A8", r.blocoFalhaSemInsert, "insert que falhou => bloco ok=false COM a mensagem crua");

  // leitura ESTRITA da flag: null/undefined nao contam como pendente
  const comFlagNula = real.congelamentosPendentes([
    { id: "x", year: 2026, month: 4, status: "OK", congelamento_pendente: null, criado_em: min(10) },
  ]);
  ok("A9", comFlagNula.length === 0,
    "congelamento_pendente null NAO conta como pendente (=== true, nao !== false)");

  // deduplicacao por competencia (reimportacao deixa duas linhas OK)
  const duas = real.congelamentosPendentes([
    { id: "a", year: 2026, month: 7, status: "OK", congelamento_pendente: true, criado_em: min(30) },
    { id: "b", year: 2026, month: 7, status: "OK", congelamento_pendente: true, criado_em: min(20) },
  ]);
  ok("A10", duas.length === 1 && duas[0].id === "a",
    "duas linhas OK da MESMA competencia => um congelamento so (a mais antiga)");

  ok("A11", real.competenciaDaLinha({ year: 2026, month: 7 }) === "2026-07",
    "competenciaDaLinha zera-a-esquerda o mes (2026-07, nao 2026-7)");
  ok("A12",
    real.competenciaDaLinha({ year: null, month: null }) === null &&
      real.competenciaDaLinha({ year: 2026, month: 13 }) === null,
    "linha sem competencia (ou com mes invalido) devolve null, nao competencia inventada");

  // ---------------------------------------------------------------- MUTACAO
  console.log("\n[MUT] quebrando as regras de proposito — o portao TEM de ficar vermelho");
  const mutantes = [
    {
      nome: "congela sem exigir status OK (le carteira velha)",
      trocas: [['if (l?.status !== "OK") continue;', "if (false) continue;"]],
      espera: (x) => !x.soOkPendente,
    },
    {
      nome: "le a flag frouxa (!== false) e recongela o historico",
      trocas: [["if (l?.congelamento_pendente !== true) continue;", "if (l?.congelamento_pendente === false) continue;"]],
      espera: (x) => !x.soOkPendente,
    },
    {
      nome: "inverte a ordem (agosto antes de julho)",
      trocas: [["alvo.sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : 0));",
                "alvo.sort((a, b) => (a.criado_em < b.criado_em ? 1 : a.criado_em > b.criado_em ? -1 : 0));"]],
      espera: (x) => !x.ordemCronologica,
    },
    {
      nome: "declara a fila sempre saudavel (o silencio de volta)",
      trocas: [["saudavel: atrasadas.length === 0 && comErro.length === 0,", "saudavel: true,"]],
      espera: (x) => !x.naoSaudavel || !x.blocoFalhaQuandoDoente,
    },
    {
      nome: "nao denuncia atraso (so olha erro)",
      trocas: [["if (agoraMs - nascida > ATRASO_FILA_MS) atrasadas.push(l);", "if (false) atrasadas.push(l);"]],
      espera: (x) => !x.denunciaAtraso,
    },
    {
      nome: '"enfileirei" passa a valer como "funcionou"',
      trocas: [["    ok: enfileirou && okFila,", "    ok: enfileirou,"]],
      espera: (x) => !x.blocoFalhaQuandoDoente,
    },
    {
      nome: "descarta a mensagem crua do erro do insert",
      trocas: [['bloco.erro = msgs.length > 0 ? msgs.join(" | ") : "(erro sem mensagem)";', "bloco.erro = undefined;"]],
      espera: (x) => !x.blocoFalhaSemInsert || !x.blocoFalhaQuandoDoente,
    },
  ];
  for (const m of mutantes) {
    let pegou = false;
    let detalhe = "";
    try {
      pegou = m.espera(avalia(carregaMutante(MODULO, m.trocas)));
    } catch (e) {
      detalhe = " (" + String(e.message).split("\n")[0] + ")";
      pegou = false;
    }
    ok("MUT", pegou, 'mutante "' + m.nome + '" e PEGO pelas assercoes' + detalhe);
  }

  // ----------------------------------------------------------------- B. rotas
  console.log("\n[B] as rotas: enfileira em vez de chamar, e congela por COMPETENCIA");
  const srcImport = fonteSemComentario(ROTA_IMPORT);
  ok("B1", !/rpc\(\s*["']fn_materializar_(producao|carteira)_contrato["']/.test(srcImport),
    ROTA_IMPORT + " NAO chama fn_materializar_* direto (era a chamada que os 8s matavam)");
  ok("B2", /enfileirarMaterializacao\s*\(/.test(srcImport),
    ROTA_IMPORT + " enfileira (enfileirarMaterializacao)");
  ok("B3", /blocoEnfileiramento\s*\(/.test(srcImport),
    ROTA_IMPORT + " monta o bloco do rastro pela REGRA (blocoEnfileiramento), nao a mao");
  ok("B4", /congelamentosPendentes\s*\(/.test(srcImport),
    ROTA_IMPORT + " tira do catch-up da fila o que congelar");
  ok("B5", /congelarPrevisao\([^)]*\{\s*competencia:/.test(srcImport.replace(/\s+/g, " ")),
    ROTA_IMPORT + " passa `competencia` ao congelarPrevisao (nunca deixa cair no max da carteira)");
  // a divida so se baixa DEPOIS do congelamento voltar
  const iCongel = srcImport.indexOf("await congelarPrevisao(");
  const iMarca = srcImport.indexOf("await marcarCongelamentoFeito(");
  ok("B6", iCongel >= 0 && iMarca > iCongel,
    "marcarCongelamentoFeito vem DEPOIS de congelarPrevisao (baixar antes marcaria como pago o que falhou)");
  ok("B7", !/finally\s*\{[^}]*marcarCongelamentoFeito/.test(srcImport),
    "a divida NAO e baixada em `finally` (finally baixa tambem quando lancou)");

  const srcCongelar = fonteSemComentario(ROTA_CONGELAR);
  ok("B8", /competencia/.test(srcCongelar) && /congelarPrevisao\([\s\S]{0,160}?competencia/.test(srcCongelar.replace(/\s+/g, " ")),
    ROTA_CONGELAR + " aceita ?competencia=YYYY-MM (a chamada EXPLICITA do catch-up)");

  const srcAgenda = fonteSemComentario("lib/recebiveis/prtAgenda.ts");
  ok("B9", /options\.competencia\s*\?\?\s*\(await findLatestCarteiraMonth/.test(srcAgenda.replace(/\s+/g, " ")),
    "buildPrtAgenda: a competencia PEDIDA vence o max da carteira (e o max nem e consultado)");
  const srcCongelaLib = fonteSemComentario("lib/recebiveis/congelarPrevisao.ts");
  ok("B10", /buildAvistaProducao\(\s*supabase,\s*pedida\s*\?/.test(srcCongelaLib.replace(/\s+/g, " ")),
    "congelarPrevisao: o a-vista le a MESMA competencia do PRT (senao o vintage mistura dois meses)");

  // ------------------------------------------------------------ C. migration
  console.log("\n[C] a migration em disco tem o que faz o worker funcionar");
  const mig = fs.existsSync(path.join(ROOT, MIGRATION))
    ? fs.readFileSync(path.join(ROOT, MIGRATION), "utf8")
    : "";
  ok("C1", mig.length > 0, MIGRATION + " existe");
  ok("C2", /create extension if not exists pg_cron/i.test(mig),
    "cria a extensao pg_cron (medido 03/09: pg_extension vazio, disponivel 1.6.4)");
  ok("C3", /set local statement_timeout = 0/i.test(mig),
    "o worker DESLIGA o statement_timeout explicitamente (herdar o default e depender de config fora do repo)");
  ok("C4", /pg_try_advisory_xact_lock/i.test(mig),
    "um worker por vez, com lock de TRANSACAO (lock de sessao nao volta no rollback e travaria a fila)");
  ok("C5", /for update skip locked/i.test(mig),
    "pega o job com FOR UPDATE SKIP LOCKED");
  ok("C6", /order by criado_em asc/i.test(mig),
    "processa o MAIS ANTIGO primeiro (a ordem do congelamento depende disso)");
  ok("C7", /revoke all on function public\.fn_materializacao_fila_processar\(int\) from service_role/i.test(mig),
    "o worker NAO e exposto ao service_role (pela API cairia nos mesmos 8s)");
  ok("C8", /cron\.schedule\(\s*\n?\s*'materializacao_fila'/i.test(mig) || /cron\.schedule\(\s*'materializacao_fila'/i.test(mig),
    "agenda o job 'materializacao_fila'");
  ok("C9", /status = 'ERRO'[\s\S]{0,400}sqlerrm/i.test(mig),
    "a falha do worker grava a mensagem CRUA (sqlerrm) na linha da fila");
  ok("C10", !/status\s*=\s*'PENDENTE'[\s\S]{0,200}exception/i.test(mig),
    "a linha que falhou NAO volta para PENDENTE (retry automatico de 40s viraria 4 falhas)");

  // --------------------------------------------------------------- D. o banco
  console.log("\n[D] o banco: tabela + RPC de diagnostico + job do cron ATIVO");
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    ok("D0", false,
      "credencial do Supabase ausente — needs-db sem banco REPROVA (nao passa por vacuidade)");
  } else {
    const sb = createClient(url, key, { auth: { persistSession: false } });

    const { data: linhas, error: erroFila } = await sb
      .from(real.TABELA_FILA)
      .select("id, origem, year, month, status, ms, congelamento_pendente, carteira_competencia_max, erro, criado_em")
      .order("criado_em", { ascending: false })
      .limit(10);
    if (erroFila) {
      ok("D1", false,
        "tabela " + real.TABELA_FILA + " NAO existe/legivel (" + (erroFila.code || "") + " " +
        erroFila.message + "). APLIQUE " + MIGRATION + " no Studio — sem ela a rota " +
        "enfileira para ninguem e a carteira PRT nunca mais e materializada");
    } else {
      ok("D1", true, "tabela " + real.TABELA_FILA + " existe e e legivel");
      console.log("       linhas na fila: " + (linhas || []).length +
        ((linhas || []).length === 0 ? "  (esperado ate o proximo import rodar)" : ""));
      for (const l of linhas || []) {
        console.log("         " + String(l.criado_em).slice(0, 19) + "  " + l.origem +
          "  " + l.year + "-" + String(l.month).padStart(2, "0") + "  " + l.status +
          "  " + (l.ms == null ? "-" : l.ms + "ms") +
          "  congelamento_pendente=" + l.congelamento_pendente +
          "  carteira_max=" + (l.carteira_competencia_max || "-") +
          (l.erro ? "  erro=" + l.erro : ""));
      }
      // O diagnostico do banco REAL, pela regra real. Fila doente aqui e achado,
      // nao falha do portao — mas tem de aparecer.
      const diagReal = real.diagnosticoFila(linhas || [], Date.now());
      ok("D2", diagReal.saudavel === true,
        diagReal.saudavel
          ? "a fila REAL esta saudavel (sem atraso, sem erro)"
          : "a fila REAL esta DOENTE: " + diagReal.mensagem);
    }

    let semDiagCron = false;
    const { data: diagCron, error: erroDiag } = await sb.rpc("fn_diag_materializacao_cron");
    if (erroDiag) {
      semDiagCron = true;
      ok("D3", false,
        "fn_diag_materializacao_cron NAO existe/executavel (" + (erroDiag.code || "") + " " +
        erroDiag.message + "). Sem ela nao ha como provar de FORA que o agendador esta vivo — " +
        "o PostgREST expoe apenas public e graphql_public");
    } else {
      const d = diagCron || {};
      ok("D3", true, "fn_diag_materializacao_cron responde");
      ok("D4", d.pg_cron_instalado === true,
        "pg_cron INSTALADO" + (d.pg_cron_versao ? " (versao " + d.pg_cron_versao + ")" : ""));
      const jobs = Array.isArray(d.jobs) ? d.jobs : [];
      const job = jobs.find((j) => j && j.jobname === real.JOB_CRON);
      ok("D5", !!job, "o job '" + real.JOB_CRON + "' esta registrado no cron.job");
      ok("D6", !!job && job.active === true,
        "o job esta ATIVO" + (job ? " (schedule '" + job.schedule + "')" : ""));
      ok("D7", !!job && /fn_materializacao_fila_processar/.test(String(job.command || "")),
        "o job chama fn_materializacao_fila_processar");
      const execs = Array.isArray(d.execucoes) ? d.execucoes : [];
      // NAO-VACUIDADE: job registrado que nunca rodou nao prova nada. Fica
      // vermelho ate a 1a execucao (1 min depois de aplicar a migration).
      ok("D8", execs.length > 0,
        execs.length > 0
          ? "o job JA EXECUTOU " + execs.length + " vez(es) registrada(s) — nao passa por vacuidade"
          : "o job NUNCA executou (cron.job_run_details vazio). Aplique a migration e espere 1 min");
      const falhou = execs.filter((e) => e && e.status && e.status !== "succeeded");
      ok("D9", falhou.length === 0,
        falhou.length === 0
          ? "nenhuma execucao registrada falhou"
          : falhou.length + " execucao(oes) do job falharam: " +
            falhou.slice(0, 3).map((e) => e.status + " " + (e.return_message || "")).join(" | "));
      for (const e of execs.slice(0, 5)) {
        console.log("         run " + e.runid + "  " + e.status + "  " +
          String(e.start_time).slice(0, 19) + " -> " + String(e.end_time || "").slice(0, 19) +
          (e.return_message ? "  " + e.return_message : ""));
      }
      console.log("       statement_timeout por role: " +
        JSON.stringify(d.statement_timeout_por_role || {}));
    }

    // O worker NAO pode ser chamavel pela API. Se este probe PASSAR (a RPC
    // responder), o grant sobrou e alguem vai chama-la pelo PostgREST — onde ela
    // cai nos mesmos 8s que esta frente veio contornar.
    const { error: erroWorker } = await sb.rpc("fn_materializacao_fila_processar", { p_max_jobs: 1 });
    // ARMADILHA: antes da migration esta chamada devolve PGRST202 ("funcao nao
    // encontrada") — o MESMO codigo que o revoke produz depois de aplicada. Ler
    // isso como "o revoke pegou" seria verde por vacuidade, entao a assercao so
    // vale quando a RPC de diagnostico existe (prova de que a migration rodou).
    if (semDiagCron) {
      console.log("  --   [D10] nao avaliavel ainda: sem a migration, a ausencia da funcao da o " +
        "MESMO PGRST202 que o revoke. Volta a valer quando D3 passar");
    } else {
      ok("D10", !!erroWorker,
        erroWorker
          ? "o worker NAO e chamavel pelo service_role, como projetado (" +
            (erroWorker.code || "") + ")"
          : "o worker RESPONDEU ao service_role — o revoke nao pegou e a chamada pela API " +
            "reintroduz o teto de 8s");
    }
  }

  console.log("\n" + "=".repeat(60));
  if (falhas.length === 0) {
    console.log("GATE materializacao_fila: PASSOU");
    process.exitCode = 0;
    return;
  }
  console.log("GATE materializacao_fila: REPROVOU (" + falhas.length + ")");
  for (const f of falhas) console.log("  - " + f);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error("GATE materializacao_fila: ERRO", e.message);
  process.exitCode = 1;
});
