/* READ-ONLY. O que mais anda junto se movement_date da linha 5240028e for de
   2026-07-31 p/ 2026-07-15. A linha nao carrega so os 89,42. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const ALVO = "5240028e-464b-428a-870d-86576c31dfc6";

(async () => {
  const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
  const { data, error } = await sb
    .from("daily_production_records")
    .select("id, proposal_number, movement_date, contract_date, proposal_date, status, gross_value, net_value, insurance_value, bbts_pag_avista, bbts_seguro_pago, assigned_promoter_id")
    .eq("company_id", ADS);
  if (error) throw error;

  const agrega = (mov) => {
    const m = new Map();
    for (const r of data) {
      const d = r.id === ALVO && mov ? mov : r.movement_date;
      const p = getProductionPeriodFromValue(d) || getProductionPeriodFromValue(r.contract_date) || getProductionPeriodFromValue(r.proposal_date);
      if (!p) continue;
      const k = getProductionPeriodKey(p.year, p.month);
      let b = m.get(k);
      if (!b) { b = { n: 0, gross: 0, ins: 0, avista: 0, seg: 0 }; m.set(k, b); }
      b.n++; b.gross += Number(r.gross_value) || 0; b.ins += Number(r.insurance_value) || 0;
      b.avista += Number(r.bbts_pag_avista) || 0; b.seg += Number(r.bbts_seguro_pago) || 0;
    }
    return m;
  };
  const antes = agrega(null);
  const depois = agrega("2026-07-15");
  console.log("PRODUCAO DA ADS POR JANELA — antes (mov=31/07) x depois (mov=15/07)\n");
  console.log("comp     |  n   gross_value    insurance_value   bbts_pag_avista  bbts_seguro_pago");
  for (const k of [...new Set([...antes.keys(), ...depois.keys()])].sort()) {
    const a = antes.get(k) || { n: 0, gross: 0, ins: 0, avista: 0, seg: 0 };
    const d = depois.get(k) || { n: 0, gross: 0, ins: 0, avista: 0, seg: 0 };
    console.log(`${k} A| ${String(a.n).padStart(3)} ${f(a.gross).padStart(14)} ${f(a.ins).padStart(17)} ${f(a.avista).padStart(16)} ${f(a.seg).padStart(16)}`);
    console.log(`${k} D| ${String(d.n).padStart(3)} ${f(d.gross).padStart(14)} ${f(d.ins).padStart(17)} ${f(d.avista).padStart(16)} ${f(d.seg).padStart(16)}   <-- com bbts_seguro_pago=89,42 tambem`);
  }

  // o promotor da linha e o PMR de julho dele
  const alvo = data.find((r) => r.id === ALVO);
  console.log(`\nlinha alvo: prop=${alvo.proposal_number} status=${alvo.status} gross=${f(alvo.gross_value)} insurance_value=${f(alvo.insurance_value)} promotor=${alvo.assigned_promoter_id}`);
  const { data: prom } = await sb.from("promoters").select("id, name").eq("id", alvo.assigned_promoter_id);
  console.log(`promotor: ${prom && prom[0] ? prom[0].name : "(nao encontrado)"}`);
  const { data: pmr } = await sb
    .from("promoter_monthly_results")
    .select("year, month, source, company_id, total_production, final_commission_value")
    .eq("promoter_id", alvo.assigned_promoter_id)
    .gte("year", 2026)
    .order("month");
  console.log("\nPMR do promotor:");
  for (const r of pmr || []) console.log(`  ${r.year}-${String(r.month).padStart(2, "0")} source=${String(r.source).padEnd(11)} company=${r.company_id === ADS ? "ADS" : "RR "} producao=${f(r.total_production).padStart(14)} comissao=${f(r.final_commission_value).padStart(12)}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
