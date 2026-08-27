/* READ-ONLY. RR: competencias-empresa com fechamento e ZERO linha de seguro.
   valor_seguro de fechamento_mensal_empresa vem das ENTRIES (INSURANCE), nao do
   Resumo — entao "sem linha" e "valor_seguro=0" tem de ser medido nos DOIS lados. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function todas(tabela, select, filtros) {
  const out = []; let de = 0; const passo = 1000;
  for (;;) {
    let q = sb.from(tabela).select(select).order("id", { ascending: true }).range(de, de + passo - 1);
    if (filtros) q = filtros(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < passo) break;
    de += passo;
  }
  return out;
}

(async () => {
  const { data: comps } = await sb.from("companies").select("id, cnpj, name");
  const nomePorCnpj = new Map((comps || []).map((c) => [String(c.cnpj), c.name]));

  const fech = await todas("fechamento_mensal_empresa", "empresa_cnpj, ano, mes, valor_avista, valor_seguro, valor_estorno, valor_liquido, operacoes");
  console.log(`fechamento_mensal_empresa: ${fech.length} linhas (empresa x competencia)`);

  const ents = await todas("monthly_closing_entries", "company_cnpj, year, month, entry_type, commission_value, net_value, insurance_value, gross_value, sheet_name");
  console.log(`monthly_closing_entries: ${ents.length} linhas`);

  const porComp = new Map();
  for (const e of ents) {
    const k = `${e.company_cnpj}|${e.year}|${e.month}`;
    let b = porComp.get(k);
    if (!b) { b = { total: 0, ins: 0, insValor: 0, cash: 0, abas: new Set() }; porComp.set(k, b); }
    b.total++;
    b.abas.add(e.sheet_name);
    if (e.entry_type === "INSURANCE") { b.ins++; b.insValor += Number(e.commission_value) || Number(e.net_value) || Number(e.insurance_value) || 0; }
    if (e.entry_type === "CASH") b.cash++;
  }

  const semSeguro = [];
  for (const r of fech) {
    const k = `${r.empresa_cnpj}|${r.ano}|${r.mes}`;
    const b = porComp.get(k) || { total: 0, ins: 0, insValor: 0, cash: 0, abas: new Set() };
    if (b.ins === 0) semSeguro.push({ r, b });
  }
  console.log(`\n>>> competencias-empresa COM fechamento e ZERO linha INSURANCE: ${semSeguro.length}\n`);
  console.log("comp      empresa           linhas_entries  linhas_CASH  valor_avista   valor_seguro(gravado)  valor_liquido");
  for (const { r, b } of semSeguro.sort((a, z) => a.r.ano - z.r.ano || a.r.mes - z.r.mes || String(a.r.empresa_cnpj).localeCompare(String(z.r.empresa_cnpj)))) {
    console.log(`${r.ano}-${String(r.mes).padStart(2, "0")}  ${String(nomePorCnpj.get(String(r.empresa_cnpj)) || r.empresa_cnpj).padEnd(16)} ${String(b.total).padStart(8)} ${String(b.cash).padStart(12)} ${f(r.valor_avista).padStart(14)} ${f(r.valor_seguro).padStart(20)} ${f(r.valor_liquido).padStart(14)}`);
  }

  // quantas tem valor_seguro > 0 gravado apesar de zero linha (incoerencia interna)
  const incoerentes = semSeguro.filter(({ r }) => Math.abs(Number(r.valor_seguro) || 0) > 0.005);
  console.log(`\ndessas, com valor_seguro GRAVADO > 0 apesar de zero linha INSURANCE: ${incoerentes.length}`);

  // panorama: quantas competencias-empresa TEM linha de seguro
  const comSeguro = fech.length - semSeguro.length;
  console.log(`competencias-empresa COM linha INSURANCE: ${comSeguro}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
