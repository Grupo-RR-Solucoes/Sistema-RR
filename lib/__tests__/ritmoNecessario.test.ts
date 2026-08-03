/**
 * Testes de lib/ritmoNecessario.ts — Frente RITMO DIARIO, Fase 1.
 *
 * Como rodar (Node 24, strip-types):
 *   node --experimental-strip-types --test lib/__tests__/ritmoNecessario.test.ts
 *
 * Um teste por ESTADO, mais a identidade algebrica, a virada de cor e o caso
 * REAL de julho/2026 (janela encerrada com regime ainda aberto).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  calcularRitmoNecessario,
  diasRestantesDe,
  metaPropriaDoGrupo,
  montarFarolPromotor,
  semaforoPisoAlvo,
  FAROL_MULTIPLO_INALCANCAVEL,
  META_DIARIA_GRUPO,
} from "../ritmoNecessario.ts";
import type { JanelaRitmo } from "../janelaRitmo.ts";

// Janela sintetica: os testes do helper de ritmo NAO devem depender do
// calendario real (um feriado novo mudaria o numero e quebraria teste que nao
// fala de feriado). A aritmetica de dia util tem os gates dela em
// janela_ritmo_paridade_gate / projecao_dias_ritmo_gate.
function janela(over: Partial<JanelaRitmo> = {}): JanelaRitmo {
  return {
    start: new Date(Date.UTC(2026, 6, 31)),
    end: new Date(Date.UTC(2026, 7, 28)),
    total: 21,
    holidays: new Set<string>(),
    refDate: new Date(Date.UTC(2026, 7, 10)),
    diasDecorridos: 6,
    diasParaRitmo: 5,
    periodoCompleto: false,
    ...over,
  };
}

// Reproduz projetarPorRitmo SO para alimentar o parametro `projecao` nos
// testes. A formula com dono vive em lib/janelaRitmo.ts; aqui ela e a ENTRADA
// do helper, nunca a conta dele.
function proj(j: JanelaRitmo, acum: number): number {
  if (j.periodoCompleto) return acum;
  return j.diasParaRitmo > 0 ? (acum / j.diasParaRitmo) * j.total : 0;
}

/** Atalho: monta os parametros com a projecao coerente com a janela. */
function calc(meta: number | null, acumulado: number, j: JanelaRitmo, mesFechado = false) {
  return calcularRitmoNecessario({ meta, acumulado, janela: j, projecao: proj(j, acumulado), mesFechado });
}

// --------------------------------------------------------------- DIAS
test("1) dias restantes = total - diasParaRitmo (inclui HOJE em dia util)", () => {
  // diasParaRitmo ja e diasDecorridos-1 em dia util aberto, entao o que sobra
  // sao os dias futuros MAIS hoje.
  assert.equal(diasRestantesDe(janela({ total: 21, diasParaRitmo: 5 })), 16);
});

test("2) dia NAO util: diasParaRitmo == diasDecorridos, sobra so o futuro", () => {
  // 02/08/2026 e domingo: total=21, decorridos=1, diasParaRitmo=1 -> 20.
  assert.equal(diasRestantesDe(janela({ total: 21, diasDecorridos: 1, diasParaRitmo: 1 })), 20);
});

test("3) dias restantes nunca e negativo", () => {
  assert.equal(diasRestantesDe(janela({ total: 21, diasParaRitmo: 30 })), 0);
});

// ------------------------------------------------------------- ESTADOS
test("4) SEM_META — meta zero nao vira ritmo, vira estado", () => {
  const r = calc(0, 1_000_000, janela());
  assert.equal(r.estado, "SEM_META");
  assert.equal(r.ritmoDiario, null);
  assert.equal(r.percent, null);
  assert.equal(r.semaforo, "sem_meta");
});

test("4b) SEM_META — meta null (nao cadastrada): o caso REAL de ago/2026", () => {
  const r = calc(null, 0, janela());
  assert.equal(r.estado, "SEM_META");
  assert.equal(r.ritmoDiario, null);
  assert.equal(r.semaforo, "sem_meta");
});

test("5) META_BATIDA — mostra o excedente, NUNCA ritmo negativo", () => {
  const r = calc(5_000_000, 5_400_000, janela());
  assert.equal(r.estado, "META_BATIDA");
  assert.equal(r.ritmoDiario, null); // <- o ponto: nada de "-X por dia"
  assert.equal(r.excedente, 400_000);
  assert.equal(r.falta, 0);
});

