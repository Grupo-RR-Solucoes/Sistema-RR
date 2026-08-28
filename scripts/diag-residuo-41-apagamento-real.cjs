/*
 * REPRODUCAO DO APAGAMENTO — caminho REAL do import, banco ESPELHO.
 *
 * SOMENTE SELECT em producao. A escrita vai para o espelho (_fakeDpr.cjs),
 * semeado com os valores REAIS das linhas da ADS.
 *
 * Roteiro:
 *   1. le de producao as linhas da ADS das propostas do PDF de credito  -> ANTES
 *   2. extractBbtsClosingFromPdfs(credito, null)   <- envio SO-CREDITO
 *   3. importBbtsClosing(espelho, input, {dryRun:false})  <- o caminho real
 *   4. le o espelho -> DEPOIS, e compara coluna a coluna
 */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const { createFakeSupabase } = require("./_fakeDpr.cjs");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const CRED = process.env.ADS_PDF_CREDITO || "C:/Users/diego/Downloads/pdf (1).pdf";
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COLS_SEGURO = ["bbts_seguro_pago", "insurance_value", "insurance_net_value", "has_insurance", "insurance_type"];

(async () => {
  const { extractBbtsClosingFromPdfs } = require("../lib/bbtsPdfExtract.ts");
  const { importBbtsClosing } = require("../lib/bbtsClosingImport.ts");

  const input = await extractBbtsClosingFromPdfs(new Uint8Array(fs.readFileSync(CRED)), null);
  const comp = `${input.year}-${String(input.month).padStart(2, "0")}`;
  const propostas = input.credito.map((r) => String(r.contrato).trim());
  console.log(`\n=== ENVIO SO-CREDITO — competencia ${comp}, ${propostas.length} propostas ===`);
  console.log(`    seguro_pdf_ausente = ${input.seguro_pdf_ausente}`);
  console.log(`    _ancoras.seguro_calculo = ${input._ancoras.seguro_calculo}`);

  const { data: antes, error } = await sb
    .from("daily_production_records")
    .select("*")
    .eq("company_id", ADS)
    .in("proposal_number", propostas);
  if (error) throw error;
  const antesByProp = new Map(antes.map((r) => [String(r.proposal_number), r]));
  const comSeguro = antes.filter((r) => Number(r.bbts_seguro_pago) > 0 || Number(r.insurance_value) > 0);
  console.log(`\n--- ANTES (producao, SELECT) ---`);
  console.log(`    linhas da ADS encontradas: ${antes.length}   com seguro gravado: ${comSeguro.length}`);
  console.log(`    Sigma bbts_seguro_pago = ${f(comSeguro.reduce((a, r) => a + (Number(r.bbts_seguro_pago) || 0), 0))}`);
  console.log(`    Sigma insurance_value  = ${f(comSeguro.reduce((a, r) => a + (Number(r.insurance_value) || 0), 0))}`);

  const fake = createFakeSupabase(sb, antes);
  const res = await importBbtsClosing(fake, input, { dryRun: false, fileName: "espelho-so-credito" });
  console.log(`\n--- O IMPORT (espelho, dryRun=false) ---`);
  console.log(`    ancora_ok = ${res.ancora_ok}   gravadas = ${res.gravadas}   com_seguro = ${res.com_seguro}`);
  console.log(`    ancora_detalhe.seguro_calculo = ${JSON.stringify(res.ancora_detalhe.seguro_calculo)}`);

  console.log(`\n--- DEPOIS (espelho) — so as linhas que TINHAM seguro ---`);
  let mudou = 0;
  let perdaPago = 0;
  let perdaBase = 0;
  for (const a of comSeguro) {
    const d = fake._get(ADS, String(a.proposal_number));
    const diffs = COLS_SEGURO.filter((c) => JSON.stringify(a[c]) !== JSON.stringify(d[c]));
    if (diffs.length === 0) continue;
    mudou += 1;
    perdaPago += (Number(a.bbts_seguro_pago) || 0) - (Number(d.bbts_seguro_pago) || 0);
    perdaBase += (Number(a.insurance_value) || 0) - (Number(d.insurance_value) || 0);
    console.log(
      `    ${a.proposal_number}  ` +
        diffs.map((c) => `${c}: ${JSON.stringify(a[c])} -> ${JSON.stringify(d[c])}`).join("   ")
    );
  }
  console.log(`\n=== VEREDITO ===`);
  console.log(`    linhas com seguro alterado pelo envio so-credito: ${mudou} de ${comSeguro.length}`);
  console.log(`    bbts_seguro_pago perdido : ${f(perdaPago)}`);
  console.log(`    insurance_value perdido  : ${f(perdaBase)}`);
  console.log(`    ${mudou === 0 ? "NAO REPRODUZIU o apagamento." : "APAGAMENTO REPRODUZIDO."}`);
})().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exit(1);
});
