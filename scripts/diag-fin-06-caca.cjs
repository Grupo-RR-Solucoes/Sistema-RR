/* READ-ONLY. Onde esta 44.267,14? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const ALVO=44267.14;
(async()=>{
  const { data: comps } = await sb.from("companies").select("id,name,cnpj");
  const porCnpj={}; for(const c of comps) porCnpj[String(c.cnpj).replace(/\D/g,"")]=c.name;
  const { data: fme } = await sb.from("fechamento_mensal_empresa").select("empresa_cnpj, ano, mes, valor_diferido, valor_avista, valor_liquido").order("ano").order("mes");
  console.log("=== Sigma valor_diferido por competencia (todas as empresas) ===");
  const porComp={};
  for (const r of fme){ const k=`${r.ano}-${String(r.mes).padStart(2,"0")}`; porComp[k]=(porComp[k]||0)+n(r.valor_diferido); }
  for (const [k,v] of Object.entries(porComp).sort()) {
    const marca = Math.abs(v-ALVO)<1 ? "   <<<<<< BATE COM 44.267,14" : "";
    if (v>0) console.log(`  ${k} | ${f(v).padStart(14)}${marca}`);
  }
  console.log("\n=== jul/2026 por empresa (a competencia que o card de ago le) ===");
  for (const r of fme.filter(x=>x.ano===2026&&x.mes===7)) console.log(`  ${(porCnpj[String(r.empresa_cnpj).replace(/\D/g,"")]||r.empresa_cnpj).padEnd(26)} | diferido ${f(r.valor_diferido).padStart(12)}`);
  const totJul = fme.filter(x=>x.ano===2026&&x.mes===7).reduce((s,r)=>s+n(r.valor_diferido),0);
  console.log(`  ${"TOTAL RR".padEnd(26)} | diferido ${f(totJul).padStart(12)}  (+ ADS 7,01 = ${f(totJul+7.01)})`);
  console.log(`\n  ALVO procurado = ${f(ALVO)}  -> encontrado em algum lugar? ver marcas acima`);
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
