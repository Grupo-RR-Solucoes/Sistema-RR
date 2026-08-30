/* FASE A — as 3 consultas que caíram por nome de coluna, mais a SIMULACAO do
 * merge da 212021557 (a linha que ja existe). READ-ONLY em tudo: a simulacao
 * usa ownedColumnsFor, que e funcao PURA, e nao chama mergeDailyProductionRecords. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  console.log("=== (1) bbts_fechamento_totais — o que existe hoje ===");
  {
    const { data, error } = await sb.from("bbts_fechamento_totais").select("*").order("competencia");
    if (error) console.log("  ERRO:", error.message);
    else if (!data.length) console.log("  ZERO linhas na tabela inteira (a tabela EXISTE).");
    else { console.log(`  colunas: ${Object.keys(data[0]).join(", ")}`); for (const r of data) console.log(`  ${r.competencia} avt=${brl(r.pagamento_avt)} prt=${brl(r.pagamento_prt)} abert=${brl(r.abertura_conta)} glosa=${brl(r.glosa)} total=${brl(r.pagamento_total)} seg_total=${r.seguro_total==null?"NULL":brl(r.seguro_total)} arq=${r.arquivo_origem}`); }
  }

  console.log("\n=== (3) promoter_monthly_results — colunas reais + abril/maio ===");
  {
    const { data: um } = await sb.from("promoter_monthly_results").select("*").limit(1);
    if (um && um.length) console.log("  colunas:", Object.keys(um[0]).join(", "));
    for (const [y, m] of [[2026,3],[2026,4],[2026,5],[2026,6],[2026,7],[2026,8]]) {
      const { data, error } = await sb.from("promoter_monthly_results").select("source, company_id").eq("year", y).eq("month", m);
      if (error) { console.log(`  ${y}-${m}: ERRO ${error.message}`); continue; }
      const bySrc = {};
      for (const r of data || []) bySrc[r.source || "(null)"] = (bySrc[r.source || "(null)"] || 0) + 1;
      const ads = (data||[]).filter(r => r.company_id === ADS).length;
      console.log(`  ${y}-${String(m).padStart(2,"0")}: ${(data||[]).length} linhas | source: ${JSON.stringify(bySrc)} | da ADS: ${ads}`);
    }
  }

  console.log("\n=== (3b) daily_imports / bbts_prt_parcelas por competencia ===");
  {
    const { data, error } = await sb.from("bbts_prt_parcelas").select("competencia, proposal_number, valor_parcela").order("competencia");
    if (error) console.log("  bbts_prt_parcelas ERRO:", error.message);
    else {
      const por = {};
      for (const r of data || []) { por[r.competencia] = por[r.competencia] || { n: 0, v: 0 }; por[r.competencia].n++; por[r.competencia].v += Number(r.valor_parcela) || 0; }
      for (const k of Object.keys(por).sort()) console.log(`  ${k}: ${por[k].n} parcela(s) = ${brl(por[k].v)}`);
      if (!data.length) console.log("  ZERO linhas.");
    }
  }

  console.log("\n=== (2c) SIMULACAO: o que o import de MAIO escreveria na 212021557 ===");
  {
    const { ownedColumnsFor } = require("@/lib/dailyRecordMerge.ts");
    // O registro que o bloco 3b (seguro SEM credito no mes) montaria, com os
    // valores do PDF de maio: contrato 212021557, POSITIVO, base R$ 4.254,32.
    const rec = {
      company_id: ADS, proposal_number: "212021557", j_key: "JJ552710",
      promoter_id: null, original_promoter_id: null, assigned_promoter_id: null,
      promoter_source: "MASTER_REASSIGNED", contract_number: "212021557",
      product_description: "SEGURO (sem credito no mes)",
      convenio_code: null, convenio_type: null, convenio_segment: null,
      gross_value: 0, net_value: 0,
      insurance_value: 4254.32, insurance_net_value: 4254.32, insurance_type: "ESTOQUE D0", has_insurance: true,
      interest_rate: null, term_months: null, installments: null, status: "PRODUCAO",
      proposal_date: "2026-05-15", movement_date: "2026-05-15", contract_date: "2026-05-15",
      bbts_pag_avista: 0, bbts_seguro_pago: 4.25,
      bbts_competencia_fechamento: "2026-05-01", is_srcc_restricted: false,
      promoter_commission_amount: null, promoter_commission_percent: null,
      insurance_commission_amount: null, insurance_commission_percent: null, raw_payload: {},
    };
    const owned = ownedColumnsFor("FULL", rec);
    console.log("  colunas que o dono FULL SOBRESCREVE nesta linha existente:");
    console.log("   ", owned.join(", "));
    const { data } = await sb.from("daily_production_records").select("*").eq("company_id", ADS).eq("proposal_number", "212021557").maybeSingle();
    console.log("\n  ANTES (o que esta no banco hoje) -> DEPOIS (o que o import gravaria):");
    for (const c of owned) {
      const antes = data ? data[c] : "(sem linha)";
      const depois = rec[c];
      const mudou = String(antes) !== String(depois);
      if (mudou) console.log(`    ${mudou ? "MUDA  " : "igual "} ${c.padEnd(30)} ${String(antes).slice(0,40).padEnd(42)} -> ${String(depois).slice(0,40)}`);
    }
    console.log("\n  IMPACTO no total de JUNHO da ADS (a linha sai de junho):");
    console.log(`    bbts_pag_avista de junho hoje: 7.707,03 (ancora do PDF de junho)`);
    console.log(`    esta linha carrega ${brl(data?.bbts_pag_avista)} de avista e ${brl(data?.gross_value)} de bruto`);
    console.log(`    junho ficaria com ${brl(7707.03 - Number(data?.bbts_pag_avista || 0))} de avista — a ancora de junho DEIXA de fechar`);
  }

  console.log("\n=== (5) os 3 estornos — a ficha completa ===");
  {
    const ORF = ["209621970", "209867885", "211689509"];
    const { data: src } = await sb.from("promoter_debit_sources").select("*").in("operation", ORF);
    const ids = [...new Set((src||[]).map(r => r.debit_id).filter(Boolean))];
    console.log(`  promoter_debit_sources: ${(src||[]).length} | debit_id(s): ${ids.join(", ") || "-"}`);
    if (ids.length) {
      const { data: deb, error } = await sb.from("promoter_debits").select("*").in("id", ids);
      if (error) console.log("  promoter_debits ERRO:", error.message);
      else for (const d of deb || []) console.log(`   promoter_debits ${JSON.stringify(d)}`.slice(0, 340));
    }
    const { data: asg } = await sb.from("promoter_debit_assignments").select("*").in("operation", ORF);
    for (const a of asg || []) console.log(`   assignment ${a.operation} ${a.year}-${a.month} ${a.estorno_amount} status=${a.status} promoter=${a.promoter_id}`);
  }
})().catch(e => { console.error("EXCECAO:", e.message, e.stack); process.exit(1); });
