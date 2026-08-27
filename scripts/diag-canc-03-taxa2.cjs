/* READ-ONLY. Taxa de casamento POR COMPETENCIA, replicando a cascata do resolvedor. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
const norm=v=>String(v??"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toUpperCase();
const md=(m,k)=>{ if(!m) return undefined; for(const [kk,vv] of Object.entries(m)) if(norm(kk)===norm(k)) return vv; return undefined; };
async function inChunks(tab, col, sel, vals){ const out=[]; for(let i=0;i<vals.length;i+=200){ const { data, error } = await sb.from(tab).select(sel).in(col, vals.slice(i,i+200)); if(error) throw new Error(error.message); out.push(...data);} return out; }
(async()=>{
  const { data: jk } = await sb.from("j_keys").select("j_key, promoter_id, key_type");
  const jkMap=new Map((jk||[]).map(k=>[String(k.j_key).toUpperCase(),k]));
  const COMPS=[[2026,1],[2026,2],[2026,3],[2026,4],[2026,5],[2026,6],[2026,7]];
  let T={tot:0,atual:0,cms:0,sem:0,vTot:0,vAtual:0,vCms:0,vSem:0};
  console.log("comp | canceladas | cascata ATUAL | +cms.promoter_id | SEM dono");
  for (const [y,m] of COMPS) {
    const seg = await pageAll(()=> sb.from("monthly_closing_entries").select("id, commission_value, metadata").eq("year",y).eq("month",m).eq("entry_type","INSURANCE").eq("sheet_name","Seguro"));
    const canc=[...new Map(seg.filter(e=>norm(md(e.metadata,"STATUS"))==="CANCELADO").map(e=>[String(md(e.metadata,"OPERACAO")),e])).values()];
    if (!canc.length) { console.log(`  ${y}-${String(m).padStart(2,"0")} | 0`); continue; }
    const ops=canc.map(e=>String(md(e.metadata,"OPERACAO")));
    const prt = await pageAll(()=> sb.from("monthly_closing_entries").select("j_key, metadata").eq("year",y).eq("month",m).eq("entry_type","PRT"));
    const prtByOp=new Map(); for(const e of prt){ const o=String(md(e.metadata,"NRO OPERACAO")??""); const c=String(md(e.metadata,"CHAVE J")??e.j_key??""); if(o&&c&&!prtByOp.has(o)) prtByOp.set(o,c); }
    const cms = await inChunks("cms_promoter_entries","contract_number","contract_number, j_key, promoter_id", ops);
    const cmsByOp=new Map(); for(const e of cms) if(!cmsByOp.has(String(e.contract_number))) cmsByOp.set(String(e.contract_number),e);
    const daily = await inChunks("daily_production_records","proposal_number","proposal_number, j_key, assigned_promoter_id", ops);
    const dByOp=new Map(); for(const e of daily) if(!dByOp.has(String(e.proposal_number))) dByOp.set(String(e.proposal_number),e);

    let a=0,c=0,s=0,va=0,vc=0,vs=0;
    for (const e of canc) {
      const op=String(md(e.metadata,"OPERACAO"));
      const est=Math.abs(n(md(e.metadata,"COMISSAO")??e.commission_value));
      let cj=null;
      if (prtByOp.has(op)) cj=prtByOp.get(op);
      else if (cmsByOp.get(op)?.j_key) cj=cmsByOp.get(op).j_key;
      else if (dByOp.get(op)?.j_key) cj=dByOp.get(op).j_key;
      const info=cj?jkMap.get(String(cj).toUpperCase()):undefined;
      let pid=null;
      if (info && info.key_type==="INDIVIDUAL") pid=info.promoter_id;
      else if (dByOp.get(op)?.assigned_promoter_id) pid=dByOp.get(op).assigned_promoter_id;
      if (pid) { a++; va+=est; }
      else if (cmsByOp.get(op)?.promoter_id) { c++; vc+=est; }
      else { s++; vs+=est; }
    }
    T.tot+=canc.length; T.atual+=a; T.cms+=c; T.sem+=s; T.vAtual+=va; T.vCms+=vc; T.vSem+=vs;
    console.log(`  ${y}-${String(m).padStart(2,"0")} | ${String(canc.length).padStart(4)} | ${String(a).padStart(4)} (${f(va).padStart(9)}) | ${String(c).padStart(4)} (${f(vc).padStart(9)}) | ${String(s).padStart(4)} (${f(vs).padStart(8)})`);
  }
  const t=T.tot;
  console.log(`\n=== TOTAL 2026 (jan-jul) — ${t} operacoes canceladas ===`);
  console.log(`  cascata ATUAL resolve       : ${T.atual}/${t} (${(T.atual/t*100).toFixed(1)}%)  ${f(T.vAtual)}`);
  console.log(`  +cms.promoter_id resolveria : ${T.cms}/${t} (${(T.cms/t*100).toFixed(1)}%)  ${f(T.vCms)}   <-- coluna LIDA e IGNORADA hoje`);
  console.log(`  ficaria SEM dono            : ${T.sem}/${t} (${(T.sem/t*100).toFixed(1)}%)  ${f(T.vSem)}`);
  console.log(`  TAXA com o conserto         : ${((T.atual+T.cms)/t*100).toFixed(1)}%`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
