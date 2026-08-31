/* ALCANCE da TRP39 no PROMOTOR — contratos da RR de agosto, promotores
 * afetados, efeito em R$ apos teto 5,80%. READ-ONLY, nada gravado.
 *
 * Usa o MOTOR REAL (calcularOperacao) com cada regua injetada pelo trpProvider,
 * que e o mesmo caminho da producao — nao replica a tabela a mao. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const DL = "C:/Users/diego/Downloads";
const f = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p4 = (v) => (v == null ? "—" : (Number(v) * 100).toFixed(4) + "%");

(async () => {
  const { buildTrpDraft } = require("@/lib/trp/parseTrpDraft.ts");
  const { calcularOperacao } = require("@/lib/motor.ts");
  const { tetoAvistaRR } = require("@/lib/tetoAvistaRR.ts");

  const d38 = await buildTrpDraft(new Uint8Array(fs.readFileSync(DL + "/TRP38 - PROMOTIVA 072026.pdf")), { competencia: "2026-08", sourceFilename: "T38", sha256: "38" });
  const d39 = await buildTrpDraft(new Uint8Array(fs.readFileSync(DL + "/TRP39 - PROMOTIVA 082026.pdf")), { competencia: "2026-08", sourceFilename: "T39", sha256: "39" });
  // NOTA: o TRP38 e lido COM competencia 2026-08 de proposito — e o cenario
  // "agosto calculado pela tabela de julho", que e o que acontece hoje (nao ha
  // regua de agosto em trp_rule_versions). A matriz e a mesma; so a vigencia do
  // _meta muda, e o motor nao a usa para escolher celula.
  const prov = (regra) => () => regra;

  console.log("=== (3) a TRP39 e a competencia ===");
  console.log(`  TRP39 _meta: ${JSON.stringify(d39.regraDraft._meta)}`);
  const { data: vers } = await sb.from("trp_rule_versions").select("competencia, version_no, is_active").order("competencia");
  console.log(`  trp_rule_versions no banco: ${(vers || []).map(v => `${String(v.competencia).slice(0,7)} v${v.version_no}${v.is_active ? "*" : ""}`).join(", ")}`);
  console.log(`  ja existe 2026-08? ${(vers || []).some(v => String(v.competencia).startsWith("2026-08")) ? "SIM" : "NAO"}`);

  console.log("\n=== (2) ALCANCE no promotor — RR, agosto/2026 ===");
  const { data: recs } = await sb.from("daily_production_records")
    .select("proposal_number, assigned_promoter_id, gross_value, net_value, interest_rate, term_months, installments, product_description, product_code, convenio_code, convenio_type, convenio_segment, insurance_value, has_insurance, status, movement_date, contract_date, proposal_date")
    .neq("company_id", ADS).gte("movement_date", "2026-08-01").lte("movement_date", "2026-08-31");
  console.log(`  linhas da RR em agosto: ${(recs || []).length}`);

  const { data: proms } = await sb.from("promoters").select("id, name");
  const nome = new Map((proms || []).map(p => [p.id, p.name]));

  const teto = tetoAvistaRR({ year: 2026, month: 8 });
  console.log(`  teto a vista aplicado: ${p4(teto)}`);

  let atingidos = 0, semPct = 0, deltaBase = 0, deltaPosTeto = 0;
  const porPromotor = new Map();
  const porCategoria = {};
  for (const r of recs || []) {
    const liq = Number(r.net_value) || Number(r.gross_value) || 0;
    const op = {
      valor_liquido: liq, valor_bruto: Number(r.gross_value) || 0,
      valor_seguro: Number(r.insurance_value) || 0, tem_seguro: !!r.has_insurance,
      taxa_juros: Number(r.interest_rate) || 0,
      prazo: Number(r.term_months) || Number(r.installments) || 0,
      product_code: r.product_code ?? null, product_description: r.product_description ?? null,
      convenio_code: r.convenio_code ?? null, convenio_type: r.convenio_type ?? null,
      convenio_segment: r.convenio_segment ?? null,
      contract_date: r.contract_date || r.movement_date, movement_date: r.movement_date,
      proposal_date: r.proposal_date || r.movement_date,
      production_value: 0, company_cash_percent: null,
    };
    let c38, c39;
    try { c38 = calcularOperacao(op, { trpProvider: prov(d38.regraDraft) }).credito; } catch { semPct++; continue; }
    try { c39 = calcularOperacao(op, { trpProvider: prov(d39.regraDraft) }).credito; } catch { semPct++; continue; }
    const p38 = Number(c38.percentual), p39 = Number(c39.percentual);
    if (!Number.isFinite(p38) || !Number.isFinite(p39) || p38 === p39) continue;
    atingidos++;
    const cat = c39.categoria || c38.categoria || "(?)";
    porCategoria[cat] = (porCategoria[cat] || 0) + 1;
    const base38 = liq * p38, base39 = liq * p39;
    const pos38 = liq * Math.min(p38, teto), pos39 = liq * Math.min(p39, teto);
    deltaBase += base39 - base38;
    deltaPosTeto += pos39 - pos38;
    const pid = r.assigned_promoter_id || "(sem promotor)";
    const acc = porPromotor.get(pid) || { n: 0, d: 0 };
    acc.n++; acc.d += pos39 - pos38;
    porPromotor.set(pid, acc);
  }
  console.log(`  contratos atingidos por celula que mudou: ${atingidos}  ${JSON.stringify(porCategoria)}`);
  console.log(`  sem percentual em uma das duas: ${semPct}`);
  console.log(`  PROMOTORES afetados: ${porPromotor.size}`);
  console.log(`\n  efeito na COMISSAO-EMPRESA a vista (ja com teto ${p4(teto)}):`);
  console.log(`    base SEM teto  : ${f(deltaBase)}`);
  console.log(`    base COM teto  : ${f(deltaPosTeto)}   <- e esta que remunera o promotor`);
  console.log("\n  por promotor (base pos-teto, TRP39 - TRP38):");
  for (const [pid, v] of [...porPromotor.entries()].sort((a, b) => a[1].d - b[1].d)) {
    console.log(`    ${String(nome.get(pid) || pid).slice(0, 34).padEnd(36)} ${String(v.n).padStart(3)} contrato(s)  ${f(v.d).padStart(11)}`);
  }
  const { data: pmr } = await sb.from("promoter_monthly_results").select("id").eq("year", 2026).eq("month", 8);
  console.log(`\n  PMR de 2026-08: ${(pmr || []).length} linha(s) -> ${(pmr || []).length === 0 ? "NINGUEM FOI PAGO AINDA; a mudanca e PROSPECTIVA" : "JA HA PMR — a mudanca mexeria em valor consolidado"}`);
  console.log("\nNADA GRAVADO.");
})().catch(e => { console.error("EXCECAO:", e.message, (e.stack || "").slice(0, 400)); process.exit(1); });
