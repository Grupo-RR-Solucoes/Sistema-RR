/* READ-ONLY. (A) buildDre REAL (o que a rota /api/dre entrega). (B) o bloco da
   ADS do dre.ts replicado, por competencia, ANTES e DEPOIS de gravar
   bbts_seguro_pago=89,42 na linha 5240028e (a so-seguro). Nada e escrito. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const ALVO = "5240028e-464b-428a-870d-86576c31dfc6";

(async () => {
  const { buildDre } = require("../lib/dre.ts");
  const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");

  // (A) DRE real
  const dre = await buildDre(sb);
  console.log("=== (A) buildDre(sb) — o que a rota /api/dre devolve ===");
  console.log(`closed=${dre.closed}  periodo selecionado=${dre.period ? dre.period.key : "null"}`);
  console.log(`meses fechados disponiveis: ${dre.periods.map((p) => p.key).join(", ")}`);
  for (const c of dre.companies || []) {
    const rec = (c.lines || []).find((l) => /receita/i.test(l.label || ""));
    console.log(`  ${c.name}: receita=${rec ? f(rec.value) : "?"}  resultado=${f(c.result ?? c.resultado ?? 0)}`);
  }

  // (B) bloco da ADS replicado
  const { data: rows, error } = await sb
    .from("daily_production_records")
    .select("id, bbts_pag_avista, bbts_seguro_pago, movement_date, contract_date, proposal_date")
    .eq("company_id", ADS);
  if (error) throw error;
  const { data: prt } = await sb.from("bbts_prt_parcelas").select("valor_parcela, competencia").eq("company_id", ADS);

  const calc = (corrige) => {
    const m = new Map();
    for (const r of rows) {
      const p = getProductionPeriodFromValue(r.movement_date) || getProductionPeriodFromValue(r.contract_date) || getProductionPeriodFromValue(r.proposal_date);
      if (!p) continue;
      const k = getProductionPeriodKey(p.year, p.month);
      const seg = corrige && r.id === ALVO ? 89.42 : Number(r.bbts_seguro_pago) || 0;
      m.set(k, (m.get(k) || 0) + (Number(r.bbts_pag_avista) || 0) + seg);
    }
    for (const r of prt || []) {
      const k = String(r.competencia || "").slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(k)) m.set(k, (m.get(k) || 0) + (Number(r.valor_parcela) || 0));
    }
    return m;
  };
  const antes = calc(false), depois = calc(true);
  console.log("\n=== (B) receitaAds do dre.ts, por competencia (JANELA) ===");
  console.log("comp      ANTES          DEPOIS         DELTA");
  for (const k of [...new Set([...antes.keys(), ...depois.keys()])].sort())
    console.log(`${k}  ${f(antes.get(k) || 0).padStart(12)}  ${f(depois.get(k) || 0).padStart(12)}  ${f((depois.get(k) || 0) - (antes.get(k) || 0)).padStart(8)}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
