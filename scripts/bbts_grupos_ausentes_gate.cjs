/*
 * GATE — fragmentacao de rotulo e AUSENCIA DECLARADA de grupo na regua BBTS.
 *
 * DOIS DEFEITOS DIFERENTES, medidos em 30/08/2026 nas duas tabelas de vigencia
 * 31/07/2026, e o gate existe porque eles se DISFARCAVAM UM DO OUTRO:
 *
 *   (1) LEITURA. O gerador de PDF da BBTS as vezes parte a palavra com espaco:
 *       "Financiamento - BB Energia Ren ovavel*", "Portabilidade de B eneficio
 *       do INSS*". Com `rx.test` puro a ancora nao casa, o grupo inteiro some da
 *       regua SEM ERRO, e a recusa aparece depois, no validador, dizendo
 *       "grupo ausente" — culpando o DOCUMENTO por um defeito de LEITURA.
 *
 *   (2) DOCUMENTO. A BBTS REMOVEU de verdade GRUPAMENTO_MG_SP_REDUZIDOS,
 *       PUBLICO_DEMAIS_BONIFICADO e PUBLICO_DEMAIS_REDUZIDOS (as palavras
 *       "reduzidos" e "bonificad" tem ZERO ocorrencia no PDF, nem em rodape).
 *       Isso recusava a regua INTEIRA e deixava agosto de fora por grupos que a
 *       ADS nao usa — medido: 0 contratos em jun e jul.
 *
 * O CONSERTO SEPARA OS DOIS: casaRotuloFragmentado resolve (1); a ausencia
 * DECLARADA resolve (2) sem virar buraco silencioso. Este gate prova que os
 * dois continuam separados — se a fragmentacao voltar a matar a linha, o grupo
 * cai na lista de ausentes e a regua passa mesmo assim, que e o pior dos mundos.
 *
 * FIXTURES SINTETICAS: o repo e PUBLICO. Nenhum percentual real da BBTS entra
 * aqui; os grupos usam valores inventados e crescentes. O que se preserva do
 * documento e a FORMA do rotulo (e o espaco no lugar errado).
 *
 * self-contained: sem banco, sem rede, sem PDF em disco.
 */
require("./_ts_register.cjs");
const assert = require("node:assert/strict");

const { casaRotuloFragmentado, casaExpressao } = require("../lib/bbts/normalizarTextoPdf.ts");
const { validarRegraBbts } = require("../lib/bbts/validateRegraBbts.ts");
const { lookupPctBbts } = require("../lib/bbts/resolveBbtsRegra.ts");
const {
  AVT_TETO,
  EXPECTED_GROUPS,
  FAIXA_LABELS,
  FAIXA_UNICA,
  GRUPOS_FAIXA_UNICA,
  GRUPOS_BONIFICADOS,
  BbtsValidationError,
} = require("../lib/bbts/regraBbts.ts");

let falhas = 0;
const ok = (nome, fn) => {
  try { fn(); console.log("  OK   " + nome); }
  catch (e) { falhas++; console.log("  FALHA " + nome + "\n         " + e.message); }
};
const lanca = (nome, rx, fn) => {
  ok(nome, () => {
    let erro = null;
    try { fn(); } catch (e) { erro = e; }
    assert.ok(erro, "NAO lancou — a regua invalida teria sido aceita");
    assert.ok(erro instanceof BbtsValidationError, "lancou " + erro.constructor.name + ", nao BbtsValidationError");
    assert.match(erro.message + " " + (erro.detalhe || ""), rx);
  });
};

console.log("GATE: fragmentacao de rotulo + ausencia declarada de grupo (BBTS)\n");

// ===========================================================================
console.log("[1] FRAGMENTACAO — o espaco no lugar errado nao pode matar a linha");
// ---------------------------------------------------------------------------
// As ancoras abaixo tem a MESMA FORMA das de parseBbtsPdf.ts; os textos sao as
// formas quebrada e integra observadas nos dois PDFs da mesma vigencia.
const RX_ENERGIA = /^Financiamento . BB Energia Renovavel/i;
const RX_PORTAB = /^Portabilidade de Beneficio do INSS/i;
const RX_INSS = /^INSS-\s*Credito Consignado Novo$/i;

