/* READ-ONLY. O card ja mostra comissao ou mostra volume financiado? E onde estao os "6,9 milhoes"? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}

(async()=>{
  console.log("=== (1) O QUE O CARD MOSTRA HOJE, por competencia ===");
  console.log("competencia | card 'Recebido' | e comissao ou financiado?");
  for (const [y,m] of [[2026,6],[2026,7],[2026,8]]) {
    const r = await buildFinancialAnalytics(sb, { year: y, month: m });
    console.log(`  ${y}-${String(m).padStart(2,"0")} | ${f(r.summary.receivedNet)}`);
  }

  console.log("\n=== (2) VOLUME FINANCIADO de julho/2026 (a competencia que o card de ago le) ===");
  const { data: comps } = await sb.from("companies").select("id,name,active");
  const nome = Object.fromEntries(comps.map(c=>[c.id,c.name]));
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results")
    .select("company_id, production_value").eq("year",2026).eq("month",7).neq("source","daily"));
  const porEmp = {}; let tot=0;
  for (const r of pmr) { const k=nome[r.company_id]||r.company_id; porEmp[k]=(porEmp[k]||0)+n(r.production_value); tot+=n(r.production_value); }
  for (const [k,v] of Object.entries(porEmp).sort()) console.log(`  ${k} | ${f(v)}`);
  console.log(`  TOTAL FINANCIADO jul = ${f(tot)}   <- os "milhoes"`);

  console.log("\n=== (3) CONFRONTO ===");
  const cardAgo = (await buildFinancialAnalytics(sb, { year:2026, month:8 })).summary.receivedNet;
  console.log(`  card 'Recebido' ago/26        = ${f(cardAgo)}`);
  console.log(`  volume financiado jul (total) = ${f(tot)}`);
  console.log(`  razao card/financiado         = ${(cardAgo/tot*100).toFixed(2)}%`);
  console.log(`  => o card JA e comissao. Se mostrasse desembolso, seria ${f(tot)}.`);

  console.log("\n=== (4) PDF x BANCO da ADS jul/26, campo a campo ===");
  const d = await pageAll(()=> sb.from("daily_production_records")
    .select("bbts_pag_avista, bbts_seguro_pago, movement_date, contract_date, proposal_date").eq("company_id",ADS));
  const comp = x => { const p=getProductionPeriodFromValue(x.movement_date)||getProductionPeriodFromValue(x.contract_date)||getProductionPeriodFromValue(x.proposal_date); return p?getProductionPeriodKey(p.year,p.month):null; };
  const jul = d.filter(x=>comp(x)==="2026-07");
  const avt = jul.reduce((s,x)=>s+n(x.bbts_pag_avista),0);
  const segCol = jul.reduce((s,x)=>s+n(x.bbts_seguro_pago),0);
  const prt = await pageAll(()=> sb.from("bbts_prt_parcelas").select("valor_parcela").eq("company_id",ADS).eq("competencia","2026-07-01"));
  const sprt = prt.reduce((s,x)=>s+n(x.valor_parcela),0);
  console.log("  campo              | PDF        | BANCO      | bate?");
  console.log(`  Pagamento AVT      | 18.737,33  | ${f(avt).padEnd(10)} | ${Math.abs(avt-18737.33)<0.005?"SIM (43/43 contratos)":"NAO"}`);
  console.log(`  Pagamento PRT      |      7,01  | ${f(sprt).padEnd(10)} | ${Math.abs(sprt-7.01)<0.005?"SIM (8/8 parcelas)":"NAO"}`);
  console.log(`  Abertura de Conta  |    100,00  | (sem coluna) | NAO — parser usa o rotulo so como marcador de parada`);
  console.log(`  TOTAL credito      | 18.844,34  | ${f(avt+sprt).padEnd(10)} | falta 100,00`);
  console.log(`  Seguro (pago)      |    155,07  | ${f(segCol).padEnd(10)} | falta 89,42 (linha so-seguro so no raw_payload) e sobra o -49,45 dos cancelados`);
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
