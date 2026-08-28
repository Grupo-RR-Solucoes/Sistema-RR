/* READ-ONLY. O teste (a) x (b) do Diego, feito so no banco.
   valor_seguro de fechamento_mensal_empresa vem do RESUMO (monthlyClosingImport.ts
   :1560-1563, Object.assign sobrescreve os totais das entries). Entao:
     Resumo > 0 e ZERO linha INSURANCE  ->  caso (b): o seguro nao entrou em linha
     Resumo = 0 e ZERO linha INSURANCE  ->  caso (a): a empresa nao vendeu seguro
   Conta por competencia com count(head) — a varredura da tabela inteira estoura
   o statement timeout. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { data: comps } = await sb.from("companies").select("id, cnpj, name");
  const nome = new Map((comps || []).map((c) => [String(c.cnpj), c.name]));
  const idPorCnpj = new Map((comps || []).map((c) => [String(c.cnpj), c.id]));

  const { data: fech, error } = await sb
    .from("fechamento_mensal_empresa")
    .select("empresa_cnpj, ano, mes, valor_avista, valor_diferido, valor_seguro, valor_estorno, valor_liquido, operacoes");
  if (error) throw error;
  fech.sort((a, b) => a.ano - b.ano || a.mes - b.mes || String(nome.get(String(a.empresa_cnpj))).localeCompare(String(nome.get(String(b.empresa_cnpj)))));
  console.log(`fechamento_mensal_empresa: ${fech.length} linhas (empresa x competencia)\n`);

  const linhas = [];
  for (const r of fech) {
    const cid = idPorCnpj.get(String(r.empresa_cnpj));
    const base = () => sb.from("monthly_closing_entries").select("*", { count: "exact", head: true }).eq("company_id", cid).eq("year", r.ano).eq("month", r.mes);
    const { count: total, error: e1 } = await base();
    if (e1) throw e1;
    const { count: nIns, error: e2 } = await base().eq("entry_type", "INSURANCE");
    if (e2) throw e2;
    const { count: nCash, error: e3 } = await base().eq("entry_type", "CASH");
    if (e3) throw e3;
    linhas.push({ ...r, total: total ?? 0, nIns: nIns ?? 0, nCash: nCash ?? 0 });
  }

  const semLinha = linhas.filter((r) => r.nIns === 0);
  const casoB = semLinha.filter((r) => Math.abs(Number(r.valor_seguro) || 0) > 0.005);
  const casoA = semLinha.filter((r) => Math.abs(Number(r.valor_seguro) || 0) <= 0.005);

  console.log(`>>> com fechamento e ZERO linha INSURANCE : ${semLinha.length} de ${fech.length}`);
  console.log(`      caso (b) Resumo>0 e sem linha       : ${casoB.length}`);
  console.log(`      caso (a) Resumo=0 e sem linha       : ${casoA.length}`);
  console.log(`>>> com pelo menos 1 linha INSURANCE      : ${fech.length - semLinha.length}\n`);

  const tab = (arr, titulo) => {
    console.log(`--- ${titulo} (${arr.length}) ---`);
    if (!arr.length) { console.log("  (nenhuma)\n"); return; }
    console.log("comp      empresa           entries  CASH  INSURANCE  valor_avista   valor_seguro   valor_liquido");
    let soma = 0;
    for (const r of arr) {
      soma += Number(r.valor_seguro) || 0;
      console.log(`${r.ano}-${String(r.mes).padStart(2, "0")}  ${String(nome.get(String(r.empresa_cnpj)) || r.empresa_cnpj).padEnd(16)} ${String(r.total).padStart(7)} ${String(r.nCash).padStart(5)} ${String(r.nIns).padStart(10)} ${f(r.valor_avista).padStart(14)} ${f(r.valor_seguro).padStart(14)} ${f(r.valor_liquido).padStart(14)}`);
    }
    console.log(`  Sigma valor_seguro do grupo: ${f(soma)}\n`);
  };
  tab(casoB, "CASO (b) — Resumo traz Comissao Seguros > 0 e NAO ha linha INSURANCE");
  tab(casoA, "CASO (a) — Resumo = 0 e sem linha: zero e coerente");

  // panorama por empresa: em quantas competencias ela TEM seguro
  console.log("--- panorama por empresa ---");
  const porEmp = new Map();
  for (const r of linhas) {
    const n = nome.get(String(r.empresa_cnpj)) || r.empresa_cnpj;
    let b = porEmp.get(n);
    if (!b) { b = { comps: 0, comLinha: 0, somaSeguro: 0 }; porEmp.set(n, b); }
    b.comps++; if (r.nIns > 0) b.comLinha++; b.somaSeguro += Number(r.valor_seguro) || 0;
  }
  for (const [n, b] of [...porEmp].sort()) console.log(`  ${String(n).padEnd(16)} competencias=${String(b.comps).padStart(3)}  com linha INSURANCE=${String(b.comLinha).padStart(3)}  Sigma valor_seguro=${f(b.somaSeguro).padStart(14)}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
