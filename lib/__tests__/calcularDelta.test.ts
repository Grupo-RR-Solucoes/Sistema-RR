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
  resolverJanela as resolverJanelaRaw,
  rotuloComparacao,
  rotuloJanela,
  ultimaPosicaoComDado,
  ultimoDiaDoMes,
  type PontoSerie,
} from "../delta/calcularDelta.ts";

// TOTAIS de DIAS DE PRODUCAO das janelas (productionBusinessWindow), MEDIDOS em
// 03/08/2026. Ficam aqui como literais de propósito: este suite roda em
// `node --test` puro, sem loader nem resolucao do alias "@/", e importar
// lib/delta/recorteJanela.ts (que importa lib/trp/vigencia) quebraria isso com
// ERR_MODULE_NOT_FOUND. As assercoes POSICIONAIS, que precisam do helper de
// verdade, vivem no gate (scripts/recorte_familia_janela_gate.cjs), que roda
// sob _ts_register e resolve o alias.
const TOTAL_DIAS_PRODUCAO: Record<string, number> = {
  "2025-12": 22,
  "2026-1": 21,
  "2026-2": 18,
  "2026-3": 22,
  "2026-6": 21,
  "2026-7": 23,
  "2026-8": 21,
};
const totalDe = (c: { year: number; month: number }) =>
  TOTAL_DIAS_PRODUCAO[`${c.year}-${c.month}`] ?? 21;

/**
 * Wrapper local: preenche totalAtual/totalAnterior a partir da tabela medida
 * acima, para os testes existentes seguirem legiveis (`{ competencia, modo, n }`)
 * sem repetir dois numeros em cada chamada.
 */
const resolverJanela = (
  p: Omit<Parameters<typeof resolverJanelaRaw>[0], "totalAtual" | "totalAnterior">
) =>
  resolverJanelaRaw({
    ...p,
    totalAtual: totalDe(p.competencia),
    totalAnterior: totalDe(competenciaAnterior(p.competencia)),
  });

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

// TOTAIS DE DIAS DE PRODUCAO das janelas usadas aqui (productionBusinessWindow,
// medidos em 03/08/2026): jul/26 = 23, jun/26 = 21, mar/26 = 22, fev/26 = 18,
// jan/26 = 21, dez/25 = 22. O clamp agora mede nessa unidade, e nao em dias do
// mes-calendario.
test("23) mes ABERTO no 20o dia de producao: corta 20 nos DOIS lados, sem clamp", () => {
  const j = resolverJanela({ competencia: JUL, modo: "ate-dia-N", n: 20 });
  assert.equal(j.modo, "ate-dia-N");
  assert.equal(j.diaCorteAtual, 20);
  assert.equal(j.diaCorteAnterior, 20); // junho tem 21 dias de producao, 20 cabe
  assert.equal(j.clampado, false);
});

test("24) CLAMP: julho tem 23 dias de producao e junho so 21 -> M-1 corta em 21", () => {
  const j = resolverJanela({ competencia: JUL, modo: "ate-dia-N", n: 23 });
  assert.equal(j.diaCorteAtual, 23);
  assert.equal(j.diaCorteAnterior, 21); // junho inteiro
  assert.equal(j.clampado, true);
});

test("25) CLAMP em fevereiro: marco tem 22 dias de producao, fev/2026 tem 18", () => {
  const j = resolverJanela({ competencia: { year: 2026, month: 3 }, modo: "ate-dia-N", n: 22 });
  assert.equal(j.diaCorteAtual, 22);
  assert.equal(j.diaCorteAnterior, 18);
  assert.equal(j.clampado, true);
});

test("26) virada de ano: jan/26 tem 21 e dez/25 tem 22 -> sem clamp", () => {
  const j = resolverJanela({ competencia: { year: 2026, month: 1 }, modo: "ate-dia-N", n: 21 });
  assert.equal(j.diaCorteAtual, 21);
  assert.equal(j.diaCorteAnterior, 21);
  assert.equal(j.clampado, false);
});