ok("rotulo INTEGRO casa (comportamento de sempre)", () => {
  assert.equal(casaRotuloFragmentado("Financiamento – BB Energia Renovavel*", RX_ENERGIA), true);
});
ok("rotulo FRAGMENTADO casa ('Ren ovavel')", () => {
  assert.equal(casaRotuloFragmentado("Financiamento – BB Energia Ren ovavel*", RX_ENERGIA), true);
});
ok("fragmentacao em OUTRA palavra tambem casa ('B eneficio')", () => {
  assert.equal(casaRotuloFragmentado("Portabilidade de B eneficio do INSS*", RX_PORTAB), true);
});
ok("fragmentacao em VARIOS pontos da mesma linha casa", () => {
  assert.equal(casaRotuloFragmentado("Financiamen to – BB Ener gia Ren ovavel*", RX_ENERGIA), true);
});
ok("a ancora com \\s* continua funcionando (nao quebrei as que ja passavam)", () => {
  assert.equal(casaRotuloFragmentado("INSS- Credito Consignado Novo", RX_INSS), true);
  assert.equal(casaRotuloFragmentado("INSS-Credito Consignado Novo", RX_INSS), true);
});
ok("NAO casa texto de OUTRO grupo — o helper nao afrouxa o alfabeto", () => {
  assert.equal(casaRotuloFragmentado("Financiamento – BB Energia Solar*", RX_ENERGIA), false);
  assert.equal(casaRotuloFragmentado("INSS- Credito Consignado Renovacao", RX_INSS), false);
});

// ===========================================================================
console.log("\n[2] MUTACAO — reverter o helper derruba a fragmentacao");
// ---------------------------------------------------------------------------
ok("casaExpressao SOZINHA (o estado anterior) NAO casa 'Ren ovavel'", () => {
  // casaExpressao trata LACUNA (U+FFFD), nao espaco. Sem lacuna no texto ela cai
  // no rx.test puro e falha — que era exatamente o defeito.
  assert.equal(casaExpressao("Financiamento – BB Energia Ren ovavel*", RX_ENERGIA), false);
  assert.equal(casaExpressao("Portabilidade de B eneficio do INSS*", RX_PORTAB), false);
  // e o controle: no rotulo INTEGRO as duas concordam.
  assert.equal(casaExpressao("Financiamento – BB Energia Renovavel*", RX_ENERGIA), true);
});
ok("rx.test cru (o estado ANTES de tudo) tambem nao casa", () => {
  const deacc = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
  assert.equal(RX_ENERGIA.test(deacc("Financiamento – BB Energia Ren ovavel*")), false);
});

// ===========================================================================
// FIXTURE de regua — grupos sinteticos, percentuais inventados e crescentes.
// ===========================================================================
function celula(base) {
  const labels = FAIXA_LABELS;
  const faixas = {};
  labels.forEach((l, i) => { faixas[l] = { base: base + i * 0.001 }; });
  return { tx_min: 0.01, tx_max: 0.09, prazo_min: 1, prazo_max: 120, faixas };
}
function celulaUnica(base) {
  return { tx_min: 0.01, tx_max: 0.09, prazo_min: 1, prazo_max: 120, faixas: { [FAIXA_UNICA]: { base } } };
}
function celulaBonificada(base) {
  const c = celula(base);
  for (const l of FAIXA_LABELS) c.faixas[l].adicional = 0.0035;
  return c;
}
/** Régua com TODOS os grupos esperados; `omitir` sai e entra em grupos_ausentes. */
function reguaFixture(omitir = []) {
  const grupos = {};
  for (const k of EXPECTED_GROUPS) {
    if (omitir.includes(k)) continue;
    grupos[k] = {
      titulo: `FIXTURE ${k}`,
      celulas: [
        GRUPOS_FAIXA_UNICA.includes(k)
          ? celulaUnica(0.02)
          : GRUPOS_BONIFICADOS.includes(k)
            ? celulaBonificada(0.02)
            : celula(0.02),
      ],
    };
  }
  const r = {
    _meta: {
      shape: "BBTS_V1",
      competencia: "2026-08",
      vigencia_inicio: "2026-07-31",
      vigencia_fim: "2026-08-28",
      vigencia_pdf: "2026-07-31",
      faixas: [...FAIXA_LABELS],
      faixas_enquadramento: [
        { faixa: "Faixa 1", prod_min: 0, prod_max: 100000 },
        { faixa: "Faixa 2", prod_min: 100000, prod_max: 200000 },
        { faixa: "Faixa 3", prod_min: 200000, prod_max: 300000 },
        { faixa: "Faixa 4", prod_min: 300000, prod_max: 400000 },
        { faixa: "Faixa 5", prod_min: 400000, prod_max: null },
      ],
      // O TETO E O DA BBTS (AVT_TETO, 6%), nao o teto interno da RR de 5,80%:
      // sao entidades diferentes e o validador cobra este. Errei isso na 1a
      // versao da fixture e o gate acusou.
      modelo_pagamento: { avt_teto: AVT_TETO, prt: "fixture" },
      fonte_pdf: "fixture.pdf",
      parser_version: "gate",
    },
    // OVERRIDES do PDF: e por AQUI que uma operacao vai parar num grupo
    // REDUZIDO/BONIFICADO. resolverGrupoBbts roteia pelo produto/convenio (nunca
    // por um campo "grupo" na operacao) e so entao aplica a variante. A 1a versao
    // da fixture tinha convenios: {} e um campo `grupo_forcado` inventado — todas
    // as operacoes caiam em PUBLICO_DEMAIS e as assercoes de recusa passavam pelo
    // motivo errado.
    convenios: {
      "9001": { grupo: "PUBLICO_DEMAIS_REDUZIDOS", nome: "FIXTURE reduzido" },
      "9002": { grupo: "PUBLICO_DEMAIS_BONIFICADO", nome: "FIXTURE bonificado" },
      // 214598 e um convenio SP/MG — precisa ser um da lista real, senao
      // inferCreditTable devolve PUBLICO_GERAL e a variante REDUZIDO cai em
      // PUBLICO_DEMAIS_REDUZIDOS em vez de GRUPAMENTO_MG_SP_REDUZIDOS. O grupo
      // BASE decide a variante, e o base vem do roteador. Nao e dado de cliente:
      // o codigo ja esta versionado em lib/motor.ts (SP_MG_CONVENIOS).
      "214598": { grupo: "GRUPAMENTO_MG_SP_REDUZIDOS", nome: "FIXTURE MG/SP reduzido" },
    },
    grupos,
  };
  if (omitir.length > 0) r.grupos_ausentes = [...omitir];
  return r;
}

