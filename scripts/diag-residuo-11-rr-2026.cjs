/* READ-ONLY. RR 2026: arquivo a arquivo, com status — e a comparacao com o que
   fechamento_mensal_empresa registrou por empresa/competencia. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { data: comps } = await sb.from("companies").select("id, name, cnpj");
  const nome = new Map((comps || []).map((c) => [c.id, c.name]));
  const porCnpj = new Map((comps || []).map((c) => [c.cnpj, c.name]));

  const { data, error } = await sb.from("monthly_closing_imports").select("*").gte("year", 2026).order("year").order("month");
  if (error) throw error;
  console.log("=== monthly_closing_imports 2026 ===");
  console.log("comp     empresa          status      produto            arquivo");
  for (const r of data.sort((a, b) => a.month - b.month || String(nome.get(a.company_id)).localeCompare(String(nome.get(b.company_id))))) {
    console.log(`${r.year}-${String(r.month).padStart(2, "0")}  ${String(nome.get(r.company_id) || "?").padEnd(15)} ${String(r.status).padEnd(11)} ${String(r.produto ?? "(vazio)").padEnd(18)} ${r.file_name}`);
  }

  console.log("\n=== fechamento_mensal_empresa 2026 ===");
  const { data: fech, error: e2 } = await sb.from("fechamento_mensal_empresa").select("*").gte("ano", 2026).order("ano").order("mes");
  if (e2) throw e2;
  console.log("comp     empresa          avista        diferido     seguro     estorno   renovacao   liquido");
  for (const r of fech)
    console.log(`${r.ano}-${String(r.mes).padStart(2, "0")}  ${String(porCnpj.get(r.empresa_cnpj) || r.empresa_cnpj).padEnd(15)} ${f(r.valor_avista).padStart(12)} ${f(r.valor_diferido).padStart(12)} ${f(r.valor_seguro).padStart(10)} ${f(r.valor_estorno).padStart(10)} ${f(r.valor_renovacao).padStart(10)} ${f(r.valor_liquido).padStart(12)}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
