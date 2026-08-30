/* Foto do estado do banco, para comparar ANTES x DEPOIS. READ-ONLY. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
(async () => {
  const rot = process.argv[2] || "";
  const { data: dpr } = await sb.from("daily_production_records")
    .select("proposal_number, bbts_competencia_fechamento, bbts_pag_avista, bbts_seguro_pago, gross_value, movement_date, promoter_source").eq("company_id", ADS);
  const porCar = {};
  for (const r of dpr || []) {
    const k = r.bbts_competencia_fechamento ? String(r.bbts_competencia_fechamento).slice(0,10) : "NULL";
    porCar[k] = porCar[k] || { n: 0, avista: 0, seguro: 0, bruto: 0 };
    porCar[k].n++; porCar[k].avista += Number(r.bbts_pag_avista)||0; porCar[k].seguro += Number(r.bbts_seguro_pago)||0; porCar[k].bruto += Number(r.gross_value)||0;
  }
  console.log(`### FOTO ${rot} — daily da ADS por CARIMBO`);
  for (const k of Object.keys(porCar).sort()) {
    const v = porCar[k];
    console.log(`  ${k.padEnd(11)} ${String(v.n).padStart(3)} linhas | avista ${f(v.avista).padStart(11)} | seguro ${f(v.seguro).padStart(8)} | bruto ${f(v.bruto).padStart(13)}`);
  }
  const { data: tot } = await sb.from("bbts_fechamento_totais").select("*").order("competencia");
  console.log("  bbts_fechamento_totais:");
  for (const t of tot || []) console.log(`    ${t.competencia} avt=${f(t.pagamento_avt)} prt=${f(t.pagamento_prt)} abert=${f(t.abertura_conta)} glosa=${f(t.glosa)} total=${f(t.pagamento_total)} seg_total=${t.seguro_total==null?"NULL":f(t.seguro_total)}`);
  const { data: prt } = await sb.from("bbts_prt_parcelas").select("competencia, n_parcela, valor_parcela");
  const pp = {}; for (const r of prt||[]) { const k=String(r.competencia).slice(0,10); pp[k]=pp[k]||{n:0,v:0,zero:0}; pp[k].n++; pp[k].v+=Number(r.valor_parcela)||0; if(Number(r.n_parcela)===0) pp[k].zero++; }
  console.log("  bbts_prt_parcelas:");
  for (const k of Object.keys(pp).sort()) console.log(`    ${k} ${pp[k].n} parcelas = ${f(pp[k].v)} | n_parcela=0 em ${pp[k].zero}`);
  const alvo = (dpr||[]).find(r => r.proposal_number === "212021557");
  console.log(`  212021557: ${alvo ? `carimbo=${String(alvo.bbts_competencia_fechamento).slice(0,10)} avista=${f(alvo.bbts_pag_avista)} bruto=${f(alvo.gross_value)} mov=${alvo.movement_date} src=${alvo.promoter_source}` : "AUSENTE"}`);
  const { data: pmr } = await sb.from("promoter_monthly_results").select("source").eq("year",2026).eq("month",5);
  const bs = {}; for (const r of pmr||[]) bs[r.source||"(null)"]=(bs[r.source||"(null)"]||0)+1;
  console.log(`  PMR 2026-05: ${(pmr||[]).length} linhas ${JSON.stringify(bs)}`);
  const ORF=["209621970","209867885","211689509"];
  const { data: src } = await sb.from("promoter_debit_sources").select("id").in("operation",ORF);
  const { data: asg } = await sb.from("promoter_debit_assignments").select("id,status,estorno_amount").in("operation",ORF);
  const { data: deb } = await sb.from("promoter_debits").select("id").eq("company_id",ADS).eq("debit_type","CANCELAMENTO_SEGURO");
  console.log(`  estornos: debit_sources=${(src||[]).length} assignments=${(asg||[]).length} (${(asg||[]).map(a=>a.estorno_amount+"/"+a.status).join(" ")}) promoter_debits CANCELAMENTO_SEGURO da ADS=${(deb||[]).length}`);
})();
