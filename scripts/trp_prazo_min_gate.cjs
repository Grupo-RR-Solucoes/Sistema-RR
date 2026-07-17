/*
 * GATE — prazo_min de categoria DERIVADO (5) + CAPTURADO (3). MUDA NUMERO: os 6
 * contratos de julho abaixo do piso passam a ZERAR (piso de elegibilidade da TRP).
 * READ-ONLY. Parte A/B offline; parte C lê prod.
 *
 *   A) DEEP-EQUAL abr/jun: prazo_min do parser == JSON CURADO nas 8 categorias que o
 *      têm (5 derivadas + 3 capturadas). As 3 de partição (INSS_NOVO/RENOV/
 *      CONSIG_PRIVADO) OMITEM. Divergir = PARA (curado é a verdade).
 *   B) REGEX: parsePrazoCategoria NÃO casa taxa ("A partir de 1,90%") nem tiquete
 *      ("a partir de R$ 100,00") nem prazo inline — só o "A partir de N" isolado.
 *   C) JULHO (muda número): a TRP38 passa a ter os 8; os 6 contratos abaixo do piso
 *      zeram (pct -> 0, delta R$); e ANTI-REGRESSÃO: EXATAMENTE 6 de 448 mudam,
 *      NENHUM com prazo >= piso zera.
 */
process.env.TRP_SOURCE = "db";
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { buildTrpDraft } = require("../lib/trp/parseTrpDraft.ts");
const { parsePrazoCategoria } = require("../lib/trp/parseTrpPdf.ts");
const { calcularOperacao, inferCreditTable, competenciaDaDataContrato } = require("../lib/motor.ts");
const { buildTrpCreditProvider } = require("../lib/trp/creditTrpProvider.ts");
const { createTrpRegraDbPreloader } = require("../lib/trp/resolveTrpRegraDb.ts");
const { getPrazoTrp } = require("../lib/prazoTrp.ts");

const ROOT = path.resolve(__dirname, "..");
const DL = "C:/Users/diego/Downloads";
const CATS = ["INSS_NOVO","INSS_RENOV","CONSIG_PUBLICO","SIAPE","CONSIG_SP_MG","CONSIG_PRIVADO","PORTAB_PUBLICO","PORTAB_PRIVADO","NAO_CONSIGNADO","ADIANTAMENTO_13","FGTS"];
const BBTS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const PROD_FAIXA3 = 5_000_000;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let falhas = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK " : "XX "} ${m}`); if (!c) falhas++; };
const prazoDe = (d, k) => { const c = d[k]; return c && typeof c === "object" ? c.prazo_min : undefined; };

async function fetchAll(t, s) { let f=0,o=[]; for(;;){ const {data,error}=await sb.from(t).select(s).range(f,f+999); if(error)throw new Error(error.message); o.push(...data); if(data.length<1000)break; f+=1000; } return o; }

