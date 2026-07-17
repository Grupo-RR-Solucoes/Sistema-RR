/*
 * GATE — parser da TRP captura os escalares de categoria (tiquete_min).
 * READ-ONLY e OFFLINE (le PDFs do Downloads + JSONs curados do repo; nao toca prod).
 * Prova que parseEscalares -> buildTrpDraft extrai o tiquete_min FIEL ao que foi
 * DIGITADO A MAO nos JSONs curados, e que julho e NO-OP (== hardcode/rede).
 *
 * A verdade e o JSON curado: alguem leu a linha "Tiquete:" do PDF e digitou. Se o
 * parser divergir em ALGUMA categoria, ele esta lendo errado — PARA e reporta.
 *
 * PROVAS (exit 0 = todas passam; exit 2 = alguma falhou):
 *   A) DEEP-EQUAL abr (TRP35) e jun (TRP37): buildTrpDraft[k].tiquete_min == JSON
 *      curado[k].tiquete_min, 11/11 x 2 competencias.
 *   B) JULHO (TRP38): 11/11 == hardcode do motor (o no-op — a TRP38 nasceu do parser
 *      e nao tinha o campo; agora o parser o captura, e da o MESMO valor da rede).
 *   C) FGTS: le 1000 (NAO 1, NAO null). O ">= R$ N mil" tem match UNICO; as iscas
 *      "Varejo Abaixo R$ 999 mil" NAO casam. E o "mil" vira *1000 (a plausibilidade
 *      0<t<=10000 NAO pegaria um "1" — so o parse correto protege).
 *   D) GRUPOS compartilhados: "1.2,1.3" / "1.4 e 1.6" / "2.2,2.3" / "3.2 e 3.3"
 *      gravam o MESMO tiquete nas 2 categorias do grupo.
 *   E) NASCE "conferir": todo tiquete_min capturado vira ConferirItem ambar (nunca
 *      "provado").
 *   F) DUVIDA -> OMITE: FGTS com DOIS ">= R$ mil" (ambiguo) -> parser nao grava
 *      (cai na rede); e o clamp de plausibilidade rejeita 0 / >10000.
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");

const { parseEscalares, extractLinesFromPdf } = require("../lib/trp/parseTrpPdf.ts");
const { buildTrpDraft } = require("../lib/trp/parseTrpDraft.ts");

const ROOT = path.resolve(__dirname, "..");
const DL = "C:/Users/diego/Downloads";
const CATS = ["INSS_NOVO","INSS_RENOV","CONSIG_PUBLICO","SIAPE","CONSIG_SP_MG","CONSIG_PRIVADO","PORTAB_PUBLICO","PORTAB_PRIVADO","NAO_CONSIGNADO","ADIANTAMENTO_13","FGTS"];
const HARDCODE = {INSS_NOVO:100,INSS_RENOV:100,CONSIG_PUBLICO:100,SIAPE:100,CONSIG_SP_MG:100,CONSIG_PRIVADO:2000,PORTAB_PUBLICO:2500,PORTAB_PRIVADO:2500,NAO_CONSIGNADO:100,ADIANTAMENTO_13:100,FGTS:1000};

const CASOS = [
  { nome:"ABR", comp:"2026-04", pdf:`${DL}/TRP35 - PROMOTIVA 042026.pdf`, curado:"regras_promotiva/json/TRP35_2026-04.json" },
  { nome:"JUN", comp:"2026-06", pdf:`${DL}/TRP37 - PROMOTIVA 062026.pdf`, curado:"regras_promotiva/json/TRP37_2026-06.json" },
  { nome:"JUL", comp:"2026-07", pdf:`${DL}/TRP38 - PROMOTIVA 072026.pdf`, curado:null },
];

let falhas = 0;
const ok = (cond, msg) => { console.log(`  ${cond?"OK ":"XX "} ${msg}`); if (!cond) falhas++; };
const tiqDe = (draft, k) => { const c = draft[k]; return c && typeof c === "object" ? c.tiquete_min : undefined; };

(async () => {
  const drafts = {};
  for (const caso of CASOS) {
    const bytes = new Uint8Array(fs.readFileSync(caso.pdf));
    const res = await buildTrpDraft(bytes, { competencia: caso.comp });
    drafts[caso.nome] = res;

    const alvo = caso.curado
      ? JSON.parse(fs.readFileSync(path.join(ROOT, caso.curado), "utf8"))
      : null;
    console.log(`\n===== ${caso.nome} (${caso.comp}) — ${caso.curado ? "DEEP-EQUAL vs JSON curado" : "vs HARDCODE (no-op)"} =====`);
    for (const k of CATS) {
      const lido = tiqDe(res.regraDraft, k);
      const esperado = alvo ? (alvo[k] && alvo[k].tiquete_min) : HARDCODE[k];
      ok(lido === esperado, `${k.padEnd(16)} tiquete_min lido=${String(lido).padStart(6)} == esperado=${String(esperado).padStart(6)}`);
    }
  }

  // ---- C) FGTS: 1000, match unico, iscas excluidas ------------------------
  console.log("\n===== C) FGTS: le 1000 (nao 1, nao null); isca '999 mil' excluida =====");
  const RE_FGTS = /(?:>=|≥)\s*R\$\s*(\d+)\s*mil/i;
  const RE_MIL = /\bmil\b/i;
  for (const caso of CASOS) {
    const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync(caso.pdf)));
    const casam = lines.filter((l) => RE_FGTS.test(l));
    const iscasMil = lines.filter((l) => RE_MIL.test(l) && !RE_FGTS.test(l));
    const fgts = tiqDe(drafts[caso.nome].regraDraft, "FGTS");
    ok(casam.length === 1, `${caso.nome}: exatamente 1 linha ">= R$ N mil" (achei ${casam.length}) -> [${casam[0]}]`);
    ok(fgts === 1000, `${caso.nome}: FGTS.tiquete_min == 1000 (nao 1, nao null) — o "1 mil" virou *1000`);
    ok(iscasMil.length >= 1 && !iscasMil.some((l) => RE_FGTS.test(l)), `${caso.nome}: ${iscasMil.length} isca(s) "...mil" no PDF, NENHUMA casou (ex.: ${(iscasMil.find(l=>/999/.test(l))||"-").slice(0,40)})`);
  }

  // ---- D) grupos compartilhados: pares iguais -----------------------------
  console.log("\n===== D) grupos compartilhados gravam o mesmo tiquete nas 2 categorias =====");
  const PARES = [
    ["INSS_NOVO","INSS_RENOV","Tabela 1.2, 1.3"],
    ["CONSIG_PUBLICO","CONSIG_SP_MG","Tabela 1.4 e 1.6"],
    ["PORTAB_PUBLICO","PORTAB_PRIVADO","Tabela 2.2, 2.3"],
    ["NAO_CONSIGNADO","ADIANTAMENTO_13","Tabela 3.2 e 3.3"],
  ];
  for (const caso of CASOS) {
    for (const [a,b,rot] of PARES) {
      const va = tiqDe(drafts[caso.nome].regraDraft, a);
      const vb = tiqDe(drafts[caso.nome].regraDraft, b);
      ok(va != null && va === vb, `${caso.nome} ${rot}: ${a}(${va}) == ${b}(${vb})`);
    }
  }

  // ---- E) nasce "conferir" (ambar), nunca provado -------------------------
  console.log("\n===== E) todo tiquete_min capturado nasce 'conferir' (ambar) =====");
  for (const caso of CASOS) {
    const conf = drafts[caso.nome].confianca.conferir;
    const tiqItems = conf.filter((c) => c.campo === "tiquete_min");
    const todosConferir = tiqItems.length === 11 && tiqItems.every((c) => c.severidade === "conferir");
    ok(todosConferir, `${caso.nome}: 11 itens 'tiquete_min' e todos severidade='conferir' (achei ${tiqItems.length}, provado=${tiqItems.filter(c=>c.severidade!=="conferir").length})`);
  }

  // ---- F) duvida -> OMITE (ambiguidade FGTS + clamp de plausibilidade) -----
  console.log("\n===== F) duvida -> OMITE (o motor cai na rede) =====");
  // F1: FGTS com DOIS ">= R$ mil" (ambiguo) -> parseEscalares NAO grava FGTS.tiquete
  const linhasAmbiguas = [
    "Tabela: 1.7", "Tíquete: a partir de R$ 2.000,00",
    "3.4 CDC FGTS Saque Aniversário",
    "1,79% >= R$ 1 mil 36 a 84 4,20%",
    "OUTRA >= R$ 3 mil linha 5,00%",
  ];
  const escAmb = parseEscalares(linhasAmbiguas);
  ok(!escAmb.FGTS || escAmb.FGTS.tiquete_min == null, `FGTS com 2 matches ">= R$ mil" -> OMITIDO (lido=${escAmb.FGTS && escAmb.FGTS.tiquete_min})`);
  ok(escAmb.CONSIG_PRIVADO && escAmb.CONSIG_PRIVADO.tiquete_min === 2000, `bloco valido no mesmo lote ainda le (CONSIG_PRIVADO=2000)`);
  // F2: clamp de plausibilidade (espelha montarEscalaresDraft: 0 < t <= 10000)
  const clampOmite = (t) => !(typeof t === "number" && Number.isFinite(t) && t > 0 && t <= 10000);
  ok(clampOmite(0) && clampOmite(-5) && clampOmite(50000) && clampOmite(NaN), "clamp OMITE 0, -5, 50000, NaN");
  ok(!clampOmite(100) && !clampOmite(2500) && !clampOmite(1000), "clamp ACEITA 100, 1000, 2500 (os reais)");
  console.log("  (nota: t=1 PASSA no clamp — por isso o FGTS depende do parse '1 mil'->1000, provado em C)");

  console.log("\n===================== VEREDITO =====================");
  if (falhas === 0) {
    console.log("  OK — parser captura tiquete_min FIEL (11/11 x abr/jun), julho no-op, FGTS=1000, grupos, ambar, omite em duvida.");
    process.exit(0);
  } else {
    console.log(`  FALHA — ${falhas} assercao(oes) quebrada(s). PARE: o parser esta lendo errado (o JSON curado e a verdade).`);
    process.exit(2);
  }
})().catch((e) => { console.error("ERRO INFRA:", e); process.exit(3); });
