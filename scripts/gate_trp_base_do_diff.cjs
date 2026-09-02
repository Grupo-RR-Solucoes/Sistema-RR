/*
 * GATE — A BASE DO DIFF DA TELA (item 1 da frente de dividas).
 * 02/09/2026. READ-ONLY e SELF-CONTAINED: stub de Supabase, sem banco e sem env.
 *
 * O DEFEITO QUE ELE VIGIA. As duas rotas que montam a revisao do PDF
 * (app/api/trp/parse e app/api/trp/staging/[id]) buscavam a base do diff com
 * `.lt("competencia", alvo)` — a competencia ESTRITAMENTE ANTERIOR. Enquanto uma
 * competencia tinha UMA regua e o upload SUBSTITUIA, "a anterior" era a unica
 * base possivel. Com vigencia partida isso deixa de valer no instante em que a
 * competencia JA TEM regua — que aconteceu pela primeira vez em 01/09/2026.
 *
 * A FIXTURE NAO REPETE O AZAR DE HOJE, e isto e o ponto mais importante deste
 * arquivo. Em producao, a 2026-07 v2 e a 2026-08 v1 sao A MESMA REGUA (a TRP38 —
 * medido: 11 produtos, 0 diferencas). Foi por isso que o defeito passou
 * despercebido: as duas bases davam o MESMO amarelo, e o erro era so de rotulo.
 * Se a fixture daqui usasse reguas iguais, a mutacao do `.lt` nao derrubaria
 * nada e o portao passaria por VACUIDADE. Por isso cada competencia da fixture
 * tem regra_json DIFERENTE, e o bloco 0 prova que sao diferentes ANTES de
 * qualquer assercao depender disso.
 *
 * BLOCOS
 *   0) as reguas da fixture sao MESMO diferentes (anti-vacuidade).
 *   1) competencia JA COM regua -> base = a fatia ATIVA DELA (a de maior
 *      valid_from), origem "propria".
 *   2) competencia SEM regua -> FALLBACK para a anterior, origem "anterior".
 *   3) MUTACAO A — voltar ao `.lt`: a base vira a competencia anterior. Os dois
 *      vereditos TEM de divergir.
 *   4) MUTACAO B — remover o fallback: o PRIMEIRO upload do mes perde o diff.
 *   5) o ROTULO da tela diz a FATIA, nao so a competencia.
 */
require("./_ts_register.cjs");

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { resolverBaseDoDiff } = require("../lib/trp/baseDoDiff.ts");

let falhas = 0;
function ok(cond, nome, det) {
  if (!cond) falhas += 1;
  console.log(`  ${cond ? "OK " : "XX "} ${nome}${det ? ` — ${det}` : ""}`);
}
const eq = (nome, got, want) => ok(got === want, nome, `got=${got} want=${want}`);
const linha = (c) => c.repeat(72);

// --- FIXTURE: tres competencias, TRES reguas DIFERENTES (ver o cabecalho) ----
const R_JUL = { _meta: { trp: "TRP38" }, CONSIG_PUBLICO: { celulas: [{ "Faixa 1": 0.05 }] } };
const R_AGO_V1 = { _meta: { trp: "TRP38-agosto" }, CONSIG_PUBLICO: { celulas: [{ "Faixa 1": 0.04 }] } };
const R_AGO_V2 = { _meta: { trp: "TRP39" }, CONSIG_PUBLICO: { celulas: [{ "Faixa 1": 0.03 }] } };

const LINHAS = [
  { competencia: "2026-07-01", version_no: 2, valid_from: "2026-06-30", valid_until: "2026-07-30", regra_json: R_JUL, is_active: true },
  { competencia: "2026-08-01", version_no: 1, valid_from: "2026-07-31", valid_until: "2026-08-04", regra_json: R_AGO_V1, is_active: true },
  { competencia: "2026-08-01", version_no: 2, valid_from: "2026-08-05", valid_until: "2026-08-28", regra_json: R_AGO_V2, is_active: true },
];

