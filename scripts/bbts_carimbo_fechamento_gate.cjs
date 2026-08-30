/* ============================================================================
 * bbts_carimbo_fechamento_gate — o dinheiro do PDF da BBTS entra na competencia
 * em que o PDF PAGOU, e valor de fechamento sem carimbo NUNCA soma em silencio.
 *
 * Rodar:
 *   node scripts/bbts_carimbo_fechamento_gate.cjs
 *
 * SELF-CONTAINED: sem createClient, sem .env, sem caminho absoluto. A funcao
 * medida (buildAdsCashByPeriod) e PURA — entra array, sai Map — entao o portao
 * roda no CI, que e a unica faixa que sempre roda.
 *
 * ----------------------------------------------------------------------------
 * A INVARIANTE, em duas metades que se sustentam:
 *   COMPETENCIA — a perna do pagamento (bbts_pag_avista + bbts_seguro_pago) e
 *                 somada pela competencia do FECHAMENTO, nao pela janela das
 *                 datas do CONTRATO. As duas divergem, e ha caso real.
 *   AUSENCIA    — linha com valor e SEM carimbo nao entra em competencia
 *                 nenhuma E e reportada. Somar pela janela "porque e o que
 *                 sobrou" e exatamente o defeito.
 *
 * O CASO REAL que originou tudo (medido em 30/08/2026): a linha
 * 5240028e-464b-428a-870d-86576c31dfc6 (operacao 221262790, R$ 89,42) nasceu do
 * DIARIO em 04/08 com a data real do contrato (movement_date 31/07) e recebeu
 * bbts_seguro_pago por BACKFILL em 28/08. Pela janela ela caia em 2026-08; os
 * 89,42 sao do PDF de JULHO. Julho exibia 115,10 em vez de 204,52.
 * A fixture do bloco 1 reproduz essa linha.
 *
 * POR QUE NAO BASTA CONFERIR O IMPORTADOR: ele sempre carimbou (movement_date no
 * dia 15, que cai dentro da janela). O furo nao veio dele — veio de escrita POR
 * FORA dele. Por isso o portao mede o LEITOR e o CHECK do banco, nao so a
 * importacao.
 * ========================================================================== */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { buildAdsCashByPeriod } = require("../lib/financialAnalytics.ts");

