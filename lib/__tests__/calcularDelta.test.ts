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
  resolverJanela,
  rotuloComparacao,
  rotuloJanela,
  ultimoDiaComDado,
  ultimoDiaDoMes,
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

// ---------------------------------------------------------------------------
// FASE 2 — janela e recorte por dia
// ---------------------------------------------------------------------------

test("21) ultimoDiaDoMes: 30, 31, fevereiro comum e bissexto", () => {
  assert.equal(ultimoDiaDoMes({ year: 2026, month: 6 }), 30);
  assert.equal(ultimoDiaDoMes({ year: 2026, month: 7 }), 31);
  assert.equal(ultimoDiaDoMes({ year: 2026, month: 2 }), 28);
  assert.equal(ultimoDiaDoMes({ year: 2028, month: 2 }), 29); // bissexto
});

test("22) mes FECHADO: janela mes-cheio, sem dias de corte", () => {
  const j = resolverJanela({ competencia: JUL, modo: "mes-cheio" });
  assert.equal(j.modo, "mes-cheio");
  assert.equal(j.diaCorteAtual, null);
  assert.equal(j.diaCorteAnterior, null);
  assert.equal(j.clampado, false);
  assert.equal(j.recorteIndisponivel, false);
});

test("23) mes ABERTO dia 26: corta 1-26 nos DOIS lados, sem clamp", () => {
  const j = resolverJanela({ competencia: JUL, modo: "ate-dia-N", dia: 26 });
  assert.equal(j.modo, "ate-dia-N");
  assert.equal(j.diaCorteAtual, 26);
  assert.equal(j.diaCorteAnterior, 26); // junho tem 30 dias, 26 cabe
  assert.equal(j.clampado, false);
});

test("24) CLAMP fim de mes: hoje 31/07 e junho tem 30 dias -> M-1 corta em 30", () => {
  const j = resolverJanela({ competencia: JUL, modo: "ate-dia-N", dia: 31 });
  assert.equal(j.diaCorteAtual, 31);
  assert.equal(j.diaCorteAnterior, 30); // junho inteiro
  assert.equal(j.clampado, true);
});

test("25) CLAMP em fevereiro: hoje 31/03 -> M-1 (fev/2026) corta em 28", () => {
  const j = resolverJanela({ competencia: { year: 2026, month: 3 }, modo: "ate-dia-N", dia: 31 });
  assert.equal(j.diaCorteAtual, 31);
  assert.equal(j.diaCorteAnterior, 28);
  assert.equal(j.clampado, true);
});

test("26) CLAMP com virada de ano: hoje 31/01 -> M-1 (dez) tem 31, sem clamp", () => {
  const j = resolverJanela({ competencia: { year: 2026, month: 1 }, modo: "ate-dia-N", dia: 31 });
  assert.equal(j.diaCorteAtual, 31);
  assert.equal(j.diaCorteAnterior, 31);
  assert.equal(j.clampado, false);
});

test("27) dia fora do intervalo e sanitizado ao mes corrente", () => {
  // 31 de junho nao existe: o proprio mes atual limita.
  const j = resolverJanela({ competencia: { year: 2026, month: 6 }, modo: "ate-dia-N", dia: 99 });
  assert.equal(j.diaCorteAtual, 30);
  const j2 = resolverJanela({ competencia: JUL, modo: "ate-dia-N", dia: 0 });
  assert.equal(j2.diaCorteAtual, 1);
});

test("28) recorteIndisponivel forca mes-cheio e marca o motivo", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    dia: 26,
    recorteIndisponivel: true,
  });
  assert.equal(j.modo, "mes-cheio");
  assert.equal(j.diaCorteAtual, null);
  assert.equal(j.recorteIndisponivel, true);
});

test("29) a janela viaja no resultado e vira rotulo", () => {
  const jRecorte = resolverJanela({ competencia: JUL, modo: "ate-dia-N", dia: 26 });
  const r = calcularDelta({
    competencia: JUL,
    valorAtual: 4_332_356.55,
    valorAnterior: 4_846_718.35,
    janela: jRecorte,
  });
  assert.equal(r.janela.modo, "ate-dia-N");
  assert.equal(rotuloJanela(r), "1-26");
  assert.equal(r.deltaPct, -10.6);
  assert.equal(r.direcao, "down");
});

test("30) rotulo mostra as duas janelas quando houve clamp", () => {
  const j = resolverJanela({ competencia: JUL, modo: "ate-dia-N", dia: 31 });
  const r = calcularDelta({ competencia: JUL, valorAtual: 110, valorAnterior: 100, janela: j });
  assert.equal(rotuloJanela(r), "1-31 x 1-30");
});

test("31) rotulo avisa 'mes cheio' quando o recorte nao foi possivel", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    dia: 26,
    recorteIndisponivel: true,
  });
  const r = calcularDelta({ competencia: JUL, valorAtual: 110, valorAnterior: 100, janela: j });
  assert.equal(rotuloJanela(r), "mes cheio");
});

test("32) mes FECHADO nao ganha rotulo de janela (nao poluir o card)", () => {
  const r = calcularDelta({ competencia: JUL, valorAtual: 110, valorAnterior: 100 });
  assert.equal(r.janela.modo, "mes-cheio");
  assert.equal(rotuloJanela(r), null);
});

// ---------------------------------------------------------------------------
// FASE 2.1 — N = min(hoje, ultimo dia com dado)
// ---------------------------------------------------------------------------

