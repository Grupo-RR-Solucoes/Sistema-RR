// ============================================================================
// gate_teto_avista_rr.ts — GATE da divida latente 1 (teto a-vista 5,80%).
// Offline (nao toca o banco). Importa o MODULO REAL via _ts_register — nao uma
// copia transpilada a mao — entao o que passa aqui e o que roda em producao.
//
// Prova:
//   G1. Teto resolvido == 0.058 em TODA competencia viva (e no "CORRENTE").
//   G2. Cap novo == literal antigo, valor a valor, nos dois dialetos
//       (decimal 0.058 e percentual 5.8), bordas inclusas.
//   G3. Classificador novo == os DOIS literais antigos (0.058-0.00001 em
//       decimal e 5.8-0.001 em percentual), valor a valor.
//   G4. Nenhum literal de teto RR sobrou solto no codigo dos 5 arquivos.
//   G5. O teto da EMPRESA (6%) segue INTOCADO. Em duas metades:
//       (i)  INVARIANTE, nao negociavel: o motor nao importa tetoAvistaRR e
//            segue no cashCapPercent. Roda ANTES do ledger; nenhuma
//            justificativa a cobre.
//       (ii) LEDGER (31/08/2026): o conteudo dos arquivos protegidos tem de
//            bater com a impressao APROVADA em scripts/motor-protegido/.
//            Substituiu 'nao foi tocado nesta branch', que era assercao de
//            TRANSICAO e nao media NADA em main (diff vazio). O que isso
//            afrouxa esta dito em scripts/_ledgerProtegido.ts.
//
// Roda:
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/gate_teto_avista_rr.ts')"
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import {
  ARQUIVOS_PROTEGIDOS,
  assinaturaCorpo,
  impressaoDe,
  lerEntrada,
  lerEntradaEmRef,
} from "./_ledgerProtegido.ts";

import {
  tetoAvistaRR,
  tetoAvistaRRPercent,
  capAvistaRR,
  capAvistaRRPercent,
  isFaixaTetoAvistaRR,
  isFaixaTetoAvistaRRPercent,
  tetoAvistaRRSnapshots,
} from "@/lib/tetoAvistaRR.ts";

const ROOT = path.resolve(__dirname, "..");
let falhas = 0;
const ok = (m: string) => console.log("  OK   " + m);
const fail = (m: string) => { console.log("  FALHA " + m); falhas++; };

// ---------- G1 ----------
console.log("\n=== G1. Teto resolvido == 0.058 em toda competencia viva ===");
let g1 = true;
let comps = 0;
for (let y = 2022; y <= 2027; y++) {
  for (let m = 1; m <= 12; m++) {
    comps++;
    if (tetoAvistaRR({ year: y, month: m }) !== 0.058) {
      fail("teto != 0.058 em " + y + "-" + m); g1 = false;
    }
    if (tetoAvistaRRPercent({ year: y, month: m }) !== 5.8) {
      fail("tetoPercent != 5.8 em " + y + "-" + m); g1 = false;
    }
  }
}
if (tetoAvistaRR("CORRENTE") !== 0.058) { fail('teto != 0.058 em "CORRENTE"'); g1 = false; }
if (tetoAvistaRRPercent("CORRENTE") !== 5.8) { fail('tetoPercent != 5.8 em "CORRENTE"'); g1 = false; }
if (g1) ok("2022-01..2027-12 (" + comps + " competencias) + CORRENTE: 0.058 / 5.8");
console.log("  snapshots: " + JSON.stringify(tetoAvistaRRSnapshots()));

// ---------- G2 ----------
console.log("\n=== G2. Cap novo == literal antigo, valor a valor ===");
const capAntigoDecimal = (v: number) => Math.min(Math.max(v, 0), 0.058);
const capAntigoPercent = (v: number) => Math.min(Math.max(v, 0), 5.8);
let difDec = 0, difPct = 0, n = 0;
for (let i = -2000; i <= 12000; i++) {
  const dec = i / 100000;
  const pct = i / 1000;
  n++;
  if (capAvistaRR(dec, { year: 2026, month: 7 }) !== capAntigoDecimal(dec)) difDec++;
  if (capAvistaRRPercent(pct, { year: 2026, month: 7 }) !== capAntigoPercent(pct)) difPct++;
}
for (const v of [0.058, 0.0579999, 0.0580001, 0, -1, 0.06]) {
  n++;
  if (capAvistaRR(v, "CORRENTE") !== capAntigoDecimal(v)) difDec++;
}
for (const v of [5.8, 5.7999, 5.8001, 0, -1, 6]) {
  if (capAvistaRRPercent(v, "CORRENTE") !== capAntigoPercent(v)) difPct++;
}
if (difDec === 0) ok("dialeto DECIMAL: " + n + " valores, 0 divergencia");
else fail("dialeto DECIMAL: " + difDec + " divergencias");
if (difPct === 0) ok("dialeto PERCENTUAL: " + n + " valores, 0 divergencia");
else fail("dialeto PERCENTUAL: " + difPct + " divergencias");

