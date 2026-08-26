require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async()=>{
  const { data, error } = await sb.from("daily_production_records").select("*").limit(1);
  if (error) throw new Error(error.message);
  console.log("colunas de daily_production_records:\n" + Object.keys(data[0]).join("\n"));
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
