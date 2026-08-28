/* READ-ONLY. Estado APOS o UPDATE do R$ 89,42, e o alcance do estorno nao abatido. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

(async () => {
  console.log("=== (a) a linha 5240028e agora ===");
  const { data: l } = await sb.from("daily_production_records").select("id, proposal_number, movement_date, bbts_seguro_pago, updated_at").eq("id", "5240028e-464b-428a-870d-86576c31dfc6");
  console.log("  " + JSON.stringify(l && l[0]));

  console.log("\n=== (b) predicado do UPDATE: ainda sobra alguma? ===");
  const { data: p } = await sb.from("daily_production_records").select("id").eq("company_id", ADS)
    .filter("raw_payload->__bbts_meta->>fonte", "eq", "fechamento_pdf_seguro_only").is("bbts_seguro_pago", null);
  console.log(`  linhas ainda NULL: ${p ? p.length : 0}  (esperado 0)`);

  console.log("\n=== (c) receitaAds por JANELA, agora (o que o DRE calcula) ===");
  const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
  const { data: rows } = await sb.from("daily_production_records").select("bbts_pag_avista, bbts_seguro_pago, movement_date, contract_date, proposal_date").eq("company_id", ADS);
  const { data: prt } = await sb.from("bbts_prt_parcelas").select("valor_parcela, competencia").eq("company_id", ADS);
  const m = new Map();
  for (const r of rows) {
    const pp = getProductionPeriodFromValue(r.movement_date) || getProductionPeriodFromValue(r.contract_date) || getProductionPeriodFromValue(r.proposal_date);
    if (!pp) continue;
    const k = getProductionPeriodKey(pp.year, pp.month);
    let b = m.get(k); if (!b) { b = { avista: 0, seg: 0, prt: 0 }; m.set(k, b); }
    b.avista += Number(r.bbts_pag_avista) || 0; b.seg += Number(r.bbts_seguro_pago) || 0;
  }
  for (const r of prt || []) { const k = String(r.competencia || "").slice(0, 7); if (m.has(k)) m.get(k).prt += Number(r.valor_parcela) || 0; else m.set(k, { avista: 0, seg: 0, prt: Number(r.valor_parcela) || 0 }); }
  console.log("  comp      avista        seguro(BRUTO)     PRT       receitaAds");
  for (const [k, b] of [...m].sort()) console.log(`  ${k}  ${f(b.avista).padStart(12)} ${f(b.seg).padStart(14)} ${f(b.prt).padStart(10)} ${f(b.avista + b.seg + b.prt).padStart(14)}`);

  console.log("\n=== (d) ITEM 3 — alcance do estorno NAO abatido, por competencia ===");
  const { data: deb } = await sb.from("promoter_debits").select("debit_type, start_year, start_month, total_amount, status, kind").eq("company_id", ADS).eq("debit_type", "CANCELAMENTO_SEGURO");
  const est = new Map();
  for (const r of deb || []) { const k = `${r.start_year}-${String(r.start_month).padStart(2, "0")}`; est.set(k, (est.get(k) || 0) + (Number(r.total_amount) || 0)); }
  console.log("  comp      seguro BRUTO no DRE   estorno em promoter_debits   liquido real   inflacao");
  let totInfl = 0;
  for (const [k, b] of [...m].sort()) {
    const e = est.get(k) || 0; totInfl += e;
    console.log(`  ${k}  ${f(b.seg).padStart(18)} ${f(e).padStart(26)} ${f(b.seg - e).padStart(14)} ${f(e).padStart(10)}${e > 0 ? "   <<<" : ""}`);
  }
  console.log(`\n  >>> inflacao TOTAL do seguro exibido (soma dos estornos nao abatidos): ${f(totInfl)}`);
  console.log(`  >>> status dos estornos: ${[...new Set((deb || []).map((r) => r.status))].join(", ")}  (ACTIVE = ainda nao descontado do promotor)`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
