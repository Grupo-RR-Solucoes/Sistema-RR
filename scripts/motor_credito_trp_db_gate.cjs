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

// ---------------------------------------------------------------------------
// TRIAGEM DE 29/08/2026 — as 169 "divergencias" e o que cada uma era
// ---------------------------------------------------------------------------
// O portao reprovava com 169 divergencias. Decompostas UMA A UMA (nao por
// amostra: a impressao era truncada em 8 por secao, e a contagem abaixo saiu de
// uma execucao com o truncamento removido):
//
//   132  payload[].calculated_at   RELOGIO. O payload carrega o instante da
//        execucao. O portao roda o MESMO codigo duas vezes, uma por fonte, com
//        segundos de intervalo — esses dois carimbos NUNCA vao ser iguais. Nao
//        havia defeito nenhum sendo medido aqui: era o comparador comparando o
//        relogio consigo mesmo. 78% do vermelho.
//    30  payload[].trp_version_id / trp_fallback   PROCEDENCIA. Estes campos
//        EXISTEM para diferir entre as fontes: com json nao ha versao de regua
//        (null) e nao ha flag de fallback; com db vem o id da versao que pagou.
//        Exigir que fossem iguais era exigir que a frente inteira nao tivesse
//        acontecido. Ignorar em silencio, porem, esconderia o db PERDENDO a
//        procedencia — por isso viram ASSERCAO POSITIVA (`conferirProcedencia`
//        abaixo), nao excecao muda.
//     6  trend[].expectedTotal / deltaTotal   ANCORA VENCIDA. A tolerancia
//        estava presa a `month === 7` por literal. A janela do `trend` e de 6
//        meses e ANDA com o calendario: em 29/08/2026 ela termina em 2026-08, e
//        agosto passou a carregar a MESMA correcao que julho carregava (d 100,20
//        em ago, d 323,98 em jul) — o mesmo fenomeno ja documentado como
//        "ESPERADO (e a correcao)", so que num mes que a constante nao cobria.
//     1  ANCORA_RR                 CONSTANTE CONGELADA. Ver abaixo.
//
// NENHUMA das 169 era diferenca de CALCULO entre json e db em mes fechado. Tudo
// que o portao promete de verdade ja passava: promoterAnalytics IDENTICO nas 3
// competencias, bbtsMonthly IDENTICO em abril, DRIFT json=1203 -> db=0, ancora
// da ADS OK e retrocompatibilidade 10/10.
// ---------------------------------------------------------------------------

// ANCORA DA ADS — segue de pe, conferida em 29/08/2026 (json e db, ambos 5.153,53).
const ANCORA_ADS = 5153.53;    // jun/2026 — orquestrador totals.repasse_credito_ads

// ANCORA DO RR — REANCORADA em 29/08/2026: 109.538,42 -> 109.181,28.
// Ela nao estava errada: ENVELHECEU 48 dias e 540 commits. A antiga foi cravada
// em 12/07/2026 (commit 3363ba5) e o delta de R$ 357,14 esta atribuido CENTAVO A
// CENTAVO, por execucao em worktree de cada commit suspeito contra o banco de
// hoje — nenhum residuo inexplicado:
//
//   109.587,23   codigo de 3363ba5 rodado hoje  (a propria BASE moveu +48,81 em
//                48 dias com o codigo congelado: reatribuicoes e imports tardios.
//                E a prova de que constante absoluta sobre tabela viva nao tem
//                como ficar verde — ela vence sozinha, sem ninguem tocar codigo.)
//    -  23,17   competencia do volume virou JANELA (o mesmo R$ 23,17 da ERIKA ja
//               registrado na frente da janela)
//    - 960,93   d7d556e 25/08 "teto 5,80%: o repasse do fechamento sai da base
//               TRAZIDA AO TETO"
//    + 578,15   d6febc5 25/08 "carve-out INSS da Aldalene: o criterio e a TAXA"
//   ---------
//   109.181,28   HEAD  (json e db dao EXATAMENTE este mesmo valor — nao e, e nunca
//                foi, divergencia de fonte)
const ANCORA_RR = {
  valor: 109181.28,
  cravadaEm: "2026-08-29",
  procedencia:
    "orquestrador consolidateMonthlyGroup(2026-06, dryRun).totals.repasse_credito_rr, " +
    "medido nas DUAS fontes TRP (json e db) na mesma execucao — as duas dao 109.181,28. " +
    "Delta de R$ 357,14 contra a ancora de 12/07/2026 atribuido por bissecao em " +
    "worktree: +48,81 de movimento do banco, -23,17 da competencia por janela, " +
    "-960,93 de d7d556e (teto 5,80%) e +578,15 de d6febc5 (carve-out INSS).",
  escopo: { competencia: "2026-06", campo: "repasse_credito_rr", empresa: "RR" },
};
// HISTORICO: a ancora anterior era 109.538,42, cravada em 12/07/2026 no commit
// 3363ba5, quando o campo ainda se chamava `credito_rr` (343ee9b o renomeou para
// `repasse_credito_rr` em 01/08/2026).

