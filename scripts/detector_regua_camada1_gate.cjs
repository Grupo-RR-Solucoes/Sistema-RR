/*
 * GATE do detector de regua obsoleta — CAMADA 1 (TRP). READ-ONLY, nao grava.
 *
 * (1) Maquina de estados: exercita a funcao REAL classify (lib/trp/
 *     detectorReguaObsoleta.ts) na tabela-verdade dos 4 estados. Prova que
 *     versao diferente -> STALE, igual -> OK, NULL em bbts/daily -> DESCONHECIDO,
 *     fechamento/cms -> NAO_APLICAVEL (nunca colapsa DESCONHECIDO em OK).
 * (2) No-op estrutural: confirma que as colunas novas do PMR sao trp_version_id
 *     e trp_fallback (aditivas) e que nenhuma coluna de valor foi alterada.
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

console.log("\n=== (2) no-op estrutural: colunas novas sao SO aditivas ===");
const fs = require("fs");
const path = require("path");
function readEnv() {
  const env = {};
  for (const f of [".env", ".env.local"]) {
    const p = path.join(__dirname, "..", f);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

(async () => {
  // Prova offline: as colunas de VALOR do upsert nao foram tocadas — so 2 campos
  // novos foram ADICIONADOS. Verifica no fonte dos consolidadores.
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "bbtsMonthly.ts"), "utf8");
  const temNovas = src.includes("trp_version_id: trpStamp?.versionId") &&
    src.includes("trp_fallback: trpStamp ? trpStamp.isFallback : null");
  const valorIntacto = src.includes("final_commission_value: final,") &&
    src.includes("production_commission_value: comPromotorCredito,");
  eq("bbtsMonthly grava as 2 colunas novas", temNovas, true);
  eq("bbtsMonthly manteve os campos de valor", valorIntacto, true);

  // Smoke LIVE do detector (so roda se a migration ja estiver aplicada). Sem as
  // colunas, o select falha e o gate AVISA (nao quebra) — Diego roda o SQL antes.
  const env = readEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (url && key) {
    try {
      const { createClient } = require("@supabase/supabase-js");
      const sb = createClient(url, key, { auth: { persistSession: false } });
      const { error } = await sb
        .from("promoter_monthly_results")
        .select("trp_version_id, trp_fallback")
        .limit(1);
      if (error) {
        console.log("\n  (smoke live) colunas ainda NAO existem no banco — rode a migration " +
          "20260714_000001 no Studio. Detalhe: " + error.message);
      } else {
        console.log("\n  (smoke live) colunas trp_version_id/trp_fallback JA existem no banco. " +
          "Detector pronto para /api/detector/trp.");
      }
    } catch (e) {
      console.log("\n  (smoke live) pulado: " + (e && e.message));
    }
  }

  console.log("\n" + (falhas === 0 ? "GATE OK (0 falhas)" : `GATE FALHOU (${falhas} falha(s))`));
  process.exit(falhas === 0 ? 0 : 1);
})();
