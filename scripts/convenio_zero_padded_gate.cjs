/*
 * GATE — quem compara convenio com literal TEM de normalizar o zero-padding.
 *
 * SELF-CONTAINED e OFFLINE: chama as funcoes REAIS com as duas formas do mesmo
 * convenio e exige a MESMA resposta. Sem banco, sem arquivo externo.
 *
 * O QUE ELE IMPEDE DE VOLTAR
 * --------------------------
 * O convenio no banco vem ZERO-PADDED: `"000001640"`, nao `"1640"`. Medido em
 * jul/2026: 711 de 711 contratos com a forma padded (100%), dos quais 358 sao
 * do convenio 1640 (INSS). Ate 25/08/2026 `isInssRecord` fazia
 * `String(convenio_code).trim() === "1640"` e devolvia FALSE nos 358 — e o
 * fallback pela descricao nao salvava nenhum, porque as descricoes reais sao
 * "CONSIGNADO CORRENTISTA REFIN", "CREDITO BENEFICIO CORRENTISTA", "CREDITO
 * ANTECIPACAO 13o SALARIO": nenhuma diz INSS.
 *
 * Varridos os sitios que comparam convenio com literal, essa era a UNICA sem
 * normalizacao. As outras cinco ja passavam por normConvenio (so digitos, sem
 * zeros a esquerda) ou por Number(). Este gate fixa a invariante nas SEIS, para
 * que a proxima nao nasca torta.
 *
 * AS PROVAS
 *   A) ANTI-VACUIDADE: as duas formas de entrada sao DIFERENTES como string, e
 *      a forma padded e a que o banco realmente entrega. Se alguem "consertar"
 *      o teste igualando as entradas, o gate reprova.
 *   B) isInssRecord: padded == cru == true. E o caso que estava quebrado.
 *   C) A invariante nos outros cinco sitios (motor, regrasLoader x2,
 *      convenioSegmento, promoterRemuneration).
 *   D) SIAPE (1078) junto do INSS (1640): o defeito nao era de um convenio so.
 *   E) normConvenio: as formas que aparecem no dado vivo.
 *   F) NAO-VACUIDADE do predicado: isInssRecord distingue 1640 de nao-1640 (um
 *      `return true` fixo passaria em B e D, mas morre aqui).
 *
 * exit 0 = todas as provas passam; exit 2 = alguma falhou.
 */
require("./_ts_register.cjs");

const { isInssRecord } = require("../lib/proposalDetailing.ts");
const { normConvenio, deriveDailySegmentRows } = require("../lib/convenioSegmento.ts");
const { categoriasCandidatasFor } = require("../lib/regrasLoader.ts");
const { calcularOperacao } = require("../lib/motor.ts");
const { findImportedProductionRule } = require("../lib/promoterRemuneration.js");

// As duas formas do MESMO convenio. A primeira e a do banco.
const INSS_PAD = "000001640";
const INSS_CRU = "1640";
const SIAPE_PAD = "000001078";
const SIAPE_CRU = "1078";
// Descricao REAL do dado, que NAO contem "INSS" — sem isto o fallback por
// descricao esconderia o defeito do convenio.
const DESC_REAL = "CONSIGNADO CORRENTISTA REFIN";

