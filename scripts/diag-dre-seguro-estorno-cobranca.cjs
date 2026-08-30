/* BLOCO 1 / FASE A-bis (2) — READ-ONLY. O desconto e aplicado UMA vez ou UMA POR
 * EMPRESA? MARIA LETICIA tem PMR em DUAS empresas em 2026-07 e o filtro de
 * desconto (promoterAnalytics.ts:1473) nao tem company_id. Medido pelo leitor
 * REAL, nao por replicacao. Nada e escrito. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { buildPromoterAnalytics } = require("../lib/promoterAnalytics.ts");
  const res = await buildPromoterAnalytics(sb, { year: 2026, month: 7 });
  const linhas = res.summaryRows || [];
  console.log("promotores devolvidos pelo leitor real:", linhas.length);
  const alvo = linhas.filter((p) => /MARIA LETICIA|BRUNA/i.test(String(p.promoter_name || p.name || "")));
  console.log("\nnome                           | final      | desconto | payable    | empresa");
  for (const p of alvo) {
    console.log(
      `${String(p.promoter_name || p.name).slice(0, 30).padEnd(30)} | ${f(p.final_commission_value).padStart(10)} | ${f(p.discount_value).padStart(8)} | ${f(p.payable_commission_value).padStart(10)} | ${p.company_id || "-"}`
    );
  }
  const somaDesc = linhas.reduce((a, p) => a + Number(p.discount_value || 0), 0);
  console.log(`\nSigma discount_value de TODOS os promotores em 2026-07: R$ ${f(somaDesc)}`);
  const { data: disc } = await sb
    .from("promoter_discounts")
    .select("amount, apply_to_company, discount_type")
    .eq("year", 2026).eq("month", 7);
  const somaTabela = (disc || []).filter((d) => d.apply_to_company !== true).reduce((a, d) => a + Number(d.amount || 0), 0);
  const somaSeguro = (disc || []).filter((d) => d.apply_to_company !== true && d.discount_type === "CANCELAMENTO_SEGURO").reduce((a, d) => a + Number(d.amount || 0), 0);
  console.log(`Sigma promoter_discounts (apply_to_company != true) em 2026-07: R$ ${f(somaTabela)}`);
  console.log(`  dos quais CANCELAMENTO_SEGURO: R$ ${f(somaSeguro)}`);
  console.log(`\ndelta leitor - tabela: R$ ${f(somaDesc - somaTabela)}  (0,00 = aplicado UMA vez por promotor)`);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
