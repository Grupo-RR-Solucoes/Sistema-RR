/* READ-ONLY. PDF x BANCO, contrato a contrato. E o texto cru da Abertura de Conta. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n = v => Number(v) || 0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}

(async()=>{
  const { extractBbtsClosingFromPdfs } = require("../lib/bbtsPdfExtract.ts");
  const input = await extractBbtsClosingFromPdfs(
    new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf (1).pdf")),
    new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf.pdf")));

  const db = await pageAll(()=> sb.from("daily_production_records")
    .select("proposal_number, gross_value, bbts_pag_avista, bbts_seguro_pago, raw_payload").eq("company_id", ADS));
  const dbBy = new Map(db.map(r=>[String(r.proposal_number).trim(), r]));

  console.log("=== CREDITO: 43 do PDF contra o banco ===");
  let okAv=0, difAv=0, ausente=0, sAvPdf=0, sAvDb=0;
  const difs=[];
  for (const c of input.credito) {
    const k = String(c.contrato).trim();
    const r = dbBy.get(k);
    sAvPdf += n(c.pag_avista);
    if (!r) { ausente++; difs.push(`AUSENTE no banco: ${k} | pag_avista PDF=${f(c.pag_avista)}`); continue; }
    sAvDb += n(r.bbts_pag_avista);
    if (Math.abs(n(c.pag_avista) - n(r.bbts_pag_avista)) < 0.005) okAv++;
    else { difAv++; difs.push(`DIVERGE: ${k} | PDF=${f(c.pag_avista)} | banco=${f(r.bbts_pag_avista)}`); }
  }
  console.log(`contratos do PDF: ${input.credito.length} | batem ao centavo: ${okAv} | divergem: ${difAv} | ausentes no banco: ${ausente}`);
  console.log(`Sigma pag_avista  PDF=${f(sAvPdf)}  banco=${f(sAvDb)}  delta=${f(sAvPdf-sAvDb)}`);
  if (difs.length) console.log(difs.join("\n")); else console.log(">>> 43/43 IDENTICOS <<<");

  console.log("\n=== SEGURO 'calculo' (13 do PDF) contra a COLUNA bbts_seguro_pago ===");
  let sPdf=0, sCol=0; const gaps=[];
  for (const s of (input.seguro||[]).filter(x=>x.tratamento==="calculo")) {
    const k = String(s.contrato).trim(); const r = dbBy.get(k);
    sPdf += n(s.valor_seguro);
    const col = r ? n(r.bbts_seguro_pago) : 0;
    sCol += col;
    if (Math.abs(n(s.valor_seguro)-col) >= 0.005) {
      const meta = r && r.raw_payload && r.raw_payload.__bbts_meta || {};
      gaps.push(`   ${k} | PDF=${f(s.valor_seguro)} | coluna=${f(col)} | raw_payload.seguro_valor_relatorio=${f(meta.seguro_valor_relatorio)} | fonte=${meta.fonte}`);
    }
  }
  console.log(`Sigma seguro calculo  PDF=${f(sPdf)}  coluna=${f(sCol)}  delta=${f(sPdf-sCol)}`);
  if (gaps.length) { console.log("linhas em que a COLUNA nao tem o valor:"); console.log(gaps.join("\n")); }

  console.log("\n=== PRT no banco (competencia 2026-07) ===");
  const prt = await pageAll(()=> sb.from("bbts_prt_parcelas").select("valor_parcela").eq("company_id",ADS).eq("competencia","2026-07-01"));
  console.log(`PDF: ${(input.prt||[]).length} parcelas = ${f((input.prt||[]).reduce((s,r)=>s+n(r.valor_parcela),0))} | banco: ${prt.length} parcelas = ${f(prt.reduce((s,r)=>s+n(r.valor_parcela),0))}`);

  console.log("\n=== 'Abertura de Conta' no TEXTO CRU do PDF de credito ===");
  const { extractText, getDocumentProxy } = require("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/pdf (1).pdf")));
  const { text } = await extractText(doc, { mergePages: true });
  const linhas = String(text).split(/\n/);
  linhas.forEach((ln,i)=>{ if (/Abertura de Conta|Pagamento AVT|Pagamento PRT|TOTAL/i.test(ln)) console.log(`  [linha ${i}] ${ln.trim().slice(0,160)}`); });
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
