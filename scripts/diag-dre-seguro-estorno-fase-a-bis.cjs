/* BLOCO 1 / FASE A-bis — READ-ONLY, nada e escrito. As TRES medicoes que a
 * CORRECAO DO DIEGO pediu, sob a leitura certa: o PDF e EXTRATO DE PAGAMENTO, o
 * estorno e DEDUCAO DO PAGAMENTO na competencia DO PDF, e nao retificacao da
 * receita do contrato original.
 *
 *   (1) o debito de cancelamento e COBRADO do promotor? rastreio ate o payable.
 *   (2) se sim, o DRE abatendo tambem = o MESMO dinheiro contado duas vezes.
 *   (3) ha estorno da ADS em competencia que o PDF NAO declara?
 *   (4) as 4 pernas do pagamento: o DRE le cada uma por QUAL competencia?
 */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const L = (c) => c.repeat(78);

(async () => {
  const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");

  // ======================= (1) O DEBITO E COBRADO? =======================
  console.log(L("="));
  console.log("(1) O DEBITO DE CANCELAMENTO SAI DO BOLSO DO PROMOTOR?");
  console.log(L("="));

  const { data: deb } = await sb.from("promoter_debits")
    .select("id, promoter_id, total_amount, start_year, start_month, status")
    .eq("company_id", ADS).eq("debit_type", "CANCELAMENTO_SEGURO");
  const { data: disc } = await sb.from("promoter_discounts")
    .select("id, promoter_id, company_id, year, month, amount, apply_to_company, status, discount_type, debit_id")
    .eq("discount_type", "CANCELAMENTO_SEGURO");
  const { data: proms } = await sb.from("promoters").select("id, name");
  const nome = new Map((proms || []).map((p) => [p.id, p.name]));

  console.log("\nA PARCELA (promoter_discounts) — e ela que abate o repasse:");
  console.log("promotor                       | comp    | valor | apply_to_company | status  | debit_id");
  for (const d of disc || [])
    console.log(`${String(nome.get(d.promoter_id) || d.promoter_id).slice(0, 30).padEnd(30)} | ${d.year}-${String(d.month).padStart(2, "0")} | ${f(d.amount).padStart(5)} | ${String(d.apply_to_company).padEnd(16)} | ${String(d.status).padEnd(7)} | ${d.debit_id ? "sim" : "NAO"}`);

  const fa = fs.readFileSync("lib/financialAnalytics.ts", "utf8");
  const pa = fs.readFileSync("lib/promoterAnalytics.ts", "utf8");
  console.log("\nfiltros dos leitores, medidos no FONTE:");
  console.log(`  financialAnalytics pula so apply_to_company===true .. ${/apply_to_company === true\) continue/.test(fa)}`);
  console.log(`  promoterAnalytics filtra apply_to_company !== true ... ${/apply_to_company !== true/.test(pa)}`);
  console.log(`  financialAnalytics SELECIONA a coluna status? ........ ${/promoter_discounts"\)[\s\S]{0,200}?status/.test(fa)}`);
  console.log(`  promoterAnalytics SELECIONA a coluna status? ......... ${/promoter_discounts"\)[\s\S]{0,260}?status/.test(pa)}`);
  console.log("  => nenhum le status: PENDING abate exatamente como APPLIED.");

  const pids = [...new Set((disc || []).map((d) => d.promoter_id))];
  const { data: pmr } = await sb.from("promoter_monthly_results")
    .select("promoter_id, company_id, year, month, final_commission_value, discount_value, piso_zerou, source")
    .in("promoter_id", pids).eq("year", 2026).eq("month", 7);
  console.log("\nPMR 2026-07 dos 3 promotores (payable = final - desconto):");
  console.log("promotor                       | empresa | final      | desconto | PAYABLE    | piso_zerou");
  let somaAbatida = 0;
  for (const p of pmr || []) {
    const d = (disc || []).filter((x) => x.promoter_id === p.promoter_id && x.year === 2026 && x.month === 7 && x.apply_to_company !== true)
      .reduce((a, b) => a + Number(b.amount || 0), 0);
    const aplica = p.piso_zerou === true ? 0 : d;
    if (p.company_id === ADS) somaAbatida += aplica;
    console.log(`${String(nome.get(p.promoter_id) || "?").slice(0, 30).padEnd(30)} | ${p.company_id === ADS ? "ADS    " : "outra  "} | ${f(p.final_commission_value).padStart(10)} | ${f(aplica).padStart(8)} | ${f(Number(p.final_commission_value || 0) - aplica).padStart(10)} | ${p.piso_zerou === true ? "SIM (nao cobra)" : "nao"}`);
  }
  console.log(`\n  Sigma ABATIDO do repasse da ADS em 2026-07: R$ ${f(somaAbatida)}`);

  // ======================= (2) A DUPLA CONTAGEM =======================
  console.log("\n" + L("="));
  console.log("(2) SE O DRE TAMBEM ABATER: o mesmo dinheiro duas vezes");
  console.log(L("="));
  const { data: tot } = await sb.from("bbts_fechamento_totais").select("*").eq("company_id", ADS).order("competencia");
  const totByComp = new Map((tot || []).map((t) => [String(t.competencia).slice(0, 7), t]));
  console.log("");
  console.log("  julho/2026, numero a numero:");
  console.log("    a BBTS DEPOSITOU (ancora TOTAL do PDF de seguro) .....  155,07");
  console.log("    porque calculou .....................................  204,52");
  console.log("    e deduziu do PROPRIO pagamento ......................  -49,45");
  console.log("                                                           -------");
  console.log("                                                            155,07");
  console.log("");
  console.log(`    a empresa JA recupera esses 49,45 do promotor: R$ ${f(somaAbatida)}`);
  console.log("    abatidos do repasse (apply_to_company=false, sem filtro de status).");
  console.log("");
  console.log("    se o DRE passar a abater os 49,45 da RECEITA e mais nada:");
  console.log("      receita  204,52 - 49,45 = 155,07  (certo, = o deposito)");
  console.log(`      repasse  ja abatido em  -${f(somaAbatida)}`);
  console.log(`      => a empresa fica ${f(49.45 + somaAbatida)} melhor por um estorno de 49,45.`);
  console.log("         O MESMO 49,45 entra duas vezes: na receita E no repasse.");

  // ======================= (3) ESTORNO SEM PDF? =======================
  console.log("\n" + L("="));
  console.log("(3) HA ESTORNO DA ADS EM COMPETENCIA QUE O PDF NAO DECLARA?");
  console.log(L("="));
  const { data: src } = await sb.from("promoter_debit_sources").select("debit_id, operation, estorno_amount").in("debit_id", (deb || []).map((d) => d.id));
  const compDeb = new Map((deb || []).map((d) => [d.id, `${d.start_year}-${String(d.start_month).padStart(2, "0")}`]));
  const { data: fila } = await sb.from("promoter_debit_assignments").select("year, month, operation, estorno_amount, source_kind, status").eq("debit_type", "CANCELAMENTO_SEGURO");
  const est = [];
  for (const s of src || []) est.push({ comp: compDeb.get(s.debit_id), op: String(s.operation), v: Number(s.estorno_amount) || 0 });
  for (const a of fila || []) if (a.source_kind === "DAILY_CANCEL") est.push({ comp: `${a.year}-${String(a.month).padStart(2, "0")}`, op: String(a.operation), v: Number(a.estorno_amount) || 0 });

  const { data: prt } = await sb.from("bbts_prt_parcelas").select("competencia").eq("company_id", ADS);
  const compsPrt = new Set((prt || []).map((p) => String(p.competencia).slice(0, 7)));
  let dailyAll = [], from = 0;
  for (;;) {
    const { data } = await sb.from("daily_production_records").select("bbts_seguro_pago, bbts_pag_avista, movement_date, contract_date, proposal_date").eq("company_id", ADS).range(from, from + 999);
    dailyAll = dailyAll.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const compsDaily = new Set();
  for (const r of dailyAll) {
    const p = getProductionPeriodFromValue(r.movement_date) || getProductionPeriodFromValue(r.contract_date) || getProductionPeriodFromValue(r.proposal_date);
    if (p) compsDaily.add(getProductionPeriodKey(p.year, p.month));
  }
  console.log(`\ncompetencias com CABECALHO de PDF (bbts_fechamento_totais): ${[...totByComp.keys()].sort().join(", ") || "(nenhuma)"}`);
  console.log(`competencias com parcela PRT: ${[...compsPrt].sort().join(", ") || "(nenhuma)"}`);
  console.log(`competencias com linha daily da ADS (janela): ${[...compsDaily].sort().join(", ")}`);
  console.log("\ncomp do estorno | Sigma  | tem cabecalho de PDF? | ops");
  const porComp = new Map();
  for (const e of est) {
    const a = porComp.get(e.comp) || { v: 0, ops: [] };
    a.v += e.v;
    a.ops.push(e.op);
    porComp.set(e.comp, a);
  }
  let semPdf = 0;
  for (const [k, a] of [...porComp].sort()) {
    const tem = totByComp.has(k);
    if (!tem) semPdf++;
    console.log(`     ${k}     | ${f(a.v).padStart(6)} | ${tem ? "SIM" : "*** NAO ***"} | ${a.ops.join(", ")}`);
  }
  console.log(`\n  estornos em competencia SEM cabecalho de PDF: ${semPdf}`);

  // ============ (4) as QUATRO pernas ============
  console.log("\n" + L("="));
  console.log("(4) AS 4 PERNAS DO PAGAMENTO: o DRE le cada uma por QUAL competencia?");
  console.log(L("="));
  const avtJanela = new Map(), segJanela = new Map();
  for (const r of dailyAll) {
    const p = getProductionPeriodFromValue(r.movement_date) || getProductionPeriodFromValue(r.contract_date) || getProductionPeriodFromValue(r.proposal_date);
    if (!p) continue;
    const k = getProductionPeriodKey(p.year, p.month);
    avtJanela.set(k, (avtJanela.get(k) || 0) + (Number(r.bbts_pag_avista) || 0));
    segJanela.set(k, (segJanela.get(k) || 0) + (Number(r.bbts_seguro_pago) || 0));
  }
  console.log("\nAVT — o que o DRE soma (JANELA) x o que o PDF declara (cabecalho):");
  for (const k of [...totByComp.keys()].sort()) {
    const t = totByComp.get(k);
    const d = avtJanela.get(k) || 0, pdf = Number(t.pagamento_avt) || 0;
    console.log(`  ${k}: DRE ${f(d).padStart(12)}  x  PDF ${f(pdf).padStart(12)}   delta ${f(d - pdf).padStart(10)}`);
  }
  console.log("\nSEGURO — o que o DRE soma (JANELA), por competencia:");
  for (const k of [...segJanela.keys()].sort()) console.log(`  ${k}: ${f(segJanela.get(k)).padStart(10)}`);
  console.log("");
  console.log("  PRT      -> .eq(competencia, compKey-01)  = competencia LITERAL do PDF");
  console.log("  Abertura -> .eq(competencia, compKey-01)  = competencia LITERAL do PDF");
  console.log("  AVT      -> JANELA (movement/contract/proposal_date)  <== NAO e a do PDF");
  console.log("  SEGURO   -> JANELA (a MESMA linha, dre.ts:348)        <== NAO e a do PDF");
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
