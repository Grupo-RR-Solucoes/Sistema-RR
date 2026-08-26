/* READ-ONLY. O sinal sobrevive ao parser? E ja houve negativo/cancelado no credito? */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n = v => Number(v)||0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}

// COPIA EXATA de lib/bbtsPdfExtract.ts:33-43
function money(raw){ let s=String(raw??"").trim(); if(s==="")return 0; const negative=s.includes("-"); s=s.replace(/[^\d,.]/g,""); if(s==="")return 0; s=s.replace(/\.(?=\d{3}(\D|$))/g,"").replace(",","."); const x=Number(s); if(!Number.isFinite(x))return 0; return negative?-x:x; }

(async()=>{
  console.log("=== money() nas strings reais do PDF ===");
  for (const s of ["-R$ 1,40","-R$ 24,05","R$ 2,09","R$ 18.737,33","-R$ 1.234,56","R$ -","R$ 0,00"])
    console.log(`  money(${JSON.stringify(s)}) = ${money(s)}`);

  console.log("\n=== o PDF de credito de julho: Cancelamento e negativos ===");
  const { extractBbtsClosingFromPdfs } = require("../lib/bbtsPdfExtract.ts");
  const input = await extractBbtsClosingFromPdfs(
    new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf (1).pdf")),
    new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf.pdf")));
  const cancel = input.credito.filter(r=>r.cancelamento);
  const negAv  = input.credito.filter(r=>n(r.pag_avista)<0);
  const negVf  = input.credito.filter(r=>n(r.valor_financiado)<0);
  const negPrt = (input.prt||[]).filter(r=>n(r.valor_parcela)<0);
  console.log(`linhas de credito: ${input.credito.length}`);
  console.log(`  Cancelamento=SIM : ${cancel.length}`);
  console.log(`  pag_avista < 0   : ${negAv.length}`);
  console.log(`  valor_financiado < 0 : ${negVf.length}`);
  console.log(`  parcela PRT < 0  : ${negPrt.length}`);

  console.log("\n=== BANCO: ja houve negativo ou CANCELADO na ADS, em qualquer competencia? ===");
  const d = await pageAll(()=> sb.from("daily_production_records")
    .select("proposal_number, movement_date, status, gross_value, net_value, insurance_value, bbts_pag_avista, bbts_seguro_pago, bbts_taxa_relatorio").eq("company_id", ADS));
  console.log("linhas ADS no banco: " + d.length);
  const campos = ["gross_value","net_value","insurance_value","bbts_pag_avista","bbts_seguro_pago","bbts_taxa_relatorio"];
  for (const c of campos) {
    const neg = d.filter(r=>n(r[c])<0);
    console.log(`  ${c} < 0 : ${neg.length}` + (neg.length? "  -> " + neg.map(r=>`${r.proposal_number}=${f(r[c])}`).join(", ") : ""));
  }
  const st={}; for(const r of d) st[r.status||"(null)"]=(st[r.status||"(null)"]||0)+1;
  console.log("  status: " + JSON.stringify(st));

  console.log("\n=== BANCO: PRT da ADS, alguma parcela negativa? ===");
  const prt = await pageAll(()=> sb.from("bbts_prt_parcelas").select("proposal_number, competencia, valor_parcela").eq("company_id",ADS));
  const pn = prt.filter(r=>n(r.valor_parcela)<0);
  console.log(`  parcelas: ${prt.length} | negativas: ${pn.length}`);
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
