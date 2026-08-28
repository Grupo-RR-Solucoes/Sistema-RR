/* READ-ONLY. A linha de R$ 89,42 existe? Onde? E quanto o seguro da ADS de
   julho soma HOJE no banco, contra o que o PDF declara. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

(async () => {
  console.log("=== (1) o predicado EXATO do SQL 3, rodado agora ===");
  const { data: p, error: e1 } = await sb
    .from("daily_production_records")
    .select("id, proposal_number, movement_date, bbts_seguro_pago, raw_payload->__bbts_meta->>seguro_valor_relatorio")
    .eq("company_id", ADS)
    .filter("raw_payload->__bbts_meta->>fonte", "eq", "fechamento_pdf_seguro_only")
    .is("bbts_seguro_pago", null);
  if (e1) throw e1;
  console.log(`  linhas que o UPDATE tocaria AGORA: ${p.length}`);
  for (const r of p) console.log(`    id=${r.id} prop=${r.proposal_number} mov=${r.movement_date} bbts_seguro_pago=NULL -> ${r.seguro_valor_relatorio}`);

  console.log("\n=== (2a) o id que eu reportei ainda existe? ===");
  const { data: a } = await sb.from("daily_production_records").select("id, proposal_number, movement_date, bbts_seguro_pago, raw_payload->__bbts_meta->>fonte, updated_at").eq("id", "5240028e-464b-428a-870d-86576c31dfc6");
  console.log(a && a.length ? `  SIM: ${JSON.stringify(a[0])}` : "  NAO existe mais");

  console.log("\n=== (2b) o id citado por voce existe? ===");
  const { data: b } = await sb.from("daily_production_records").select("id").eq("id", "0dc42962-4bcc-4a55-af16-7c9483c1b41c");
  console.log(b && b.length ? `  SIM: ${JSON.stringify(b[0])}` : "  NAO existe em daily_production_records");

  console.log("\n=== (2c) proposta 221262790, em QUALQUER empresa ===");
  const { data: c } = await sb.from("daily_production_records").select("id, company_id, proposal_number, movement_date, bbts_seguro_pago, insurance_value, raw_payload->__bbts_meta->>fonte, updated_at").or("proposal_number.eq.221262790,contract_number.eq.221262790");
  console.log(`  linhas: ${c ? c.length : 0}`);
  for (const r of c || []) console.log(`    ${JSON.stringify(r)}`);

  console.log("\n=== (2d) bbts_seguro_pago = 89.42 em QUALQUER lugar ===");
  const { data: d } = await sb.from("daily_production_records").select("id, company_id, proposal_number, movement_date, bbts_seguro_pago").eq("bbts_seguro_pago", 89.42);
  console.log(`  linhas: ${d ? d.length : 0}`);
  for (const r of d || []) console.log(`    ${JSON.stringify(r)}`);

  console.log("\n=== (2e) fonte='fechamento_pdf_seguro_only', SEM filtro de NULL ===");
  const { data: e } = await sb.from("daily_production_records").select("id, proposal_number, movement_date, bbts_seguro_pago, updated_at").eq("company_id", ADS).filter("raw_payload->__bbts_meta->>fonte", "eq", "fechamento_pdf_seguro_only");
  console.log(`  linhas: ${e ? e.length : 0}`);
  for (const r of e || []) console.log(`    id=${r.id} prop=${r.proposal_number} mov=${r.movement_date} bbts_seguro_pago=${r.bbts_seguro_pago === null ? "NULL" : f(r.bbts_seguro_pago)} updated_at=${r.updated_at}`);

  console.log("\n=== (4) seguro da ADS de julho no banco HOJE ===");
  const { data: jul } = await sb.from("daily_production_records")
    .select("proposal_number, movement_date, bbts_seguro_pago")
    .eq("company_id", ADS).not("bbts_seguro_pago", "is", null).neq("bbts_seguro_pago", 0)
    .gte("movement_date", "2026-07-01").lte("movement_date", "2026-07-31");
  const soma = (jul || []).reduce((a, r) => a + (Number(r.bbts_seguro_pago) || 0), 0);
  console.log(`  linhas com bbts_seguro_pago != 0 em movement_date de julho: ${jul ? jul.length : 0}`);
  for (const r of (jul || []).sort((x, y) => x.proposal_number.localeCompare(y.proposal_number))) console.log(`    ${r.proposal_number}  mov=${r.movement_date}  ${f(r.bbts_seguro_pago)}`);
  console.log(`  >>> Sigma bbts_seguro_pago julho = ${f(soma)}`);
  console.log(`  >>> PDF de seguro 07/26: 'calculo' = 204,52 | 'debito' = -49,45 | ancora TOTAL = 155,07`);
  console.log(`  >>> a coluna guarda so os 'calculo', entao o alvo e 204,52. Falta: ${f(204.52 - soma)}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