const OMITIDOS = ["GRUPAMENTO_MG_SP_REDUZIDOS", "PUBLICO_DEMAIS_BONIFICADO", "PUBLICO_DEMAIS_REDUZIDOS"];

// ===========================================================================
console.log("\n[3] AUSENCIA DECLARADA — a regua sem os 3 grupos PASSA e registra");
// ---------------------------------------------------------------------------
ok("regua sem os 3 grupos, DECLARADOS, valida sem lancar", () => {
  const r = reguaFixture(OMITIDOS);
  validarRegraBbts(r, "2026-08");
  assert.deepEqual([...r.grupos_ausentes].sort(), [...OMITIDOS].sort());
  for (const g of OMITIDOS) assert.equal(r.grupos[g], undefined, `${g} deveria estar fora de grupos`);
});
ok("a declaracao e LEGIVEL como dado (array de string em regra_json)", () => {
  const r = reguaFixture(OMITIDOS);
  const roundtrip = JSON.parse(JSON.stringify(r));
  assert.ok(Array.isArray(roundtrip.grupos_ausentes));
  assert.equal(roundtrip.grupos_ausentes.length, 3);
  assert.equal(typeof roundtrip.grupos_ausentes[0], "string");
});
ok("regua COMPLETA nao ganha a chave (o SQL separa uma da outra por presenca)", () => {
  const r = reguaFixture([]);
  assert.equal("grupos_ausentes" in r, false);
});

// ===========================================================================
console.log("\n[4] MUTACAO — a trava mudou de lugar, NAO sumiu");
// ---------------------------------------------------------------------------
lanca(
  "grupo faltando e NAO declarado -> LANCA (buraco silencioso continua barrado)",
  /nao declarado|NAO declarado/i,
  () => { const r = reguaFixture(OMITIDOS); delete r.grupos_ausentes; validarRegraBbts(r, "2026-08"); }
);
lanca(
  "declaracao INCOMPLETA (2 de 3) -> LANCA",
  /nao declarado|NAO declarado/i,
  () => { const r = reguaFixture(OMITIDOS); r.grupos_ausentes = OMITIDOS.slice(0, 2); validarRegraBbts(r, "2026-08"); }
);
lanca(
  "declara ausente um grupo que EXISTE -> LANCA (recusaria contrato bom)",
  /declara grupo que EXISTE|presente/i,
  () => { const r = reguaFixture(OMITIDOS); r.grupos_ausentes = [...OMITIDOS, "INSS_NOVO"]; validarRegraBbts(r, "2026-08"); }
);
lanca(
  "grupo presente mas SEM celula, nao declarado -> LANCA",
  /nao declarado|NAO declarado/i,
  () => { const r = reguaFixture([]); r.grupos.SIAPE.celulas = []; validarRegraBbts(r, "2026-08"); }
);

// ===========================================================================
console.log("\n[5] O CALCULO RECUSA POR CONTRATO — e calcula os outros");
// ---------------------------------------------------------------------------
const regua = reguaFixture(OMITIDOS);
const opBase = { taxa_juros: 0.0185, prazo: 96 };
/**
 * Operação que ROTEIA para o grupo pedido — pelo caminho real (convênio do
 * override), nunca por um campo forçado. Sem convênio, cai em PUBLICO_DEMAIS.
 */
