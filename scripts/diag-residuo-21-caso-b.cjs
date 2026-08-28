/* READ-ONLY. O unico caso (b): RR ALAGOAS 1, 2025-02. O dinheiro esta faltando
   ou so as LINHAS estao faltando? E ha arquivo para reimportar? */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CNPJ_AL1 = "48357275000103";

(async () => {
  console.log("=== 1) a linha inteira de fechamento_mensal_empresa ===");
  const { data: fr, error } = await sb.from("fechamento_mensal_empresa").select("*").eq("empresa_cnpj", CNPJ_AL1).eq("ano", 2025).in("mes", [1, 2, 3]);
  if (error) throw error;
  for (const r of fr.sort((a, b) => a.mes - b.mes)) {
    const soma = (Number(r.valor_avista) || 0) + (Number(r.valor_diferido) || 0) + (Number(r.valor_seguro) || 0) - (Number(r.valor_estorno) || 0) - (Number(r.valor_renovacao) || 0);
    console.log(`  2025-${String(r.mes).padStart(2, "0")}  avista=${f(r.valor_avista).padStart(12)} diferido=${f(r.valor_diferido).padStart(12)} seguro=${f(r.valor_seguro).padStart(10)} estorno=${f(r.valor_estorno).padStart(9)} renov=${f(r.valor_renovacao).padStart(9)} | liquido gravado=${f(r.valor_liquido).padStart(12)} | soma dos campos=${f(soma).padStart(12)} | operacoes=${r.operacoes}`);
  }
  console.log("\n  -> o valor_seguro do Resumo ESTA dentro do valor_liquido? (soma == liquido)");

  console.log("\n=== 2) arquivos registrados para 2025-02 AL1 ===");
  const { data: imps } = await sb.from("monthly_closing_imports").select("*").eq("year", 2025).eq("month", 2);
  const { data: comps } = await sb.from("companies").select("id, name");
  const nome = new Map((comps || []).map((c) => [c.id, c.name]));
  if (!imps || !imps.length) console.log("  NENHUM registro em monthly_closing_imports para 2025-02");
  for (const r of imps || []) console.log(`  ${String(nome.get(r.company_id)).padEnd(16)} status=${String(r.status).padEnd(11)} produto=${String(r.produto ?? "(vazio)").padEnd(12)} arquivo=${r.file_name}`);

  console.log("\n=== 3) o arquivo esta em disco? ===");
  const dirs = ["C:/Users/diego/Downloads", "C:/Users/diego/Downloads/RRCRED"];
  const alvos = new Set((imps || []).map((r) => String(r.file_name)));
  const achados = [];
  for (const d of dirs) {
    let ents = []; try { ents = fs.readdirSync(d); } catch { continue; }
    for (const e of ents) if (alvos.has(e) || /_2_2025\.xlsx$/i.test(e)) achados.push(d + "/" + e);
  }
  console.log(achados.length ? achados.map((a) => "  " + a).join("\n") : "  nenhum arquivo de 2025-02 em Downloads/RRCRED");
  let xlsx = 0;
  for (const d of dirs) { try { xlsx += fs.readdirSync(d).filter((e) => /\.xlsx$/i.test(e)).length; } catch {} }
  console.log(`  (xlsx totais em disco nesses diretorios: ${xlsx})`);

  console.log("\n=== 4) 2025-02 tem PMR? (o piso do ledger e 2026-01) ===");
  const { count } = await sb.from("promoter_monthly_results").select("*", { count: "exact", head: true }).eq("year", 2025).eq("month", 2);
  console.log(`  promoter_monthly_results 2025-02: ${count} linhas`);

  console.log("\n=== 5) competencias SEM entries nenhuma (nao so seguro) ===");
  const { data: fech } = await sb.from("fechamento_mensal_empresa").select("empresa_cnpj, ano, mes, valor_liquido");
  const { data: cs } = await sb.from("companies").select("id, cnpj, name");
  const idPorCnpj = new Map((cs || []).map((c) => [String(c.cnpj), c.id]));
  const nomeCnpj = new Map((cs || []).map((c) => [String(c.cnpj), c.name]));
  const vazias = [];
  for (const r of fech) {
    const { count: t } = await sb.from("monthly_closing_entries").select("*", { count: "exact", head: true }).eq("company_id", idPorCnpj.get(String(r.empresa_cnpj))).eq("year", r.ano).eq("month", r.mes);
    if ((t ?? 0) === 0) vazias.push({ ...r, nome: nomeCnpj.get(String(r.empresa_cnpj)) });
  }
  console.log(`  competencias-empresa com fechamento e ZERO entries de qualquer tipo: ${vazias.length}`);
  for (const v of vazias.sort((a, b) => a.ano - b.ano || a.mes - b.mes)) console.log(`    ${v.ano}-${String(v.mes).padStart(2, "0")} ${String(v.nome).padEnd(16)} valor_liquido=${f(v.valor_liquido)}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