const ROOT = path.join(__dirname, "..");
const linha = (c) => c.repeat(78);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra !== undefined ? "  " + extra : ""}`);
  if (!cond) falhas++;
};
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- FIXTURE
// Tres linhas carimbadas em julho (uma delas com a data do contrato em AGOSTO
// pela janela — e a que separa os dois criterios) e duas em junho.
const JULHO = "2026-07-01";
const JUNHO = "2026-06-01";
const fixture = () => [
  // a linha do caso real: janela diz AGOSTO, carimbo diz JULHO
  { bbts_pag_avista: null, bbts_seguro_pago: 89.42, movement_date: "2026-07-31", contract_date: null, proposal_date: null, bbts_competencia_fechamento: JULHO },
  // linhas normais de julho (carimbo do importador = dia 15)
  { bbts_pag_avista: 1000, bbts_seguro_pago: 10, movement_date: "2026-07-15", contract_date: "2026-07-03", proposal_date: "2026-07-03", bbts_competencia_fechamento: JULHO },
  { bbts_pag_avista: 500, bbts_seguro_pago: 5, movement_date: "2026-07-15", contract_date: "2026-07-20", proposal_date: "2026-07-20", bbts_competencia_fechamento: JULHO },
  // junho
  { bbts_pag_avista: 200, bbts_seguro_pago: 2, movement_date: "2026-06-15", contract_date: "2026-06-05", proposal_date: "2026-06-05", bbts_competencia_fechamento: JUNHO },
  { bbts_pag_avista: 300, bbts_seguro_pago: 3, movement_date: "2026-06-15", contract_date: "2026-06-28", proposal_date: "2026-06-28", bbts_competencia_fechamento: JUNHO },
  // linha SEM valor de fechamento e sem carimbo: e a maioria do banco, e tem de
  // ser ignorada em silencio (nao e defeito, e o caso normal do diario).
  { bbts_pag_avista: null, bbts_seguro_pago: null, movement_date: "2026-07-10", contract_date: "2026-07-10", proposal_date: "2026-07-10", bbts_competencia_fechamento: null },
];
const PRT = [{ competencia: "2026-07-01", valor_parcela: 7.01 }];
const CAB = [{ competencia: "2026-07-01", abertura_conta: 100 }];

const rodar = (linhas) => {
  const semCarimbo = { linhas: 0, valor: 0 };
  const mapa = buildAdsCashByPeriod(linhas, PRT, CAB, semCarimbo);
  return { mapa, semCarimbo };
};

console.log(linha("="));
console.log("bbts_carimbo_fechamento_gate — a perna do pagamento segue o PDF");
console.log(linha("="));

// =============================================================== BLOCO 1
console.log("\n1) COMPETENCIA — o carimbo manda, a janela nao");
console.log(linha("-"));
{
  const { mapa, semCarimbo } = rodar(fixture());
  const jul = mapa.get("2026-07") || {};
  const jun = mapa.get("2026-06") || {};
  const ago = mapa.get("2026-08");

  ok(mapa.size >= 2, "ANTI-VACUIDADE: ha MAIS DE UMA competencia (com uma so, 'foi para a certa' e trivial)", `${mapa.size}`);
  ok(
    Math.abs((jul.seguro || 0) - 104.42) < 0.005,
    "os 89,42 da linha de 31/07 entram em JULHO (o PDF que pagou)",
    `seguro de julho = ${brl(jul.seguro)} (89,42 + 10 + 5)`
  );
  ok(ago === undefined, "AGOSTO nao existe no mapa — a janela diria agosto e ela nao manda", `${ago === undefined ? "ausente" : JSON.stringify(ago)}`);
  ok(Math.abs((jul.avista || 0) - 1500) < 0.005, "o AVT de julho e o das linhas carimbadas em julho", brl(jul.avista));
  ok(Math.abs((jun.seguro || 0) - 5) < 0.005, "junho fica com o que e de junho", brl(jun.seguro));
  ok(Math.abs((jun.avista || 0) - 500) < 0.005, "o AVT de junho idem", brl(jun.avista));
  ok(semCarimbo.linhas === 0, "nenhuma linha COM valor ficou sem carimbo nesta fixture", `${semCarimbo.linhas}`);
  ok(Math.abs((jul.prt || 0) - 7.01) < 0.005 && Math.abs((jul.abertura || 0) - 100) < 0.005,
    "CONTROLE POSITIVO: PRT e Abertura seguem lidos pela competencia literal", `prt ${brl(jul.prt)} / abertura ${brl(jul.abertura)}`);
}

// =============================================================== BLOCO 2
console.log("\n2) MUTACAO A — tirar o carimbo reproduz o defeito de 28/08/2026");
console.log(linha("-"));
{
  // Exatamente o que o backfill de 28/08 fez: gravou o VALOR sem a competencia.
  const mutada = fixture();
  mutada[0].bbts_competencia_fechamento = null;
  const { mapa, semCarimbo } = rodar(mutada);
  const jul = mapa.get("2026-07") || {};
  const ago = mapa.get("2026-08");

  ok(semCarimbo.linhas === 1, "a linha sem carimbo e CONTADA (vira alerta no chamador)", `${semCarimbo.linhas} linha(s)`);
  ok(Math.abs(semCarimbo.valor - 89.42) < 0.005, "e o VALOR dela e reportado", brl(semCarimbo.valor));
  ok(
    Math.abs((jul.seguro || 0) - 15) < 0.005,
    "ela NAO entra em julho as escondidas (julho cai para 15,00, e o alerta explica o resto)",
    brl(jul.seguro)
  );
  ok(ago === undefined, "e sobretudo NAO cai em agosto pela janela — o defeito NAO volta", `${ago === undefined ? "ausente" : JSON.stringify(ago)}`);
  ok(
    Math.abs((jul.avista || 0) - 1500) < 0.005 && Math.abs((mapa.get("2026-06") || {}).avista - 500) < 0.005,
    "CONTROLE POSITIVO: as outras 4 linhas continuam inteiras (a mutacao nao virou trava geral)",
    `julho ${brl(jul.avista)} / junho ${brl((mapa.get("2026-06") || {}).avista)}`
  );
}

// =============================================================== BLOCO 3
console.log("\n3) MUTACAO B — se o leitor voltasse a janela, o portao TEM de reprovar");
console.log(linha("-"));
{
  // Reimplementa o criterio ANTIGO e prova que ele produz numero DIFERENTE. Sem
  // isto o bloco 1 passaria mesmo se os dois criterios coincidissem, e a fixture
  // nao estaria provando nada.
  const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
  const porJanela = new Map();
  for (const r of fixture()) {
    const p =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    if (!p) continue;
    const k = getProductionPeriodKey(p.year, p.month);
    porJanela.set(k, (porJanela.get(k) || 0) + (Number(r.bbts_seguro_pago) || 0));
  }
  const { mapa } = rodar(fixture());
  ok(
    Math.abs((porJanela.get("2026-08") || 0) - 89.42) < 0.005,
    "o criterio ANTIGO de fato jogava os 89,42 em agosto (a fixture separa os dois)",
    brl(porJanela.get("2026-08"))
  );
  ok(
    Math.abs((porJanela.get("2026-07") || 0) - 15) < 0.005,
    "e deixava julho com 15,00",
    brl(porJanela.get("2026-07"))
  );
  ok(
    Math.abs((mapa.get("2026-07") || {}).seguro - (porJanela.get("2026-07") || 0)) > 0.005,
    "os DOIS criterios dao numeros DIFERENTES — o bloco 1 nao passa por coincidencia",
    `carimbo ${brl((mapa.get("2026-07") || {}).seguro)} x janela ${brl(porJanela.get("2026-07"))}`
  );
}

// =============================================================== BLOCO 4
console.log("\n4) A GUARDA NO BANCO — o CHECK existe, e nasce NOT VALID antes do backfill");
console.log(linha("-"));
{
  const sqlPath = path.join(ROOT, "supabase/migrations/20260830_000001_bbts_competencia_fechamento.sql");
  const existe = fs.existsSync(sqlPath);
  ok(existe, "a migration 20260830_000001 esta versionada", existe ? "" : sqlPath);
  if (existe) {
    const sql = fs.readFileSync(sqlPath, "utf8");
    ok(/add column if not exists bbts_competencia_fechamento date/i.test(sql), "cria a coluna bbts_competencia_fechamento");
    ok(/dpr_valor_fechamento_exige_competencia/.test(sql), "cria o CHECK dpr_valor_fechamento_exige_competencia");
    ok(
      /coalesce\(bbts_pag_avista, 0\) = 0 and coalesce\(bbts_seguro_pago, 0\) = 0[\s\S]{0,80}bbts_competencia_fechamento is not null/i.test(sql),
      "e o CHECK diz exatamente 'valor de fechamento exige carimbo'"
    );
    // A ORDEM e a parte que um humano erraria: validar antes do backfill reprova
    // na linha 5240028e e a migration morre no meio.
    const iNotValid = sql.indexOf("not valid");
    const iBackfill = sql.indexOf("set bbts_competencia_fechamento");
    const iValidate = sql.indexOf("validate constraint");
    ok(iNotValid > 0 && iValidate > 0, "o CHECK nasce NOT VALID e e validado depois");
    ok(iBackfill > 0 && iBackfill < iValidate, "o BACKFILL vem ANTES do validate (senao a migration morre no meio)", `backfill@${iBackfill} < validate@${iValidate}`);
    ok(/add column if not exists seguro_total/i.test(sql), "o cabecalho ganha seguro_total (a ancora do deposito que era descartada)");
  }
}

// =============================================================== BLOCO 5
console.log("\n5) O CARIMBO ANDA COM O VALOR — ancoras no fonte do importador");
console.log(linha("-"));
{
  const imp = fs.readFileSync(path.join(ROOT, "lib/bbtsClosingImport.ts"), "utf8");
  const ocorrencias = (imp.match(/bbts_competencia_fechamento: compFechamento/g) || []).length;
  // DUAS: o bloco de credito e o bloco so-seguro. Contadas, nao "existe pelo
  // menos uma" — carimbar so um dos dois deixaria o outro escrevendo valor sem
  // competencia, que e o defeito de novo.
  ok(ocorrencias === 2, "os DOIS blocos que gravam valor tambem gravam o carimbo", `${ocorrencias} de 2`);
  ok(/const compFechamento = /.test(imp), "compFechamento sai da competencia do proprio arquivo");
  const extrator = fs.readFileSync(path.join(ROOT, "lib/bbtsPdfExtract.ts"), "utf8");
  ok(/seguro_total: round2\(seg\.totalAnchor\)/.test(extrator), "o extrator deixou de descartar o TOTAL do PDF de seguro");

  const fin = fs.readFileSync(path.join(ROOT, "lib/financialAnalytics.ts"), "utf8");
  const dre = fs.readFileSync(path.join(ROOT, "lib/dre.ts"), "utf8");
  ok(/bbts_competencia_fechamento/.test(fin), "o card Recebido pede o carimbo na consulta");
  ok(/bbts_competencia_fechamento/.test(dre), "o DRE pede o carimbo na consulta");
  // As DUAS telas leem a mesma coisa: se uma voltar para a janela sozinha, elas
  // divergem de novo — que foi o estado que originou o bloco da ADS no dre.ts.
  ok(
    /42703|column .\* does not exist/.test(fin) && /42703|column .\* does not exist/.test(dre),
    "as duas toleram a coluna inexistente (deploy do codigo antes do SQL nao derruba a tela)"
  );
}

console.log("\n" + linha("="));
console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
console.log(linha("="));
process.exit(falhas === 0 ? 0 : 1);
