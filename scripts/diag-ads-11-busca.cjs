/* READ-ONLY. Busca: que combinacao por empresa soma 318.736,23? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const ALVO = 318736.23;

(async()=>{
  const { data: rows } = await sb.from("fechamento_mensal_empresa").select("*").eq("ano",2026).eq("mes",7);
  const { data: comps } = await sb.from("companies").select("id,name,cnpj");
  const porCnpj = {}; for (const c of comps) porCnpj[String(c.cnpj).replace(/\D/g,"")] = c.name;

  // candidatos por empresa RR
  const cand = rows.map(r => {
    const nome = porCnpj[String(r.empresa_cnpj).replace(/\D/g,"")];
    const prod = n(r.valor_consorcio)+n(r.valor_bbcap)+n(r.valor_conta_corrente)+n(r.valor_dental)+n(r.valor_lob)+n(r.valor_credito);
    return { nome, opts: {
      "liquido+produtos (o caixa)": n(r.valor_liquido)+prod,
      "liquido": n(r.valor_liquido),
      "nota_fiscal": n(r.valor_nota_fiscal),
      "nota_fiscal+produtos": n(r.valor_nota_fiscal)+prod,
      "avista+diferido+seguro (bruto, sem estorno)": n(r.valor_avista)+n(r.valor_diferido)+n(r.valor_seguro),
      "avista+diferido+seguro+produtos": n(r.valor_avista)+n(r.valor_diferido)+n(r.valor_seguro)+prod,
      "avista+seguro (receivedEmpresa)": n(r.valor_avista)+n(r.valor_seguro),
    }};
  });

  const ADS_OPTS = { "ZERO (ADS fora)": 0, "DRE: avista+seguro+PRT": 18859.44, "avista+seguro": 18852.43, "avista": 18737.33 };

  console.log("=== candidatos por empresa ===");
  for (const c of cand) { console.log("\n" + c.nome); for (const [k,v] of Object.entries(c.opts)) console.log(`  ${k} = ${f(v)}`); }

  console.log("\n=== busca por combinacao que da " + f(ALVO) + " (tolerancia 0,05) ===");
  const keys = Object.keys(cand[0].opts);
  let achou = 0;
  // caso A: mesma regra para as 4 RR
  for (const k of keys) {
    const soma4 = cand.reduce((s,c)=>s+c.opts[k],0);
    for (const [ka,va] of Object.entries(ADS_OPTS)) {
      const tot = soma4 + va;
      if (Math.abs(tot-ALVO) < 0.05) { achou++; console.log(`ACHOU: RR="${k}" (${f(soma4)}) + ADS="${ka}" (${f(va)}) = ${f(tot)}`); }
    }
  }
  if (!achou) {
    console.log("(nenhuma combinacao uniforme bate)");
    console.log("\ndeltas de cada regra uniforme das 4 RR contra o ALVO:");
    for (const k of keys) { const s = cand.reduce((a,c)=>a+c.opts[k],0); console.log(`  RR="${k}" = ${f(s)}  -> falta ${f(ALVO-s)}`); }
  }
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
