/*
 * GATE — os TRES layouts do PDF de seguro da BBTS, e o "#N/D" do PRT.
 *
 * POR QUE ESTE GATE EXISTE. Em 30/08/2026 o extrator recusava 3 dos 4 PDFs de
 * fechamento de abril e maio/2026 da ADS — competencias que nunca entraram no
 * sistema. As causas eram tres afrouxamentos que faltavam, e nenhum deles tinha
 * vigia:
 *   1. a ancora do TOTAL do seguro so conhecia o cabecalho "PAGAMENTO DESCONTO
 *      TOTAL"; 04/26 escreve "Valor pagamento Total";
 *   2. a SEGURO_RE so conhecia UM arranjo de colunas; a BBTS emite tres, que
 *      variam em 3 eixos independentes (prefixo "R$ ", coluna de data, posicao
 *      da chave J);
 *   3. a PRT_RE exigia digito na "N. da parcela"; 05/26 manda "#N/D" nas 7.
 *
 * O QUE ELE GUARDA, E O QUE ELE **NAO** GUARDA. Ele guarda que a LINHA aceita as
 * formas reais. Ele NAO afrouxa a conferencia: a Sigma continua tendo de bater a
 * ancora do proprio documento, e as duas ultimas secoes existem para provar
 * exatamente isso — layout perfeito com valor que NAO fecha tem de ABORTAR.
 * Aceitar mais forma de linha nao aceita mais valor.
 *
 * FIXTURES SINTETICAS, POR OBRIGACAO. O repositorio e PUBLICO. Nenhuma linha
 * aqui e copiada de PDF de cliente: os contratos sao 9xxxxxxxx, as apolices
 * 9xxxxxxx, a chave e JJ999999 e os valores foram inventados de modo a fechar a
 * aritmetica do proprio caso. O que se preserva do documento e a FORMA (ordem
 * das colunas, presenca/ausencia de cada uma, formato da data), que e o que o
 * parser le. As tres formas foram medidas nos PDFs de 04, 05 e 07/2026.
 *
 * PROVA POR MUTACAO, NOS DOIS SENTIDOS. Cada afrouxamento e revertido
 * individualmente (secao 6) e tem de DERRUBAR pelo menos uma fixture — um
 * afrouxamento que nao e exercido por nenhum caso nao deveria existir. E a
 * secao 7 prova o contrario: o documento mal formado continua abortando.
 *
 * self-contained: sem banco, sem rede, sem caminho absoluto, sem PDF em disco.
 * E por isso que parseSeguroLines/parsePrtSection sao funcoes PURAS de linhas.
 */
require("./_ts_register.cjs");
const assert = require("node:assert/strict");
const {
  SEGURO_RE,
  PRT_RE,
  nParcelaPrt,
  parseSeguroLines,
  parsePrtSection,
  BbtsPdfError,
} = require("../lib/bbtsPdfExtract.ts");

let falhas = 0;
const ok = (nome, fn) => {
  try { fn(); console.log("  OK   " + nome); }
  catch (e) { falhas++; console.log("  FALHA " + nome + "\n         " + e.message); }
};
/** Assere que `fn` LANCA BbtsPdfError e que a mensagem fala do assunto certo. */
const aborta = (nome, rxMensagem, fn) => {
  ok(nome, () => {
    let erro = null;
    try { fn(); } catch (e) { erro = e; }
    assert.ok(erro, "NAO lancou — o documento invalido teria sido aceito");
    assert.ok(erro instanceof BbtsPdfError, "lancou " + erro.constructor.name + ", nao BbtsPdfError");
    assert.match(erro.message, rxMensagem);
  });
};

// ===========================================================================
// FIXTURES — a FORMA de cada layout, com numeros inventados.
// ===========================================================================
// Layout A (07/26): sem "R$ " nas duas colunas numericas, data compacta
//                   (03Jun2026), CHAVE J NO MEIO (antes do percentual).
// Layout B (05/26): COM "R$ ", data dd/mm/aaaa, CHAVE J NO MEIO.
// Layout C (04/26): COM "R$ ", SEM coluna de data, CHAVE J NO FIM.
const LIN_A = "900000001 10.000,00 96 ESTOQUE D0 90000001 1.500,00 POSITIVO 03Jun2026 JJ999999 0,10% R$ 10,00";
const LIN_B = "900000002 R$ 20.000,00 96 ESTOQUE D0 90000002 R$ 3.000,00 POSITIVO 05/05/2026 JJ999999 0,10% R$ 20,00";
const LIN_C = "900000003 R$ 30.000,00 96 ESTOQUE D0 90000003 R$ 4.500,00 POSITIVO 0,10% R$ 30,00 JJ999999";
// Layout C com CANCELADO: valor NEGATIVO, chave J no fim (o caso que junta os
// dois riscos — sinal e posicao da chave).
const LIN_C_CANC = "900000004 R$ 40.000,00 96 SLIP 90000004 R$ 6.000,00 CANCELADO 0,10% -R$ 40,00 JJ999999";

