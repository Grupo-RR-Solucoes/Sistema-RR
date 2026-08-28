/* READ-ONLY. A linha so-seguro inteira + se existe irma de credito p/ o mesmo contrato. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const { data, error } = await sb
    .from("daily_production_records")
    .select("*")
    .or("proposal_number.eq.221262790,contract_number.eq.221262790");
  if (error) throw error;
  console.log(`linhas com proposta/contrato 221262790: ${data.length}\n`);
  for (const r of data) console.log(JSON.stringify(r, null, 2));
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
