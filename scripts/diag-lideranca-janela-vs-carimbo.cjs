/* OUTRA FRENTE — baseLideranca.ts:277 agrupa a ADS pela JANELA (competenciaDe,
 * que le movement_date -> getProductionPeriodFromValue) e nao pelo CARIMBO
 * bbts_competencia_fechamento, gravado desde 30/08. Quanto isso muda, HOJE?
 * READ-ONLY: le o diario da ADS e compara as duas classificacoes linha a linha. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { getProductionPeriodFromValue } = require("@/lib/productionPeriod.ts");
  const competenciaDe = (r) => {
    const p = getProductionPeriodFromValue(r.movement_date) || getProductionPeriodFromValue(r.contract_date) || getProductionPeriodFromValue(r.proposal_date);
    return p ? `${p.year}-${String(p.month).padStart(2, "0")}` : null;
  };

  const { data, error } = await sb.from("daily_production_records")
    .select("proposal_number, movement_date, contract_date, proposal_date, bbts_competencia_fechamento, bbts_pag_avista, bbts_seguro_pago, status, assigned_promoter_id")
    .eq("company_id", ADS).order("proposal_number");
  if (error) { console.log("ERRO:", error.message); process.exit(1); }
  console.log(`linhas da ADS no diario: ${data.length}`);

  const porJanela = {}, porCarimbo = {}, divergentes = [];
  for (const r of data) {
    const jan = competenciaDe(r);
    const car = r.bbts_competencia_fechamento ? String(r.bbts_competencia_fechamento).slice(0, 7) : null;
    const v = (Number(r.bbts_pag_avista) || 0) + (Number(r.bbts_seguro_pago) || 0);
    porJanela[jan] = (porJanela[jan] || 0) + v;
    porCarimbo[car] = (porCarimbo[car] || 0) + v;
    if (jan !== car) divergentes.push({ ...r, jan, car, v });
  }
  console.log("\n  competencia | por JANELA (o que baseLideranca usa hoje) | por CARIMBO (dre.ts/financialAnalytics) | delta");
  for (const k of [...new Set([...Object.keys(porJanela), ...Object.keys(porCarimbo)])].sort()) {
    const a = porJanela[k] || 0, b = porCarimbo[k] || 0;
    console.log(`  ${String(k).padEnd(11)} | ${brl(a).padStart(12)} | ${brl(b).padStart(12)} | ${(b - a === 0 ? "0,00" : brl(b - a)).padStart(11)}`);
  }
  console.log(`\n  linhas em que JANELA != CARIMBO: ${divergentes.length} de ${data.length}`);
  for (const d of divergentes) console.log(`    ${d.proposal_number} mov=${d.movement_date} janela=${d.jan} carimbo=${d.car} valor=${brl(d.v)} status=${d.status}`);
  console.log(`\n  carimbo NULO (a migration nao alcancou): ${data.filter(r => !r.bbts_competencia_fechamento).length} linha(s)`);
})().catch(e => { console.error("EXCECAO:", e.message); process.exit(1); });
