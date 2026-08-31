/* DIFF TRP39 (agosto) x TRP38 (julho), celula a celula, pelo extrator do REPO.
 * READ-ONLY: nao grava nada, nao sobe regua.
 *
 * DUAS COMPARACOES DE PROPOSITO. Casar celula por ASSINATURA DE BANDA
 * (tx_min/tx_max/prazo) devolve "nada mudou" quando a BBTS/Promotiva RECORTA as
 * bandas — foi a armadilha da regua BBTS de agosto, onde 30 valores baixaram e a
 * comparacao por assinatura acusou 0. Por isso o mesmo diff roda tambem por
 * POSICAO ORDINAL dentro da categoria. */
require("./_ts_register.cjs");
const fs = require("fs");
const DL = "C:/Users/diego/Downloads";
const p4 = (v) => (v == null ? "—" : (Number(v) * 100).toFixed(4) + "%");
const estavel = (v) => JSON.stringify(v, (k, x) =>
  x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x);
const bandaDe = (c) => `${c.tx_min ?? "-"}|${c.tx_max ?? "-"}|${c.prazo_min ?? "-"}|${c.prazo_max ?? "-"}`;
/* OS ARRAYS DE CELULA NAO SE CHAMAM "celulas". A TRP usa celulas_prazo,
 * celulas_taxa_prazo e afins, variando por categoria. Procurar `.celulas` deu
 * ZERO em tudo — inclusive "valores IGUAIS: 0", que e a assinatura de acessador
 * errado e nao de "nada mudou". Aqui os arrays sao descobertos por FORMA:
 * qualquer chave cujo valor seja array de objetos com pelo menos um numero fora
 * dos campos de banda. */
const arraysDeCelula = (cat) => {
  if (!cat || typeof cat !== "object") return [];
  return Object.keys(cat).filter((k) => {
    const v = cat[k];
    return Array.isArray(v) && v.length > 0 && v.every((c) => c && typeof c === "object") &&
      v.some((c) => Object.entries(c).some(([kk, vv]) => !META.has(kk) && typeof vv === "number"));
  });
};
const META = new Set(["tx_min", "tx_max", "prazo_min", "prazo_max"]);
const valores = (c) => Object.fromEntries(Object.entries(c).filter(([k, v]) => !META.has(k) && typeof v === "number"));

