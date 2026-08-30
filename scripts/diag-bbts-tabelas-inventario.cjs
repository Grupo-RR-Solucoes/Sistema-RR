/* FRENTE 1 — inventario das tabelas BBTS em disco, pelo extrator de PRODUCAO
 * (buildBbtsDraft, o mesmo que /api/bbts/parse chama). READ-ONLY, nao grava. */
require("./_ts_register.cjs");
const fs = require("fs");
const crypto = require("crypto");
const DL = "C:/Users/diego/Downloads";
(async () => {
  const { buildBbtsDraft } = require("@/lib/bbts/buildBbtsDraft.ts");
  const { parseBbtsPdf } = require("@/lib/bbts/parseBbtsPdf.ts");
  const arquivos = fs.readdirSync(DL).filter(f => /Tabela_de_Pagamento.*Prestamista.*\.pdf$/i.test(f)).sort();
  const vistos = new Map();
  for (const arq of arquivos) {
    const buf = fs.readFileSync(DL + "/" + arq);
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    console.log("\n" + "=".repeat(74));
    console.log(`${arq}`);
    console.log(`  ${buf.length} bytes | sha256 ${sha.slice(0, 16)}…`);
    if (vistos.has(sha)) { console.log(`  DUPLICATA EXATA de "${vistos.get(sha)}" — mesmo conteudo, nome diferente`); continue; }
    vistos.set(sha, arq);
    try {
      const crua = await parseBbtsPdf(new Uint8Array(buf));
      console.log(`  vigencia impressa no PDF : ${crua.vigenciaPdf || "NAO ENCONTRADA"}`);
    } catch (e) { console.log(`  parseBbtsPdf LANCOU: ${e.message.slice(0, 160)}`); }
    try {
      const d = await buildBbtsDraft(new Uint8Array(buf), { sourceFilename: arq, sha256: sha });
      console.log(`  buildBbtsDraft: PASSA`);
      console.log(`    competencia deduzida : ${d.competencia}`);
      console.log(`    vigencia             : ${d.validFrom} -> ${d.validUntil}`);
      const r = d.regra || {};
      const grupos = r.credito ? Object.keys(r.credito) : [];
      console.log(`    grupos de credito    : ${grupos.length} (${grupos.slice(0,6).join(", ")}${grupos.length>6?"…":""})`);
      console.log(`    tem secao seguro     : ${r.seguro ? "SIM ("+Object.keys(r.seguro).join(", ")+")" : "NAO"}`);
      if (d.confianca) console.log(`    confianca            : ${JSON.stringify(d.confianca).slice(0,200)}`);
      if (d.avisos && d.avisos.length) for (const a of d.avisos.slice(0,4)) console.log(`    AVISO: ${String(a).slice(0,150)}`);
    } catch (e) {
      console.log(`  buildBbtsDraft LANCOU (${e.constructor.name}): ${e.message.slice(0, 400)}`);
    }
  }
})().catch(e => { console.error("EXCECAO:", e.message); process.exit(1); });
