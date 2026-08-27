/* READ-ONLY. Taxa de casamento: quantos cancelamentos historicos achariam dono? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
const norm=v=>String(v??"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toUpperCase();
const md=(m,k)=>{ if(!m) return undefined; for(const [kk,vv] of Object.entries(m)) if(norm(kk)===norm(k)) return vv; return undefined; };
(async()=>{
  // universo: TODA linha de seguro CANCELADO no fechamento (RR), qualquer competencia
  const seg = await pageAll(()=> sb.from("monthly_closing_entries")
    .select("id, company_id, year, month, commission_value, metadata, j_key")
    .eq("entry_type","INSURANCE").eq("sheet_name","Seguro"));
  const canc = seg.filter(e=> norm(md(e.metadata,"STATUS"))==="CANCELADO");
  console.log(`=== universo RR: linhas INSURANCE/Seguro = ${seg.length} | CANCELADO = ${canc.length} ===`);
  const dedup=[...new Map(canc.map(e=>[String(md(e.metadata,"OPERACAO")??md(e.metadata,"OPERAÇÃO")), e])).values()];
  console.log(`  operacoes distintas: ${dedup.length} | Sigma estorno ${f(dedup.reduce((s,e)=>s+Math.abs(n(md(e.metadata,"COMISSAO")??md(e.metadata,"COMISSÃO")??e.commission_value)),0))}`);

  const ops=dedup.map(e=>String(md(e.metadata,"OPERACAO")??md(e.metadata,"OPERAÇÃO")));
  // mapas da cascata ATUAL
  const prt = await pageAll(()=> sb.from("monthly_closing_entries").select("j_key, metadata").eq("entry_type","PRT"));
  const prtByOp=new Map(); for(const e of prt){ const o=String(md(e.metadata,"NRO OPERACAO")??md(e.metadata,"NRO OPERAÇÃO")??""); const c=String(md(e.metadata,"CHAVE J")??e.j_key??""); if(o&&c&&!prtByOp.has(o)) prtByOp.set(o,c); }
  const cms = await pageAll(()=> sb.from("cms_promoter_entries").select("contract_number, j_key, promoter_id"));
  const cmsByOp=new Map(); for(const e of cms) if(!cmsByOp.has(String(e.contract_number))) cmsByOp.set(String(e.contract_number), e);
  const daily = await pageAll(()=> sb.from("daily_production_records").select("proposal_number, j_key, assigned_promoter_id"));
  const dByOp=new Map(); for(const e of daily) if(!dByOp.has(String(e.proposal_number))) dByOp.set(String(e.proposal_number), e);
  const { data: jk } = await sb.from("j_keys").select("j_key, promoter_id, key_type");
  const jkMap=new Map((jk||[]).map(k=>[String(k.j_key).toUpperCase(),k]));

  let atual=0, comCms=0, semNada=0;
  const detalhe={atualPRT:0, atualIndiv:0, atualDaily:0, novoCms:0};
  let vAtual=0, vNovo=0, vSem=0;
  for (const e of dedup) {
    const op=String(md(e.metadata,"OPERACAO")??md(e.metadata,"OPERAÇÃO"));
    const est=Math.abs(n(md(e.metadata,"COMISSAO")??md(e.metadata,"COMISSÃO")??e.commission_value));
    let cj=null;
    if (prtByOp.has(op)) cj=prtByOp.get(op);
    else if (cmsByOp.get(op)?.j_key) cj=cmsByOp.get(op).j_key;
    else if (dByOp.get(op)?.j_key) cj=dByOp.get(op).j_key;
    const info = cj?jkMap.get(String(cj).toUpperCase()):undefined;
    let pid=null;
    if (info && info.key_type==="INDIVIDUAL") { pid=info.promoter_id; detalhe.atualIndiv++; }
    else if (dByOp.get(op)?.assigned_promoter_id) { pid=dByOp.get(op).assigned_promoter_id; detalhe.atualDaily++; }
    if (pid) { atual++; vAtual+=est; continue; }
    // PROPOSTA: usar cms.promoter_id, que ja esta preenchido e o resolvedor ignora
    if (cmsByOp.get(op)?.promoter_id) { comCms++; vNovo+=est; detalhe.novoCms++; continue; }
    semNada++; vSem+=est;
  }
  const tot=dedup.length;
  console.log(`\n=== CASAMENTO (RR, seguro cancelado) ===`);
  console.log(`  cascata ATUAL resolve      : ${atual}/${tot} (${(atual/tot*100).toFixed(1)}%)  ${f(vAtual)}`);
  console.log(`     via j_key INDIVIDUAL    : ${detalhe.atualIndiv}`);
  console.log(`     via daily.assigned      : ${detalhe.atualDaily}`);
  console.log(`  +cms.promoter_id resolveria: ${comCms}/${tot} (${(comCms/tot*100).toFixed(1)}%)  ${f(vNovo)}   <-- HOJE IGNORADO`);
  console.log(`  ficaria SEM dono           : ${semNada}/${tot} (${(semNada/tot*100).toFixed(1)}%)  ${f(vSem)}`);
  console.log(`  TAXA com o conserto        : ${((atual+comCms)/tot*100).toFixed(1)}%`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