// ---------- G3 ----------
console.log("\n=== G3. Classificador novo == os DOIS literais antigos ===");
const faixaAntigaClosing = (v: number) => v >= 0.058 - 0.00001;
const faixaAntigaProposal = (v: number) => v >= 5.8 - 0.001;
let difC = 0, difP = 0;
for (let i = -2000; i <= 12000; i++) {
  const dec = i / 100000;
  const pct = i / 1000;
  if (isFaixaTetoAvistaRR(dec, { year: 2026, month: 6 }) !== faixaAntigaClosing(dec)) difC++;
  if (isFaixaTetoAvistaRRPercent(pct, { year: 2026, month: 6 }) !== faixaAntigaProposal(pct)) difP++;
}
for (const v of [0.05799, 0.057991, 0.058, 0.0579899]) {
  if (isFaixaTetoAvistaRR(v, "CORRENTE") !== faixaAntigaClosing(v)) difC++;
}
for (const v of [5.799, 5.7991, 5.8, 5.7989]) {
  if (isFaixaTetoAvistaRRPercent(v, "CORRENTE") !== faixaAntigaProposal(v)) difP++;
}
if (difC === 0) ok("closingMonthly (0.058-0.00001): 0 divergencia");
else fail("closingMonthly: " + difC + " divergencias");
if (difP === 0) ok("proposalDetailing (5.8-0.001): 0 divergencia");
else fail("proposalDetailing: " + difP + " divergencias");
if (difC === 0 && difP === 0) {
  ok("confirmado: os dois epsilons eram EQUIVALENTES (1e-5 decimal == 1e-3 percentual)");
}

// ---------- G4 ----------
console.log("\n=== G4. Nenhum literal de teto RR solto ===");
for (const f of [
  "lib/bbtsMonthly.ts",
  "lib/closingMonthly.ts",
  "lib/proposalDetailing.ts",
  "lib/promoterAnalytics.ts",
]) {
  const s = fs.readFileSync(path.join(ROOT, f), "utf8");
  // so linhas de CODIGO — comentario cita o valor de proposito.
  const codigo = s.split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const achados = codigo.match(/(?<![\d.])(?:0\.058|5\.8)(?![\d])/g) || [];
  if (achados.length === 0) ok(f + " — sem literal de teto no codigo");
  else fail(f + " — ainda tem literal: " + achados.join(", "));
}

// ---------- G5 ----------
// Duas coisas DIFERENTES, e a ordem entre elas nao e estilo:
//
//   (i)  "o motor passou a importar a fonte do teto RR" -> PROIBIDO, SEMPRE.
//   (ii) "lib/motor.ts mudou"                           -> precisa ser
//        JUSTIFICADO no ledger, nao impossibilitado.
//
// Ate 31/08/2026 as duas eram tratadas como iguais e a (ii) reprovava cego. A
// decisao do Diego (31/08) foi trocar a (ii) por um pedagio com nome. A (i) NAO
// entrou nessa troca.
console.log("\n=== G5. Teto da EMPRESA (6%) intocado ===");

// ---------- G5 (i) — INVARIANTE, NAO NEGOCIAVEL ----------
// SE UM DIA ALGUEM APOSENTAR A (i) ACHANDO QUE A IMPRESSAO COBRE TUDO, O BLOCO
// VIRA TEATRO. A impressao do ledger prova que o conteudo e o APROVADO; ela nao
// le semantica e nao sabe o que o conteudo FAZ. Quem mede de verdade, com os
// dois lados computados neste run e sem constante congelada, e este bloco (i).
// Ele roda ANTES de qualquer entrada do ledger, de proposito: NENHUMA
// justificativa cobre o motor importar tetoAvistaRR.
{
  const motor = fs.readFileSync(path.join(ROOT, "lib/motor.ts"), "utf8");
  if (!/tetoAvistaRR/.test(motor)) ok("(i) lib/motor.ts NAO importa a fonte do teto RR");
  else fail("(i) lib/motor.ts passou a importar tetoAvistaRR — conceitos misturados. " +
            "NENHUMA entrada do ledger cobre isto: a (i) e invariante.");
  if (/cashCapPercent/.test(motor)) ok("(i) motor segue no cashCapPercent (teto Promotiva 6%)");
  else fail("(i) motor perdeu o cashCapPercent. NENHUMA entrada do ledger cobre isto.");
}

