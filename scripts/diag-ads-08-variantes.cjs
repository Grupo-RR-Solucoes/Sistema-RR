/* READ-ONLY. Achado 2: variantes de recorte da ADS em julho, atras dos 18.999,41. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const ALVO = 318736.23 - 299736.82; // 18999.41
async function pageAll(build){const all=[];for(let x=0;;x+=1000){const{data,error}=await build().range(x,x+999);if(error)throw new Error(error.message);all.push(...data);if(data.length<1000)break;}return all;}

(async()=>{
  const d = await pageAll(()=> sb.from("daily_production_records")
    .select("proposal_number, bbts_pag_avista, bbts_seguro_pago, bbts_taxa_relatorio, gross_value, insurance_value, movement_date, contract_date, proposal_date, raw_payload")
    .eq("company_id", ADS));

  const janela = r => { const p = getProductionPeriodFromValue(r.movement_date)||getProductionPeriodFromValue(r.contract_date)||getProductionPeriodFromValue(r.proposal_date); return p?getProductionPeriodKey(p.year,p.month):null; };
  const calMov = r => r.movement_date ? String(r.movement_date).slice(0,7) : null;
  const calCtr = r => r.contract_date ? String(r.contract_date).slice(0,7) : null;

  const V = {};
  const soma = (rows, campos) => rows.reduce((s,r)=> s + campos.reduce((a,c)=>a+n(r[c]),0), 0);

  const jw = d.filter(r=>janela(r)==="2026-07");
  const jm = d.filter(r=>calMov(r)==="2026-07");
  const jc = d.filter(r=>calCtr(r)==="2026-07");

  V["JANELA(43) avista+seguro"]            = soma(jw,["bbts_pag_avista","bbts_seguro_pago"]);
  V["JANELA(43) avista"]                    = soma(jw,["bbts_pag_avista"]);
  V["CALEND. movement(46) avista+seguro"]  = soma(jm,["bbts_pag_avista","bbts_seguro_pago"]);
  V["CALEND. movement(46) avista"]          = soma(jm,["bbts_pag_avista"]);
  V["CALEND. contract avista+seguro"]      = soma(jc,["bbts_pag_avista","bbts_seguro_pago"]);
  V["TODAS as 97 linhas avista+seguro"]    = soma(d,["bbts_pag_avista","bbts_seguro_pago"]);

  const prt7 = await pageAll(()=> sb.from("bbts_prt_parcelas").select("valor_parcela, n_parcela, proposal_number").eq("company_id",ADS).eq("competencia","2026-07-01"));
  const sprt = prt7.reduce((s,r)=>s+n(r.valor_parcela),0);
  const prtAll = await pageAll(()=> sb.from("bbts_prt_parcelas").select("valor_parcela, competencia").eq("company_id",ADS));

  console.log("ALVO (318.736,23 - 299.736,82) = " + f(ALVO) + "\n");
  console.log("variante | valor | delta p/ ALVO");
  for (const [k,v] of Object.entries(V)) console.log(`${k} | ${f(v)} | ${f(v-ALVO)}`);
  console.log(`JANELA + PRT julho (regua do DRE) | ${f(V["JANELA(43) avista+seguro"]+sprt)} | ${f(V["JANELA(43) avista+seguro"]+sprt-ALVO)}`);
  console.log(`CALEND.mov + PRT julho            | ${f(V["CALEND. movement(46) avista+seguro"]+sprt)} | ${f(V["CALEND. movement(46) avista+seguro"]+sprt-ALVO)}`);

  console.log("\n=== PRT da ADS por competencia ===");
  const pc={}; for(const r of prtAll){const k=String(r.competencia).slice(0,7); const b=pc[k]||(pc[k]={n:0,v:0}); b.n++; b.v+=n(r.valor_parcela);}
  for(const [k,b] of Object.entries(pc).sort()) console.log(`${k} | ${b.n} parcelas | ${f(b.v)}`);

  console.log("\n=== as 3 linhas que a JANELA tira de julho (movement jul, competencia ago) ===");
  for (const r of jm.filter(r=>janela(r)!=="2026-07")) console.log(`${r.proposal_number} | mov=${r.movement_date} | ctr=${r.contract_date} | janela=${janela(r)} | avista=${f(r.bbts_pag_avista)} | seg=${f(r.bbts_seguro_pago)}`);
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
