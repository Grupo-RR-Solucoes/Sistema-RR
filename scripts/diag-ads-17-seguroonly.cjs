/* READ-ONLY. A linha seguro_only: valor pago que NAO vira receita. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f = v => (Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  const { data, error } = await sb.from("daily_production_records")
    .select("proposal_number, movement_date, contract_date, insurance_value, bbts_seguro_pago, has_insurance, promoter_source, assigned_promoter_id, raw_payload")
    .eq("company_id", ADS).eq("proposal_number","221262790");
  if (error) throw new Error(error.message);
  const r = data[0];
  console.log("=== linha seguro_only 221262790 ===");
  console.log(`movement_date            : ${r.movement_date}   (compMovementDate seria 2026-07-15)`);
  console.log(`contract_date            : ${r.contract_date}`);
  console.log(`insurance_value (base)   : ${f(r.insurance_value)}`);
  console.log(`bbts_seguro_pago (COLUNA): ${f(r.bbts_seguro_pago)}   <- lida pela receita do DRE`);
  console.log(`__bbts_meta.seguro_valor_relatorio : ${f(r.raw_payload.__bbts_meta.seguro_valor_relatorio)}   <- o que a BBTS pagou de fato`);
  console.log(`__bbts_meta.seguro_tipo  : ${r.raw_payload.__bbts_meta.seguro_tipo}`);
  console.log(`promoter_source          : ${r.promoter_source}`);
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