// ---------- G5 (ii) — LEDGER de conteudo aprovado ----------
// A pergunta antiga ("foi tocado nesta branch?") so tinha resposta DENTRO de uma
// branch: em main o diff origin/main...HEAD sai VAZIO e nao media nada — MEDIDO.
// A pergunta nova ("o conteudo de hoje e o APROVADO?") tem resposta sempre, e
// enxerga a ARVORE DE TRABALHO, nao o commitado.
// A regra de ouro de _diffContraRef.ts continua: comparacao que NAO PODE ser
// feita REPROVA (ver lerEntradaEmRef).
const REF_BASE = "origin/main";
console.log("\n=== G5 (ii). Conteudo protegido == conteudo APROVADO (ledger) ===");

// PROVA DA NORMALIZACAO — antes de usar a impressao para qualquer veredito.
// core.autocrlf=true e 709 de 1211 arquivos-fonte em CRLF nesta maquina; o CI
// roda em Linux. Sem CRLF->LF o mecanismo nasce quebrado e o portao passaria a
// reprovar por PLATAFORMA em vez de por conteudo.
{
  const lf = "linha um\nlinha dois\n";
  const crlf = "linha um\r\nlinha dois\r\n";
  if (impressaoDe(lf) === impressaoDe(crlf)) {
    ok("(ii) normalizacao: MESMO conteudo em CRLF e em LF da a MESMA impressao");
  } else {
    fail("(ii) normalizacao QUEBRADA: CRLF e LF dao impressoes diferentes — o " +
         "ledger reprovaria por plataforma, nao por conteudo");
  }
}

// AUTOTESTE DA REGRA "TROCOU SO O HASH" — controlado, e por que ele existe.
// A verificacao viva (mais abaixo) compara a entrada da arvore com a versao dela
// em origin/main. Na PRIMEIRA aprovacao de um arquivo essa versao nao existe, o
// estado e "ausente" e a regra fica INERTE — legitimamente, nao ha contra o que
// comparar. Sem este bloco, a condicao so passaria a ser exercida na SEGUNDA
// aprovacao, e ate la ninguem saberia se ela funciona. Aqui ela e medida HOJE,
// sobre entradas sinteticas, com os dois lados computados neste run.
{
  const cab = (h: string) =>
    "arquivo:   lib/motor.ts\nimpressao: sha256:" + h.repeat(64).slice(0, 64) +
    "\naprovado:  2026-08-31\nfrente:    autoteste\n\n---\n\n";
  const corpoA =
    "## O QUE MUDOU\nmudou X\n\n## POR QUE NAO TOCA O TETO DA EMPRESA\nporque Y\n\n" +
    "## O QUE MUDA DE COMPORTAMENTO\nnada\n";
  const corpoB = corpoA.replace("mudou X", "mudou Z");
  // mesma coisa, so espaco em branco e acento a mais: NAO pode contar como corpo novo
  const corpoA2 = corpoA.replace("mudou X", "mudou   X").replace("porque Y", "porqué Y");

  const iguais = (x: string, y: string) =>
    assinaturaCorpo(lerEntrada(x).corpo) === assinaturaCorpo(lerEntrada(y).corpo);

  if (iguais(cab("a") + corpoA, cab("b") + corpoA)) {
    ok("(ii) autoteste: hash novo + corpo IDENTICO e detectado (assinatura do corpo bate)");
  } else {
    fail("(ii) autoteste: hash novo com corpo identico NAO seria detectado — a condicao " +
         "'trocar so o hash reprova' esta quebrada");
  }
  if (!iguais(cab("a") + corpoA, cab("b") + corpoB)) {
    ok("(ii) autoteste: hash novo + corpo REESCRITO passa (nao ha falso positivo)");
  } else {
    fail("(ii) autoteste: corpo reescrito foi tratado como identico — a regra reprovaria " +
         "aprovacao legitima");
  }
  if (iguais(cab("a") + corpoA, cab("b") + corpoA2)) {
    ok("(ii) autoteste: mexer so em espaco/acento NAO conta como corpo novo");
  } else {
    fail("(ii) autoteste: espaco/acento contou como corpo novo — a saida que a condicao " +
         "existe para fechar esta aberta");
  }
}

