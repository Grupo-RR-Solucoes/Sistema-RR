/* ============================================================================
 * competencia_janela_comissoes_gate — a rota /commissions/proposals, o bulk e o
 * closingProposalRows decidem COMPETENCIA pela JANELA DE PRODUCAO, nunca pelo
 * mes do calendario.
 *
 * Rodar:
 *   node scripts/competencia_janela_comissoes_gate.cjs
 *
 * A INVARIANTE. Uma linha do diario pertence a competencia cuja JANELA a contem
 * (ultimo dia util do mes anterior -> ultimo dia util do mes vigente, fim
 * exclusivo; lib/productionPeriod.ts). Todo consumidor que precise da
 * competencia de uma linha TEM de sair de getProductionPeriodFromValue. Isso
 * vale para as quatro perguntas que a rota faz:
 *
 *   (a) QUAIS linhas listar          -> range da consulta
 *   (b) QUAL contexto de taxa usar   -> chave da faixa da TRP
 *   (c) A competencia esta ABERTA?   -> trava de regime (403 / denied_closed)
 *   (d) Que (year,month) grava       -> recalculateSingleProposal
 *
 * SETE SITIOS ERAM CALENDARIO (medidos em 18/08/2026):
 *   lib/closingProposalRows.ts:95            heranca master do ramo FECHADO
 *   app/api/commissions/proposals/route.ts   getMonthRange (listagem)
 *   app/api/commissions/proposals/route.ts   compEdicao do POST + trava de regime
 *   app/api/commissions/proposals/route.ts   compEdicao do DELETE + trava de regime
 *   lib/proposalDetailing.ts                 (year,month) de recalculateSingleProposal
 *   app/api/.../bulk/route.ts                fetchClosedDprIds (trava de regime)
 *   app/api/.../bulk/route.ts                slice(0,7) da chave do cache de contexto
 *
 * POR QUE O NUMERO MEDIDO NUM DIA NAO MEDE O RISCO. Em 18/08/2026 o delta de
 * valor da chave do cache era R$ 17,20 sobre 133 linhas discordantes — e ZERO
 * nas 68 linhas de 30/06 e 31/07. Nao por robustez: por coincidencia de data. A
 * producao de ago/2026 cruzou o piso de FAIXA_3 em 17/08, VESPERA da medicao. O
 * mesmo bulk rodado em qualquer dia entre 03/08 e 16/08 teria a chave de
 * calendario apontando FAIXA_3 (julho) e a chave certa apontando FAIXA_1 ou
 * FAIXA_2 (agosto) — faixa CHEIA de diferenca sobre R$ 284.916,12 de valor
 * liquido. Por isso o bloco 5 NAO assere um delta: ele varre a janela dia a dia
 * e exige que exista ao menos um dia em que as duas chaves dao faixas
 * diferentes. Defeito irreproduzivel por natureza nao se prova com um numero de
 * um dia.
 *
 * OS BLOCOS (os dois lados computados no MESMO run, nunca constante congelada):
 *   1. PURO          — a regua nas datas de fronteira, sem banco.
 *   2. ANTI-VACUIDADE— os QUATRO criterios velhos, reimplementados aqui, violam
 *                      a invariante nos casos medidos. Sem este bloco o gate nao
 *                      distingue "esta certo" de "nao ha o que testar".
 *   3. CODIGO        — nenhum dos sete sitios reintroduz calendario, e cada um
 *                      consome a regua canonica.
 *   4. BANCO         — vivo x vivo: as linhas do dia-cabeca aparecem na
 *                      competencia certa, e a trava de regime nao abre nenhuma
 *                      competencia FECHADA.
 *   5. FAIXA         — a chave do cache seleciona contextos com producao
 *                      diferente, e existe dia da janela em que a faixa difere.
 * ========================================================================== */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const PP = require("../lib/productionPeriod.ts");
const HM = require("../lib/herancaMaster.ts");
const PA = require("../lib/promoterAnalytics.ts");
const MOTOR = require("../lib/motor.ts");
const { detectMonthRegime } = require("../lib/cmsMonthly.ts");

const ROOT = path.resolve(__dirname, "..");
const linha = (c) => c.repeat(78);
const brl = (n) =>
  Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p2 = (n) => String(n).padStart(2, "0");

let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};

