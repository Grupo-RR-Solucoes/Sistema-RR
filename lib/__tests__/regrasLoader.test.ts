/**
 * Testes do lib/regrasLoader.ts — Fase 4.1.
 *
 * Como rodar:
 * - O projeto não tem framework de teste configurado.
 * - Use `scripts/check_regrasLoader.cjs` (Node 24 + fs.readFileSync) para
 *   validação executável imediata.
 * - Quando um framework for adotado (Vitest sugerido em Fase posterior),
 *   este arquivo já está pronto.
 *
 * Cobertura (8 cenários — espelhados no script CJS):
 * 1. resumoCobertura → 43 meses, 42 diretos, 1 inferido.
 * 2. getRegra("2024-07") → TRP09, regraInferida=false.
 * 3. getRegra("2023-09") → TRP01, regraInferida=true (fallback).
 * 4. getRegra("2024-04") → TRP05_2024-04b (errata sobre TRP04), regraInferida=false.
 * 5. getRegra("2025-09") → TRP27 (errata PR2025/130), regraInferida=false.
 * 6. getRegime("2025-04") = "META_4_NIVEIS"; getRegime("2026-04") = "VOLUME_5_FAIXAS".
 * 7. lookupPctInRegra ADIANTAMENTO_13 com taxa < tx_juros_min retorna pct=null.
 * 8. EPS: taxa 0.018000000000000002 e 0.018 caem na mesma faixa.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  getRegra,
  getRegime,
  lookupPctInRegra,
  resumoCobertura,
  EPS,
} from "../regrasLoader.ts";
import type { RegraMes } from "../regrasData.ts";

test("resumoCobertura: 43 meses (42 diretos + 1 inferido)", () => {
  const r = resumoCobertura();
  assert.equal(r.total, 43);
  assert.equal(r.diretos, 42);
  assert.equal(r.inferidos, 1);
  assert.equal(r.primeiroMes, "2022-12");
  assert.equal(r.ultimoMes, "2026-06");
});

test("getRegra('2024-07') retorna TRP09 (direto)", () => {
  const r = getRegra("2024-07");
  assert.ok(r);
  assert.equal(r.jsonRegra, "TRP09_2024-07.json");
  assert.equal(r.regraInferida, false);
  assert.equal(r.regra._meta.competencia, "2024-07");
});

test("getRegra('2023-09') usa fallback TRP01 com regraInferida=true", () => {
  const r = getRegra("2023-09");
  assert.ok(r);
  assert.equal(r.jsonRegra, "TRP01_2024-01.json");
  assert.equal(r.regraInferida, true);
});

test("getRegra('2024-04') usa errata TRP05_2024-04b (não TRP04)", () => {
  const r = getRegra("2024-04");
  assert.ok(r);
  assert.equal(r.jsonRegra, "TRP05_2024-04b.json");
  assert.equal(r.regraInferida, false);
});

test("getRegra('2025-09') usa errata TRP27 (PR2025/130)", () => {
  const r = getRegra("2025-09");
  assert.ok(r);
  assert.equal(r.jsonRegra, "TRP27_2025-09.json");
  assert.equal(r.regraInferida, false);
});

test("getRegime mapeia regimes corretamente", () => {
  assert.equal(getRegime("2023-01"), "META_2_NIVEIS_MATRIZ_TAXA_PRAZO");
  assert.equal(getRegime("2024-07"), "META_2_NIVEIS");
  assert.equal(getRegime("2025-04"), "META_4_NIVEIS");
  assert.equal(getRegime("2025-08"), "VOLUME_6_PERFIS");
  assert.equal(getRegime("2026-02"), "VOLUME_3_PERFIS");
  assert.equal(getRegime("2026-04"), "VOLUME_5_FAIXAS");
});

test("ADIANTAMENTO_13: taxa < tx_juros_min retorna pct=null (Bug #6)", () => {
  // TRP03_2024-03 declara ADIANTAMENTO_13 com tx_juros_min=0.0286
  // Contrato com taxa 0.0119 (1,19%) deve retornar pct=null.
  const r = getRegra("2024-03");
  assert.ok(r);
  const result = lookupPctInRegra(
    r.regra,
    "ADIANTAMENTO_13",
    0.0119,
    9,
    "Tabela 2",
    r.jsonRegra,
    r.regraInferida
  );
  assert.equal(result.pct, null);
  assert.match(result.celula ?? "", /FORA_DA_TABELA/);
});

test("EPS funciona: 0.018 e 0.018000000000000002 caem na mesma faixa", () => {
  // Construção sintética de RegraMes mínima
  const regraSintetica: RegraMes = {
    _meta: { regime: "META_2_NIVEIS" },
    INSS: {
      celulas_taxa: [
        { tx_min: 0.0175, tx_max: 0.018, "Tabela 2": 0.06 },
        { tx_min: 0.0181, tx_max: 0.019, "Tabela 2": 0.065 },
      ],
    },
  };
  const exato = lookupPctInRegra(regraSintetica, "INSS", 0.018, 24, "Tabela 2", "test", false);
  const ruidoso = lookupPctInRegra(
    regraSintetica,
    "INSS",
    0.018000000000000002,
    24,
    "Tabela 2",
    "test",
    false
  );
  assert.equal(exato.pct, 0.06);
  assert.equal(ruidoso.pct, 0.06);
});

test("EPS é 1e-7", () => {
  assert.equal(EPS, 1e-7);
});
