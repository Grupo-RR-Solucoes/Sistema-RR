/*
 * scripts/companyscope_grupo_gate.cjs — PORTAO de `lib/companyScope.ts`. READ-ONLY.
 *
 * POR QUE ELE EXISTE, e por que NASCE separado de onde estava.
 *
 * Estas 5 assercoes viviam dentro de `scripts/test_ads_status_e_grupo.cjs`, que e
 * ORFAO do runner (needs-local: le um xlsx de cliente em C:/Users/diego/Downloads,
 * que nao pode ser versionado — o repositorio e PUBLICO). Aquele arquivo tem DUAS
 * metades e elas nao envelhecem juntas:
 *
 *   METADE CONGELADA (morre la, em 29/08/2026): contagens do PR #84 — "10 Contratacao,
 *     4 canceladas, 4 transitorias" — cravadas sobre um arquivo que hoje tem 52 linhas
 *     (proc=35 canc=9 trans=8). Numero de arquivo que cresce nao e invariante.
 *
 *   METADE PERMANENTE (e esta, que passa a viver aqui): `resolveCompanyScope` nunca
 *     pode devolver "grupo:*" cru, porque o valor cru vai para um `.in()` de UUID e
 *     estoura 22P02 em producao. Isso vale para sempre, nao so para o PR #84.
 *
 * MEDIDO EM 29/08/2026: `lib/companyScope.ts` (30 linhas, consumido por
 * `app/api/calculate/monthly/route.ts` e `lib/promoterAnalytics.ts`) NAO TINHA
 * NENHUM portao registrado. Este arquivo passa a ser a unica prova continua dele —
 * e, ao contrario do orfao de onde saiu, ele RODA, porque nao depende do xlsx.
 *
 * CLASSIFICACAO: needs-db. Chama createClient para ler `companies` (id/name/group_name)
 * de PRODUCAO — leitura pura, nenhuma escrita. Nao usa .env proprio nem caminho
 * absoluto; o unico criterio que o tira do CI e o createClient.
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
(() => {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(__dirname, "..", f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
})();
const { createClient } = require("@supabase/supabase-js");
const { resolveCompanyScope } = require("../lib/companyScope.ts");

const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  c ? (pass++, console.log(`  OK   ${n}`)) : (fail++, console.log(`  FALHOU ${n}${x ? " — " + x : ""}`));
};

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    // needs-db que nao alcanca o banco NAO mediu o que promete. Mesma regra do
    // conserto de 29/08/2026 em estorno_sem_leitor_gate.cjs.
    console.log("FALHOU: sem NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.");
    console.log("Este portao e needs-db e promete resolver escopo contra `companies` REAL.");
    process.exitCode = 2;
    return;
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  console.log("=== resolveCompanyScope: grupo -> company_ids, nunca 'grupo:*' cru ===\n");
  const { data: comps, error } = await sb.from("companies").select("id, name, group_name");
  if (error) {
    console.log("FALHOU: o banco recusou a consulta — " + error.message);
    process.exitCode = 3;
    return;
  }
  const rrIds = (comps || []).filter((c) => c.group_name === "Grupo RR").map((c) => c.id);
  const bbtsIds = (comps || []).filter((c) => c.group_name === "BBTS").map((c) => c.id);

  // ANTI-VACUIDADE, primeiro: sem grupo no banco, tudo abaixo passaria por vazio.
  ok(`ha grupo BBTS em companies (${bbtsIds.length})`, bbtsIds.length > 0, "zero empresas BBTS");
  ok(`ha Grupo RR em companies (${rrIds.length})`, rrIds.length > 0, "zero empresas do Grupo RR");
  if (bbtsIds.length === 0 || rrIds.length === 0) {
    console.log("\nGATE FALHOU: sem grupo no banco nao ha o que resolver — recuso passar por vacuidade.");
    process.exitCode = 4;
    return;
  }

  const sAds = resolveCompanyScope("grupo:ads", comps);
  ok("grupo:ads -> company_ids do grupo BBTS (contem a ADS)",
    Array.isArray(sAds.companyIds) && sAds.companyIds.includes(ADS) && sAds.companyIds.length === bbtsIds.length,
    JSON.stringify(sAds.companyIds));

  const sRr = resolveCompanyScope("grupo:rr", comps);
  ok(`grupo:rr -> ${rrIds.length} company_ids do Grupo RR`,
    Array.isArray(sRr.companyIds) && sRr.companyIds.length === rrIds.length && sRr.companyIds.every((id) => rrIds.includes(id)),
    JSON.stringify(sRr.companyIds));

  const sUuid = resolveCompanyScope(ADS, comps);
  ok("uuid individual -> [uuid]", JSON.stringify(sUuid.companyIds) === JSON.stringify([ADS]));

  const sNull = resolveCompanyScope("", comps);
  ok("'' (todas) -> null (sem restricao)", sNull.companyIds === null);

  // A ASSERCAO QUE JUSTIFICA O PORTAO: o valor cru vai para um .in() de UUID.
  const anyRaw = [sAds, sRr, sUuid].some((s) => (s.companyIds || []).some((id) => String(id).startsWith("grupo:")));
  ok("nenhum resultado carrega 'grupo:*' cru (que causaria 22P02)", !anyRaw);

  console.log("\n" + (fail === 0 ? `GATE OK (${pass} assercoes, 0 falhas)` : `GATE FALHOU (${fail} falha(s))`));
  // process.exitCode, nao process.exit(): deixa o stdout drenar.
  if (fail > 0) process.exitCode = 1;
})();
