/* A planilha de agosto x a TRP39, casando por BANDA e nao so por valor.
 * Usa o parser REAL (parsePromoterRemunerationWorkbook). READ-ONLY. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const XLSX_PATH = "C:/Users/diego/Downloads/RRCRED/TABELA DE REMUNERAÇÃO/Tabela de Remuneração AGOSTO 2026.xlsx";
const DL = "C:/Users/diego/Downloads";
const EPS = 1e-9, TETO = 5.8, SHARE = 0.5833;
const n4 = (v) => (v == null ? "—" : Number(v).toFixed(4));
const pctS = (v) => (v == null ? "aberta" : Number(v).toFixed(2));
const MAPA = { "Credito nao consignado": "NAO_CONSIGNADO", "SP e MG": "CONSIG_SP_MG", "Publico geral": "CONSIG_PUBLICO", "SIAPE": "SIAPE", "INSS novo": "INSS_NOVO", "INSS refin": "INSS_RENOV", "Privado CLT": "CONSIG_PRIVADO", "FGTS": "FGTS", "13 salario": "ADIANTAMENTO_13", "Portabilidade publico": "PORTAB_PUBLICO", "Portabilidade privado": "PORTAB_PRIVADO" };
const META = new Set(["tx_min", "tx_max", "prazo_min", "prazo_max"]);
const arrays = (c) => !c || typeof c !== "object" ? [] : Object.keys(c).filter((k) => {
  const v = c[k];
  return Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object") &&
    v.some((x) => Object.entries(x).some(([kk, vv]) => !META.has(kk) && typeof vv === "number"));
});
/** todas as celulas da categoria, em ordem, com banda em % e Faixa 3 em %. */
function celulasF3(regra, cat) {
  const c = regra[cat]; if (!c) return [];
  const out = [];
  for (const ch of arrays(c)) for (const cel of c[ch]) {
    if (typeof cel["Faixa 3"] !== "number") continue;
    out.push({ txMin: cel.tx_min == null ? null : cel.tx_min * 100, txMax: (cel.tx_max == null || cel.tx_max > 100) ? null : cel.tx_max * 100, f3: cel["Faixa 3"] * 100 });
  }
  return out;
}

