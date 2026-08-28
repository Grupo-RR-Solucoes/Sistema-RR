/* READ-ONLY. Idem 18, mas sem varrer a tabela inteira: le SO as linhas
   entry_type='INSURANCE' e conta o resto por count(head). */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { data: comps } = await sb.from("companies").select("id, cnpj, name");
  const nome = new Map((comps || []).map((c) => [String(c.cnpj), c.name]));

  const { data: fech, error: e1 } = await sb
    .from("fechamento_mensal_empresa")
    .select("empresa_cnpj, ano, mes, valor_avista, valor_seguro, valor_estorno, valor_liquido, operacoes");
  if (e1) throw e1;
  console.log(`fechamento_mensal_empresa: ${fech.length} linhas (empresa x competencia)`);

  // SO as linhas de seguro (subconjunto pequeno)
  const ins = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb
      .from("monthly_closing_entries")
      .select("company_cnpj, year, month, commission_value, net_value, insurance_value, sheet_name")
      .eq("entry_type", "INSURANCE")
      .order("id", { ascending: true })
      .range(de, de + 999);
    if (error) throw error;
    ins.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`monthly_closing_entries com entry_type='INSURANCE': ${ins.length} linhas`);

  const porComp = new Map();
  for (const e of ins) {
    const k = `${e.company_cnpj}|${e.year}|${e.month}`;
    let b = porComp.get(k);
    if (!b) { b = { n: 0, valor: 0, abas: new Set() }; porComp.set(k, b); }
    b.n++;
    b.valor += Number(e.commission_value) || Number(e.net_value) || Number(e.insurance_value) || 0;
    b.abas.add(e.sheet_name);
  }

  const sem = fech.filter((r) => !porComp.has(`${r.empresa_cnpj}|${r.ano}|${r.mes}`));
  console.log(`\n>>> competencias-empresa COM fechamento e ZERO linha INSURANCE: ${sem.length}`);
  console.log(`>>> competencias-empresa COM pelo menos 1 linha INSURANCE:      ${fech.length - sem.length}\n`);

  if (sem.length) {
    console.log("comp      empresa           entries_total  valor_avista   valor_seguro   valor_liquido");
    for (const r of sem.sort((a, b) => a.ano - b.ano || a.mes - b.mes)) {
      const { count } = await sb
        .from("monthly_closing_entries")
        .select("*", { count: "exact", head: true })
        .eq("company_cnpj", r.empresa_cnpj).eq("year", r.ano).eq("month", r.mes);
      console.log(`${r.ano}-${String(r.mes).padStart(2, "0")}  ${String(nome.get(String(r.empresa_cnpj)) || r.empresa_cnpj).padEnd(16)} ${String(count).padStart(10)} ${f(r.valor_avista).padStart(14)} ${f(r.valor_seguro).padStart(14)} ${f(r.valor_liquido).padStart(14)}`);
    }
  }

  // coerencia: valor_seguro gravado x soma das linhas INSURANCE
  console.log("\n=== valor_seguro GRAVADO x soma das linhas INSURANCE (divergencias > 0,01) ===");
  let div = 0;
  for (const r of fech.sort((a, b) => a.ano - b.ano || a.mes - b.mes)) {
    const b = porComp.get(`${r.empresa_cnpj}|${r.ano}|${r.mes}`) || { n: 0, valor: 0 };
    const d = (Number(r.valor_seguro) || 0) - b.valor;
    if (Math.abs(d) > 0.01) {
      div++;
      console.log(`  ${r.ano}-${String(r.mes).padStart(2, "0")} ${String(nome.get(String(r.empresa_cnpj)) || r.empresa_cnpj).padEnd(16)} gravado=${f(r.valor_seguro).padStart(12)}  linhas(${String(b.n).padStart(3)})=${f(b.valor).padStart(12)}  delta=${f(d).padStart(12)}`);
    }
  }
  if (!div) console.log("  nenhuma");
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
