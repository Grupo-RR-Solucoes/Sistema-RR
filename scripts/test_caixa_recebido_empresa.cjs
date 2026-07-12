/*
 * CARD "Comissoes recebidas pela empresa" = valor_avista(M-1) + valor_seguro(M-1).
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

  // a) receivedEmpresa == avista(jun) + seguro(jun)
  ok("a) receivedEmpresa == valor_avista(jun) + valor_seguro(jun)", near(s.receivedEmpresa, recEmpresa), `code=${s.receivedEmpresa} calc=${recEmpresa}`);
  ok("a) NAO abate estorno por ora (codigo = puro, TODO no comentario)", near(s.receivedEmpresa, recEmpresa) && !near(s.receivedEmpresa, recEmpresaSemEstorno) || estorno === 0, `estorno=${estorno}`);
  ok("a) receivedInsurance == valor_seguro(jun) (do qual do card)", near(s.receivedInsurance, seguro), `${s.receivedInsurance} vs ${seguro}`);

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