(async () => {
  // ---- A: deep-equal abr/jun + julho ganha 8 ----
  const prazoJul = {};
  for (const [nome, pdf, comp, cur] of [
    ["ABR", `${DL}/TRP35 - PROMOTIVA 042026.pdf`, "2026-04", "regras_promotiva/json/TRP35_2026-04.json"],
    ["JUN", `${DL}/TRP37 - PROMOTIVA 062026.pdf`, "2026-06", "regras_promotiva/json/TRP37_2026-06.json"],
    ["JUL", `${DL}/TRP38 - PROMOTIVA 072026.pdf`, "2026-07", null],
  ]) {
    const res = await buildTrpDraft(new Uint8Array(fs.readFileSync(pdf)), { competencia: comp });
    const curado = cur ? JSON.parse(fs.readFileSync(path.join(ROOT, cur), "utf8")) : null;
    console.log(`\n===== ${nome} — prazo_min (5 deriv + 3 capt; 3 omitem) =====`);
    let n = 0;
    for (const k of CATS) {
      const der = prazoDe(res.regraDraft, k);
      if (der !== undefined) n++;
      if (curado) ok(der === (curado[k] && curado[k].prazo_min), `${k.padEnd(16)} prazo_min=${String(der).padStart(6)} == curado=${String(curado[k] && curado[k].prazo_min).padStart(6)}`);
      else prazoJul[k] = der;
    }
    ok(n === 8, `${nome}: exatamente 8 categorias com prazo_min (achei ${n}); 3 de partição omitem`);
  }

  // ---- B: regex nao casa taxa/tiquete ----
  console.log(`\n===== B) parsePrazoCategoria só casa "A partir de N" isolado =====`);
  const synthPub = ["2.2 - Convenio Publico", "Taxa de Juros Prazo Geral", "A partir de 1,90% 2,25%", "a partir de R$ 100,00", "A partir de 48"];
  const capPub = parsePrazoCategoria(synthPub);
  ok(capPub.PORTAB_PUBLICO === 48, `secao com taxa "A partir de 1,90%" + tiquete "R$ 100,00" + "A partir de 48" -> captura SÓ 48 (${JSON.stringify(capPub)})`);
  const synthInline = ["3.3 - Adiantamento", "Taxa de Juros Prazo Faixa 1", "A partir de 3,25% A partir de 5 2,35% 2,37% 2,44% 2,55% 2,58%"];
  ok(Object.keys(parsePrazoCategoria(synthInline)).length === 0, `prazo INLINE numa linha de dados ("... A partir de 5 2,35%...") NÃO é capturado (fica p/ o derivador)`);

  // ---- C: julho muda numero (6 zeram) + anti-regressao ----
  console.log(`\n===== C) JULHO: 6 zeram; EXATAMENTE 6 de 448 mudam =====`);
  const dpr = await fetchAll("daily_production_records", "company_id, product_description, product_code, interest_rate, term_months, installments, contract_date, movement_date, proposal_date, net_value, gross_value, convenio_code, convenio_type, convenio_segment, raw_payload");
  const rr = dpr.filter((r) => r.company_id !== BBTS && r.contract_date && Number(r.interest_rate) > 0 && Number(r.net_value) > 0 && competenciaDaDataContrato(String(r.contract_date).slice(0,10)) === "2026-07");
  const provider = await buildTrpCreditProvider(rr.map((r) => String(r.contract_date).slice(0,10)));
  const preload = createTrpRegraDbPreloader(sb); await preload.preload(["2026-07"]);
  const regraDB = preload.getRegraSync("2026-07");
  const regraFix = JSON.parse(JSON.stringify(regraDB));
  for (const [k, v] of Object.entries(prazoJul)) { if (v !== undefined && regraFix[k]) regraFix[k].prazo_min = v; }
  const providerFix = (c) => (c === "2026-07" ? regraFix : provider(c));

  const PISO = prazoJul; // keyed por CATEGORIA
  const TK2CAT = { PUBLICO_GERAL:"CONSIG_PUBLICO", SP_MG:"CONSIG_SP_MG", PRIVADO:"CONSIG_PRIVADO", PORTABILIDADE_PUBLICO:"PORTAB_PUBLICO", PORTABILIDADE_PRIVADO:"PORTAB_PRIVADO", AUTOMATICO_SALARIO_BENEFICIO:"NAO_CONSIGNADO", INSS_RENOVACAO:"INSS_RENOV", INSS_NOVO:"INSS_NOVO", SIAPE:"SIAPE", ADIANTAMENTO_13:"ADIANTAMENTO_13", FGTS:"FGTS" };
  let mudam = 0, zeramComPrazoAcima = 0, somaDelta = 0;
  const casos = [];
  for (const r of rr) {
    const op = { valor_liquido: Number(r.net_value), valor_bruto: Number(r.gross_value || r.net_value), valor_seguro: 0, taxa_juros: Number(r.interest_rate), prazo: getPrazoTrp(r) ?? Math.trunc(Number(r.term_months || r.installments)), tem_seguro: false, product_description: r.product_description, product_code: r.product_code, convenio_code: r.convenio_code, convenio_type: r.convenio_type, convenio_segment: r.convenio_segment, company_cash_percent: null, production_value: PROD_FAIXA3, contract_date: r.contract_date, movement_date: r.movement_date, proposal_date: r.proposal_date };
    const a = calcularOperacao(op, { trpProvider: provider });
    const b = calcularOperacao(op, { trpProvider: providerFix });
    if (Math.abs(Number(a.credito.percentual) - Number(b.credito.percentual)) > 1e-9) {
      mudam++;
      const tab = inferCreditTable(op);
      const piso = PISO[TK2CAT[tab] || tab];
      if (typeof piso === "number" && op.prazo >= piso) zeramComPrazoAcima++;
      somaDelta += Number(a.credito.avista_empresa) - Number(b.credito.avista_empresa);
      casos.push({ desc: String(r.product_description).slice(0,24), tab, prazo: op.prazo, piso, taxa: op.taxa_juros, net: op.valor_liquido, pctA: a.credito.percentual, pctB: b.credito.percentual, avistaA: a.credito.avista_empresa });
    }
  }
  for (const c of casos) console.log(`  ${c.desc.padEnd(24)} ${c.tab.padEnd(15)} prazo=${String(c.prazo).padStart(2)} (piso ${c.piso}) taxa=${c.taxa} net=${c.net} pct ${c.pctA} -> ${c.pctB}  avista -${Number(c.avistaA).toFixed(2)}`);
  ok(mudam === 6, `EXATAMENTE 6 de ${rr.length} mudam (achei ${mudam})`);
  ok(casos.every((c) => c.pctB === 0), `todos os que mudam vão para pct 0 (FORA_DA_TABELA)`);
  ok(casos.every((c) => typeof c.piso === "number" && c.prazo < c.piso), `todos os que mudam têm prazo < piso da categoria`);
  ok(zeramComPrazoAcima === 0, `ANTI-REGRESSÃO: 0 contrato com prazo >= piso zerou`);
  ok(Math.abs(somaDelta - 602.17) < 0.01, `delta à-vista(Faixa3) = R$ ${somaDelta.toFixed(2)} (esperado 602,17)`);

  console.log("\n===================== VEREDITO =====================");
  if (falhas === 0) { console.log("  OK — prazo_min 8/8 vs curado; julho zera os 6 (R$602,17), 0 legítimo afetado."); process.exit(0); }
  else { console.log(`  FALHA — ${falhas} assercao(oes). PARE.`); process.exit(2); }
})().catch((e) => { console.error("ERRO INFRA:", e); process.exit(3); });
