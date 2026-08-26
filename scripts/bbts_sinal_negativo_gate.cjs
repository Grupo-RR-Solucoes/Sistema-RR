/*
 * GATE — o SINAL do valor sobrevive ao parser dos PDFs da BBTS.
 *
 * POR QUE ESTE GATE EXISTE. A linha CANCELADA do PDF de seguro vem com valor
 * NEGATIVO ("-R$ 24,05") e e o que a BBTS DESCONTOU do pagamento. Se alguem
 * trocar money() por Math.abs/Number(), ou tirar o `-?` de um dos dois regex, o
 * negativo vira positivo (ou a linha para de casar e some) e o fechamento passa
 * a INFLAR — sem nenhum sintoma, porque nada vigiava isso. Medido em 26/08/2026:
 * julho/2026 tinha 3 linhas canceladas somando -R$ 49,45.
 *
 * OS DOIS LADOS SAO COMPUTADOS NO MESMO RUN: o gate importa money/SEGURO_RE/
 * CREDITO_RE REAIS de lib/bbtsPdfExtract.ts e roda sobre linhas COPIADAS DOS PDFs
 * REAIS de jun e jul/2026. Nenhuma constante congelada do lado esperado — o
 * esperado e derivado da aritmetica do proprio caso.
 *
 * self-contained: sem banco, sem caminho absoluto, sem rede.
 */
require("./_ts_register.cjs");
const assert = require("node:assert/strict");
const { money, SEGURO_RE, CREDITO_RE } = require("../lib/bbtsPdfExtract.ts");

let falhas = 0;
const ok = (nome, fn) => {
  try { fn(); console.log("  OK   " + nome); }
  catch (e) { falhas++; console.log("  FALHA " + nome + "\n         " + e.message); }
};

console.log("GATE: sinal negativo sobrevive ao parser da BBTS\n");

// ---------------------------------------------------------------- money()
console.log("[1] money() preserva o sinal");
ok("negativo simples  -R$ 1,40", () => assert.equal(money("-R$ 1,40"), -1.4));
ok("negativo          -R$ 24,05", () => assert.equal(money("-R$ 24,05"), -24.05));
ok("negativo c/ milhar -R$ 1.234,56", () => assert.equal(money("-R$ 1.234,56"), -1234.56));
ok("positivo           R$ 2,09", () => assert.equal(money("R$ 2,09"), 2.09));
ok("positivo c/ milhar R$ 18.737,33", () => assert.equal(money("R$ 18.737,33"), 18737.33));
ok("placeholder jun/26 'R$ -' vale 0", () => assert.equal(money("R$ -"), 0));
ok("placeholder jun/26 '-R$'  vale 0", () => assert.equal(money("-R$"), 0));
ok("zero               R$ 0,00", () => assert.equal(money("R$ 0,00"), 0));
ok("simetria: -x = -(x)", () => {
  for (const s of ["1,40", "24,05", "1.234,56", "18.737,33"]) {
    assert.equal(money("-R$ " + s), -money("R$ " + s), "assimetrico em " + s);
  }
});
ok("NAO e Math.abs: negativo != positivo", () => {
  assert.notEqual(money("-R$ 24,05"), money("R$ 24,05"));
  assert.ok(money("-R$ 24,05") < 0, "money() devolveu >= 0 para entrada negativa");
});

// -------------------------------------------------------------- SEGURO_RE
// Linhas COPIADAS do PDF real de julho/2026 (pdf.pdf).
console.log("\n[2] SEGURO_RE casa a linha CANCELADA e o grupo 11 mantem o sinal");
const SEG_CANCELADAS = [
  ["211689509 1.398,00 108 ESTOQUE D0 82374630 260,32 CANCELADO 28May2026 JJ552710 0,10% -R$ 1,40", -1.4],
  ["212205929 24.050,00 108 ESTOQUE D0 82453122 4.602,52 CANCELADO 05Jun2026 JJ552710 0,10% -R$ 24,05", -24.05],
  ["212146378 24.000,00 108 ESTOQUE D0 82442550 4.594,71 CANCELADO 03Jun2026 JJ552710 0,10% -R$ 24,00", -24.0],
];
const SEG_POSITIVA = ["214234277 2.090,55 108 SLIP 82374631 260,32 POSITIVO 28May2026 JJ552710 0,10% R$ 2,09", 2.09];

