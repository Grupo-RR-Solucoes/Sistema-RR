/* READ-ONLY. O card "Recebido" de ago/26 AGORA, e o que a ADS acrescentaria. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n = v => Number(v)||0, r2 = v => Math.round(v*100)/100;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}

(async()=>{
  // ---- reproduz cashReceivedFor(2026,8) exatamente: M-1 = julho ----
  const { data: rows } = await sb.from("fechamento_mensal_empresa")
    .select("empresa_cnpj, valor_avista, valor_diferido, valor_seguro, valor_estorno, valor_renovacao, valor_liquido, valor_consorcio, valor_bbcap, valor_conta_corrente, valor_dental, valor_lob, valor_credito")
    .eq("ano",2026).eq("mes",7);
  const liq = r2(rows.reduce((s,x)=> s + (n(x.valor_liquido) || n(x.valor_avista)+n(x.valor_diferido)+n(x.valor_seguro)-n(x.valor_estorno)-n(x.valor_renovacao)), 0));
  const prod = r2(rows.reduce((s,x)=> s + n(x.valor_consorcio)+n(x.valor_bbcap)+n(x.valor_conta_corrente)+n(x.valor_dental)+n(x.valor_lob)+n(x.valor_credito), 0));
  const seg  = r2(rows.reduce((s,x)=> s + n(x.valor_seguro), 0));
  const dif  = r2(rows.reduce((s,x)=> s + n(x.valor_diferido), 0));
  const avi  = r2(rows.reduce((s,x)=> s + n(x.valor_avista), 0));
  console.log("=== CARD 'Recebido' ago/26 — AGORA (4 empresas RR) ===");
  console.log(`  receivedLiquido  = ${f(liq)}`);
  console.log(`  receivedProdutos = ${f(prod)}`);
  console.log(`  receivedNet      = ${f(liq+prod)}   <- o que a tela mostra`);
  console.log(`\n  do qual, DENTRO do receivedLiquido:`);
  console.log(`     a-vista  = ${f(avi)}`);
  console.log(`     diferido(PRT) = ${f(dif)}   <- o card NAO e so a-vista`);
  console.log(`     seguro   = ${f(seg)}`);

  // ---- a ADS de julho, do banco ----
  const d = await pageAll(()=> sb.from("daily_production_records")
    .select("bbts_pag_avista, bbts_seguro_pago, movement_date, contract_date, proposal_date, raw_payload").eq("company_id", ADS));
  const comp = x => { const p=getProductionPeriodFromValue(x.movement_date)||getProductionPeriodFromValue(x.contract_date)||getProductionPeriodFromValue(x.proposal_date); return p?getProductionPeriodKey(p.year,p.month):null; };
  const jul = d.filter(x=>comp(x)==="2026-07");
  const avt = r2(jul.reduce((s,x)=>s+n(x.bbts_pag_avista),0));
  const segCol = r2(jul.reduce((s,x)=>s+n(x.bbts_seguro_pago),0));
  const segRaw = r2(jul.reduce((s,x)=>{const m=(x.raw_payload&&x.raw_payload.__bbts_meta)||{}; return s+n(m.seguro_valor_relatorio);},0));
  const prt = await pageAll(()=> sb.from("bbts_prt_parcelas").select("valor_parcela").eq("company_id",ADS).eq("competencia","2026-07-01"));
  const sprt = r2(prt.reduce((s,x)=>s+n(x.valor_parcela),0));

  console.log("\n=== ADS julho, o que EXISTE no banco ===");
  console.log(`  AVT (bbts_pag_avista)                 = ${f(avt)}`);
  console.log(`  PRT (bbts_prt_parcelas)               = ${f(sprt)}`);
  console.log(`  SEGURO coluna (bbts_seguro_pago)      = ${f(segCol)}`);
  console.log(`  SEGURO raw_payload (inclui so-seguro) = ${f(segRaw)}`);
  console.log(`  ABERTURA DE CONTA                     = (nao existe coluna no banco)`);

  console.log("\n=== o que o PDF declara ===");
  console.log("  AVT 18.737,33 + PRT 7,01 + Abertura 100,00 = 18.844,34");
  console.log("  SEGURO (calculo 204,52 + debito -49,45)    =    155,07");
  console.log("  TOTAL                                       = 18.999,41");

  console.log("\n=== CENARIOS PARA O CARD ===");
  const base = r2(liq+prod);
  const c1 = r2(base + avt + sprt + segCol);
  const c2 = r2(base + avt + sprt + segRaw);
  const c3 = r2(base + 18999.41);
  console.log(`  hoje                                            ${f(base)}`);
  console.log(`  + ADS so com o que esta em COLUNA               ${f(c1)}   (delta ${f(c1-base)} = ${((c1-base)/base*100).toFixed(2)}%)`);
  console.log(`  + ADS com seguro do raw_payload (conserta 89,42) ${f(c2)}   (delta ${f(c2-base)} = ${((c2-base)/base*100).toFixed(2)}%)`);
  console.log(`  + ADS com o TOTAL do PDF (precisa Abertura)     ${f(c3)}   (delta ${f(c3-base)} = ${((c3-base)/base*100).toFixed(2)}%)`);
  console.log(`\n  soma a mao do Diego                             318.736,23`);
  console.log(`  falta do cenario 2 para a soma do Diego         ${f(318736.23 - c2)}`);
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