/**
 * Stub encadeavel. HONRA eq/lt/order/limit na ordem pedida — um stub que ordena
 * sozinho mediria a si mesmo, e foi assim que a 1a versao do gate do override
 * passou verde sobre um defeito real.
 */
function stub(linhas) {
  return {
    from() {
      const st = { filtros: [], lt: null, orders: [], limit: null };
      const q = {
        select: () => q,
        eq: (col, val) => { st.filtros.push([col, val]); return q; },
        lt: (col, val) => { st.lt = [col, val]; return q; },
        order: (col, opts) => { st.orders.push([col, opts && opts.ascending === true ? 1 : -1]); return q; },
        limit: (n) => { st.limit = n; return q; },
        then: (resolve) => {
          let rows = linhas.slice();
          for (const [col, val] of st.filtros) rows = rows.filter((r) => r[col] === val);
          if (st.lt) rows = rows.filter((r) => String(r[st.lt[0]]) < String(st.lt[1]));
          for (const [col, dir] of [...st.orders].reverse()) {
            rows.sort((a, b) => dir * String(a[col]).localeCompare(String(b[col])));
          }
          if (st.limit) rows = rows.slice(0, st.limit);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
}

/** O criterio ANTIGO, reimplementado aqui para a MUTACAO A. */
async function baseAntiga(sb, firstDay) {
  const r = await sb
    .from("trp_rule_versions")
    .select("competencia, version_no, valid_from, valid_until, regra_json")
    .lt("competencia", firstDay)
    .eq("is_active", true)
    .order("competencia", { ascending: false })
    .order("valid_from", { ascending: false })
    .limit(1);
  return (r.data && r.data[0]) || null;
}

console.log("===== GATE — a base do diff da tela =====\n");

(async () => {
  const sb = stub(LINHAS);

  // ============================================================== BLOCO 0
  console.log("0) ANTI-VACUIDADE — as reguas da fixture sao MESMO diferentes");
  console.log(linha("-"));
  {
    const j = JSON.stringify;
    ok(j(R_JUL) !== j(R_AGO_V1), "julho x agosto v1 sao reguas DIFERENTES");
    ok(j(R_AGO_V1) !== j(R_AGO_V2), "agosto v1 x agosto v2 sao reguas DIFERENTES");
    console.log(
      "     (em PRODUCAO, 2026-07 v2 e 2026-08 v1 sao a MESMA regua — foi por isso\n" +
      "      que o defeito passou despercebido. Repetir esse azar aqui faria a\n" +
      "      mutacao do bloco 3 nao derrubar nada.)"
    );
  }

  // ============================================================== BLOCO 1
  console.log("\n1) competencia JA COM regua -> base = a fatia ATIVA DELA");
  console.log(linha("-"));
  {
    const base = await resolverBaseDoDiff(sb, "2026-08");
    eq("competencia da base", base && base.competencia, "2026-08");
    eq("version_no da base (a de MAIOR valid_from)", base && base.version_no, 2);
    eq("valid_from da fatia", base && base.valid_from, "2026-08-05");
    eq("valid_until da fatia", base && base.valid_until, "2026-08-28");
    eq("origem", base && base.origem, "propria");
    ok(JSON.stringify(base && base.regra_json) === JSON.stringify(R_AGO_V2),
      "e traz a regra_json DAQUELA fatia (a TRP39), nao a de julho");
  }

  // ============================================================== BLOCO 2
  console.log("\n2) competencia SEM regua -> FALLBACK para a anterior");
  console.log(linha("-"));
  {
    const soJulho = stub(LINHAS.filter((l) => l.competencia === "2026-07-01"));
    const base = await resolverBaseDoDiff(soJulho, "2026-08");
    eq("cai na competencia anterior", base && base.competencia, "2026-07");
    eq("origem", base && base.origem, "anterior");
    const vazio = await resolverBaseDoDiff(stub([]), "2026-08");
    ok(vazio === null, "sem NENHUMA regua no banco, devolve null (a tela diz 'nada a comparar')");
  }

  // ============================================================== BLOCO 3
  console.log("\n3) MUTACAO A — voltar ao `.lt` (competencia ANTERIOR)");
  console.log(linha("-"));
  {
    const nova = await resolverBaseDoDiff(sb, "2026-08");
    const antiga = await baseAntiga(sb, "2026-08-01");
    eq("o criterio ANTIGO escolhe julho", antiga && String(antiga.competencia).slice(0, 7), "2026-07");
    eq("o criterio NOVO escolhe agosto", nova && nova.competencia, "2026-08");
    ok(
      String(antiga.competencia).slice(0, 7) !== nova.competencia,
      "os dois criterios escolhem bases DIFERENTES — o bloco 1 nao passa por sorte",
      `antigo=${String(antiga.competencia).slice(0, 7)} novo=${nova.competencia}`
    );
    ok(
      JSON.stringify(antiga.regra_json) !== JSON.stringify(nova.regra_json),
      "e as reguas escolhidas sao DIFERENTES — o amarelo da tela mudaria de verdade",
      `${antiga.regra_json._meta.trp} x ${nova.regra_json._meta.trp}`
    );
  }

  // ============================================================== BLOCO 4
  console.log("\n4) MUTACAO B — remover o fallback");
  console.log(linha("-"));
  {
    const soJulho = stub(LINHAS.filter((l) => l.competencia === "2026-07-01"));
    // o mutante: so a propria competencia, sem cascata
    const mutante = async (client, comp) => {
      const r = await client
        .from("trp_rule_versions")
        .select("competencia, version_no, valid_from, valid_until, regra_json")
        .eq("competencia", `${comp}-01`)
        .eq("is_active", true)
        .order("valid_from", { ascending: false })
        .limit(1);
      return (r.data && r.data[0]) || null;
    };
    const real = await resolverBaseDoDiff(soJulho, "2026-08");
    const mut = await mutante(soJulho, "2026-08");
    ok(real !== null, "real:    o PRIMEIRO upload do mes AINDA tem base para comparar");
    ok(mut === null, "mutante: sem fallback, o primeiro upload do mes perde o diff");
    ok((real === null) !== (mut === null),
      "os dois vereditos divergem — o fallback esta sendo medido, nao suposto");
  }

  // ============================================================== BLOCO 5
  console.log("\n5) O ROTULO da tela diz a FATIA, nao so a competencia");
  console.log(linha("-"));
  {
    const ui = fs.readFileSync(path.join(ROOT, "components/trp/TrpUploadReview.tsx"), "utf8");
    ok(ui.includes("v{result.diff.anterior.version_no}"), "o rotulo mostra a VERSAO da fatia");
    ok(ui.includes("result.diff.anterior.valid_from") && ui.includes("result.diff.anterior.valid_until"),
      "e a VIGENCIA da fatia (o 'de X a Y')");
    ok(ui.includes('result.diff.anterior.origem === "anterior"'),
      "e distingue base PROPRIA de base HERDADA do mes anterior");
    for (const rel of ["app/api/trp/parse/route.ts", "app/api/trp/staging/[id]/route.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      ok(src.includes("resolverBaseDoDiff("), `${rel} usa a regua unica`);
      ok(!src.includes('.lt("competencia"'), `${rel} NAO reimplementa o .lt inline`);
    }
  }

  console.log("\n" + (falhas === 0 ? "GATE OK (0 falhas)" : `GATE FALHOU (${falhas} falha(s))`));
  process.exitCode = falhas === 0 ? 0 : 1;
})().catch((e) => {
  console.error("GATE FALHOU (excecao):", e && e.message ? e.message : e);
  process.exitCode = 1;
});
