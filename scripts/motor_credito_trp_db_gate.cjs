#!/usr/bin/env node
/**
 * scripts/motor_credito_trp_db_gate.cjs — GATE DE PARIDADE da frente
 * "motor de crédito lê a TRP do DB (self-service)". READ-ONLY.
 *
 * NÃO grava: closingAnalytics/promoterAnalytics não escrevem; bbtsMonthly,
 * closingMonthly e o orquestrador rodam em dryRun:true. A flag TRP_SOURCE é trocada
 * só no process.env DESTE processo (nunca persistida).
 *
 * COMO PROVA (mesmo código, fonte diferente)
 *   Roda os entry points REAIS de produção duas vezes, alternando só TRP_SOURCE:
 *     OLD = json -> buildTrpCreditProvider devolve undefined -> motor lê MAPA_MES_REGRA
 *                   (= comportamento de produção HOJE).
 *     NEW = db   -> provider síncrono lê trp_rule_versions (preload 1x/competência).
 *   Nada de cálculo é reimplementado aqui.
 *
 * GATES
 *   1. jun/2026 NO-OP (âncoras): orquestrador BBTS-2d totals.repasse_credito_rr = 109.538,42 e
 *      totals.repasse_credito_ads = 5.153,53 nas DUAS fontes, e payload deep-equal (EPS 1e-9).
 *   2. abr/mai/2026 NO-OP: orquestrador, closingAnalytics, bbtsMonthly e promoterAnalytics
 *      deep-equal entre as fontes.
 *      RESSALVA CONHECIDA E ESPERADA: o payload de closingAnalytics carrega, ALÉM do mês
 *      selecionado, a série `trend` (6 meses) e `summary.futureDeferredBalance`, que
 *      incluem JULHO. Esses campos MUDAM — não porque abr/mai mudaram, mas porque julho
 *      foi consertado. Só são tolerados quando o ponto do trend é 2026-07 (verificado por
 *      year/month, não por índice). Qualquer outro campo divergente REPROVA o gate.
 *   3. jul/2026: com db o crédito passa a sair da TRP38 (DB) e o motor PARA de logar DRIFT.
 *      Imprime o % TRP por contrato (a RÉGUA — o total do mês ainda é parcial).
 *   4. RETROCOMPAT: calcularOperacao SEM opts == {} == {trpProvider: undefined}.
 *
 * Uso: node scripts/motor_credito_trp_db_gate.cjs
 * Exit 0 só se todos os gates passarem.
 */

const { createClient } = require("@supabase/supabase-js");
const H = require("./_motor_credito_trp_db_lib.cjs");

const PAGE = 1000;
const ANCORA_RR = 109538.42;   // jun/2026 — orquestrador totals.repasse_credito_rr
const ANCORA_ADS = 5153.53;    // jun/2026 — orquestrador totals.repasse_credito_ads

const NOOP = [
  { comp: "2026-06", y: 2026, m: 6, ancoras: true },
  { comp: "2026-04", y: 2026, m: 4 },
  { comp: "2026-05", y: 2026, m: 5 },
];

/** Divergência tolerada? Só os campos do payload de fechamento que carregam JULHO. */
function ehDeJulho(caminho, payload) {
  if (caminho.startsWith("summary.futureDeferredBalance")) return true;
  const m = caminho.match(/^trend\[(\d+)\]\./);
  if (m) {
    const p = payload.trend?.[Number(m[1])];
    return p && p.year === 2026 && p.month === 7; // provado por year/month, não por índice
  }
  return false;
}

const opDe = (r) => ({
  valor_liquido: r.net_value,
  valor_bruto: r.gross_value,
  valor_seguro: r.insurance_value,
  taxa_juros: r.interest_rate,
  prazo: r.term_months ?? r.installments,
  product_description: r.product_description,
  convenio_code: r.convenio_code,
  production_value: 0,
  status: r.status,
  movement_date: r.movement_date,
  contract_date: r.contract_date,
  proposal_date: r.proposal_date,
  raw_payload: r.raw_payload,
  company_cash_percent: null,
});

async function fetchRows(sb, deISO, ateISO) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("daily_production_records")
      .select(
        "id, proposal_number, product_description, interest_rate, term_months, installments, contract_date, net_value, gross_value, insurance_value, status, is_srcc_restricted, company_id, movement_date, proposal_date, raw_payload, convenio_code"
      )
      .gte("contract_date", deISO)
      .lte("contract_date", ateISO)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

