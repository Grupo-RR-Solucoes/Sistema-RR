/* ============================================================================
 * recorte_familia_janela_gate — COMPETENCIA e CORTE sempre da MESMA familia.
 *
 * Rodar:
 *   node scripts/recorte_familia_janela_gate.cjs
 *
 * A INVARIANTE: nenhuma linha aprovada no filtro de COMPETENCIA pode ser
 * descartada pelo CORTE por criterio de outro regime. Se a competencia sai da
 * janela de producao, o corte tem de sair da mesma janela — nunca do calendario.
 *
 * O DEFEITO (03/08/2026): a competencia sempre veio de
 * getProductionPeriodFromValue (janela); o corte do delta vinha de
 * `Number(data.slice(8,10))` (dia do mes). Em ago/2026 as 32 linhas elegiveis
 * estavam em 2026-07-31 — agosto pela janela, dia 31 pelo calendario — e com
 * corte 3 nenhuma sobrevivia. Ponta atual R$ 0,00 contra R$ 853.044,40 de
 * julho: -100% de uma queda que nao houve.
 *
 * OS BLOCOS (os dois lados no mesmo run):
 *   1. POSICAO       — puro: o dia-cabeca e a posicao 1, o dia anterior a janela
 *                      e 0, e a posicao cresce com a data. Inclui o caso exato
 *                      do defeito (2026-07-31 na competencia de agosto).
 *   2. FAMILIA       — puro: para uma data aprovada na competencia X, a posicao
 *                      dela na janela de X e sempre >= 1. E a invariante, dita
 *                      em codigo: aprovado na competencia => alcancavel pelo
 *                      corte quando N chega la.
 *   3. REGRA VELHA   — puro: prova que o criterio ANTIGO viola a invariante, com
 *                      o caso medido. Sem este bloco o gate nao distingue "esta
 *                      certo" de "nao ha o que testar".
 *   4. PRODUCAO      — banco real: TODA linha elegivel de TODA competencia com
 *                      dado tem posicao >= 1 na janela dela.
 * ========================================================================== */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const RJ = require("../lib/delta/recorteJanela.ts");
const PP = require("../lib/productionPeriod.ts");
const SE = require("../lib/dashboard/serieEixo.ts");

const linha = (c) => c.repeat(78);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};

const AGO = { year: 2026, month: 8 };
const JUL = { year: 2026, month: 7 };

