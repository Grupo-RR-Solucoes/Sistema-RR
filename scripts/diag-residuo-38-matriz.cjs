/* READ-ONLY. A MATRIZ como a tela monta: colunas declaradas, a linha da ADS
   celula a celula, e de onde vem cada componente. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

(async () => {
  const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
  const p = await buildFinancialAnalytics(sb, { year: 2026, month: 8 });

  const ent = p.detalhamento && p.detalhamento.entrada;
  console.log("=== COLUNAS declaradas da matriz de ENTRADA ===");
  for (const c of (ent && ent.colunas) || []) console.log(`  chave=${String(c.chave).padEnd(16)} rotulo=${JSON.stringify(c.rotulo)}`);

  console.log("\n=== TODAS as linhas da matriz de ENTRADA ===");
  for (const l of (ent && ent.linhas) || []) {
    const cel = l.celulas || {};
    const soma = Object.values(cel).reduce((a, v) => a + (Number(v) || 0), 0);
    console.log(`  ${String(l.rotulo).padEnd(26)} total=${f(l.total ?? soma).padStart(14)}  celulas=${JSON.stringify(cel)}`);
  }

  const ads = ((ent && ent.linhas) || []).find((l) => /ADS/i.test(l.rotulo || ""));
  if (ads) {
    console.log("\n=== A LINHA DA ADS, celula a celula ===");
    const cel = ads.celulas || {};
    for (const c of (ent.colunas || [])) {
      const v = cel[c.chave];
      console.log(`  coluna ${String(c.chave).padEnd(16)} (${String(c.rotulo).padEnd(20)}) = ${v === undefined ? "(AUSENTE do objeto)" : f(v).padStart(12)}`);
    }
    const extras = Object.keys(cel).filter((k) => !(ent.colunas || []).some((c) => c.chave === k));
    console.log(`  chaves em celulas que NAO tem coluna declarada: ${extras.length ? extras.join(", ") : "(nenhuma)"}`);
    const soma = Object.values(cel).reduce((a, v) => a + (Number(v) || 0), 0);
    console.log(`  Sigma das celulas = ${f(soma)}   |  total da linha = ${f(ads.total)}   -> ${Math.abs(soma - (Number(ads.total) || 0)) < 0.01 ? "FECHA" : "NAO FECHA"}`);
  }

  console.log("\n=== DE ONDE VEM CADA COMPONENTE (fonte no banco) ===");
  const { data: cab, error: e1 } = await sb.from("bbts_fechamento_totais").select("competencia, pagamento_avt, pagamento_prt, abertura_conta, glosa, pagamento_total, arquivo_origem").eq("company_id", ADS);
  console.log(`  bbts_fechamento_totais: ${e1 ? "ERRO " + e1.message : `${cab.length} linha(s)`}`);
  for (const r of cab || []) console.log(`    ${String(r.competencia).slice(0, 7)}  avt=${f(r.pagamento_avt)} prt=${f(r.pagamento_prt)} abertura=${f(r.abertura_conta)} glosa=${f(r.glosa)} total=${f(r.pagamento_total)} arq=${r.arquivo_origem}`);

  console.log("\n=== ITEM 5 — Conta Corrente da ADS x Conta Corrente do RR ===");
  const { data: fech } = await sb.from("fechamento_mensal_empresa").select("empresa_cnpj, ano, mes, valor_conta_corrente").eq("ano", 2026).in("mes", [6, 7]);
  const { data: comps } = await sb.from("companies").select("cnpj, name");
  const nome = new Map((comps || []).map((c) => [String(c.cnpj), c.name]));
  console.log("  fechamento_mensal_empresa.valor_conta_corrente (produto, so RR):");
  for (const r of (fech || []).sort((a, b) => a.mes - b.mes)) console.log(`    2026-${String(r.mes).padStart(2, "0")} ${String(nome.get(String(r.empresa_cnpj))).padEnd(16)} ${f(r.valor_conta_corrente)}`);
  console.log("  a ADS NAO tem linha em fechamento_mensal_empresa (fatura pela BBTS, nao pela Promotiva)");
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
