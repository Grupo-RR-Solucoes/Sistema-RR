/* READ-ONLY. O PDF de SEGURO da ADS de julho foi importado? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}

(async()=>{
  const d = await pageAll(()=> sb.from("daily_production_records").select("*").eq("company_id", ADS));
  const comp = r => { const p=getProductionPeriodFromValue(r.movement_date)||getProductionPeriodFromValue(r.contract_date)||getProductionPeriodFromValue(r.proposal_date); return p?getProductionPeriodKey(p.year,p.month):null; };

  for (const K of ["2026-06","2026-07"]) {
    const rows = d.filter(r=>comp(r)===K);
    const meta = r => (r.raw_payload && r.raw_payload.__bbts_meta) || {};
    const so = rows.filter(r=>meta(r).fonte==="fechamento_pdf_seguro_only");
    const comSegBase = rows.filter(r=>n(meta(r).seguro_base)>0 || n(r.insurance_value)>0);
    const comSegPago = rows.filter(r=>n(r.bbts_seguro_pago)>0);
    const comSegTipo = rows.filter(r=>meta(r).seguro_tipo);
    console.log(`\n########## ADS ${K} — ${rows.length} linhas ##########`);
    console.log(`linhas 'fechamento_pdf_seguro_only' (SO nascem do PDF de seguro) : ${so.length}`);
    console.log(`linhas com seguro_base/insurance_value > 0                       : ${comSegBase.length}`);
    console.log(`linhas com bbts_seguro_pago > 0                                  : ${comSegPago.length}`);
    console.log(`linhas com __bbts_meta.seguro_tipo preenchido                    : ${comSegTipo.length}`);
    console.log(`Sigma insurance_value (base segurada)                            : ${f(rows.reduce((s,r)=>s+n(r.insurance_value),0))}`);
    console.log(`Sigma bbts_seguro_pago (o que a BBTS pagou de seguro)            : ${f(rows.reduce((s,r)=>s+n(r.bbts_seguro_pago),0))}`);
    console.log(`Sigma insurance_commission_amount (comissao calculada)           : ${f(rows.reduce((s,r)=>s+n(r.insurance_commission_amount),0))}`);
    console.log(`has_insurance = true                                             : ${rows.filter(r=>r.has_insurance).length}`);
    if (comSegPago.length) { console.log("  -- linhas com seguro pago --"); for(const r of comSegPago) console.log(`     ${r.proposal_number} | pago=${f(r.bbts_seguro_pago)} | base=${f(r.insurance_value)} | tipo=${meta(r).seguro_tipo} | fonte=${meta(r).fonte}`); }
    if (so.length) { console.log("  -- linhas seguro_only --"); for(const r of so) console.log(`     ${r.proposal_number} | base=${f(r.insurance_value)} | pago=${f(r.bbts_seguro_pago)} | tipo=${meta(r).seguro_tipo} | mov=${r.movement_date}`); }
  }
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
