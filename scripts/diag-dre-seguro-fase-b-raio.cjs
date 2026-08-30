/* BLOCO 1 / FASE B — RAIO DE ALCANCE de recarimbar a data da linha de 89,42.
 * READ-ONLY, nada e escrito. Mede o que a linha carrega para OUTRAS grandezas
 * alem da receita do DRE, e se a competencia de destino esta FECHADA. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const PROM = "2aab7ad3-339c-49ee-8a9c-24b38f0430c6";
const L = (c) => c.repeat(92);

(async () => {
  const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
  const { data: p } = await sb.from("promoters").select("id, name, active").eq("id", PROM);
  console.log(L("="));
  console.log("RAIO DE ALCANCE — o dono da linha e as competencias envolvidas");
  console.log(L("="));
  console.log(`  promotor da linha: ${p && p[0] ? p[0].name : "(nao encontrado)"}`);

  // PMR do promotor em jul e ago (destino e origem)
  const { data: pmr } = await sb.from("promoter_monthly_results")
    .select("company_id, year, month, production_value, proposal_count, insured_production_value, final_commission_value, source")
    .eq("promoter_id", PROM).in("year", [2026]).in("month", [7, 8]);
  console.log("\n  PMR do promotor:");
  console.log("  comp    | empresa | producao      | props | prod segurada | comissao final | source");
  for (const r of pmr || [])
    console.log(`  ${r.year}-${String(r.month).padStart(2, "0")} | ${r.company_id === ADS ? "ADS    " : "outra  "} | ${f(r.production_value).padStart(13)} | ${String(r.proposal_count).padStart(5)} | ${f(r.insured_production_value).padStart(13)} | ${f(r.final_commission_value).padStart(14)} | ${r.source}`);

  // producao da ADS por competencia (janela) — quanto a linha representa
  let daily = [], from = 0;
  for (;;) {
    const { data } = await sb.from("daily_production_records")
      .select("id, gross_value, insurance_value, movement_date, contract_date, proposal_date, assigned_promoter_id")
      .eq("company_id", ADS).range(from, from + 999);
    daily = daily.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const compDe = (x) => {
    const q = getProductionPeriodFromValue(x.movement_date) || getProductionPeriodFromValue(x.contract_date) || getProductionPeriodFromValue(x.proposal_date);
    return q ? getProductionPeriodKey(q.year, q.month) : null;
  };
  const prod = new Map(), n = new Map();
  for (const x of daily) {
    const k = compDe(x);
    if (!k) continue;
    prod.set(k, (prod.get(k) || 0) + (Number(x.gross_value) || 0));
    n.set(k, (n.get(k) || 0) + 1);
  }
  console.log("\n  producao BRUTA da ADS por competencia (janela), hoje:");
  for (const k of [...prod.keys()].sort()) console.log(`    ${k}: ${f(prod.get(k)).padStart(14)}  em ${n.get(k)} linha(s)`);
  console.log("\n  a linha de 89,42 vale gross_value 12.200,00 e insurance_value 89.415,39.");
  console.log(`  se ela sair de 2026-08: producao de agosto cai de ${f(prod.get("2026-08") || 0)} para ${f((prod.get("2026-08") || 0) - 12200)}`);
  console.log(`  se ela entrar em 2026-07: producao de julho sobe de ${f(prod.get("2026-07") || 0)} para ${f((prod.get("2026-07") || 0) + 12200)}`);

  // a competencia de destino esta FECHADA?
  const { data: pmrJul } = await sb.from("promoter_monthly_results").select("source").eq("year", 2026).eq("month", 7).limit(2000);
  const { data: pmrAgo } = await sb.from("promoter_monthly_results").select("source").eq("year", 2026).eq("month", 8).limit(2000);
  const conta = (rows) => { const m = new Map(); for (const r of rows || []) m.set(r.source, (m.get(r.source) || 0) + 1); return [...m].map(([k, v]) => `${k}x${v}`).join(", ") || "(zero linhas)"; };
  console.log(`\n  PMR de 2026-07 (destino): ${conta(pmrJul)}`);
  console.log(`  PMR de 2026-08 (origem):  ${conta(pmrAgo)}`);
  console.log("  => se 2026-07 tem PMR consolidado, ela e mes FECHADO e ja foi paga.");
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
