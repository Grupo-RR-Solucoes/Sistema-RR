/* READ-ONLY. Varre TODO PDF em disco e diz qual e fechamento de CREDITO da ADS
   (teste objetivo: contem a ancora "Pagamento AVT" que o parser exige). */
const fs = require("fs");
const path = require("path");

const DIRS = [
  "C:/Users/diego/Downloads",
  "C:/Users/diego/Documents/Codex/2026-04-20-files-mentioned-by-the-user-sistema/repo/Sistema-RR-main",
];

(async () => {
  const { extractText, getDocumentProxy } = require("unpdf");
  const alvos = [];
  for (const d of DIRS) {
    let ents = [];
    try { ents = fs.readdirSync(d); } catch { continue; }
    for (const e of ents) if (/\.pdf$/i.test(e)) alvos.push(path.join(d, e));
  }
  console.log(`PDFs varridos: ${alvos.length}\n`);
  for (const f of alvos) {
    let t = "";
    try {
      const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(f)));
      t = String((await extractText(doc, { mergePages: true })).text || "");
    } catch (e) { continue; }
    const temAVT = /Pagamento\s*AVT/i.test(t);
    const temSeg = /Valor para Emiss[aã]o da Nota Fiscal/i.test(t) && /ESTOQUE|SLIP/i.test(t);
    if (!temAVT && !temSeg) continue;
    const mc = t.match(/m[eê]s\s*(\d{2})\/(\d{2})/i);
    console.log(`${temAVT ? "CREDITO" : "SEGURO "}  comp=${mc ? `20${mc[2]}-${mc[1]}` : "??"}  ${f}`);
  }
})().catch(e => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
