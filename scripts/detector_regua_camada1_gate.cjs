/*
 * GATE do detector de regua obsoleta — CAMADA 1 (TRP). READ-ONLY, nao grava.
 *
 * (1) Maquina de estados: exercita a funcao REAL classify (lib/trp/
 *     detectorReguaObsoleta.ts) na tabela-verdade dos 5 estados. Prova que
 *     versao diferente -> STALE, igual -> OK, NULL em bbts/daily -> DESCONHECIDO,
 *     fechamento/cms -> NAO_APLICAVEL (nunca colapsa DESCONHECIDO em OK), e
 *     trp_multi_versao === true -> MULTI_VERSAO (01/09/2026).
 * (2) No-op estrutural: confirma que o carimbo do PMR sai da REGUA UNICA
 *     (lib/trp/carimboPmr.ts) nos dois escritores e que nenhuma coluna de valor
 *     foi alterada.
 *
 * CONTROLE POSITIVO desta frente: as 10 asserces do bloco (1) que ja existiam
 * seguem chamando classify com TRES argumentos, sem o 4o. Elas passarem
 * inalteradas E a prova de que competencia de regua unica se comporta EXATAMENTE
 * como antes de 01/09/2026 — o parametro novo e opcional e ausente == antes.
 */
require("./_ts_register.cjs");

const { classify } = require("../lib/trp/detectorReguaObsoleta.ts");

let falhas = 0;
function eq(nome, got, want) {
  const ok = got === want;
  if (!ok) falhas += 1;
  console.log(`  ${ok ? "OK " : "XX "} ${nome}: got=${got} want=${want}`);
}

const V1 = "11111111-1111-1111-1111-111111111111";
const V2 = "22222222-2222-2222-2222-222222222222";

console.log("=== (1) maquina de estados (funcao REAL classify) ===");
// bbts/daily = usam TRP
eq("bbts  versao IGUAL a vigente",        classify("bbts",  V1, V1), "OK");
eq("daily versao IGUAL a vigente",        classify("daily", V2, V2), "OK");
eq("bbts  versao DIFERENTE (regua mudou)",classify("bbts",  V1, V2), "STALE");
eq("daily versao DIFERENTE (regua mudou)",classify("daily", V1, V2), "STALE");
eq("bbts  versao NULL (historico)",       classify("bbts",  null, V1), "DESCONHECIDO");
eq("daily versao NULL (historico)",       classify("daily", null, null), "DESCONHECIDO");
// fechamento/cms = NAO usam TRP: NULL aqui e legitimo, nunca DESCONHECIDO/STALE
eq("fechamento (nao usa TRP)",            classify("fechamento", null, V1), "NAO_APLICAVEL");
eq("cms (nao usa TRP)",                   classify("cms",        null, V1), "NAO_APLICAVEL");
// prova anti-regressao: DESCONHECIDO nunca vira OK mesmo com vigente NULL
eq("bbts NULL x vigente NULL != OK",      classify("bbts",  null, null), "DESCONHECIDO");

// 5o estado (01/09/2026) — competencia PARTIDA. So com === true.
eq("bbts  multi_versao TRUE",             classify("bbts",  null, V1, true),  "MULTI_VERSAO");
eq("daily multi_versao TRUE",             classify("daily", null, V1, true),  "MULTI_VERSAO");
eq("multi_versao FALSE nao muda nada",    classify("bbts",  V1,   V1, false), "OK");
eq("multi_versao NULL nao muda nada",     classify("bbts",  null, V1, null),  "DESCONHECIDO");
eq("multi_versao ausente nao muda nada",  classify("bbts",  V1,   V2),        "STALE");
// fechamento/cms tem precedencia: nem partida os torna aplicaveis.
eq("fechamento com multi_versao TRUE",    classify("fechamento", null, V1, true), "NAO_APLICAVEL");

console.log("\n=== (2) no-op estrutural: colunas novas sao SO aditivas ===");
const fs = require("fs");
const path = require("path");

(async () => {
  // Prova offline: as colunas de VALOR do upsert nao foram tocadas — so 2 campos
  // novos foram ADICIONADOS. Verifica no fonte dos consolidadores.
  // Desde 01/09/2026 o carimbo NAO se decide aqui: os dois escritores consomem a
  // REGUA UNICA lib/trp/carimboPmr.ts. Esta assercao aponta para ela de proposito
  // — se alguem reimplementar o carimbo inline outra vez, o portao cai.
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "bbtsMonthly.ts"), "utf8");
  const temNovas = src.includes("const carimboTrp = carimboTrpDoPmr(trpStamp);") &&
    src.includes("trp_version_id: carimboTrp.trp_version_id,") &&
    src.includes("trp_fallback: carimboTrp.trp_fallback,") &&
    src.includes("trp_multi_versao: carimboTrp.trp_multi_versao,");
  const semReimplementacao = !src.includes("trpStamp?.versionId");
  const valorIntacto = src.includes("final_commission_value: final,") &&
    src.includes("production_commission_value: comPromotorCredito,");
  eq("bbtsMonthly grava as 3 colunas pela regua unica", temNovas, true);
  eq("bbtsMonthly NAO reimplementa o carimbo inline", semReimplementacao, true);
  eq("bbtsMonthly manteve os campos de valor", valorIntacto, true);

  // O SMOKE LIVE FOI REMOVIDO em 29/08/2026, e o gate virou self-contained.
  //
  // O QUE ELE ERA: um SELECT em promoter_monthly_results(trp_version_id,
  // trp_fallback) que so IMPRIMIA se as colunas ja existiam. Nao havia ok()
  // nenhum atras dele — NENHUMA assercao dependia do banco. Consequencia medida
  // em 29/08/2026, rodando os 30 needs-db com credencial FALSA: este gate PASSOU
  // sem banco (exit 0), porque nunca precisou de um. Nao era vacuidade — era
  // CLASSIFICACAO ERRADA, e ela custava caro: pagava o preco da faixa needs-db,
  // que ninguem roda (358s de teto 90s), sem nada em troca.
  //
  // E A PERGUNTA DELE JA TEM DONO. "a coluna que o codigo pede existe no banco?"
  // e o que scripts/gate_schema_colunas.mts responde — para as 2.844 colunas
  // pedidas em todo o codigo, 189 delas em promoter_monthly_results, e ele passa
  // hoje (exit 0). Duas respostas para a mesma pergunta e uma a mais.
  //
  // Com o smoke saiu tambem o readEnv() proprio, que violava o criterio (b) de
  // self-contained. As assercoes deste arquivo sempre foram ESTATICAS — sobre o
  // fonte de lib/bbtsMonthly e o classify() puro — e agora rodam no CI.

  console.log("\n" + (falhas === 0 ? "GATE OK (0 falhas)" : `GATE FALHOU (${falhas} falha(s))`));
  // process.exitCode, NAO process.exit(). Medido em 01/08/2026, 3/3 execucoes:
  // process.exit() derruba o event loop enquanto um handle async do cliente
  // Supabase ainda esta fechando, e o libuv aborta com
  //   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\winsync.c:76
  // O abort SOBRESCREVE o codigo de saida: o gate imprimia "GATE OK (0 falhas)"
  // e saia != 0. Falso vermelho e pior que vermelho — treina todo mundo a
  // ignorar o runner. Com exitCode o Node drena os handles e sai limpo (3/3).
  process.exitCode = falhas === 0 ? 0 : 1;
})();