async function main() {
  H.loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const lib = H.loadRepoLib();
  let falhas = 0;

  console.log("\n============================================================");
  console.log("GATE — motor de crédito lê a TRP do DB (injeção síncrona)");
  console.log(`TRP_SOURCE herdada do ambiente: ${process.env.TRP_SOURCE || "(vazia -> json)"}`);
  console.log("============================================================");

  // ------------------------------------------------------ 1 e 2: NO-OP ----
  for (const c of NOOP) {
    console.log(`\n\n### ${c.comp} — NO-OP (json vs db)`);

    const orqJ = await H.comFonte("json", () => lib.orq.consolidateMonthlyGroup(sb, { year: c.y, month: c.m, dryRun: true }));
    const orqD = await H.comFonte("db", () => lib.orq.consolidateMonthlyGroup(sb, { year: c.y, month: c.m, dryRun: true }));
    const difOrq = H.deepDiff(H.clone(orqJ.out), H.clone(orqD.out));

    const rrJ = await H.comFonte("json", () => lib.closing.buildClosingAnalytics(sb, { year: c.y, month: c.m }));
    const rrD = await H.comFonte("db", () => lib.closing.buildClosingAnalytics(sb, { year: c.y, month: c.m }));
    const difRRTodos = H.deepDiff(H.clone(rrJ.out), H.clone(rrD.out));
    const difRRJulho = difRRTodos.filter((d) => ehDeJulho(d, rrD.out));
    const difRRReal = difRRTodos.filter((d) => !ehDeJulho(d, rrD.out));

    const adsJ = await H.comFonte("json", () => lib.bbts.consolidateMonthlyFromBbts(sb, { year: c.y, month: c.m, dryRun: true }));
    const adsD = await H.comFonte("db", () => lib.bbts.consolidateMonthlyFromBbts(sb, { year: c.y, month: c.m, dryRun: true }));
    const difADS = H.deepDiff(H.clone(adsJ.out), H.clone(adsD.out));

    const paJ = await H.comFonte("json", () => lib.promoter.buildPromoterAnalytics(sb, { year: c.y, month: c.m }));
    const paD = await H.comFonte("db", () => lib.promoter.buildPromoterAnalytics(sb, { year: c.y, month: c.m }));
    const difPA = H.deepDiff(H.clone(paJ.out), H.clone(paD.out));

    console.log(`  orquestrador BBTS-2d (RR+ADS): ${difOrq.length === 0 ? "IDÊNTICO ✓" : `DIVERGIU ✗ (${difOrq.length})`}`);
    for (const d of difOrq.slice(0, 8)) console.log(`     • ${d}`);
    console.log(`  bbtsMonthly (ADS):             ${difADS.length === 0 ? "IDÊNTICO ✓" : `DIVERGIU ✗ (${difADS.length})`}`);
    for (const d of difADS.slice(0, 8)) console.log(`     • ${d}`);
    console.log(`  promoterAnalytics (promotor):  ${difPA.length === 0 ? "IDÊNTICO ✓" : `DIVERGIU ✗ (${difPA.length})`}`);
    for (const d of difPA.slice(0, 8)) console.log(`     • ${d}`);
    console.log(`  closingAnalytics (fechamento): ${difRRReal.length === 0 ? "IDÊNTICO no mês ✓" : `DIVERGIU ✗ (${difRRReal.length})`}`);
    for (const d of difRRReal.slice(0, 8)) console.log(`     • ${d}`);
    if (difRRJulho.length) {
      console.log(`     ~ ${difRRJulho.length} campo(s) que carregam JULHO mudaram — ESPERADO (é a correção):`);
      for (const d of difRRJulho) console.log(`        · ${d}`);
    }
    console.log(`  DRIFT no motor: json=${rrJ.drifts.length + adsJ.drifts.length + orqJ.drifts.length}  db=${rrD.drifts.length + adsD.drifts.length + orqD.drifts.length}`);

    if (c.ancoras) {
      const tj = orqJ.out.totals, td = orqD.out.totals;
      const okRR = Math.abs(tj.repasse_credito_rr - ANCORA_RR) < 0.005 && Math.abs(td.repasse_credito_rr - ANCORA_RR) < 0.005;
      const okADS = Math.abs(tj.repasse_credito_ads - ANCORA_ADS) < 0.005 && Math.abs(td.repasse_credito_ads - ANCORA_ADS) < 0.005;
      console.log(`  ÂNCORA RR  crédito jun: json=${H.brl(tj.repasse_credito_rr)}  db=${H.brl(td.repasse_credito_rr)}  (esperado ${H.brl(ANCORA_RR)}) ${okRR ? "✓" : "✗"}`);
      console.log(`  ÂNCORA ADS crédito jun: json=${H.brl(tj.repasse_credito_ads)}  db=${H.brl(td.repasse_credito_ads)}  (esperado ${H.brl(ANCORA_ADS)}) ${okADS ? "✓" : "✗"}`);
      if (!okRR || !okADS) falhas++;
    }
    falhas += difOrq.length + difADS.length + difPA.length + difRRReal.length;
  }

  // --------------------------------------------------------- 3: JULHO -----
  console.log(`\n\n### 2026-07 — o que a frente conserta (json=fallback/DRIFT  ->  db=TRP38)`);
  const todas = await fetchRows(sb, "2026-06-25", "2026-07-31");
  const jul = todas.filter((r) => lib.motor.competenciaDaDataContrato(r.contract_date) === "2026-07");
  console.log(`  contratos na competência 2026-07 (vigência): ${jul.length}`);

  const rodaJul = (src) =>
    H.comFonte(src, async () => {
      const prov = await lib.provider.buildTrpCreditProvider(jul.map((r) => r.contract_date), sb);
      let credito = 0;
      const linhas = jul.map((r) => {
        const c = lib.motor.calcularOperacao(opDe(r), { trpProvider: prov }).credito;
        credito += Number(c.total ?? 0);
        return { contrato: String(r.proposal_number), pct: c.percentual, regra: c.regra };
      });
      return { linhas, credito };
    });

  const jJson = await rodaJul("json");
  const jDb = await rodaJul("db");

  console.log(`  DRIFT logado pelo motor:  json=${jJson.drifts.length}   db=${jDb.drifts.length}  ${jDb.drifts.length === 0 ? "✓ (julho saiu do fallback)" : "✗ (db ainda cai em CREDIT_RULES)"}`);
  const mudaram = jDb.out.linhas.filter((d, i) => Math.abs(Number(d.pct ?? 0) - Number(jJson.out.linhas[i].pct ?? 0)) > H.EPS);
  console.log(`  contratos cujo % muda (fallback -> TRP38): ${mudaram.length}/${jul.length}`);
  console.log(`  crédito total julho (parcial): json=${H.brl(jJson.out.credito)}  db=${H.brl(jDb.out.credito)}  Δ=${H.brl(jDb.out.credito - jJson.out.credito)}`);
  console.log(`\n  % TRP por contrato (julho) — a RÉGUA (primeiros 40):`);
  console.log(`     contrato        | regra                     | % hoje (json) | % db (TRP38)`);
  for (const d of jDb.out.linhas.slice(0, 40)) {
    const j = jJson.out.linhas.find((x) => x.contrato === d.contrato);
    const mudou = Math.abs(Number(d.pct ?? 0) - Number(j?.pct ?? 0)) > H.EPS ? "  <-- MUDA" : "";
    const pctJ = j?.pct == null ? "null" : (Number(j.pct) * 100).toFixed(2) + "%";
    const pctD = d.pct == null ? "null" : (Number(d.pct) * 100).toFixed(2) + "%";
    console.log(`     ${String(d.contrato).padEnd(15)} | ${String(d.regra ?? "").padEnd(25)} | ${pctJ.padStart(13)} | ${pctD.padStart(11)}${mudou}`);
  }
  if (jDb.out.linhas.length > 40) console.log(`     ... (+${jDb.out.linhas.length - 40} contratos)`);
  const semPct = jDb.out.linhas.filter((r) => !(Number(r.pct) > 0)).length;
  console.log(`  contratos com pct > 0 no db: ${jul.length - semPct}/${jul.length}`);
  if (jul.length > 0 && jDb.drifts.length > 0) falhas++;

  // ---------------------------------------------------- 4: RETROCOMPAT ----
  console.log(`\n\n### RETROCOMPAT — calcularOperacao SEM opts`);
  let rcDif = 0;
  const amostra = jul.slice(0, 10);
  await H.comFonte("json", async () => {
    for (const r of amostra) {
      const a = JSON.stringify(lib.motor.calcularOperacao(opDe(r)));
      const b = JSON.stringify(lib.motor.calcularOperacao(opDe(r), {}));
      const c = JSON.stringify(lib.motor.calcularOperacao(opDe(r), { trpProvider: undefined }));
      if (a !== b || a !== c) rcDif++;
    }
  });
  console.log(`  sem opts == {} == {trpProvider:undefined}: ${amostra.length - rcDif}/${amostra.length} ${rcDif === 0 ? "✓" : "✗"}`);
  falhas += rcDif;

  console.log("\n============================================================");
  console.log(falhas === 0 ? "GATE: PASSOU — 0 divergências" : `GATE: FALHOU — ${falhas} divergência(s)`);
  console.log("============================================================\n");
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
