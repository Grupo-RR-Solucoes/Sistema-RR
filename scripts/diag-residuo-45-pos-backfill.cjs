/*
 * READ-ONLY. Depois do backfill 20260827_000004 (executado no Studio em 28/08).
 *
 *   (0) estado da tabela bbts_fechamento_totais
 *   (1) summary de /api/financeiro para 2026-08 (a MESMA funcao da tela)
 *   (2) a linha da ADS na matriz de entrada, celula a celula + outrosDetalhe
 *       INTEIRO, com as duas identidades: Sigma(detalhe) == celula `outros`
 *       e Sigma(celulas) == total da linha
 *   (3) os checks ads_cabecalho_nf_ausente e ads_ancora_totais
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

(async () => {
  console.log("========== (0) bbts_fechamento_totais ==========");
  const t = await sb.from("bbts_fechamento_totais").select("*", { count: "exact" }).order("competencia");
  if (t.error) console.log(`  ERRO: ${t.error.code} ${t.error.message}`);
  else {
    console.log(`  tabela INTEIRA, sem filtro: ${t.count} linha(s)`);
    for (const r of t.data || []) {
      const soma = r2(
        Number(r.pagamento_avt) + Number(r.pagamento_prt) + Number(r.abertura_conta) + Number(r.glosa)
      );
      console.log(
        `    ${r.competencia}  avt=${f(r.pagamento_avt)} prt=${f(r.pagamento_prt)} ` +
          `abertura=${f(r.abertura_conta)} glosa=${f(r.glosa)} total=${f(r.pagamento_total)} ` +
          `| soma=${f(soma)} delta=${f(soma - Number(r.pagamento_total))} ` +
          `| insert=${r.created_at === r.updated_at}`
      );
    }
  }

  console.log("\n========== (1) /api/financeiro 2026-08 — summary ==========");
  const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
  const fin = await buildFinancialAnalytics(sb, { year: 2026, month: 8 });
  const s = fin.summary || {};
  for (const k of ["receivedClosing", "receivedNet", "receivedEmpresa", "receivedInsurance"]) {
    console.log(`    ${k.padEnd(18)} ${f(s[k]).padStart(14)}`);
  }
  const PREVISTO = 318785.68;
  const delta = r2(Number(s.receivedClosing) - PREVISTO);
  console.log(
    `\n    previsto ${f(PREVISTO)}   medido ${f(s.receivedClosing)}   delta ${f(delta)}   ` +
      `${delta === 0 ? ">>> BATE" : ">>> NAO BATE"}`
  );

  console.log("\n========== (2) A LINHA DA ADS na matriz de entrada ==========");
  const linhas = (fin.detalhamento && fin.detalhamento.entrada && fin.detalhamento.entrada.linhas) || [];
  const colunas = (fin.detalhamento && fin.detalhamento.entrada && fin.detalhamento.entrada.colunas) || [];
  console.log(`    colunas declaradas: ${JSON.stringify(colunas)}`);
  const ads = linhas.find((l) => String(l.chave) === ADS);
  if (!ads) {
    console.log("    LINHA DA ADS NAO ENCONTRADA");
  } else {
    console.log(`\n    ${ads.rotulo}  (chave ${ads.chave})`);
    console.log("    celulas:");
    let somaCelulas = 0;
    for (const [k, v] of Object.entries(ads.celulas || {})) {
      somaCelulas += Number(v) || 0;
      console.log(`      ${k.padEnd(12)} ${f(v).padStart(12)}`);
    }
    somaCelulas = r2(somaCelulas);
    console.log("\n    outrosDetalhe INTEIRO:");
    let somaDetalhe = 0;
    for (const d of ads.outrosDetalhe || []) {
      somaDetalhe += Number(d.valor) || 0;
      console.log(`      ${String(d.chave).padEnd(16)} ${String(d.rotulo).padEnd(18)} ${f(d.valor).padStart(12)}`);
    }
    somaDetalhe = r2(somaDetalhe);
    const outros = r2(ads.celulas && ads.celulas.outros);
    console.log(`\n    IDENTIDADE 1  Sigma(outrosDetalhe) = ${f(somaDetalhe)}  vs  celula outros = ${f(outros)}`);
    console.log(
      `                  delta ${f(somaDetalhe - outros)}   ` +
        `${somaDetalhe === outros ? "FECHA" : "NAO FECHA — a matriz mente no gesto que a explica"}`
    );
    console.log(`    IDENTIDADE 2  Sigma(celulas) = ${f(somaCelulas)}  vs  total da linha = ${f(ads.total)}`);
    console.log(
      `                  delta ${f(somaCelulas - r2(ads.total))}   ${somaCelulas === r2(ads.total) ? "FECHA" : "NAO FECHA"}`
    );
    console.log(`\n    linha crua: ${JSON.stringify(ads)}`);
  }

  console.log("\n========== (3) checks do fechamentoParcial ==========");
  const { detectFechamentoParcial } = require("../lib/diagnostico/fechamentoParcial.ts");
  const checks = await detectFechamentoParcial(sb);
  const querido = ["ads_cabecalho_nf_ausente", "ads_ancora_totais"];
  for (const id of querido) {
    const c = checks.find((x) => x.id === id);
    if (!c) {
      console.log(`\n  [${id}] NAO RETORNADO pelo detector`);
      continue;
    }
    console.log(`\n  [${c.id}] severity=${c.severity} count=${c.count}`);
    console.log(`    ${c.descricao}`);
    for (const d of c.detalhe || []) console.log(`      ${JSON.stringify(d)}`);
  }
  const outrosChecks = checks.filter((c) => !querido.includes(c.id));
  console.log(`\n  (outros checks do mesmo detector, para contexto: ${outrosChecks.length})`);
  for (const c of outrosChecks) console.log(`    [${c.id}] severity=${c.severity} count=${c.count}`);
})().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exit(1);
});
