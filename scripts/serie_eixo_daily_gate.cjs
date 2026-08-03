/* ============================================================================
 * serie_eixo_daily_gate — o mes com producao IMPORTADA nao pode sumir do eixo.
 *
 * Rodar:
 *   node scripts/serie_eixo_daily_gate.cjs
 *
 * A INVARIANTE: toda competencia com daily ELEGIVEL aparece no eixo da serie
 * mensal do grupo (grafico "Producao mensal do grupo" do Dashboard).
 *
 * O DEFEITO (03/08/2026): o eixo saia de PMR + daily de chave MASTER nao
 * atribuida. Nenhuma das duas olhava a daily ATRIBUIDA. Enquanto julho/2026
 * tinha 8 linhas fosseis de PMR o mes aparecia; apagadas essas linhas, julho
 * sumiu do grafico com 873 linhas de daily elegivel (R$ 6.482.490,15). Medido
 * no dia: eixo = [1,2,3,4,5,6,8].
 *
 * POR QUE ELE FALHA NO CODIGO ANTIGO. A regra foi extraida para
 * lib/dashboard/serieEixo.ts, que NAO existe antes desta frente: sob `git stash`
 * o require falha e o gate reporta a ausencia como FALHA nominal, em vez de
 * estourar com stack. A ausencia do modulo E o defeito — antes dela, nenhuma
 * linha do repo derivava o eixo do daily.
 *
 * OS TRES BLOCOS (os dois lados no mesmo run, para nao passar por vacuidade):
 *   1. PURO      — stub em memoria: uma linha elegivel poe o mes no conjunto;
 *                  cancelada / pendente / SRCC restrita / status errado NAO poem.
 *                  Inclui o teste do ACENTO, que crava a classe de combinantes
 *                  do normStatus depois da mudanca de casa.
 *   2. CASCATA   — linha sem movement_date entra pela contract_date/proposal_date
 *                  (a competencia do resto do sistema), e nao pelo movement_date so.
 *   3. PRODUCAO  — banco real: para CADA competencia com daily elegivel, ela tem
 *                  de estar no eixo. Calcula tambem o eixo ANTIGO (PMR + master)
 *                  e reporta o que SO a fonte nova sustenta — se esse conjunto
 *                  for vazio o gate avisa que perdeu poder de deteccao.
 * ========================================================================== */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");

const linha = (c) => c.repeat(78);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};

// --- o modulo sob teste. Ausente = o defeito desta frente ---
let SE = null;
try {
  SE = require("../lib/dashboard/serieEixo.ts");
} catch (e) {
  console.log(linha("="));
  console.log("FALHA ESTRUTURAL — lib/dashboard/serieEixo.ts nao existe/nao carrega.");
  console.log(linha("="));
  console.log("   " + (e.message || e));
  console.log("\n   E EXATAMENTE O DEFEITO: sem este modulo nenhuma linha do repo");
  console.log("   deriva o eixo da serie a partir do daily, e um mes com producao");
  console.log("   importada mas nao consolidada some do grafico.");
  console.log("\n" + linha("="));
  console.log("GATE: 1 FALHA(S)");
  console.log(linha("="));
  process.exit(1);
}

const { competenciasComDailyElegivel, isProductionStatus, isValidDailyRecord } = SE;

const linhaDaily = (over) => ({
  status: "Producao",
  is_srcc_restricted: false,
  cancellation_date: null,
  movement_date: "2026-07-15",
  contract_date: null,
  proposal_date: null,
  ...over,
});
const tem = (rows, mes) => competenciasComDailyElegivel(rows, 2026).has(mes);

