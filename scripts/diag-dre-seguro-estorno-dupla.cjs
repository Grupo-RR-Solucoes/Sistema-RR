/* BLOCO 1 / FASE A-bis (3) — READ-ONLY. A DUPLA CONTAGEM, no lugar exato onde
 * ela aconteceria: o DRE ja abate o estorno da COMISSAO da ADS (dre.ts:556,
 * alocado por promoter_discounts.company_id). Se passar a abater tambem da
 * RECEITA, o mesmo 49,45 entra duas vezes. Nada e escrito. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

(async () => {
  // (a) as 3 parcelas carregam company_id da ADS?
  const { data: disc } = await sb
    .from("promoter_discounts")
    .select("promoter_id, company_id, year, month, amount, apply_to_company, status")
    .eq("discount_type", "CANCELAMENTO_SEGURO").eq("year", 2026).eq("month", 7);
  const { data: proms } = await sb.from("promoters").select("id, name");
  const nome = new Map((proms || []).map((p) => [p.id, p.name]));
  console.log("as parcelas de CANCELAMENTO_SEGURO de 2026-07 e o CNPJ que cada uma carrega:");
  console.log("promotor                       | valor | company_id do DESCONTO           | e a ADS?");
  let somaAds = 0;
  for (const d of disc || []) {
    const ehAds = d.company_id === ADS;
    if (ehAds && d.apply_to_company !== true) somaAds += Number(d.amount) || 0;
    console.log(`${String(nome.get(d.promoter_id) || "?").slice(0, 30).padEnd(30)} | ${f(d.amount).padStart(5)} | ${String(d.company_id).padEnd(32)} | ${ehAds ? "SIM" : "nao"}`);
  }
  console.log(`\n  Sigma com company_id = ADS: R$ ${f(somaAds)}`);
  console.log("  (dre.ts:556 aloca o desconto por promoter_discounts.company_id, NAO pelo");
  console.log("   CNPJ representativo do PMR — entao os 49,45 reduzem a comissao da ADS.)");

  // (b) o DRE real: comissao da ADS COM e SEM as 3 parcelas
  const { buildDre } = require("../lib/dre.ts");
  const dre = await buildDre(sb);
  const ads = (dre.companies || []).find((c) => c.companyId === ADS || c.id === ADS);
  console.log(`\ncompetencia montada pelo DRE: ${dre.period ? dre.period.key : "?"}`);
  if (ads) {
    console.log("\nlinha da ADS no DRE de hoje:");
    console.log(`  receita   ${f(ads.receita).padStart(12)}`);
    console.log(`  comissoes ${f(ads.comissoes).padStart(12)}   <- JA liquido dos 49,45`);
    console.log(`  despesas  ${f(ads.despesas).padStart(12)}`);
    console.log(`  resultado ${f(ads.resultadoLiquido).padStart(12)}`);
    console.log("\nse o DRE passar a abater o estorno TAMBEM da receita:");
    console.log(`  receita   ${f(Number(ads.receita) - 49.45).padStart(12)}   (-49,45)`);
    console.log(`  comissoes ${f(ads.comissoes).padStart(12)}   (inalterada: JA tinha abatido)`);
    console.log(`  resultado ${f(Number(ads.resultadoLiquido) - 49.45).padStart(12)}`);
    console.log("\n  A conta so fecha se UM dos dois lados parar de abater.");
    console.log("");
    console.log("  (chaves da linha da ADS: " + Object.keys(ads).join(", ") + ")");
    const r2 = await sb.from("promoter_monthly_results").select("final_commission_value").eq("company_id", ADS).eq("year", 2026).eq("month", 7);
    const bruta = (r2.data || []).reduce((a, r) => a + (Number(r.final_commission_value) || 0), 0);
    console.log("  CONTRAPROVA da comissao da ADS em 2026-07:");
    console.log("    Sigma final_commission_value (bruta) .... " + f(bruta));
    console.log("    menos o estorno ja abatido ............. -" + f(somaAds));
    console.log("    = " + f(bruta - somaAds) + "  x  exibida pelo DRE: " + f(ads.comissoes));
    console.log("    bate? " + (Math.abs((bruta - somaAds) - Number(ads.comissoes)) < 0.005));
  } else {
    console.log("\n(a ADS nao veio como linha do DRE nesta competencia — chaves disponiveis:)");
    for (const c of dre.companies || []) console.log("   ", c.companyId || c.id, c.name, "receita", f(c.receita), "comissoes", f(c.comissoes));
  }
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
