/* READ-ONLY. As duas telas concordam? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const { buildPromoterAnalytics } = require("../lib/promoterAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f=v=>(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  console.log("=== TELA 1: matriz do /financeiro, caixa ago/26 (le competencia jul) ===");
  const fin = await buildFinancialAnalytics(sb,{year:2026,month:8});
  const saida = fin.detalhamento.saida;
  const ads = saida.linhas.find(l=>l.chave===ADS);
  console.log(`  linha ADS: descontos = ${f(ads?.celulas?.descontos)} | total = ${f(ads?.total)}`);
  console.log(`  coluna Descontos (todas as empresas) = ${f(saida.totaisColuna.descontos)}`);
  console.log(`  conferencia: matriz ${f(saida.total)} · card ${f(saida.cardTotal)} · delta ${f(saida.delta)}`);

  console.log("\n=== TELA 2: /promotores — BRUNA ALVES, jul/26 ===");
  const { data: proms } = await sb.from("promoters").select("id,name");
  const bruna = proms.find(p=>String(p.name).toUpperCase().includes("BRUNA"));
  const pa = await buildPromoterAnalytics(sb, { year:2026, month:7, promoterId: bruna.id, closed:true, closedSource:"fechamento" });
  const d = pa.discountRows ?? pa.detalhe?.discountRows ?? [];
  console.log(`  promotor: ${bruna.name}`);
  console.log(`  discountRows: ${d.length}`);
  for (const r of d) console.log(`     ${r.discount_type} | ${f(r.amount)} | proposta ${r.proposal_number}`);
  const chaves = Object.keys(pa).filter(k=>/discount|debito|debit/i.test(k));
  console.log(`  chaves do payload com desconto/debito: ${chaves.join(", ") || "(nenhuma no topo)"}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
