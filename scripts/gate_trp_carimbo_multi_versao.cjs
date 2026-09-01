/*
 * GATE — O CARIMBO DA TRP NUMA COMPETENCIA PARTIDA (Fase 3, bloco 1).
 * 01/09/2026. READ-ONLY e SELF-CONTAINED: nao le banco, nao grava, nao precisa
 * de env. Roda na faixa rapida.
 *
 * O QUE ELE DEFENDE, em uma frase: numa competencia de vigencia PARTIDA o PMR
 * grava trp_version_id = NULL + trp_multi_versao = true, porque carimbar a
 * ultima regua seria AFIRMACAO FALSA QUE CONFERE — e nada acusaria.
 *
 * BLOCOS
 *   1) A REGUA (carimboTrpDoPmr, funcao real) nas 3 saidas.
 *   2) CONTROLE POSITIVO: em competencia de regua UNICA a regua nova produz
 *      EXATAMENTE o que o codigo de 31/08 produzia — o criterio antigo esta
 *      reimplementado aqui e comparado campo a campo.
 *   3) MUTACAO A — "carimba a ultima regua mesmo partida" (o comportamento ate
 *      31/08). TEM de dar resultado DIFERENTE do bloco 1, senao o bloco 1 passa
 *      por coincidencia.
 *   4) MUTACAO B — classify lendo `!multiVersao` em vez de `=== true`. TEM de
 *      reclassificar o HISTORICO inteiro (trp_multi_versao NULL) como
 *      MULTI_VERSAO. Medido em 01/09/2026: 0 linhas nao-nulas em todo o PMR, ou
 *      seja, a mutacao apagaria o detector inteiro em silencio.
 *   5) FIM A FIM sobre fixture (stub de Supabase): a competencia partida sai do
 *      detector como MULTI_VERSAO e NAO como DESCONHECIDO — e o que impede o
 *      alerta imortal no ledgerHealth.
 *   6) OS DOIS ESCRITORES consomem a regua unica, e ninguem mais decide carimbo
 *      por conta propria (varredura do fonte de app/ e lib/).
 *
 * DIVIDA (ii), ASSERTADA DE PROPOSITO no bloco 5: competencia partida NAO entra
 * em `alteradas` nem gera oferta de reconsolidacao — nem agora nem nunca. Isto
 * esta aqui como assercao para que, se alguem "consertar" sem decidir, o portao
 * fale. Ver o cabecalho de lib/trp/detectorReguaObsoleta.ts.
 */
require("./_ts_register.cjs");

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { carimboTrpDoPmr } = require("../lib/trp/carimboPmr.ts");
const {
  classify,
  detectTrpStaleForCompetencia,
} = require("../lib/trp/detectorReguaObsoleta.ts");

let falhas = 0;
function ok(cond, nome, det) {
  if (!cond) falhas += 1;
  console.log(`  ${cond ? "OK " : "XX "} ${nome}${det ? ` — ${det}` : ""}`);
}
const eq = (nome, got, want) => ok(got === want, nome, `got=${got} want=${want}`);
const j = (o) => JSON.stringify(o);
const linha = (c) => c.repeat(72);

const V38 = "38383838-3838-3838-3838-383838383838";
const V39 = "39393939-3939-3939-3939-393939393939";

/** Stamp que o provider devolveria. */
const stamp = (over) => ({
  versionId: V39,
  versionNo: 2,
  isFallback: false,
  competenciaFornecedora: "2026-08",
  competenciaPartida: false,
  ...over,
});

console.log("===== GATE — carimbo da TRP em competencia PARTIDA =====\n");

// =============================================================== BLOCO 1
console.log("1) A REGUA (carimboTrpDoPmr) nas 3 saidas");
console.log(linha("-"));
{
  const unica = carimboTrpDoPmr(stamp({ versionId: V38, versionNo: 1 }));
  ok(unica.trp_version_id === V38, "regua UNICA grava o id da versao", j(unica));
  ok(unica.trp_multi_versao === false, "regua UNICA grava trp_multi_versao = false", j(unica));

  const partida = carimboTrpDoPmr(stamp({ competenciaPartida: true }));
  ok(partida.trp_version_id === null, "competencia PARTIDA grava trp_version_id = NULL", j(partida));
  ok(partida.trp_multi_versao === true, "competencia PARTIDA grava trp_multi_versao = true", j(partida));
  ok(
    partida.trp_version_id !== V39,
    "e NAO carimba a ultima regua (a TRP39), que e a mentira que confere",
    j(partida)
  );

  for (const semStamp of [null, undefined]) {
    const c = carimboTrpDoPmr(semStamp);
    ok(
      c.trp_version_id === null && c.trp_multi_versao === null && c.trp_fallback === null,
      `SEM stamp (${String(semStamp)}) grava NULL + NULL — desconhecido continua desconhecido`,
      j(c)
    );
  }
  const c2 = carimboTrpDoPmr(null);
  ok(
    c2.trp_multi_versao !== false,
    "sem stamp NAO grava false (seria afirmar 'regua unica' sem ter medido)",
    j(c2)
  );

  // fallback em cascata: id da FORNECEDORA, e nunca partida (ver resolveTrpRegraDb)
  const casc = carimboTrpDoPmr(stamp({ versionId: V38, isFallback: true, competenciaFornecedora: "2026-07" }));
  ok(
    casc.trp_version_id === V38 && casc.trp_fallback === true && casc.trp_multi_versao === false,
    "fallback em cascata: carimba a FORNECEDORA, fallback=true, partida=false",
    j(casc)
  );
}

