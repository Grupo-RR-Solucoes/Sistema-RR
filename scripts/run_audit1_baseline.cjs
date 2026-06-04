/*
 * AUDITORIA 1 — ETAPA 1 (read-only): baseline do motor ATUAL.
 *
 * Roda o motor de auditoria como esta HOJE (lib/historicalAuditEngine.ts) para
 * jan/fev/mar 2026 e mostra o que ele acusa: teto à vista, recuperável por
 * classificação (cash) e continuidade PRT. NAO altera o motor. Read-only
 * (as funcoes so leem monthly_closing_entries).
 */
require("./_ts_register.cjs");
const {
  auditCashEntriesForMonth,
  auditPrtForMonth,
} = require("../lib/historicalAuditEngine.ts");

const fmt = (x) => Number(x || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x) => (Number(x || 0) * 100).toFixed(2).replace(".", ",") + "%";
const MES = { 1: "JAN", 2: "FEV", 3: "MAR" };
const MONTHS = [1, 2, 3];
const YEAR = 2026;

(async () => {
  const cashByMonth = {};
  const prtByMonth = {};

  console.log("===================== AUDITORIA 1 — BASELINE (motor ATUAL) =====================");
  console.log("Periodo: jan/fev/mar 2026 | read-only | motor inalterado\n");

  // -------- CASH (à vista) --------
  console.log("########## FRENTE À VISTA (cash) — esperado = min(% TABELA OPP do fechamento, teto) ##########");
  for (const m of MONTHS) {
    const t0 = Date.now();
    const r = await auditCashEntriesForMonth(YEAR, m);
    cashByMonth[m] = r;
    const s = r.summary;
    console.log(`\n[${MES[m]}/${YEAR}] (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(`  produção CASH (base teto) = ${fmt(s.productionValue)} | teto aplicado = ${pct(s.policy.percent)} (${s.policy.note?.slice(0, 60) || ""})`);
    console.log(`  contratos=${s.totalContracts} | SRCC excluídos=${s.totalSrccExcluded} | regime META=${s.isMetaRegime}`);
    console.log(`  classificação:`, JSON.stringify(s.byDivergence));
    console.log(`  recuperável p/ classe:`, Object.fromEntries(Object.entries(s.recuperavelByDivergence).map(([k, v]) => [k, fmt(v)])));
    console.log(`  RECUPERÁVEL total (cash, motor atual, soma com sinais) = ${fmt(s.totalRecuperavel)}`);
    // quebra underpayment (recuperavel>0) vs overpayment (recuperavel<0)
    let under = 0, over = 0, nUnder = 0, nOver = 0;
    for (const it of r.results) {
      if (it.note === "SRCC excluida") continue;
      if (it.recuperavel > 0.004) { under += it.recuperavel; nUnder++; }
      else if (it.recuperavel < -0.004) { over += it.recuperavel; nOver++; }
    }
    console.log(`  → underpayment (esperado>pago): ${fmt(under)} em ${nUnder} contratos | overpayment (pago>esperado): ${fmt(over)} em ${nOver} contratos`);
  }

  // -------- PRT (diferido / continuidade) --------
  console.log("\n\n########## FRENTE PRT (continuidade do diferido) ##########");
  for (const m of MONTHS) {
    const t0 = Date.now();
    const r = await auditPrtForMonth(YEAR, m);
    prtByMonth[m] = r;
    const s = r.summary;
    console.log(`\n[${MES[m]}/${YEAR}] (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(`  contratos auditados=${s.totalContractsAuditados} | débitos casados=${s.debitsApplied}/${s.totalDebitsParsed}`);
    console.log(`  status:`, JSON.stringify(s.byStatus));
    console.log(`  recuperável p/ status:`, Object.fromEntries(Object.entries(s.recuperavelByStatus).map(([k, v]) => [k, fmt(v)])));
    console.log(`  RECUPERÁVEL total (PRT, motor atual) = ${fmt(s.totalRecuperavel)}`);
  }

  // -------- CONSOLIDADO --------
  console.log("\n\n########## CONSOLIDADO (motor ATUAL — baseline) ##########");
  console.log("mês | teto | recup. cash (c/ sinal) | recup. cash underpay | recup. PRT");
  let gCash = 0, gCashUnder = 0, gPrt = 0;
  for (const m of MONTHS) {
    const cs = cashByMonth[m].summary;
    let under = 0;
    for (const it of cashByMonth[m].results) { if (it.note !== "SRCC excluida" && it.recuperavel > 0.004) under += it.recuperavel; }
    const ps = prtByMonth[m].summary;
    gCash += cs.totalRecuperavel; gCashUnder += under; gPrt += ps.totalRecuperavel;
    console.log(`${MES[m]} | ${pct(cs.policy.percent)} | ${fmt(cs.totalRecuperavel).padStart(16)} | ${fmt(under).padStart(16)} | ${fmt(ps.totalRecuperavel).padStart(14)}`);
  }
  console.log(`TOT |       | ${fmt(gCash).padStart(16)} | ${fmt(gCashUnder).padStart(16)} | ${fmt(gPrt).padStart(14)}`);
  console.log(`\nRecuperável GERAL (motor atual) = cash(c/sinal) ${fmt(gCash)} + PRT ${fmt(gPrt)} = ${fmt(gCash + gPrt)}`);
  console.log(`Recuperável GERAL só underpayment cash + PRT = ${fmt(gCashUnder + gPrt)}`);
  console.log("\n(ETAPA 1 baseline concluída — motor NÃO alterado.)");
})().catch((e) => { console.error(e); process.exit(1); });
