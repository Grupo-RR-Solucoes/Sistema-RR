/* READ-ONLY. O PMR da ADS de julho tem seguro zerado? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  const { data, error } = await sb.from("promoter_monthly_results")
    .select("year, month, source, promoter_id, production_value, proposal_count, insured_proposal_count, insured_production_value, insurance_penetration_percent, production_commission_value, insurance_commission_value, final_commission_value, calculated_at")
    .eq("company_id", ADS).in("year",[2026]).in("month",[6,7]).order("month").order("promoter_id");
  if (error) throw new Error(error.message);
  const { data: proms } = await sb.from("promoters").select("id, full_name");
  const nm = Object.fromEntries((proms||[]).map(p=>[p.id,p.full_name]));
  for (const K of [6,7]) {
    const rows = data.filter(r=>r.month===K);
    console.log(`\n########## PMR ADS 2026-${String(K).padStart(2,"0")} — ${rows.length} linhas ##########`);
    console.log("promotor | producao | props | segurad_props | base_segurada | penetr% | com_producao | com_SEGURO | com_final");
    let t={p:0,cs:0,cp:0,cf:0,ip:0,iv:0};
    for (const r of rows) {
      t.p+=n(r.production_value); t.cs+=n(r.insurance_commission_value); t.cp+=n(r.production_commission_value); t.cf+=n(r.final_commission_value); t.ip+=n(r.insured_proposal_count); t.iv+=n(r.insured_production_value);
      console.log(`${(nm[r.promoter_id]||r.promoter_id).slice(0,28)} | ${f(r.production_value)} | ${r.proposal_count} | ${r.insured_proposal_count} | ${f(r.insured_production_value)} | ${n(r.insurance_penetration_percent).toFixed(2)} | ${f(r.production_commission_value)} | ${f(r.insurance_commission_value)} | ${f(r.final_commission_value)}`);
    }
    console.log(`TOTAL | producao=${f(t.p)} | segurad_props=${t.ip} | base_segurada=${f(t.iv)} | com_producao=${f(t.cp)} | com_SEGURO=${f(t.cs)} | com_final=${f(t.cf)}`);
  }
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