test("5b) META_BATIDA vence MES_FECHADO — num mes fechado que bateu, bateu E a retrospectiva", () => {
  const r = calc(5_000_000, 5_400_000, janela({ periodoCompleto: true, diasParaRitmo: 21 }), true);
  assert.equal(r.estado, "META_BATIDA");
  assert.equal(r.excedente, 400_000);
});

test("6) MES_FECHADO — retrospectivo, com o quanto faltou e sem ritmo", () => {
  const r = calc(5_000_000, 4_200_000, janela({ periodoCompleto: true, diasParaRitmo: 21 }), true);
  assert.equal(r.estado, "MES_FECHADO");
  assert.equal(r.ritmoDiario, null);
  assert.equal(r.falta, 800_000);
});

test("7) julho/2026 REAL — total=23, diasParaRitmo=23, regime aberto, meta BATIDA", () => {
  // Medido em 02/08/2026: a janela de julho encerrou (refDate > end) mas o
  // fechamento nao foi importado, entao mesFechado=false. Nao pode dividir por
  // zero nem exibir ritmo.
  const j = janela({ total: 23, diasParaRitmo: 23, periodoCompleto: true });
  const r = calc(6_402_000, 6_426_690.15, j);
  assert.equal(r.estado, "META_BATIDA"); // julho bateu
  assert.equal(r.diasRestantes, 0);
  assert.equal(r.ritmoDiario, null);
});

test("7b) SEM_DIAS — janela encerrada, regime aberto e meta NAO batida", () => {
  const j = janela({ total: 23, diasParaRitmo: 23, periodoCompleto: true });
  const r = calc(7_000_000, 6_426_690.15, j);
  assert.equal(r.estado, "SEM_DIAS");
  assert.equal(r.diasRestantes, 0);
  assert.equal(r.ritmoDiario, null); // <- NUNCA divide por zero
  assert.equal(r.falta, 573_309.85);
});

test("8) ULTIMO_DIA — 1 dia restante: o ritmo E o que falta, sem dividir", () => {
  const r = calc(5_000_000, 4_800_000, janela({ total: 21, diasParaRitmo: 20 }));
  assert.equal(r.estado, "ULTIMO_DIA");
  assert.equal(r.diasRestantes, 1);
  assert.equal(r.ritmoDiario, 200_000);
  assert.equal(r.ritmoDiario, r.falta);
});

test("9) NORMAL — (meta - acumulado) / dias restantes", () => {
  const r = calc(5_250_000, 1_250_000, janela({ total: 21, diasParaRitmo: 5 }));
  assert.equal(r.estado, "NORMAL");
  assert.equal(r.diasRestantes, 16);
  assert.equal(r.ritmoDiario, 250_000); // 4.000.000 / 16
});

// --------------------------------------------------------- IDENTIDADE
test("10) IDENTIDADE — ritmo x dias restantes + acumulado == meta", () => {
  for (const [meta, acum, total, dpr] of [
    [5_250_000, 1_250_000, 21, 5],
    [6_402_000, 2_000_000, 23, 9],
    [1_000_000, 1, 20, 3],
  ] as const) {
    const r = calc(meta, acum, janela({ total, diasParaRitmo: dpr }));
    assert.ok(r.ritmoDiario != null, `esperava ritmo em ${meta}/${acum}`);
    const reconstruida = r.ritmoDiario! * r.diasRestantes + r.acumulado;
    // Tolerancia: ritmoDiario e arredondado a 2 casas, entao o erro maximo da
    // reconstrucao e meio centavo por dia restante.
    assert.ok(
      Math.abs(reconstruida - meta) <= 0.005 * r.diasRestantes + 0.01,
      `identidade quebrou: ${reconstruida} vs ${meta}`,
    );
  }
});

test("10b) IDENTIDADE exata quando a divisao e inteira", () => {
  const r = calc(5_250_000, 1_250_000, janela({ total: 21, diasParaRitmo: 5 }));
  assert.equal(r.ritmoDiario! * r.diasRestantes + r.acumulado, 5_250_000);
});

// ------------------------------------------------------------------- COR
test("11) VIRADA DE COR — o ponto exato em que amarelo vira vermelho (80%)", () => {
  // Com total=20 e diasParaRitmo=10, projecao = acumulado x 2.
  // meta 1.000.000 -> amarelo exige projecao >= 800.000 -> acumulado >= 400.000.
  const j = janela({ total: 20, diasParaRitmo: 10 });

  const amarelo = calc(1_000_000, 400_000, j);
  assert.equal(amarelo.percent, 0.8);
  assert.equal(amarelo.semaforo, "amarelo");

  const vermelho = calc(1_000_000, 399_999, j);
  assert.ok(vermelho.percent! < 0.8);
  assert.equal(vermelho.semaforo, "vermelho");
});

