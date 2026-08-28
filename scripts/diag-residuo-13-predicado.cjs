/* READ-ONLY. Quantas linhas o UPDATE proposto do BLOCO 2 tocaria, e com que valor. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const { data, error } = await sb
    .from("daily_production_records")
    .select("id, proposal_number, movement_date, bbts_seguro_pago, raw_payload->__bbts_meta->>seguro_valor_relatorio")
    .eq("company_id", "375aea6d-3b9c-4490-87f0-e739e312c8ef")
    .filter("raw_payload->__bbts_meta->>fonte", "eq", "fechamento_pdf_seguro_only")
    .is("bbts_seguro_pago", null);
  if (error) throw error;
  console.log(`linhas que o UPDATE tocaria: ${data.length}`);
  for (const r of data) console.log(`  id=${r.id}  prop=${r.proposal_number}  mov=${r.movement_date}  bbts_seguro_pago=NULL -> ${r.seguro_valor_relatorio}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
