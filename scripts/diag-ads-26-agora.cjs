/* READ-ONLY. Estado ATUAL da ADS jul/26 apos a reimportacao de hoje. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  console.log("=== daily_imports com .pdf, mais recentes ===");
  const { data: di } = await sb.from("daily_imports").select("*").ilike("file_name","%.pdf%").order("created_at",{ascending:false}).limit(5);
  for (const r of di) console.log(`${String(r.created_at).slice(0,19)} | ${r.file_name} | ${r.rows_count} linhas | ${r.status}`);

  const d = await pageAll(()=> sb.from("daily_production_records").select("*").eq("company_id", ADS));
  const comp = r => { const p=getProductionPeriodFromValue(r.movement_date)||getProductionPeriodFromValue(r.contract_date)||getProductionPeriodFromValue(r.proposal_date); return p?getProductionPeriodKey(p.year,p.month):null; };
  const jul = d.filter(r=>comp(r)==="2026-07");
  console.log(`\n=== ADS competencia 2026-07: ${jul.length} linhas ===`);
  console.log("Sigma bbts_pag_avista  : " + f(jul.reduce((s,r)=>s+n(r.bbts_pag_avista),0)));
  console.log("Sigma bbts_seguro_pago : " + f(jul.reduce((s,r)=>s+n(r.bbts_seguro_pago),0)));
  const prt = await pageAll(()=> sb.from("bbts_prt_parcelas").select("valor_parcela").eq("company_id",ADS).eq("competencia","2026-07-01"));
  console.log("Sigma PRT              : " + f(prt.reduce((s,r)=>s+n(r.valor_parcela),0)));

  console.log("\n=== a linha seguro_only 221262790 AGORA ===");
  const so = d.find(r=>String(r.proposal_number)==="221262790");
  if (so) {
    const m = (so.raw_payload&&so.raw_payload.__bbts_meta)||{};
    console.log(`competencia=${comp(so)} | movement_date=${so.movement_date} | bbts_seguro_pago(COLUNA)=${f(so.bbts_seguro_pago)} | raw_payload.seguro_valor_relatorio=${f(m.seguro_valor_relatorio)} | fonte=${m.fonte}`);
  } else console.log("(nao encontrada)");

  console.log("\n=== PMR da ADS ===");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results").select("year,month,source,production_value,insurance_commission_value,final_commission_value,discount_value,calculated_at").eq("company_id",ADS));
  const g={}; for(const r of pmr){const k=`${r.year}-${String(r.month).padStart(2,"0")} src=${r.source}`; const b=g[k]||(g[k]={n:0,p:0,cs:0,cf:0,dv:0,c:new Set()}); b.n++; b.p+=n(r.production_value); b.cs+=n(r.insurance_commission_value); b.cf+=n(r.final_commission_value); b.dv+=n(r.discount_value); b.c.add(String(r.calculated_at).slice(0,16));}
  console.log("competencia | linhas | producao | com_seguro | com_final | descontos | calculated_at");
  for(const [k,b] of Object.entries(g).sort()) console.log(`${k} | ${b.n} | ${f(b.p)} | ${f(b.cs)} | ${f(b.cf)} | ${f(b.dv)} | ${[...b.c].sort().join(" ; ")}`);
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