for (const { arquivo, entrada } of ARQUIVOS_PROTEGIDOS) {
  const abs = path.join(ROOT, arquivo);
  const absEntrada = path.join(ROOT, entrada);

  if (!fs.existsSync(abs)) { fail("(ii) arquivo protegido " + arquivo + " NAO existe"); continue; }
  if (!fs.existsSync(absEntrada)) {
    fail("(ii) " + arquivo + " e protegido e NAO tem entrada no ledger (" + entrada +
         "). Protegido sem aprovacao REPROVA.");
    continue;
  }

  const e = lerEntrada(fs.readFileSync(absEntrada, "utf8"));

  if (e.problemas.length > 0) {
    fail("(ii) " + entrada + " malformada: " + e.problemas.join("; ")); continue;
  }
  if (e.arquivo !== arquivo) {
    fail("(ii) " + entrada + " diz 'arquivo: " + e.arquivo + "' mas esta registrada para " +
         arquivo + " — entrada sem arquivo correspondente REPROVA");
    continue;
  }
  if (e.secoesFaltando.length > 0) {
    fail("(ii) " + entrada + " sem as secoes obrigatorias (ausentes ou VAZIAS): " +
         e.secoesFaltando.join(", ") + ". O portao nao le semantica, mas exige que a " +
         "pergunta tenha sido respondida.");
    continue;
  }

  const calculada = impressaoDe(fs.readFileSync(abs, "utf8"));
  if (calculada !== e.impressao) {
    fail("(ii) " + arquivo + " mudou e a mudanca NAO esta aprovada.\n" +
         "          calculada : " + calculada + "\n" +
         "          aprovada  : " + e.impressao + "  (" + entrada + ", aprovada em " + e.aprovado + ")\n" +
         "        Este arquivo calcula toda a comissao. Para seguir, atualize a entrada:\n" +
         "        troque a impressao E reescreva o corpo dizendo O QUE mudou linha a linha.\n" +
         "        Substituir so o hash e o defeito que este bloco existe para pegar.");
    continue;
  }

  // "Trocou so o hash" — o corpo TEM de mudar quando a impressao muda. So faz
  // sentido durante uma branch (em main os dois lados sao o mesmo arquivo e a
  // comparacao e no-op); a protecao PERMANENTE e a impressao x arquivo, acima.
  const noRef = lerEntradaEmRef(ROOT, REF_BASE, entrada);
  if (noRef.estado === "naoMediu") { fail("(ii) " + noRef.mensagem); continue; }
  if (noRef.estado === "ausente") {
    ok("(ii) " + arquivo + " == aprovado (" + entrada + ", PRIMEIRA aprovacao — nao existe em " +
       REF_BASE + ")");
  } else {
    const anterior = lerEntrada(noRef.texto);
    if (anterior.impressao !== e.impressao &&
        assinaturaCorpo(anterior.corpo) === assinaturaCorpo(e.corpo)) {
      fail("(ii) " + entrada + ": a impressao mudou (" + anterior.impressao + " -> " +
           e.impressao + ") mas o CORPO esta INTACTO. Trocar so o hash e exatamente o que " +
           "este bloco existe para pegar — diga O QUE mudou.");
      continue;
    }
    ok("(ii) " + arquivo + " == aprovado (" + entrada + ", aprovada em " + e.aprovado + ")");
  }

  // ECOA o corpo: quem le o CI VERDE precisa ver o que foi aprovado, nao um OK.
  console.log("        +-- aprovacao vigente de " + arquivo + "  [" + e.frente + "]");
  for (const linha of e.corpo.replace(/\n{3,}/g, "\n\n").trim().split("\n")) {
    console.log("        | " + linha);
  }
  console.log("        +--");
}

// Entrada ORFA: existe no ledger e nao corresponde a nenhum protegido.
{
  const registradas = new Set(ARQUIVOS_PROTEGIDOS.map((x) => path.basename(x.entrada)));
  const dir = path.join(ROOT, "scripts/motor-protegido");
  const achadas = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md")
    : [];
  const orfas = achadas.filter((f) => !registradas.has(f));
  if (orfas.length === 0) {
    ok("(ii) nenhuma entrada orfa (" + achadas.length + " entrada(s), " +
       registradas.size + " protegido(s))");
  } else {
    fail("(ii) entrada(s) SEM arquivo protegido correspondente: " + orfas.join(", ") +
         ". Entrada que nao aprova nada e aprovacao que ninguem le — REPROVA.");
  }
}

console.log("\n=== RESULTADO: " +
  (falhas === 0 ? "GATE PASSOU (no-op provado)" : falhas + " FALHA(S)") + " ===");
process.exit(falhas === 0 ? 0 : 1);
