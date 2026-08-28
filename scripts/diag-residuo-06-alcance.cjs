/* READ-ONLY. (a) competencias que tem linha de fechamento BBTS; (b) a JANELA de
   competencia da linha so-seguro; (c) quem le bbts_seguro_pago. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
  const { data, error } = await sb
    .from("daily_production_records")
    .select("movement_date, bbts_seguro_pago, bbts_pag_avista, insurance_value, raw_payload->__bbts_meta->>fonte")
    .eq("company_id", ADS);
  if (error) throw error;
  console.log(`linhas da ADS: ${data.length}`);
  const m = new Map();
  for (const r of data) {
    const k = String(r.movement_date || "sem-data").slice(0, 7);
    let b = m.get(k);
    if (!b) { b = { n: 0, fech: 0, so: 0, pagoNull: 0, segPago: 0, avista: 0 }; m.set(k, b); }
    b.n++;
    if (r.fonte === "fechamento_pdf") b.fech++;
    if (r.fonte === "fechamento_pdf_seguro_only") b.so++;
    if (r.bbts_seguro_pago === null) b.pagoNull++;
    b.segPago += Number(r.bbts_seguro_pago) || 0;
    b.avista += Number(r.bbts_pag_avista) || 0;
  }
  console.log("\nmes(mov)   n  fonte=fechamento_pdf  fonte=seguro_only  bbts_seguro_pago NULL  Σ bbts_seguro_pago  Σ bbts_pag_avista");
  for (const [k, b] of [...m].sort())
    console.log(`${k}  ${String(b.n).padStart(4)}   ${String(b.fech).padStart(4)}                 ${String(b.so).padStart(3)}                ${String(b.pagoNull).padStart(4)}                 ${f(b.segPago).padStart(12)}      ${f(b.avista).padStart(12)}`);

  // (b) a JANELA
  const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
  for (const d of ["2026-06-30", "2026-07-31", "2026-07-30", "2026-08-01"]) {
    const p = getProductionPeriodFromValue(d);
    console.log(`\ngetProductionPeriodFromValue(${d}) -> ${p ? getProductionPeriodKey(p.year, p.month) : "null"}`);
  }
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
