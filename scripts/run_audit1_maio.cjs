/*
 * AUDITORIA 1 — PASSO B: maio/2026 (1º mês pós-cobrança).
 *
 * Frente 1 (à vista): esperado recalculado via lib/motor.ts (TRP errata) —
 *   líquido × %TRP(produto/juros/prazo, Faixa pela produção agregada), com teto.
 *   NÃO confia no % TABELA OPP da Promotiva. Compara com COMISSÃO PF paga.
 *   Recuperável = só underpayment (esperado>pago). Overpayment à parte.
 * PRT (regra binária): TRP mandava e não veio = entra; só sai com débito casado.
 *   Usa lib/historicalAuditEngine.auditPrtForMonth (já separa OK_DEBITADO).
 *
 * Read-only (não grava nada). Teto: maio cai em 6,00% (TRP 04/2026+); também
 * mostro o cenário 5,80% p/ comparação.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { calcularOperacao } = require("../lib/motor.ts");
const { resolvePromotivaCashPolicy } = require("../lib/promotivaCashPolicy.ts");
const { auditPrtForMonth } = require("../lib/historicalAuditEngine.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const YEAR = 2026, MONTH = 5;
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const pn = v => { if (v == null || v === "") return 0; if (typeof v === "number") return v; let r = String(v).replace(/R\$|%|\s/g, ""); if (r.includes(",") && r.includes(".")) r = r.replace(/\./g, "").replace(",", "."); else if (r.includes(",")) r = r.replace(/\./g, "").replace(",", "."); const n = Number(r.replace(/[^0-9.-]/g, "")); return isFinite(n) ? n : 0; };
const gN = (m, al) => { const w = new Set(al.map(norm)); for (const [k, v] of Object.entries(m || {})) if (w.has(norm(k))) return v; return null; };
const srcc = m => { const r = norm(gN(m, ["RESTRIÇÃO SRCC", "RESTRICAO SRCC"])); return r === "SIM" || r.includes("RESTRIT"); };
const fmt = x => Number(x || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctS = x => (Number(x || 0) * 100).toFixed(4).replace(".", ",") + "%";
const r2 = x => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const CNPJ2EMP = { "48.357.275/0001-03": "AL1", "56.140.658/0001-53": "AL2", "55.867.409/0001-00": "AL3", "51.457.289/0001-03": "PE" };
async function fa(filt) { let f = 0, o = []; for (;;) { let q = sb.from("monthly_closing_entries").select("company_cnpj,contract_number,net_value,gross_value,commission_value,metadata"); for (const [k, v] of Object.entries(filt)) q = q.eq(k, v); const { data, error } = await q.range(f, f + 999); if (error) throw error; o.push(...data); if (data.length < 1000) break; f += 1000; } return o; }

(async () => {
  const cashAll = await fa({ year: YEAR, month: MONTH, entry_type: "CASH" });
  const cash = cashAll.filter(r => !srcc(r.metadata));
  const srccN = cashAll.length - cash.length;
  let agg = 0; for (const r of cash) agg += Number(r.net_value) || 0;
  const pol = resolvePromotivaCashPolicy({ productionValue: agg, reference_date: "2026-05-01" });
  const teto = pol.percent; // 0.06 p/ maio
  const faixa = agg >= 20e6 ? "FAIXA_5" : agg >= 7e6 ? "FAIXA_4" : agg >= 3e6 ? "FAIXA_3" : agg >= 1e6 ? "FAIXA_2" : "FAIXA_1";

  console.log("================= AUDITORIA 1 — MAIO/2026 =================\n");
  console.log("### TETO / FAIXA");
  console.log(`  Produção CASH agregada (4 CNPJs, ex-SRCC) = ${fmt(agg)} -> ${faixa} (bandRate)`);
  console.log(`  Teto à vista MAIO (motor, TRP 04/2026+) = ${(teto * 100).toFixed(2)}% uniforme`);
  console.log(`  ⚠ "5,80% Safira" era o regime jan-mar; maio (abr+) é 6,00% uniforme. Rodo os dois p/ comparar.`);
  console.log(`  CASH=${cash.length} contratos (SRCC excluídos=${srccN})\n`);

  // ---- Frente 1 ----
  let sumEsp6 = 0, sumEsp580 = 0, sumPago = 0, under6 = 0, over6 = 0, under580 = 0;
  let nUnder = 0, nOver = 0, nOk = 0, nNaoCoberto = 0;
  const underList = [];
  for (const r of cash) {
    const m = r.metadata || {};
    const liq = Number(r.net_value) || pn(gN(m, ["VALOR LÍQUIDO"]));
    const op = { valor_liquido: liq, valor_bruto: Number(r.gross_value) || pn(gN(m, ["VALOR BRUTO"])), taxa_juros: pn(gN(m, ["TX JUROS"])), prazo: Math.trunc(pn(gN(m, ["PARCELA", "PARCELAS", "QTD PARCELAS"]))), tem_seguro: false, product_code: gN(m, ["PRODUTO"]), product_description: gN(m, ["DESCRIÇÃO DO PRODUTO", "NOME DO PRODUTO"]), convenio_code: gN(m, ["CONVÊNIO", "CONVENIO"]), company_cash_percent: null, production_value: agg, reference_date: "2026-05-01" };
    const res = calcularOperacao(op);
    const pctTrp = res.credito.percentual; // %TRP total credito
    const pago = Number(r.commission_value) || 0;
    if (pctTrp <= 0) { nNaoCoberto++; continue; } // motor não achou regra TRP -> fora
    const esp6 = r2(liq * Math.min(pctTrp, 0.06));
    const esp580 = r2(liq * Math.min(pctTrp, 0.058));
    sumEsp6 += esp6; sumEsp580 += esp580; sumPago += pago;
    const diff6 = r2(esp6 - pago);
    if (diff6 > 0.004) { under6 += diff6; nUnder++; underList.push({ contr: r.contract_number, emp: CNPJ2EMP[String(r.company_cnpj).trim()] || r.company_cnpj, liq, pctPago: liq > 0 ? pago / liq : 0, pctTrp, tabela: res.credito.regra, esp: esp6, pago, diff: diff6 }); }
    else if (diff6 < -0.004) { over6 += Math.abs(diff6); nOver++; }
    else nOk++;
    const diff580 = r2(esp580 - pago); if (diff580 > 0.004) under580 += diff580;
  }
  console.log("### FRENTE 1 — À VISTA (recálculo TRP via motor.ts)");
  console.log(`  Σ esperado TRP (teto 6%)  = ${fmt(sumEsp6)} | Σ pago COMISSÃO PF = ${fmt(sumPago)}`);
  console.log(`  OK=${nOk} | UNDERPAID=${nUnder} | OVERPAID=${nOver} | NÃO-COBERTO pelo motor=${nNaoCoberto}`);
  console.log(`  UNDERPAYMENT (recuperável, teto 6%)  = ${fmt(under6)}`);
  console.log(`  UNDERPAYMENT (cenário teto 5,80%)    = ${fmt(under580)}   (p/ comparação)`);
  console.log(`  OVERPAYMENT (à parte, NÃO compensa)  = ${fmt(over6)}`);
  underList.sort((a, b) => b.diff - a.diff);
  console.log(`\n  TOP ${Math.min(10, underList.length)} contratos com tabela aplicada MENOR que a TRP:`);
  console.log("  contrato | emp | líquido | % pago | % TRP | tabela | esperado | pago | diferença");
  for (const u of underList.slice(0, 10)) {
    console.log(`   ${u.contr} | ${u.emp} | ${fmt(u.liq)} | ${pctS(u.pctPago)} | ${pctS(u.pctTrp)} | ${u.tabela} | ${fmt(u.esp)} | ${fmt(u.pago)} | ${fmt(u.diff)}`);
  }

  // ---- PRT ----
  console.log("\n\n### PRT — regra binária (TRP mandava e não veio = entra; só sai com débito casado)");
  const prt = await auditPrtForMonth(YEAR, MONTH);
  const s = prt.summary;
  const entra = ["INTERROMPIDO_SUSPEITO", "INTERROMPIDO_LEGITIMO", "NUNCA_PAGO", "AUSENTE"];
  let prtRec = 0; for (const k of entra) prtRec += s.recuperavelByStatus[k];
  console.log(`  contratos PRT auditados = ${s.totalContractsAuditados}`);
  console.log(`  status:`, JSON.stringify(s.byStatus));
  console.log(`  recuperável p/ status:`, Object.fromEntries(Object.entries(s.recuperavelByStatus).map(([k, v]) => [k, fmt(v)])));
  console.log(`  → ENTRA (sem débito casado) = SUSPEITO+LEGÍTIMO+NUNCA_PAGO+AUSENTE = ${fmt(prtRec)}`);
  console.log(`  → JUSTIFICADO por débito casado (OK_DEBITADO), à parte = ${s.byStatus.OK_DEBITADO} contratos (rec ${fmt(s.recuperavelByStatus.OK_DEBITADO)})`);

  // ---- Consolidado ----
  console.log("\n\n### CONSOLIDADO MAIO/2026 (recuperável = só underpayment)");
  console.log(`  Frente 1 à vista (underpayment, teto 6%) = ${fmt(under6)}`);
  console.log(`  PRT (binário, sem débito casado)         = ${fmt(prtRec)}`);
  console.log(`  RECUPERÁVEL TOTAL MAIO                    = ${fmt(under6 + prtRec)}`);
  console.log(`  (overpayment à parte = ${fmt(over6)} | não-compensa)`);
})().catch(e => { console.error(e); process.exit(1); });