(async () => {
  // ---- 1. PURO ----
  console.log(linha("="));
  console.log("1) PURO — a regra de elegibilidade decide quem poe o mes no eixo");
  console.log(linha("="));
  ok(tem([linhaDaily({})], 7), "linha PRODUCAO elegivel -> mes 7 entra");
  ok(!tem([linhaDaily({ status: "Cancelado" })], 7), "status Cancelado -> NAO entra");
  ok(!tem([linhaDaily({ status: "Pendente" })], 7), "status Pendente -> NAO entra");
  ok(!tem([linhaDaily({ is_srcc_restricted: true })], 7), "SRCC restrita -> NAO entra");
  ok(!tem([linhaDaily({ cancellation_date: "2026-07-20" })], 7), "cancellation_date -> NAO entra");
  ok(!tem([linhaDaily({})], 6), "mes 6 NAO entra por causa de linha de julho");
  ok(!tem([linhaDaily({ movement_date: "2025-07-15" })], 7), "ano diferente -> NAO entra");
  // ACENTO: crava a classe de combinantes do normStatus depois da mudanca de casa.
  // Se ela se perder numa copia, "Produção" nao vira "PRODUCAO" e isto acende.
  ok(isProductionStatus("Produção") === true, 'isProductionStatus("Produção") === true (NFD + combinantes)');
  ok(isProductionStatus("producao") === true, 'isProductionStatus("producao") === true');
  ok(isValidDailyRecord({ status: "Producao", is_srcc_restricted: null, cancellation_date: null }) === true,
    "isValidDailyRecord aceita linha limpa");

  // ---- 2. CASCATA DE COMPETENCIA ----
  console.log("\n" + linha("="));
  console.log("2) CASCATA — movement_date -> contract_date -> proposal_date");
  console.log(linha("="));
  ok(tem([linhaDaily({ movement_date: null, contract_date: "2026-07-15" })], 7),
    "sem movement_date, entra pela contract_date");
  ok(tem([linhaDaily({ movement_date: null, contract_date: null, proposal_date: "2026-07-15" })], 7),
    "so com proposal_date, entra pela proposal_date");
  ok(!tem([linhaDaily({ movement_date: null, contract_date: null, proposal_date: null })], 7),
    "sem nenhuma das tres datas -> NAO entra (nao inventa competencia)");

  // ---- 3. PRODUCAO ----
  console.log("\n" + linha("="));
  console.log("3) PRODUCAO — toda competencia com daily elegivel esta no eixo");
  console.log(linha("="));
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const ANO = Number(process.env.GATE_ANO || 2026);
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

  const daily = await paged(() =>
    sb.from("daily_production_records")
      .select("company_id, assigned_promoter_id, status, is_srcc_restricted, cancellation_date, movement_date, contract_date, proposal_date")
      .gte("movement_date", `${ANO - 1}-12-15`)
      .lt("movement_date", `${ANO + 1}-01-10`)
  );
  const comDaily = competenciasComDailyElegivel(daily, ANO);

  // Eixo ANTIGO, reproduzido: PMR do ano + balde master. Serve de contraste —
  // e o conjunto que o Dashboard tinha antes desta frente.
  const pmr = await paged(() => sb.from("promoter_monthly_results").select("year, month, production_value"));
  const doPmr = new Set(pmr.filter((r) => r.year === ANO).map((r) => r.month));
  const doMaster = competenciasComDailyElegivel(
    daily.filter((r) => !r.assigned_promoter_id), ANO
  );
  const eixoAntigo = new Set([...doPmr, ...doMaster]);
  const eixoNovo = new Set([...doPmr, ...doMaster, ...comDaily]);

  const ordena = (s) => [...s].sort((a, b) => a - b);
  console.log(`   competencias com daily elegivel : ${JSON.stringify(ordena(comDaily))}`);
  console.log(`   eixo ANTIGO (PMR + master)      : ${JSON.stringify(ordena(eixoAntigo))}`);
  console.log(`   eixo NOVO   (+ daily atribuida) : ${JSON.stringify(ordena(eixoNovo))}`);

  const faltando = ordena(comDaily).filter((m) => !eixoNovo.has(m));
  ok(faltando.length === 0, "toda competencia com daily elegivel esta no eixo",
    faltando.length ? `faltando: ${JSON.stringify(faltando)}` : "");

  // ANTI-VACUIDADE: se a fonte nova nao sustentar NENHUM mes sozinha, este gate
  // deixou de provar qualquer coisa sobre o defeito — avisa alto.
  const soPelaNova = ordena(comDaily).filter((m) => !eixoAntigo.has(m));
  console.log(`   meses que SO a fonte nova sustenta: ${JSON.stringify(soPelaNova)}`);
  if (soPelaNova.length === 0) {
    console.log("   AVISO: nenhum mes depende so da fonte nova neste banco hoje.");
    console.log("   O bloco 3 vira tautologia (todo mes ja estava no eixo antigo).");
    console.log("   Os blocos 1 e 2 seguem provando a regra; o 3 perde poder ate");
    console.log("   existir de novo um mes importado e nao consolidado.");
  }

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
