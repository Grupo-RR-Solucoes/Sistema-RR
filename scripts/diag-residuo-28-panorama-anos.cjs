/* READ-ONLY. Ha linha de seguro no banco em 2022/2023/2024/2025? Panorama por ANO
   e a lista COMPLETA das competencias-empresa com ZERO linha INSURANCE. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
(async () => {
  const { data: comps } = await sb.from("companies").select("id, cnpj, name");
  const idPorCnpj = new Map((comps || []).map((c) => [String(c.cnpj).replace(/\D/g, ""), c.id]));
  const nome = new Map((comps || []).map((c) => [String(c.cnpj).replace(/\D/g, ""), c.name]));
  const { data: fech, error } = await sb.from("fechamento_mensal_empresa").select("empresa_cnpj, ano, mes, valor_seguro");
  if (error) throw error;

  const linhas = [];
  for (const r of fech) {
    const cid = idPorCnpj.get(String(r.empresa_cnpj).replace(/\D/g, ""));
    const { count } = await sb.from("monthly_closing_entries").select("*", { count: "exact", head: true })
      .eq("company_id", cid).eq("year", r.ano).eq("month", r.mes).eq("entry_type", "INSURANCE");
    linhas.push({ ...r, nIns: count ?? 0, nome: nome.get(String(r.empresa_cnpj).replace(/\D/g, "")) });
  }
  linhas.sort((a, b) => a.ano - b.ano || a.mes - b.mes);

  console.log("=== PANORAMA POR ANO ===");
  console.log("ano   comps  com linha INSURANCE  sem linha   Sigma valor_seguro   Sigma linhas INSURANCE");
  const anos = new Map();
  for (const l of linhas) {
    let b = anos.get(l.ano);
    if (!b) { b = { n: 0, com: 0, sem: 0, val: 0, ins: 0 }; anos.set(l.ano, b); }
    b.n++; if (l.nIns > 0) b.com++; else b.sem++;
    b.val += Number(l.valor_seguro) || 0; b.ins += l.nIns;
  }
  for (const [ano, b] of [...anos].sort()) console.log(`${ano}  ${String(b.n).padStart(5)}  ${String(b.com).padStart(18)}  ${String(b.sem).padStart(9)}   ${f(b.val).padStart(16)}   ${String(b.ins).padStart(20)}`);

  const sem = linhas.filter((l) => l.nIns === 0);
  console.log(`\n=== LISTA COMPLETA das competencias-empresa com ZERO linha INSURANCE: ${sem.length} ===`);
  for (const l of sem) console.log(`  ${l.ano}-${String(l.mes).padStart(2, "0")} ${String(l.nome).padEnd(16)} valor_seguro=${f(l.valor_seguro)}`);
  console.log(`\nTOTAL de competencias-empresa: ${linhas.length}`);
  console.log(`Sigma valor_seguro no banco, todos os anos: ${f(linhas.reduce((a, l) => a + (Number(l.valor_seguro) || 0), 0))}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