(async () => {
  // ---- 1. POSICAO ----
  console.log(linha("="));
  console.log("1) POSICAO na janela — o dia-cabeca e 1, nao um numero alto");
  console.log(linha("="));
  console.log(`   janela de ago/2026: total ${RJ.totalDiasDeProducao(AGO)} dias de producao`);
  ok(RJ.posicaoNaJanela(AGO, "2026-07-31") === 1, "2026-07-31 -> posicao 1 em ago/2026 (o caso do defeito)");
  ok(RJ.posicaoNaJanela(AGO, "2026-08-03") === 2, "2026-08-03 -> posicao 2 em ago/2026");
  ok(RJ.posicaoNaJanela(AGO, "2026-07-30") === 0, "2026-07-30 -> 0 (anterior ao inicio da janela)");
  ok(RJ.posicaoNaJanela(JUL, "2026-06-30") === 1, "2026-06-30 -> posicao 1 em jul/2026 (dia-cabeca)");
  ok(RJ.posicaoNaJanela(JUL, "2026-07-01") === 2, "2026-07-01 -> posicao 2 em jul/2026");
  ok(RJ.posicaoNaJanela(AGO, null) === null, "data ausente -> null (nao inventa posicao)");

  // ---- 2. FAMILIA (a invariante) ----
  console.log("\n" + linha("="));
  console.log("2) FAMILIA — aprovado na competencia => posicao >= 1 na janela dela");
  console.log(linha("="));
  let violacoes = 0;
  let checadas = 0;
  // Varre um ano inteiro de datas: para CADA data, descobre a competencia pelo
  // mesmo predicado do sistema e exige que a posicao dela na janela daquela
  // competencia seja >= 1. E a definicao da invariante, sem depender de banco.
  for (let d = new Date(Date.UTC(2026, 0, 1)); d <= new Date(Date.UTC(2026, 11, 31)); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const comp = PP.getProductionPeriodFromValue(iso);
    if (!comp) continue;
    checadas += 1;
    const pos = RJ.posicaoNaJanela(comp, iso);
    if (!(pos != null && pos >= 1)) {
      violacoes += 1;
      if (violacoes <= 5) console.log(`      VIOLACAO: ${iso} -> competencia ${comp.year}-${comp.month}, posicao ${pos}`);
    }
  }
  console.log(`   datas checadas: ${checadas}`);
  ok(violacoes === 0, "nenhuma data aprovada na competencia fica fora da janela dela", `violacoes=${violacoes}`);
  ok(checadas > 300, "ANTI-VACUIDADE: o laco varreu o ano inteiro", `checadas=${checadas}`);

  // ---- 3. A REGRA VELHA VIOLA (prova que o teste tem poder) ----
  console.log("\n" + linha("="));
  console.log("3) REGRA VELHA — o criterio antigo violava a invariante");
  console.log(linha("="));
  const diaDoMes = (iso) => Number(String(iso).slice(8, 10));
  // O caso medido: 2026-07-31, competencia agosto, corte no 2o dia de producao.
  const iso = "2026-07-31";
  const compDoDefeito = PP.getProductionPeriodFromValue(iso);
  const N = 2;
  const velho = diaDoMes(iso) >= 1 && diaDoMes(iso) <= N;
  const novo = RJ.recorteDaJanela(AGO, N).dentro({ movement_date: iso });
  console.log(`   ${iso}: competencia = ${compDoDefeito.year}-${compDoDefeito.month}, N = ${N}`);
  console.log(`   criterio VELHO (dia do mes ${diaDoMes(iso)} <= ${N}) -> ${velho ? "DENTRO" : "FORA"}`);
  console.log(`   criterio NOVO  (posicao ${RJ.posicaoNaJanela(AGO, iso)} <= ${N})      -> ${novo ? "DENTRO" : "FORA"}`);
  ok(compDoDefeito.year === 2026 && compDoDefeito.month === 8, "a linha E de agosto pela competencia");
  ok(velho === false, "a regra VELHA descartava a linha (era o defeito)");
  ok(novo === true, "a regra NOVA mantem a linha");

  // ---- 4. PRODUCAO ----
  console.log("\n" + linha("="));
  console.log("4) PRODUCAO — toda linha elegivel tem posicao >= 1 na janela dela");
  console.log(linha("="));
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const paged = async (build) => {
    let f = 0, s = 1000, a = [];
    for (;;) {
      const { data, error } = await build().range(f, f + s - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      a.push(...data);
      if (data.length < s) break;
      f += s;
    }
    return a;
  };
  const rows = await paged(() =>
    sb.from("daily_production_records")
      .select("status, is_srcc_restricted, cancellation_date, movement_date, contract_date, proposal_date")
      .gte("movement_date", "2026-01-01")
  );
  let elegiveis = 0, fora = 0;
  const porComp = new Map();
  for (const r of rows) {
    if (!SE.isProductionStatus(r.status)) continue;
    if (!SE.isValidDailyRecord(r)) continue;
    const comp = SE.competenciaDaLinha(r);
    if (!comp) continue;
    elegiveis += 1;
    const k = `${comp.year}-${String(comp.month).padStart(2, "0")}`;
    const pos = RJ.posicaoNaJanela(comp, RJ.dataDoRegistro(r));
    const v = porComp.get(k) || { n: 0, min: Infinity, max: -Infinity };
    v.n += 1;
    if (pos != null) { v.min = Math.min(v.min, pos); v.max = Math.max(v.max, pos); }
    porComp.set(k, v);
    if (!(pos != null && pos >= 1)) {
      fora += 1;
      if (fora <= 5) console.log(`      FORA: ${RJ.dataDoRegistro(r)} comp ${k} posicao ${pos}`);
    }
  }
  for (const k of [...porComp.keys()].sort()) {
    const v = porComp.get(k);
    console.log(`   ${k}: ${String(v.n).padStart(4)} linhas | posicoes ${v.min}..${v.max} de ${RJ.totalDiasDeProducao({ year: Number(k.slice(0, 4)), month: Number(k.slice(5)) })}`);
  }
  ok(elegiveis > 0, "ANTI-VACUIDADE: ha linha elegivel no banco", `elegiveis=${elegiveis}`);
  ok(fora === 0, "nenhuma linha elegivel cai fora da janela da propria competencia", `fora=${fora}`);

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
