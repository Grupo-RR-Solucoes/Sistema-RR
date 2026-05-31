/**
 * Testes do lib/promoterRemuneration.js — FIX float precision.
 *
 * Como rodar (Node 24):
 *   node --experimental-strip-types --test lib/__tests__/promoterRemuneration.test.ts
 *
 * Cobre os 2 fixes:
 *   1) percentToUnits: arredonda parsed*100 para 4 casas (evita
 *      0.0185*100 = 1.8499999999999999 que rejeita match exato)
 *   2) matchesRange: epsilon 1e-9 nas bordas (absorve audit_logs antigos
 *      sem reimport)
 *
 * Regressão garantida:
 *   - Público geral 1.78..1.87 com taxa 1.80 continua matching
 *   - Taxa fora de qualquer faixa continua sem match
 *   - to=null continua significando "aberto"
 *
 * @ts-nocheck — arquivo .js sem tipos, foco do teste é comportamento.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  percentToUnits,
  matchesRange,
  findImportedProductionRule,
} from "../promoterRemuneration.js";

// ===========================================================================
// percentToUnits
// ===========================================================================

test("percentToUnits(0.0185) === 1.85 exato (bug Thaynara 1,85%)", () => {
  const r = percentToUnits(0.0185);
  assert.equal(r, 1.85);
  assert.strictEqual(r, 1.85);
});

test("percentToUnits(0.0195) === 1.95 (outra taxa bugada)", () => {
  assert.strictEqual(percentToUnits(0.0195), 1.95);
});

test("percentToUnits(0.0205) === 2.05 (outra taxa bugada)", () => {
  assert.strictEqual(percentToUnits(0.0205), 2.05);
});

test("percentToUnits(0.0334) === 3.34 (faixa 85+ INSS)", () => {
  assert.strictEqual(percentToUnits(0.0334), 3.34);
});

test("percentToUnits(2.44) === 2.44 (valor já em % não muda)", () => {
  // |2.44| > 1 → não multiplica por 100, retorna como está
  assert.strictEqual(percentToUnits(2.44), 2.44);
});

test("percentToUnits(5.8) === 5.8 (cap RR, já em % unidades)", () => {
  assert.strictEqual(percentToUnits(5.8), 5.8);
});

test("percentToUnits(1) === 100 (borda do limiar |x|<=1)", () => {
  // |1| <= 1 → multiplica. Math.round(1 * 100 * 1e4) / 1e4 = 100.
  assert.strictEqual(percentToUnits(1), 100);
});

test("percentToUnits(null) === null + percentToUnits('') === null", () => {
  assert.strictEqual(percentToUnits(null), null);
  assert.strictEqual(percentToUnits(""), null);
  assert.strictEqual(percentToUnits(undefined), null);
});

// ===========================================================================
// matchesRange
// ===========================================================================

test("matchesRange(1.85, 1.85, 1.85) === true (faixa fechada exata)", () => {
  assert.equal(matchesRange(1.85, 1.85, 1.85), true);
});

test("matchesRange(1.85, 1.8499999999999999, 1.8499999999999999) === true (audit_logs bugado)", () => {
  // Simula tabela já gravada antes do fix de percentToUnits: rate_from
  // e rate_to com erro de float. Sem epsilon, isso era false (bug).
  assert.equal(matchesRange(1.85, 1.8499999999999999, 1.8499999999999999), true);
});

test("matchesRange respeita to=null (faixa aberta superior)", () => {
  // INSS novo 85..null: prazo 96 deve matchear.
  assert.equal(matchesRange(96, 85, null), true);
  assert.equal(matchesRange(85, 85, null), true);
  assert.equal(matchesRange(84, 85, null), false);
});

test("matchesRange respeita from=null (faixa aberta inferior)", () => {
  assert.equal(matchesRange(50, null, 100), true);
  assert.equal(matchesRange(100, null, 100), true);
  assert.equal(matchesRange(101, null, 100), false);
});

test("matchesRange rejeita value 1.88 fora de [1.78, 1.87] (epsilon não estoura faixa)", () => {
  // Regressão: epsilon não pode aceitar valor genuinamente fora.
  assert.equal(matchesRange(1.88, 1.78, 1.87), false);
});

test("matchesRange rejeita value=null", () => {
  assert.equal(matchesRange(null, 1.78, 1.87), false);
  assert.equal(matchesRange(undefined, 1.78, 1.87), false);
  assert.equal(matchesRange("", 1.78, 1.87), false);
});

// ===========================================================================
// findImportedProductionRule — caso 206728904 (Thaynara INSS 96 parc)
// ===========================================================================

// Fixture: simula a tabela importada abr/2026 com bug de float no rate_to.
// Reproduz EXATAMENTE o estado do audit_logs (3 regras INSS novo +
// Publico geral cobrindo 1.78..1.87). Após o fix de matchesRange a
// INSS novo deve ganhar (priority maior + score maior).
const RULES_FIXTURE_BUGGY = [
  // INSS novo 48-60 (com rate bugado)
  {
    scope: "PROMOTER_MONTHLY_TABLE",
    priority: 120,
    product_keywords: ["CONSIGNADO CORRENTISTA", "CONSIGNADO NAO CORRENTISTA"],
    product_excludes: ["REFIN"],
    convenio_type: "PUBLICO",
    convenio_codes: [1640],
    uf_in: [],
    rate_from: 1.8499999999999999,
    rate_to: 1.8499999999999999,
    term_from: 48,
    term_to: 60,
    ticket_min: null,
    received_percent: 2.03,
    promoter_percent: 1.184099,
    label: "INSS novo",
  },
  // INSS novo 61-84
  {
    scope: "PROMOTER_MONTHLY_TABLE",
    priority: 120,
    product_keywords: ["CONSIGNADO CORRENTISTA", "CONSIGNADO NAO CORRENTISTA"],
    product_excludes: ["REFIN"],
    convenio_type: "PUBLICO",
    convenio_codes: [1640],
    uf_in: [],
    rate_from: 1.8499999999999999,
    rate_to: 1.8499999999999999,
    term_from: 61,
    term_to: 84,
    ticket_min: null,
    received_percent: 2.44,
    promoter_percent: 1.423252,
    label: "INSS novo",
  },
  // INSS novo 85..null  ← Thaynara 206728904 com 96 parc deve casar aqui
  {
    scope: "PROMOTER_MONTHLY_TABLE",
    priority: 120,
    product_keywords: ["CONSIGNADO CORRENTISTA", "CONSIGNADO NAO CORRENTISTA"],
    product_excludes: ["REFIN"],
    convenio_type: "PUBLICO",
    convenio_codes: [1640],
    uf_in: [],
    rate_from: 1.8499999999999999,
    rate_to: 1.8499999999999999,
    term_from: 85,
    term_to: null,
    ticket_min: null,
    received_percent: 3.34,
    promoter_percent: 1.948222,
    label: "INSS novo",
  },
  // Publico geral 1.78..1.87 (concorrente, priority menor)
  {
    scope: "PROMOTER_MONTHLY_TABLE",
    priority: 60,
    product_keywords: [
      "CONSIGNADO CORRENTISTA",
      "CONSIGNADO NAO CORRENTISTA",
      "CONSIGNADO CORRENTISTA REFIN",
      "CONSIGNADO NAO CORRENTISTA REFIN",
    ],
    product_excludes: [],
    convenio_type: "PUBLICO",
    convenio_codes: [],
    uf_in: [],
    rate_from: 1.78,
    rate_to: 1.87,
    term_from: 36,
    term_to: 120,
    ticket_min: null,
    received_percent: 2.44,
    promoter_percent: 1.423252,
    label: "Publico geral",
  },
];

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    product_description: "CONSIGNADO CORRENTISTA",
    product_code: "2882",
    convenio_type: null,
    convenio_code: null,
    interest_rate: 1.85,
    gross_value: 20600,
    term_months: 97,
    installments: 96,
    raw_payload: {
      UF: "AL",
      Prazo: "97",
      Parcelas: "96",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",
      "Taxa Mensal de Juros": "1.85",
    },
    ...overrides,
  };
}

test("findImportedProductionRule: INSS 96 parc taxa 1,85 → escolhe 3,34% (não Público 2,44%)", () => {
  const record = makeRecord();
  const rule = findImportedProductionRule(RULES_FIXTURE_BUGGY, record);
  assert.ok(rule, "deveria achar alguma regra");
  assert.equal(rule.label, "INSS novo");
  assert.equal(rule.term_from, 85);
  assert.equal(rule.term_to, null);
  assert.equal(rule.received_percent, 3.34);
});

test("findImportedProductionRule: INSS 60 parc taxa 1,85 → INSS novo 2,03% (faixa 48-60)", () => {
  const record = makeRecord({
    term_months: 61,
    installments: 60,
    raw_payload: {
      Prazo: "61",
      Parcelas: "60",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_BUGGY, record);
  assert.ok(rule, "deveria achar alguma regra");
  assert.equal(rule.label, "INSS novo");
  assert.equal(rule.received_percent, 2.03);
});

test("findImportedProductionRule: INSS 84 parc taxa 1,85 → INSS novo 2,44% (faixa 61-84)", () => {
  const record = makeRecord({
    term_months: 85,
    installments: 84,
    raw_payload: {
      Prazo: "85",
      Parcelas: "84",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_BUGGY, record);
  assert.ok(rule);
  assert.equal(rule.label, "INSS novo");
  assert.equal(rule.term_from, 61);
  assert.equal(rule.received_percent, 2.44);
});

// ===========================================================================
// REGRESSÃO — Público geral 1.78..1.87 com taxa fora da borda 1.85
// ===========================================================================

test("REGRESSÃO: Público geral 1.78..1.87 taxa 1.80 conv genérico → 2,44% (epsilon não influencia)", () => {
  // Conv 92059 (público sem tabela específica) — Publico geral aplica como fallback
  // legítimo. Antes do FIX-5 esse teste usava conv 1640 e quebrou; conv 1640
  // agora resulta null (esperado pela TRP35 — INSS sem casar tabela própria
  // não faz fallback). Trocado para conv genérico mantém o spirit: testar
  // que o epsilon de matchesRange não amplia a faixa indevidamente.
  const record = makeRecord({
    interest_rate: 1.80,
    raw_payload: {
      Prazo: "97",
      Parcelas: "96",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000092059",
      "Taxa Mensal de Juros": "1.80",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_BUGGY, record);
  assert.ok(rule);
  assert.equal(rule.label, "Publico geral");
  assert.equal(rule.received_percent, 2.44);
});

test("REGRESSÃO: taxa 9,99 fora de qualquer faixa → null (sem match)", () => {
  const record = makeRecord({
    interest_rate: 9.99,
    raw_payload: {
      Prazo: "97",
      Parcelas: "96",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",
      "Taxa Mensal de Juros": "9.99",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_BUGGY, record);
  assert.equal(rule, null);
});

test("REGRESSÃO: produto não-Consignado não casa keywords → null", () => {
  const record = makeRecord({
    product_description: "PORTABILIDADE PUBLICO",
    raw_payload: {
      Prazo: "97",
      Parcelas: "96",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_BUGGY, record);
  // PORTABILIDADE não está em product_keywords das regras do fixture
  assert.equal(rule, null);
});

// ===========================================================================
// Borda final: tabela LIMPA (pós-fix percentToUnits) deve produzir o mesmo
// resultado da tabela bugada (após fix de matchesRange).
// ===========================================================================

test("Tabela limpa (rate_to=1.85 exato) também escolhe INSS 3,34% pra 96 parc 1,85", () => {
  // Mesmo cenário, mas com rate_from/rate_to limpos — o que vai sair após
  // futuras importações com o percentToUnits corrigido.
  const cleanRules = RULES_FIXTURE_BUGGY.map((r) =>
    r.label === "INSS novo"
      ? { ...r, rate_from: 1.85, rate_to: 1.85 }
      : r
  );
  const record = makeRecord();
  const rule = findImportedProductionRule(cleanRules, record);
  assert.ok(rule);
  assert.equal(rule.label, "INSS novo");
  assert.equal(rule.received_percent, 3.34);
});

// ===========================================================================
// FIX-5 — TRP35 elegibilidade por convênio específico
// (convênio com tabela própria não faz fallback ao "Geral Público")
// ===========================================================================

// Fixture estendida — adiciona SIAPE (1078) + SP/MG (1.6) ao fixture original.
// Reproduz a tabela TRP35 abr/2026 completa relevante pra esses testes.
const RULES_FIXTURE_FULL = [
  ...RULES_FIXTURE_BUGGY,
  // SIAPE 48..null (TRP 1.5)
  {
    scope: "PROMOTER_MONTHLY_TABLE",
    priority: 110,
    product_keywords: [
      "CONSIGNADO CORRENTISTA",
      "CONSIGNADO NAO CORRENTISTA",
      "CONSIGNADO CORRENTISTA REFIN",
      "CONSIGNADO NAO CORRENTISTA REFIN",
    ],
    product_excludes: [],
    convenio_type: "PUBLICO",
    convenio_codes: [1078],
    uf_in: [],
    rate_from: 1.68,
    rate_to: 1.79,
    term_from: 48,
    term_to: 96,
    ticket_min: null,
    received_percent: 2.44,
    promoter_percent: 1.423252,
    label: "SIAPE",
  },
  // SP/MG (TRP 1.6) — UF SP/MG, prazo 36+
  {
    scope: "PROMOTER_MONTHLY_TABLE",
    priority: 100,
    product_keywords: [
      "CONSIGNADO CORRENTISTA",
      "CONSIGNADO NAO CORRENTISTA",
      "CONSIGNADO CORRENTISTA REFIN",
      "CONSIGNADO NAO CORRENTISTA REFIN",
    ],
    product_excludes: [],
    convenio_type: "PUBLICO",
    convenio_codes: [],
    uf_in: ["SP", "MG"],
    rate_from: 1.80,
    rate_to: 1.89,
    term_from: 36,
    term_to: 120,
    ticket_min: null,
    received_percent: 2.52,    // diferente do Publico geral 2,44%
    promoter_percent: 1.4700,
    label: "SP e MG",
  },
];

// Fixture com excludes explícitos (forma "a" — futura tabela importada limpa).
const RULES_FIXTURE_WITH_EXCLUDES = RULES_FIXTURE_FULL.map((r) =>
  r.label === "Publico geral"
    ? { ...r, convenio_codes_exclude: [1640, 1078], uf_in_exclude: ["SP", "MG"] }
    : r
);

test("FIX-5: INSS conv 1640 parc 36 → null (não comissiona, era 2,44 via Geral antes)", () => {
  // Caso Thaynara 206704082/210379955.
  const record = makeRecord({
    interest_rate: 1.85,
    term_months: 36,
    installments: 36,
    raw_payload: {
      UF: "AL",
      Prazo: "36",
      Parcelas: "36",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_FULL, record);
  // INSS novo não casa por prazo. Publico geral casaria, mas é fallback —
  // como existe regra específica conv 1640, é descartado → null.
  assert.equal(rule, null);
});

test("FIX-5: INSS conv 1640 parc 48 → INSS novo 2,03% (regra específica casa, continua funcionando)", () => {
  const record = makeRecord({
    interest_rate: 1.85,
    term_months: 48,
    installments: 48,
    raw_payload: {
      Prazo: "48",
      Parcelas: "48",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_FULL, record);
  assert.ok(rule);
  assert.equal(rule.label, "INSS novo");
  assert.equal(rule.received_percent, 2.03);
});

test("FIX-5: INSS conv 1640 parc 96 → INSS novo 3,34% (regressão FIX-4 continua)", () => {
  const record = makeRecord(); // default já é INSS 96 parc
  const rule = findImportedProductionRule(RULES_FIXTURE_FULL, record);
  assert.ok(rule);
  assert.equal(rule.label, "INSS novo");
  assert.equal(rule.received_percent, 3.34);
});

test("FIX-5: SIAPE conv 1078 parc 36 → null (SIAPE exige 48, não cai em Geral)", () => {
  const record = makeRecord({
    interest_rate: 1.75,
    term_months: 36,
    installments: 36,
    raw_payload: {
      Prazo: "36",
      Parcelas: "36",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001078",
      "Taxa Mensal de Juros": "1.75",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_FULL, record);
  assert.equal(rule, null);
});

test("FIX-5: SIAPE conv 1078 parc 48 taxa 1,70 → SIAPE específico 2,44%", () => {
  const record = makeRecord({
    interest_rate: 1.70,
    term_months: 48,
    installments: 48,
    raw_payload: {
      Prazo: "48",
      Parcelas: "48",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001078",
      "Taxa Mensal de Juros": "1.70",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_FULL, record);
  assert.ok(rule);
  assert.equal(rule.label, "SIAPE");
  assert.equal(rule.received_percent, 2.44);
});

test("FIX-5: UF SP parc 48 taxa 1,85 → SP/MG 2,52% (não Geral 2,44%)", () => {
  const record = makeRecord({
    interest_rate: 1.85,
    term_months: 48,
    installments: 48,
    raw_payload: {
      UF: "SP",
      Prazo: "48",
      Parcelas: "48",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000099999",  // qualquer público
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_FULL, record);
  assert.ok(rule);
  assert.equal(rule.label, "SP e MG");
  assert.equal(rule.received_percent, 2.52);
});

test("FIX-5: UF MG parc 96 → SP/MG (não Geral)", () => {
  const record = makeRecord({
    interest_rate: 1.85,
    term_months: 96,
    installments: 96,
    raw_payload: {
      UF: "MG",
      Prazo: "96",
      Parcelas: "96",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000099999",
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_FULL, record);
  assert.ok(rule);
  assert.equal(rule.label, "SP e MG");
});

test("FIX-5: conv 92059 (público SEM tabela específica) parc 36 → Publico geral 2,44% (fallback LEGÍTIMO mantém)", () => {
  const record = makeRecord({
    interest_rate: 1.85,
    term_months: 36,
    installments: 36,
    raw_payload: {
      UF: "AL",
      Prazo: "36",
      Parcelas: "36",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000092059",  // não tem regra própria
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_FULL, record);
  // Não há regra com convenio_codes incluindo 92059 nem uf_in incluindo AL
  // → fallback Publico geral pode ser usado.
  assert.ok(rule);
  assert.equal(rule.label, "Publico geral");
  assert.equal(rule.received_percent, 2.44);
});

test("FIX-5: conv vazio público parc 96 → Publico geral mantém (fallback legítimo)", () => {
  const record = makeRecord({
    interest_rate: 1.85,
    term_months: 96,
    installments: 96,
    raw_payload: {
      UF: "AL",
      Prazo: "96",
      Parcelas: "96",
      "Tipo de Convênio": "Público",
      "Código Convênio": "",       // vazio
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_FULL, record);
  // convenio_code parseado = 0; nem 1640 nem 1078, UF AL não está em SP/MG
  // → fallback Publico geral é elegível.
  assert.ok(rule);
  assert.equal(rule.label, "Publico geral");
  assert.equal(rule.received_percent, 2.44);
});

test("FIX-5: exclude explícito (forma 'a') — tabela limpa pós-fix do parser exclui conv 1640", () => {
  // Mesmo INSS 36 parc, mas com exclude declarado na regra Publico geral.
  // Mesmo se o post-match descartar estivesse desligado, o exclude do
  // filter já tira a regra. Cinto + suspensório.
  const record = makeRecord({
    interest_rate: 1.85,
    term_months: 36,
    installments: 36,
    raw_payload: {
      Prazo: "36",
      Parcelas: "36",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_WITH_EXCLUDES, record);
  assert.equal(rule, null);
});

test("FIX-5: exclude explícito (forma 'a') — UF SP descartada do Publico geral", () => {
  // Fixture sem regra SP/MG específica + Publico geral com uf_in_exclude.
  // Resultado: null (não comissiona via fallback porque UF excluída).
  const rulesNoSPMG = RULES_FIXTURE_WITH_EXCLUDES.filter((r) => r.label !== "SP e MG");
  const record = makeRecord({
    interest_rate: 1.85,
    term_months: 48,
    installments: 48,
    raw_payload: {
      UF: "SP",
      Prazo: "48",
      Parcelas: "48",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000099999",
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(rulesNoSPMG, record);
  // Sem regra SP/MG, mas Publico geral exclui SP via uf_in_exclude → null.
  assert.equal(rule, null);
});

// ===========================================================================
// FIX-5 REFINAMENTO — recordHasSpecificCoverage também checa keywords.
// Bug descoberto na ETAPA 3 v1: 30 propostas "CRÉDITO SALÁRIO REFIN" conv
// 1640 viraram null indevidamente (INSS refin tem conv 1640 mas suas
// keywords só cobrem "CONSIGNADO REFIN" — não cobre CRÉDITO SALÁRIO).
// Conv 1640 ali é só o código do tomador, não define a linha de produto.
// TRP35: linha de produto + convênio + prazo + taxa JUNTOS definem a regra.
// ===========================================================================

// Fixture estendida — adiciona "Credito nao consignado" (3.2) com keywords
// que cobrem CRÉDITO SALÁRIO REFIN. Replica o cenário real do banco.
const RULES_FIXTURE_WITH_CREDNAOCONS = [
  ...RULES_FIXTURE_FULL,
  // Credito nao consignado (TRP 3.2) — sem convenio específico, cobre
  // CRÉDITO SALÁRIO / SALÁRIO REFIN / AUTOMÁTICO / BENEFÍCIO.
  {
    scope: "PROMOTER_MONTHLY_TABLE",
    priority: 80,
    product_keywords: [
      "CREDITO AUTOMATICO",
      "CREDITO BENEFICIO",
      "CREDITO SALARIO",
      "CREDITO SALARIO REFIN",
    ],
    product_excludes: [],
    convenio_type: null,
    convenio_codes: [],
    convenio_codes_exclude: [],
    uf_in: [],
    uf_in_exclude: [],
    rate_from: 4.30,
    rate_to: 4.75,
    term_from: 13,
    term_to: 96,
    ticket_min: null,
    received_percent: 4.48,
    promoter_percent: 2.6131,
    label: "Credito nao consignado",
  },
  // INSS refin (TRP 1.3) — conv 1640 + keywords só "CONSIGNADO REFIN".
  // Importante: NÃO casa "CRÉDITO SALÁRIO REFIN" por keywords.
  {
    scope: "PROMOTER_MONTHLY_TABLE",
    priority: 120,
    product_keywords: [
      "CONSIGNADO CORRENTISTA REFIN",
      "CONSIGNADO NAO CORRENTISTA REFIN",
    ],
    product_excludes: [],
    convenio_type: "PUBLICO",
    convenio_codes: [1640],
    convenio_codes_exclude: [],
    uf_in: [],
    uf_in_exclude: [],
    rate_from: 1.00,
    rate_to: null,
    term_from: 48,
    term_to: 60,
    ticket_min: null,
    received_percent: 2.03,
    promoter_percent: 1.1841,
    label: "INSS refin",
  },
];

test("FIX-5 REFINAMENTO: CRÉDITO SALÁRIO REFIN conv 1640 parc 48 taxa 4.50 → Credito nao consignado (não null)", () => {
  // Bug: INSS refin tem conv 1640 mas keywords não cobrem "CRÉDITO SALÁRIO".
  // Sem refinamento, recordHasSpecificCoverage marca cobertura por conv e
  // descarta Credito nao consignado → null (errado).
  // Com refinamento (keyword check), INSS refin não conta como cobertura,
  // fallback Credito nao consignado permanece → 4,48%.
  const record = makeRecord({
    product_description: "CRÉDITO SALÁRIO REFIN",
    product_code: "3401",  // não-Consignado
    interest_rate: 4.50,
    term_months: 48,
    installments: 48,
    raw_payload: {
      UF: "AL",
      Prazo: "48",
      Parcelas: "48",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",
      "Taxa Mensal de Juros": "4.50",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_WITH_CREDNAOCONS, record);
  assert.ok(rule, "deveria casar Credito nao consignado, não null");
  assert.equal(rule.label, "Credito nao consignado");
  assert.equal(rule.received_percent, 4.48);
});

test("FIX-5 REFINAMENTO: CONSIGNADO CORRENTISTA REFIN conv 1640 parc 36 → null (INSS refin cobre por keyword+conv, prazo curto não casa)", () => {
  // INSS refin cobre keyword "CONSIGNADO CORRENTISTA REFIN" + conv 1640.
  // Prazo 36 abaixo do mínimo (48). recordHasSpecificCoverage = true →
  // fallback Credito nao consignado descartado → null.
  const record = makeRecord({
    product_description: "CONSIGNADO CORRENTISTA REFIN",
    product_code: "2882",
    interest_rate: 1.85,
    term_months: 36,
    installments: 36,
    raw_payload: {
      UF: "AL",
      Prazo: "36",
      Parcelas: "36",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_WITH_CREDNAOCONS, record);
  // INSS refin não casa prazo (mínimo 48). Não há outra regra que case
  // (Publico geral exigiria conv não-1640 ou está excluído). Resultado: null.
  // Importante: NÃO deve cair em Credito nao consignado (keywords não cobrem
  // CONSIGNADO REFIN).
  assert.equal(rule, null);
});

test("FIX-5 REFINAMENTO: CONSIGNADO NÃO CORRENTISTA conv 1640 parc 36 → null (8ª INSS-36 do banco)", () => {
  // A proposta 208868651 do banco real: CONSIGNADO NÃO CORRENTISTA, conv 1640,
  // 36 parc, taxa 1.85. INSS novo cobre keyword "CONSIGNADO NAO CORRENTISTA"
  // + conv 1640, mas exige prazo 48+. Resultado: null (não comissiona).
  const record = makeRecord({
    product_description: "CONSIGNADO NÃO CORRENTISTA",
    product_code: "2880",
    interest_rate: 1.85,
    term_months: 36,
    installments: 36,
    raw_payload: {
      UF: "AL",
      Prazo: "36",
      Parcelas: "36",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",
      "Taxa Mensal de Juros": "1.85",
    },
  });
  const rule = findImportedProductionRule(RULES_FIXTURE_WITH_CREDNAOCONS, record);
  assert.equal(rule, null);
});
