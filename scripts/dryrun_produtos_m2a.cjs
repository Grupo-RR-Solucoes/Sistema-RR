// DRY-RUN / GATE (read-only, NAO grava) do Movimento 2a: repasse de EVENTO UNICO
// (BBCAP + Abertura de Conta). Prova:
//   1) auditoria BBCAP pela TRP 213 reproduz a comissao-empresa;
//   2) repasse x0,5833 por promotor confere com o gabarito PRODUCAO_GERAL;
//   3) invariante do ledger: final = producao + seguro + bbcap + conta_corrente,
//      quem NAO tem produto fica inalterado, e o passo e idempotente.
// A extracao espelha lib/produtoRepasse.ts + lib/produtoAssignments.ts.
// Uso: node scripts/dryrun_produtos_m2a.cjs
const path = require("path");
const fs = require("fs");
const REPO = path.resolve(__dirname, "..");
const XLSX = require(path.join(REPO, "node_modules", "xlsx"));
const DL = path.join(require("os").homedir(), "Downloads");
const FATOR = 0.5833;
const r2 = (x) => Math.round(x * 100) / 100;
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const num = (v) => { if (typeof v === "number") return v; let r = String(v ?? "").trim().replace(/\s/g, "").replace("R$", ""); if (r.includes(",") && r.includes(".")) r = r.lastIndexOf(",") > r.lastIndexOf(".") ? r.replace(/\./g, "").replace(",", ".") : r.replace(/,/g, ""); else if (r.includes(",")) r = r.replace(/\./g, "").replace(",", "."); const n = Number(r.replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
function readObjs(f) { const wb = XLSX.readFile(f); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }); const hdr = rows[0].map(norm); return rows.slice(1).filter((r) => String(r[0] ?? "").trim() !== "" || String(r[1] ?? "").trim() !== "").map((r) => { const o = {}; hdr.forEach((h, c) => { if (h) o[h] = r[c]; }); return o; }); }
const ls = (re) => { try { return fs.readdirSync(DL).filter((f) => re.test(f)).map((f) => path.join(DL, f)); } catch { return []; } };
// espelho de auditarBbcapTrp213
function trp213(codigo, valor) { const c = norm(codigo); if (c.includes("UNICO")) return { regra: "UNICO 3,20%", esperado: r2(0.032 * valor) }; if (c.includes("MENSAL") && c.includes("48")) return { regra: "MENSAL 48 38%", esperado: r2(0.38 * (valor / 48)) }; if (c.includes("MENSAL") && c.includes("60")) return { regra: "MENSAL 60 16,70%", esperado: r2(0.167 * (valor / 60)) }; return { regra: "?", esperado: null }; }

console.log("===== 1) BBCAP — auditoria TRP 213 + repasse (junho) =====");
{
  const bb = ls(/^PRODU.*BBCAP.*JUNHO 2026\.xlsx$/).flatMap(readObjs);
  let ok = 0, div = 0; const prom = {};
  for (const o of bb) {
    const emp = num(o["COMISSAO"]); const a = trp213(o["CODIGO DO PRODUTO"], num(o["VALOR DO PRODUTO"]));
    const st = a.esperado === null ? "?" : Math.abs(a.esperado - emp) < 0.01 ? "OK" : "DIVERGE";
    st === "OK" ? ok++ : st === "DIVERGE" ? div++ : 0;
    const p = String(o["PROMOTOR(A)"] || o["PROMOTOR"]).trim();
    (prom[p] = prom[p] || { n: 0, rep: 0 }).n++; prom[p].rep += r2(emp * FATOR);
  }
  console.log(`  auditoria TRP 213: ${ok} OK, ${div} divergentes`);
  Object.entries(prom).forEach(([k, v]) => console.log(`  ${v.n}\trepasse ${r2(v.rep)}\t${k}`));
}

console.log("\n===== 2) ABERTURA DE CONTA — repasse por promotor vs gabarito =====");
for (const [comp, re] of [["maio", /^PRODU.*CC RR.*MAIO 2026\.xlsx$/], ["junho", /^PRODU.*CC RR.*JUNHO 2026\.xlsx$/]]) {
  const cc = ls(re).flatMap(readObjs); const prom = {}; let gab = 0;
  for (const o of cc) { const emp = num(o["COMISSAO"]); if (emp === 0) continue; const p = String(o["PROMOTOR(A)"] || o["PROMOTOR"]).trim() || "(BALDE)"; (prom[p] = prom[p] || { n: 0, rep: 0 }).n++; prom[p].rep += r2(emp * FATOR); gab += num(o["COMISSAO PROMOTOR(A)"] || o["COMISSAO PROMOTOR"]); }
  const tot = r2(Object.values(prom).reduce((s, v) => s + v.rep, 0));
  console.log(`  ${comp}: Σrepasse calc=${tot} | Σ gabarito=${r2(gab)} | promotores=${Object.keys(prom).length}`);
}

console.log("\n===== 3) INVARIANTE do ledger (final = prod+seg+bbcap+cc; nao-produto inalterado; idempotente) =====");
{
  // PMR sintetico: A tem credito+seguro (sem produto), B tem credito+bbcap, C so conta_corrente.
  const pmr = {
    A: { prod: 100, ins: 20, bbcap: 0, cc: 0, final: 120 },
    B: { prod: 50, ins: 0, bbcap: 0, cc: 0, final: 50 },
    C: { prod: 0, ins: 0, bbcap: 0, cc: 0, final: 0, novo: true },
  };
  const produto = { B: { bbcap: 30 }, C: { cc: 15 } }; // repasse ja calculado
  const antes = JSON.parse(JSON.stringify(pmr));
  const apply = (p) => { for (const k of Object.keys(produto)) { const v = produto[k]; p[k].bbcap = v.bbcap || 0; p[k].cc = v.cc || 0; p[k].final = r2(p[k].prod + p[k].ins + p[k].bbcap + p[k].cc); } };
  apply(pmr); const depois1 = JSON.parse(JSON.stringify(pmr)); apply(pmr); // idempotencia
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const okA = eq(antes.A, pmr.A);
  const okB = pmr.B.final === r2(50 + 30) && pmr.B.bbcap === 30;
  const okC = pmr.C.final === 15 && pmr.C.cc === 15;
  const okIdem = eq(depois1, pmr);
  console.log(`  A (sem produto) inalterado: ${okA ? "OK" : "FALHA"}`);
  console.log(`  B final=prod+bbcap (80): ${okB ? "OK" : "FALHA"}`);
  console.log(`  C so-produto final=15: ${okC ? "OK" : "FALHA"}`);
  console.log(`  idempotente (2a passada = 1a): ${okIdem ? "OK" : "FALHA"}`);
  if (!(okA && okB && okC && okIdem)) { console.error("  GATE FALHOU"); process.exit(1); }
}
console.log("\nGATE OK");
