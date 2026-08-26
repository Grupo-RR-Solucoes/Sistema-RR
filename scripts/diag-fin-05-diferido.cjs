/* READ-ONLY. diferido_parcelas: tem company_id? entra no Recebido? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: one, error } = await sb.from("diferido_parcelas").select("*").limit(1);
  if (error) { console.log("ERRO: "+error.message); return; }
  console.log("=== diferido_parcelas ===");
  console.log("colunas: " + Object.keys(one[0]||{}).join(", "));
  const all = await pageAll(()=> sb.from("diferido_parcelas").select("*"));
  console.log("total de linhas: " + all.length);
  if (!all.length) { console.log(">>> TABELA VAZIA <<<"); }
  else {
    const cols = Object.keys(all[0]);
    for (const c of cols) {
      const naoNulo = all.filter(r=>r[c]!==null && r[c]!==undefined).length;
      console.log(`  ${c.padEnd(24)} | nao-nulo em ${naoNulo}/${all.length}`);
    }
    const soma = all.reduce((s,r)=>s+n(r.valor),0);
    console.log(`\n  Sigma valor = ${f(soma)}`);
    const st={}; for(const r of all) st[r.status||"(null)"]=(st[r.status||"(null)"]||0)+1;
    console.log("  status: " + JSON.stringify(st));
    console.log("\n  -- 3 linhas cruas --");
    console.log(JSON.stringify(all.slice(0,3), null, 2));
  }
  console.log("\n=== onde diferido_parcelas entra no financialAnalytics? ===");
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