test("27) N fora do intervalo e sanitizado ao total da janela atual", () => {
  // junho/2026 tem 21 dias de producao: pedir 99 nao inventa dia nenhum.
  const j = resolverJanela({ competencia: { year: 2026, month: 6 }, modo: "ate-dia-N", n: 99 });
  assert.equal(j.diaCorteAtual, 21);
  const j2 = resolverJanela({ competencia: JUL, modo: "ate-dia-N", n: 0 });
  assert.equal(j2.diaCorteAtual, 1);
});

test("28) recorteIndisponivel forca mes-cheio e marca o motivo", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    n: 20,
    recorteIndisponivel: true,
  });
  assert.equal(j.modo, "mes-cheio");
  assert.equal(j.diaCorteAtual, null);
  assert.equal(j.recorteIndisponivel, true);
});

test("29) a janela viaja no resultado e vira rotulo", () => {
  const jRecorte = resolverJanela({ competencia: JUL, modo: "ate-dia-N", n: 20 });
  const r = calcularDelta({
    competencia: JUL,
    valorAtual: 4_332_356.55,
    valorAnterior: 4_846_718.35,
    janela: jRecorte,
  });
  assert.equal(r.janela.modo, "ate-dia-N");
  assert.equal(rotuloJanela(r), "20 dias");
  assert.equal(r.deltaPct, -10.6);
  assert.equal(r.direcao, "down");
});

test("29b) rotulo no singular quando o recorte tem 1 dia so", () => {
  const j = resolverJanela({ competencia: JUL, modo: "ate-dia-N", n: 1 });
  const r = calcularDelta({ competencia: JUL, valorAtual: 110, valorAnterior: 100, janela: j });
  assert.equal(rotuloJanela(r), "1 dia");
});

test("30) rotulo mostra as duas janelas quando houve clamp", () => {
  const j = resolverJanela({ competencia: JUL, modo: "ate-dia-N", n: 23 });
  const r = calcularDelta({ competencia: JUL, valorAtual: 110, valorAnterior: 100, janela: j });
  assert.equal(rotuloJanela(r), "23 x 21 dias");
});

test("31) rotulo avisa 'mes cheio' quando o recorte nao foi possivel", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    n: 20,
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

test("34) ultimaPosicaoComDado devolve a MAIOR posicao, nao o primeiro buraco", () => {
  // buracos no meio nao podem encurtar a janela
  assert.equal(ultimaPosicaoComDado([1, 2, 3, 6, 7, 8, 13, 17]), 17);
  assert.equal(ultimaPosicaoComDado([5]), 5);
  assert.equal(ultimaPosicaoComDado([]), null);
  assert.equal(ultimaPosicaoComDado(null), null);
  assert.equal(ultimaPosicaoComDado(undefined), null);
});

test("35) ultimaPosicaoComDado ignora posicoes fora de 1..31", () => {
  assert.equal(ultimaPosicaoComDado([10, 0, 32, -3, 99, 12]), 12);
});

test("36) CASO REAL 26/07: dado ate o 17o dia -> corta em 17 nos DOIS lados", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    n: 20,
    posicoesComDadoNaJanela: [1, 2, 3, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17],
  });
  assert.equal(j.diaCorteAtual, 17);
  assert.equal(j.diaCorteAnterior, 17); // MESMO N na ponta anterior
  assert.equal(j.diaHoje, 20);
  assert.equal(j.limitadoPorDado, true);
  assert.equal(j.clampado, false);
});

test("37) dado em posicao igual/maior que hoje -> nao limita (vence o hoje)", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    n: 20,
    posicoesComDadoNaJanela: [15, 20],
  });
  assert.equal(j.diaCorteAtual, 20);
  assert.equal(j.limitadoPorDado, false);
});

test("38) sem dado nenhum na janela corrente -> cai no comportamento da fase 2", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    n: 20,
    posicoesComDadoNaJanela: [],
  });
  assert.equal(j.diaCorteAtual, 20);
  assert.equal(j.limitadoPorDado, false);
});

