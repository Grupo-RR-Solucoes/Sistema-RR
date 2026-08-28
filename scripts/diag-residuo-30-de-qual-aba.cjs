/* READ-ONLY. DE QUAL ABA vieram as linhas INSURANCE que estao no banco?
   monthly_closing_entries.sheet_name guarda a aba de ORIGEM de cada linha. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { data: comps } = await sb.from("companies").select("id, name");
  const nome = new Map((comps || []).map((c) => [c.id, c.name]));
  const AL3 = (comps || []).find((c) => c.name === "RR ALAGOAS 3").id;

  for (const [ano, mes] of [[2026, 6], [2026, 1]]) {
    const { data, error } = await sb
      .from("monthly_closing_entries")
      .select("sheet_name, commission_value, operation_number, contract_number")
      .eq("company_id", AL3).eq("year", ano).eq("month", mes).eq("entry_type", "INSURANCE");
    if (error) throw error;
    const porAba = new Map();
    for (const r of data) {
      let b = porAba.get(r.sheet_name);
      if (!b) { b = { n: 0, pos: 0, neg: 0, nPos: 0, nNeg: 0 }; porAba.set(r.sheet_name, b); }
      b.n++;
      const v = Number(r.commission_value) || 0;
      if (v > 0) { b.pos += v; b.nPos++; } else if (v < 0) { b.neg += v; b.nNeg++; }
    }
    console.log(`\n### ${ano}-${String(mes).padStart(2, "0")}  RR ALAGOAS 3  —  linhas entry_type='INSURANCE': ${data.length}`);
    console.log("  sheet_name (aba de ORIGEM)   linhas   positivas  Sigma(+)      negativas  Sigma(-)");
    for (const [aba, b] of [...porAba].sort()) {
      console.log(`  ${JSON.stringify(aba).padEnd(28)} ${String(b.n).padStart(6)} ${String(b.nPos).padStart(11)} ${f(b.pos).padStart(10)} ${String(b.nNeg).padStart(14)} ${f(b.neg).padStart(10)}`);
    }
    const { data: fr } = await sb.from("fechamento_mensal_empresa").select("valor_seguro, valor_estorno").eq("ano", ano).eq("mes", mes).eq("empresa_cnpj", "55.867.409/0001-00");
    if (fr && fr[0]) console.log(`  >>> banco: valor_seguro=${f(fr[0].valor_seguro)}  valor_estorno=${f(fr[0].valor_estorno)}`);
  }

  // panorama geral: TODA linha INSURANCE do banco, por aba de origem
  console.log("\n\n### TODAS as linhas INSURANCE do banco, por aba de ORIGEM (todos os anos, todas as empresas)");
  const conta = new Map();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from("monthly_closing_entries")
      .select("sheet_name, commission_value").eq("entry_type", "INSURANCE")
      .order("id", { ascending: true }).range(de, de + 999);
    if (error) { console.log("  (parou: " + error.message + ")"); break; }
    for (const r of data) {
      let b = conta.get(r.sheet_name);
      if (!b) { b = { n: 0, pos: 0, neg: 0 }; conta.set(r.sheet_name, b); }
      b.n++;
      const v = Number(r.commission_value) || 0;
      if (v > 0) b.pos += v; else if (v < 0) b.neg += v;
    }
    if (data.length < 1000) break;
  }
  console.log("  sheet_name                     linhas       Sigma(+)        Sigma(-)");
  for (const [aba, b] of [...conta].sort((a, z) => z[1].n - a[1].n)) {
    console.log(`  ${JSON.stringify(aba).padEnd(30)} ${String(b.n).padStart(6)} ${f(b.pos).padStart(14)} ${f(b.neg).padStart(15)}`);
  }
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
