/* PREDICADO PROPOSTO — "ja carimbada em competencia POSTERIOR a que esta sendo
 * importada". Mede quantas linhas ele excluiria em abril e em maio, e mede
 * TAMBEM o buraco conhecido dele (carimbo NULL nao e "posterior"). READ-ONLY. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { extractBbtsClosingFromPdfs } = require("@/lib/bbtsPdfExtract.ts");
  const DL = "C:/Users/diego/Downloads";
  const PARES = [
    ["ABRIL", "ADS Abril 2026.pdf", "Seguro ADS Abril 2026.pdf"],
    ["MAIO", "ADS Maio 2026.pdf", "Seguro ADs Maio 2026.pdf"],
  ];
  for (const [rot, fc, fsg] of PARES) {
    const input = await extractBbtsClosingFromPdfs(
      new Uint8Array(fs.readFileSync(DL + "/" + fc)),
      new Uint8Array(fs.readFileSync(DL + "/" + fsg))
    );
    const comp = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
    // TODAS as propostas que o import tocaria: credito + seguro (o seguro sem
    // credito no mes vira linha SO-SEGURO e tambem entra no merge).
    const alvo = [...new Set([
      ...input.credito.map(r => String(r.contrato).trim()),
      ...input.seguro.filter(r => r.tratamento === "calculo").map(r => String(r.contrato).trim()),
    ])];
    console.log(`\n############ ${rot} — competencia ${comp} | ${alvo.length} proposta(s) alvo`);

    const { data, error } = await sb.from("daily_production_records")
      .select("proposal_number, bbts_competencia_fechamento, movement_date, bbts_pag_avista, bbts_seguro_pago, gross_value, promoter_source")
      .eq("company_id", ADS).in("proposal_number", alvo);
    if (error) { console.log("  ERRO:", error.message); continue; }
    console.log(`  ja existem no diario da ADS: ${(data || []).length}`);

    const posteriores = (data || []).filter(r => r.bbts_competencia_fechamento && String(r.bbts_competencia_fechamento) > comp);
    const nulos = (data || []).filter(r => !r.bbts_competencia_fechamento);
    const anterioresOuIgual = (data || []).filter(r => r.bbts_competencia_fechamento && String(r.bbts_competencia_fechamento) <= comp);

    console.log(`\n  [A] PREDICADO ACIONA — carimbo POSTERIOR a ${comp}: ${posteriores.length} linha(s)`);
    for (const r of posteriores)
      console.log(`      ${r.proposal_number} carimbo=${r.bbts_competencia_fechamento} mov=${r.movement_date} avista=${brl(r.bbts_pag_avista)} seg=${brl(r.bbts_seguro_pago)} bruto=${brl(r.gross_value)} src=${r.promoter_source}`);
    console.log(`      dinheiro que o predicado PROTEGE: avista ${brl(posteriores.reduce((a,r)=>a+Number(r.bbts_pag_avista||0),0))} | bruto ${brl(posteriores.reduce((a,r)=>a+Number(r.gross_value||0),0))}`);

    console.log(`\n  [B] BURACO CONHECIDO — carimbo NULL (nao e "posterior", logo NAO aciona): ${nulos.length} linha(s)`);
    for (const r of nulos) console.log(`      ${r.proposal_number} mov=${r.movement_date} avista=${brl(r.bbts_pag_avista)}`);
    if (!nulos.length) console.log("      nenhuma — o buraco esta VAZIO hoje para esta competencia");

    console.log(`\n  [C] merge normal (carimbo anterior ou igual): ${anterioresOuIgual.length} linha(s)`);
    for (const r of anterioresOuIgual) console.log(`      ${r.proposal_number} carimbo=${r.bbts_competencia_fechamento}`);
    console.log(`\n  => o import gravaria ${alvo.length - posteriores.length} de ${alvo.length}; ${posteriores.length} ficaria(m) de fora`);
  }

  console.log("\n\n############ CENSO GERAL do predicado no diario da ADS");
  const { data: todas } = await sb.from("daily_production_records")
    .select("bbts_competencia_fechamento").eq("company_id", ADS);
  const por = {};
  for (const r of todas || []) { const k = r.bbts_competencia_fechamento || "NULL"; por[k] = (por[k] || 0) + 1; }
  for (const k of Object.keys(por).sort()) console.log(`  carimbo ${k}: ${por[k]} linha(s)`);
})().catch(e => { console.error("EXCECAO:", e.message); process.exit(1); });