// =============================================================== BLOCO 2
console.log("\n2) CONTROLE POSITIVO — regua unica e IDENTICA ao comportamento de 31/08");
console.log(linha("-"));
{
  // O criterio ANTIGO, reimplementado aqui (era o que os 2 sitios faziam inline).
  const antigo = (st) => ({
    trp_version_id: st ? st.versionId : null,
    trp_fallback: st ? st.isFallback : null,
  });
  const casos = [
    ["regua unica, sem fallback", stamp({ versionId: V38, versionNo: 1 })],
    ["regua unica, com fallback", stamp({ versionId: V38, isFallback: true })],
    ["sem stamp", null],
  ];
  for (const [nome, st] of casos) {
    const novo = carimboTrpDoPmr(st);
    const velho = antigo(st);
    ok(
      novo.trp_version_id === velho.trp_version_id && novo.trp_fallback === velho.trp_fallback,
      `${nome}: id e fallback IDENTICOS ao criterio antigo`,
      `novo=${j(novo)} antigo=${j(velho)}`
    );
  }
}

// =============================================================== BLOCO 3
console.log("\n3) MUTACAO A — 'carimba a ultima regua mesmo partida' TEM de divergir");
console.log(linha("-"));
{
  const st = stamp({ competenciaPartida: true });
  const mutante = { trp_version_id: st.versionId, trp_fallback: st.isFallback }; // o de 31/08
  const real = carimboTrpDoPmr(st);
  ok(
    mutante.trp_version_id !== real.trp_version_id,
    "os dois criterios dao carimbos DIFERENTES na competencia partida (o bloco 1 nao passa por sorte)",
    `mutante=${mutante.trp_version_id} real=${real.trp_version_id}`
  );
  ok(
    mutante.trp_version_id === V39,
    "e o mutante grava JUSTAMENTE a TRP39 — falsa para os 83 contratos de 31/07 a 04/08",
    mutante.trp_version_id
  );
  // E o detector NAO acusaria: id gravado == id vigente hoje = OK verdinho.
  eq("pior: com o mutante o detector diria OK", classify("daily", V39, V39, undefined), "OK");
  eq("com a regua real ele diz MULTI_VERSAO", classify("daily", null, V39, true), "MULTI_VERSAO");
}

// =============================================================== BLOCO 4
console.log("\n4) MUTACAO B — classify com `!multiVersao` apaga o detector inteiro");
console.log(linha("-"));
{
  const TRP_SOURCES = new Set(["bbts", "daily"]);
  const classifyMutante = (source, stored, current, multi) => {
    if (!TRP_SOURCES.has(source)) return "NAO_APLICAVEL";
    if (!multi) return "MULTI_VERSAO"; // A MUTACAO
    if (stored == null) return "DESCONHECIDO";
    return stored === current ? "OK" : "STALE";
  };
  // O historico REAL do PMR: trp_multi_versao NULL (medido 01/09/2026, 0 nao-nulas).
  eq("real:    historico NULL -> DESCONHECIDO", classify("bbts", null, V38, null), "DESCONHECIDO");
  eq("mutante: historico NULL -> MULTI_VERSAO", classifyMutante("bbts", null, V38, null), "MULTI_VERSAO");
  ok(
    classify("bbts", null, V38, null) !== classifyMutante("bbts", null, V38, null),
    "a mutacao MUDA o veredito do historico — logo o `=== true` esta sendo medido",
    "DESCONHECIDO x MULTI_VERSAO"
  );
  eq("real:    stale continua STALE", classify("bbts", V38, V39, false), "STALE");
  eq("mutante: stale VIRA MULTI_VERSAO (some do painel)", classifyMutante("bbts", V38, V39, false), "MULTI_VERSAO");
  ok(
    classify("bbts", V38, V39, false) !== classifyMutante("bbts", V38, V39, false),
    "com a mutacao, competencia REALMENTE stale sairia do bucket de acao",
    "STALE x MULTI_VERSAO"
  );
}