const falhas = [];
function checa(nome, ok, detalhe) {
  console.log(`${ok ? "  OK  " : "  X   "} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas.push(nome);
}
const mesmo = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  // -- A) ANTI-VACUIDADE ------------------------------------------------------
  console.log("== A) ANTI-VACUIDADE — as duas formas sao mesmo diferentes?");
  checa("'000001640' !== '1640' como string", INSS_PAD !== INSS_CRU, `${INSS_PAD} vs ${INSS_CRU}`);
  checa("a forma padded tem zeros a esquerda (e a do banco)", /^0+\d+$/.test(INSS_PAD));
  checa("a descricao de apoio NAO contem 'INSS' (senao o fallback mascara)", !DESC_REAL.toUpperCase().includes("INSS"), DESC_REAL);
  if (INSS_PAD === INSS_CRU || DESC_REAL.toUpperCase().includes("INSS")) {
    console.log("\nGATE VACUO — o cenario nao distingue nada. REPROVADO.");
    process.exit(2);
  }

  // -- B) isInssRecord — o sitio que estava quebrado --------------------------
  console.log("\n== B) isInssRecord (lib/proposalDetailing.ts)");
  const bPad = isInssRecord({ convenio_code: INSS_PAD, product_description: DESC_REAL });
  const bCru = isInssRecord({ convenio_code: INSS_CRU, product_description: DESC_REAL });
  checa("padded == cru", bPad === bCru, `${bPad} vs ${bCru}`);
  checa("e ambos true (1640 E INSS)", bPad === true && bCru === true);

  // -- F) o predicado ainda DISTINGUE ----------------------------------------
  console.log("\n== F) NAO-VACUIDADE do predicado (nao virou `return true`)");
  checa("convenio 1078 com descricao real -> false", isInssRecord({ convenio_code: SIAPE_PAD, product_description: DESC_REAL }) === false);
  checa("convenio vazio com descricao real -> false", isInssRecord({ convenio_code: "000000000", product_description: DESC_REAL }) === false);
  checa("descricao com 'INSS' e convenio outro -> true (o outro braco vive)", isInssRecord({ convenio_code: SIAPE_PAD, product_description: "PORTABILIDADE INSS" }) === true);
  checa("'16400' NAO e 1640 (nao pode virar prefixo)", isInssRecord({ convenio_code: "000016400", product_description: DESC_REAL }) === false);

  // -- C+D) os outros cinco sitios -------------------------------------------
  console.log("\n== C+D) os outros sitios que comparam convenio com literal");

  const catInssPad = categoriasCandidatasFor("2026-07", "CONSIGNADO CORRENTISTA", null, INSS_PAD);
  const catInssCru = categoriasCandidatasFor("2026-07", "CONSIGNADO CORRENTISTA", null, INSS_CRU);
  checa("regrasLoader/INSS: padded == cru", mesmo(catInssPad, catInssCru), JSON.stringify(catInssPad));
  checa("regrasLoader/INSS: e caiu MESMO em INSS (nao no residual publico)", String(catInssPad[0] || "").startsWith("INSS"));

  const catSiapePad = categoriasCandidatasFor("2026-07", "CONSIGNADO CORRENTISTA", null, SIAPE_PAD);
  const catSiapeCru = categoriasCandidatasFor("2026-07", "CONSIGNADO CORRENTISTA", null, SIAPE_CRU);
  checa("regrasLoader/SIAPE: padded == cru", mesmo(catSiapePad, catSiapeCru), JSON.stringify(catSiapePad));
  checa("regrasLoader/SIAPE: e caiu MESMO em SIAPE", String(catSiapePad[0] || "") === "SIAPE");
  checa("e INSS != SIAPE (os dois convenios nao colapsam)", !mesmo(catInssPad, catSiapePad));

  const op = (cv) => ({
    product_description: "CONSIGNADO CORRENTISTA", product_code: "2882",
    convenio_code: cv, convenio_segment: null,
    valor_liquido: 10000, valor_bruto: 10000, taxa_juros: 1.85, prazo: 84,
    contract_date: "2026-07-15", movement_date: "2026-07-15", proposal_date: "2026-07-15",
    production_value: 3000000, tem_seguro: false, valor_seguro: 0, company_cash_percent: null,
  });
  const motorPad = calcularOperacao(op(INSS_PAD)).credito.percentual;
  const motorCru = calcularOperacao(op(INSS_CRU)).credito.percentual;
  checa("motor: padded == cru", motorPad === motorCru, String(motorPad));

  const segPad = deriveDailySegmentRows([{ convenio_code: INSS_PAD, convenio_segment: "1" }]);
  const segCru = deriveDailySegmentRows([{ convenio_code: INSS_CRU, convenio_segment: "1" }]);
  checa("convenioSegmento: padded == cru", mesmo(segPad, segCru), JSON.stringify(segPad));

  const REGRA = [{
    scope: "PROMOTER_MONTHLY_TABLE", priority: 120, label: "INSS teste",
    product_keywords: ["CONSIGNADO CORRENTISTA"], product_excludes: [],
    convenio_type: null, convenio_codes: [1640], convenio_codes_exclude: [],
    uf_in: [], uf_in_exclude: [], rate_from: null, rate_to: null,
    term_from: null, term_to: null, ticket_min: null,
    received_percent: 6, promoter_percent: 58.33,
  }];
  const rec = (cv) => ({ convenio_code: cv, product_description: "CONSIGNADO CORRENTISTA", net_value: 10000, interest_rate: 1.85, term_months: 84 });
  const remPad = findImportedProductionRule(REGRA, rec(INSS_PAD));
  const remCru = findImportedProductionRule(REGRA, rec(INSS_CRU));
  checa("promoterRemuneration: padded == cru", mesmo(remPad?.label ?? null, remCru?.label ?? null), String(remPad?.label ?? "null"));
  checa("promoterRemuneration: e a regra de convenio 1640 casou mesmo", (remPad?.label ?? null) === "INSS teste");

  // -- E) normConvenio nas formas do dado vivo -------------------------------
  console.log("\n== E) normConvenio nas formas que aparecem no dado vivo");
  const vivos = ["000001640", "000000000", "000122429", "000137478", "000436871", "1640"];
  for (const v of vivos) {
    const n = normConvenio(v);
    const esperado = String(Number(v)) === "0" ? null : String(Number(v));
    checa(`normConvenio(${JSON.stringify(v)}) -> ${JSON.stringify(n)}`, n === esperado, `esperado ${JSON.stringify(esperado)}`);
  }
  checa("normConvenio(null) -> null", normConvenio(null) === null);
  checa("normConvenio('') -> null", normConvenio("") === null);

  console.log("");
  if (falhas.length) {
    console.log(`REPROVADO — ${falhas.length} prova(s) falharam:`);
    for (const f of falhas) console.log(`  - ${f}`);
    process.exit(2);
  }
  console.log("APROVADO — convenio zero-padded e convenio cru dao a MESMA resposta nos seis sitios.");
})().catch((e) => {
  console.error("ERRO no gate:", e?.stack || e?.message || e);
  process.exit(2);
});
