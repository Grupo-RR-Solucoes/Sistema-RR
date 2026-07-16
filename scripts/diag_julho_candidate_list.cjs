/* Diagnostico READ-ONLY: por que os casos de julho "previsto paga, motor zera"
 * nao sao resolvidos pelo candidate-list? Compara os INPUTS de categoria dos
 * dois lados (produto/tipo/convenio -> candidatos) e o resultado por candidato. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { resolveAvistaTrpDb } = require("../lib/trp/creditAvistaTrp.ts");
const { createTrpRegraDbPreloader } = require("../lib/trp/resolveTrpRegraDb.ts");
const { buildTrpCreditProvider } = require("../lib/trp/creditTrpProvider.ts");
const { calcularOperacao, inferCreditTable } = require("../lib/motor.ts");
const { categoriasCandidatasFor, lookupPctInRegra } = require("../lib/regrasLoader.ts");
const { getPrazoTrp } = require("../lib/prazoTrp.ts");
const { readRawPayloadValue } = require("../lib/proposalDetailing.ts");

const IDS = ["e575eeb2", "5e8e9d51", "de636029", "70cfbc25", "2091fbb9", "1a01aa9e", "dd2a1d8b", "89ca98d1"];

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function main() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("daily_production_records")
      .select("id, product_description, product_code, interest_rate, term_months, installments, contract_date, net_value, gross_value, convenio_code, convenio_type, convenio_segment, raw_payload")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...data);
    if (data.length < 1000) break;
  }
  const rows = all.filter((r) => IDS.some((p) => r.id.startsWith(p)));

  const preloader = createTrpRegraDbPreloader(sb);
  await preloader.preload(["2026-07"]);
  const providerMotor = await buildTrpCreditProvider(["2026-07-15"]);
  const regra = providerMotor("2026-07");

  for (const r of rows) {
    const rec = {
      product_description: r.product_description, product_code: r.product_code,
      interest_rate: r.interest_rate, term_months: r.term_months,
      installments: r.installments, contract_date: r.contract_date, raw_payload: r.raw_payload,
    };
    const prev = resolveAvistaTrpDb(rec, (c) => preloader.getResolvedSync(c));
    const rawConvenio = readRawPayloadValue(r.raw_payload, ["Codigo Convenio", "Cod Convenio", "Convenio"]);
    const op = {
      valor_liquido: Number(r.net_value), valor_bruto: Number(r.gross_value || r.net_value),
      valor_seguro: 0, taxa_juros: Number(r.interest_rate),
      prazo: getPrazoTrp(rec) ?? Math.trunc(Number(r.term_months || r.installments)),
      tem_seguro: false, product_description: r.product_description, product_code: r.product_code,
      convenio_code: r.convenio_code, company_cash_percent: null, production_value: 5_000_000,
      contract_date: r.contract_date,
    };
    const tableKey = inferCreditTable(op);
    const tipo = r.product_description && /RENOV/i.test(r.product_description) ? "RENOVACAO" : "NOVO";
    const candMotor = categoriasCandidatasFor("2026-07", r.product_description, tipo, r.convenio_code ?? null);
    const candPrev = categoriasCandidatasFor("2026-07", r.product_description, tipo,
      rawConvenio != null && String(rawConvenio).trim() !== "" ? Number(String(rawConvenio).trim()) || String(rawConvenio).trim() : null);
    const motorPct = Number(calcularOperacao(op, { trpProvider: providerMotor }).credito.percentual);

    console.log(`\n=== ${r.id.slice(0, 8)} ${r.product_description} net=${r.net_value} taxa=${r.interest_rate} prazoTrp=${getPrazoTrp(rec)} term_months=${r.term_months} installments=${r.installments}`);
    console.log(`  convenio: coluna=${JSON.stringify(r.convenio_code)} raw_payload=${JSON.stringify(rawConvenio)} type=${JSON.stringify(r.convenio_type)} segment=${JSON.stringify(r.convenio_segment)}`);
    console.log(`  tableKey(motor)=${tableKey} | candidatos motor=[${candMotor}] | candidatos previsto=[${candPrev}]`);
    console.log(`  previsto: pct=${prev ? prev.pctTabela : null} categoria=${prev ? prev.categoria : null} tabLabel=${prev ? prev.tabLabel : null}`);
    console.log(`  motor: pct=${motorPct}`);
    if (regra) {
      for (const cand of new Set([...candMotor, ...candPrev])) {
        const taxaDec = Number(r.interest_rate) > 1 ? Number(r.interest_rate) / 100 : Number(r.interest_rate);
        const out = lookupPctInRegra(regra, cand, taxaDec, getPrazoTrp(rec) ?? Math.trunc(Number(r.term_months || r.installments)), "Faixa 3", "db", false);
        console.log(`    lookup[${cand}]: pct=${out.pct} celula=${out.celula}`);
      }
    }
  }
}
main().catch((e) => { console.error("ERRO:", (e && e.message) || e); process.exit(3); });
