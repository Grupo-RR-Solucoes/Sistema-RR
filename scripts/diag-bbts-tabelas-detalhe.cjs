require("./_ts_register.cjs");
const fs = require("fs"), crypto = require("crypto");
const DL = "C:/Users/diego/Downloads";
(async () => {
  const { buildBbtsDraft } = require("@/lib/bbts/buildBbtsDraft.ts");
  const { parseBbtsPdf } = require("@/lib/bbts/parseBbtsPdf.ts");
  for (const arq of ["Tabela_de_Pagamento_CréditoPF_Prestamista_30__anonymous.pdf",
                     "Tabela_de_Pagamento_CréditoPF_Prestamista_31_07_2026.pdf",
                     "Tabela_de_Pagamento_CréditoPF_Prestamista_31__anonymous 2.pdf"]) {
    const buf = fs.readFileSync(DL + "/" + arq);
    console.log("\n" + "=".repeat(70) + "\n" + arq);
    const crua = await parseBbtsPdf(new Uint8Array(buf));
    console.log(`  vigencia PDF: ${crua.vigenciaPdf}`);
    console.log(`  grupos CRUS lidos do PDF: ${crua.grupos ? Object.keys(crua.grupos).length : "?"} -> ${crua.grupos ? Object.keys(crua.grupos).join(", ").slice(0,220) : ""}`);
    try {
      const d = await buildBbtsDraft(new Uint8Array(buf), { sourceFilename: arq, sha256: crypto.createHash("sha256").update(buf).digest("hex") });
      console.log(`  DRAFT OK`);
      console.log(`    meta: ${JSON.stringify(d.meta).slice(0, 300)}`);
      console.log(`    grupos na regua: ${Object.keys(d.regraDraft.grupos || d.regraDraft.credito || {}).length}`);
      console.log(`    seguro: ${d.regraDraft.seguro ? JSON.stringify(d.regraDraft.seguro).slice(0,200) : "AUSENTE"}`);
      console.log(`    conferir: ${(d.confianca.conferir||[]).length} item(ns)`);
      for (const c of (d.confianca.conferir||[]).slice(0,3)) console.log(`      ${JSON.stringify(c).slice(0,160)}`);
    } catch (e) {
      console.log(`  LANCOU ${e.constructor.name}: ${e.message}`);
      if (e.detalhe) console.log(`    detalhe: ${String(e.detalhe).slice(0, 500)}`);
      for (const k of Object.keys(e)) if (k !== "message") console.log(`    ${k}: ${String(JSON.stringify(e[k])).slice(0,400)}`);
    }
  }
})();
