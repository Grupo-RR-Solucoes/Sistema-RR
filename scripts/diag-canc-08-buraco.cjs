/* READ-ONLY. (d) os 2 itens de 41,53 e (e) o retroativo: casados x com debito lancado. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
const norm=v=>String(v??"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toUpperCase();
const md=(m,k)=>{ if(!m) return undefined; for(const [kk,vv] of Object.entries(m)) if(norm(kk)===norm(k)) return vv; return undefined; };
async function inChunks(tab,col,sel,vals){const out=[];for(let i=0;i<vals.length;i+=200){const{data,error}=await sb.from(tab).select(sel).in(col,vals.slice(i,i+200));if(error)throw new Error(error.message);out.push(...data);}return out;}
(async()=>{
  console.log("=== (d) OS DOIS ITENS DE R$ 41,53 — busca AMPLA pelo numero ===");
  for (const op of ["209867885","209621970"]) {
    console.log(`\n  operacao ${op}:`);
    const { data: mce } = await sb.from("monthly_closing_entries").select("year,month,entry_type,sheet_name,j_key,company_id,commission_value,metadata").or(`operation_number.eq.${op},contract_number.eq.${op}`);
    console.log(`    monthly_closing_entries (operation/contract): ${(mce||[]).length} linha(s)`);
    for (const e of (mce||[])) console.log(`       ${e.year}-${String(e.month).padStart(2,"0")} ${e.entry_type}/${e.sheet_name} j_key=${e.j_key} valor=${f(e.commission_value)}`);
    const { data: d } = await sb.from("daily_production_records").select("company_id,j_key,assigned_promoter_id").eq("proposal_number",op);
    console.log(`    daily_production_records: ${(d||[]).length}`);
    const { data: c } = await sb.from("cms_promoter_entries").select("j_key,promoter_id").eq("contract_number",op);
    console.log(`    cms_promoter_entries: ${(c||[]).length}`);
    const { data: prt } = await sb.from("bbts_prt_parcelas").select("competencia").eq("proposal_number",op);
    console.log(`    bbts_prt_parcelas: ${(prt||[]).length}`);
  }

  console.log("\n\n=== (e) RETROATIVO: casados x com debito ja lancado ===");
  const src = await pageAll(()=> sb.from("promoter_debit_sources").select("operation, estorno_amount, source_kind"));
  const comDebito = new Set(src.map(r=>String(r.operation)));
  console.log(`  operacoes com debito lancado (promoter_debit_sources): ${comDebito.size}`);
  const { data: jk } = await sb.from("j_keys").select("j_key, promoter_id, key_type");
  const jkMap=new Map((jk||[]).map(k=>[String(k.j_key).toUpperCase(),k]));

  let casados=0, casComDeb=0, casSemDeb=0, vSemDeb=0;
  const buraco=[];
  for (const [y,m] of [[2026,1],[2026,2],[2026,3],[2026,4],[2026,5],[2026,6],[2026,7]]) {
    const seg = await pageAll(()=> sb.from("monthly_closing_entries").select("commission_value, metadata").eq("year",y).eq("month",m).eq("entry_type","INSURANCE").eq("sheet_name","Seguro"));
    const canc=[...new Map(seg.filter(e=>norm(md(e.metadata,"STATUS"))==="CANCELADO").map(e=>[String(md(e.metadata,"OPERACAO")),e])).values()];
    if (!canc.length) continue;
    const ops=canc.map(e=>String(md(e.metadata,"OPERACAO")));
    const prt = await pageAll(()=> sb.from("monthly_closing_entries").select("j_key, metadata").eq("year",y).eq("month",m).eq("entry_type","PRT"));
    const prtByOp=new Map(); for(const e of prt){const o=String(md(e.metadata,"NRO OPERACAO")??"");const c=String(md(e.metadata,"CHAVE J")??e.j_key??"");if(o&&c&&!prtByOp.has(o))prtByOp.set(o,c);}
    const cms = await inChunks("cms_promoter_entries","contract_number","contract_number, j_key, promoter_id", ops);
    const cmsByOp=new Map(); for(const e of cms) if(!cmsByOp.has(String(e.contract_number))) cmsByOp.set(String(e.contract_number),e);
    const daily = await inChunks("daily_production_records","proposal_number","proposal_number, j_key, assigned_promoter_id", ops);
    const dByOp=new Map(); for(const e of daily) if(!dByOp.has(String(e.proposal_number))) dByOp.set(String(e.proposal_number),e);
    for (const e of canc) {
      const op=String(md(e.metadata,"OPERACAO"));
      const est=Math.abs(n(md(e.metadata,"COMISSAO")??e.commission_value));
      let cj=prtByOp.get(op) ?? cmsByOp.get(op)?.j_key ?? dByOp.get(op)?.j_key ?? null;
      const info=cj?jkMap.get(String(cj).toUpperCase()):undefined;
      let pid = (info&&info.key_type==="INDIVIDUAL") ? info.promoter_id : (dByOp.get(op)?.assigned_promoter_id ?? cmsByOp.get(op)?.promoter_id ?? null);
      if (!pid) continue;
      casados++;
      if (comDebito.has(op)) casComDeb++;
      else { casSemDeb++; vSemDeb+=est; buraco.push({op,est,comp:`${y}-${String(m).padStart(2,"0")}`}); }
    }
  }
  console.log(`\n  cancelamentos CASADOS (com dono derivavel) : ${casados}`);
  console.log(`     ja tem debito lancado                   : ${casComDeb}`);
  console.log(`     SEM debito lancado                      : ${casSemDeb}  ->  ${f(vSemDeb)}`);
  console.log("\n  -- os 12 maiores do buraco --");
  for (const b of buraco.sort((a,c)=>c.est-a.est).slice(0,12)) console.log(`     ${b.comp} | ${b.op} | ${f(b.est)}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
