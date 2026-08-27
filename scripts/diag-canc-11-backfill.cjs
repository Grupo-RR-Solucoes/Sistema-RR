/* READ-ONLY. Tamanho da desatualizacao, por promotor e competencia. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
const norm=v=>String(v??"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toUpperCase();
const md=(m,k)=>{ if(!m) return undefined; for(const [kk,vv] of Object.entries(m)) if(norm(kk)===norm(k)) return vv; return undefined; };
async function inChunks(tab,col,sel,vals){const out=[];for(let i=0;i<vals.length;i+=200){const{data,error}=await sb.from(tab).select(sel).in(col,vals.slice(i,i+200));if(error)throw new Error(error.message);out.push(...data);}return out;}
(async()=>{
  const { data: proms } = await sb.from("promoters").select("id,name,active,dismissed_at");
  const pm=new Map(proms.map(p=>[p.id,p]));
  const { data: jk } = await sb.from("j_keys").select("j_key, promoter_id, key_type");
  const jkMap=new Map((jk||[]).map(k=>[String(k.j_key).toUpperCase(),k]));
  const src = await pageAll(()=> sb.from("promoter_debit_sources").select("operation"));
  const comDebito=new Set(src.map(r=>String(r.operation)));
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results").select("promoter_id,year,month,source,final_commission_value").neq("source","daily"));
  const pmrKey=(p,y,m)=>`${p}|${y}-${String(m).padStart(2,"0")}`;
  const pmrMap=new Map(); for(const r of pmr) pmrMap.set(pmrKey(r.promoter_id,r.year,r.month), r);

  const falta=[];
  for (const [y,m] of [[2026,1],[2026,2],[2026,3],[2026,4],[2026,5],[2026,6],[2026,7]]) {
    const seg = await pageAll(()=> sb.from("monthly_closing_entries").select("commission_value, metadata").eq("year",y).eq("month",m).eq("entry_type","INSURANCE").eq("sheet_name","Seguro"));
    const canc=[...new Map(seg.filter(e=>norm(md(e.metadata,"STATUS"))==="CANCELADO").map(e=>[String(md(e.metadata,"OPERACAO")),e])).values()];
    if(!canc.length) continue;
    const ops=canc.map(e=>String(md(e.metadata,"OPERACAO")));
    const prt = await pageAll(()=> sb.from("monthly_closing_entries").select("j_key, metadata").eq("year",y).eq("month",m).eq("entry_type","PRT"));
    const prtByOp=new Map(); for(const e of prt){const o=String(md(e.metadata,"NRO OPERACAO")??"");const c=String(md(e.metadata,"CHAVE J")??e.j_key??"");if(o&&c&&!prtByOp.has(o))prtByOp.set(o,c);}
    const cms=await inChunks("cms_promoter_entries","contract_number","contract_number, j_key, promoter_id",ops);
    const cmsByOp=new Map(); for(const e of cms) if(!cmsByOp.has(String(e.contract_number))) cmsByOp.set(String(e.contract_number),e);
    const daily=await inChunks("daily_production_records","proposal_number","proposal_number, j_key, assigned_promoter_id",ops);
    const dByOp=new Map(); for(const e of daily) if(!dByOp.has(String(e.proposal_number))) dByOp.set(String(e.proposal_number),e);
    for (const e of canc) {
      const op=String(md(e.metadata,"OPERACAO"));
      if (comDebito.has(op)) continue;
      const est=Math.abs(n(md(e.metadata,"COMISSAO")??e.commission_value));
      let cj=prtByOp.get(op)??cmsByOp.get(op)?.j_key??dByOp.get(op)?.j_key??null;
      const info=cj?jkMap.get(String(cj).toUpperCase()):undefined;
      const pid=(info&&info.key_type==="INDIVIDUAL")?info.promoter_id:(dByOp.get(op)?.assigned_promoter_id ?? cmsByOp.get(op)?.promoter_id ?? null);
      if(!pid) continue;
      falta.push({op,est,y,m,pid});
    }
  }
  console.log(`=== ${falta.length} cancelamentos com dono e SEM debito | Sigma ${f(falta.reduce((s,r)=>s+r.est,0))} ===`);

  console.log("\n=== por COMPETENCIA (o quanto o sistema mostra A MAIS) ===");
  const gc={};
  for (const r of falta){ const k=`${r.y}-${String(r.m).padStart(2,"0")}`; const b=gc[k]||(gc[k]={n:0,v:0}); b.n++; b.v+=r.est; }
  const pmrPorComp={}; for(const r of pmr){ const k=`${r.year}-${String(r.month).padStart(2,"0")}`; pmrPorComp[k]=(pmrPorComp[k]||0)+n(r.final_commission_value); }
  console.log("comp | casos | desatualizacao | comissao do PMR | % ");
  for (const [k,b] of Object.entries(gc).sort()) {
    const tot=pmrPorComp[k]||0;
    console.log(`  ${k} | ${String(b.n).padStart(3)} | ${f(b.v).padStart(10)} | ${f(tot).padStart(13)} | ${tot?(b.v/tot*100).toFixed(2):"-"}%`);
  }

  console.log("\n=== por PROMOTOR (os 15 maiores) ===");
  const gp={};
  for (const r of falta){ const b=gp[r.pid]||(gp[r.pid]={n:0,v:0,comps:new Set()}); b.n++; b.v+=r.est; b.comps.add(`${r.y}-${String(r.m).padStart(2,"0")}`); }
  const lista=Object.entries(gp).map(([pid,b])=>({pid,...b})).sort((a,b)=>b.v-a.v);
  console.log("promotor | ativo? | casos | desatualizacao | competencias");
  for (const r of lista.slice(0,15)) {
    const p=pm.get(r.pid);
    console.log(`  ${String(p?.name??r.pid).slice(0,28).padEnd(28)} | ${p?.active===false?`INATIVO (${p.dismissed_at})`:"ativo"} | ${String(r.n).padStart(3)} | ${f(r.v).padStart(9)} | ${[...r.comps].sort().join(",")}`);
  }
  const inativos=lista.filter(r=>pm.get(r.pid)?.active===false);
  console.log(`\n  promotores INATIVOS entre os afetados: ${inativos.length} | Sigma ${f(inativos.reduce((s,r)=>s+r.v,0))}`);

  console.log("\n=== RISCO DE DUPLICIDADE: competencias que JA tem CANCELAMENTO_SEGURO ===");
  const disc = await pageAll(()=> sb.from("promoter_discounts").select("year,month,amount,discount_type").eq("discount_type","CANCELAMENTO_SEGURO"));
  const jaTem={}; for(const r of disc){const k=`${r.year}-${String(r.month).padStart(2,"0")}`; const b=jaTem[k]||(jaTem[k]={n:0,v:0}); b.n++; b.v+=n(r.amount);}
  for (const [k,b] of Object.entries(jaTem).sort()) console.log(`  ${k} | ${b.n} linha(s) | ${f(b.v)}  ${gc[k]?">>> TAMBEM tem backfill pendente: cuidado com duplicidade":""}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
