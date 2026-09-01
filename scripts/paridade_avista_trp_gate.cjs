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
 *   (injetar production_value/band no previsto, que hoje fixa Faixa 3) e forcaria
 *   revalidar o forecast inteiro. A resolucao de CATEGORIA, porem, FOI convergida
 *   (candidate-list, vide abaixo) — o risco "2 implementacoes divergem" SE REALIZOU
 *   exatamente na parte nao medida, e o conserto foi convergir.
 *
 * O QUE ESTE GATE GARANTE (invariante dura): pctTabela (previsto) ==
 *   credito.percentual (motor) para TODO contrato RR, nas condicoes reais do RR
 *   daily: getPrazoTrp (Parcelas p/ CONSIGNADO — calculate/monthly:506 ja passa
 *   isso ao motor) + Faixa 3 + provider db. QUALQUER divergencia de pct => FALHA
 *   (exit 2): sinal de que uma implementacao ganhou um fix e a outra nao.
 *
 * FONTE SIMETRICA (correcao desta frente): o lado previsto le o DB DIRETO
 *   (preloader, sem flag); o lado motor honrava TRP_SOURCE do ambiente. Rodado
 *   sem TRP_SOURCE=db, o gate comparava previsto(db) x motor(json) — FONTES
 *   DIFERENTES, violando o proprio invariante ("leem a MESMA fonte"). Era isso
 *   que fabricava os "7 de julho": em json o motor caia no CREDIT_RULES (main
 *   nao tem o JSON da TRP38) e zerava o que o db paga. Este gate agora FORCA
 *   TRP_SOURCE=db nos dois lados (a fonte viva de prod).
 *
 * BUCKET "MOTOR ZERA, PREVISTO PAGA" (baseline 0 — a causa foi CORRIGIDA): o
 *   rotulo anterior ("min-ticket / pergunta de regra pendente") estava ERRADO.
 *   A causa real era RESOLUCAO DE CATEGORIA: o previsto itera a lista ordenada
 *   de categoriasCandidatasFor (ex.: CONSIG_PUBLICO -> CONSIG_PRIVADO ->
 *   CONSIG_GERAL) e tenta a irma quando uma rejeita; o motor commitava em UMA
 *   categoria (inferCreditTable) e desistia -> zerava contratos que a Promotiva
 *   PAGA (realizado abril/2026: "% TABELA OPP = 0,0081" = celula CONSIG_PRIVADO
 *   prazo 18-35, nos 5 contratos que o motor zerava por prazo_min 36 do
 *   CONSIG_PUBLICO). O motor agora usa o MESMO categoriasCandidatasFor
 *   (lib/motor.ts lookupCreditPercentTrp) — convergencia deliberada. Baseline
 *   do bucket = 0 em TODA competencia: qualquer caso novo e um sub-caso novo
 *   (nao a classe antiga) e AVISA (exit 1) para alguem olhar.
 *
 * VIGENCIA PARTIDA (01/09/2026): os DOIS lados resolvem COM a contract_date. O
 *   providerPrev daqui nasceu antes da Fase 1, quando competencia tinha uma
 *   regua so, e descartava a data — o que so ficou visivel quando agosto virou a
 *   primeira competencia partida. Ver a divida 3 em
 *   HANDOFF_TRP_VIGENCIA_INTRA_MES.md: todo provider construido antes de
 *   01/09/2026 esta sob suspeita, e o teste e "ele repassa a contractDate?".
 *
 * Uso: node scripts/paridade_avista_trp_gate.cjs
 * Exit: 0 = paridade ok + bucket motor-zera vazio. 1 = bucket motor-zera nao
 *       vazio (avisa). 2 = DIVERGENCIA DE PCT (regressao real). 3 = erro de infra.
 */
// FONTE SIMETRICA: forca o db ANTES de qualquer require de lib (o previsto ja e
// db-direto; sem isto o motor honraria o TRP_SOURCE do shell e o gate compararia
// fontes diferentes — o artefato que fabricou os "7 de julho").
process.env.TRP_SOURCE = "db";
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

// BASELINE do bucket "motor zera, previsto paga": 0 em TODA competencia. A
// causa da classe antiga ({2026-04:5, 2026-07:7}) foi corrigida: abril era
// resolucao de categoria (motor nao tentava a irma — fix candidate-list em
// lib/motor.ts); julho era artefato de fonte assimetrica (gate rodado sem
// TRP_SOURCE=db — corrigido acima, o gate agora forca db). Qualquer caso novo
// aqui e um sub-caso NOVO e merece aviso.
const MOTOR_ZERA_BASELINE = 0;

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
  // A DATA VAI JUNTO — igual ao provider de PRODUCAO (avistaProducao.ts:208).
  // Sem ela, numa competencia PARTIDA o previsto cai sempre na ULTIMA fatia e o
  // gate acusa uma divergencia que a producao NAO tem. Aconteceu em 01/09/2026,
  // no dia em que agosto virou a primeira competencia partida da historia: 19
  // falsas divergencias, todas de contratos de 31/07-04/08, com o previsto
  // dando TRP39 onde o motor (que recebe a data) dava TRP38. Com a data
  // repassada: 2411/2411 iguais, 0 divergencias.
  const providerPrev = (c, cd) => preloader.getResolvedSync(c, cd ?? null);
  const providerMotor = await buildTrpCreditProvider(comps.map((c) => c + "-15"));

  const porComp = {};
  const pctDivergencias = [];
  const motorZeraPorComp = {};

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
      // Bucket "motor zera, previsto paga" — baseline 0 (a classe antiga era
      // categoria/fonte, corrigida). Caso novo aqui = sub-caso novo, avisa.
      (motorZeraPorComp[comp] = motorZeraPorComp[comp] || []).push({
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

  console.log("\n----- BUCKET MOTOR ZERA, PREVISTO PAGA (baseline 0 — causa antiga corrigida) -----");
  let motorZeraAviso = false;
  for (const comp of comps) {
    const casos = motorZeraPorComp[comp] || [];
    const nota =
      casos.length === MOTOR_ZERA_BASELINE
        ? "== baseline (vazio)"
        : "<<< AVISO: sub-caso NOVO (nao e a classe categoria/fonte, ja corrigida)";
    if (casos.length !== MOTOR_ZERA_BASELINE) motorZeraAviso = true;
    console.log(`  ${comp}: ${casos.length} contrato(s) motor-zera ${nota}`);
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
  if (motorZeraAviso) {
    console.log("  ⚠️  bucket motor-zera NAO vazio — sub-caso novo, revisar (exit 1). NAO e regressao de pct.");
    process.exit(1);
  }
  console.log("  ✅ bucket motor-zera vazio (baseline 0). Nada a fazer.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[gate paridade] ERRO DE INFRA:", (e && e.message) || e);
  process.exit(3);
});
