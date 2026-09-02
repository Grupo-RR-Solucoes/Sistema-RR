#!/usr/bin/env node
/**
 * scripts/diag-piso-e-alertas-antigos.cjs — itens 2 e 3 da frente. READ-ONLY.
 *
 * ITEM 2 — os R$ 8,54 do piso: desenho ou defeito? O desconto some ou fica
 *          pendente? Aconteceu antes de agosto?
 * ITEM 3 — master_com_comissao e agregado_sem_detalhe: o que sao e se valem.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));
const brl = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const comp = (y, m) => y + "-" + String(m).padStart(2, "0");

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function todas(sb, tabela, sel) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from(tabela).select(sel).range(from, from + 999);
    if (error) throw new Error(tabela + ": " + error.message);
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const proms = await todas(sb, "promoters", "id,name,is_master,active");
  const nm = (id) => (proms.find((p) => p.id === id) || {}).name || String(id).slice(0, 8);
  const comps = await todas(sb, "companies", "id,name,cnpj");
  const ne = (id) => (comps.find((c) => c.id === id) || {}).name || "-";

  // ================================================================ ITEM 2
  console.log("\n############ ITEM 2 — o piso e os descontos ############");
  const pmr = await todas(sb, "promoter_monthly_results",
    "promoter_id,company_id,year,month,source,production_value,final_commission_value,piso_zerou");
  const zerados = pmr.filter((r) => r.piso_zerou === true);
  console.log("\n### 2.1 TODA competencia com piso_zerou=true na historia ###");
  const porComp = new Map();
  for (const r of zerados) {
    const k = comp(r.year, r.month);
    if (!porComp.has(k)) porComp.set(k, []);
    porComp.get(k).push(r);
  }
  console.log("  linhas com piso_zerou=true no banco INTEIRO: " + zerados.length);
  const naoNulo = pmr.filter((r) => r.piso_zerou === true || r.piso_zerou === false).length;
  console.log("  linhas com piso_zerou NAO nulo (ou seja, calculadas com o piso ativo): " + naoNulo +
    " de " + pmr.length);
  for (const kv of [...porComp].sort()) {
    console.log("  " + kv[0] + ": " + kv[1].length + " linha(s)");
    for (const r of kv[1]) console.log("      " + nm(r.promoter_id).padEnd(34) + " @ " + ne(r.company_id).padEnd(18) +
      " prod=" + brl(r.production_value).padStart(15) + "  comissao=" + brl(r.final_commission_value));
  }

  console.log("\n### 2.2 cruzamento: piso zerado E desconto na MESMA competencia ###");
  const desc = await todas(sb, "promoter_discounts",
    "promoter_id,year,month,amount,discount_type,installment_number,installments,status,apply_to_company");
  let totalPerdido = 0, casos = 0;
  for (const kv of [...porComp].sort()) {
    for (const r of kv[1]) {
      const ds = desc.filter((d) => d.promoter_id === r.promoter_id && d.year === r.year && d.month === r.month && d.apply_to_company !== true);
      if (!ds.length) continue;
      casos++;
      const soma = ds.reduce((s, d) => s + Number(d.amount || 0), 0);
      totalPerdido += soma;
      console.log("  " + kv[0] + "  " + nm(r.promoter_id).padEnd(34) + " -> " + brl(soma) + " NAO cobrado");
      for (const d of ds) console.log("      " + d.discount_type.padEnd(20) + " " + brl(d.amount).padStart(11) +
        "  parcela " + d.installment_number + "/" + d.installments + "  status=" + d.status);
    }
  }
  console.log("  casos: " + casos + "   total nao cobrado: " + brl(totalPerdido));
  if (!casos) console.log("  (nenhum — o cenario nunca ocorreu)");

  console.log("\n### 2.3 o desconto SOME ou fica pendente? (os leitores de dinheiro) ###");
  const statusDist = new Map();
  for (const d of desc) statusDist.set(d.status, (statusDist.get(d.status) || 0) + 1);
  console.log("  distribuicao de `status` em promoter_discounts (banco inteiro): " +
    [...statusDist].map((kv) => kv[0] + "=" + kv[1]).join("  "));
  console.log("  Nenhum leitor de dinheiro filtra por `status` (medido: promoterAnalytics:998 le");
  console.log("  a tabela inteira e amarra por (year,month); dre.ts:612 e financialAnalytics:811");
  console.log("  amarram por (year,month)). Logo uma linha de 2026-08 so pode ser lida COMO 2026-08.");

  // ================================================================ ITEM 3
  console.log("\n############ ITEM 3 — os alertas anteriores ############");
  console.log("\n### 3.1 master_com_comissao — TODA linha de chave master com valor > 0 ###");
  const masters = new Set(proms.filter((p) => p.is_master === true).map((p) => p.id));
  console.log("  chaves master cadastradas: " + masters.size);
  const viol = pmr.filter((r) => masters.has(r.promoter_id) && Number(r.final_commission_value) > 0);
  console.log("  linhas de master com comissao > 0: " + viol.length);
  for (const r of viol.sort((a, b) => comp(a.year, a.month).localeCompare(comp(b.year, b.month)))) {
    console.log("    " + comp(r.year, r.month) + "  " + nm(r.promoter_id).padEnd(30) + " @ " + ne(r.company_id).padEnd(20) +
      " source=" + String(r.source).padEnd(11) + " comissao=" + brl(r.final_commission_value).padStart(12) +
      "  producao=" + brl(r.production_value));
  }
  console.log("\n  --- a anotacao dizia '2026-02, source cms, R$ 18,91'. Existe ainda? ---");
  const fev = pmr.filter((r) => masters.has(r.promoter_id) && r.year === 2026 && r.month === 2);
  if (!fev.length) console.log("    NAO ha linha de master em 2026-02 — a anotacao esta VENCIDA.");
  for (const r of fev) console.log("    2026-02  " + nm(r.promoter_id) + " source=" + r.source + " comissao=" + brl(r.final_commission_value));
  console.log("\n  --- todas as linhas de master (com valor ou nao) por competencia ---");
  const mAll = pmr.filter((r) => masters.has(r.promoter_id));
  const gm = new Map();
  for (const r of mAll) {
    const k = comp(r.year, r.month) + " | " + String(r.source);
    const a = gm.get(k) || { n: 0, soma: 0 };
    a.n++; a.soma += Number(r.final_commission_value) || 0;
    gm.set(k, a);
  }
  for (const kv of [...gm].sort()) console.log("    " + kv[0].padEnd(26) + " linhas=" + String(kv[1].n).padStart(3) + "  Σ comissao=" + brl(kv[1].soma));

  console.log("\n### 3.2 agregado_sem_detalhe — 2025-02 / RR ALAGOAS 1 ###");
  const fme = await todas(sb, "fechamento_mensal_empresa", "*").catch((e) => { console.log("  (fechamento_mensal_empresa: " + e.message + ")"); return []; });
  const alvo = fme.filter((r) => Number(r.ano) === 2025 && Number(r.mes) === 2);
  for (const r of alvo) {
    console.log("    cnpj=" + r.empresa_cnpj + "  operacoes=" + r.operacoes +
      "  liquido=" + brl(r.valor_liquido) + "  avista=" + brl(r.valor_avista) + "  seguro=" + brl(r.valor_seguro));
    const emp = comps.find((c) => c.cnpj === r.empresa_cnpj);
    if (emp) {
      const { count } = await sb.from("monthly_closing_entries")
        .select("*", { count: "exact", head: true }).eq("company_id", emp.id).eq("year", 2025).eq("month", 2);
      console.log("      " + emp.name + " -> entries em 2025-02: " + count);
    }
  }
  console.log("\n  --- ha import de fechamento para 2025-02? ---");
  const { data: imp2502 } = await sb.from("monthly_closing_imports").select("id,company_id,status,created_at,file_name").eq("year", 2025).eq("month", 2);
  if (!imp2502 || !imp2502.length) console.log("    NENHUM import registrado para 2025-02.");
  for (const i of imp2502 || []) console.log("    " + String(i.created_at).slice(0, 19) + "  " + ne(i.company_id) + "  " + i.status + "  " + i.file_name);

  console.log("\n=== fim (nada foi gravado) ===");
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
