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
 *   C) INVARIANTE (invertida em 01/08/2026): NENHUM contrato da competencia
 *      corrente paga com prazo abaixo do piso da sua categoria, e a TRP VIGENTE
 *      tem prazo_min preenchido nas categorias que o exigem.
 *
 *      A versao anterior media o DELTA do conserto ("6 de 448 mudam, R$ 602,17").
 *      O conserto entrou (975e9a3, ja em main), o delta virou 0 e o gate passou
 *      a acusar SUCESSO como falha.
 *
 *      NAO foi aposentado porque a premissa PODE regredir: a guarda de runtime e
 *      CONDICIONAL ao campo existir — lib/regrasLoader.ts:155-160
 *        if (!skipPrazoMin && typeof cat.prazo_min === "number" && prazo < cat.prazo_min)
 *      Se uma TRP nova subir sem prazo_min a guarda NAO dispara e ninguem acusa.
 *      Foi assim que a TRP38 pagou 6 contratos abaixo do piso. Por isso a 1a
 *      assercao ataca a CAUSA (campo ausente), nao so o sintoma.
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

  // ---- C: INVARIANTE sobre a regra VIVA (ver cabecalho) ----
  const dpr = await fetchAll("daily_production_records", "company_id, product_description, product_code, interest_rate, term_months, installments, contract_date, movement_date, proposal_date, net_value, gross_value, convenio_code, convenio_type, convenio_segment, raw_payload");
  // COMPETENCIA DESCOBERTA, nao cravada: a ultima com contrato no diario.
  const compsRR = [...new Set(dpr.filter((r) => r.company_id !== BBTS && r.contract_date).map((r) => competenciaDaDataContrato(String(r.contract_date).slice(0, 10))).filter(Boolean))].sort();
  const COMP = compsRR[compsRR.length - 1];
  console.log(`
===== C) INVARIANTE — competencia DESCOBERTA: ${COMP} =====`);
  const rr = dpr.filter((r) => r.company_id !== BBTS && r.contract_date && Number(r.interest_rate) > 0 && Number(r.net_value) > 0 && competenciaDaDataContrato(String(r.contract_date).slice(0, 10)) === COMP);
  const provider = await buildTrpCreditProvider(rr.map((r) => String(r.contract_date).slice(0, 10)));
  const preload = createTrpRegraDbPreloader(sb); await preload.preload([COMP]);
  const regraDB = preload.getRegraSync(COMP);
  const TK2CAT = { PUBLICO_GERAL:"CONSIG_PUBLICO", SP_MG:"CONSIG_SP_MG", PRIVADO:"CONSIG_PRIVADO", PORTABILIDADE_PUBLICO:"PORTAB_PUBLICO", PORTABILIDADE_PRIVADO:"PORTAB_PRIVADO", AUTOMATICO_SALARIO_BENEFICIO:"NAO_CONSIGNADO", INSS_RENOVACAO:"INSS_RENOV", INSS_NOVO:"INSS_NOVO", SIAPE:"SIAPE", ADIANTAMENTO_13:"ADIANTAMENTO_13", FGTS:"FGTS" };

  // C.1 CAUSA RAIZ: a TRP vigente tem o campo onde o parser deriva/captura.
  // O conjunto que EXIGE nao e opiniao: e o que o parser extrai do PDF (5
  // derivadas + 3 capturadas); as 3 de particao omitem de proposito.
  const exigem = Object.keys(prazoJul).filter((k) => typeof prazoJul[k] === "number");
  const semCampo = exigem.filter((k) => typeof (regraDB[k] || {}).prazo_min !== "number");
  ok(semCampo.length === 0,
    `CAUSA RAIZ: a TRP vigente de ${COMP} tem prazo_min nas ${exigem.length} categorias que exigem` +
    (semCampo.length ? ` — FALTAM ${semCampo.join(", ")}: a guarda de regrasLoader.ts:155-160 fica DESLIGADA nelas` : ""));

  // C.2 SINTOMA: ninguem paga abaixo do piso.
  const abaixo = [];
  let comPisoAvaliado = 0, abaixoDoPisoZerados = 0; // NAO-VACUIDADE
  for (const r of rr) {
    const op = { valor_liquido: Number(r.net_value), valor_bruto: Number(r.gross_value || r.net_value), valor_seguro: 0, taxa_juros: Number(r.interest_rate), prazo: getPrazoTrp(r) ?? Math.trunc(Number(r.term_months || r.installments)), tem_seguro: false, product_description: r.product_description, product_code: r.product_code, convenio_code: r.convenio_code, convenio_type: r.convenio_type, convenio_segment: r.convenio_segment, company_cash_percent: null, production_value: PROD_FAIXA3, contract_date: r.contract_date, movement_date: r.movement_date, proposal_date: r.proposal_date };
    const res = calcularOperacao(op, { trpProvider: provider });
    const cat = TK2CAT[inferCreditTable(op)] || inferCreditTable(op);
    if (cat === "FGTS") continue; // skip deliberado do motor (regrasLoader.ts:155)
    const piso = (regraDB[cat] || {}).prazo_min;
    if (typeof piso === "number") comPisoAvaliado++;
    if (typeof piso === "number" && op.prazo < piso && !(Number(res.credito.percentual) > 0)) abaixoDoPisoZerados++;
    if (typeof piso === "number" && op.prazo < piso && Number(res.credito.percentual) > 0) {
      abaixo.push({ desc: String(r.product_description).slice(0, 24), cat, prazo: op.prazo, piso, pct: res.credito.percentual, avista: Number(res.credito.avista_empresa) });
    }
  }
  for (const c of abaixo) console.log(`  !! ${c.desc.padEnd(24)} ${c.cat.padEnd(16)} prazo=${String(c.prazo).padStart(3)} < piso ${c.piso}  pct=${c.pct}  avista R$ ${c.avista.toFixed(2)}`);
  // NAO-VACUIDADE: sem sujeito, "ninguem paga abaixo do piso" e verdade por
  // vazio. Estes dois numeros dizem se a assercao tem sobre o que falar.
  console.log(`  [nao-vacuidade] ${comPisoAvaliado} de ${rr.length} contratos caem em categoria COM piso; ${abaixoDoPisoZerados} deles tem prazo < piso e foram ZERADOS pela guarda`);
  if (comPisoAvaliado === 0 || abaixoDoPisoZerados === 0) {
    console.log(`  [ATENCAO] a assercao do sintoma nao tem sujeito nesta competencia — ela passa por VACUIDADE, nao por merito.`);
  }
  const somaIndevida = abaixo.reduce((a, c) => a + c.avista, 0);
  ok(abaixo.length === 0,
    `SINTOMA: NENHUM dos ${rr.length} contratos de ${COMP} paga com prazo abaixo do piso` +
    (abaixo.length ? ` — ${abaixo.length} pagam, R$ ${somaIndevida.toFixed(2)} indevidos` : ""));


  console.log("\n===================== VEREDITO =====================");
  if (falhas === 0) { console.log("  OK — prazo_min 8/8 vs curado; TRP vigente tem o campo; 0 contrato paga abaixo do piso."); process.exit(0); }
  else { console.log(`  FALHA — ${falhas} assercao(oes). PARE.`); process.exit(2); }
})().catch((e) => { console.error("ERRO INFRA:", e); process.exit(3); });