// =============================================================== BLOCO 5
console.log("\n5) FIM A FIM — a partida sai como MULTI_VERSAO, nao como DESCONHECIDO");
console.log(linha("-"));

/**
 * Stub encadeavel de Supabase. Serve duas tabelas: trp_rule_versions (o
 * resolvedor) e promoter_monthly_results (o detector). NAO ordena por conta
 * propria alem do que o codigo pedir — a ordem de entrada e significativa.
 */
function stubClient(tabelas) {
  return {
    from(tabela) {
      const st = { filtros: [], orders: [], limit: null };
      const q = {
        select() {
          return q;
        },
        eq(col, val) {
          st.filtros.push([col, val]);
          return q;
        },
        lt(col, val) {
          st.filtros.push(["<" + col, val]);
          return q;
        },
        order(col, opts) {
          st.orders.push([col, opts && opts.ascending === true ? 1 : -1]);
          return q;
        },
        limit(n) {
          st.limit = n;
          return q;
        },
        then(resolve) {
          let rows = (tabelas[tabela] || []).slice();
          for (const [col, val] of st.filtros) {
            rows = col.startsWith("<")
              ? rows.filter((r) => String(r[col.slice(1)]) < String(val))
              : rows.filter((r) => r[col] === val);
          }
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

(async () => {
  // AGOSTO/2026 PARTIDO — a fixture e o caso real: TRP38 ate 04/08, TRP39 de 05/08.
  const versoes = [
    { id: V38, competencia: "2026-08-01", version_no: 1, valid_from: "2026-07-31", valid_until: "2026-08-04", regra_json: {}, is_active: true },
    { id: V39, competencia: "2026-08-01", version_no: 2, valid_from: "2026-08-05", valid_until: "2026-08-28", regra_json: {}, is_active: true },
  ];
  const pmrPartido = [
    // como o carimbo novo grava numa competencia partida
    { promoter_id: "p1", company_id: "c1", source: "daily", year: 2026, month: 8, trp_version_id: null, trp_fallback: false, trp_multi_versao: true },
    { promoter_id: "p2", company_id: "c2", source: "bbts", year: 2026, month: 8, trp_version_id: null, trp_fallback: false, trp_multi_versao: true },
    // linha RR: nao usa TRP
    { promoter_id: "p3", company_id: "c1", source: "fechamento", year: 2026, month: 8, trp_version_id: null, trp_fallback: null, trp_multi_versao: null },
  ];
  const sb = stubClient({ trp_rule_versions: versoes, promoter_monthly_results: pmrPartido });
  const res = await detectTrpStaleForCompetencia({ year: 2026, month: 8 }, sb);

  eq("agosto partido: 2 linhas MULTI_VERSAO", res.counts.multi_versao, 2);
  eq("agosto partido: 0 DESCONHECIDO (nao vira alerta imortal)", res.counts.desconhecido, 0);
  eq("agosto partido: 0 STALE", res.counts.stale, 0);
  eq("agosto partido: a linha RR segue NAO_APLICAVEL", res.counts.nao_aplicavel, 1);
  ok(res.has_multi_versao === true, "has_multi_versao = true", j(res.counts));
  ok(res.has_desconhecido === false, "has_desconhecido = FALSE — o ledgerHealth nao alerta pra sempre", j(res.counts));
  ok(
    res.has_stale === false,
    "has_stale = false: DIVIDA (ii) — competencia partida NUNCA entra na oferta de reconsolidacao. " +
      "Se esta assercao cair, alguem mudou a decisao (b): decida em voz alta antes de deixar verde",
    j(res.counts)
  );

  // MESMA fixture, carimbo VELHO (a mutacao A gravada no PMR): o detector diria OK.
  const pmrVelho = pmrPartido.map((r) =>
    r.source === "fechamento" ? r : { ...r, trp_version_id: V39, trp_multi_versao: null }
  );
  const resVelho = await detectTrpStaleForCompetencia(
    { year: 2026, month: 8 },
    stubClient({ trp_rule_versions: versoes, promoter_monthly_results: pmrVelho })
  );
  eq("com o carimbo VELHO o detector diria OK (a mentira que confere)", resVelho.counts.ok, 2);
  ok(
    resVelho.counts.multi_versao === 0 && res.counts.ok === 0,
    "os dois carimbos produzem vereditos OPOSTOS na MESMA competencia",
    `velho ok=${resVelho.counts.ok} / novo multi=${res.counts.multi_versao}`
  );

  // CONTROLE POSITIVO: competencia de regua UNICA nao muda nada.
  const versoesUnica = [
    { id: V38, competencia: "2026-07-01", version_no: 2, valid_from: "2026-06-30", valid_until: "2026-07-30", regra_json: {}, is_active: true },
  ];
  const pmrUnica = [
    { promoter_id: "p1", company_id: "c1", source: "bbts", year: 2026, month: 7, trp_version_id: V38, trp_fallback: false, trp_multi_versao: false },
    { promoter_id: "p2", company_id: "c1", source: "bbts", year: 2026, month: 7, trp_version_id: V39, trp_fallback: false, trp_multi_versao: false },
    { promoter_id: "p3", company_id: "c1", source: "daily", year: 2026, month: 7, trp_version_id: null, trp_fallback: null, trp_multi_versao: null },
  ];
  const resU = await detectTrpStaleForCompetencia(
    { year: 2026, month: 7 },
    stubClient({ trp_rule_versions: versoesUnica, promoter_monthly_results: pmrUnica })
  );
  eq("CONTROLE: regua unica — 1 OK", resU.counts.ok, 1);
  eq("CONTROLE: regua unica — 1 STALE", resU.counts.stale, 1);
  eq("CONTROLE: regua unica — 1 DESCONHECIDO (historico intacto)", resU.counts.desconhecido, 1);
  eq("CONTROLE: regua unica — 0 MULTI_VERSAO", resU.counts.multi_versao, 0);

  // =============================================================== BLOCO 6
  console.log("\n6) OS DOIS ESCRITORES consomem a regua unica — e ninguem mais decide");
  console.log(linha("-"));
  const SITIOS = ["app/api/calculate/monthly/route.ts", "lib/bbtsMonthly.ts"];
  for (const rel of SITIOS) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    ok(src.includes("carimboTrpDoPmr(trpStamp)"), `${rel} chama a regua unica`);
    ok(
      src.includes("trp_multi_versao: carimboTrp.trp_multi_versao,"),
      `${rel} grava trp_multi_versao a partir dela`
    );
    ok(!src.includes("trpStamp?.versionId"), `${rel} NAO reimplementa o carimbo inline`);
  }

  // Varredura: quem mais escreve trp_version_id? So os 2 sitios (pela regua) e os
  // 2 consolidadores que gravam literal null por NAO usarem TRP.
  // valor esperado por arquivo. lib/trp/carimboPmr.ts e a DEFINICAO da regua
  // (tipo + as 3 saidas), nao um escritor: por isso aceita mais de um valor.
  const PERMITIDOS = new Map([
    ["app/api/calculate/monthly/route.ts", ["carimboTrp.trp_version_id"]],
    ["lib/bbtsMonthly.ts", ["carimboTrp.trp_version_id"]],
    ["lib/closingMonthly.ts", ["null"]],
    ["lib/cmsMonthly.ts", ["null"]],
    ["lib/trp/carimboPmr.ts", ["string | null;", "null", "stamp.versionId"]],
  ]);
  const encontrados = [];
  const varrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (nome === "node_modules" || nome === ".next") continue;
        varrer(p);
      } else if (/\.tsx?$/.test(nome)) {
        const src = fs.readFileSync(p, "utf8");
        const rel = path.relative(ROOT, p).replace(/\\/g, "/");
        for (const m of src.matchAll(/trp_version_id:\s*([^,\n]+)/g)) {
          encontrados.push([rel, m[1].trim()]);
        }
      }
    }
  };
  varrer(path.join(ROOT, "app"));
  varrer(path.join(ROOT, "lib"));
  const intrusos = encontrados.filter(([rel, val]) => !(PERMITIDOS.get(rel) || []).includes(val));
  ok(
    intrusos.length === 0,
    "nenhum escritor NOVO de trp_version_id fora dos 4 conhecidos",
    intrusos.length ? j(intrusos) : `${encontrados.length} ocorrencia(s), todas esperadas`
  );

  console.log("\n" + (falhas === 0 ? "GATE OK (0 falhas)" : `GATE FALHOU (${falhas} falha(s))`));
  // process.exitCode, NAO process.exit(): ver a nota em detector_regua_camada1_gate.cjs.
  process.exitCode = falhas === 0 ? 0 : 1;
})().catch((e) => {
  console.error("GATE FALHOU (excecao):", e && e.message ? e.message : e);
  process.exitCode = 1;
});