(async () => {
  const { parsePromoterRemunerationWorkbook } = require("@/lib/promoterRemuneration.js");
  const { buildTrpDraft } = require("@/lib/trp/parseTrpDraft.ts");
  const t39 = (await buildTrpDraft(new Uint8Array(fs.readFileSync(DL + "/TRP39 - PROMOTIVA 082026.pdf")), { competencia: "2026-08", sourceFilename: "T39", sha256: "39" })).regraDraft;

  const st = fs.statSync(XLSX_PATH);
  console.log(`planilha lida: ${XLSX_PATH.split("/").pop()}`);
  console.log(`  modificada em ${st.mtime.toISOString().slice(0, 16).replace("T", " ")} | ${st.size} bytes`);
  const nova = parsePromoterRemunerationWorkbook({ buffer: fs.readFileSync(XLSX_PATH), year: 2026, month: 8, fileName: "Tabela de Remuneração AGOSTO 2026.xlsx" });
  const prNova = nova.productionRules || [];
  console.log(`  productionRules: ${prNova.length}`);

  // ---------- (4) diferenca contra o que foi importado em 04/08
  console.log("\n=== (4) a planilha em disco x a importada em 04/08 (audit_logs) ===");
  const { data } = await sb.from("audit_logs").select("created_at,payload").eq("entity_name", "promoter_remuneration_table").order("created_at", { ascending: false }).limit(8);
  const log = (data || []).find((r) => r.payload && r.payload.year === 2026 && r.payload.month === 8);
  const prVelha = (log && log.payload.productionRules) || [];
  console.log(`  importada em ${String(log.created_at).slice(0, 10)} | ${prVelha.length} regras`);
  const chave = (r) => `${r.label}|${r.rate_from}|${r.rate_to}|${r.term_from}|${r.term_to}`;
  const mVelha = new Map(prVelha.map((r) => [chave(r), r]));
  let iguais = 0; const difs = [];
  for (const r of prNova) {
    const v = mVelha.get(chave(r));
    if (!v) { difs.push({ tipo: "SO NA NOVA", r }); continue; }
    if (Math.abs(Number(v.received_percent) - Number(r.received_percent)) < 0.0005) iguais++;
    else difs.push({ tipo: "VALOR MUDOU", r, de: v.received_percent, para: r.received_percent });
  }
  for (const v of prVelha) if (!prNova.some((r) => chave(r) === chave(v))) difs.push({ tipo: "SO NA VELHA", r: v });
  console.log(`  regras identicas: ${iguais} | diferencas: ${difs.length}`);
  for (const d of difs) {
    if (d.tipo === "VALOR MUDOU") console.log(`    ${d.tipo}  ${String(d.r.label).padEnd(24)} tx ${pctS(d.r.rate_from)}..${pctS(d.r.rate_to)}  ${n4(d.de)} -> ${n4(d.para)}`);
    else console.log(`    ${d.tipo}  ${String(d.r.label).padEnd(24)} tx ${pctS(d.r.rate_from)}..${pctS(d.r.rate_to)} recebido ${n4(d.r.received_percent)}`);
  }

  // ---------- (1)(2) casando por BANDA contra a TRP39
  console.log("\n=== (1)(2) BANDAS: planilha x TRP39 (Faixa 3) ===");
  const porLabel = {};
  for (const r of prNova) { (porLabel[r.label] = porLabel[r.label] || []).push(r); }
  const divergencias = [];
  for (const label of Object.keys(porLabel)) {
    const cat = MAPA[label]; if (!cat) continue;
    const trp = celulasF3(t39, cat); if (!trp.length) continue;
    const pl = porLabel[label];
    const bandaIgual = pl.length === trp.length && pl.every((r, i) =>
      Math.abs(Number(r.rate_from) - (trp[i].txMin ?? Number(r.rate_from))) < 0.005 &&
      ((r.rate_to == null && trp[i].txMax == null) || (r.rate_to != null && trp[i].txMax != null && Math.abs(Number(r.rate_to) - trp[i].txMax) < 0.005)));
    console.log(`\n  ${label}  (planilha ${pl.length} linhas, TRP39 ${trp.length} celulas)  bandas ${bandaIgual ? "IGUAIS" : "DIVERGEM"}`);
    if (bandaIgual) continue;
    const n = Math.max(pl.length, trp.length);
    for (let i = 0; i < n; i++) {
      const r = pl[i], c = trp[i];
      const bp = r ? `${pctS(r.rate_from)}..${pctS(r.rate_to)}` : "—";
      const bt = c ? `${pctS(c.txMin)}..${pctS(c.txMax)}` : "—";
      const marca = (r && c && (Math.abs(Number(r.rate_from) - (c.txMin ?? 0)) > 0.005 || (r.rate_to == null) !== (c.txMax == null) || (r.rate_to != null && c.txMax != null && Math.abs(Number(r.rate_to) - c.txMax) > 0.005))) ? " <== BANDA DIVERGE" : "";
      console.log(`    [${i}] planilha ${bp.padEnd(15)} paga ${n4(r && r.received_percent).padStart(7)}   |  TRP39 ${bt.padEnd(15)} paga ${n4(c && c.f3).padStart(7)}${marca}`);
      if (marca && r && c) divergencias.push({ label, cat, plDe: Number(r.rate_from), plAte: r.rate_to, plPct: Number(r.received_percent), trpDe: c.txMin, trpAte: c.txMax, trpPct: c.f3 });
    }
  }
  fs.writeFileSync(process.env.OUT || "./_bandas_divergentes.json", JSON.stringify(divergencias, null, 1));
  console.log(`\n  faixas com banda divergente: ${divergencias.length}`);
  console.log("\nNADA GRAVADO, NADA IMPORTADO.");
})().catch(e => { console.error("EXCECAO:", e.message, (e.stack || "").slice(0, 400)); process.exit(1); });
