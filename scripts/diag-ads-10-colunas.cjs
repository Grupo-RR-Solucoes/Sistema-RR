/* READ-ONLY. Item 9: TODAS as colunas de fechamento_mensal_empresa em julho/2026. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const USADAS_CAIXA = new Set(["valor_liquido","valor_avista","valor_diferido","valor_seguro","valor_estorno","valor_renovacao","valor_consorcio","valor_bbcap","valor_conta_corrente","valor_dental","valor_lob","valor_credito"]);

(async()=>{
  const { data, error } = await sb.from("fechamento_mensal_empresa").select("*").eq("ano",2026).eq("mes",7);
  if (error) throw new Error(error.message);
  console.log("colunas: " + Object.keys(data[0]).join(", ") + "\n");
  console.log(JSON.stringify(data, null, 2));

  console.log("\n=== colunas NUMERICAS e se o caixa as soma ===");
  const cols = Object.keys(data[0]);
  console.log("coluna | soma julho (4 empresas) | o caixa soma?");
  for (const c of cols) {
    const vals = data.map(r=>r[c]);
    const numerica = vals.every(v => v===null || typeof v === "number");
    if (!numerica) continue;
    const s = vals.reduce((a,v)=>a+n(v),0);
    console.log(`${c} | ${f(s)} | ${USADAS_CAIXA.has(c) ? "SIM" : "NAO"}`);
  }
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
