/**
 * Testes de lib/bbts/normalizarTextoPdf.ts — a LACUNA de glifo do PDF da BBTS.
 *
 * Como rodar (Node 24, strip-types):
 *   node --test lib/__tests__/normalizarTextoPdf.test.ts
 *
 * O helper e FOLHA (zero imports), entao roda nativamente sem loader e sem
 * resolucao do alias "@/" — a mesma propriedade que mantem o suite do
 * calcularDelta rodando. Nao importe nada com alias aqui.
 *
 * O RAMO AMBIGUA E O MOTIVO DESTE ARQUIVO. Os outros dois caminhos da eleicao
 * ficaram provados por execucao sobre o PDF real de julho/2026: 45 reconstruidas
 * e 7 sem-atestacao. AMBIGUA deu ZERO — nao porque nao aconteca, mas porque com
 * 70 palavras atestadas e 9 ligaduras o espaco e pequeno demais para dar empate.
 * Um ramo que nunca executou nao esta provado, entao aqui ele e forcado com
 * vocabulario sintetico.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  LACUNA,
  construirVocabulario,
  contemTermo,
  juntarFragmentosPdf,
  resolverLacunas,
} from "../bbts/normalizarTextoPdf.ts";

const NUL = String.fromCharCode(0);

// ---------------------------------------------------------------------------
// AMBIGUA — o ramo que o dado real nao exercitou
// ---------------------------------------------------------------------------

test("1) AMBIGUA: duas ligaduras atestadas -> mantem a lacuna e lista as candidatas", () => {
  // "BENEFICIO" (fi) e "BENEFLCIO" (fl) atestadas por fontes DIFERENTES: as duas
  // explicam "BENE<lacuna>CIO", entao nenhuma pode ser eleita.
  const vocab = construirVocabulario([
    { textos: ["BENEFICIO"], fonte: "corpus-banco" },
    { textos: ["BENEFLCIO"], fonte: "regua-competencia" },
  ]);

  const r = resolverLacunas("CDC Novo Bene" + LACUNA + "cio", vocab);

  assert.equal(r.texto.includes(LACUNA), true, "a lacuna tem de sobreviver");
  assert.equal(r.texto, "CDC Novo Bene" + LACUNA + "cio");
  assert.equal(r.decisoes.length, 1);
  assert.equal(r.decisoes[0].resultado, "ambigua");
  assert.deepEqual([...(r.decisoes[0].candidatas ?? [])].sort(), ["fi", "fl"]);
  assert.equal(r.decisoes[0].ligadura, undefined, "ambigua nao elege ligadura");
  assert.equal(r.decisoes[0].fontes, undefined, "ambigua nao registra fonte");
});

test("2) AMBIGUA some quando so uma das duas continua atestada", () => {
  // MESMA entrada do teste 1, com a segunda palavra fora do vocabulario.
  const vocab = construirVocabulario([{ textos: ["BENEFICIO"], fonte: "corpus-banco" }]);
  const r = resolverLacunas("CDC Novo Bene" + LACUNA + "cio", vocab);
  assert.equal(r.texto, "CDC Novo Beneficio");
  assert.equal(r.decisoes[0].resultado, "reconstruida");
  assert.equal(r.decisoes[0].ligadura, "fi");
  assert.deepEqual(r.decisoes[0].fontes, ["corpus-banco"]);
});

test("3) AMBIGUA com as duas fontes na MESMA palavra nao e ambiguidade", () => {
  // Duas fontes atestando a MESMA palavra e reforco, nao empate: elege e
  // registra as duas fontes. E o caso real de AUTOMATICO/BENEFICIO em julho.
  const vocab = construirVocabulario([
    { textos: ["AUTOMATICO"], fonte: "corpus-banco" },
    { textos: ["AUTOMATICO"], fonte: "regua-competencia" },
  ]);
  const r = resolverLacunas("CDC Novo Automa" + LACUNA + "co", vocab);
  assert.equal(r.decisoes[0].resultado, "reconstruida");
  assert.equal(r.decisoes[0].ligadura, "ti");
  assert.deepEqual([...(r.decisoes[0].fontes ?? [])].sort(), ["corpus-banco", "regua-competencia"]);
});

// ---------------------------------------------------------------------------
// SEM ATESTACAO e vocabulario
// ---------------------------------------------------------------------------

test("4) SEM ATESTACAO: vocabulario vazio mantem a lacuna", () => {
  const vocab = construirVocabulario([]);
  const r = resolverLacunas("CDC Novo Bene" + LACUNA + "cio", vocab);
  assert.equal(r.texto.includes(LACUNA), true);
  assert.equal(r.decisoes[0].resultado, "sem-atestacao");
});

test("5) texto COM lacuna nao vira vocabulario (nao se atesta sozinho)", () => {
  const vocab = construirVocabulario([
    { textos: ["BENE" + LACUNA + "CIO"], fonte: "corpus-banco" },
  ]);
  assert.equal(vocab.size, 0, "palavra com lacuna nao atesta nada");
});

// ---------------------------------------------------------------------------
// JUNCAO — o espaco espurio
// ---------------------------------------------------------------------------

test("6) o item de controle COLA os pedacos, sem espaco no meio da palavra", () => {
  const { texto, lacunas } = juntarFragmentosPdf(["Automa", NUL, "co"]);
  assert.equal(texto, "Automa" + LACUNA + "co");
  assert.equal(lacunas.length, 1);
  // o comportamento ANTIGO produzia "Automa co" — com espaco. E o defeito.
  assert.equal(texto.includes("Automa co"), false);
});

test("7) fragmentos normais continuam separados por espaco", () => {
  const { texto } = juntarFragmentosPdf(["Consignado -", "Novo"]);
  assert.equal(texto, "Consignado - Novo");
});

// ---------------------------------------------------------------------------
// MATCHER tolerante (o que sobra para a lacuna nao eleita)
// ---------------------------------------------------------------------------

test("8) contemTermo casa apesar da lacuna", () => {
  assert.equal(contemTermo("CDC Novo Automa" + LACUNA + "co", "AUTOMATICO"), true);
  assert.equal(contemTermo("CDC Novo Bene" + LACUNA + "cio", "BENEFICIO"), true);
  assert.equal(contemTermo("Corren" + LACUNA + "sta", "CORRENTISTA"), true);
});

test("9) contemTermo NAO casa o que a lacuna nao explica", () => {
  assert.equal(contemTermo("CDC Novo Automa" + LACUNA + "co", "PORTABILIDADE"), false);
  assert.equal(contemTermo("INSS Novo", "AUTOMATICO"), false);
});
