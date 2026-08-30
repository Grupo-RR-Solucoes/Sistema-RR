/* A consulta que a TELA faz, para 2026-05 e 2026-06, pelas funcoes REAIS.
 * READ-ONLY. ATENCAO ao ler: o card Recebido e REGIME DE CAIXA e usa M-1 —
 * o dinheiro de MAIO aparece na competencia de JUNHO. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
(async () => {
  const { buildFinancialAnalytics } = require("@/lib/financialAnalytics.ts");
  const { buildDre } = require("@/lib/dre.ts");
  for (const [y, m] of [[2026, 5], [2026, 6]]) {
    const comp = `${y}-${String(m).padStart(2, "0")}`;
    console.log("\n" + "=".repeat(76));
    console.log(`COMPETENCIA ${comp}   (o card usa o caixa de M-1)`);
    console.log("=".repeat(76));
    const fa = await buildFinancialAnalytics(sb, { year: y, month: m });
    console.log(`  card Recebido: closing ${f(fa.summary.receivedClosing)} | manual ${f(fa.summary.receivedManual)} | LIQUIDO ${f(fa.summary.receivedNet)}`);
    const mat = fa.detalhamento.entrada;
    const ordem = mat.colunas.map(c => c.chave);
    console.log("  matriz de entrada:");
    console.log("    " + "empresa".padEnd(30) + ordem.map(k => k.padStart(11)).join("") + "       total");
    for (const l of mat.linhas) console.log("    " + String(l.rotulo).slice(0,29).padEnd(30) + ordem.map(k => f(l.celulas[k]).padStart(11)).join("") + f(l.total).padStart(12));
    console.log("    " + "TOTAIS".padEnd(30) + ordem.map(k => f(mat.totaisColuna[k]).padStart(11)).join("") + f(mat.total).padStart(12));
    console.log(`    matriz ${f(mat.total)} x card ${f(mat.cardTotal)} -> delta ${f(mat.delta)}`);
    const ads = mat.linhas.find(l => String(l.chave) === ADS);
    console.log(`    linha ADS: ${ads ? JSON.stringify(ads.celulas) + " total " + f(ads.total) : "AUSENTE"}`);
    try {
      const dre = await buildDre(sb, { year: y, month: m });
      const rec = dre.receita || dre.receitas || {};
      console.log(`  DRE: ${JSON.stringify(dre.totais || rec).slice(0, 300)}`);
    } catch (e) { console.log(`  DRE: ${e.message.slice(0,140)}`); }
    if (fa.alerts && fa.alerts.length) for (const a of fa.alerts) console.log(`  ALERTA: ${a.slice(0,150)}`);
  }
})().catch(e => { console.error("EXCECAO:", e.message, e.stack); process.exit(1); });
