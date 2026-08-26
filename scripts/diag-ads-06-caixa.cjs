/* READ-ONLY. Achado 2, item 6: decomposicao do "Recebido" de ago/26 (caixa). */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});

(async()=>{
  const { data: comps } = await sb.from("companies").select("id,name,cnpj,active").order("name");
  const porCnpj = {}; for (const c of comps) porCnpj[String(c.cnpj).replace(/\D/g,"")] = c;

  // O caixa de ago/26 le o fechamento de M-1 = julho/2026.
  const { data: rows, error } = await sb.from("fechamento_mensal_empresa")
    .select("empresa_cnpj, ano, mes, valor_avista, valor_diferido, valor_seguro, valor_estorno, valor_renovacao, valor_liquido, valor_consorcio, valor_bbcap, valor_conta_corrente, valor_dental, valor_lob, valor_credito")
    .eq("ano",2026).eq("mes",7);
  if (error) throw new Error(error.message);

  console.log("=== fechamento_mensal_empresa ano=2026 mes=7 -> " + rows.length + " linha(s) ===\n");
  let sNet=0, sProd=0, sEmp=0, sSeg=0;
  console.log("empresa | cnpj | valor_liquido | avista | diferido | seguro | estorno | renovacao | PRODUTOS(6) | contrib. RECEBIDO");
  for (const r of rows) {
    const c = porCnpj[String(r.empresa_cnpj).replace(/\D/g,"")];
    const liq = n(r.valor_liquido) || (n(r.valor_avista)+n(r.valor_diferido)+n(r.valor_seguro)-n(r.valor_estorno)-n(r.valor_renovacao));
    const prod = n(r.valor_consorcio)+n(r.valor_bbcap)+n(r.valor_conta_corrente)+n(r.valor_dental)+n(r.valor_lob)+n(r.valor_credito);
    sNet+=liq; sProd+=prod; sEmp+=n(r.valor_avista)+n(r.valor_seguro); sSeg+=n(r.valor_seguro);
    console.log(`${c?c.name:"(CNPJ NAO CADASTRADO)"} | ${r.empresa_cnpj} | ${f(liq)} | ${f(r.valor_avista)} | ${f(r.valor_diferido)} | ${f(r.valor_seguro)} | ${f(r.valor_estorno)} | ${f(r.valor_renovacao)} | ${f(prod)} | ${f(liq+prod)}`);
  }
  console.log(`\nreceivedLiquido (Sigma valor_liquido)      = ${f(sNet)}`);
  console.log(`receivedProdutos (Sigma 6 produtos)        = ${f(sProd)}`);
  console.log(`receivedClosing = liquido + produtos       = ${f(sNet+sProd)}`);

  // manuais com data_credito em ago/2026
  const { data: man, error: e2 } = await sb.from("receitas_manuais").select("*").limit(1);
  if (e2) console.log("\n(receitas_manuais: " + e2.message + ")");
  else console.log("\ncolunas receitas_manuais: " + Object.keys(man[0]||{}).join(", "));

  console.log("\n=== empresas cadastradas (cnpj -> active) ===");
  for (const c of comps) console.log(`${c.name} | ${c.cnpj} | active=${c.active}`);
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
