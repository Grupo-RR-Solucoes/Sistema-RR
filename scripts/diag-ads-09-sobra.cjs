/* READ-ONLY. Atras dos R$ 139,97 que sobram do buraco do Diego. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(build){const all=[];for(let x=0;;x+=1000){const{data,error}=await build().range(x,x+999);if(error)throw new Error(error.message);all.push(...data);if(data.length<1000)break;}return all;}

(async()=>{
  const d = await pageAll(()=> sb.from("daily_production_records").select("*").eq("company_id", ADS));
  const jul = d.filter(r=> r.movement_date && String(r.movement_date).slice(0,7)==="2026-07");
  console.log("linhas ADS movement 2026-07: " + jul.length);
  let t={avista:0,seg:0,segv:0,segnet:0,taxa:0,gross:0,net:0,icomm:0,pcomm:0};
  for(const r of jul){ t.avista+=n(r.bbts_pag_avista); t.seg+=n(r.bbts_seguro_pago); t.segv+=n(r.insurance_value); t.segnet+=n(r.insurance_net_value); t.taxa+=n(r.bbts_taxa_relatorio); t.gross+=n(r.gross_value); t.net+=n(r.net_value); t.icomm+=n(r.insurance_commission_amount); t.pcomm+=n(r.promoter_commission_amount); }
  console.log("\ncampo | soma julho");
  for(const [k,v] of Object.entries(t)) console.log(`${k} | ${f(v)}`);

  console.log("\n=== a linha seguro_only e as 'undefined' ===");
  for(const r of jul){
    const fo = r.raw_payload && r.raw_payload.__bbts_meta ? r.raw_payload.__bbts_meta.fonte : "(sem __bbts_meta)";
    if (fo !== "fechamento_pdf") console.log(`${r.proposal_number} | fonte=${fo} | avista=${f(r.bbts_pag_avista)} | seg_pago=${f(r.bbts_seguro_pago)} | ins_value=${f(r.insurance_value)} | ins_comm=${f(r.insurance_commission_amount)} | mov=${r.movement_date}`);
  }

  console.log("\n=== combinacoes que dariam 139,97 ===");
  const alvo = 139.97;
  const cand = [];
  for(const r of jul){ for (const c of ["bbts_pag_avista","bbts_seguro_pago","insurance_value","insurance_net_value","insurance_commission_amount","bbts_taxa_relatorio"]) { if (Math.abs(n(r[c])-alvo) < 0.005) cand.push(`${r.proposal_number}.${c} = ${f(r[c])}`); } }
  console.log(cand.length ? cand.join("\n") : "(nenhuma celula unica vale 139,97)");

  console.log("\n=== seguro da ADS: campos alternativos ===");
  console.log("Sigma insurance_value(julho)            = " + f(t.segv));
  console.log("Sigma insurance_commission_amount(julho)= " + f(t.icomm));
  console.log("bbts_seguro_pago + 139,97               = " + f(t.seg+139.97));
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
