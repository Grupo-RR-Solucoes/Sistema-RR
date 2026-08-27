/* READ-ONLY. Os 14 inativos com detalhe. E procura os universos de 46/100. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
const norm=v=>String(v??"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toUpperCase();
(async()=>{
  const { data: one } = await sb.from("promoters").select("*").limit(1);
  console.log("colunas de promoters: " + Object.keys(one[0]).join(", "));
  console.log("  >>> a coluna e 'active', NAO 'is_active' <<<\n");

  const { data: comps } = await sb.from("companies").select("id,name");
  const nome=Object.fromEntries(comps.map(c=>[c.id,c.name]));
  const proms = await pageAll(()=> sb.from("promoters").select("*"));
  const inat = proms.filter(p=>p.active===false);
  const { data: jk } = await sb.from("j_keys").select("j_key, promoter_id, key_type");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results").select("promoter_id, production_value, year, month").neq("source","daily"));

  console.log(`=== OS ${inat.length} INATIVOS ===`);
  console.log("nome | empresa | dismissed_at | chaves J | competencias com PMR | producao total");
  for (const p of inat.sort((a,b)=>String(a.dismissed_at).localeCompare(String(b.dismissed_at)))) {
    const ks=(jk||[]).filter(k=>k.promoter_id===p.id);
    const rows=pmr.filter(r=>r.promoter_id===p.id);
    const prod=rows.reduce((s,r)=>s+n(r.production_value),0);
    console.log(`  ${String(p.name).slice(0,30).padEnd(30)} | ${(nome[p.company_id]||"-").padEnd(18)} | ${p.dismissed_at} | ${ks.length?ks.map(k=>`${k.j_key}(${k.key_type})`).join(","):"NENHUMA"} | ${rows.length} | ${f(prod)}`);
  }

  console.log("\n=== PROCURA: universo de cancelamentos da ADS ===");
  const dAds = await pageAll(()=> sb.from("daily_production_records").select("proposal_number,status,insurance_value,bbts_seguro_pago,raw_payload,movement_date").eq("company_id",ADS));
  const cancAds = dAds.filter(r=>norm(r.status)==="CANCELADO");
  console.log(`  daily da ADS: ${dAds.length} | status CANCELADO: ${cancAds.length}`);
  const metaCanc = dAds.filter(r=> r.raw_payload?.__bbts_meta?.cancelado === true);
  console.log(`  com __bbts_meta.cancelado=true: ${metaCanc.length}`);
  const debAds = await pageAll(()=> sb.from("promoter_debits").select("*").eq("company_id",ADS));
  console.log(`  promoter_debits da ADS: ${debAds.length} | Sigma ${f(debAds.reduce((s,r)=>s+n(r.total_amount),0))}`);
  console.log(`     >>> a estrutura de debito da ADS EXISTE e esta em uso <<<`);

  console.log("\n=== PROCURA: algum recorte da 46 / 3.006,43 ou 100 / 6.798,42 ? ===");
  const src = await pageAll(()=> sb.from("promoter_debit_sources").select("operation, estorno_amount, source_kind"));
  console.log(`  promoter_debit_sources: ${src.length} | Sigma estorno ${f(src.reduce((s,r)=>s+n(r.estorno_amount),0))}`);
  const deb = await pageAll(()=> sb.from("promoter_debits").select("total_amount, debit_type, kind"));
  const canc2 = deb.filter(r=>r.debit_type==="CANCELAMENTO_SEGURO");
  console.log(`  promoter_debits CANCELAMENTO_SEGURO: ${canc2.length} | Sigma ${f(canc2.reduce((s,r)=>s+n(r.total_amount),0))}`);
  console.log(`  promoter_debits TODOS: ${deb.length} | Sigma ${f(deb.reduce((s,r)=>s+n(r.total_amount),0))}`);
  const disc = await pageAll(()=> sb.from("promoter_discounts").select("amount, discount_type"));
  console.log(`  promoter_discounts TODOS: ${disc.length} | Sigma ${f(disc.reduce((s,r)=>s+n(r.amount),0))}`);
  const dc={}; for(const r of disc){const k=r.discount_type||"(null)"; const b=dc[k]||(dc[k]={n:0,v:0}); b.n++; b.v+=n(r.amount);}
  for (const [k,b] of Object.entries(dc)) console.log(`     ${k}: ${b.n} | ${f(b.v)}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
