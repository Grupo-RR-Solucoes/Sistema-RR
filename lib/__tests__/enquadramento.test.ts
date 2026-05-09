/**
 * Testes de lib/enquadramento.ts — Fase 4.2 Camada 1.
 *
 * Como rodar:
 *   - O projeto não tem framework de teste configurado (sem jest/vitest).
 *   - Use `node scripts/check_enquadramento.cjs` para validação executável
 *     contra Supabase (CHECKPOINT C — 41/41 vs audit_v9_enquadramento).
 *   - Quando Vitest entrar (Fase posterior), este arquivo já está pronto.
 *
 * Cobertura:
 * 1. decideCatDevida em META_2 (puro): pctMeta < 100% → TABELA 1; ≥ 100% → TABELA 2.
 * 2. decideCatDevida em META_4 com 4 tiers (Inter1, Inter2).
 * 3. decideCatDevida com OPP099 ativo: meta=0.95, pen=0.35 → TABELA 2 (META_2).
 * 4. decideCatDevida com OPP099 ativo em META_4 (sintético — dados reais não
 *    exercitam o cenário, mas a regra deve estar viva por spec v9 §4.1).
 * 5. decideCatDevida em VOLUME → null (INDETERMINADO).
 * 6. normalizeCategoria preserva acento e mapeia sinônimos Inter 1/2.
 * 7. decideStatusFase1: OK / DIVERGENTE_ENQUADRAMENTO / ENQUADRAMENTO_FAVORAVEL.
 *
 * Integração contra Supabase (audit_v9_enquadramento) — vide CJS executável.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  decideCatDevida,
  decideStatusFase1,
  normalizeCategoria,
} from "../enquadramento.ts";
import { getRegraEnquadramento } from "../regrasLoader.ts";

test("META_2: pctMeta < 100% → TABELA 1", () => {
  const regra = getRegraEnquadramento("2024-08");
  const r = decideCatDevida(regra, 0.85, 0.0);
  assert.equal(r.catDevida, "TABELA 1");
  assert.equal(r.opp099Triggered, false);
});

test("META_2: pctMeta ≥ 100% → TABELA 2", () => {
  const regra = getRegraEnquadramento("2024-08");
  const r = decideCatDevida(regra, 1.05, 0.10);
  assert.equal(r.catDevida, "TABELA 2");
  assert.equal(r.opp099Triggered, false);
});

test("OPP099 META_2: meta=0.95 + pen=0.35 → TABELA 2 (canário Jul/Set 2024)", () => {
  const regra = getRegraEnquadramento("2024-07");
  const r = decideCatDevida(regra, 0.9567, 0.3826);
  assert.equal(r.catDevida, "TABELA 2");
  assert.equal(r.opp099Triggered, true);
  assert.match(r.regraAplicada, /OPP099/);
});

test("Set/2023: motor TS diverge intencionalmente da v9 (DIVERGÊNCIA DOCUMENTADA)", () => {
  // Set/2023 é a única divergência documentada motor TS vs v9 humana.
  // Análise documental (gap_analysis.md §"DIVERGÊNCIA DOCUMENTADA — Sep/2023"):
  //   - Aba A Vista per-contract (coluna AD, 624 contratos): 32,0949% (verdade Promotiva)
  //   - Aba Resumo CNPJ AL D25: 0,00% (zerado, claramente bug)
  //   - Aba Resumo CNPJ PE D25: 13,4370% (também bugado, mas v9 humana copiou bit a bit)
  //   - v8 anterior tinha cat_devida=TABELA 2 (concordava com motor TS)
  //   - Promotiva aplicou TABELA 2 nos 527+ contratos (alinhada com per-contract)
  // Motor TS usa per-contract → TABELA 2. v9 humana usa snap PE corrupto → TABELA 1.
  const regra = getRegraEnquadramento("2023-09");

  // Cenário motor TS (per-contract): meta 96.15% in [0.90, 1.00) AND pen 32.09% ≥ 0.30
  // → OPP099 dispara → TABELA 2
  const motor = decideCatDevida(regra, 0.9615, 0.320949);
  assert.equal(motor.catDevida, "TABELA 2");
  assert.equal(motor.opp099Triggered, true);

  // Cenário v9 humana (copiou D25 PE corrupto = 13,44%): pen < 0.30 → OPP099 não fire → TABELA 1
  const v9Humana = decideCatDevida(regra, 0.9615, 0.1344);
  assert.equal(v9Humana.catDevida, "TABELA 1");
  assert.equal(v9Humana.opp099Triggered, false);

  // Confirmação: o motor diverge da v9 humana INTENCIONALMENTE neste mês.
  // Implicação: bônus favorável Set/2023 (R$ 19.087) inexistente — artefato do bug v9.
});

test("META_4: 4 tiers funcionam", () => {
  const regra = getRegraEnquadramento("2025-03");
  assert.equal(decideCatDevida(regra, 0.94, 0.50).catDevida, "TABELA 1");
  assert.equal(decideCatDevida(regra, 0.96, 0.0).catDevida, "TABELA INTERMEDIÁRIA 1");
  assert.equal(decideCatDevida(regra, 0.98, 0.0).catDevida, "TABELA INTERMEDIÁRIA 2");
  assert.equal(decideCatDevida(regra, 1.05, 0.0).catDevida, "TABELA 2");
});

test("OPP099 META_4 sintético: meta=0.95 + pen=0.35 → TABELA 2 (override Inter)", () => {
  // Dados reais Jan-Jun/2025 não disparam OPP099 (meta sempre fora do range
  // ou pen <30%), mas a regra deve estar viva por spec v9 §4.1.
  const regra = getRegraEnquadramento("2025-03");
  const r = decideCatDevida(regra, 0.95, 0.35);
  assert.equal(r.catDevida, "TABELA 2"); // overrides INTERMEDIÁRIA 1
  assert.equal(r.opp099Triggered, true);
});

test("VOLUME_3 (Rubi/Safira/Diamante): cat_devida = null (INDETERMINADO)", () => {
  const regra = getRegraEnquadramento("2026-01");
  const r = decideCatDevida(regra, null, null);
  assert.equal(r.catDevida, null);
  assert.equal(r.opp099Triggered, false);
  assert.match(r.regraAplicada, /INDETERMINADO/);
});

test("VOLUME_5 (FAIXA 5): cat_devida = null", () => {
  const regra = getRegraEnquadramento("2026-04");
  const r = decideCatDevida(regra, null, null);
  assert.equal(r.catDevida, null);
});

test("normalizeCategoria: preserva acento e maiúsculas", () => {
  assert.equal(normalizeCategoria("Tabela 1"), "TABELA 1");
  assert.equal(normalizeCategoria("Tabela Intermediária 1"), "TABELA INTERMEDIÁRIA 1");
  assert.equal(normalizeCategoria("Inter 1"), "TABELA INTERMEDIÁRIA 1");
  assert.equal(normalizeCategoria("INTERMEDIARIA 2"), "TABELA INTERMEDIÁRIA 2"); // sem acento
  assert.equal(normalizeCategoria("Upper Middle"), "UPPER MIDDLE");
  assert.equal(normalizeCategoria("Large Corporate"), "LARGE CORPORATE");
  assert.equal(normalizeCategoria("RUBI"), "RUBI");
  assert.equal(normalizeCategoria("safira"), "SAFIRA");
  assert.equal(normalizeCategoria("Faixa 3"), "FAIXA 3");
  assert.equal(normalizeCategoria(""), null);
  assert.equal(normalizeCategoria(null), null);
});

test("decideStatusFase1: OK quando cat_devida=cat_aplicada (META)", () => {
  assert.equal(
    decideStatusFase1({
      regraType: "META",
      catDevida: "TABELA 2",
      catAplicadaNorm: "TABELA 2",
      metaPf: 4630865,
    }),
    "OK"
  );
});

test("decideStatusFase1: DIVERGENTE_ENQUADRAMENTO quando Promotiva subenquadra", () => {
  // Set/2024: cat_devida=TABELA 2 (OPP099), cat_aplicada=TABELA 1
  assert.equal(
    decideStatusFase1({
      regraType: "META",
      catDevida: "TABELA 2",
      catAplicadaNorm: "TABELA 1",
      metaPf: 4630865,
    }),
    "DIVERGENTE_ENQUADRAMENTO"
  );
});

test("decideStatusFase1: ENQUADRAMENTO_FAVORAVEL quando Promotiva paga a maior", () => {
  // Set/2023: cat_devida=TABELA 1, cat_aplicada=TABELA 2
  assert.equal(
    decideStatusFase1({
      regraType: "META",
      catDevida: "TABELA 1",
      catAplicadaNorm: "TABELA 2",
      metaPf: 3238556,
    }),
    "ENQUADRAMENTO_FAVORAVEL"
  );
});

test("decideStatusFase1: INDETERMINADO em regime VOLUME", () => {
  assert.equal(
    decideStatusFase1({
      regraType: "VOLUME",
      catDevida: null,
      catAplicadaNorm: "UPPER MIDDLE",
      metaPf: 0,
    }),
    "INDETERMINADO"
  );
});

test("decideStatusFase1: SEM_DADOS quando snapshot ausente", () => {
  assert.equal(
    decideStatusFase1({
      regraType: "META",
      catDevida: null,
      catAplicadaNorm: null,
      metaPf: null,
    }),
    "SEM_DADOS"
  );
});
