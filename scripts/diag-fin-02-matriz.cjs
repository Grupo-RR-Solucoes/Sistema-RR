/* READ-ONLY. Decomposicao EMPRESA x PRODUTO do Recebido e das Comissoes pagas (ago/26). */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n=v=>Number(v)||0, r2=v=>Math.round(v*100)/100;
const f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}

(async()=>{
  const M={year:2026,month:8}, P={year:2026,month:7}; // caixa de ago le fechamento de jul
  const { data: comps } = await sb.from("companies").select("id,name,cnpj,active").order("name");
  const porCnpj={}, nome={};
  for (const c of comps) { porCnpj[String(c.cnpj).replace(/\D/g,"")]=c; nome[c.id]=c.name; }

  // ---------- MATRIZ 1: RECEBIDO ----------
  const { data: fme } = await sb.from("fechamento_mensal_empresa").select("*").eq("ano",P.year).eq("mes",P.month);
  const linhas={};
  const put=(emp,col,v)=>{ (linhas[emp]=linhas[emp]||{})[col]=r2((linhas[emp][col]||0)+n(v)); };
  for (const r of fme) {
    const c = porCnpj[String(r.empresa_cnpj).replace(/\D/g,"")];
    const e = c ? c.name : `(CNPJ ${r.empresa_cnpj})`;
    put(e,"credito_avista",r.valor_avista);
    put(e,"prt_diferido",r.valor_diferido);
    put(e,"seguro",r.valor_seguro);
    put(e,"estorno",-n(r.valor_estorno));
    put(e,"renovacao",-n(r.valor_renovacao));
    put(e,"consorcio",r.valor_consorcio); put(e,"bbcap",r.valor_bbcap);
    put(e,"conta_corrente",r.valor_conta_corrente); put(e,"dental",r.valor_dental);
    put(e,"lob",r.valor_lob); put(e,"credito_nota",r.valor_credito);
  }
  // ADS
  const d = await pageAll(()=> sb.from("daily_production_records").select("bbts_pag_avista,bbts_seguro_pago,movement_date,contract_date,proposal_date").eq("company_id",ADS));
  const comp=x=>{const p=getProductionPeriodFromValue(x.movement_date)||getProductionPeriodFromValue(x.contract_date)||getProductionPeriodFromValue(x.proposal_date);return p?getProductionPeriodKey(p.year,p.month):null;};
  const alvo=getProductionPeriodKey(P.year,P.month);
  const jul=d.filter(x=>comp(x)===alvo);
  put(nome[ADS],"credito_avista",jul.reduce((s,x)=>s+n(x.bbts_pag_avista),0));
  put(nome[ADS],"seguro",jul.reduce((s,x)=>s+n(x.bbts_seguro_pago),0));
  const prt = await pageAll(()=> sb.from("bbts_prt_parcelas").select("valor_parcela").eq("company_id",ADS).eq("competencia",`${alvo}-01`));
  put(nome[ADS],"prt_diferido",prt.reduce((s,x)=>s+n(x.valor_parcela),0));
  // manuais: competencia de CAIXA = M (ago), por data_credito
  const man = await pageAll(()=> sb.from("receita_lancamento_manual").select("company_id, valor, data_credito, ano, mes, categoria"));
  for (const r of man) {
    const dc = r.data_credito ? String(r.data_credito).slice(0,7) : (r.ano&&r.mes?`${r.ano}-${String(r.mes).padStart(2,"0")}`:null);
    if (dc !== `${M.year}-${String(M.month).padStart(2,"0")}`) continue;
    put(nome[r.company_id]||"(sem empresa)","manual",r.valor);
  }

  const COLS=["credito_avista","prt_diferido","seguro","estorno","renovacao","consorcio","bbcap","conta_corrente","dental","lob","credito_nota","manual"];
  console.log("=========== MATRIZ 1 — RECEBIDO (caixa ago/26 = fechamento jul/26) ===========\n");
  console.log(["empresa".padEnd(26),...COLS.map(c=>c.padStart(14)),"TOTAL".padStart(14)].join(" |"));
  const totCol={}; let geral=0;
  for (const [e,v] of Object.entries(linhas).sort()) {
    let t=0; const cells=COLS.map(c=>{ const x=n(v[c]); t+=x; totCol[c]=r2((totCol[c]||0)+x); return f(x).padStart(14); });
    geral+=t;
    console.log([e.padEnd(26),...cells,f(t).padStart(14)].join(" |"));
  }
  console.log(["TOTAL".padEnd(26),...COLS.map(c=>f(totCol[c]).padStart(14)),f(geral).padStart(14)].join(" |"));
  const s=(await buildFinancialAnalytics(sb,M)).summary;
  console.log(`\n  card 'Recebido' = ${f(s.receivedNet)}   matriz = ${f(geral)}   delta = ${f(geral-s.receivedNet)}`);

  // ---------- MATRIZ 2: COMISSOES PAGAS ----------
  console.log("\n\n=========== MATRIZ 2 — COMISSOES PAGAS (repasse da competencia jul/26) ===========\n");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results")
    .select("company_id, promoter_id, production_commission_value, insurance_commission_value, bbcap_commission_value, conta_corrente_commission_value, consorcio_commission_value, lob_commission_value, final_commission_value, discount_value, source")
    .eq("year",P.year).eq("month",P.month).neq("source","daily"));
  const PC=["production_commission_value","insurance_commission_value","consorcio_commission_value","bbcap_commission_value","conta_corrente_commission_value","lob_commission_value"];
  const l2={};
  for (const r of pmr) {
    const e = r.company_id ? (nome[r.company_id]||`(id ${String(r.company_id).slice(0,8)})`) : ">>> SEM company_id <<<";
    const b = l2[e]=l2[e]||{};
    for (const c of PC) b[c]=r2((b[c]||0)+n(r[c]));
    b.desconto=r2((b.desconto||0)-n(r.discount_value));
    b.__final=r2((b.__final||0)+n(r.final_commission_value)-n(r.discount_value));
  }
  const C2=[...PC,"desconto"];
  console.log(["empresa".padEnd(26),...C2.map(c=>c.replace("_commission_value","").padStart(14)),"TOTAL".padStart(14)].join(" |"));
  const t2={}; let g2=0;
  for (const [e,v] of Object.entries(l2).sort()) {
    let t=0; const cells=C2.map(c=>{const x=n(v[c]); t+=x; t2[c]=r2((t2[c]||0)+x); return f(x).padStart(14);});
    g2+=t; console.log([e.padEnd(26),...cells,f(t).padStart(14)].join(" |"));
  }
  console.log(["TOTAL".padEnd(26),...C2.map(c=>f(t2[c]).padStart(14)),f(g2).padStart(14)].join(" |"));
  console.log(`\n  card 'Comissoes pagas' = ${f(s.comissoesPagas)}   matriz = ${f(g2)}   delta = ${f(g2-s.comissoesPagas)}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
