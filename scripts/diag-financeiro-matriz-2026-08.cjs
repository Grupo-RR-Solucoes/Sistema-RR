/* ITEM 5 — a consulta que a TELA faz, para 2026-08. READ-ONLY.
 * Chama buildFinancialAnalytics REAL (a mesma que /api/financeiro chama) e
 * confere os dois numeros que NAO podem se mexer: receivedClosing 318.785,68 e
 * o total da linha da ADS 19.048,86. Isto e mudanca de APRESENTACAO. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
  const res = await buildFinancialAnalytics(sb, { year: 2026, month: 8 });
  const s = res.summary;
  console.log("=== SUMMARY 2026-08 (card Recebido) ===");
  console.log(`  receivedClosing : ${f(s.receivedClosing)}`);
  console.log(`  receivedManual  : ${f(s.receivedManual)}`);
  console.log(`  receivedNet     : ${f(s.receivedNet)}`);

  const m = res.detalhamento.entrada;
  console.log("\n=== MATRIZ DE ENTRADA — colunas ===");
  for (const c of m.colunas) console.log(`  ${String(c.chave).padEnd(12)} ${String(c.rotulo).padEnd(20)} ${c.expansivel ? "[expansivel] " : ""}${c.fonte || ""}`);

  console.log("\n=== LINHAS ===");
  const ordem = m.colunas.map(c => c.chave);
  console.log("  " + "empresa".padEnd(40) + ordem.map(k => k.padStart(12)).join("") + "       total");
  for (const l of m.linhas) {
    console.log("  " + String(l.rotulo).slice(0, 39).padEnd(40) + ordem.map(k => f(l.celulas[k]).padStart(12)).join("") + f(l.total).padStart(12));
  }
  console.log("  " + "TOTAIS".padEnd(40) + ordem.map(k => f(m.totaisColuna[k]).padStart(12)).join("") + f(m.total).padStart(12));
  console.log(`\n  card de referencia da matriz: ${f(m.cardReferencia !== undefined ? m.cardReferencia : m.card)}`);

  const ads = m.linhas.find(l => String(l.chave) === ADS);
  console.log("\n=== A LINHA DA ADS ===");
  console.log(`  celulas: ${JSON.stringify(ads && ads.celulas)}`);
  console.log(`  outrosDetalhe: ${JSON.stringify(ads && ads.outrosDetalhe)}`);
  console.log(`  Sigma(outrosDetalhe) = ${f((ads.outrosDetalhe||[]).reduce((a,d)=>a+Number(d.valor||0),0))} | celulas.outros = ${f(ads.celulas.outros)}`);

  console.log("\n=== OS DOIS NUMEROS QUE NAO PODEM SE MEXER ===");
  const okR = Math.abs(Number(s.receivedClosing) - 318785.68) < 0.005;
  const okA = ads && Math.abs(Number(ads.total) - 19048.86) < 0.005;
  console.log(`  receivedClosing == 318.785,68 ? ${okR ? "SIM" : "NAO -> " + f(s.receivedClosing)}`);
  console.log(`  total da ADS    == 19.048,86  ? ${okA ? "SIM" : "NAO -> " + (ads ? f(ads.total) : "linha ausente")}`);
  if (res.alerts && res.alerts.length) { console.log("\n=== ALERTAS ==="); for (const a of res.alerts) console.log("  - " + a); }
  process.exit(okR && okA ? 0 : 1);
})().catch(e => { console.error("EXCECAO:", e.message, e.stack); process.exit(1); });
