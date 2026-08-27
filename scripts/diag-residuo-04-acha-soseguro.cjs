/* READ-ONLY. Onde estao as linhas so-seguro? Varre por fonte no raw_payload e por
   forma (gross_value=0 e insurance_value>0) dentro da empresa da ADS. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  // 1) qual e a company_id da ADS/BBTS
  const { data: comps } = await sb.from("companies").select("id, name");
  console.log("=== companies ===");
  for (const c of comps || []) console.log(`  ${c.id}  ${c.name}`);

  // 2) product_description distintos que contem SEGURO
  const { data: pd, error: e2 } = await sb
    .from("daily_production_records")
    .select("product_description")
    .ilike("product_description", "%SEGURO%");
  if (e2) throw e2;
  const cnt = new Map();
  for (const r of pd) cnt.set(r.product_description, (cnt.get(r.product_description) || 0) + 1);
  console.log(`\n=== product_description ILIKE '%SEGURO%' (${pd.length} linhas) ===`);
  for (const [k, v] of [...cnt].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${JSON.stringify(k)}`);

  // 3) por FONTE no raw_payload
  const { data: fs1, error: e3 } = await sb
    .from("daily_production_records")
    .select("id, proposal_number, movement_date, product_description, gross_value, insurance_value, bbts_seguro_pago, raw_payload")
    .filter("raw_payload->__bbts_meta->>fonte", "eq", "fechamento_pdf_seguro_only");
  if (e3) throw e3;
  console.log(`\n=== raw_payload.__bbts_meta.fonte = 'fechamento_pdf_seguro_only' : ${fs1.length} linhas ===`);
  for (const r of fs1) console.log(`  prop=${r.proposal_number} mov=${r.movement_date} pd=${JSON.stringify(r.product_description)} gross=${f(r.gross_value)} ins=${f(r.insurance_value)} bbts_seguro_pago=${r.bbts_seguro_pago === null ? "NULL" : f(r.bbts_seguro_pago)} rel=${f(r.raw_payload?.__bbts_meta?.seguro_valor_relatorio)}`);

  // 4) todas as fontes __bbts_meta existentes
  const { data: allb, error: e4 } = await sb
    .from("daily_production_records")
    .select("raw_payload->__bbts_meta->>fonte")
    .not("raw_payload->__bbts_meta->>fonte", "is", null);
  if (e4) throw e4; 
  const cf = new Map();
  for (const r of allb) cf.set(r.fonte, (cf.get(r.fonte) || 0) + 1);
  console.log(`\n=== fontes __bbts_meta (${allb.length} linhas) ===`);
  for (const [k, v] of [...cf].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
