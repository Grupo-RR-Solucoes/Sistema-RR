/* READ-ONLY. Varre TODOS os PDFs da ADS em disco: negativos, Cancelamento, Glosa. */
require("./_ts_register.cjs");
const fs = require("fs");
const D = "C:/Users/diego/Downloads/";
const ARQ = ["ADS 40,56 MAIO.pdf","ADS 665,15MAIO.pdf","ADS 58,11 JUNHO.pdf","ADS COMPLEMENTAR JUNHO 1.698,54.pdf","ADS JUNHO 7.714,04.pdf","ADS JULHO 18.844,34.pdf","Crédito ADS-BBTS.pdf","pdf (1).pdf","pdf.pdf","Tabela_de_Pagamento_CréditoPF_Prestamista_30__anonymous.pdf","Tabela_de_Pagamento_CréditoPF_Prestamista_31_07_2026.pdf","Tabela_de_Pagamento_CréditoPF_Prestamista_31__anonymous.pdf"];
const CREDITO_RE = /^(\d{6,})\s+R\$\s*([\d.,]+)\s+(R\$\s*-|-?R\$\s*[\d.,]+)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.,]+)%\s+(\d)\s+(JJ\d+)\s+(.*?)\s+(N[ÃA]O|SIM)\s*$/i;
const SEGURO_RE = /^(\d{6,})\s+([\d.,]+)\s+(\d+)\s+(ESTOQUE D0|ESTOQUE|SLIP NOVO|SLIP)\s+(\d+)\s+([\d.,]+)\s+(POSITIVO|CANCELADO)\s+(\S+)\s+(JJ\d+)\s+([\d.,]+)%\s+(-?R\$\s*[\d.,]+)\s*$/i;
function money(raw){let s=String(raw??"").trim();if(s==="")return 0;const neg=s.includes("-");s=s.replace(/[^\d,.]/g,"");if(s==="")return 0;s=s.replace(/\.(?=\d{3}(\D|$))/g,"").replace(",",".");const x=Number(s);return Number.isFinite(x)?(neg?-x:x):0;}
const f = v => (Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});

(async()=>{
  const { extractLinesFromPdf } = require("../lib/trp/parseTrpPdf.ts");
  const { extractText, getDocumentProxy } = require("unpdf");
  for (const nome of ARQ) {
    const p = D + nome;
    if (!fs.existsSync(p)) { console.log(`\n### ${nome} — NAO EXISTE`); continue; }
    let lines;
    try { lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync(p))); }
    catch(e){ console.log(`\n### ${nome} — ERRO: ${e.message}`); continue; }
    const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(p)));
    const { text } = await extractText(doc, { mergePages: true });
    const t = String(text);

    const cred = [], seg = [];
    for (const ln of lines) { const a = ln.match(CREDITO_RE); if (a) cred.push(a); const b = ln.match(SEGURO_RE); if (b) seg.push(b); }
    console.log(`\n### ${nome}  (credito:${cred.length} seguro:${seg.length})`);

    // cabecalho de totais do credito
    const i = t.indexOf("Pagamento AVT");
    if (i >= 0) {
      const trecho = t.slice(i, i+240).replace(/\s+/g," ");
      const vals = (trecho.match(/-?R\$\s*-?[\d.,]+/g)||[]).slice(0,5).map(money);
      console.log(`  cabecalho: AVT=${f(vals[0])} PRT=${f(vals[1])} ABERTURA=${f(vals[2])} GLOSA=${f(vals[3])} TOTAL=${f(vals[4])}`);
      if (Math.abs(vals[2]) > 0.005) console.log(`     >>> ABERTURA DE CONTA != 0 : ${f(vals[2])}  (NAO capturada pelo parser)`);
      if (Math.abs(vals[3]) > 0.005) console.log(`     >>> GLOSA != 0 : ${f(vals[3])}  (NAO capturada pelo parser)`);
    }
    if (cred.length) {
      const canc = cred.filter(m=>/^SIM$/i.test(m[9]));
      const negAv = cred.filter(m=>money(m[3])<0), negVf = cred.filter(m=>money(m[2])<0);
      console.log(`  credito: Cancelamento=SIM:${canc.length} | pag_avista<0:${negAv.length} | valor_financiado<0:${negVf.length}`);
      for (const m of canc) console.log(`     CANCELADO: ${m[1]} | pag_avista=${f(money(m[3]))}`);
      for (const m of negAv) console.log(`     NEGATIVO : ${m[1]} | pag_avista=${f(money(m[3]))}`);
    }
    if (seg.length) {
      const canc = seg.filter(m=>/CANCELADO/i.test(m[7]));
      const sc = seg.filter(m=>!/CANCELADO/i.test(m[7])).reduce((s,m)=>s+money(m[11]),0);
      const sd = canc.reduce((s,m)=>s+money(m[11]),0);
      console.log(`  seguro: POSITIVO:${seg.length-canc.length} (${f(sc)}) | CANCELADO:${canc.length} (${f(sd)}) | TOTAL=${f(sc+sd)}`);
      for (const m of canc) console.log(`     CANCELADO: ${m[1]} | ${f(money(m[11]))}`);
    }
  }
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
