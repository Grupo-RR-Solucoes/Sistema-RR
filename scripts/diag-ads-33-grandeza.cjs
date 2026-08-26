/* READ-ONLY. valor_avista do RR e COMISSAO ou VALOR FINANCIADO? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n = v => Number(v)||0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";

(async()=>{
  const { data: comps } = await sb.from("companies").select("id,name,cnpj,active");
  const rr = comps.filter(c=>c.active);

  console.log("=== RR, julho/2026: o que o card soma x o volume financiado ===");
  const { data: fme } = await sb.from("fechamento_mensal_empresa")
    .select("valor_avista, valor_diferido, valor_seguro, valor_liquido").eq("ano",2026).eq("mes",7);
  const avista = fme.reduce((s,r)=>s+n(r.valor_avista),0);
  const liq = fme.reduce((s,r)=>s+n(r.valor_liquido),0);
  console.log(`  Sigma valor_avista  (o que entra no card) = ${f(avista)}`);
  console.log(`  Sigma valor_liquido (o que entra no card) = ${f(liq)}`);

  // volume financiado do RR em julho: producao do PMR das 4 RR
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results")
    .select("company_id, production_value").eq("year",2026).eq("month",7).neq("source","daily"));
  const prodRR = pmr.filter(r=>rr.some(c=>c.id===r.company_id)).reduce((s,r)=>s+n(r.production_value),0);
  const prodADS = pmr.filter(r=>r.company_id===ADS).reduce((s,r)=>s+n(r.production_value),0);
  console.log(`\n  VOLUME FINANCIADO (producao PMR) RR jul  = ${f(prodRR)}`);
  console.log(`  VOLUME FINANCIADO (producao PMR) ADS jul = ${f(prodADS)}`);
  console.log(`\n  razao valor_avista / volume financiado RR = ${(avista/prodRR*100).toFixed(2)}%   <- se fosse desembolso seria 100%`);

  console.log("\n=== ADS, julho/2026: a mesma razao ===");
  const d = await pageAll(()=> sb.from("daily_production_records").select("gross_value, bbts_pag_avista, movement_date").eq("company_id",ADS));
  const jul = d.filter(r=>String(r.movement_date||"").slice(0,7)==="2026-07");
  const gross = jul.reduce((s,r)=>s+n(r.gross_value),0);
  const avt = jul.reduce((s,r)=>s+n(r.bbts_pag_avista),0);
  console.log(`  Sigma gross_value (valor financiado) = ${f(gross)}`);
  console.log(`  Sigma bbts_pag_avista (pagamento)    = ${f(avt)}`);
  console.log(`  razao pagamento / financiado         = ${(avt/gross*100).toFixed(2)}%`);

  console.log("\n=== CONFRONTO DAS GRANDEZAS ===");
  console.log(`  RR : valor_avista ${f(avista)} sobre financiado ${f(prodRR)}  -> ${(avista/prodRR*100).toFixed(2)}%`);
  console.log(`  ADS: pag_avista   ${f(avt)} sobre financiado ${f(gross)}  -> ${(avt/gross*100).toFixed(2)}%`);
  console.log(`\n  comissoes PAGAS aos promotores em jul (PMR) = ${f(pmr.reduce((s,r)=>s+0,0))} (ver abaixo)`);
  const { data: pg } = await sb.from("promoter_monthly_results").select("final_commission_value, discount_value").eq("year",2026).eq("month",7).neq("source","daily");
  const pago = (pg||[]).reduce((s,r)=>s+n(r.final_commission_value)-n(r.discount_value),0);
  console.log(`  repasse liquido aos promotores jul          = ${f(pago)}`);
  console.log(`  repasse / valor_avista+seguro do card       = ${(pago/(avista+fme.reduce((s,r)=>s+n(r.valor_seguro),0))*100).toFixed(2)}%  <- so faz sentido se o card for COMISSAO`);
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
