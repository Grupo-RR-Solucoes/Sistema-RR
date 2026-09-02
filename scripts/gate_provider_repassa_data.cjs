/*
 * GATE — TODO PROVIDER REPASSA A contractDate (a classe "provider sem data").
 * 02/09/2026. READ-ONLY e SELF-CONTAINED: sem banco, sem env, sem PDF.
 *
 * A CLASSE, e por que ela merece um portao proprio. Em 24 horas o MESMO defeito
 * apareceu tres vezes: nos 28 diagnosticos (nomeado — e a nota estava ERRADA,
 * ver o handoff), no meu proprio script de medicao, e num PORTAO REGISTRADO que
 * acusou a producao de uma divergencia que ela nao tem. Anatomia identica nos
 * tres: construidos ANTES da Fase 1, corretos num mundo de UMA regua por
 * competencia, e silenciosamente errados a partir de 01/09/2026 as 23:04, quando
 * agosto virou a primeira competencia PARTIDA da historia. Nenhum quebrou —
 * todos passaram a responder a pergunta errada com cara de resposta certa.
 *
 * A REGRA, e o teste e uma pergunta so: o provider repassa a `contractDate`?
 *
 * MAS SAO DUAS FORMAS, e este portao so vigia a (a):
 *   (a) resolucao POR CONTRATO   -> faltar a data E o defeito. Vigiada aqui.
 *   (b) inspecao da REGUA DO MES -> passar data NAO e o conserto; numa
 *       competencia partida nao existe *a* regua, existem duas, e e preciso
 *       ITERAR TODAS. Nao da para ver isso contando argumentos — fica com os
 *       proprios gates (trp_prazo_min_gate, trp_tx_juros_min_gate), que foram
 *       convertidos em 02/09 e imprimem quantas fatias acharam.
 *
 * BLOCOS
 *   1) O SCANNER (funcao pura) contra fixtures — inclusive as formas que ele
 *      TEM de ignorar (declaracao de interface, comentario) e as que TEM de
 *      pegar (1 argumento, com espaco, com quebra de linha).
 *   2) MUTACAO: um scanner que nao conta argumentos aprovaria a chamada sem
 *      data. Os dois vereditos TEM de divergir na MESMA fixture.
 *   3) PRODUCAO — a assercao dura: nenhum sitio de lib/, app/ ou components/
 *      chama com 1 argumento. Hoje: 5 sitios, todos com data.
 *   4) scripts/ — ALLOWLIST ASSINADO. Quem fica sem data precisa de um motivo
 *      ESCRITO aqui. A lista nasce VAZIA (os 4 sitios foram consertados em
 *      01-02/09), e entrada morta REPROVA: se o arquivo foi consertado e
 *      continua na lista, a lista apodreceu.
 *   5) NAO-VACUIDADE: se a varredura nao achar NENHUMA chamada, o portao
 *      reprova em vez de passar por vazio.
 *
 * LIMITE HONESTO, dito aqui porque ninguem vai lembrar: isto casa DUAS funcoes
 * por nome. Um terceiro caminho de resolucao, com outro nome, passa invisivel —
 * e a unica defesa continua sendo a regra escrita no handoff.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIRS_PRODUCAO = ["lib", "app", "components"];
const DIRS_SCRIPTS = ["scripts"];

/**
 * ALLOWLIST ASSINADO — sitios de scripts/ que podem chamar SEM data.
 * Chave: caminho relativo. Valor: o motivo, escrito por quem decidiu.
 * VAZIA de proposito em 02/09/2026: os quatro sitios que existiam foram
 * consertados (2 de forma (a) ganharam a data; 2 de forma (b) passaram a iterar
 * as fatias). Entrar aqui exige escrever o porque; sair exige consertar.
 */
const ALLOWLIST = new Map([
  // ["scripts/exemplo.cjs", "motivo escrito por quem decidiu"],
]);

/**
 * Arquivos onde as duas funcoes sao DECLARADAS ou pertencem a outra familia —
 * nao sao chamadas de provider e nao entram na varredura.
 */
const FORA = new Set([
  // a propria definicao do preloader da TRP (declara e implementa, nao chama)
  "lib/trp/resolveTrpRegraDb.ts",
  // ESTE PROPRIO ARQUIVO: as fixtures do bloco 1 sao chamadas SEM data escritas
  // de proposito, em string. Medi-las seria o portao reprovando a si mesmo pelo
  // material de teste — foi o que aconteceu na 1a execucao, 02/09/2026.
  "scripts/gate_provider_repassa_data.cjs",
  // outra FAMILIA: o resolvedor da regua da BBTS. A regua BBTS nao tem vigencia
  // intra-mes — nao existe fatia a escolher, entao a assinatura de 1 argumento
  // esta certa la. Se um dia a BBTS ganhar vigencia partida, este arquivo sai
  // desta lista e o portao passa a exigir a data la tambem.
  "lib/bbts/resolveBbtsRegra.ts",
]);