test("12) VIRADA DE COR — 100% e verde; um passo abaixo e amarelo", () => {
  const j = janela({ total: 20, diasParaRitmo: 10 });

  const verde = calc(1_000_000, 500_000, j);
  assert.equal(verde.percent, 1);
  assert.equal(verde.semaforo, "verde");

  const amarelo = calc(1_000_000, 499_999, j);
  assert.equal(amarelo.semaforo, "amarelo");
});

test("13) EQUIVALENCIA — 'projecao >= meta' e 'ritmo realizado >= necessario'", () => {
  // A demonstracao algebrica esta no cabecalho de calcularRitmoNecessario.
  // Aqui ela e exercitada numericamente em varios pontos.
  const j = janela({ total: 20, diasParaRitmo: 10 });
  for (const acum of [100_000, 400_000, 499_999, 500_000, 900_000]) {
    const r = calc(1_000_000, acum, j);
    if (r.estado !== "NORMAL") continue;
    const ritmoRealizado = acum / j.diasParaRitmo;
    const baterPelaProjecao = r.percent! >= 1;
    const baterPeloRitmo = ritmoRealizado >= r.ritmoDiario!;
    assert.equal(
      baterPelaProjecao,
      baterPeloRitmo,
      `divergiu em acumulado=${acum}: projecao=${baterPelaProjecao} ritmo=${baterPeloRitmo}`,
    );
  }
});

test("14) diasParaRitmo=0 (dia 1 do mes): projecao 0 e vermelho, mas o ritmo EXISTE", () => {
  // Limite documentado: nao ha ritmo REALIZADO para comparar, entao a
  // equivalencia nao tem os dois lados. Vermelho ali le "ainda nao produziu".
  const r = calc(5_250_000, 0, janela({ total: 21, diasParaRitmo: 0, diasDecorridos: 0 }));
  assert.equal(r.percent, 0);
  assert.equal(r.semaforo, "vermelho");
  assert.equal(r.estado, "NORMAL");
  assert.equal(r.diasRestantes, 21);
  assert.equal(r.ritmoDiario, 250_000); // 5.250.000 / 21
});

// ------------------------------------------------- PISO x ALVO (3 FAIXAS)
// Numeros reais de julho/2026: piso 5.750.000 (250k x 23) e alvo 6.402.000.
const PISO_JUL = 5_750_000;
const ALVO_JUL = 6_402_000;

test("16) TRES FAIXAS — abaixo do piso e VERMELHO", () => {
  assert.equal(
    semaforoPisoAlvo({ projecao: 5_000_000, piso: PISO_JUL, alvo: ALVO_JUL }),
    "vermelho",
  );
});

test("17) TRES FAIXAS — entre piso e alvo e AMARELO (a faixa do meio)", () => {
  // E a razao do card existir: passou do minimo, ainda nao chegou na meta.
  assert.equal(
    semaforoPisoAlvo({ projecao: 6_000_000, piso: PISO_JUL, alvo: ALVO_JUL }),
    "amarelo",
  );
});

test("18) TRES FAIXAS — no alvo ou acima e VERDE", () => {
  assert.equal(semaforoPisoAlvo({ projecao: ALVO_JUL, piso: PISO_JUL, alvo: ALVO_JUL }), "verde");
  assert.equal(
    semaforoPisoAlvo({ projecao: ALVO_JUL + 1, piso: PISO_JUL, alvo: ALVO_JUL }),
    "verde",
  );
});

test("19) LIMITES EXATOS das tres faixas", () => {
  // No piso exato ja e amarelo; um centavo abaixo e vermelho.
  assert.equal(semaforoPisoAlvo({ projecao: PISO_JUL, piso: PISO_JUL, alvo: ALVO_JUL }), "amarelo");
  assert.equal(
    semaforoPisoAlvo({ projecao: PISO_JUL - 0.01, piso: PISO_JUL, alvo: ALVO_JUL }),
    "vermelho",
  );
  // Um centavo abaixo do alvo ainda e amarelo.
  assert.equal(
    semaforoPisoAlvo({ projecao: ALVO_JUL - 0.01, piso: PISO_JUL, alvo: ALVO_JUL }),
    "amarelo",
  );
});

