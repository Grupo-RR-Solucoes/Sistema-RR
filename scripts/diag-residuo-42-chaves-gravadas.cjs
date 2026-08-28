/*
 * AS CHAVES QUE A GRAVACAO ESCREVE — medidas na carga REAL do upsert, nao lidas
 * do codigo. SOMENTE SELECT em producao (o import roda contra o espelho).
 *
 * O merge de dono de coluna monta UMA carga por linha existente e a manda em
 * `.upsert(carga, {onConflict:"company_id,proposal_number"})`. As chaves dessa
 * carga SAO as colunas que o UPDATE toca — o que nao esta nela nao e tocado.
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
const SEG = process.env.ADS_PDF_SEGURO || "C:/Users/diego/Downloads/pdf.pdf";
const COLS_SEGURO = new Set([
  "bbts_seguro_pago",
  "insurance_value",
  "insurance_net_value",
  "has_insurance",
  "insurance_type",
]);

(async () => {
  const { extractBbtsClosingFromPdfs } = require("../lib/bbtsPdfExtract.ts");
  const { importBbtsClosing } = require("../lib/bbtsClosingImport.ts");
  // unpdf DESTACA o ArrayBuffer que recebe: cada rodada tem de reler o arquivo.
  for (const [rotulo, comSeguro] of [
    ["COM os 2 PDFs (credito + seguro)", true],
    ["SO o PDF de credito", false],
  ]) {
    const input = await extractBbtsClosingFromPdfs(
      new Uint8Array(fs.readFileSync(CRED)),
      comSeguro ? new Uint8Array(fs.readFileSync(SEG)) : null
    );
    const propostas = input.credito.map((r) => String(r.contrato).trim());
    const { data: antes, error } = await sb
      .from("daily_production_records")
      .select("*")
      .eq("company_id", ADS)
      .in("proposal_number", propostas);
    if (error) throw error;
    const fake = createFakeSupabase(sb, antes);
    await importBbtsClosing(fake, input, { dryRun: false, fileName: "espelho-chaves" });
    const w = fake._writes.filter((x) => x.table === "daily_production_records" && x.updated > 0)[0];
    const chaves = w ? w.keys : [];
    console.log(`\n=== ${rotulo} — seguro_pdf_ausente=${input.seguro_pdf_ausente} ===`);
    console.log(`    linhas no UPDATE: ${w ? w.updated : 0}`);
    console.log(`    ${chaves.length} chaves na carga do upsert:`);
    for (const k of chaves) console.log(`      ${COLS_SEGURO.has(k) ? "SEGURO >>" : "         "} ${k}`);
    console.log(
      `    chaves de SEGURO na carga: ${chaves.filter((k) => COLS_SEGURO.has(k)).join(", ") || "(nenhuma)"}`
    );
  }
})().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exit(1);
});
