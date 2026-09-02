/*
 * GATE — tx_juros_min de categoria DERIVADO pelo parser (não capturado).
 * READ-ONLY. Parte A/B offline (PDFs + JSON curado); parte C lê prod (no-op).
 *
 * A derivação = piso ÚNICO da categoria (min tx_min das células) quando é FLOOR e
 * não PARTIÇÃO. Prova:
 *   A) abr (TRP35) e jun (TRP37): tx_juros_min DERIVADO == JSON CURADO A MÃO nas 2
 *      categorias que o têm (INSS_RENOV 0,01 e ADIANTAMENTO_13 0,0325). O curado é a
 *      verdade (digitado olhando o PDF); divergir = derivador errado -> PARA.
 *   B) as outras 9 categorias: derivação OMITE (nunca tiveram) — não inventa.
 *   C) JULHO: a TRP38 ganha o campo derivado; o pct dos contratos RR de julho NÃO
 *      muda (o piso já era enforced pela célula tx_min / partição). 0 divergência.
 */
process.env.TRP_SOURCE = "db";
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { buildTrpDraft } = require("../lib/trp/parseTrpDraft.ts");
const { calcularOperacao, competenciaDaDataContrato } = require("../lib/motor.ts");
const { buildTrpCreditProvider } = require("../lib/trp/creditTrpProvider.ts");
const {
  createTrpRegraDbPreloader,
  resolveTrpRegraDbCompetencia,
  escolherFatia,
} = require("../lib/trp/resolveTrpRegraDb.ts");
const { getPrazoTrp } = require("../lib/prazoTrp.ts");

const ROOT = path.resolve(__dirname, "..");
const DL = "C:/Users/diego/Downloads";
const CATS = ["INSS_NOVO","INSS_RENOV","CONSIG_PUBLICO","SIAPE","CONSIG_SP_MG","CONSIG_PRIVADO","PORTAB_PUBLICO","PORTAB_PRIVADO","NAO_CONSIGNADO","ADIANTAMENTO_13","FGTS"];
const BBTS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const PROD_FAIXA3 = 5_000_000;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let falhas = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK " : "XX "} ${m}`); if (!c) falhas++; };
const txDe = (draft, k) => { const c = draft[k]; return c && typeof c === "object" ? c.tx_juros_min : undefined; };