let falhas = 0;
function ok(cond, nome, det) {
  if (!cond) falhas += 1;
  console.log(`  ${cond ? "OK " : "XX "} ${nome}${det ? ` — ${det}` : ""}`);
}
const eq = (nome, got, want) => ok(got === want, nome, `got=${got} want=${want}`);
const linha = (c) => c.repeat(72);

// ---------------------------------------------------------------------------
// O SCANNER — funcao PURA sobre o texto. E o que a mutacao do bloco 2 ataca.
// ---------------------------------------------------------------------------

/** Remove comentarios de linha e de bloco, para nao medir prosa. */
function semComentarios(txt) {
  return txt.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Acha CHAMADAS de provider e conta os argumentos de topo.
 *
 * So casa com RECEPTOR (`.getResolvedSync(`): sem o ponto seria declaracao de
 * interface ou implementacao em objeto literal, que nao sao chamadas. E a
 * contagem e por profundidade de parenteses/colchetes/chaves, nao por split(",")
 * — `getResolvedSync(c, cd ?? null)` e 2, e `getResolvedSync(f(a, b))` e 1.
 */
function analisarFonte(txt) {
  const limpo = semComentarios(txt);
  const achados = [];
  // `\.\s*` tolera `preload . getRegraSync(` — raro, mas a alternativa e um
  // buraco silencioso, que e a doenca que este portao existe para vigiar.
  const re = /\.\s*(getResolvedSync|getRegraSync)\s*\(/g;
  let m;
  while ((m = re.exec(limpo)) !== null) {
    const inicio = re.lastIndex; // logo depois do "("
    let prof = 0, nArgs = 1, vazio = true, i = inicio;
    // `depoisDaVirgula` guarda se o ULTIMO segmento tem conteudo: sem isto, a
    // virgula final de `f(a, b,)` (legal em JS) inflaria a contagem — e um
    // `f(c,)` de 1 argumento passaria como se tivesse 2.
    let depoisDaVirgula = true;
    for (; i < limpo.length; i++) {
      const ch = limpo[i];
      if (ch === "(" || ch === "[" || ch === "{") prof++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        if (prof === 0 && ch === ")") break;
        prof--;
      } else if (ch === "," && prof === 0) { nArgs++; depoisDaVirgula = false; }
      if (!/\s/.test(ch)) { vazio = false; if (ch !== ",") depoisDaVirgula = true; }
    }
    if (!depoisDaVirgula) nArgs--; // virgula final nao e argumento
    const linhaNum = limpo.slice(0, m.index).split("\n").length;
    achados.push({ fn: m[1], linha: linhaNum, nArgs: vazio ? 0 : nArgs });
  }
  return achados;
}

/** Varre um diretorio, devolvendo [{rel, linha, fn, nArgs}]. */
function varrer(dirs) {
  const out = [];
  const anda = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      if (nome === "node_modules" || nome === ".next" || nome.startsWith(".git")) continue;
      const p = path.join(dir, nome);
      const st = fs.statSync(p);
      if (st.isDirectory()) anda(p);
      else if (/\.(ts|tsx|cjs|mts|mjs|js)$/.test(nome)) {
        const rel = path.relative(ROOT, p).replace(/\\/g, "/");
        if (FORA.has(rel)) continue;
        for (const a of analisarFonte(fs.readFileSync(p, "utf8"))) out.push({ rel, ...a });
      }
    }
  };
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) anda(abs);
  }
  return out;
}

console.log("===== GATE — todo provider repassa a contractDate =====\n");

// =============================================================== BLOCO 1
console.log("1) O SCANNER (funcao pura) contra fixtures");
console.log(linha("-"));
{
  const pega1 = analisarFonte(`const p = (c) => preloader.getResolvedSync(c);`);
  eq("pega chamada com 1 argumento", pega1.length && pega1[0].nArgs, 1);
  const pega2 = analisarFonte(`const p = (c, cd) => preloader.getResolvedSync(c, cd ?? null);`);
  eq("pega chamada com 2 argumentos", pega2.length && pega2[0].nArgs, 2);
  const espaco = analisarFonte(`preload . getRegraSync ( COMP )`);
  eq("tolera espaco antes do parentese", espaco.length && espaco[0].nArgs, 1);
  const quebra = analisarFonte(`preloader.getResolvedSync(\n  competencia,\n  contractDate ?? null,\n)`);
  eq("conta argumentos quebrados em varias linhas (com virgula final)",
    quebra.length && quebra[0].nArgs, 2);
  const comVirgulaFinal = analisarFonte(`preloader.getRegraSync(c,)`);
  eq("virgula FINAL nao vira argumento (f(c,) e 1, nao 2)",
    comVirgulaFinal.length && comVirgulaFinal[0].nArgs, 1);
  const aninhado = analisarFonte(`preloader.getRegraSync(fn(a, b))`);
  eq("virgula ANINHADA nao vira argumento", aninhado.length && aninhado[0].nArgs, 1);

  // o que ele TEM de ignorar
  eq("ignora declaracao de interface (sem receptor)",
    analisarFonte(`  getResolvedSync(competencia: string): X | null;`).length, 0);
  eq("ignora comentario de linha",
    analisarFonte(`// antes fazia preloader.getResolvedSync(c) e estava errado`).length, 0);
  eq("ignora comentario de bloco",
    analisarFonte(`/* preloader.getResolvedSync(c) */`).length, 0);
}