const NOOP = [
  { comp: "2026-06", y: 2026, m: 6, ancoras: true },
  { comp: "2026-04", y: 2026, m: 4 },
  { comp: "2026-05", y: 2026, m: 5 },
];

// CAMPOS QUE NAO SAO CALCULO. Exclui-los do diff nao e afrouxar o portao: e
// parar de medir com ele o que ele nao mede. Cada um tem de ter motivo escrito,
// e os de PROCEDENCIA ainda sao conferidos por assercao propria logo abaixo.
// ATENCAO ao formato: H.deepDiff devolve a MENSAGEM inteira
// ("payload[0].calculated_at: <a> != <b>"), nao so o caminho. Por isso o casamento
// termina em `:` — um `$` aqui nao casaria nada e o filtro seria letra morta.
const NAO_E_CALCULO = [
  { re: /\.calculated_at:/, motivo: "relogio: carimbo do instante da execucao, difere entre as duas passadas por construcao" },
  { re: /\.trp_version_id:/, motivo: "procedencia: json nao tem versao de regua (null), db tem — DEVE diferir" },
  { re: /\.trp_fallback:/, motivo: "procedencia: flag que so o db preenche — DEVE diferir" },
];
const ehCalculo = (caminho) => !NAO_E_CALCULO.some((x) => x.re.test(caminho));

/**
 * CONTROLE POSITIVO da procedencia. Sem isto, o `NAO_E_CALCULO` acima viraria um
 * buraco: o db poderia PARAR de gravar trp_version_id e o portao seguiria verde.
 * Aqui a assimetria esperada e COBRADA — json sem versao, db com versao.
 */
function conferirProcedencia(saidaJson, saidaDb) {
  const linhas = (p) => (Array.isArray(p?.payload) ? p.payload : []);
  const lj = linhas(saidaJson), ld = linhas(saidaDb);
  if (lj.length === 0 || ld.length === 0) return null; // sem linhas: nada a provar
  const jsonSemVersao = lj.every((r) => r.trp_version_id == null);
  const dbComVersao = ld.some((r) => typeof r.trp_version_id === "string" && r.trp_version_id.length > 0);
  return { jsonSemVersao, dbComVersao, ok: jsonSemVersao && dbComVersao, nLinhas: ld.length };
}

/**
 * Divergencia tolerada no payload de fechamento?
 *
 * O payload carrega, alem do mes pedido, a serie `trend` (6 meses) e
 * `summary.futureDeferredBalance`. Esses campos alcancam meses em que o json NAO
 * TEM regua e cai no fallback — que e exatamente o que a frente conserta. Ali o
 * db diferir do json nao e regressao: e a correcao aparecendo.
 *
 * ANTES isto era `month === 7`, constante. A janela do trend ANDA com o
 * calendario e em 29/08/2026 ja alcancava agosto, entao a constante reprovava o
 * portao por envelhecimento. AGORA os dois lados saem da MESMA execucao: o mes e
 * tolerado se, e so se, o json DRIFTOU nele (`mes=YYYY-MM` nas mensagens de
 * DRIFT capturadas do proprio run). Nao ha mes cravado — se o json parar de
 * driftar em agosto, agosto deixa de ser tolerado sozinho.
 */