async function fetchAll(table, sel) {
  let from = 0, out = [];
  for (;;) {
    const { data, error } = await sb.from(table).select(sel).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

(async () => {
  // ---- A/B: deriva vs curado (abr/jun) + omite (9) ----
  const derivadoPorComp = {};
  for (const [nome, pdf, comp, curadoArq] of [
    ["ABR", `${DL}/TRP35 - PROMOTIVA 042026.pdf`, "2026-04", "regras_promotiva/json/TRP35_2026-04.json"],
    ["JUN", `${DL}/TRP37 - PROMOTIVA 062026.pdf`, "2026-06", "regras_promotiva/json/TRP37_2026-06.json"],
    ["JUL", `${DL}/TRP38 - PROMOTIVA 072026.pdf`, "2026-07", null],
  ]) {
    const res = await buildTrpDraft(new Uint8Array(fs.readFileSync(pdf)), { competencia: comp });
    const curado = curadoArq ? JSON.parse(fs.readFileSync(path.join(ROOT, curadoArq), "utf8")) : null;
    const mapa = {};
    console.log(`\n===== ${nome} (${comp}) — ${curado ? "DEEP-EQUAL vs curado" : "deriva 2, omite 9"} =====`);
    let nDerivadas = 0;
    for (const k of CATS) {
      const der = txDe(res.regraDraft, k);
      if (der !== undefined) { mapa[k] = der; nDerivadas++; }
      if (curado) {
        const cur = curado[k] && curado[k].tx_juros_min;
        ok(der === cur, `${k.padEnd(16)} derivado=${String(der).padStart(7)} == curado=${String(cur).padStart(7)}`);
      }
    }
    derivadoPorComp[comp] = mapa;
    if (!curado) {
      ok(nDerivadas === 2 && mapa.INSS_RENOV === 0.01 && mapa.ADIANTAMENTO_13 === 0.0325,
        `julho: derivou EXATAMENTE 2 (INSS_RENOV=${mapa.INSS_RENOV}, ADIANTAMENTO_13=${mapa.ADIANTAMENTO_13}); 9 omitidas`);
    } else {
      ok(nDerivadas === 2, `${nome}: exatamente 2 categorias derivam (achei ${nDerivadas}); 9 omitidas (não inventa)`);
    }
  }

  // ---- C: JULHO no-op — pct dos contratos RR com/sem o tx_juros_min derivado ----
  console.log(`\n===== C) JULHO no-op: pct com regra-DB vs regra-DB+derivado =====`);
  const dpr = await fetchAll("daily_production_records",
    "company_id, product_description, product_code, interest_rate, term_months, installments, contract_date, movement_date, proposal_date, net_value, gross_value, convenio_code, raw_payload");
  const rr = dpr.filter((r) => r.company_id !== BBTS && r.contract_date && Number(r.interest_rate) > 0 && Number(r.net_value) > 0 && competenciaDaDataContrato(String(r.contract_date).slice(0,10)) === "2026-07");

  const provider = await buildTrpCreditProvider(rr.map((r) => String(r.contract_date).slice(0,10)));
  // FORMA (b) DA DIVIDA DO PROVIDER SEM DATA (02/09/2026). `getRegraSync("2026-07")`
  // devolvia UMA regua; numa competencia PARTIDA existem duas, e substituir a
  // competencia inteira por um objeto so mediria a fatia errada para metade dos
  // contratos. Julho NAO esta partido hoje — o conserto e por CONSTRUCAO, para
  // continuar certo quando alguma competencia deste gate estiver.
  const compRes = await resolveTrpRegraDbCompetencia("2026-07", sb);
  console.log(`  competencia 2026-07: ${compRes.fatias.length} fatia(s) ATIVA(S)` +
    (compRes.partida ? " — PARTIDA" : "") +
    (compRes.fatias.length ? " | " + compRes.fatias.map((f) => `v${f.versionNo} ${f.rowValidFrom}..${f.rowValidUntil}`).join(" | ") : ""));

  // uma copia DERIVADA por FATIA, indexada pelo id da versao.
  const derivadaPorVersao = new Map();
  for (const f of compRes.fatias) {
    const copia = JSON.parse(JSON.stringify(f.regra));
    for (const [k, v] of Object.entries(derivadoPorComp["2026-07"])) {
      if (copia[k]) copia[k].tx_juros_min = v;
    }
    derivadaPorVersao.set(f.versionId, copia);
  }
  // provider DERIVADO ciente da data: escolhe a MESMA fatia que o provider real
  // escolheria para aquele contrato, e devolve a copia derivada DELA.
  const providerDer = (c, cd) => {
    if (c !== "2026-07") return provider(c, cd);
    const f = escolherFatia(compRes, cd ?? null);
    return f ? derivadaPorVersao.get(f.versionId) ?? null : null;
  };

  let diverg = 0, n = 0;
  for (const r of rr) {
    const op = {
      valor_liquido: Number(r.net_value), valor_bruto: Number(r.gross_value || r.net_value), valor_seguro: 0,
      taxa_juros: Number(r.interest_rate), prazo: getPrazoTrp(r) ?? Math.trunc(Number(r.term_months || r.installments)),
      tem_seguro: false, product_description: r.product_description, product_code: r.product_code,
      convenio_code: r.convenio_code, company_cash_percent: null, production_value: PROD_FAIXA3,
      contract_date: r.contract_date, movement_date: r.movement_date, proposal_date: r.proposal_date,
    };
    const a = Number(calcularOperacao(op, { trpProvider: provider }).credito.percentual);
    const b = Number(calcularOperacao(op, { trpProvider: providerDer }).credito.percentual);
    n++;
    if (Math.abs(a - b) > 1e-9) diverg++;
  }
  ok(diverg === 0, `julho: ${n} contratos RR; pct diverge (DB vs DB+derivado) em ${diverg}`);

  console.log("\n===================== VEREDITO =====================");
  if (falhas === 0) { console.log("  OK — tx_juros_min DERIVADO == curado (abr/jun 11/11), 9 omitidas, julho no-op."); process.exit(0); }
  else { console.log(`  FALHA — ${falhas} assercao(oes). PARE (o curado e a verdade).`); process.exit(2); }
})().catch((e) => { console.error("ERRO INFRA:", e); process.exit(3); });
