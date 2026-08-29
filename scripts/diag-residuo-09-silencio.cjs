/* READ-ONLY (dryRun). Importar SO o PDF de credito: (a) o gate acusa a ausencia
   do seguro? (b) o que o merge owner=FULL apagaria nas linhas ja gravadas. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

(async () => {
  const { extractBbtsClosingFromPdfs } = require("../lib/bbtsPdfExtract.ts");
  const { importBbtsClosing } = require("../lib/bbtsClosingImport.ts");
  const cred = new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf (1).pdf"));

  console.log("=== (a) COM os 2 PDFs (credito + seguro) ===");
  const in2 = await extractBbtsClosingFromPdfs(new Uint8Array(cred), new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf.pdf")));
  console.log("   _ancoras:", JSON.stringify(in2._ancoras));
  const r2 = await importBbtsClosing(sb, in2, { dryRun: true, fileName: "dryrun-2pdfs" });
  console.log(`   ancora_ok=${r2.ancora_ok}  seguro_only_lines=${r2.seguro_only_lines}  soma_seguro_calculo=${f(r2.soma_seguro_calculo)}`);
  console.log("   ancora_detalhe:", JSON.stringify(r2.ancora_detalhe));

  console.log("\n=== (b) SO o PDF de credito (seguroFile ausente) ===");
  const in1 = await extractBbtsClosingFromPdfs(new Uint8Array(cred), null);
  console.log("   _ancoras:", JSON.stringify(in1._ancoras));
  const r1 = await importBbtsClosing(sb, in1, { dryRun: true, fileName: "dryrun-so-credito" });
  console.log(`   ancora_ok=${r1.ancora_ok}   <<< PASSA? ${r1.ancora_ok ? "SIM — a ausencia do seguro nao e detectada" : "NAO"}`);
  console.log(`   seguro_only_lines=${r1.seguro_only_lines}  soma_seguro_calculo=${f(r1.soma_seguro_calculo)}  com_seguro=${r1.com_seguro}`);
  console.log("   ancora_detalhe:", JSON.stringify(r1.ancora_detalhe));

  console.log("\n=== (c) O QUE O MERGE (owner=FULL) APAGARIA ===");
  const props = in1.credito.map((r) => String(r.contrato).trim());
  const { data, error } = await sb
    .from("daily_production_records")
    .select("proposal_number, movement_date, bbts_seguro_pago, insurance_value, has_insurance, insurance_type")
    .eq("company_id", ADS)
    .in("proposal_number", props);
  if (error) throw error;
  const afetadas = data.filter((r) => Number(r.bbts_seguro_pago) > 0 || Number(r.insurance_value) > 0);
  let sPago = 0, sIns = 0;
  for (const r of afetadas) { sPago += Number(r.bbts_seguro_pago) || 0; sIns += Number(r.insurance_value) || 0; }
  console.log(`   propostas do PDF de credito: ${props.length}; existentes no banco: ${data.length}; com seguro gravado: ${afetadas.length}`);
  console.log(`   Σ bbts_seguro_pago que iria a ZERO : ${f(sPago)}`);
  console.log(`   Σ insurance_value  que iria a ZERO : ${f(sIns)}`);
  for (const r of afetadas) console.log(`     ${r.proposal_number}  mov=${r.movement_date}  bbts_seguro_pago=${f(r.bbts_seguro_pago)} -> 0   insurance_value=${f(r.insurance_value)} -> 0   has_insurance=${r.has_insurance} -> false`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
