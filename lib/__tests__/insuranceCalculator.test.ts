/**
 * Testes do lib/insuranceCalculator.ts — Fase 3 PASSO 3.2.
 *
 * Como rodar (Node 24):
 *   node --experimental-strip-types --test lib/__tests__/insuranceCalculator.test.ts
 *
 * Cobre os 4 cenarios + 2 bordas:
 *   1. SLIP   2026-01-15 premio 198,03      → premio×2,5% = 4,95
 *   2. SLIP   2026-04-10 gross 12.382 p96   → gross×0,55% = 68,10
 *   3. ESTOQUE_D0 2026-01-15 premio 1.140,70 → premio×2,5% = 28,52
 *   4. ESTOQUE_D0 2026-04-09 gross 26.412,42 → gross×0,15% = 39,62
 *   5. borda: SLIP 2026-04 p36 → faixa 0-36 = 0,15% (nao 37-60)
 *   6. sem regra (insuranceType desconhecido) → null
 *
 * Plus extras de robustez (base requerida ausente, modality vazia, etc).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateInsuranceCommissionFromRules,
  type InsuranceSlipRule,
} from "../insuranceCalculator.ts";

// Fixture das 7 regras atualmente no banco (apos migration 20260530000000)
const RULES: InsuranceSlipRule[] = [
  // ESTOQUE_D0 pré-mar/2026
  { id: "r1", modality: "ESTOQUE_D0", term_min: 0, term_max: null,
    commission_percent: 0.025, base_field: "premio",
    valid_from: "2023-01-01", valid_until: "2026-02-28" },
  // ESTOQUE_D0 mar/2026+
  { id: "r2", modality: "ESTOQUE_D0", term_min: 0, term_max: null,
    commission_percent: 0.0015, base_field: "gross",
    valid_from: "2026-03-01", valid_until: null },
  // SLIP pré-mar/2026
  { id: "r3", modality: "SLIP", term_min: 0, term_max: null,
    commission_percent: 0.025, base_field: "premio",
    valid_from: "2023-01-01", valid_until: "2026-02-28" },
  // SLIP mar/2026+ — 4 faixas TRP §188
  { id: "r4", modality: "SLIP", term_min: 0, term_max: 36,
    commission_percent: 0.0015, base_field: "gross",
    valid_from: "2026-03-01", valid_until: null },
  { id: "r5", modality: "SLIP", term_min: 37, term_max: 60,
    commission_percent: 0.0025, base_field: "gross",
    valid_from: "2026-03-01", valid_until: null },
  { id: "r6", modality: "SLIP", term_min: 61, term_max: 84,
    commission_percent: 0.004, base_field: "gross",
    valid_from: "2026-03-01", valid_until: null },
  { id: "r7", modality: "SLIP", term_min: 85, term_max: null,
    commission_percent: 0.0055, base_field: "gross",
    valid_from: "2026-03-01", valid_until: null },
];

function approx(a: number, b: number, tol = 0.005) {
  return Math.abs(a - b) <= tol;
}

test("1) SLIP jan/2026 — premio×2,5% (regra legada)", () => {
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 24400.92,
    premioValue: 198.03,
    insuranceType: "SLIP",
    termPromotiva: 36,
    contractDate: "2026-01-15",
  });
  assert.ok(r, "deve retornar resultado");
  assert.equal(r!.ruleId, "r3");
  assert.equal(r!.modality, "SLIP");
  assert.equal(r!.baseField, "premio");
  assert.equal(r!.percent, 2.5);
  assert.ok(approx(r!.amount, 4.95), `amount=${r!.amount} esperado 4.95`);
});

test("2) SLIP abr/2026 prazo 96 — gross×0,55% (TRP §188 faixa 85+)", () => {
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 12381.99,
    premioValue: 2381.99,
    insuranceType: "SLIP",
    termPromotiva: 96,
    contractDate: "2026-04-10",
  });
  assert.ok(r);
  assert.equal(r!.ruleId, "r7");
  assert.equal(r!.baseField, "gross");
  assert.ok(approx(r!.percent, 0.55, 1e-9), `percent=${r!.percent}`);
  assert.ok(approx(r!.amount, 68.10, 0.01), `amount=${r!.amount} esperado 68.10`);
});

test("3) ESTOQUE_D0 jan/2026 — premio×2,5% (regra legada)", () => {
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 10800,
    premioValue: 1140.70,
    insuranceType: "ESTOQUE_D0",
    termPromotiva: 60,
    contractDate: "2026-01-15",
  });
  assert.ok(r);
  assert.equal(r!.ruleId, "r1");
  assert.equal(r!.baseField, "premio");
  assert.equal(r!.percent, 2.5);
  assert.ok(approx(r!.amount, 28.52, 0.01), `amount=${r!.amount} esperado 28.52`);
});

test("4) ESTOQUE_D0 abr/2026 — gross×0,15% (regra nova, parcela única)", () => {
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 26412.42,
    premioValue: 4314.66,
    insuranceType: "ESTOQUE_D0",
    termPromotiva: 96,
    contractDate: "2026-04-09",
  });
  assert.ok(r);
  assert.equal(r!.ruleId, "r2");
  assert.equal(r!.baseField, "gross");
  assert.ok(approx(r!.percent, 0.15, 1e-9));
  assert.ok(approx(r!.amount, 39.62, 0.01), `amount=${r!.amount} esperado 39.62`);
});

test("5) borda: SLIP abr/2026 parc=36 → faixa 0-36 (não 37-60)", () => {
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 2641.80,
    premioValue: 141.80,
    insuranceType: "SLIP",
    termPromotiva: 36,
    contractDate: "2026-04-28",
  });
  assert.ok(r);
  assert.equal(r!.ruleId, "r4", "deve casar a faixa 0-36, não 37-60");
  assert.equal(r!.baseField, "gross");
  assert.ok(approx(r!.percent, 0.15, 1e-9));
  assert.ok(approx(r!.amount, 3.96, 0.01));
});

test("6) sem regra: insuranceType desconhecido → null", () => {
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 10000,
    premioValue: 500,
    insuranceType: "XYZ_INEXISTENTE",
    termPromotiva: 36,
    contractDate: "2026-04-10",
  });
  assert.equal(r, null);
});

// === extras de robustez ===

test("7) insuranceType vazio → null", () => {
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 10000,
    premioValue: 500,
    insuranceType: "",
    termPromotiva: 36,
    contractDate: "2026-04-10",
  });
  assert.equal(r, null);
});

test("8) SLIP abr/2026 mas premio=0 (rule precisa gross) → bate normal", () => {
  // SLIP mar+ usa gross. premio=0 não importa.
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 12381.99,
    premioValue: 0,
    insuranceType: "SLIP",
    termPromotiva: 96,
    contractDate: "2026-04-10",
  });
  assert.ok(r);
  assert.equal(r!.baseField, "gross");
  assert.ok(approx(r!.amount, 68.10, 0.01));
});

test("9) SLIP jan/2026 mas premio=0 (rule precisa premio) → null", () => {
  // SLIP pré-mar usa premio. premio=0 → base inválida → null.
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 12381.99,
    premioValue: 0,
    insuranceType: "SLIP",
    termPromotiva: 36,
    contractDate: "2026-01-15",
  });
  assert.equal(r, null);
});

test("10) borda vigência: SLIP em 2026-02-28 ainda é regra legada", () => {
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 10000,
    premioValue: 500,
    insuranceType: "SLIP",
    termPromotiva: 96,
    contractDate: "2026-02-28",
  });
  assert.ok(r);
  assert.equal(r!.ruleId, "r3", "ainda regra legada (vigência inclusiva)");
  assert.equal(r!.baseField, "premio");
  assert.ok(approx(r!.amount, 12.50, 0.01));
});

test("11) borda vigência: SLIP em 2026-03-01 já é regra nova", () => {
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 10000,
    premioValue: 500,
    insuranceType: "SLIP",
    termPromotiva: 96,
    contractDate: "2026-03-01",
  });
  assert.ok(r);
  assert.equal(r!.ruleId, "r7", "regra nova faixa 85+");
  assert.equal(r!.baseField, "gross");
  assert.ok(approx(r!.amount, 55.0, 0.01));
});

test("12) normalização de modality: 'ESTOQUE D0' (com espaço) → ESTOQUE_D0", () => {
  const r = calculateInsuranceCommissionFromRules({
    rules: RULES,
    grossValue: 26412.42,
    premioValue: 4314.66,
    insuranceType: "ESTOQUE D0",   // com espaço, como vem do raw_payload
    termPromotiva: 96,
    contractDate: "2026-04-09",
  });
  assert.ok(r);
  assert.equal(r!.modality, "ESTOQUE_D0");
  assert.ok(approx(r!.amount, 39.62, 0.01));
});