function mesesComDriftJson(drifts) {
  const s = new Set();
  for (const d of drifts) {
    const m = String(d).match(/mes=(\d{4})-(\d{2})/);
    if (m) s.add(`${m[1]}-${m[2]}`);
  }
  return s;
}
function ehMesDeFallbackDoJson(caminho, payload, mesesDrift) {
  if (caminho.startsWith("summary.futureDeferredBalance")) return true;
  const m = caminho.match(/^trend\[(\d+)\]\./);
  if (!m) return false;
  const p = payload.trend?.[Number(m[1])];
  if (!p) return false;
  // provado por year/month + DRIFT medido no mesmo run, nunca por indice nem por literal
  return mesesDrift.has(`${p.year}-${String(p.month).padStart(2, "0")}`);
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
    const difOrq = H.deepDiff(H.clone(orqJ.out), H.clone(orqD.out)).filter(ehCalculo);

    const rrJ = await H.comFonte("json", () => lib.closing.buildClosingAnalytics(sb, { year: c.y, month: c.m }));
    const rrD = await H.comFonte("db", () => lib.closing.buildClosingAnalytics(sb, { year: c.y, month: c.m }));
    // Os meses tolerados saem do DRIFT medido NESTE run, nao de um literal.
    const mesesDrift = mesesComDriftJson(rrJ.drifts);
    const difRRTodos = H.deepDiff(H.clone(rrJ.out), H.clone(rrD.out)).filter(ehCalculo);
    const difRRFallback = difRRTodos.filter((d) => ehMesDeFallbackDoJson(d, rrD.out, mesesDrift));
    const difRRReal = difRRTodos.filter((d) => !ehMesDeFallbackDoJson(d, rrD.out, mesesDrift));

    const adsJ = await H.comFonte("json", () => lib.bbts.consolidateMonthlyFromBbts(sb, { year: c.y, month: c.m, dryRun: true }));
    const adsD = await H.comFonte("db", () => lib.bbts.consolidateMonthlyFromBbts(sb, { year: c.y, month: c.m, dryRun: true }));
    const difADS = H.deepDiff(H.clone(adsJ.out), H.clone(adsD.out)).filter(ehCalculo);
    // CONTROLE POSITIVO: o que foi excluido do diff por ser procedencia tem de
    // continuar existindo do lado do db. Sem isto a exclusao viraria cegueira.
    const proc = conferirProcedencia(adsJ.out, adsD.out);

    const paJ = await H.comFonte("json", () => lib.promoter.buildPromoterAnalytics(sb, { year: c.y, month: c.m }));
    const paD = await H.comFonte("db", () => lib.promoter.buildPromoterAnalytics(sb, { year: c.y, month: c.m }));
    const difPA = H.deepDiff(H.clone(paJ.out), H.clone(paD.out)).filter(ehCalculo);

    console.log(`  orquestrador BBTS-2d (RR+ADS): ${difOrq.length === 0 ? "IDÊNTICO ✓" : `DIVERGIU ✗ (${difOrq.length})`}`);
    for (const d of difOrq.slice(0, 8)) console.log(`     • ${d}`);
    console.log(`  bbtsMonthly (ADS):             ${difADS.length === 0 ? "IDÊNTICO ✓" : `DIVERGIU ✗ (${difADS.length})`}`);
    for (const d of difADS.slice(0, 8)) console.log(`     • ${d}`);
    console.log(`  promoterAnalytics (promotor):  ${difPA.length === 0 ? "IDÊNTICO ✓" : `DIVERGIU ✗ (${difPA.length})`}`);
    for (const d of difPA.slice(0, 8)) console.log(`     • ${d}`);
    console.log(`  closingAnalytics (fechamento): ${difRRReal.length === 0 ? "IDÊNTICO no mês ✓" : `DIVERGIU ✗ (${difRRReal.length})`}`);
    for (const d of difRRReal.slice(0, 8)) console.log(`     • ${d}`);
    if (difRRFallback.length) {
      console.log(`     ~ ${difRRFallback.length} campo(s) em mes(es) de FALLBACK do json mudaram — ESPERADO (é a correção).`);
      console.log(`       meses com DRIFT medidos NESTE run: ${[...mesesDrift].sort().join(", ") || "(nenhum)"}`);
      for (const d of difRRFallback) console.log(`        · ${d}`);
    }
    if (proc) {
      console.log(`  PROCEDÊNCIA da TRP (controle positivo, ${proc.nLinhas} linha(s) ADS): ` +
        `json sem trp_version_id ${proc.jsonSemVersao ? "✓" : "✗"} | db com trp_version_id ${proc.dbComVersao ? "✓" : "✗"}`);
      if (!proc.ok) {
        console.log("     !! a assimetria de procedência SUMIU. Os campos trp_version_id/trp_fallback");
        console.log("        são excluídos do diff por DEVEREM diferir; se pararem de diferir, a");
        console.log("        exclusão virou cegueira e o db pode ter perdido a versão da régua.");
        falhas++;
      }
    }
    console.log(`  DRIFT no motor: json=${rrJ.drifts.length + adsJ.drifts.length + orqJ.drifts.length}  db=${rrD.drifts.length + adsD.drifts.length + orqD.drifts.length}`);

    if (c.ancoras) {
      const tj = orqJ.out.totals, td = orqD.out.totals;
      const okRR = Math.abs(tj.repasse_credito_rr - ANCORA_RR.valor) < 0.005 && Math.abs(td.repasse_credito_rr - ANCORA_RR.valor) < 0.005;
      const okADS = Math.abs(tj.repasse_credito_ads - ANCORA_ADS) < 0.005 && Math.abs(td.repasse_credito_ads - ANCORA_ADS) < 0.005;
      console.log(`  ÂNCORA RR  crédito jun: json=${H.brl(tj.repasse_credito_rr)}  db=${H.brl(td.repasse_credito_rr)}  (esperado ${H.brl(ANCORA_RR.valor)}) ${okRR ? "✓" : "✗"}`);
      console.log(`  ÂNCORA ADS crédito jun: json=${H.brl(tj.repasse_credito_ads)}  db=${H.brl(td.repasse_credito_ads)}  (esperado ${H.brl(ANCORA_ADS)}) ${okADS ? "✓" : "✗"}`);
      if (!okRR) {
        // As duas fontes darem o MESMO numero e a prova de que a frente (json x db)
        // segue no-op: nesse caso o suspeito e a ANCORA, nao o codigo. Dizer qual
        // dos dois e o suspeito e o que separa ancora vencida de divergencia viva.
        const mesmaCoisa = Math.abs(tj.repasse_credito_rr - td.repasse_credito_rr) < 0.005;
        const dias = Math.floor((Date.now() - Date.parse(ANCORA_RR.cravadaEm + "T00:00:00Z")) / 86400000);
        console.log(`     A ÂNCORA tem ${dias} dia(s) — cravada em ${ANCORA_RR.cravadaEm}`);
        console.log(`     procedência: ${ANCORA_RR.procedencia}`);
        console.log(`     escopo cravado: ${JSON.stringify(ANCORA_RR.escopo)}`);
        if (mesmaCoisa) {
          console.log("     => json e db dão o MESMO valor: a frente segue no-op. Suspeita de");
          console.log("        ÂNCORA VENCIDA (régua mudou), não de divergência de fonte. Quem");
          console.log("        recravar escreve valor, data, procedência e o que mudou — aqui, no código.");
        } else {
          console.log("     => json e db DIVERGEM: isto é divergência VIVA de fonte, não âncora vencida.");
        }
      }
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
