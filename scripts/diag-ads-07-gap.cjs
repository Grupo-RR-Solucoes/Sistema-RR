/* READ-ONLY. Achado 2: a receita da ADS de julho pela MESMA regua do DRE (dre.ts:314-357). */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(build){const all=[];for(let x=0;;x+=1000){const{data,error}=await build().range(x,x+999);if(error)throw new Error(error.message);all.push(...data);if(data.length<1000)break;}return all;}

(async()=>{
  const daily = await pageAll(()=> sb.from("daily_production_records")
    .select("proposal_number, bbts_pag_avista, bbts_seguro_pago, movement_date, contract_date, proposal_date")
    .eq("company_id", ADS));

  for (const [y,m] of [[2026,6],[2026,7],[2026,8]]) {
    const compKey = getProductionPeriodKey(y,m);
    let avt=0, seg=0, qtd=0;
    for (const r of daily) {
      const p = getProductionPeriodFromValue(r.movement_date) || getProductionPeriodFromValue(r.contract_date) || getProductionPeriodFromValue(r.proposal_date);
      if (!p || getProductionPeriodKey(p.year,p.month) !== compKey) continue;
      qtd++; avt += n(r.bbts_pag_avista); seg += n(r.bbts_seguro_pago);
    }
    const prt = await pageAll(()=> sb.from("bbts_prt_parcelas").select("valor_parcela").eq("company_id",ADS).eq("competencia", `${compKey}-01`));
    const sprt = prt.reduce((s,r)=>s+n(r.valor_parcela),0);
    console.log(`ADS ${compKey}: linhas=${qtd} | AVT(bbts_pag_avista)=${f(avt)} | SEGURO(bbts_seguro_pago)=${f(seg)} | PRT(${prt.length} parc)=${f(sprt)} | TOTAL=${f(avt+seg+sprt)}`);
  }

  console.log("\n=== confronto com o buraco do Diego ===");
  console.log("Diego somou            : 318.736,23");
  console.log("Card /financeiro ago/26: 299.736,82 (medido, item 6)");
  console.log("Diferenca real         : " + f(318736.23 - 299736.82));
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