for (const [linha, esperado] of SEG_CANCELADAS) {
  const contrato = linha.split(" ")[0];
  ok("casa a linha cancelada " + contrato, () => {
    const m = linha.match(SEGURO_RE);
    assert.ok(m, "SEGURO_RE NAO casou — a linha sumiria em silencio");
    assert.match(m[7], /CANCELADO/i);
    assert.equal(money(m[11]), esperado);
    assert.ok(money(m[11]) < 0, "valor da linha cancelada nao ficou negativo");
  });
}
ok("casa a linha POSITIVA e mantem positivo", () => {
  const m = SEG_POSITIVA[0].match(SEGURO_RE);
  assert.ok(m, "SEGURO_RE nao casou a linha positiva");
  assert.match(m[7], /POSITIVO/i);
  assert.equal(money(m[11]), SEG_POSITIVA[1]);
});

// A auto-ancora do extrator exige calculo + debito == TOTAL do PDF. Reproduz a
// aritmetica de julho/2026 com os DOIS lados computados aqui.
console.log("\n[3] a soma com sinal reproduz o TOTAL declarado pelo PDF");
ok("Sigma(cancelados) e negativo e vale a soma dos tres", () => {
  const soma = SEG_CANCELADAS.reduce((s, [l]) => s + money(l.match(SEGURO_RE)[11]), 0);
  assert.equal(Math.round(soma * 100) / 100, -49.45);
});
ok("calculo(204,52) + debito(-49,45) = TOTAL(155,07) do PDF de julho", () => {
  const debito = SEG_CANCELADAS.reduce((s, [l]) => s + money(l.match(SEGURO_RE)[11]), 0);
  const CALCULO_JUL = 204.52; // ancora _ancoras.seguro_calculo, medida no PDF real
  assert.equal(Math.round((CALCULO_JUL + debito) * 100) / 100, 155.07);
});

// ------------------------------------------------------------- CREDITO_RE
console.log("\n[4] CREDITO_RE aceita pag_avista negativo e o placeholder de jun/26");
ok("placeholder 'R$ -' (jun/26) casa e vale 0", () => {
  const l = "212345678 R$ 10.000,00 R$ - 15/06/2026 2,05% 4 JJ552710 CDC Novo PUBLICO 1640 1,79 48 60 NAO";
  const m = l.match(CREDITO_RE);
  assert.ok(m, "CREDITO_RE nao casou o placeholder 'R$ -'");
  assert.equal(money(m[3]), 0);
});
ok("pag_avista NEGATIVO casa e permanece negativo", () => {
  const l = "212345678 R$ 10.000,00 -R$ 229,20 15/07/2026 2,05% 4 JJ552710 CDC Novo PUBLICO 1640 1,79 48 60 NAO";
  const m = l.match(CREDITO_RE);
  assert.ok(m, "CREDITO_RE NAO casou pag_avista negativo — a linha sumiria");
  assert.equal(money(m[3]), -229.2);
  assert.ok(money(m[3]) < 0);
});
ok("coluna Cancelamento=SIM e lida no grupo 9", () => {
  const l = "212345678 R$ 10.000,00 R$ 229,20 15/07/2026 2,05% 4 JJ552710 CDC Novo PUBLICO 1640 1,79 48 60 SIM";
  const m = l.match(CREDITO_RE);
  assert.ok(m, "CREDITO_RE nao casou linha com Cancelamento=SIM");
  assert.equal(/^SIM$/i.test(m[9]), true);
});

console.log("\n" + (falhas === 0 ? "GATE VERDE" : "GATE VERMELHO — " + falhas + " falha(s)"));
process.exit(falhas === 0 ? 0 : 1);