/** Documento de seguro completo: cabecalho da NF + linha de valores + linhas. */
const docSeguro = (cabecalho, valores, linhas) => [
  "Encontra-se disponivel o pagamento referente as propostas de seguros.",
  "Valor para Emissao da Nota Fiscal* (Pagamento total no mes 04/26):",
  cabecalho,
  valores,
  "Contrato Valor Total do Credito Quantidade de Parcelas Tipo de Seguro Apolice",
].concat(linhas);
const CAB_DESCONTO = "CNPJ RAZAO SOCIAL PAGAMENTO DESCONTO TOTAL";
const CAB_VALOR_PGTO = "CNPJ RAZAO SOCIAL Valor pagamento Total";

/** Documento de credito, so a secao PRT (e o que parsePrtSection le). */
const docPrt = (linhas) => [
  "Informamos o extrato referente ao mes 05/26",
  "Propostas do PAGAMENTO PRT:",
  "N. do Contrato Data N. da parcela PRT Valor da parcela PRT Qt. da parcela PRT",
].concat(linhas, ["Abertura de Conta:"]);

console.log("GATE: os tres layouts do PDF da BBTS (seguro) + '#N/D' no PRT\n");

// ===========================================================================
console.log("[1] SEGURO_RE casa os tres layouts, e le os MESMOS campos em todos");
// ---------------------------------------------------------------------------
const campos = (linha) => {
  const m = linha.match(SEGURO_RE);
  assert.ok(m, "SEGURO_RE nao casou a linha");
  return { contrato: m[1], valorTotal: m[2], tipo: m[4], status: m[7], pago: m[11] };
};
ok("layout A (sem 'R$ ', data compacta, chave J no MEIO)", () => {
  assert.deepEqual(campos(LIN_A), { contrato: "900000001", valorTotal: "10.000,00", tipo: "ESTOQUE D0", status: "POSITIVO", pago: "R$ 10,00" });
});
ok("layout B (com 'R$ ', data dd/mm/aaaa, chave J no MEIO)", () => {
  assert.deepEqual(campos(LIN_B), { contrato: "900000002", valorTotal: "20.000,00", tipo: "ESTOQUE D0", status: "POSITIVO", pago: "R$ 20,00" });
});
ok("layout C (com 'R$ ', SEM data, chave J no FIM)", () => {
  assert.deepEqual(campos(LIN_C), { contrato: "900000003", valorTotal: "30.000,00", tipo: "ESTOQUE D0", status: "POSITIVO", pago: "R$ 30,00" });
});
ok("layout C + CANCELADO: casa, e o valor continua NEGATIVO", () => {
  const c = campos(LIN_C_CANC);
  assert.equal(c.status.toUpperCase(), "CANCELADO");
  assert.equal(c.pago, "-R$ 40,00");
});
ok("o 'R$ ' do Valor Total NAO entra no grupo capturado", () => {
  // Se entrasse, o grupo deixaria de ser comparavel entre layouts — e e por
  // igualdade de FORMA do grupo que as tres assercoes acima passam juntas.
  assert.equal(campos(LIN_B).valorTotal, "20.000,00");
  assert.equal(campos(LIN_C).valorTotal, "30.000,00");
});