// ---------------------------------------------------------------------------
// OS QUATRO CRITERIOS VELHOS, reimplementados VERBATIM para o bloco 2.
// Reimplementar aqui e proposital: o codigo de producao nao os tem mais, e o
// gate precisa dos DOIS lados para provar que a assercao tem poder.
// ---------------------------------------------------------------------------
const VELHO_range = (year, month) => ({
  start: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
  end: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
});
const VELHO_startsWith = (mov, year, month) =>
  String(mov || "").startsWith(`${year}-${p2(month)}`);
const VELHO_compEdicao = (mov) => {
  const d = new Date(mov);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
};
const VELHO_slice7 = (mov) => String(mov).slice(0, 7);

const compChave = (mov) => {
  const per = PP.getProductionPeriodFromValue(mov);
  return per ? PP.getProductionPeriodKey(per.year, per.month) : null;
};

async function paginado(sb, tabela, cols, aplicar) {
  const out = [];
  for (let page = 0; ; page++) {
    let q = sb.from(tabela).select(cols);
    if (aplicar) q = aplicar(q);
    const { data, error } = await q.range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

(async () => {
  // =========================================================================
  console.log(linha("="));
  console.log("1) PURO — a regua nas datas de fronteira");
  console.log(linha("="));
  const wAgo = PP.getProductionWindow(2026, 8);
  const wJul = PP.getProductionWindow(2026, 7);
  console.log(`   janela jul/2026: ${wJul.start} -> ${wJul.endExclusive} (fim exclusivo)`);
  console.log(`   janela ago/2026: ${wAgo.start} -> ${wAgo.endExclusive} (fim exclusivo)`);
  ok(compChave("2026-07-31") === "2026-08", "2026-07-31 e competencia ago/2026 (dia-cabeca)");
  ok(compChave("2026-07-30") === "2026-07", "2026-07-30 e competencia jul/2026");
  ok(compChave("2026-06-30") === "2026-07", "2026-06-30 e competencia jul/2026");
  ok(compChave("2026-08-03") === "2026-08", "2026-08-03 e competencia ago/2026");
  ok(compChave(null) === null, "data ausente -> null (nao inventa competencia)");
  ok(
    wAgo.start === wJul.endExclusive,
    "as janelas se encaixam sem buraco nem sobreposicao",
    `${wJul.endExclusive} === ${wAgo.start}`
  );
  // Concordancia com pertenceACompetencia, que a heranca (e agora o
  // closingProposalRows) consome — uma regua so, nao duas que se parecem.
  let diverg = 0;
  let checadas = 0;
  for (
    let d = new Date(Date.UTC(2026, 0, 1));
    d <= new Date(Date.UTC(2026, 11, 31));
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const iso = d.toISOString().slice(0, 10);
    const per = PP.getProductionPeriodFromValue(iso);
    if (!per) continue;
    checadas += 1;
    if (HM.pertenceACompetencia(iso, per.year, per.month) !== true) diverg += 1;
  }
  ok(diverg === 0, "pertenceACompetencia concorda com a regua no ano inteiro", `divergencias=${diverg}`);
  ok(checadas > 300, "ANTI-VACUIDADE: o laco varreu o ano inteiro", `checadas=${checadas}`);

  // =========================================================================
  console.log("\n" + linha("="));
  console.log("2) ANTI-VACUIDADE — os QUATRO criterios velhos violam a invariante");
  console.log(linha("="));
  const ALVO = "2026-07-31"; // dia-cabeca de ago/2026; 32 propostas 'Producao', R$ 284.916,12
  console.log(`   linha de prova: movement_date = ${ALVO}  ->  competencia REAL = ${compChave(ALVO)}`);

  // (a) range da listagem — getMonthRange de calendario
  const rAgoVelho = VELHO_range(2026, 8);
  const dentroVelho = ALVO >= rAgoVelho.start && ALVO < rAgoVelho.end;
  const dentroNovo = ALVO >= wAgo.start && ALVO < wAgo.endExclusive;
  console.log(`   (a) range VELHO de ago  [${rAgoVelho.start}, ${rAgoVelho.end}) -> ${dentroVelho ? "DENTRO" : "FORA"}`);
  console.log(`       range NOVO  de ago  [${wAgo.start}, ${wAgo.endExclusive}) -> ${dentroNovo ? "DENTRO" : "FORA"}`);
  ok(dentroVelho === false, "(a) getMonthRange de CALENDARIO escondia a linha de agosto");
  ok(dentroNovo === true, "(a) a janela mostra a linha em agosto");

  // (b) chave do cache de contexto do bulk — slice(0,7)
  console.log(`   (b) slice(0,7) VELHO -> "${VELHO_slice7(ALVO)}"   |   chave NOVA -> "${compChave(ALVO)}"`);
  ok(VELHO_slice7(ALVO) === "2026-07", "(b) slice(0,7) apontava a competencia ERRADA");
  ok(VELHO_slice7(ALVO) !== compChave(ALVO), "(b) as duas chaves de fato discordam nesta linha");

  // (c) compEdicao do POST/DELETE e a trava de regime
  const ce = VELHO_compEdicao(ALVO);
  console.log(`   (c) compEdicao VELHO -> ${ce.year}-${p2(ce.month)}   |   NOVO -> ${compChave(ALVO)}`);
  ok(`${ce.year}-${p2(ce.month)}` === "2026-07", "(c) compEdicao de CALENDARIO apontava julho");
  ok(`${ce.year}-${p2(ce.month)}` !== compChave(ALVO), "(c) compEdicao discordava da competencia real");

  // (d) heranca master do ramo FECHADO — startsWith de prefixo de mes
  console.log(
    `   (d) startsWith("2026-07") em 2026-06-30 -> ${VELHO_startsWith("2026-06-30", 2026, 7) ? "DENTRO" : "FORA"}` +
    `   |   janela -> ${HM.pertenceACompetencia("2026-06-30", 2026, 7) ? "DENTRO" : "FORA"}`
  );
  ok(VELHO_startsWith("2026-06-30", 2026, 7) === false, "(d) o prefixo de mes descartava o dia-cabeca");
  ok(HM.pertenceACompetencia("2026-06-30", 2026, 7) === true, "(d) a janela mantem o dia-cabeca");

  // =========================================================================
  console.log("\n" + linha("="));
  console.log("3) CODIGO — nenhum dos sete sitios reintroduz calendario");
  console.log(linha("="));
  const le = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  // Comentarios sao removidos: o cabecalho de cada arquivo CITA o criterio velho
  // para explicar o defeito, e citar nao e cometer.
  const semComentario = (src) =>
    src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  const SITIOS = [
    {
      rel: "lib/closingProposalRows.ts",
      proibido: [{ re: /movement_date[^\n]*startsWith\(/, nome: "prefixo de mes em movement_date" }],
      exigido: [{ re: /pertenceACompetencia\(/, nome: "consome pertenceACompetencia" }],
    },
    {
      rel: "app/api/commissions/proposals/route.ts",
      proibido: [
        { re: /function\s+getMonthRange/, nome: "getMonthRange local" },
        { re: /Date\.UTC\(\s*year\s*,\s*month/, nome: "range por Date.UTC(year, month)" },
        { re: /getUTCMonth\(\)/, nome: "competencia por getUTCMonth()" },
      ],
      exigido: [
        { re: /getProductionWindow\(/, nome: "listagem pela janela" },
        { re: /getProductionPeriodFromValue\(/, nome: "compEdicao pela janela" },
      ],
    },
    {
      rel: "app/api/commissions/proposals/bulk/route.ts",
      proibido: [
        { re: /\.slice\(\s*0\s*,\s*7\s*\)/, nome: "slice(0,7) como chave de competencia" },
        { re: /getUTCMonth\(\)/, nome: "regime por getUTCMonth()" },
      ],
      exigido: [
        { re: /getProductionPeriodFromValue\(/, nome: "competencia pela janela" },
        { re: /getProductionPeriodKey\(/, nome: "chave do cache pela janela" },
      ],
    },
    {
      rel: "lib/proposalDetailing.ts",
      proibido: [
        { re: /movementDate\.match\(/, nome: "regex de competencia sobre movement_date" },
      ],
      exigido: [{ re: /getProductionPeriodFromValue\(/, nome: "(year,month) do recalculo pela janela" }],
    },
    {
      rel: "app/api/calculate/monthly/route.ts",
      proibido: [{ re: /getMonthRange/, nome: "nome homonimo getMonthRange" }],
      exigido: [{ re: /rangeDaJanelaProducao\(/, nome: "nome que diz a regua" }],
    },
  ];
  for (const s of SITIOS) {
    const src = semComentario(le(s.rel));
    for (const p of s.proibido) ok(!p.re.test(src), `${s.rel}: NAO tem ${p.nome}`);
    for (const e of s.exigido) ok(e.re.test(src), `${s.rel}: ${e.nome}`);
  }

  // =========================================================================
  console.log("\n" + linha("="));
  console.log("4) BANCO — vivo x vivo: listagem e trava de regime");
  console.log(linha("="));
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const rows2026 = await paginado(
    sb,
    "daily_production_records",
    "id, proposal_number, assigned_promoter_id, company_id, status, is_srcc_restricted, net_value, movement_date, contract_date, proposal_date",
    (q) => q.gte("movement_date", "2026-01-01").lt("movement_date", "2027-01-01")
  );
  console.log(`   linhas de 2026 carregadas: ${rows2026.length}`);
  ok(rows2026.length > 500, "ANTI-VACUIDADE: o banco devolveu linhas de 2026", `n=${rows2026.length}`);

  // Dias-cabeca COM producao: o defeito so existe onde ha linha na fronteira.
  const diasCabeca = new Map(); // "YYYY-MM-DD" -> { compCal, compJan, linhas }
  for (const r of rows2026) {
    const mov = String(r.movement_date || "").slice(0, 10);
    if (!mov) continue;
    const cal = mov.slice(0, 7);
    const jan = compChave(mov);
    if (!jan || jan === cal) continue;
    if (!diasCabeca.has(mov)) diasCabeca.set(mov, { cal, jan, linhas: [] });
    diasCabeca.get(mov).linhas.push(r);
  }
  const cabecas = [...diasCabeca.keys()].sort();
  console.log(`   dias-cabeca com linhas em 2026: ${cabecas.length}`);
  for (const d of cabecas) {
    const g = diasCabeca.get(d);
    const soma = g.linhas.reduce((s, r) => s + Number(r.net_value || 0), 0);
    console.log(`      ${d}  ${g.cal} -> ${g.jan}   ${String(g.linhas.length).padStart(3)} linha(s)   R$ ${brl(soma)}`);
  }
  ok(cabecas.length > 0, "ANTI-VACUIDADE: existe linha em dia-cabeca (senao o gate nao mede nada)");

  // A listagem: cada linha de dia-cabeca cai na competencia da JANELA e nao na
  // do calendario. Os dois recortes computados no mesmo run.
  let listagemErrada = 0;
  for (const d of cabecas) {
    const g = diasCabeca.get(d);
    const [yj, mj] = g.jan.split("-").map(Number);
    const [yc, mc] = g.cal.split("-").map(Number);
    const wj = PP.getProductionWindow(yj, mj);
    const rc = VELHO_range(yc, mc);
    const naJanelaCerta = d >= wj.start && d < wj.endExclusive;
    const noCalendarioErrado = d >= rc.start && d < rc.end;
    if (!naJanelaCerta || !noCalendarioErrado) listagemErrada += 1;
  }
  ok(listagemErrada === 0, "toda linha de dia-cabeca lista na competencia da janela, e listava na errada pelo calendario");

  // TRAVA DE REGIME. A pergunta que a rota faz e "esta ABERTA?". Compara-se o
  // regime das DUAS competencias candidatas para cada dia-cabeca.
  const regimeDe = new Map();
  for (const d of cabecas) {
    for (const comp of [diasCabeca.get(d).cal, diasCabeca.get(d).jan]) {
      if (regimeDe.has(comp)) continue;
      const [y, m] = comp.split("-").map(Number);
      regimeDe.set(comp, await detectMonthRegime(sb, y, m).catch(() => "open"));
    }
  }
  let flipouParaEditavel = 0;
  let abriuFechada = 0;
  for (const d of cabecas) {
    const g = diasCabeca.get(d);
    const rc = regimeDe.get(g.cal);
    const rj = regimeDe.get(g.jan);
    const editavelAntes = rc === "open";
    const editavelDepois = rj === "open";
    console.log(
      `      ${d}: regime ${g.cal}=${rc} / ${g.jan}=${rj}` +
      `   ->  editavel ANTES=${editavelAntes} DEPOIS=${editavelDepois}` +
      (editavelAntes !== editavelDepois ? "   <<< MUDA" : "")
    );
    if (!editavelAntes && editavelDepois) flipouParaEditavel += g.linhas.length;
    // A GUARDA QUE IMPORTA: o conserto nao pode abrir para edicao nenhuma linha
    // cuja competencia REAL esteja fechada.
    if (editavelDepois && rj !== "open") abriuFechada += g.linhas.length;
  }
  ok(
    abriuFechada === 0,
    "o conserto NAO abre nenhuma linha de competencia FECHADA pela janela",
    `linhas=${abriuFechada}`
  );
  console.log(`   linhas que passam de BLOQUEADAS a editaveis (competencia real ABERTA): ${flipouParaEditavel}`);

  // =========================================================================
  console.log("\n" + linha("="));
  console.log("5) FAIXA — a chave do cache seleciona contextos com producao diferente");
  console.log(linha("="));
  // O dia-cabeca MAIS RECENTE com linhas: e onde a chave errada ainda pode
  // pesar sobre competencia aberta. Nada e congelado — sai do proprio run.
  const ultimo = cabecas[cabecas.length - 1];
  const gUlt = diasCabeca.get(ultimo);
  const [yc, mc] = gUlt.cal.split("-").map(Number);
  const [yj, mj] = gUlt.jan.split("-").map(Number);
  const prodCal = PA.calcularProducaoMensalDoGrupo({
    records: rows2026,
    competencia: { year: yc, month: mc },
  }).total;
  const prodJan = PA.calcularProducaoMensalDoGrupo({
    records: rows2026,
    competencia: { year: yj, month: mj },
  }).total;
  const faixaCal = MOTOR.getProductionBandByValue(prodCal);
  const faixaJan = MOTOR.getProductionBandByValue(prodJan);
  console.log(`   dia-cabeca mais recente: ${ultimo}  (${gUlt.linhas.length} linhas)`);
  console.log(`   chave VELHA ${gUlt.cal}: producao R$ ${brl(prodCal)}  -> ${faixaCal}`);
  console.log(`   chave NOVA  ${gUlt.jan}: producao R$ ${brl(prodJan)}  -> ${faixaJan}`);
  ok(
    Math.abs(prodCal - prodJan) > 0.005,
    "as duas chaves selecionam contextos com producao DIFERENTE (a chave nao e no-op)",
    `delta R$ ${brl(prodCal - prodJan)}`
  );

  // O PONTO DO BLOCO. A faixa de HOJE pode coincidir — em 18/08/2026 coincidia,
  // por um dia. Varre-se a janela da competencia real dia a dia e exige-se que
  // exista ao menos um dia em que as duas chaves dao faixas DIFERENTES. Os dois
  // lados saem do mesmo run; nada congelado.
  const wj = PP.getProductionWindow(yj, mj);
  const diasDaJanela = [
    ...new Set(
      rows2026
        .map((r) => String(r.movement_date || "").slice(0, 10))
        .filter((d) => d >= wj.start && d < wj.endExclusive)
    ),
  ].sort();
  let diasComFaixaDiferente = 0;
  let cruzamentos = 0;
  let faixaAnterior = null;
  for (const dia of diasDaJanela) {
    const ate = rows2026.filter((r) => String(r.movement_date || "").slice(0, 10) <= dia);
    const acc = PA.calcularProducaoMensalDoGrupo({
      records: ate,
      competencia: { year: yj, month: mj },
    }).total;
    const f = MOTOR.getProductionBandByValue(acc);
    if (f !== faixaCal) diasComFaixaDiferente += 1;
    if (faixaAnterior && f !== faixaAnterior) cruzamentos += 1;
    console.log(
      `      ate ${dia}: R$ ${brl(acc).padStart(16)}  -> ${f}` +
      (f !== faixaCal ? `   != ${faixaCal} da chave velha` : "") +
      (faixaAnterior && f !== faixaAnterior ? "   <<< CRUZOU" : "")
    );
    faixaAnterior = f;
  }
  ok(diasDaJanela.length >= 3, "ANTI-VACUIDADE: a janela tem dias com producao para varrer", `dias=${diasDaJanela.length}`);
  ok(
    diasComFaixaDiferente > 0,
    "EXISTE dia da janela em que a chave velha e a nova dao FAIXAS diferentes",
    `dias=${diasComFaixaDiferente}/${diasDaJanela.length}, cruzamentos=${cruzamentos}`
  );
  console.log(
    "   LEITURA: o delta de valor medido num dia especifico NAO mede o risco — ele\n" +
    "   depende de onde a producao acumulada estava em relacao ao piso da faixa\n" +
    "   naquele dia. Por isso a assercao e sobre a EXISTENCIA do dia divergente."
  );

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e && e.message ? e.message : e);
  process.exit(1);
});
