/* READ-ONLY. Alcance do defeito do BLOCO 2: linhas SO-SEGURO da ADS/BBTS que
   ficaram com bbts_seguro_pago vazio/zero, por competencia. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { data, error } = await sb
    .from("daily_production_records")
    .select("id, proposal_number, movement_date, contract_date, proposal_date, product_description, insurance_value, insurance_net_value, bbts_seguro_pago, bbts_pag_avista, raw_payload")
    .eq("product_description", "SEGURO (sem credito no mes)")
    .order("movement_date", { ascending: true });
  if (error) throw error;

  console.log(`LINHAS product_description='SEGURO (sem credito no mes)': ${data.length}\n`);
  const porComp = new Map();
  for (const r of data) {
    const comp = String(r.movement_date || "").slice(0, 7);
    let b = porComp.get(comp);
    if (!b) { b = { n: 0, insurance: 0, pago: 0, relatorio: 0, pagoNulo: 0, linhas: [] }; porComp.set(comp, b); }
    const rel = Number(r.raw_payload?.__bbts_meta?.seguro_valor_relatorio ?? 0);
    b.n++;
    b.insurance += Number(r.insurance_value) || 0;
    b.pago += Number(r.bbts_seguro_pago) || 0;
    b.relatorio += rel;
    if (r.bbts_seguro_pago === null || Number(r.bbts_seguro_pago) === 0) b.pagoNulo++;
    b.linhas.push({ prop: r.proposal_number, mov: r.movement_date, ins: Number(r.insurance_value) || 0, pago: r.bbts_seguro_pago, rel });
  }
  console.log("comp     n  bbts_seguro_pago=null/0 | Σ insurance_value | Σ bbts_seguro_pago | Σ raw_payload.seguro_valor_relatorio");
  for (const [comp, b] of [...porComp].sort()) {
    console.log(`${comp}  ${String(b.n).padStart(2)}   ${String(b.pagoNulo).padStart(2)}                    | ${f(b.insurance).padStart(12)}      | ${f(b.pago).padStart(12)}       | ${f(b.relatorio).padStart(12)}`);
  }
  console.log("\n--- linha a linha ---");
  for (const [comp, b] of [...porComp].sort()) {
    console.log(`\n[${comp}]`);
    for (const l of b.linhas) console.log(`  prop=${l.prop}  mov=${l.mov}  insurance_value=${f(l.ins)}  bbts_seguro_pago=${l.pago === null ? "NULL" : f(l.pago)}  raw.seguro_valor_relatorio=${f(l.rel)}`);
  }
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
