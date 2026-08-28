#!/usr/bin/env node
/* ============================================================================
 * GATE — o import SO-CREDITO da ADS nao pode apagar o seguro ja gravado.
 *
 * O DEFEITO QUE ISTO VIGIA (medido em 27/08/2026 contra o fechamento REAL de
 * julho/2026, banco espelho semeado com producao):
 *
 *   ancora_ok = true   gravadas = 43
 *   12 de 12 linhas com seguro perderam TUDO:
 *     bbts_seguro_pago  115,10     -> 0,00
 *     insurance_value   113.345,57 -> 0,00
 *     has_insurance     true       -> false
 *     insurance_type    "SLIP"     -> null
 *
 * DUAS CAUSAS, e o gate cobra as duas:
 *   (1) A ANCORA E DO PROPRIO ARQUIVO. Sem o PDF de seguro o extrator devolve
 *       lista vazia, _ancoras.seguro_calculo = 0, e o gate de ancora compara
 *       0 com 0 e PASSA. Ausencia e zero sao indistinguiveis para ele.
 *   (2) O MERGE E POR DONO DE COLUNA e o dono e FULL, que escreve TODA chave
 *       presente no registro. Zerar a chave e uma AFIRMACAO ("a BBTS nao pagou
 *       seguro"); omitir e "nao tocar".
 *
 * SELF-CONTAINED de proposito: nao chama createClient, nao le arquivo de
 * ambiente por conta propria e nao le arquivo fora do repo. O banco e um
 * ESPELHO em memoria (scripts/_fakeDpr.cjs) que reproduz a semantica do upsert
 * parcial do PostgREST (ON CONFLICT DO UPDATE SET so das colunas presentes na
 * carga) — que e exatamente o mecanismo em julgamento. O caminho exercitado e o
 * REAL: importBbtsClosing + mergeDailyProductionRecords + ownedColumnsFor, e a
 * funcao POST da rota /api/import/closing/ads.
 *
 * NAO E VACUIDADE: as asserçoes 2 e 6 exigem que a escrita TENHA acontecido
 * (linhas atualizadas, credito reescrito) e a 7 exige que COM o PDF de seguro
 * as colunas de seguro VOLTEM a ser escritas — senao "nao tocar" degeneraria
 * em "nunca escrever seguro".
 * ==========================================================================*/
require("./_ts_register.cjs");
const path = require("node:path");
const Module = require("node:module");
const { createFakeSupabase } = require("./_fakeDpr.cjs");
const { NextResponse } = require("next/server");

const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const COLS_SEGURO = ["bbts_seguro_pago", "insurance_value", "insurance_net_value", "has_insurance", "insurance_type"];

let falhas = 0;
let total = 0;
function ok(cond, msg, extra) {
  total += 1;
  if (cond) {
    console.log(`  OK    ${msg}`);
  } else {
    falhas += 1;
    console.log(`  FALHA ${msg}${extra ? `\n        ${extra}` : ""}`);
  }
}

