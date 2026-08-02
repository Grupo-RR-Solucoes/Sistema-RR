/*
 * PROVA before/after do fix candidate-list de categoria (lib/motor.ts).
 *
 * Dump READ-ONLY: para TODO contrato do daily (RR E ADS/BBTS), grava o pct que
 * o MOTOR resolve (calcularOperacao, provider db) em DUAS construcoes de op:
 *   - "gate":  a mesma do gate de paridade (colunas product/convenio) — Faixa 3;
 *   - "route": a mesma de deriveCompanyReceivedPercentFromMotor (raw_payload
 *              Produto/Codigo Convenio, o caminho vivo do PMR aberto);
 * e nas 5 FAIXAS de producao (a faixa real do route varia por empresa/mes —
 * cobrindo as 5, a prova nao depende dela).
 *
 * Uso: TRP_SOURCE=db node scripts/dump_candidate_list_motor.cjs <saida.json>
 * Rodar 2x — no codigo PRE-fix e POS-fix — e diffar os JSONs:
 *   - contratos com pct != 0 no PRE nao podem mudar (o fix so tira zero indevido);
 *   - os unicos deltas permitidos sao 0 -> pct (a classe "motor commitava numa
 *     categoria e desistia"; era rotulada min-ticket no gate, ERRADO — era categoria).
 */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const { buildTrpCreditProvider } = require("../lib/trp/creditTrpProvider.ts");
const { calcularOperacao, competenciaDaDataContrato, inferCreditTable } = require("../lib/motor.ts");
const { getPrazoTrp } = require("../lib/prazoTrp.ts");
const { readRawPayloadValue } = require("../lib/proposalDetailing.ts");

const PROD_FAIXA3 = 5_000_000; // Faixa 3, o tier contratual do grupo RR (igual ao gate)
// Um production_value representativo de cada faixa (limiares de BAND_THRESHOLDS).
const PROD_POR_FAIXA = [500_000, 1_500_000, 5_000_000, 10_000_000, 25_000_000];

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function fetchAll(table, sel) {
  let from = 0, out = [];
  for (;;) {
    const { data, error } = await sb.from(table).select(sel).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  const outPath = process.argv[2];
  if (!outPath) { console.error("uso: node dump_candidate_list_motor.cjs <saida.json>"); process.exit(3); }

  const dpr = await fetchAll(
    "daily_production_records",
    "id, company_id, assigned_promoter_id, product_description, product_code, interest_rate, term_months, installments, contract_date, movement_date, proposal_date, net_value, gross_value, insurance_value, has_insurance, company_received_percent, convenio_code, convenio_type, convenio_segment, insurance_type, raw_payload"
  );
  // TODO contrato com data+net (RR e ADS): o motor e chamado nos dois pipelines.
  const rr = dpr.filter(
    (r) =>
      r.contract_date &&
      Number(r.net_value) > 0
  );

  const comps = [...new Set(rr.map((r) => competenciaDaDataContrato(String(r.contract_date).slice(0, 10)))
    .filter(Boolean))].sort();
  const providerMotor = await buildTrpCreditProvider(comps.map((c) => c + "-15"));

  const out = {};
  for (const r of rr) {
    const rec = {
      product_description: r.product_description,
      product_code: r.product_code,
      interest_rate: r.interest_rate,
      term_months: r.term_months,
      installments: r.installments,
      contract_date: r.contract_date,
      raw_payload: r.raw_payload,
    };
    const prazo = getPrazoTrp(rec) ?? Math.trunc(Number(r.term_months || r.installments || 0));

    // op "gate": colunas (a mesma construcao do gate de paridade).
    const opGate = (prod) => ({
      valor_liquido: Number(r.net_value),
      valor_bruto: Number(r.gross_value || r.net_value),
      valor_seguro: 0,
      taxa_juros: Number(r.interest_rate),
      prazo,
      tem_seguro: false,
      product_description: r.product_description,
      product_code: r.product_code,
      convenio_code: r.convenio_code,
      company_cash_percent: null,
      production_value: prod,
      contract_date: r.contract_date,
      movement_date: r.movement_date,
      proposal_date: r.proposal_date,
    });

    // op "route": raw_payload primeiro (deriveCompanyReceivedPercentFromMotor).
    const rawProductCode = readRawPayloadValue(r, ["Produto", "Codigo Produto"]);
    const rawConvenioCode = readRawPayloadValue(r, ["Codigo Convenio", "Codigo do Convenio", "Cod Convenio", "Convenio"]);
    const rawConvenioType = readRawPayloadValue(r, ["Tipo Convenio", "Tipo de Convenio"]);
    const rawConvenioSegment = readRawPayloadValue(r, ["Segmento Convenio", "Convenio Segmento"]);
    const opRoute = (prod) => ({
      valor_liquido: Number(r.net_value),
      valor_bruto: Number(r.gross_value || 0),
      valor_seguro: Number(r.insurance_value || 0),
      taxa_juros: Number(r.interest_rate),
      prazo,
      tem_seguro: Number(r.insurance_value || 0) > 0 || Boolean(r.has_insurance),
      product_description: r.product_description,
      product_code:
        typeof rawProductCode === "string" || typeof rawProductCode === "number"
          ? rawProductCode : r.product_code,
      convenio_code:
        typeof rawConvenioCode === "string" || typeof rawConvenioCode === "number"
          ? rawConvenioCode : r.convenio_code,
      convenio_type: typeof rawConvenioType === "string" ? rawConvenioType : r.convenio_type,
      convenio_segment:
        typeof rawConvenioSegment === "string" || typeof rawConvenioSegment === "number"
          ? rawConvenioSegment : r.convenio_segment,
      insurance_type: r.insurance_type,
      production_value: prod,
      contract_date: r.contract_date,
      movement_date: r.movement_date,
      proposal_date: r.proposal_date,
    });

    const pctGate = PROD_POR_FAIXA.map((prod) =>
      Number(calcularOperacao(opGate(prod), { trpProvider: providerMotor }).credito.percentual));
    const pctRoute = PROD_POR_FAIXA.map((prod) =>
      Number(calcularOperacao(opRoute(prod), { trpProvider: providerMotor }).credito.percentual));
    const resF3 = calcularOperacao(opGate(PROD_FAIXA3), { trpProvider: providerMotor });

    out[r.id] = {
      comp: competenciaDaDataContrato(String(r.contract_date).slice(0, 10)),
      tableKey: inferCreditTable(opGate(PROD_FAIXA3)),
      pct: pctGate[2], // Faixa 3 (compat com o diff: a classe medida do gate)
      pctGate,
      pctRoute,
      avista: +Number(resF3.credito.avista_empresa).toFixed(2),
      diferido: +Number(resF3.credito.diferido).toFixed(2),
      net: Number(r.net_value),
      produto: r.product_description,
      taxa: Number(r.interest_rate),
      prazoTrp: getPrazoTrp(rec),
      promoterId: r.assigned_promoter_id,
      companyPct: r.company_received_percent,
      companyId: r.company_id,
    };
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`dump: ${Object.keys(out).length} contratos (RR+ADS, 2 ops x 5 faixas) -> ${outPath}`);
}

main().catch((e) => { console.error("ERRO:", (e && e.message) || e); process.exit(3); });