(async () => {
  const { buildTrpDraft } = require("@/lib/trp/parseTrpDraft.ts");
  const d38 = await buildTrpDraft(new Uint8Array(fs.readFileSync(DL + "/TRP38 - PROMOTIVA 072026.pdf")), { competencia: "2026-07", sourceFilename: "TRP38", sha256: "38" });
  const d39 = await buildTrpDraft(new Uint8Array(fs.readFileSync(DL + "/TRP39 - PROMOTIVA 082026.pdf")), { competencia: "2026-08", sourceFilename: "TRP39", sha256: "39" });
  const r38 = d38.regraDraft, r39 = d39.regraDraft;

  console.log("=== (3) o que a TRP39 declara ===");
  console.log(`  _meta TRP39: ${JSON.stringify(r39._meta).slice(0, 420)}`);
  console.log(`  _meta TRP38: ${JSON.stringify(r38._meta).slice(0, 260)}`);

  const cats = [...new Set([...Object.keys(r38), ...Object.keys(r39)])].filter((k) => k !== "_meta").sort();
  console.log(`\n=== (1) DIFF por CATEGORIA (${cats.length} categorias) ===`);

  let sobeOrd = 0, desceOrd = 0, igualOrd = 0, bandaRecortada = 0;
  let casamPorBanda = 0, semParBanda = 0;
  const catsMudaram = new Set();

  for (const cat of cats) {
    const a = r38[cat], b = r39[cat];
    const chaves = [...new Set([...arraysDeCelula(a), ...arraysDeCelula(b)])];
    if (chaves.length === 0) continue;
    if (chaves.length > 1) console.log(`
  ${cat}: ${chaves.length} arrays de celula (${chaves.join(", ")}) — comparados um a um`);
    for (const chave of chaves) {
    const ca = a && Array.isArray(a[chave]) ? a[chave] : null;
    const cb = b && Array.isArray(b[chave]) ? b[chave] : null;
    if (!ca && !cb) continue;
    if (!ca) { console.log(`\n  ${cat}: NOVA em agosto (${cb.length} celulas)`); catsMudaram.add(cat); continue; }
    if (!cb) { console.log(`\n  ${cat}: SUMIU em agosto (${ca.length} celulas)`); catsMudaram.add(cat); continue; }

    // --- por ASSINATURA DE BANDA
    const porBanda = new Map(ca.map((c) => [bandaDe(c), c]));
    let mudouBanda = 0;
    for (const c of cb) {
      const par = porBanda.get(bandaDe(c));
      if (!par) { semParBanda++; continue; }
      casamPorBanda++;
      if (estavel(valores(par)) !== estavel(valores(c))) mudouBanda++;
    }

    // --- por POSICAO ORDINAL
    const n = Math.min(ca.length, cb.length);
    const linhas = [];
    for (let i = 0; i < n; i++) {
      const x = ca[i], y = cb[i];
      const bandaMudou = bandaDe(x) !== bandaDe(y);
      if (bandaMudou) bandaRecortada++;
      const vx = valores(x), vy = valores(y);
      for (const k of new Set([...Object.keys(vx), ...Object.keys(vy)])) {
        if (vx[k] === vy[k]) { igualOrd++; continue; }
        if (vy[k] > vx[k]) sobeOrd++; else desceOrd++;
        catsMudaram.add(cat);
        linhas.push(`      [${i}] ${k.padEnd(10)} ${p4(vx[k])} -> ${p4(vy[k])}  ${vy[k] > vx[k] ? "SUBIU " : "BAIXOU"} (${(((vy[k] ?? 0) - (vx[k] ?? 0)) * 100).toFixed(4)} p.p.)` +
          (bandaMudou ? `   [banda recortada: juros ${p4(x.tx_min)}–${p4(x.tx_max)} -> ${p4(y.tx_min)}–${p4(y.tx_max)} · prazo ${x.prazo_min ?? "-"}–${x.prazo_max ?? "-"} -> ${y.prazo_min ?? "-"}–${y.prazo_max ?? "-"}]` : ""));
      }
    }
    if (linhas.length || ca.length !== cb.length || mudouBanda) {
      console.log(`\n  ${cat}  (julho ${ca.length} celulas, agosto ${cb.length})`);
      if (ca.length !== cb.length) console.log(`      NUMERO DE CELULAS MUDOU`);
      console.log(`      por assinatura de banda: ${mudouBanda} celula(s) com valor diferente`);
      for (const l of linhas) console.log(l);
    }
    }
  }

  console.log("\n=== RESUMO ===");
  console.log(`  categorias com mudanca : ${catsMudaram.size} -> ${[...catsMudaram].join(", ") || "(nenhuma)"}`);
  console.log(`  [ordinal] valores que SUBIRAM : ${sobeOrd}`);
  console.log(`  [ordinal] valores que BAIXARAM: ${desceOrd}`);
  console.log(`  [ordinal] valores IGUAIS      : ${igualOrd}`);
  console.log(`  celulas com BANDA recortada   : ${bandaRecortada}`);
  console.log(`  [assinatura] celulas que casaram por banda: ${casamPorBanda} | sem par: ${semParBanda}`);
  if (bandaRecortada > 0 && semParBanda > 0) {
    console.log("  ATENCAO: ha banda recortada E celula sem par — a comparacao por ASSINATURA");
    console.log("           subestima a mudanca. O numero que vale e o ORDINAL.");
  }
  console.log("\nNADA GRAVADO.");
})().catch(e => { console.error("EXCECAO:", e.message, (e.stack || "").slice(0, 400)); process.exit(1); });