// ---- cliente "real" de mentira: so as tabelas de LEITURA que o import consulta
function stubReal(tables) {
  // `single`/`maybeSingle` devolvem OBJETO, nao array — o cliente real faz isso,
  // e a rota depende disso para ler o nome da empresa.
  const build = (table, unico) =>
    new Proxy(
      {},
      {
        get(_t, p) {
          if (p === "then") {
            const linhas = tables[table] ?? [];
            const data = unico ? linhas[0] ?? null : linhas;
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          if (typeof p === "symbol") return undefined;
          const nome = String(p);
          return () => build(table, unico || nome === "single" || nome === "maybeSingle");
        },
      }
    );
  return { from: (table) => build(table, false) };
}
const REAL = stubReal({
  j_keys: [{ j_key: "JJ552710", promoter_id: null, key_type: "MASTER" }],
  bbts_rule_versions: [],
  daily_production_records: [],
  companies: [{ id: ADS, name: "ADS PROMOTORA" }],
});

// ---- as 3 linhas ja gravadas, com seguro (o formato das linhas de producao)
function linha(prop, pago, base, tipo, avista) {
  return {
    company_id: ADS,
    proposal_number: prop,
    j_key: "JJ552710",
    assigned_promoter_id: null,
    original_promoter_id: null,
    promoter_source: "MASTER_REASSIGNED",
    gross_value: 10000,
    net_value: 10000,
    bbts_pag_avista: avista,
    bbts_seguro_pago: pago,
    insurance_value: base,
    insurance_net_value: base,
    insurance_type: tipo,
    has_insurance: true,
    status: "PRODUCAO",
    movement_date: "2026-07-15",
    raw_payload: { __bbts_meta: { fonte: "fechamento_pdf" } },
  };
}
function seed() {
  return [
    linha("900000001", 7.15, 7150.0, "ESTOQUE D0", 100.0),
    linha("900000002", 2.09, 2090.55, "SLIP", 200.0),
    linha("900000003", 43.87, 43873.21, "ESTOQUE D0", 300.0),
  ];
}

// ---- o BbtsClosingInput que o extrator entregaria
function inputCredito({ comSeguro }) {
  const credito = [
    { contrato: "900000001", valor_financiado: 10000, pag_avista: 111.11, data: "10/07/2026" },
    { contrato: "900000002", valor_financiado: 20000, pag_avista: 222.22, data: "11/07/2026" },
    { contrato: "900000003", valor_financiado: 30000, pag_avista: 333.33, data: "12/07/2026" },
  ];
  const seguro = comSeguro
    ? [
        { contrato: "900000001", valor_total_credito: 7150.0, tipo: "ESTOQUE D0", valor_seguro: 7.15, tratamento: "calculo" },
        { contrato: "900000002", valor_total_credito: 2090.55, tipo: "SLIP", valor_seguro: 2.09, tratamento: "calculo" },
        { contrato: "900000003", valor_total_credito: 43873.21, tipo: "ESTOQUE D0", valor_seguro: 43.87, tratamento: "calculo" },
      ]
    : [];
  return {
    year: 2026,
    month: 7,
    credito,
    seguro,
    prt: [],
    seguro_pdf_ausente: !comSeguro,
    _ancoras: {
      credito_propostas: credito.length,
      credito_valor_financiado: 60000,
      credito_pag_avista: 666.66,
      seguro_calculo: comSeguro ? 53.11 : 0,
    },
  };
}

function stubModule(spec, exports) {
  const p = require.resolve(spec);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
  return p;
}

(async () => {
  const { importBbtsClosing } = require("../lib/bbtsClosingImport.ts");

  // =========================================================================
  console.log("\n(A) IMPORT SO-CREDITO sobre competencia que JA TEM seguro gravado");
  // =========================================================================
  const antes = seed();
  const fake = createFakeSupabase(REAL, antes);
  const res = await importBbtsClosing(fake, inputCredito({ comSeguro: false }), {
    dryRun: false,
    fileName: "gate-so-credito",
  });

  ok(
    res.ancora_ok === true,
    "a ancora do fechamento PASSA sem o PDF de seguro (e por isso o silencio e possivel)",
    `ancora_ok=${res.ancora_ok}`
  );
  const upd = fake._writes.filter((w) => w.table === "daily_production_records");
  const atualizadas = upd.reduce((a, w) => a + w.updated, 0);
  ok(atualizadas === 3, "o UPDATE aconteceu nas 3 linhas (o gate nao passa por vacuidade)", `updated=${atualizadas}`);

  const carga = upd.find((w) => w.updated > 0);
  const chavesSeguro = (carga ? carga.keys : []).filter((k) => COLS_SEGURO.includes(k));
  ok(
    chavesSeguro.length === 0,
    "a carga do upsert NAO traz nenhuma chave de seguro (omitida, nao zerada)",
    `chaves de seguro na carga: ${chavesSeguro.join(", ")}`
  );

  let mudadas = 0;
  const detalhe = [];
  for (const a of antes) {
    const d = fake._get(ADS, a.proposal_number);
    for (const c of COLS_SEGURO) {
      if (JSON.stringify(a[c]) !== JSON.stringify(d[c])) {
        mudadas += 1;
        detalhe.push(`${a.proposal_number}.${c}: ${JSON.stringify(a[c])} -> ${JSON.stringify(d[c])}`);
      }
    }
  }
  ok(mudadas === 0, "nenhuma das 5 colunas de seguro mudou nas 3 linhas", detalhe.join(" | "));
  const pagoDepois = antes.reduce((s, a) => s + Number(fake._get(ADS, a.proposal_number).bbts_seguro_pago || 0), 0);
  ok(
    Math.abs(pagoDepois - 53.11) < 0.005,
    "Sigma bbts_seguro_pago continua 53,11 depois do import so-credito",
    `depois=${pagoDepois}`
  );
  const avistaDepois = antes.map((a) => Number(fake._get(ADS, a.proposal_number).bbts_pag_avista || 0));
  ok(
    JSON.stringify(avistaDepois) === JSON.stringify([111.11, 222.22, 333.33]),
    "o CREDITO foi de fato reescrito (bbts_pag_avista mudou) — a escrita existiu",
    `depois=${JSON.stringify(avistaDepois)}`
  );

  // =========================================================================
  console.log("\n(B) CONTROLE POSITIVO — com o PDF de seguro, as colunas VOLTAM a ser escritas");
  // =========================================================================
  const antes2 = seed().map((r) => ({
    ...r,
    bbts_seguro_pago: 0,
    insurance_value: 0,
    insurance_net_value: 0,
    has_insurance: false,
    insurance_type: null,
  }));
  const fake2 = createFakeSupabase(REAL, antes2);
  await importBbtsClosing(fake2, inputCredito({ comSeguro: true }), { dryRun: false, fileName: "gate-2-pdfs" });
  const carga2 = fake2._writes.filter((w) => w.table === "daily_production_records" && w.updated > 0)[0];
  const chavesSeguro2 = (carga2 ? carga2.keys : []).filter((k) => COLS_SEGURO.includes(k));
  ok(
    chavesSeguro2.length === COLS_SEGURO.length,
    "com o PDF de seguro, as 5 chaves de seguro ENTRAM na carga",
    `na carga: ${chavesSeguro2.join(", ")}`
  );
  const pago2 = antes2.reduce((s, a) => s + Number(fake2._get(ADS, a.proposal_number).bbts_seguro_pago || 0), 0);
  ok(Math.abs(pago2 - 53.11) < 0.005, "o seguro foi GRAVADO (0,00 -> 53,11)", `depois=${pago2}`);

  // =========================================================================
  console.log("\n(C) A ROTA — funcao POST real de /api/import/closing/ads");
  // =========================================================================
  const antes3 = seed();
  const fake3 = createFakeSupabase(REAL, antes3);
  stubModule("@/lib/auth/guards", {
    withSocioAdmin: async () => ({ user: { session: { appUser: { email: "gate@local" } } } }),
    apiGuardErrorResponse: (e) => NextResponse.json({ error: String((e && e.message) || e) }, { status: 500 }),
  });
  stubModule("@/lib/supabaseAdmin", { getSupabaseAdmin: () => fake3 });
  stubModule("@/lib/memoryCache", { clearMemoryCache: () => {} });
  stubModule("@/lib/reconsolidarCompetencia", { reconsolidarCompetenciaFechada: async () => ({ noop: true }) });
  stubModule("@/lib/bbtsPdfExtract", {
    extractBbtsClosingFromPdfs: async (_cred, seg) => inputCredito({ comSeguro: seg !== null }),
  });
  const { POST } = require(path.join("..", "app", "api", "import", "closing", "ads", "route.ts"));
  const post = (body) =>
    POST(
      new Request("http://local/api/import/closing/ads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );

  const r409 = await post({ creditoFile: "Zm9v", fileName: "credito.pdf" });
  const j409 = await r409.json();
  ok(r409.status === 409, "so-credito SEM confirmacao e RECUSADO (409)", `status=${r409.status}`);
  ok(j409.linhas_com_seguro_ja_gravado === 3, "a recusa conta as LINHAS que seriam afetadas", JSON.stringify(j409));
  ok(
    Math.abs(Number(j409.seguro_pago_ja_gravado) - 53.11) < 0.005,
    "a recusa traz o VALOR de seguro hoje gravado",
    JSON.stringify(j409.seguro_pago_ja_gravado)
  );
  ok(String(j409.competencia) === "2026-07", "a recusa nomeia a COMPETENCIA", String(j409.competencia));
  ok(/ADS/i.test(String(j409.empresa || "")), "a recusa nomeia a EMPRESA", `empresa=${JSON.stringify(j409.empresa)}`);
  ok(
    /53,11/.test(String(j409.error || "")) &&
      /3 linha/i.test(String(j409.error || "")) &&
      /2026-07/.test(String(j409.error || "")) &&
      /ADS/i.test(String(j409.error || "")),
    "o TEXTO da recusa (o unico campo que a tela exibe) escreve o dano em numeros",
    String(j409.error)
  );

  const rStr = await post({ creditoFile: "Zm9v", fileName: "credito.pdf", semSeguro: "true" });
  ok(rStr.status === 409, "confirmacao tem de ser o booleano true — a string 'true' NAO vale", `status=${rStr.status}`);

  const rOk = await post({ creditoFile: "Zm9v", fileName: "credito.pdf", semSeguro: true });
  const jOk = await rOk.json();
  ok(rOk.status === 200 && jOk.success === true, "com confirmacao explicita o import segue", `status=${rOk.status}`);
  let mudadas3 = 0;
  for (const a of antes3) {
    const d = fake3._get(ADS, a.proposal_number);
    for (const c of COLS_SEGURO) if (JSON.stringify(a[c]) !== JSON.stringify(d[c])) mudadas3 += 1;
  }
  ok(mudadas3 === 0, "mesmo CONFIRMADO, o seguro ja gravado sobrevive intacto", `colunas mudadas=${mudadas3}`);

  console.log(`\n=== ${total - falhas}/${total} asserçoes ===`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exit(1);
});