test("20) VERDE nunca fica mais facil que na escala de uma meta so", () => {
  // A decisao de verde e a MESMA: projecao >= alvo. O piso so desempata o
  // resto. Varredura: em nenhum ponto a variante devolve verde onde a escala
  // canonica nao devolveria.
  for (const projecao of [0, 1_000_000, PISO_JUL, 6_000_000, ALVO_JUL - 1, ALVO_JUL, 9_000_000]) {
    const tres = semaforoPisoAlvo({ projecao, piso: PISO_JUL, alvo: ALVO_JUL });
    const uma = projecao / ALVO_JUL >= 1 ? "verde" : "nao-verde";
    assert.equal(
      tres === "verde" ? "verde" : "nao-verde",
      uma,
      `verde divergiu em projecao=${projecao}`,
    );
  }
});

test("21) o piso de julho e MAIS exigente que o 80% da escala de uma meta", () => {
  // 5.750.000 / 6.402.000 = 89,8%. Enquanto essa relacao valer, a faixa de
  // tres nunca e mais permissiva que a de uma. O gate mede isso em producao.
  assert.ok(PISO_JUL / ALVO_JUL > 0.8, `piso/alvo=${(PISO_JUL / ALVO_JUL).toFixed(3)}`);
  // Prova pratica: projecao a 85% do alvo e amarelo na escala de uma meta...
  const projecao = ALVO_JUL * 0.85;
  assert.equal(semaforoFromPercentLocal(projecao / ALVO_JUL), "amarelo");
  // ...e VERMELHO na de tres, porque nao alcancou o piso.
  assert.equal(semaforoPisoAlvo({ projecao, piso: PISO_JUL, alvo: ALVO_JUL }), "vermelho");
});

// copia local da escala canonica SO para o teste 21 comparar as duas leituras.
function semaforoFromPercentLocal(p: number): string {
  if (p >= 1) return "verde";
  if (p >= 0.8) return "amarelo";
  return "vermelho";
}

test("22) ALVO AUSENTE — tres faixas viram DUAS, e nao ha verde", () => {
  // Verde e "bateu a meta"; sem meta cadastrada nao ha o que bater. Passar do
  // piso vale amarelo (minimo feito, alvo faltando no CADASTRO).
  assert.equal(semaforoPisoAlvo({ projecao: 6_000_000, piso: PISO_JUL, alvo: 0 }), "amarelo");
  assert.equal(semaforoPisoAlvo({ projecao: 1_000_000, piso: PISO_JUL, alvo: 0 }), "vermelho");
  assert.equal(
    semaforoPisoAlvo({ projecao: 99_000_000, piso: PISO_JUL, alvo: 0 }),
    "amarelo",
    "sem alvo nao existe verde",
  );
});

test("23) SEM piso e SEM alvo — sem_meta", () => {
  assert.equal(semaforoPisoAlvo({ projecao: 1_000_000, piso: 0, alvo: 0 }), "sem_meta");
});

test("24) SEM piso mas COM alvo — cai na escala canonica de uma meta", () => {
  assert.equal(semaforoPisoAlvo({ projecao: ALVO_JUL * 0.85, piso: 0, alvo: ALVO_JUL }), "amarelo");
  assert.equal(semaforoPisoAlvo({ projecao: ALVO_JUL * 0.5, piso: 0, alvo: ALVO_JUL }), "vermelho");
});

// ------------------------------------------------------------- FAROL
function farolDe(meta: number, acumulado: number, j: JanelaRitmo, mesAnterior = 0, mesFechado = false) {
  const r = calcularRitmoNecessario({
    meta,
    acumulado,
    janela: j,
    projecao: proj(j, acumulado),
    mesFechado,
  });
  const realizado = j.diasParaRitmo > 0 ? acumulado / j.diasParaRitmo : null;
  return {
    ritmo: r,
    farol: montarFarolPromotor({
      ritmo: r,
      ritmoRealizado: realizado,
      producaoMesAnterior: mesAnterior,
      acumulado,
      diasRestantes: r.diasRestantes,
    }),
  };
}

test("25) FAROL — ritmo realizado entra como referencia em mes aberto", () => {
  const j = janela({ total: 21, diasParaRitmo: 10 });
  const { farol } = farolDe(1_000_000, 300_000, j);
  assert.equal(farol.ritmoRealizado, 30_000); // 300.000 / 10
  assert.equal(farol.alvo, "meta");
});

test("26) FAROL — diferenca entre necessario e realizado", () => {
  const j = janela({ total: 21, diasParaRitmo: 10 });
  const { ritmo, farol } = farolDe(1_000_000, 300_000, j);
  // necessario = 700.000 / 11 = 63.636,36 ; realizado = 30.000
  assert.equal(farol.diferencaRitmo, round2Local(ritmo.ritmoDiario! - 30_000));
  assert.ok(farol.diferencaRitmo! > 0, "precisa acelerar");
});

