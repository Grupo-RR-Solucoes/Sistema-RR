/*
 * GATE — tiquete minimo do motor: REGUA versionada vs hardcode (getMinimumTicket).
 * READ-ONLY e OFFLINE (nao toca prod; le os JSONs canonicos do repo e injeta um
 * provider proprio). Prova que a frente feat/motor-tiquete-min-da-regua e NO-OP na
 * janela viva e que, quando a regua DIVERGE do hardcode, o motor passa a respeitar
 * a REGUA.
 *
 * O QUE MUDOU NA FRENTE: getCreditPercent zerava o contrato com
 *   `ticket < getMinimumTicket(tableKey)` — um HARDCODE (FGTS 1000 / PORTAB 2500 /
 *   PRIVADO 2000 / default 100). Agora o piso NASCE da regua
 *   (regra_json.<categoria>.tiquete_min) via tiqueteMinFromRegra, com o hardcode
 *   virando REDE (fallback) pra competencia sem o campo (ex.: TRP38/julho, que
 *   nasceu do parser self-service e nao traz escalares).
 *
 * PROVAS (exit 0 = todas passam; exit 2 = alguma falhou):
 *   A) 11/11 categorias — abr (TRP35) e jun (TRP37): a regua CARREGA tiquete_min e
 *      ele == hardcode, categoria a categoria. => tiqueteMinFromRegra == hardcode.
 *   B) julho (TRP38): a regua NAO tem tiquete_min em NENHUMA categoria => o helper
 *      cai na REDE e devolve o MESMO valor do hardcode. NO-OP por fallback.
 *   C) NO-OP por IDENTIDADE: como o minimo por tableKey e identico ao hardcode em
 *      TODA a janela viva, o gate `ticket < min` decide igual pra QUALQUER ticket
 *      => 0 divergencia de pct em TODOS os contratos (prova por identidade do
 *      minimo, nao por amostragem; o gate de paridade a-vista, com esta mudanca
 *      ativa e TRP_SOURCE=db, ja confirmou 0 divergencia nos contratos REAIS de
 *      prod em abr/jun/jul).
 *   D) SINTETICO (o cenario que a frente protege — e que JA ACONTECEU: CONSIG_PRIVADO
 *      era 100 de TRP10 a TRP17): uma regua com CONSIG_PRIVADO.tiquete_min=100
 *      (clone da TRP35, so o piso trocado) -> o MOTOR (calcularOperacao) PAGA um
 *      contrato PRIVADO de ticket 1000 (percentual 0,81% da Faixa 3), enquanto o
 *      hardcode (2000) o ZERARIA. A regua vence.
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");

const { tiqueteMinFromRegra, calcularOperacao } = require("../lib/motor.ts");

const ROOT = path.resolve(__dirname, "..");
const JSON_DIR = path.join(ROOT, "regras_promotiva", "json");
const loadRegra = (arq) => JSON.parse(fs.readFileSync(path.join(JSON_DIR, arq), "utf8"));

// SPEC = o mapa tableKey -> categoria da regua + o valor do HARDCODE (getMinimumTicket).
// E a verdade que o gate confere. tableKey vem do inferCreditTable; categoria e a
// chave da regua (MAP_TABLEKEY_TO_CATEGORIA). O hardcode: FGTS 1000, PORTAB 2500,
// PRIVADO 2000, resto 100.
const SPEC = [
  { tableKey: "FGTS",                        categoria: "FGTS",            hardcode: 1000 },
  { tableKey: "PORTABILIDADE_PUBLICO",       categoria: "PORTAB_PUBLICO",  hardcode: 2500 },
  { tableKey: "PORTABILIDADE_PRIVADO",       categoria: "PORTAB_PRIVADO",  hardcode: 2500 },
  { tableKey: "PRIVADO",                     categoria: "CONSIG_PRIVADO",  hardcode: 2000 },
  { tableKey: "PUBLICO_GERAL",               categoria: "CONSIG_PUBLICO",  hardcode: 100  },
  { tableKey: "SP_MG",                       categoria: "CONSIG_SP_MG",    hardcode: 100  },
  { tableKey: "INSS_NOVO",                   categoria: "INSS_NOVO",       hardcode: 100  },
  { tableKey: "INSS_RENOVACAO",              categoria: "INSS_RENOV",      hardcode: 100  },
  { tableKey: "SIAPE",                       categoria: "SIAPE",           hardcode: 100  },
  { tableKey: "ADIANTAMENTO_13",             categoria: "ADIANTAMENTO_13", hardcode: 100  },
  { tableKey: "AUTOMATICO_SALARIO_BENEFICIO",categoria: "NAO_CONSIGNADO",  hardcode: 100  },
];

let falhas = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "OK " : "XX "} ${msg}`); if (!cond) falhas++; };

// --------------------------------------------------------------------------
// A + B — 11/11 categorias por competencia (regua carrega em abr/jun; fallback em jul)
// --------------------------------------------------------------------------
function tabela(nome, arq, esperaCampo) {
  const regra = loadRegra(arq);
  console.log(`\n=== ${nome} (${arq}) — fonte esperada: ${esperaCampo ? "REGUA" : "FALLBACK (sem tiquete_min)"} ===`);
  console.log("  tableKey                         categoria         regua   helper  hardcode  fonte");
  for (const s of SPEC) {
    const reguaVal = regra[s.categoria] && regra[s.categoria].tiquete_min;
    const helperVal = tiqueteMinFromRegra(regra, s.tableKey);
    const temCampo = typeof reguaVal === "number";
    const fonte = temCampo ? "regua" : "fallback";
    console.log(
      `  ${s.tableKey.padEnd(32)} ${s.categoria.padEnd(16)} ` +
      `${String(temCampo ? reguaVal : "-").padStart(6)} ${String(helperVal).padStart(7)} ` +
      `${String(s.hardcode).padStart(8)}  ${fonte}`
    );
    // O helper SEMPRE devolve o hardcode nesta janela (no-op), venha da regua ou da rede.
    ok(helperVal === s.hardcode, `${nome} ${s.tableKey}: helper(${helperVal}) == hardcode(${s.hardcode})`);
    if (esperaCampo) {
      ok(temCampo && reguaVal === s.hardcode, `${nome} ${s.tableKey}: regua CARREGA tiquete_min e == hardcode`);
    } else {
      ok(!temCampo, `${nome} ${s.tableKey}: regua SEM tiquete_min -> caiu na rede (fallback)`);
    }
  }
}

console.log("############ PROVAS A/B — 11 categorias por competencia ############");
tabela("ABR", "TRP35_2026-04.json", true);
tabela("JUN", "TRP37_2026-06.json", true);
tabela("JUL", "TRP38_2026-07.json", false);

// --------------------------------------------------------------------------
// C — NO-OP por identidade do minimo (o gate decide igual pra qualquer ticket)
// --------------------------------------------------------------------------
console.log("\n############ PROVA C — NO-OP por identidade do minimo ############");
for (const [nome, arq] of [["ABR","TRP35_2026-04.json"],["JUN","TRP37_2026-06.json"],["JUL","TRP38_2026-07.json"]]) {
  const regra = loadRegra(arq);
  // Para cada tableKey e cada ticket-sonda ao redor de TODOS os limiares (99,100,101,
  // 999,1000,1001,1999,2000,2001,2499,2500,2501), a decisao do gate (ticket<min) com
  // a REGUA tem de ser IGUAL a decisao com o HARDCODE. Se os minimos sao iguais, e.
  const sondas = [99,100,101,999,1000,1001,1999,2000,2001,2499,2500,2501];
  let divergencias = 0;
  for (const s of SPEC) {
    const minRegua = tiqueteMinFromRegra(regra, s.tableKey);
    for (const t of sondas) {
      const gateRegua = t < minRegua;        // gate NOVO
      const gateHardcode = t < s.hardcode;   // gate ANTIGO
      if (gateRegua !== gateHardcode) divergencias++;
    }
  }
  ok(divergencias === 0, `${nome}: ${SPEC.length} tableKeys x ${sondas.length} tickets = ${SPEC.length*sondas.length} decisoes de gate; divergencias novo-vs-antigo = ${divergencias}`);
}

// --------------------------------------------------------------------------
// D — SINTETICO: regua diverge do hardcode -> o MOTOR respeita a REGUA
// --------------------------------------------------------------------------
console.log("\n############ PROVA D — SINTETICO (regua vence o hardcode) ############");
// Contrato PRIVADO, ticket 1000 (ENTRE 100 e 2000): a zona onde regua(100) e
// hardcode(2000) DISCORDAM. Taxa 2,60% e prazo 24 batem a celula CONSIG_PRIVADO
// tx_min 0,0254 / prazo 18-35 / Faixa 3 = 0,0081 da TRP35. Producao 5M -> Faixa 3.
const contratoPrivado = {
  product_description: "CREDITO CONSIGNADO PRIVADO",
  convenio_type: "PRIVADO",
  convenio_code: "9999",
  product_code: "0001",
  valor_liquido: 1000,
  valor_bruto: 1000,
  valor_seguro: 0,
  tem_seguro: false,
  taxa_juros: 2.60,
  prazo: 24,
  production_value: 5_000_000,
  company_cash_percent: 0.06,
  contract_date: "2026-04-15",
  reference_date: "2026-04-15",
  movement_date: "2026-04-15",
  proposal_date: "2026-04-15",
};

const trp35 = loadRegra("TRP35_2026-04.json");
// clone profundo e troca SO o piso do CONSIG_PRIVADO: 2000 -> 100 (como era TRP10-17).
const trp35Sintetico = JSON.parse(JSON.stringify(trp35));
trp35Sintetico.CONSIG_PRIVADO.tiquete_min = 100;

const providerReal = (comp) => (comp === "2026-04" ? trp35 : null);       // piso 2000 (== hardcode)
const providerSint = (comp) => (comp === "2026-04" ? trp35Sintetico : null); // piso 100 (regua diverge)

const pctReal = calcularOperacao(contratoPrivado, { trpProvider: providerReal }).credito.percentual;
const pctSint = calcularOperacao(contratoPrivado, { trpProvider: providerSint }).credito.percentual;
// Decisao que o gate ANTIGO (hardcode 2000) tomaria pro mesmo contrato:
const gateAntigoZera = contratoPrivado.valor_liquido < 2000; // true -> zeraria

console.log(`  regua piso 2000 (== hardcode): motor percentual = ${pctReal}  (esperado 0 -> ZERADO)`);
console.log(`  regua piso  100 (diverge):     motor percentual = ${pctSint}  (esperado 0,0081 -> PAGO)`);
console.log(`  gate ANTIGO (hardcode 2000) pro ticket 1000: ${gateAntigoZera ? "ZERARIA" : "pagaria"}`);
ok(pctReal === 0, "regua piso 2000 -> motor ZERA o contrato (piso respeitado)");
ok(Math.abs(pctSint - 0.0081) < 1e-9, "regua piso 100 -> motor PAGA 0,0081 (Faixa 3 CONSIG_PRIVADO)");
ok(gateAntigoZera === true && pctSint > 0, "o hardcode ZERARIA, mas o motor agora PAGA porque a REGUA manda (regua vence)");

// --------------------------------------------------------------------------
console.log("\n===================== VEREDITO =====================");
if (falhas === 0) {
  console.log("  OK — tiquete_min nasce da regua; NO-OP na janela viva; regua vence o hardcode quando diverge.");
  process.exit(0);
} else {
  console.log(`  FALHA — ${falhas} assercao(oes) quebrada(s).`);
  process.exit(2);
}
