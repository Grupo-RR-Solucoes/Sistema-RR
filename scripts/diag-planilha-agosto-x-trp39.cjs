/* A planilha de remuneracao de AGOSTO bate com a TRP39 ou com a TRP38?
 * received_percent = "3a FAIXA"; promoter_percent = min(3aFAIXA; 5,80%) x 58,33%.
 * READ-ONLY. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DL = "C:/Users/diego/Downloads";
const TETO = 5.8, SHARE = 0.5833;
const n4 = (v) => (v == null ? "—" : Number(v).toFixed(4));
/** label da planilha -> categoria da TRP */
const MAPA = { "Credito nao consignado": "NAO_CONSIGNADO", "SP e MG": "CONSIG_SP_MG", "Publico geral": "CONSIG_PUBLICO", "SIAPE": "SIAPE", "INSS novo": "INSS_NOVO", "INSS refin": "INSS_RENOV", "Privado CLT": "CONSIG_PRIVADO", "FGTS": "FGTS", "13 salario": "ADIANTAMENTO_13", "Portabilidade publico": "PORTAB_PUBLICO", "Portabilidade privado": "PORTAB_PRIVADO" };
const META = new Set(["tx_min", "tx_max", "prazo_min", "prazo_max"]);
const arraysDeCelula = (cat) => !cat || typeof cat !== "object" ? [] : Object.keys(cat).filter((k) => {
  const v = cat[k];
  return Array.isArray(v) && v.length && v.every((c) => c && typeof c === "object") &&
    v.some((c) => Object.entries(c).some(([kk, vv]) => !META.has(kk) && typeof vv === "number"));
});
/** Faixa 3 da regua para (categoria, taxa%, prazo). Taxa em % (1.85), TRP em decimal. */
/* EPSILON, e nao comparacao direta. `1.64 / 100` da 0.016399999999999998, que e
 * MENOR que o tx_min 0.0164 da celula — a linha do SIAPE caia na celula sem
 * limites (F3 3,34%) e aparecia como divergencia da planilha. Nao era: a
 * planilha diz 0,97%, que e exatamente a celula certa. Erro de float meu, nao
 * do documento. Comparar percentual convertido para decimal SEM epsilon e
 * armadilha garantida. */