test("39) o CLAMP continua valendo DEPOIS da limitacao 2.1", () => {
  // julho no 23o dia, dado ate 23, M-1 = junho (21 dias de producao) -> clampa 21
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    n: 23,
    posicoesComDadoNaJanela: [21, 22, 23],
  });
  assert.equal(j.diaCorteAtual, 23);
  assert.equal(j.diaCorteAnterior, 21);
  assert.equal(j.clampado, true);
  assert.equal(j.limitadoPorDado, false);
});

test("40) limitacao 2.1 E clamp juntos: marco no 22o, dado ate 20, M-1 fevereiro", () => {
  const j = resolverJanela({
    competencia: { year: 2026, month: 3 },
    modo: "ate-dia-N",
    n: 22,
    posicoesComDadoNaJanela: [20],
  });
  assert.equal(j.diaCorteAtual, 20); // limitado pelo dado
  assert.equal(j.limitadoPorDado, true);
  assert.equal(j.diaCorteAnterior, 18); // depois clampado por fevereiro (18 dias)
  assert.equal(j.clampado, true);
});

test("41) o rotulo mostra o N REAL, nao o N de hoje", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "ate-dia-N",
    n: 20,
    posicoesComDadoNaJanela: [17],
  });
  const r = calcularDelta({ competencia: JUL, valorAtual: 110, valorAnterior: 100, janela: j });
  assert.equal(rotuloJanela(r), "17 dias");
});

test("42b) REGRESSAO — o dia-cabeca da competencia CONTA, e conta como posicao 1", () => {
  // A janela de producao de julho comeca no ultimo dia util de JUNHO (30/06).
  //
  // ATE 03/08/2026 este teste afirmava o CONTRARIO: que o dia-cabeca precisava
  // ser EXCLUIDO do conjunto, porque com dia-do-mes 30 ele viraria o maximo e
  // desligaria a limitacao 2.1. Isso era verdade enquanto o conjunto era de
  // dias-do-mes — e era um remendo, nao uma regra: para nao deixar o numero 30
  // enganar o maximo, jogava-se fora a producao real do primeiro dia da janela.
  //
  // Em POSICAO o problema nao existe: 30/06 e a posicao 1 na janela de julho, a
  // MENOR de todas. O dia-cabeca deixa de precisar de excecao e volta a ser
  // contado, que e o correto — producao dele e producao da competencia.
  // As assercoes de POSICAO (30/06 -> 1, 01/07 -> 2, 29/06 -> 0) vivem no gate,
  // que consegue importar o helper. Aqui fica o efeito observavel na janela.
  //
  // Com o dia-cabeca no conjunto, a limitacao 2.1 SEGUE funcionando: ele nao
  // mascara mais nada porque nao e o maximo.
  const comCabeca = [1, 2, 3, 17]; // 1 = 30/06
  assert.equal(ultimaPosicaoComDado(comCabeca), 17);
  const j = resolverJanela({
    competencia: JUL, modo: "ate-dia-N", n: 20,
    posicoesComDadoNaJanela: comCabeca,
  });
  assert.equal(j.diaCorteAtual, 17);
  assert.equal(j.limitadoPorDado, true);
});

test("42) mes-cheio ignora posicoesComDado (nao vaza para competencia fechada)", () => {
  const j = resolverJanela({
    competencia: JUL,
    modo: "mes-cheio",
    n: 20,
    posicoesComDadoNaJanela: [17],
  });
  assert.equal(j.diaCorteAtual, null);
  assert.equal(j.limitadoPorDado, false);
  assert.equal(j.diaHoje, null);
});

test("33) deltaDaSerie repassa a janela intacta", () => {
  const j = resolverJanela({ competencia: JUL, modo: "ate-dia-N", n: 20 });
  const serie: PontoSerie[] = [
    { year: 2026, month: 6, valor: 4_846_718.35, fonte: "daily" },
    { year: 2026, month: 7, valor: 4_332_356.55, fonte: "daily" },
  ];
  const r = deltaDaSerie({ serie, competencia: JUL, janela: j });
  assert.equal(r.janela.diaCorteAtual, 20);
  assert.equal(r.fontesDivergentes, false); // recorte le a MESMA fonte dos 2 lados
  assert.equal(r.deltaPct, -10.6);
});