// ===========================================================================
console.log("\n[2] a ancora TOTAL e achada nos DOIS cabecalhos");
// ---------------------------------------------------------------------------
ok("cabecalho 'PAGAMENTO DESCONTO TOTAL' (05/26, 07/26) — TOTAL e a ULTIMA coluna", () => {
  const r = parseSeguroLines(docSeguro(CAB_DESCONTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 30,00 R$ 0,00 R$ 30,00", [LIN_A, LIN_B]));
  assert.equal(r.totalAnchor, 30);
  assert.equal(r.rows.length, 2);
});
ok("cabecalho 'Valor pagamento Total' (04/26) — uma coluna so", () => {
  const r = parseSeguroLines(docSeguro(CAB_VALOR_PGTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 30,00", [LIN_C]));
  assert.equal(r.totalAnchor, 30);
  assert.equal(r.rows.length, 1);
});
ok("'Valor pagamento Total' SEM o contexto 'RAZAO SOCIAL' NAO vira ancora", () => {
  // O padrao e generico demais solto; se casasse qualquer linha do corpo, o
  // TOTAL sairia do lugar errado e a conferencia perderia o sentido.
  let erro = null;
  try { parseSeguroLines(docSeguro("Valor pagamento Total", "R$ 999,00", [LIN_C])); } catch (e) { erro = e; }
  assert.ok(erro, "casou um cabecalho sem contexto — ancora frouxa demais");
});

// ===========================================================================
console.log("\n[3] parseSeguroLines: tratamento e Sigma");
// ---------------------------------------------------------------------------
ok("POSITIVO vira 'calculo' e CANCELADO vira 'debito'", () => {
  const r = parseSeguroLines(docSeguro(CAB_VALOR_PGTO, "90000000000000 EMPRESA FIXTURE LTDA -R$ 10,00", [LIN_C, LIN_C_CANC]));
  const porContrato = Object.fromEntries(r.rows.map((x) => [x.contrato, x.tratamento]));
  assert.equal(porContrato["900000003"], "calculo");
  assert.equal(porContrato["900000004"], "debito");
});
ok("a Sigma soma calculo + debito, e o debito ABATE (30 - 40 = -10)", () => {
  const r = parseSeguroLines(docSeguro(CAB_VALOR_PGTO, "90000000000000 EMPRESA FIXTURE LTDA -R$ 10,00", [LIN_C, LIN_C_CANC]));
  assert.equal(r.totalAnchor, -10);
  assert.equal(r.rows.reduce((a, x) => a + x.valor_seguro, 0), -10);
});
ok("os tres layouts convivem no MESMO documento", () => {
  const r = parseSeguroLines(docSeguro(CAB_DESCONTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 60,00 R$ 0,00 R$ 60,00", [LIN_A, LIN_B, LIN_C]));
  assert.equal(r.rows.length, 3);
  assert.equal(r.totalAnchor, 60);
});

// ===========================================================================
console.log("\n[4] PRT_RE aceita '#N/D' na parcela, sem perder o numero quando ele vem");
// ---------------------------------------------------------------------------
const PRT_ND = "900000005 01/06/2026 #N/D R$ 3,00 #N/D";
const PRT_NUM = "900000006 01/06/2026 2 R$ 4,00 12";
ok("'#N/D' casa e vira n_parcela = 0 (o codigo de 'nao informado')", () => {
  const m = PRT_ND.match(PRT_RE);
  assert.ok(m, "PRT_RE nao casou a parcela '#N/D'");
  assert.equal(nParcelaPrt(m[3]), 0);
});
ok("numero continua sendo o numero (2 nao vira 0)", () => {
  const m = PRT_NUM.match(PRT_RE);
  assert.ok(m, "PRT_RE nao casou a parcela numerica");
  assert.equal(nParcelaPrt(m[3]), 2);
});
ok("0 NAO e parcela real: as parcelas do documento comecam em 1", () => {
  assert.equal(nParcelaPrt("1"), 1);
  assert.notEqual(nParcelaPrt("1"), nParcelaPrt("#N/D"));
});
ok("parsePrtSection le as duas formas e a Sigma fecha (3 + 4 = 7)", () => {
  const prt = parsePrtSection(docPrt([PRT_ND, PRT_NUM]), 7);
  assert.equal(prt.length, 2);
  assert.equal(prt.find((r) => r.contrato === "900000005").n_parcela, 0);
  assert.equal(prt.find((r) => r.contrato === "900000006").n_parcela, 2);
  assert.equal(prt.find((r) => r.contrato === "900000005").qt_parcela, null); // "#N/D" -> null
});

// ===========================================================================
console.log("\n[5] a chave que COLAPSA — dois '#N/D' do mesmo contrato");
// ---------------------------------------------------------------------------
aborta(
  "mesmo contrato com duas parcelas '#N/D' ABORTA (a chave unica descartaria uma)",
  /chave única|colapsaria/i,
  () => parsePrtSection(docPrt([PRT_ND, "900000005 01/06/2026 #N/D R$ 5,00 #N/D"]), 8)
);
ok("contratos DIFERENTES com '#N/D' convivem (a chave inclui o contrato)", () => {
  const prt = parsePrtSection(docPrt([PRT_ND, "900000007 01/06/2026 #N/D R$ 5,00 #N/D"]), 8);
  assert.equal(prt.length, 2);
});

// ===========================================================================
console.log("\n[6] MUTACAO — reverter cada afrouxamento derruba assercao");
// ---------------------------------------------------------------------------
// Cada mutante e a regex NOVA com UM afrouxamento desfeito. Se um mutante
// aceitasse tudo o que a versao boa aceita, aquele afrouxamento seria morto.
const MUTANTES_SEGURO = [
  ["sem o 'R$ ' opcional nas colunas numericas",
    /^(\d{6,})\s+([\d.,]+)\s+(\d+)\s+(ESTOQUE D0|ESTOQUE|SLIP NOVO|SLIP)\s+(\d+)\s+([\d.,]+)\s+(POSITIVO|CANCELADO)\s+(?:(\d[^\s%]*)\s+)?(?:(JJ\d+)\s+)?([\d.,]+)%\s+(-?R\$\s*[\d.,]+)(?:\s+(JJ\d+))?\s*$/i,
    [LIN_B, LIN_C, LIN_C_CANC]],
  ["com a coluna de data OBRIGATORIA",
    /^(\d{6,})\s+(?:R\$\s*)?([\d.,]+)\s+(\d+)\s+(ESTOQUE D0|ESTOQUE|SLIP NOVO|SLIP)\s+(\d+)\s+(?:R\$\s*)?([\d.,]+)\s+(POSITIVO|CANCELADO)\s+(\d[^\s%]*)\s+(?:(JJ\d+)\s+)?([\d.,]+)%\s+(-?R\$\s*[\d.,]+)(?:\s+(JJ\d+))?\s*$/i,
    [LIN_C, LIN_C_CANC]],
  ["sem a chave J no FIM",
    /^(\d{6,})\s+(?:R\$\s*)?([\d.,]+)\s+(\d+)\s+(ESTOQUE D0|ESTOQUE|SLIP NOVO|SLIP)\s+(\d+)\s+(?:R\$\s*)?([\d.,]+)\s+(POSITIVO|CANCELADO)\s+(?:(\d[^\s%]*)\s+)?(?:(JJ\d+)\s+)?([\d.,]+)%\s+(-?R\$\s*[\d.,]+)\s*$/i,
    [LIN_C, LIN_C_CANC]],
  ["com a chave J do MEIO obrigatoria",
    /^(\d{6,})\s+(?:R\$\s*)?([\d.,]+)\s+(\d+)\s+(ESTOQUE D0|ESTOQUE|SLIP NOVO|SLIP)\s+(\d+)\s+(?:R\$\s*)?([\d.,]+)\s+(POSITIVO|CANCELADO)\s+(?:(\d[^\s%]*)\s+)?(JJ\d+)\s+([\d.,]+)%\s+(-?R\$\s*[\d.,]+)(?:\s+(JJ\d+))?\s*$/i,
    [LIN_C, LIN_C_CANC]],
];
for (const par of MUTANTES_SEGURO) {
  const nome = par[0], mutante = par[1], devemQuebrar = par[2];
  ok("mutante '" + nome + "' derruba " + devemQuebrar.length + " fixture(s)", () => {
    for (const linha of devemQuebrar) {
      assert.ok(SEGURO_RE.test(linha), "a regex BOA deveria casar: " + linha.slice(0, 40));
      assert.ok(!mutante.test(linha), "o mutante AINDA casa — afrouxamento nao exercido: " + linha.slice(0, 40));
    }
    assert.ok(mutante.test(LIN_A), "o mutante quebrou tambem o layout A — mutacao ampla demais para provar o ponto");
  });
}
ok("mutante 'PRT_RE sem #N/D' derruba a fixture de 05/26", () => {
  const mutante = /^(\d{6,})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(-?R\$\s*[\d.,]+)\s*(.*)$/;
  assert.ok(PRT_RE.test(PRT_ND), "a regex BOA deveria casar '#N/D'");
  assert.ok(!mutante.test(PRT_ND), "o mutante ainda casa — o '|#N/D' nao e exercido");
  assert.ok(mutante.test(PRT_NUM), "o mutante quebrou tambem a parcela numerica");
});
aborta(
  "sem o 2o padrao de cabecalho, o documento de 04/26 fica SEM ancora",
  /Âncora 'TOTAL'/i,
  () => {
    // Reproduz o comportamento ANTERIOR ao conserto retirando do documento a
    // linha que so o 2o padrao reconhece: sem ela nao ha ancora — e era
    // exatamente a recusa medida em 30/08/2026 no PDF de abril.
    const doc = docSeguro(CAB_VALOR_PGTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 30,00", [LIN_C]);
    parseSeguroLines(doc.filter((l) => l !== CAB_VALOR_PGTO));
  }
);

// ===========================================================================
console.log("\n[7] O CONTRARIO — aceitar mais FORMA nao e aceitar mais VALOR");
// ---------------------------------------------------------------------------
aborta(
  "layout C perfeito, mas a Sigma NAO fecha a ancora -> ABORTA",
  /Σ pagamento extraída .* ≠ âncora 'TOTAL'/,
  () => parseSeguroLines(docSeguro(CAB_VALOR_PGTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 999,00", [LIN_C]))
);
aborta(
  "layout B perfeito, mas a Sigma NAO fecha -> ABORTA",
  /Σ pagamento extraída .* ≠ âncora 'TOTAL'/,
  () => parseSeguroLines(docSeguro(CAB_DESCONTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 1,00 R$ 0,00 R$ 1,00", [LIN_B]))
);
aborta(
  "os tres layouts juntos com a ancora errada -> ABORTA",
  /Σ pagamento extraída .* ≠ âncora 'TOTAL'/,
  () => parseSeguroLines(docSeguro(CAB_DESCONTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 59,00 R$ 0,00 R$ 59,00", [LIN_A, LIN_B, LIN_C]))
);
// A FRONTEIRA DA TOLERANCIA, dita com todas as letras. A conferencia e
// `Math.abs(soma - ancora) > 0.01`: UM centavo de diferenca NAO aborta, dois
// abortam. Isso e deliberado (arredondamento de centavo do proprio documento),
// mas so vale como decisao se estiver escrito — a primeira versao desta fixture
// usou 59,99 esperando que abortasse, e ela passou. As duas assercoes abaixo
// existem para que mexer na tolerancia acenda aqui, nos dois sentidos.
ok("1 centavo de diferenca NAO aborta (tolerancia deliberada)", () => {
  const r = parseSeguroLines(docSeguro(CAB_DESCONTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 59,99 R$ 0,00 R$ 59,99", [LIN_A, LIN_B, LIN_C]));
  assert.equal(r.totalAnchor, 59.99);
  assert.equal(r.rows.reduce((a, x) => a + x.valor_seguro, 0), 60);
});
aborta(
  "2 centavos de diferenca JA abortam",
  /Σ pagamento extraída .* ≠ âncora 'TOTAL'/,
  () => parseSeguroLines(docSeguro(CAB_DESCONTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 59,98 R$ 0,00 R$ 59,98", [LIN_A, LIN_B, LIN_C]))
);
aborta(
  "documento SEM cabecalho de NF -> ABORTA (ausencia nao vira zero)",
  /Âncora 'TOTAL'/i,
  () => parseSeguroLines(["Contrato Valor Total do Credito", LIN_A])
);
aborta(
  "documento com cabecalho mas SEM linha nenhuma reconhecida -> ABORTA",
  /Nenhuma linha de seguro reconhecida/i,
  () => parseSeguroLines(docSeguro(CAB_DESCONTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 1,00 R$ 0,00 R$ 1,00", ["linha que nao e do relatorio"]))
);
aborta(
  "PRT com '#N/D' aceito, mas Sigma que NAO fecha -> ABORTA",
  /Σ das parcelas extraída .* ≠ âncora 'Pagamento PRT'/,
  () => parsePrtSection(docPrt([PRT_ND, PRT_NUM]), 99)
);
ok("controle positivo: as MESMAS entradas com a ancora certa NAO abortam", () => {
  parseSeguroLines(docSeguro(CAB_VALOR_PGTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 30,00", [LIN_C]));
  parseSeguroLines(docSeguro(CAB_DESCONTO, "90000000000000 EMPRESA FIXTURE LTDA R$ 60,00 R$ 0,00 R$ 60,00", [LIN_A, LIN_B, LIN_C]));
  parsePrtSection(docPrt([PRT_ND, PRT_NUM]), 7);
});

console.log("\n" + (falhas === 0 ? "GATE VERDE" : "GATE VERMELHO — " + falhas + " falha(s)"));
process.exit(falhas === 0 ? 0 : 1);
