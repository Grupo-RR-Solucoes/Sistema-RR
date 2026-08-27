/* READ-ONLY. Descontinuidade por PRODUTO no RR 2026: um produto que teve valor em
   meses anteriores e ZEROU no ultimo — candidato a "nota que nao chegou". */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COLS = ["valor_avista", "valor_diferido", "valor_seguro", "valor_credito", "valor_consorcio", "valor_bbcap", "valor_conta_corrente", "valor_dental", "valor_lob"];

(async () => {
  const { data: comps } = await sb.from("companies").select("cnpj, name");
  const nome = new Map((comps || []).map((c) => [c.cnpj, c.name]));
  const { data, error } = await sb.from("fechamento_mensal_empresa").select("*").eq("ano", 2026).order("mes");
  if (error) throw error;
  const porEmp = new Map();
  for (const r of data) {
    const n = nome.get(r.empresa_cnpj) || r.empresa_cnpj;
    if (!porEmp.has(n)) porEmp.set(n, new Map());
    porEmp.get(n).set(r.mes, r);
  }
  for (const [emp, meses] of [...porEmp].sort()) {
    console.log(`\n### ${emp}`);
    console.log(`coluna                 ` + [...meses.keys()].sort((a, b) => a - b).map((m) => String(m).padStart(12)).join(""));
    for (const c of COLS) {
      const linha = [...meses.keys()].sort((a, b) => a - b).map((m) => f(meses.get(m)[c]).padStart(12)).join("");
      console.log(`${c.padEnd(22)}${linha}`);
    }
    // descontinuidade
    const ms = [...meses.keys()].sort((a, b) => a - b);
    const ult = ms[ms.length - 1];
    for (const c of COLS) {
      const antes = ms.slice(0, -1).filter((m) => Math.abs(Number(meses.get(m)[c]) || 0) > 0.005).length;
      const agora = Math.abs(Number(meses.get(ult)[c]) || 0) > 0.005;
      if (antes > 0 && !agora) console.log(`  !! ${c}: teve valor em ${antes} de ${ms.length - 1} meses anteriores e esta ZERO em 2026-${String(ult).padStart(2, "0")}`);
    }
  }
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
