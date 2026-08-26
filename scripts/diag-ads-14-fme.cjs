require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async()=>{
  const { data, error } = await sb.from("fechamento_mensal_empresa").select("empresa_cnpj").limit(5000);
  if (error) throw new Error(error.message);
  const c={}; for(const r of data) c[r.empresa_cnpj]=(c[r.empresa_cnpj]||0)+1;
  console.log("=== CNPJs presentes em fechamento_mensal_empresa (historico inteiro) ===");
  for(const [k,v] of Object.entries(c).sort()) console.log(`${k} | ${v} linhas`);
  const ads = data.filter(r=>String(r.empresa_cnpj).replace(/\D/g,"")==="65286915000150");
  console.log("\nlinhas com CNPJ da ADS (65.286.915/0001-50): " + ads.length);
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