const CONVENIO_DO_GRUPO = {
  PUBLICO_DEMAIS_REDUZIDOS: "9001",
  PUBLICO_DEMAIS_BONIFICADO: "9002",
  GRUPAMENTO_MG_SP_REDUZIDOS: "214598",
};
function opDoGrupo(grupo) {
  const code = CONVENIO_DO_GRUPO[grupo];
  assert.ok(code, `fixture sem convenio para rotear ate ${grupo}`);
  return { ...opBase, convenio_code: code, product_description: "CONSIGNADO PUBLICO" };
}

ok("ANTI-VACUIDADE: ha contrato sendo CALCULADO com sucesso no mesmo run", () => {
  // Sem convenio de excecao a operacao cai no grupo-base, que ESTA na regua.
  const res = lookupPctBbts(regua, { ...opBase, product_description: "CONSIGNADO PUBLICO" }, { faixa: "Faixa 4" });
  assert.ok(res.ok, `o grupo-base deveria resolver, veio: ${res.motivo}`);
  assert.ok(!OMITIDOS.includes(res.ok.grupo), "o controle caiu num grupo ausente — cenario invalido");
  assert.ok(Number(res.ok.pctTabela) > 0, "pct deveria ser > 0");
});
ok("contrato que cai num grupo AUSENTE e RECUSADO, com motivo NOMEADO", () => {
  const res = lookupPctBbts(regua, opDoGrupo("PUBLICO_DEMAIS_REDUZIDOS"), { faixa: "Faixa 4" });
  assert.equal(res.ok, null, "deveria ser recusado");
  assert.match(res.motivo, /PUBLICO_DEMAIS_REDUZIDOS/, "recusou por outro grupo — o roteamento nao chegou no caso");
  assert.match(res.motivo, /REMOVIDO da tabela BBTS/i);
  assert.match(res.motivo, /ausencia declarada/i);
  assert.match(res.motivo, /nunca calculado por fallback/i);
});
ok("o motivo DISTINGUE 'a BBTS tirou' de 'nao achei na regua'", () => {
  const semDeclaracao = reguaFixture(OMITIDOS);
  delete semDeclaracao.grupos_ausentes; // regua adulterada: ausencia sem declaracao
  const a = lookupPctBbts(regua, opDoGrupo("PUBLICO_DEMAIS_REDUZIDOS"), { faixa: "Faixa 4" });
  const b = lookupPctBbts(semDeclaracao, opDoGrupo("PUBLICO_DEMAIS_REDUZIDOS"), { faixa: "Faixa 4" });
  assert.equal(a.ok, null);
  assert.equal(b.ok, null);
  assert.notEqual(a.motivo, b.motivo, "as duas causas dariam a MESMA mensagem — a distincao se perdeu");
  assert.match(b.motivo, /ausente na regua/i);
  assert.doesNotMatch(b.motivo, /REMOVIDO/i);
});
ok("recusa NAO vira zero nem fallback: `ok` e null, sem pct nenhum", () => {
  const res = lookupPctBbts(regua, opDoGrupo("GRUPAMENTO_MG_SP_REDUZIDOS"), { faixa: "Faixa 4" });
  assert.equal(res.ok, null);
  assert.equal(res.pct, undefined);
  assert.equal(res.pctTabela, undefined);
});

// ===========================================================================
console.log("\n[6] CONTROLE POSITIVO — regua completa passa e nada e recusado");
// ---------------------------------------------------------------------------
ok("regua COMPLETA valida sem lancar", () => {
  validarRegraBbts(reguaFixture([]), "2026-08");
});
ok("com a regua completa, os 3 grupos resolvem NORMALMENTE", () => {
  const completa = reguaFixture([]);
  let resolvidos = 0;
  for (const g of OMITIDOS) {
    const res = lookupPctBbts(completa, opDoGrupo(g), { faixa: "Faixa 4" });
    assert.ok(res.ok, `${g} deveria resolver na regua completa, veio: ${res.motivo}`);
    assert.equal(res.ok.grupo, g, `roteou para ${res.ok.grupo}, nao para ${g} — a fixture nao exercita o caso`);
    resolvidos += 1;
  }
  assert.equal(resolvidos, 3, "ANTI-VACUIDADE: os 3 tinham de resolver");
});
ok("a diferenca entre [5] e [6] e SO a ausencia dos 3 grupos", () => {
  const completa = reguaFixture([]);
  const semTres = reguaFixture(OMITIDOS);
  const soNaCompleta = Object.keys(completa.grupos).filter((k) => !(k in semTres.grupos));
  assert.deepEqual(soNaCompleta.sort(), [...OMITIDOS].sort());
  assert.equal(Object.keys(completa.grupos).length - Object.keys(semTres.grupos).length, 3);
});

console.log("\n" + (falhas === 0 ? "GATE VERDE" : "GATE VERMELHO — " + falhas + " falha(s)"));
process.exit(falhas === 0 ? 0 : 1);
