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

test("REGRESSÃO: Público geral 1.78..1.87 taxa 1.80 → 2,44% (faixa larga, epsilon não influencia)", () => {
  // Sem regra INSS conv 1640 que case (rate 1.80 fora da borda 1.85).
  // Só Publico geral é candidata. Deve escolher mesmo após o fix.
  const record = makeRecord({
    interest_rate: 1.80,
    raw_payload: {
      Prazo: "97",
      Parcelas: "96",
      "Tipo de Convênio": "Público",
      "Código Convênio": "000001640",  // não bate INSS porque rate 1.80 ≠ 1.85
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
