/**
 * Testes do lib/prazoTrp.ts — Fase 2 PASSO 2.1.
 *
 * Como rodar (Node 24, strip-types):
 *   node --experimental-strip-types --test lib/__tests__/prazoTrp.test.ts
 *
 * Cobre os 8 cenários do plano:
 *   1. produto 3100 + raw {Prazo:12, Parcelas:1} → 12
 *   2. produto 2882 + raw {Prazo:35, Parcelas:36} → 36  (caso Thaynara)
 *   3. produto 2882 + raw {Prazo:61, Parcelas:60} → 60
 *   4. produto 2882 + raw só {Parcelas:60} → 60
 *   5. produto 3100 + raw só {Parcelas:1} → 1 (fallback degraded + warn)
 *   6. produto 2882 + raw só {Prazo:35} → 35 (fallback degraded + warn)
 *   7. record sem raw_payload, term_months=40 → 40 (fallback final)
 *   8. record sem nada → null
 */

import test from "node:test";
import assert from "node:assert/strict";
import { getPrazoTrp } from "../prazoTrp.ts";

test("1) produto 3100 (13º) com Prazo=12 + Parcelas=1 → 12 (usa Prazo)", () => {
  const r = getPrazoTrp({
    product_code: "3100",
    raw_payload: { Prazo: 12, Parcelas: 1 },
  });
  assert.equal(r, 12);
});

test("2) produto 2882 (Consignado) com Prazo=35 + Parcelas=36 → 36 (caso Thaynara)", () => {
  const r = getPrazoTrp({
    product_code: "2882",
    raw_payload: { Prazo: 35, Parcelas: 36 },
  });
  assert.equal(r, 36);
});

test("3) produto 2882 com Prazo=61 + Parcelas=60 → 60 (Parcelas vence)", () => {
  const r = getPrazoTrp({
    product_code: "2882",
    raw_payload: { Prazo: 61, Parcelas: 60 },
  });
  assert.equal(r, 60);
});

test("4) produto 2882 com só Parcelas=60 (sem Prazo) → 60", () => {
  const r = getPrazoTrp({
    product_code: "2882",
    raw_payload: { Parcelas: 60 },
  });
  assert.equal(r, 60);
});

test("5) produto 3100 com só Parcelas=1 (sem Prazo) → 1 (fallback degraded + warn)", () => {
  // captura warns
  const origWarn = console.warn;
  const warned: string[] = [];
  console.warn = (...args: unknown[]) => {
    warned.push(args.map(String).join(" "));
  };
  const env = process.env as { NODE_ENV?: string };
  const prevEnv = env.NODE_ENV;
  env.NODE_ENV = "development";
  try {
    const r = getPrazoTrp({
      product_code: "3100",
      raw_payload: { Parcelas: 1 },
    });
    assert.equal(r, 1);
    assert.equal(warned.length, 1, "esperava 1 warn de fallback degraded");
    assert.match(warned[0], /Antecipação 13º/);
  } finally {
    console.warn = origWarn;
    env.NODE_ENV = prevEnv;
  }
});

test("6) produto 2882 com só Prazo=35 (sem Parcelas) → 35 (fallback degraded)", () => {
  const origWarn = console.warn;
  const warned: string[] = [];
  console.warn = (...args: unknown[]) => {
    warned.push(args.map(String).join(" "));
  };
  const env = process.env as { NODE_ENV?: string };
  const prevEnv = env.NODE_ENV;
  env.NODE_ENV = "development";
  try {
    const r = getPrazoTrp({
      product_code: "2882",
      raw_payload: { Prazo: 35 },
    });
    assert.equal(r, 35);
    assert.equal(warned.length, 1);
    assert.match(warned[0], /sem "Parcelas"/);
  } finally {
    console.warn = origWarn;
    env.NODE_ENV = prevEnv;
  }
});

test("7) record sem raw_payload, term_months=40 → 40 (fallback final)", () => {
  const r = getPrazoTrp({
    product_code: "2882",
    term_months: 40,
    raw_payload: null,
  });
  assert.equal(r, 40);
});

test("8) record sem nada → null", () => {
  const r = getPrazoTrp({});
  assert.equal(r, null);
});

// extras de robustez (não-essencial; documenta comportamento)
test("9) raw_payload com strings numéricas — converte corretamente", () => {
  const r = getPrazoTrp({
    product_code: "2882",
    raw_payload: { Prazo: "97", Parcelas: "96" },
  });
  assert.equal(r, 96);
});

test("10) product_code lido do raw_payload quando record.product_code ausente", () => {
  const r = getPrazoTrp({
    raw_payload: { "Codigo Produto": "3100", Prazo: 9, Parcelas: 1 },
  });
  assert.equal(r, 9, "deve identificar 3100 via raw e usar Prazo");
});

test("11) record.installments cobre quando raw e term_months ausentes", () => {
  const r = getPrazoTrp({
    product_code: "2882",
    installments: 48,
    raw_payload: null,
  });
  assert.equal(r, 48);
});

test("12) raw_payload com Prazo=0 (inválido) e Parcelas=24 → 24 (Prazo zero é descartado)", () => {
  const r = getPrazoTrp({
    product_code: "2882",
    raw_payload: { Prazo: 0, Parcelas: 24 },
  });
  assert.equal(r, 24);
});