// ---------------------------------------------------------------------------
// BORDA DE MES VAZIO — zero SEM IMPORTACAO nao e queda.
//
// O par 43/44 e o coracao desta borda: MESMO valor atual (zero), MESMO valor
// anterior, e resultados OPOSTOS — so a contagem de linhas de origem muda. Se
// um dia alguem "simplificar" a guarda para olhar so o valor, o 44 cai.
// ---------------------------------------------------------------------------

test("43) mes atual ZERO e SEM linha de origem: esconde (nao e queda)", () => {
  const r = calcularDelta({
    competencia: { year: 2026, month: 8 },
    valorAtual: 0,
    valorAnterior: 4_332_356.55,
    linhasOrigemAtual: 0,
  });
  assert.equal(r.mostrar, false);
  assert.equal(r.motivoOculto, "atual-sem-importacao");
  assert.equal(formatarDelta(r), null);
});

test("44) mes atual ZERO mas COM linha de origem: MOSTRA -100% (nao vendeu, e informacao)", () => {
  const r = calcularDelta({
    competencia: { year: 2026, month: 8 },
    valorAtual: 0,
    valorAnterior: 4_332_356.55,
    linhasOrigemAtual: 12, // houve importacao; o mes existiu e nao vendeu
  });
  assert.equal(r.mostrar, true);
  assert.equal(r.motivoOculto, null);
  assert.equal(r.deltaPct, -100);
  assert.equal(r.direcao, "down");
  assert.equal(formatarDelta(r), "-100,0%");
});

test("45) sem informar linhasOrigemAtual, o comportamento anterior e preservado", () => {
  const r = calcularDelta({
    competencia: { year: 2026, month: 8 },
    valorAtual: 0,
    valorAnterior: 4_332_356.55,
  });
  assert.equal(r.mostrar, true);
  assert.equal(r.deltaPct, -100);
});

test("46) a borda so vale para valor ZERO: mes com pouco dado e muita venda mostra", () => {
  // Contagem baixa nao esconde nada. A guarda exige zero linha E zero valor;
  // 1 linha com venda e um mes de verdade, ainda que magro.
  const r = calcularDelta({
    competencia: { year: 2026, month: 8 },
    valorAtual: 1_000,
    valorAnterior: 4_332_356.55,
    linhasOrigemAtual: 1,
  });
  assert.equal(r.mostrar, true);
  assert.equal(r.motivoOculto, null);
});

test("47) a borda fica ANTES do M-1: sem importacao, o motivo util e esse", () => {
  // Mes atual vazio E sem M-1 consolidado. As duas guardas escondem; o motivo
  // registrado e o acionavel ("falta importar"), nao "nao ha mes anterior".
  const r = calcularDelta({
    competencia: { year: 2026, month: 8 },
    valorAtual: 0,
    valorAnterior: null,
    linhasOrigemAtual: 0,
  });
  assert.equal(r.mostrar, false);
  assert.equal(r.motivoOculto, "atual-sem-importacao");
});

test("48) deltaDaSerie repassa linhasOrigemAtual (Dashboard e /equipe dependem disso)", () => {
  // Reproduz a forma REAL das duas series: o mes corrente ja vem materializado
  // em zero (producaoMensal com monthsSet.add(month) no Dashboard; rangeMeses
  // ate o mes do refDate na /equipe). Sem o repasse, isto voltaria a dar -100%.
  const serie: PontoSerie[] = [
    { year: 2026, month: 7, valor: 4_332_356.55, fonte: "pmr+master" },
    { year: 2026, month: 8, valor: 0, fonte: "daily-vivo" },
  ];
  const semDado = deltaDaSerie({
    serie,
    competencia: { year: 2026, month: 8 },
    linhasOrigemAtual: 0,
  });
  assert.equal(semDado.mostrar, false);
  assert.equal(semDado.motivoOculto, "atual-sem-importacao");

  const comDado = deltaDaSerie({
    serie,
    competencia: { year: 2026, month: 8 },
    linhasOrigemAtual: 7,
  });
  assert.equal(comDado.mostrar, true);
  assert.equal(comDado.deltaPct, -100);
});
