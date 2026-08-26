/*
 * CARD "Comissoes recebidas pela empresa".
 *
 * ATUALIZADO 26/08/2026 (decisao do Diego — ver HANDOFF_ADS_FECHAMENTO_CAIXA.md secao 16+):
 *   ANTES: valor_avista(M-1) + valor_seguro(M-1), so as 4 RR.
 *   AGORA: valor_avista(M-1) das 4 RR + bbts_pag_avista(M-1) da ADS. SEM seguro —
 *          o seguro saiu do "Recebido" e virou card PROPRIO, nao mais "do qual".
 * As assercoes (b) e (c) sao INVARIANTES e ficaram intactas; so as de (a), que
 * descreviam a COMPOSICAO antiga, foram reescritas para a composicao nova.
 * Roda o buildFinancialAnalytics REAL (jul/26, M-1=junho) e confronta com o banco.
 * So leitura. Mostra o valor_estorno(jun) pro Diego decidir se abate.
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
(function preferEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
})();
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log(`  OK  ${n}`)) : (fail++, console.log(`  XX  ${n} ${x ? "- " + x : ""}`)); };
const near = (a, b) => Math.abs((+a || 0) - (+b || 0)) <= 0.02;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const brl = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  console.log("\n=== CAIXA — 'Comissoes recebidas pela empresa' (M=jul/26, M-1=junho) ===\n");
  // Componentes do fechamento junho (todas as empresas — caixa nao tem scope)
  const { data: fme } = await sb.from("fechamento_mensal_empresa")
    .select("empresa_cnpj, valor_avista, valor_seguro, valor_estorno, valor_liquido")
    .eq("ano", 2026).eq("mes", 6);
  const sum = (f) => r2((fme || []).reduce((a, r) => a + Number(r[f] || 0), 0));
  const avista = sum("valor_avista"), seguro = sum("valor_seguro"), estorno = sum("valor_estorno"), liq = sum("valor_liquido");
  const recEmpresa = r2(avista + seguro);
  const recEmpresaSemEstorno = r2(avista + seguro - estorno);
  console.log(`  fechamento junho (${(fme || []).length} empresas):`);
  console.log(`    Sigma valor_avista  = ${brl(avista)}`);
  console.log(`    Sigma valor_seguro  = ${brl(seguro)}`);
  console.log(`    -> receivedEmpresa (avista+seguro PURO) = ${brl(recEmpresa)}`);
  console.log(`    Sigma valor_estorno = ${brl(estorno)}`);
  console.log(`    (informativo) avista+seguro - estorno   = ${brl(recEmpresaSemEstorno)}  <-- DIEGO DECIDE se abate`);
  console.log(`    Sigma valor_liquido (inclui PRT/seguro-estorno) = ${brl(liq)}\n`);

  const fin = await buildFinancialAnalytics(sb, { year: 2026, month: 7 });
  const s = fin.summary;
  console.log(`  buildFinancialAnalytics(jul): receivedEmpresa=${brl(s.receivedEmpresa)} receivedNet=${brl(s.receivedNet)} receivedInsurance=${brl(s.receivedInsurance)} comissoesPagas=${brl(s.comissoesPagas)}\n`);

  // ---- ADS da mesma competencia M-1, pela MESMA regua do codigo (janela) ----
  // Lado B computado AQUI, no mesmo run: nenhuma constante congelada.
  const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
  const ADS_ID = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
  const adsRows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("daily_production_records")
      .select("bbts_pag_avista, bbts_seguro_pago, movement_date, contract_date, proposal_date")
      .eq("company_id", ADS_ID)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    adsRows.push(...data);
    if (data.length < 1000) break;
  }
  const compAlvo = getProductionPeriodKey(2026, 6)  // M-1 desta medicao, igual ao resto do gate;
  let adsAvista = 0, adsSeguro = 0;
  for (const r of adsRows) {
    const pp =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    if (!pp || getProductionPeriodKey(pp.year, pp.month) !== compAlvo) continue;
    adsAvista += Number(r.bbts_pag_avista) || 0;
    adsSeguro += Number(r.bbts_seguro_pago) || 0;
  }
  adsAvista = r2(adsAvista); adsSeguro = r2(adsSeguro);
  console.log(`    ADS ${compAlvo}: a-vista = ${brl(adsAvista)} | seguro = ${brl(adsSeguro)}
`);

  // a) COMPOSICAO NOVA: avista das 4 RR + a-vista da ADS, SEM seguro.
  const esperadoEmpresa = r2(avista + adsAvista);
  ok("a) receivedEmpresa == valor_avista(RR) + bbts_pag_avista(ADS)", near(s.receivedEmpresa, esperadoEmpresa), `code=${s.receivedEmpresa} calc=${esperadoEmpresa}`);
  ok("a) o SEGURO ficou de FORA do receivedEmpresa (decisao 26/08)", !near(s.receivedEmpresa, r2(esperadoEmpresa + seguro + adsSeguro)) || (seguro === 0 && adsSeguro === 0), `seguro RR=${seguro} ADS=${adsSeguro}`);
  ok("a) NAO abate estorno por ora (codigo = puro, TODO no comentario)", near(s.receivedEmpresa, esperadoEmpresa) && !near(s.receivedEmpresa, r2(esperadoEmpresa - estorno)) || estorno === 0, `estorno=${estorno}`);
  ok("a) receivedInsurance == valor_seguro(RR) + bbts_seguro_pago(ADS) (card PROPRIO)", near(s.receivedInsurance, r2(seguro + adsSeguro)), `${s.receivedInsurance} vs ${r2(seguro + adsSeguro)}`);
  ok("a) a ADS ENTRA no receivedEmpresa (o conserto nao virou remocao)", adsAvista === 0 || s.receivedEmpresa > avista, `avista RR=${avista} code=${s.receivedEmpresa}`);

  // b) subconjunto do Recebido (sem PRT, produtos, manual)
  ok("b) receivedEmpresa < Recebido (subconjunto)", s.receivedEmpresa < s.receivedNet, `${s.receivedEmpresa} vs ${s.receivedNet}`);
  ok("b) receivedEmpresa != valor_liquido (nao inclui PRT)", !near(s.receivedEmpresa, liq) || liq === recEmpresa, `recEmpresa=${recEmpresa} liq=${liq}`);

  // c) comparacao-chave: entrada (recebido no que repassa) x saida (pago)
  console.log("  c) COMPARACAO jul/26 (entrada x saida):");
  console.log(`     Comissoes recebidas pela empresa (avista+seguro jun) = ${brl(s.receivedEmpresa)}`);
  console.log(`     Comissoes pagas (repasse aos promotores, liquido jun) = ${brl(s.comissoesPagas)}`);
  console.log(`     margem (recebido - pago) = ${brl(r2(s.receivedEmpresa - s.comissoesPagas))}`);
  ok("c) os dois numeros existem e sao competencia M-1 (junho)", s.receivedEmpresa > 0 && s.comissoesPagas > 0);

  console.log(`\n=== ${pass} passaram, ${fail} falharam ===`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
