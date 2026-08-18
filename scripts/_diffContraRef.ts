// ============================================================================
// _diffContraRef.ts — A COMPARACAO DE BRANCH FALHA QUANDO NAO PODE SER FEITA.
//
// Casa de UMA regra so, consumida pelos gates que provam "este arquivo NAO foi
// tocado nesta branch". Existe porque a regra estava duplicada e as duas copias
// erravam igual:
//
//   gate_teto_avista_rr.ts (G5)      — lib/motor.ts, lib/promotivaCashPolicy.ts
//   bbts_seguro_regua_gate.cjs (G6)  — lib/insuranceCalculator.ts,
//                                      lib/insurancePenetration.ts
//
// Ate 18/08/2026 as DUAS engoliam o erro do git num catch que so imprimia
// "(git indisponivel)" e seguiam, sem reprovar. No CI isso era silencioso e
// permanente: actions/checkout@v4 usa fetch-depth: 1 por padrao, `origin/main`
// nao vira ref no runner, o git lanca, a string de erro nao contem nome de
// arquivo nenhum, a lista de "tocados" sai VAZIA e o gate anuncia que esta
// tudo intocado tendo verificado ZERO. Verde que nao mediu nada — a mesma
// familia da vw_team_production que devolve 0 linhas para service_role e do
// gate de PDF que se declara pulado sem PDF.
//
// AUSENCIA DE MEDICAO NAO E APROVACAO. Quando a ref nao resolve, isto devolve
// comparou:false com uma mensagem que diz que a comparacao NAO aconteceu —
// nunca que os arquivos estao intactos — e cabe ao chamador REPROVAR com ela.
// O conserto do outro lado (fetch-depth: 0) esta em .github/workflows/gates.yml.
//
// POR QUE `expr` E PARAMETRO E NAO CONSTANTE. Os dois gates comparam coisas
// diferentes de proposito, e unificar aqui mudaria o que cada um afirma:
//   G5 usa "origin/main...HEAD" — so o COMMITADO da branch, desde a bifurcacao.
//   G6 usa "origin/main"        — a arvore de trabalho contra a main, entao
//                                 tambem pega alteracao ainda nao commitada.
// O que se compartilha e a regra "sem medicao, reprova", nao o recorte.
// ============================================================================

import { execFileSync } from "node:child_process";

export type ResultadoDiff =
  | { comparou: true; arquivos: string[] }
  | { comparou: false; mensagem: string };

export function diffContraRef(opts: {
  cwd: string;
  /** Expressao de diff do git, p.ex. "origin/main...HEAD" ou "origin/main". */
  expr: string;
  /** Os arquivos que o gate quer provar intocados — so entram na mensagem. */
  arquivos: string[];
}): ResultadoDiff {
  try {
    const saida = execFileSync("git", ["diff", "--name-only", opts.expr], {
      cwd: opts.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { comparou: true, arquivos: saida.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) };
  } catch (e) {
    const err = e as { message?: string; stderr?: string };
    const primeiraLinha = String(err.stderr || err.message || e).trim().split(/\r?\n/)[0];
    return {
      comparou: false,
      mensagem:
        "COMPARACAO DE BRANCH NAO REALIZADA — '" + opts.expr + "' nao resolve neste " +
        "checkout. NAO foi verificado se " + opts.arquivos.join(" e ") + " mudaram; " +
        "este bloco nao mediu nada e por isso REPROVA. Isto NAO significa que os " +
        "arquivos estao intactos. Causa tipica: checkout raso (actions/checkout com " +
        "fetch-depth: 1) — use fetch-depth: 0. git: " + primeiraLinha,
    };
  }
}
