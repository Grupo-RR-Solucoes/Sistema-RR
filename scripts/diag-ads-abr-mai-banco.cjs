/* FASE A perguntas 1, 2, 3 e 5 — o ESTADO DE HOJE, no banco. READ-ONLY:
 * so select/count, nenhuma escrita. As listas de proposta saem dos PROPRIOS
 * PDFs (lidos aqui), para a pergunta "ja esta la?" ser respondida contra o
 * documento e nao contra uma lista digitada a mao. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DL = "C:/Users/diego/Downloads";
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { extractLinesFromPdf } = require("@/lib/trp/parseTrpPdf.ts");
  const { BBTS_COMPANY_ID } = require("@/lib/bbtsClosingImport.ts");
  console.log("BBTS_COMPANY_ID (ADS) =", BBTS_COMPANY_ID);

  const props = async (arq, rx) => {
    const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync(DL + "/" + arq)));
    return [...new Set(lines.filter(l => rx.test(l)).map(l => l.match(/^(\d{6,})/)[1]))];
  };
  const credAbr = await props("ADS Abril 2026.pdf", /^\d{6,}\s+R\$/);
  const credMai = await props("ADS Maio 2026.pdf", /^\d{6,}\s+R\$/);
  const segAbr = (await props("Seguro ADS Abril 2026.pdf", /^\d{6,}\s+R\$/)).filter(p => p.length < 12);
  const segMai = (await props("Seguro ADs Maio 2026.pdf", /^\d{6,}\s+R\$/)).filter(p => p.length < 12);
  const prtMai = await props("ADS Maio 2026.pdf", /^\d{6,}\s+\d{2}\/\d{2}\/\d{4}\s+#N\/D/);
  console.log(`PDFs: credAbr=${credAbr.length} segAbr=${segAbr.length} credMai=${credMai.length} segMai=${segMai.length} prtMai=${prtMai.length}`);

  console.log("\n=== (1) bbts_fechamento_totais — competencias existentes ===");
  {
    const { data, error } = await sb.from("bbts_fechamento_totais").select("*").order("year").order("month");
    if (error) console.log("  ERRO:", error.message);
    else if (!data.length) console.log("  ZERO linhas na tabela inteira.");
    else for (const r of data) console.log(`  ${r.year}-${String(r.month).padStart(2,"0")} | ${JSON.stringify(r)}`.slice(0, 300));
  }

  console.log("\n=== (2) daily_production_records da ADS por mes de movement_date ===");
  for (const [ini, fim, rot] of [["2026-03-01","2026-03-31","marco"],["2026-04-01","2026-04-30","ABRIL"],["2026-05-01","2026-05-31","MAIO"],["2026-06-01","2026-06-30","junho"],["2026-07-01","2026-07-31","julho"]]) {
    const { count } = await sb.from("daily_production_records").select("id", { count: "exact", head: true })
      .eq("company_id", BBTS_COMPANY_ID).gte("movement_date", ini).lte("movement_date", fim);
    const { data: som } = await sb.from("daily_production_records").select("bbts_pag_avista, bbts_seguro_pago, gross_value")
      .eq("company_id", BBTS_COMPANY_ID).gte("movement_date", ini).lte("movement_date", fim);
    const s = (k) => (som || []).reduce((a, r) => a + (Number(r[k]) || 0), 0);
    console.log(`  ${rot.padEnd(7)} ${String(count).padStart(4)} linhas | avista ${brl(s("bbts_pag_avista"))} | seguro ${brl(s("bbts_seguro_pago"))} | bruto ${brl(s("gross_value"))}`);
  }

  console.log("\n=== (2b) as propostas dos 4 PDFs ja estao no daily da ADS? ===");
  const olhar = async (rot, lista) => {
    const { data, error } = await sb.from("daily_production_records")
      .select("proposal_number, movement_date, proposal_date, bbts_pag_avista, bbts_seguro_pago, insurance_value, gross_value, status, j_key, assigned_promoter_id")
      .eq("company_id", BBTS_COMPANY_ID).in("proposal_number", lista);
    if (error) { console.log(`  ${rot}: ERRO ${error.message}`); return; }
    const achadas = new Set((data || []).map(r => String(r.proposal_number)));
    console.log(`  ${rot}: ${lista.length} no PDF | ${achadas.size} JA existem no daily | ${lista.length - achadas.size} ausentes`);
    for (const r of data || []) console.log(`     ${r.proposal_number} mov=${r.movement_date} prop=${r.proposal_date} avista=${brl(r.bbts_pag_avista)} seg=${brl(r.bbts_seguro_pago)} ins=${brl(r.insurance_value)} bruto=${brl(r.gross_value)} ${r.status} ${r.j_key}`);
  };
  await olhar("credito ABRIL", credAbr);
  await olhar("seguro  ABRIL", segAbr);
  await olhar("credito MAIO ", credMai);
  await olhar("seguro  MAIO ", segMai);
  await olhar("PRT     MAIO ", prtMai);

  console.log("\n=== (2c) a 212021557, citada no enunciado ===");
  {
    const { data } = await sb.from("daily_production_records").select("*").eq("proposal_number", "212021557");
    if (!data || !data.length) console.log("  NAO existe no daily (nenhuma empresa).");
    else for (const r of data) console.log(`  company=${r.company_id} mov=${r.movement_date} prop=${r.proposal_date} avista=${r.bbts_pag_avista} seg=${r.bbts_seguro_pago} status=${r.status} jkey=${r.j_key}`);
    console.log("  esta no seguro de maio do PDF?", segMai.includes("212021557"), "| no credito de maio?", credMai.includes("212021557"));
    const { data: menor } = await sb.from("daily_production_records").select("proposal_number, movement_date")
      .eq("company_id", BBTS_COMPANY_ID).gte("movement_date", "2026-06-01").lte("movement_date", "2026-06-30").order("proposal_number").limit(3);
    console.log("  menores propostas do daily de junho da ADS:", (menor||[]).map(r=>r.proposal_number+"@"+r.movement_date).join(", "));
  }

  console.log("\n=== (3) PMR: 2026-04 e 2026-05 estao FECHADAS? ===");
  for (const [y, m] of [[2026,4],[2026,5],[2026,6],[2026,7]]) {
    const { data, error } = await sb.from("promoter_monthly_results").select("source, company_id, total_production, payable").eq("year", y).eq("month", m);
    if (error) { console.log(`  ${y}-${m}: ERRO ${error.message}`); continue; }
    const porSource = {};
    for (const r of data || []) porSource[r.source || "(null)"] = (porSource[r.source || "(null)"] || 0) + 1;
    console.log(`  ${y}-${String(m).padStart(2,"0")}: ${(data||[]).length} linhas | por source: ${JSON.stringify(porSource)}`);
    const daAds = (data||[]).filter(r => r.company_id === BBTS_COMPANY_ID);
    console.log(`            da ADS: ${daAds.length} linha(s)`);
  }
  console.log("\n  --- monthly_closings / regime da competencia ---");
  {
    const { data, error } = await sb.from("monthly_closings").select("*").in("year", [2026]).order("month");
    if (error) console.log("  monthly_closings ERRO:", error.message);
    else for (const r of data || []) console.log(`   ${r.year}-${String(r.month).padStart(2,"0")} ${JSON.stringify(r)}`.slice(0, 240));
  }

  console.log("\n=== (5) os 3 estornos: o que ja existe hoje ===");
  const ORF = ["209621970", "209867885", "211689509"];
  for (const t of ["promoter_debit_sources", "promoter_debit_assignments", "promoter_discounts"]) {
    for (const col of ["operation", "proposal_number", "contract_number", "reference"]) {
      const { data, error } = await sb.from(t).select("*").in(col, ORF);
      if (error) { if (!/column|does not exist|42703/i.test(error.message)) console.log(`  ${t}.${col}: ERRO ${error.message.slice(0,80)}`); continue; }
      console.log(`  ${t}.${col}: ${data.length} linha(s)`);
      for (const r of data) console.log(`     ${JSON.stringify(r).slice(0, 300)}`);
    }
  }
})().catch(e => { console.error("EXCECAO:", e.message); process.exit(1); });
