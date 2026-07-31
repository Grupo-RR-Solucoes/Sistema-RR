/*
 * DIAG 31/07/2026 — a janela de AGOSTO ja comecou (31/07) mas o seletor da
 * /projecao nao oferece ago/26. Ha producao caindo no bucket errado? READ-ONLY.
 *
 * O QUE MEDE: (1) quantos registros do diario tem movement_date >= 2026-07-31 —
 * pela regra da janela, essa producao e competencia AGOSTO, nao julho; (2) as
 * duas implementacoes de janela lado a lado (trp/vigencia, holiday-aware e
 * inclusiva, x productionPeriod, sem feriado e com fim exclusivo); (3) o
 * mapeamento data -> competencia nas datas-chave da virada.
 *
 * RESULTADO EM 31/07/2026:
 *   - COUNT = 0. Nenhum registro com movement_date >= 2026-07-31; o maior
 *     movement_date do banco e 2026-07-30. Nada para cair no bucket errado, e o
 *     total de julho da tela NAO esta contaminado.
 *   - as duas janelas CONCORDAM:
 *       2026-07: 2026-06-30 .. 2026-07-30 (total 23)  |  .. <2026-07-31
 *       2026-08: 2026-07-31 .. 2026-08-28 (total 21)  |  .. <2026-08-31
 *   - getProductionPeriodFromValue("2026-07-31") -> {2026,8}: CORRETO.
 *     ("2026-07-30" -> julho; "2026-08-31" -> setembro)
 *
 * NAO confundir: a /projecao (via extractYearMonth em promoterAnalytics) usa a
 * regra da JANELA e acerta. Quem usa MES DE CALENDARIO e outro par de leitores —
 * app/api/commissions/proposals/route.ts (getMonthRange) e o monthlyVolumesMap
 * de lib/proposalDetailing.ts (escala/share). Divergencia LATENTE: hoje da no
 * mesmo porque nao existe linha >= 31/07.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { getProductionPeriodFromValue, getProductionWindow } = require("../lib/productionPeriod.ts");
const { productionBusinessWindow } = require("../lib/trp/vigencia.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const brl = n => Number(n).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  // ---- 3) existe registro com movement_date >= 2026-07-31 ?
  const { data, error, count } = await sb
    .from("daily_production_records")
    .select("id, proposal_number, company_id, assigned_promoter_id, status, is_srcc_restricted, net_value, movement_date, contract_date, proposal_date", { count: "exact" })
    .gte("movement_date", "2026-07-31")
    .order("movement_date", { ascending: true });
  if (error) throw error;
  console.log(`=== daily_production_records com movement_date >= 2026-07-31 ===`);
  console.log(`  COUNT = ${count}`);
  console.log(`  SOMA net_value = ${brl((data??[]).reduce((a,r)=>a+Number(r.net_value??0),0))}`);
  const elig = r => { const s=String(r.status??"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toUpperCase(); return (s==="PRODUCAO"||s==="PRODUCTION")&&r.is_srcc_restricted!==true; };
  const el = (data??[]).filter(elig);
  console.log(`  destes, ELEGIVEIS = ${el.length}, soma ${brl(el.reduce((a,r)=>a+Number(r.net_value??0),0))}`);
  for (const r of (data??[]).slice(0,15)) console.log(`    prop ${String(r.proposal_number??"-").padEnd(12)} | ${brl(r.net_value).padStart(12)} | mov ${r.movement_date} | st=${r.status} | comp=${JSON.stringify(getProductionPeriodFromValue(r.movement_date))}`);

  // controle: o maior movement_date do banco
  const mx = await sb.from("daily_production_records").select("movement_date").order("movement_date",{ascending:false}).limit(1);
  console.log(`  maior movement_date no banco = ${mx.data?.[0]?.movement_date}`);

  // ---- as duas implementacoes de janela concordam?
  console.log(`\n=== janelas ===`);
  for (const [y,m] of [[2026,7],[2026,8]]) {
    const w1 = productionBusinessWindow(y,m);
    const w2 = getProductionWindow(y,m);
    console.log(`  ${y}-${String(m).padStart(2,"0")} | trp/vigencia(holiday-aware, inclusivo): ${w1.start.toISOString().slice(0,10)} .. ${w1.end.toISOString().slice(0,10)} total=${w1.total}`);
    console.log(`  ${y}-${String(m).padStart(2,"0")} | productionPeriod(sem feriado, fim exclusivo): ${w2.start} .. <${w2.endExclusive}`);
  }
  console.log(`\n  getProductionPeriodFromValue por data-chave:`);
  for (const d of ["2026-07-29","2026-07-30","2026-07-31","2026-08-03","2026-08-28","2026-08-31"])
    console.log(`    ${d} -> ${JSON.stringify(getProductionPeriodFromValue(d))}`);
})();