const EPS = 1e-9;
function faixaN(regra, catTrp, taxaPct, prazo, nFaixa) {
  const cat = regra[catTrp];
  if (!cat) return null;
  const rot = `Faixa ${nFaixa}`;
  for (const chave of arraysDeCelula(cat)) {
    for (const c of cat[chave]) {
      const tx = taxaPct / 100;
      const okTx = (c.tx_min == null || tx >= c.tx_min - EPS) && (c.tx_max == null || tx <= c.tx_max + EPS);
      const okPz = (c.prazo_min == null || prazo >= c.prazo_min) && (c.prazo_max == null || prazo <= c.prazo_max);
      if (okTx && okPz && typeof c[rot] === "number") return c[rot] * 100;
    }
  }
  return null;
}
const faixa3 = (regra, cat, taxa, prazo) => faixaN(regra, cat, taxa, prazo, 3);
(async () => {
  const { buildTrpDraft } = require("@/lib/trp/parseTrpDraft.ts");
  const t38 = (await buildTrpDraft(new Uint8Array(fs.readFileSync(DL + "/TRP38 - PROMOTIVA 072026.pdf")), { competencia: "2026-08", sourceFilename: "T38", sha256: "38" })).regraDraft;
  const t39 = (await buildTrpDraft(new Uint8Array(fs.readFileSync(DL + "/TRP39 - PROMOTIVA 082026.pdf")), { competencia: "2026-08", sourceFilename: "T39", sha256: "39" })).regraDraft;
  const { data } = await sb.from("audit_logs").select("created_at,payload").eq("entity_name", "promoter_remuneration_table").order("created_at", { ascending: false }).limit(8);
  const log = (data || []).find((r) => r.payload && r.payload.year === 2026 && r.payload.month === 8);
  console.log(`planilha importada em ${String(log.created_at).slice(0, 10)} (a TRP39 vale a partir de 05/08)`);
  const pr = log.payload.productionRules || [];
  let bate38 = 0, bate39 = 0, ambas = 0, nenhuma = 0, semCelula = 0;
  const divergentes = [];
  for (const r of pr) {
    const catTrp = MAPA[r.label];
    if (!catTrp) continue;
    const taxa = r.rate_from == null ? null : Number(r.rate_from);
    const prazo = r.term_from == null ? 60 : Number(r.term_from);
    if (taxa == null) continue;
    const f38 = faixa3(t38, catTrp, taxa, prazo);
    const f39 = faixa3(t39, catTrp, taxa, prazo);
    if (f38 == null && f39 == null) { semCelula++; continue; }
    const rp = Number(r.received_percent);
    const e38 = f38 != null && Math.abs(rp - Math.min(f38, TETO)) < 0.005;
    const e39 = f39 != null && Math.abs(rp - Math.min(f39, TETO)) < 0.005;
    if (e38 && e39) ambas++;
    else if (e38) { bate38++; divergentes.push({ r, catTrp, taxa, prazo, f38, f39, rp }); }
    else if (e39) bate39++;
    else {
      // NAO bate com a Faixa 3 de nenhuma das duas. Antes de chamar de
      // divergencia, pergunta se bate com OUTRA faixa — coluna trocada na
      // planilha e um modo de falha diferente de "valor errado".
      let outra = null;
      for (const nf of [1, 2, 4, 5]) {
        for (const [rot, reg] of [["TRP38", t38], ["TRP39", t39]]) {
          const v = faixaN(reg, catTrp, taxa, prazo, nf);
          if (v != null && Math.abs(rp - Math.min(v, TETO)) < 0.005) { outra = `${rot} Faixa ${nf}`; break; }
        }
        if (outra) break;
      }
      nenhuma++;
      divergentes.push({ r, catTrp, taxa, prazo, f38, f39, rp, outra });
    }
  }
  console.log(`\nregras comparadas: ${pr.length} | sem celula na TRP: ${semCelula}`);
  console.log(`  batem com AS DUAS (nao mudaram)      : ${ambas}`);
  console.log(`  batem SO com a TRP38 (planilha VELHA): ${bate38}`);
  console.log(`  batem SO com a TRP39                 : ${bate39}`);
  console.log(`  nao batem com nenhuma                : ${nenhuma}`);
  console.log("\nDIVERGENTES (a '3a FAIXA' da planilha x Faixa 3 de cada TRP):");
  console.log("  label                     taxa  planilha   TRP38     TRP39   | comissao 58,33% planilha -> TRP39");
  for (const d of divergentes) {
    const cp = Math.min(d.rp, TETO) * SHARE;
    const c39 = d.f39 == null ? null : Math.min(d.f39, TETO) * SHARE;
    console.log(`  ${String(d.r.label).padEnd(24)} ${String(d.taxa).padStart(5)}  ${n4(d.rp).padStart(7)}  ${n4(d.f38).padStart(7)}  ${n4(d.f39).padStart(7)}   | ${n4(cp)} -> ${n4(c39)}${d.outra ? `   <== e a ${d.outra}, nao a Faixa 3` : ""}`);
  }
  console.log("\n=== a conta 58,33% da propria planilha confere? ===");
  let ok = 0, ruim = 0;
  for (const r of pr) {
    const esperado = Math.min(Number(r.received_percent), TETO) * SHARE;
    if (Math.abs(esperado - Number(r.promoter_percent)) < 0.001) ok++; else { ruim++; console.log(`  DIVERGE: ${r.label} ${r.rate_from} received ${r.received_percent} promoter ${r.promoter_percent} (esperado ${n4(esperado)})`); }
  }
  console.log(`  ${ok} de ${ok + ruim} regras: promoter_percent == min(received;5,80%) x 58,33%`);
  console.log("\nNADA GRAVADO.");
})().catch(e => { console.error("EXCECAO:", e.message, (e.stack || "").slice(0, 300)); process.exit(1); });
