/*
 * GATE DE PARIDADE — as DUAS implementacoes do lookup TRP de credito a vista.
 * READ-ONLY (so LE a prod). REGRESSION GUARD: nao muda calculo, so vigia drift.
 *
 * AS DUAS IMPLEMENTACOES (memoria item 30 / Forecast buraco 3):
 *   - creditAvistaTrp (resolveAvistaTrpDb) — o PREVISTO/Recebiveis, chamado so por
 *     lib/recebiveis/avistaProducao.ts. Maquina: extrairContratoAvista ->
 *     getMatrizTRPParaContrato (a MESMA da AUDITORIA) -> pctTabela (cru, pre-teto).
 *   - getCreditPercent (lib/motor.ts) — o MOTOR, o que o PMR usa. Maquina:
 *     inferCreditTable -> lookupCreditPercentTrp -> lookupPctInRegra ->
 *     credito.percentual (cru, pre-teto).
 *   Ambas resolvem a MESMA pergunta ("qual o % de credito da TRP deste contrato")
 *   e leem a MESMA fonte (trp_rule_versions via provider db).
 *
 * POR QUE COEXISTEM (e NAO se convergiu o codigo): o merge teria custo real
 *   (injetar production_value/band no previsto, que hoje fixa Faixa 3), MUDA numero
 *   (dropa/paga os min-ticket abaixo) e forcaria revalidar o forecast inteiro. O
 *   pct JA CONVERGE 100% no dado (medido: jun 660/660, jul 334/334), entao o risco
 *   ("2 implementacoes divergem") nao se realizou. A resposta certa e BLINDAR contra
 *   drift futuro (este gate), nao refatorar.
 *
 * O QUE ESTE GATE GARANTE (invariante dura): pctTabela (previsto) ==
 *   credito.percentual (motor) para TODO contrato RR, nas condicoes reais do RR
 *   daily: getPrazoTrp (Parcelas p/ CONSIGNADO — calculate/monthly:506 ja passa
 *   isso ao motor) + Faixa 3 + provider db. QUALQUER divergencia de pct => FALHA
 *   (exit 2): sinal de que uma implementacao ganhou um fix e a outra nao.
 *
 * DIVERGENCIA DE REGRA CONHECIDA (NAO falha o gate): o motor tem um gate
 *   MIN-TICKET (getMinimumTicket) que zera contratos de ticket pequeno; o previsto
 *   (= a AUDITORIA) NAO tem e paga o pct da tabela. Medido: 7 contratos em julho.
 *   A auditoria/ground-truth NAO zera ticket pequeno -> o min-ticket parece RESIDUO
 *   LEGADO do CREDIT_RULES, nao regra da TRP. E PERGUNTA DE REGRA, decisao pendente
 *   (auditar os 7 vs realizado). Por isso o gate LISTA/CONTA esses casos separado e
 *   NAO reprova por eles (senao nasceria vermelho e ninguem olharia). MAS se o COUNT
 *   subir acima do baseline, AVISA (exit 1) — a classe cresceu, alguem tem que ver.
 *
 * Uso: node scripts/paridade_avista_trp_gate.cjs
 * Exit: 0 = paridade ok + min-ticket no baseline. 1 = min-ticket mudou (avisa).
 *       2 = DIVERGENCIA DE PCT (regressao real). 3 = erro de infra.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");

const { resolveAvistaTrpDb } = require("../lib/trp/creditAvistaTrp.ts");
const { createTrpRegraDbPreloader } = require("../lib/trp/resolveTrpRegraDb.ts");
const { buildTrpCreditProvider } = require("../lib/trp/creditTrpProvider.ts");
const { calcularOperacao, competenciaDaDataContrato } = require("../lib/motor.ts");
const { getPrazoTrp } = require("../lib/prazoTrp.ts");

const BBTS_COMPANY_ID = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const PROD_FAIXA3 = 5_000_000; // forca FAIXA_3 no motor (>= 3M), igual ao Faixa 3 fixo do previsto.
const EPS = 1e-6;

// BASELINE de divergencias min-ticket conhecidas por competencia. Atualizar
// quando a decisao de regra (min-ticket vale sob TRP?) for tomada. Competencia
// sem entrada aqui: reportada, mas nao gera aviso (baseline desconhecido).
const MIN_TICKET_BASELINE = { "2026-04": 5, "2026-07": 7 };

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function fetchAll(table, sel, filt) {
  let from = 0, out = [];
  for (;;) {
    let q = sb.from(table).select(sel);
    for (const [k, v] of Object.entries(filt || {})) q = q.eq(k, v);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

const compDoContrato = (r) => {
  const cd = r.contract_date ? String(r.contract_date).slice(0, 10) : null;
  return cd ? competenciaDaDataContrato(cd) : null;
};

async function main() {
  const dpr = await fetchAll(
    "daily_production_records",
    "id, company_id, product_description, product_code, interest_rate, term_months, installments, contract_date, movement_date, proposal_date, net_value, gross_value, convenio_code, raw_payload"
  );
  // RR (nao ADS), com contract_date + taxa + prazo + net (elegivel ao lookup TRP).
  const rr = dpr.filter(
    (r) =>
      r.company_id !== BBTS_COMPANY_ID &&
      r.contract_date &&
      Number(r.interest_rate) > 0 &&
      (Number(r.term_months) > 0 || Number(r.installments) > 0) &&
      Number(r.net_value) > 0
  );

  // competencias com dado (auto-detect) — o gate acompanha o que existir.
  const comps = [...new Set(rr.map(compDoContrato).filter(Boolean))].sort();
  const preloader = createTrpRegraDbPreloader(sb);
  await preloader.preload(comps);
  const providerPrev = (c) => preloader.getResolvedSync(c);
  const providerMotor = await buildTrpCreditProvider(comps.map((c) => c + "-15"));

  const porComp = {};
  const pctDivergencias = [];
  const minTicketPorComp = {};

  for (const r of rr) {
    const comp = compDoContrato(r);
    porComp[comp] = porComp[comp] || { elegiveis: 0, ambos: 0, iguais: 0 };
    porComp[comp].elegiveis += 1;

    const rec = {
      product_description: r.product_description,
      product_code: r.product_code,
      interest_rate: r.interest_rate,
      term_months: r.term_months,
      installments: r.installments,
      contract_date: r.contract_date,
      raw_payload: r.raw_payload,
    };
    const prev = resolveAvistaTrpDb(rec, providerPrev);

    const op = {
      valor_liquido: Number(r.net_value),
      valor_bruto: Number(r.gross_value || r.net_value),
      valor_seguro: 0,
      taxa_juros: Number(r.interest_rate),
      // CONDICAO REAL do RR daily (calculate/monthly:506): prazo via getPrazoTrp.
      prazo: getPrazoTrp(rec) ?? Math.trunc(Number(r.term_months || r.installments)),
      tem_seguro: false,
      product_description: r.product_description,
      product_code: r.product_code,
      convenio_code: r.convenio_code,
      company_cash_percent: null,
      production_value: PROD_FAIXA3, // isola o LOOKUP (Faixa 3 dos dois lados).
      contract_date: r.contract_date,
      movement_date: r.movement_date,
      proposal_date: r.proposal_date,
    };
    const motorPct = Number(calcularOperacao(op, { trpProvider: providerMotor }).credito.percentual);
    const prevPct = prev ? Number(prev.pctTabela) : null;

    if (prev && motorPct > 0) {
      porComp[comp].ambos += 1;
      if (Math.abs(prevPct - motorPct) < EPS) {
        porComp[comp].iguais += 1;
      } else {
        pctDivergencias.push({
          comp,
          id: r.id.slice(0, 8),
          produto: String(r.product_description || "").slice(0, 30),
          taxa: r.interest_rate,
          prazoTrp: getPrazoTrp(rec),
          prevPct: +prevPct.toFixed(6),
          motorPct: +motorPct.toFixed(6),
        });
      }
    } else if (prev && motorPct === 0) {
      // Divergencia de REGRA conhecida (min-ticket / gate): o previsto paga, o motor zera.
      (minTicketPorComp[comp] = minTicketPorComp[comp] || []).push({
        id: r.id.slice(0, 8),
        produto: String(r.product_description || "").slice(0, 30),
        net: Number(r.net_value),
        prevPct: +prevPct.toFixed(6),
      });
    }
  }

  // ---------- RELATORIO ----------
  console.log("===================== GATE PARIDADE — a-vista TRP (previsto x motor) =====================");
  console.log("competencia | elegiveis | ambos resolvem | pct IGUAL | pct DIFERENTE");
  console.log("-".repeat(78));
  for (const comp of comps) {
    const c = porComp[comp];
    const dif = c.ambos - c.iguais;
    console.log(
      `${comp} | ${String(c.elegiveis).padStart(9)} | ${String(c.ambos).padStart(14)} | ` +
        `${String(c.iguais).padStart(9)} | ${String(dif).padStart(13)}`
    );
  }

  console.log("\n----- DIVERGENCIA DE REGRA CONHECIDA (min-ticket: previsto paga, motor zera) -----");
  let minTicketAviso = false;
  for (const comp of comps) {
    const casos = minTicketPorComp[comp] || [];
    const baseline = MIN_TICKET_BASELINE[comp];
    const nota =
      baseline === undefined
        ? "(sem baseline — competencia nova, so reporta)"
        : casos.length === baseline
          ? "== baseline"
          : `!= baseline (era ${baseline}) <<< AVISO: a classe min-ticket mudou`;
    if (baseline !== undefined && casos.length !== baseline) minTicketAviso = true;
    console.log(`  ${comp}: ${casos.length} contrato(s) min-ticket ${nota}`);
    for (const k of casos.slice(0, 10)) {
      console.log(`      ${k.id} net=${k.net} prevPct=${k.prevPct} (${k.produto})`);
    }
  }

  // ---------- VEREDITO ----------
  console.log("\n===================== VEREDITO =====================");
  if (pctDivergencias.length > 0) {
    console.log(`  ❌ FALHA: ${pctDivergencias.length} divergencia(s) de PCT (regressao real — uma impl mudou):`);
    for (const d of pctDivergencias.slice(0, 20)) {
      console.log(
        `     ${d.comp} ${d.id} ${d.produto} taxa=${d.taxa} prazoTrp=${d.prazoTrp}: ` +
          `previsto ${d.prevPct} x motor ${d.motorPct}`
      );
    }
    process.exit(2);
  }
  const totalAmbos = comps.reduce((a, c) => a + porComp[c].ambos, 0);
  console.log(`  ✅ PARIDADE DE PCT: ${totalAmbos}/${totalAmbos} contratos iguais (0 divergencia).`);
  if (minTicketAviso) {
    console.log("  ⚠️  min-ticket mudou vs baseline — revisar (exit 1). NAO e regressao de pct.");
    process.exit(1);
  }
  console.log("  ✅ min-ticket no baseline conhecido. Nada a fazer.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[gate paridade] ERRO DE INFRA:", (e && e.message) || e);
  process.exit(3);
});
