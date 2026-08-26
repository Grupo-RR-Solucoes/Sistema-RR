require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  const { data: d } = await sb.from("promoter_discounts").select("promoter_id, discount_type, amount, company_id").eq("year",2026).eq("month",7);
  console.log("=== promoter_discounts jul/26: promoter_id preenchido? ===");
  console.log(`  linhas: ${d.length} | com promoter_id: ${d.filter(r=>r.promoter_id).length} | sem: ${d.filter(r=>!r.promoter_id).length}`);
  const tipos={}; for(const r of d) tipos[r.discount_type||"(null)"]=(tipos[r.discount_type||"(null)"]||0)+1;
  console.log("  discount_type: " + JSON.stringify(tipos));

  console.log("\n=== despesas (financial_expenses) de ago/26: por empresa? ===");
  const { data: e } = await sb.from("financial_expenses").select("company_id, scope, amount, description").eq("year",2026).eq("month",8);
  console.log(`  linhas: ${(e||[]).length}`);
  for (const r of (e||[])) console.log(`    company_id=${r.company_id||"NULL"} scope=${r.scope} valor=${f(r.amount)} ${String(r.description||"").slice(0,40)}`);

  console.log("\n=== a coluna 'source' do PMR separa RR de ADS? ===");
  const { data: p } = await sb.from("promoter_monthly_results").select("company_id, source").eq("year",2026).eq("month",7).neq("source","daily");
  const bys={}; for(const r of p) bys[r.source]=(bys[r.source]||0)+1;
  console.log("  " + JSON.stringify(bys));
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