function round2Local(n: number) {
  return Math.round(n * 100) / 100;
}

test("27) FAROL — META_BATIDA traz o quanto ULTRAPASSOU em fracao", () => {
  const j = janela({ total: 21, diasParaRitmo: 10 });
  const { farol } = farolDe(1_000_000, 1_120_000, j);
  assert.equal(farol.ultrapassouPct, 0.12); // 120.000 / 1.000.000
  assert.equal(farol.alvo, "meta");
  assert.equal(farol.inalcancavel, false);
});

test("28) FAROL INALCANCAVEL — acima de 3x troca o alvo para o mes anterior", () => {
  // realizado = 100.000/10 = 10.000/dia. Meta 2.000.000 -> falta 1.900.000 em
  // 11 dias = 172.727/dia = 17x o realizado. Inalcancavel.
  const j = janela({ total: 21, diasParaRitmo: 10 });
  const { ritmo, farol } = farolDe(2_000_000, 100_000, j, 400_000);
  assert.ok(ritmo.ritmoDiario! > 3 * 10_000, "cenario e mesmo inalcancavel");
  assert.equal(farol.inalcancavel, true);
  assert.equal(farol.alvo, "mes-anterior");
  assert.equal(farol.mesAnterior!.producao, 400_000);
  assert.equal(farol.mesAnterior!.falta, 300_000);
  assert.equal(farol.mesAnterior!.ritmoDiario, round2Local(300_000 / 11));
});

test("29) FAROL — no limite de 3x AINDA nao troca de alvo", () => {
  // Necessario exatamente 3x o realizado: a troca so acontece ACIMA de 3x.
  // realizado 10.000/dia (100.000 em 10 dias), 11 dias restantes.
  // necessario = 30.000 -> meta = 100.000 + 30.000*11 = 430.000
  const j = janela({ total: 21, diasParaRitmo: 10 });
  const { ritmo, farol } = farolDe(430_000, 100_000, j, 999_999);
  assert.equal(ritmo.ritmoDiario, 30_000);
  assert.equal(farol.inalcancavel, false, "3x exato nao e inalcancavel");
  assert.equal(farol.alvo, "meta");
});

test("30) FAROL INALCANCAVEL sem mes anterior — cai no vermelho normal", () => {
  const j = janela({ total: 21, diasParaRitmo: 10 });
  const { farol } = farolDe(2_000_000, 100_000, j, 0);
  assert.equal(farol.inalcancavel, true);
  assert.equal(farol.alvo, "meta", "sem alvo alternativo, mantem a meta");
  assert.equal(farol.mesAnterior, null);
});

test("31) FAROL INALCANCAVEL com mes anterior JA superado — mantem a meta", () => {
  // Nao adianta apontar um alvo que ele ja passou.
  const j = janela({ total: 21, diasParaRitmo: 10 });
  const { farol } = farolDe(2_000_000, 100_000, j, 90_000);
  assert.equal(farol.inalcancavel, true);
  assert.equal(farol.alvo, "meta");
  assert.equal(farol.mesAnterior, null);
});

test("32) FAROL — SEM_META nao aponta alvo nenhum", () => {
  const j = janela({ total: 21, diasParaRitmo: 10 });
  const { farol } = farolDe(0, 300_000, j);
  assert.equal(farol.alvo, "nenhum");
});

test("33) FAROL — sem dia vencido (diasParaRitmo=0) nao ha realizado nem troca", () => {
  const j = janela({ total: 21, diasParaRitmo: 0, diasDecorridos: 0 });
  const { farol } = farolDe(5_250_000, 0, j, 400_000);
  assert.equal(farol.ritmoRealizado, null);
  assert.equal(farol.inalcancavel, false, "sem realizado nao da para dizer que e inalcancavel");
  assert.equal(farol.alvo, "meta");
});

test("34) o multiplo escolhido esta documentado e vale 3", () => {
  assert.equal(FAROL_MULTIPLO_INALCANCAVEL, 3);
});

// -------------------------------------------------------- META PROPRIA
test("15) META PROPRIA — constante NOMEADA x dias uteis TOTAIS da janela", () => {
  assert.equal(META_DIARIA_GRUPO, 250_000);
  assert.equal(metaPropriaDoGrupo(janela({ total: 21 })), 5_250_000); // agosto
  assert.equal(metaPropriaDoGrupo(janela({ total: 23 })), 5_750_000); // julho
});