test("34) ultimoDiaComDado devolve o MAIOR dia, nao o primeiro buraco", () => {
  // buracos no meio (domingos/feriados) nao podem encurtar a janela
  assert.equal(ultimoDiaComDado([1, 2, 3, 6, 7, 8, 13, 20, 23]), 23);
  assert.equal(ultimoDiaComDado([5]), 5);
  assert.equal(ultimoDiaComDado([]), null);
  assert.equal(ultimoDiaComDado(null), null);
  assert.equal(ultimoDiaComDado(undefined), null);
});

test("35) ultimoDiaComDado ignora dias fora de 1..31", () => {
  assert.equal(ultimoDiaComDado([10, 0, 32, -3, 99, 12]), 12);
});

test("36) CASO REAL 26/07: dado ate 23 -> corta em 23 nos DOIS lados", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    dia: 26,
    diasComDadoNoMesCorrente: [1, 2, 3, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 20, 21, 22, 23],
  });
  assert.equal(j.diaCorteAtual, 23);
  assert.equal(j.diaCorteAnterior, 23); // MESMO N na ponta anterior
  assert.equal(j.diaHoje, 26);
  assert.equal(j.limitadoPorDado, true);
  assert.equal(j.clampado, false);
});

test("37) dado em dia igual/maior que hoje -> nao limita (vence o hoje)", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    dia: 26,
    diasComDadoNoMesCorrente: [20, 26],
  });
  assert.equal(j.diaCorteAtual, 26);
  assert.equal(j.limitadoPorDado, false);
});

test("38) sem dado nenhum no mes corrente -> cai no comportamento da fase 2", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    dia: 26,
    diasComDadoNoMesCorrente: [],
  });
  assert.equal(j.diaCorteAtual, 26);
  assert.equal(j.limitadoPorDado, false);
});

test("39) o CLAMP de fim de mes continua valendo DEPOIS da limitacao 2.1", () => {
  // hoje 31/07, dado ate 31, M-1 = junho (30 dias) -> clampa em 30
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    dia: 31,
    diasComDadoNoMesCorrente: [29, 30, 31],
  });
  assert.equal(j.diaCorteAtual, 31);
  assert.equal(j.diaCorteAnterior, 30);
  assert.equal(j.clampado, true);
  assert.equal(j.limitadoPorDado, false);
});

test("40) limitacao 2.1 E clamp juntos: dado ate 31, hoje 31, M-1 fevereiro", () => {
  const j = resolverJanela({
    competencia: { year: 2026, month: 3 },
    modo: "ate-dia-N",
    dia: 31,
    diasComDadoNoMesCorrente: [30],
  });
  assert.equal(j.diaCorteAtual, 30); // limitado pelo dado
  assert.equal(j.limitadoPorDado, true);
  assert.equal(j.diaCorteAnterior, 28); // depois clampado por fevereiro
  assert.equal(j.clampado, true);
});

test("41) o rotulo mostra o N REAL, nao o dia de hoje", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    dia: 26,
    diasComDadoNoMesCorrente: [23],
  });
  const r = calcularDelta({ competencia: JUL, valorAtual: 110, valorAnterior: 100, janela: j });
  assert.equal(rotuloJanela(r), "1-23");
});

test("42b) REGRESSAO — o dia-cabeca da competencia nao pode virar o maximo", () => {
  // A janela de producao de julho comeca no ultimo dia util de JUNHO (30/06).
  // Esse registro tem dia-do-mes 30. Se ele entrar no conjunto, max=30 e a
  // limitacao 2.1 nao acontece — o card volta a ler atraso de importacao como
  // queda. Quem monta o conjunto DEVE filtrar pelo mes-calendario (ver o
  // contrato de diasComDadoNoMesCorrente).
  const comCabeca = [30, 1, 2, 3, 23]; // 30 = 30/06, indevido
  const semCabeca = [1, 2, 3, 23]; // so julho
  assert.equal(ultimoDiaComDado(comCabeca), 30); // <- o que dava errado
  assert.equal(ultimoDiaComDado(semCabeca), 23); // <- o correto

  const errado = resolverJanela({
    competencia: JUL, modo: "ate-dia-N", dia: 26,
    diasComDadoNoMesCorrente: comCabeca,
  });
  const certo = resolverJanela({
    competencia: JUL, modo: "ate-dia-N", dia: 26,
    diasComDadoNoMesCorrente: semCabeca,
  });
  assert.equal(errado.diaCorteAtual, 26);
  assert.equal(errado.limitadoPorDado, false);
  assert.equal(certo.diaCorteAtual, 23);
  assert.equal(certo.limitadoPorDado, true);
});

test("42) mes-cheio ignora diasComDado (nao vaza para competencia fechada)", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "mes-cheio",
    dia: 26,
    diasComDadoNoMesCorrente: [23],
  });
  assert.equal(j.diaCorteAtual, null);
  assert.equal(j.limitadoPorDado, false);
  assert.equal(j.diaHoje, null);
});

test("33) deltaDaSerie repassa a janela intacta", () => {
  const j = resolverJanela({ competencia: JUL, modo: "ate-dia-N", dia: 26 });
  const serie: PontoSerie[] = [
    { year: 2026, month: 6, valor: 4_846_718.35, fonte: "daily" },
    { year: 2026, month: 7, valor: 4_332_356.55, fonte: "daily" },
  ];
  const r = deltaDaSerie({ serie, competencia: JUL, janela: j });
  assert.equal(r.janela.diaCorteAtual, 26);
  assert.equal(r.fontesDivergentes, false); // recorte le a MESMA fonte dos 2 lados
  assert.equal(r.deltaPct, -10.6);
});
