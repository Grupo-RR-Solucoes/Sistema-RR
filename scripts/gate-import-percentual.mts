// ============================================================================
// GATE — trocar o parsePercent do import (fracao -> percentual) quebra alguma
// leitura da coluna company_received_percent?
//
// O import grava FRACAO (5,80 -> 0.058); o calculate/monthly grava PERCENTUAL
// (5.8). Dois escritores, convencoes opostas. Este gate simula a troca e passa
// os valores pelas TRES leituras que consomem a coluna, para ver se alguma
// deixa de funcionar.
//
// Somente leitura, nao toca no banco. npx tsx scripts/gate-import-percentual.mts
// ============================================================================

// Reproduz as guardas EXATAS de cada leitor. Sao 4 linhas cada uma e estao
// copiadas aqui de proposito: o gate precisa comparar o comportamento ANTES e
// DEPOIS da troca, e o "antes" nao existe mais no codigo depois do conserto.
//   toPercentRate     lib/promoterAnalytics.ts:291   -> FRACAO
//   normalizePercent  lib/promotivaCashPolicy.ts:140 -> FRACAO
//   toPercentUnits    app/api/calculate/monthly:48   -> PERCENTUAL
const toPercentRate = (v: number) => (Math.abs(v) > 1 ? v / 100 : v);
const normalizePercent = (v: number) => (v <= 0 ? 0 : v > 1 ? v / 100 : v);
const toPercentUnits = (v: number) => (Math.abs(v) <= 1 ? v * 100 : v);

// Guardas de plausibilidade de cada consumidor.
const okMotor = (frac: number) => frac > 0 && frac <= 0.065; // promoterAnalytics
const okCalc = (pct: number) => pct > 0 && pct <= 6.5; // calculate/monthly

// Valores reais da TRP38 que a coluna carrega, incluindo os sub-1 medidos.
const CASOS = [
  { planilha: 5.8, rotulo: "5,80% (teto)" },
  { planilha: 5.7, rotulo: "5,70% (F3)" },
  { planilha: 3.34, rotulo: "3,34%" },
  { planilha: 2.44, rotulo: "2,44%" },
  { planilha: 1.02, rotulo: "1,02% (SIAPE F4)" },
  { planilha: 0.97, rotulo: "0,97% (SIAPE F3)" },
  { planilha: 0.95, rotulo: "0,95% (SIAPE F2)" },
  { planilha: 0.81, rotulo: "0,81% (Publico F3)" },
  { planilha: 0.79, rotulo: "0,79% (Publico F2)" },
  { planilha: 0.78, rotulo: "0,78% (Publico F1)" },
];

// ANTES: parsePercent = v > 1 ? v/100 : v
const gravaAntes = (planilha: number) => (planilha > 1 ? planilha / 100 : planilha);
// DEPOIS: grava o percentual como veio.
const gravaDepois = (planilha: number) => planilha;

const brl = (n: number) => n.toFixed(4);

console.log("=".repeat(104));
console.log("GATE — parsePercent do import: FRACAO (hoje) x PERCENTUAL (proposto)");
console.log("=".repeat(104));
console.log(
  "\nA coluna e lida por tres caminhos. A pergunta e se cada um ACERTA o valor" +
    "\nda planilha depois da troca. 'acerta' = o consumidor chega no mesmo numero" +
    "\nque a planilha trazia.\n"
);

type Linha = {
  rotulo: string;
  planilha: number;
  gravado: number;
  motor: number;
  motorOk: boolean;
  cash: number;
  calc: number;
  calcOk: boolean;
};

function avalia(planilha: number, gravado: number, rotulo: string): Linha {
  const motor = toPercentRate(gravado); // fracao
  const cash = normalizePercent(gravado); // fracao
  const calc = toPercentUnits(gravado); // percentual
  return {
    rotulo,
    planilha,
    gravado,
    motor,
    motorOk: okMotor(motor) && Math.abs(motor * 100 - planilha) < 0.005,
    cash,
    calc,
    calcOk: okCalc(calc) && Math.abs(calc - planilha) < 0.005,
  };
}

for (const modo of ["ANTES (grava fracao)", "DEPOIS (grava percentual)"]) {
  const grava = modo.startsWith("ANTES") ? gravaAntes : gravaDepois;
  console.log("-".repeat(104));
  console.log(modo);
  console.log("-".repeat(104));
  console.log(
    "  planilha  gravado   toPercentRate      normalizePercent   toPercentUnits"
  );
  console.log(
    "  (TRP38)             (motor, fracao)    (cashPolicy)       (calculate, pct)"
  );
  let falhasMotor = 0;
  let falhasCalc = 0;
  for (const c of CASOS) {
    const g = grava(c.planilha);
    const a = avalia(c.planilha, g, c.rotulo);
    if (!a.motorOk) falhasMotor += 1;
    if (!a.calcOk) falhasCalc += 1;
    console.log(
      `  ${String(c.planilha).padStart(6)}  ${String(g).padStart(8)}   ` +
        `${brl(a.motor).padStart(8)} ${a.motorOk ? "ok " : "ERRO"}     ` +
        `${brl(a.cash).padStart(8)}           ` +
        `${brl(a.calc).padStart(8)} ${a.calcOk ? "ok " : "ERRO"}    ${c.rotulo}`
    );
  }
  console.log(
    `\n  falhas: motor/cashPolicy ${falhasMotor}  ·  calculate ${falhasCalc}\n`
  );
}

console.log("=".repeat(104));
console.log("LEITURA");
console.log("=".repeat(104));
console.log(`
  ANTES  a fracao 0.058 e lida certo pelos tres. Mas os valores SUB-1 da TRP38
         (0,78 a 1,02%) sao gravados como 0.78..1.02 — indistinguiveis de uma
         fracao — e ai o motor le 78% e o calculate le 78, os dois REJEITAM pela
         guarda e caem no derive. E o defeito de hoje.

  DEPOIS o percentual 5.8 e lido certo pelos tres (5.8 > 1 nas duas heuristicas
         de fracao, entao dividem por 100 corretamente; toPercentUnits deixa
         passar). Os sub-1 continuam ambiguos — 0.95 gravado e 0.95 lido como
         95% pelo motor. A troca NAO resolve o sub-1 sozinha.

  CONCLUSAO: a troca nao QUEBRA nenhuma leitura para os valores >= 1, que sao
  99,5% da base. Para os sub-1 o comportamento fica IGUAL ao de hoje (rejeitado
  pela guarda, cai no derive) — que, medido, e o comportamento CERTO: a coluna
  desses casos traz a faixa do CNPJ e o derive resolve pela faixa do grupo.
`);