// =============================================================== BLOCO 2
console.log("\n2) MUTACAO — um scanner que nao conta argumentos aprova o defeito");
console.log(linha("-"));
{
  const FIXTURE = `const p = (c) => preloader.getResolvedSync(c);`;
  const real = analisarFonte(FIXTURE).filter((a) => a.nArgs < 2);
  // o mutante: acha a chamada e nao olha os argumentos (o portao "existe, logo ok")
  const mutante = (txt) => (/\.(getResolvedSync|getRegraSync)\s*\(/.test(txt) ? [] : ["ausente"]);
  eq("real:    a fixture sem data e REPROVADA", real.length, 1);
  eq("mutante: a mesma fixture PASSA", mutante(FIXTURE).length, 0);
  ok(real.length !== mutante(FIXTURE).length,
    "os dois vereditos divergem na MESMA fixture — a contagem de argumentos esta sendo medida");
  // e o controle no sentido inverso: com a data, os dois concordam que esta ok
  const comData = analisarFonte(`preloader.getResolvedSync(c, cd ?? null)`).filter((a) => a.nArgs < 2);
  eq("CONTROLE: chamada COM data nao e reprovada por nenhum dos dois", comData.length, 0);
}

// =============================================================== BLOCO 3
console.log("\n3) PRODUCAO — nenhum sitio de lib/, app/ ou components/ sem data");
console.log(linha("-"));
const prod = varrer(DIRS_PRODUCAO);
{
  const semData = prod.filter((a) => a.nArgs < 2);
  for (const a of prod) console.log(`     ${a.rel}:${a.linha} ${a.fn} -> ${a.nArgs} arg(s)`);
  ok(semData.length === 0,
    "ASSERCAO DURA: 0 chamadas de producao sem contractDate",
    semData.length ? JSON.stringify(semData) : `${prod.length} chamada(s), todas com data`);
}

// =============================================================== BLOCO 4
console.log("\n4) scripts/ — allowlist ASSINADO (e sem entrada morta)");
console.log(linha("-"));
const scr = varrer(DIRS_SCRIPTS);
{
  const semData = scr.filter((a) => a.nArgs < 2);
  for (const a of semData) console.log(`     ${a.rel}:${a.linha} ${a.fn} -> ${a.nArgs} arg(s)`);
  const naoAssinados = semData.filter((a) => !ALLOWLIST.has(a.rel));
  ok(naoAssinados.length === 0,
    "todo sitio de scripts/ sem data esta ASSINADO na allowlist",
    naoAssinados.length
      ? JSON.stringify(naoAssinados.map((a) => `${a.rel}:${a.linha}`))
      : `${semData.length} sem data, ${ALLOWLIST.size} assinado(s)`);

  // ENTRADA MORTA: consertou e nao tirou da lista -> a lista apodreceu.
  const comProblema = new Set(semData.map((a) => a.rel));
  const mortas = [...ALLOWLIST.keys()].filter((k) => !comProblema.has(k));
  ok(mortas.length === 0,
    "nenhuma entrada MORTA na allowlist (arquivo consertado tem de sair da lista)",
    mortas.length ? JSON.stringify(mortas) : `${ALLOWLIST.size} entrada(s)`);
}

// =============================================================== BLOCO 5
console.log("\n5) NAO-VACUIDADE — a varredura achou sobre o que falar?");
console.log(linha("-"));
{
  const total = prod.length + scr.length;
  ok(prod.length > 0,
    "ha chamadas de provider em PRODUCAO para medir (senao o bloco 3 passa por vazio)",
    `${prod.length} em producao, ${scr.length} em scripts/`);
  ok(total >= 5,
    "o universo tem tamanho plausivel (a varredura nao quebrou em silencio)",
    `${total} chamada(s)`);
}

console.log("\n" + (falhas === 0 ? "GATE OK (0 falhas)" : `GATE FALHOU (${falhas} falha(s))`));
process.exitCode = falhas === 0 ? 0 : 1;
