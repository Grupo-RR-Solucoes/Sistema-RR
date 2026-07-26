/**
 * Testes de lib/delta/calcularDelta.ts — Frente DELTA, Fase 1.
 *
 * Como rodar (Node 24, strip-types):
 *   node --experimental-strip-types --test lib/__tests__/calcularDelta.test.ts
 *
 * Cobre as decisoes do Diego (casos de borda) + a garantia estrutural de
 * "mesma fonte, mesma metrica" via deltaDaSerie.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  calcularDelta,
  competenciaAnterior,
  deltaDaSerie,
  formatarDelta,
  nomeMesExtenso,
  rotuloComparacao,
  type PontoSerie,
} from "../delta/calcularDelta.ts";

const JUL = { year: 2026, month: 7 };
const JAN = { year: 2026, month: 1 };

// ---------------------------------------------------------------------------
// Caminho feliz
// ---------------------------------------------------------------------------

test("1) alta simples: 1.124,00 sobre 1.000,00 -> +12,4% up", () => {
  const r = calcularDelta({ competencia: JUL, valorAtual: 1124, valorAnterior: 1000 });
  assert.equal(r.mostrar, true);
  assert.equal(r.deltaPct, 12.4);
  assert.equal(r.deltaAbs, 124);
  assert.equal(r.direcao, "up");
  assert.equal(r.motivoOculto, null);
});

test("2) queda: 900 sobre 1.000 -> -10% down", () => {
  const r = calcularDelta({ competencia: JUL, valorAtual: 900, valorAnterior: 1000 });
  assert.equal(r.deltaPct, -10);
  assert.equal(r.direcao, "down");
  assert.equal(r.mostrar, true);
});

test("3) rotulo do mes anterior vem por nome, derivado da competencia", () => {
  const r = calcularDelta({ competencia: JUL, valorAtual: 10, valorAnterior: 8 });
  assert.equal(r.labelAnterior, "junho");
  assert.equal(rotuloComparacao(r), "vs junho");
});

// ---------------------------------------------------------------------------
// Casos de borda — decisoes do Diego
// ---------------------------------------------------------------------------

test("4) M-1 = 0 -> mostrar=false (evita +infinito)", () => {
  const r = calcularDelta({ competencia: JUL, valorAtual: 5000, valorAnterior: 0 });
  assert.equal(r.mostrar, false);
  assert.equal(r.motivoOculto, "base-zero");
  assert.equal(r.deltaPct, null);
  assert.equal(formatarDelta(r), null);
});

test("5) M-1 ausente (null) -> mostrar=false", () => {
  const r = calcularDelta({ competencia: JUL, valorAtual: 5000, valorAnterior: null });
  assert.equal(r.mostrar, false);
  assert.equal(r.motivoOculto, "sem-anterior");
});

test("6) jan/2026 nao tem M-1 no ledger: serie sem dez/2025 -> esconde", () => {
  // A serie do Dashboard cobre so o ano corrente; dez/2025 nao esta la.
  const serie: PontoSerie[] = [
    { year: 2026, month: 1, valor: 1_000_000, fonte: "pmr" },
    { year: 2026, month: 2, valor: 1_200_000, fonte: "pmr" },
  ];
  const r = deltaDaSerie({ serie, competencia: JAN });
  assert.equal(r.mostrar, false);
  assert.equal(r.motivoOculto, "sem-anterior");
  // e a competencia anterior foi resolvida com virada de ano correta:
  assert.deepEqual(r.competenciaAnterior, { year: 2025, month: 12 });
  assert.equal(r.labelAnterior, "dezembro");
});

test("7) valor atual ausente -> mostrar=false", () => {
  const r = calcularDelta({ competencia: JUL, valorAtual: null, valorAnterior: 1000 });
  assert.equal(r.mostrar, false);
  assert.equal(r.motivoOculto, "sem-atual");
});

test("8) M-1 negativo (saldo) -> mostrar=false, nao inventa variacao", () => {
  const r = calcularDelta({ competencia: JUL, valorAtual: 500, valorAnterior: -200 });
  assert.equal(r.mostrar, false);
  assert.equal(r.motivoOculto, "base-negativa");
});

// ---------------------------------------------------------------------------
// Flat — evita "^0,0%"
// ---------------------------------------------------------------------------

test("9) variacao < 0,05% -> flat (mostra, mas sem seta)", () => {
  // 1.000.000 -> 1.000.400 = +0,04%
  const r = calcularDelta({ competencia: JUL, valorAtual: 1_000_400, valorAnterior: 1_000_000 });
  assert.equal(r.direcao, "flat");
  assert.equal(r.mostrar, true);
  assert.equal(r.deltaPct, 0);
  assert.equal(formatarDelta(r), "0,0%"); // sem sinal, sem seta
});

test("10) variacao exatamente na fronteira 0,05% -> ja conta como up", () => {
  const r = calcularDelta({ competencia: JUL, valorAtual: 1_000_500, valorAnterior: 1_000_000 });
  assert.equal(r.deltaPct, 0.1); // 0,05 arredonda para 0,1
  assert.equal(r.direcao, "up");
});

test("11) valores identicos -> flat", () => {
  const r = calcularDelta({ competencia: JUL, valorAtual: 777, valorAnterior: 777 });
  assert.equal(r.direcao, "flat");
  assert.equal(r.deltaPct, 0);
});

// ---------------------------------------------------------------------------
// Arredondamento e formatacao
// ---------------------------------------------------------------------------

test("12) deltaPct arredonda para 1 casa", () => {
  // 1000 -> 1123,7 = +12,37% -> 12,4
  const r = calcularDelta({ competencia: JUL, valorAtual: 1123.7, valorAnterior: 1000 });
  assert.equal(r.deltaPct, 12.4);
  assert.equal(formatarDelta(r), "+12,4%");
});

test("13) formatacao usa virgula decimal e sinal explicito", () => {
  const r = calcularDelta({ competencia: JUL, valorAtual: 850, valorAnterior: 1000 });
  assert.equal(formatarDelta(r), "-15,0%");
});

// ---------------------------------------------------------------------------
// Metrica do tipo percentual — variacao em pontos percentuais
// ---------------------------------------------------------------------------

test("14) percentual: 18,4% -> 20,7% = +2,3 p.p. (nao +12,5%)", () => {
  const r = calcularDelta({
    competencia: JUL,
    valorAtual: 20.7,
    valorAnterior: 18.4,
    tipo: "percentual",
  });
  assert.equal(r.deltaAbs, 2.3);
  assert.equal(r.deltaPct, null); // de proposito: "subiu X%" seria ambiguo
  assert.equal(r.direcao, "up");
  assert.equal(formatarDelta(r), "+2,3 p.p.");
});

// ---------------------------------------------------------------------------
// deltaDaSerie — garantia estrutural de mesma fonte / mesma metrica
// ---------------------------------------------------------------------------

test("15) deltaDaSerie extrai as duas pontas da MESMA serie", () => {
  const serie: PontoSerie[] = [
    { year: 2026, month: 5, valor: 3_000_000, fonte: "pmr" },
    { year: 2026, month: 6, valor: 4_000_000, fonte: "pmr" },
    { year: 2026, month: 7, valor: 4_500_000, fonte: "daily" },
  ];
  const r = deltaDaSerie({ serie, competencia: JUL });
  assert.equal(r.valorAtual, 4_500_000);
  assert.equal(r.valorAnterior, 4_000_000);
  assert.equal(r.deltaPct, 12.5);
  assert.equal(r.direcao, "up");
});

test("16) fontes diferentes nas pontas sao SINALIZADAS, nao escondidas", () => {
  const serie: PontoSerie[] = [
    { year: 2026, month: 6, valor: 4_000_000, fonte: "pmr" },
    { year: 2026, month: 7, valor: 4_500_000, fonte: "daily" },
  ];
  const r = deltaDaSerie({ serie, competencia: JUL });
  assert.equal(r.fontesDivergentes, true);
  assert.equal(r.fonteAtual, "daily");
  assert.equal(r.fonteAnterior, "pmr");
  assert.equal(r.mostrar, true); // continua valido: mesma metrica conceitual
});

test("17) mesma fonte nas duas pontas -> fontesDivergentes false", () => {
  const serie: PontoSerie[] = [
    { year: 2026, month: 6, valor: 100, fonte: "pmr" },
    { year: 2026, month: 7, valor: 110, fonte: "pmr" },
  ];
  const r = deltaDaSerie({ serie, competencia: JUL });
  assert.equal(r.fontesDivergentes, false);
});

test("18) ponto anterior com valor null na serie -> esconde", () => {
  const serie: PontoSerie[] = [
    { year: 2026, month: 6, valor: null, fonte: "vazio" },
    { year: 2026, month: 7, valor: 110, fonte: "daily" },
  ];
  const r = deltaDaSerie({ serie, competencia: JUL });
  assert.equal(r.mostrar, false);
  assert.equal(r.motivoOculto, "sem-anterior");
});

// ---------------------------------------------------------------------------
// Helpers de competencia
// ---------------------------------------------------------------------------

test("19) competenciaAnterior vira o ano em janeiro", () => {
  assert.deepEqual(competenciaAnterior({ year: 2026, month: 1 }), { year: 2025, month: 12 });
  assert.deepEqual(competenciaAnterior({ year: 2026, month: 7 }), { year: 2026, month: 6 });
});

test("20) nomeMesExtenso cobre os 12 meses", () => {
  assert.equal(nomeMesExtenso(1), "janeiro");
  assert.equal(nomeMesExtenso(6), "junho");
  assert.equal(nomeMesExtenso(12), "dezembro");
});
