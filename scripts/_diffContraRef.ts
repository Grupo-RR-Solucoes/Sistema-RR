// ============================================================================
// _diffContraRef.ts — A COMPARACAO DE BRANCH FALHA QUANDO NAO PODE SER FEITA.
//
// Casa de UMA regra so, consumida pelos gates que provam "este arquivo NAO foi
// tocado nesta branch". Existe porque a regra estava duplicada e as duas copias
// erravam igual:
//
//   bbts_seguro_regua_gate.cjs (G6)  — lib/insuranceCalculator.ts,
//                                      lib/insurancePenetration.ts
//
// CONSUMIDOR QUE SAIU (31/08/2026): gate_teto_avista_rr.ts (G5) usava isto para
// lib/motor.ts e lib/promotivaCashPolicy.ts e NAO usa mais. Nao foi afrouxamento
// de proposito nem abandono: a pergunta "foi tocado nesta branch?" so tem
// resposta DENTRO de uma branch — em main o diff origin/main...HEAD sai VAZIO e
// nao mede nada (MEDIDO). A G5 trocou por um LEDGER de conteudo aprovado
// (scripts/_ledgerProtegido.ts), que compara impressao x arquivo e vale SEMPRE,
// inclusive em main, e enxerga a arvore de trabalho em vez do commitado. A
// REGRA DE OURO abaixo foi levada junto, literal, para la.
//
// O G6 continua aqui de proposito: ele usa a forma de DOIS pontos e ja enxerga a
// arvore, entao nao tem o buraco que derrubou a G5. Se um dia ele tambem precisar
// valer em main, o caminho e o mesmo ledger — nao um terceiro mecanismo.
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
// POR QUE `expr` E PARAMETRO E NAO CONSTANTE. Os gates comparam coisas diferentes
// de proposito, e unificar aqui mudaria o que cada um afirma:
//   "origin/main...HEAD" — so o COMMITADO da branch, desde a bifurcacao.
//   "origin/main"        — a arvore de trabalho contra a main, entao tambem pega
//                          alteracao ainda nao commitada (e o que o G6 usa).
// O que se compartilha e a regra "sem medicao, reprova", nao o recorte.
//
// ARMADILHA MEDIDA (31/08/2026, PR #203): rodar os gates ANTES de commitar da
// VERDE numa assercao que usa TRES pontos — ela nao ve a arvore de trabalho. Foi
// assim que um lib/motor.ts alterado passou por 33/33 local e reprovou no CI.
// Ritual: commit primeiro, gates depois.
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
