/* ============================================================================
 * mov2_relatorios_gate — MOV 2, Grupo B item 3 (Relatorios). So leitura.
 *
 * Rodar:  TRP_SOURCE=db node scripts/mov2_relatorios_gate.cjs
 *
 * ANTES: report.ts resolvia o BOOLEANO (detectClosedMonth) e chamava o analytics
 * SEM closedSource. Sem closedSource, promoterAnalytics cai no `.find()` legado:
 * pega UMA linha do PMR por promotor, sem filtrar source. Promotor com linha RR
 * (source 'fechamento') E linha ADS (source 'bbts') era TRUNCADO — entrava so uma
 * das empresas. E as linhas do PDF vinham SEMPRE do cms, que nao tem jun+.
 *
 * DEPOIS: resolve o REGIME (enum) e passa closed + closedSource (o par de
 * /api/promotores:158 e do dashboard). O analytics soma RR+ADS
 * (consolidatedSummaryRows). As linhas do PDF saem por regime: cms (jan-mai) ou
 * buildClosingProposalRows (jun+).
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { detectMonthRegime } = require("../lib/cmsMonthly.ts");
const { buildPromoterAnalytics } = require("../lib/promoterAnalytics.ts");
const { buildCmsProposalRowsBatch } = require("../lib/promoterReportData.ts");
const { buildClosingProposalRows } = require("../lib/closingProposalRows.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const brl = (n) => "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => { s = String(s ?? ""); return s.length >= n ? s : s + " ".repeat(n - s.length); };
const num = (v) => Number(v || 0);
const soma = (rows, k) => rows.reduce((s, r) => s + num(r[k]), 0);

/** ANTES: closed=true, SEM closedSource -> .find() legado. */
async function relatorioAntes(year, month) {
  const regime = await detectMonthRegime(sb, year, month);
  const an = await buildPromoterAnalytics(sb, { year, month, closed: regime !== "open" });
  return { regime, rows: an.summaryRows || [] };
}
/** DEPOIS: closed + closedSource -> consolidatedSummaryRows (RR+ADS somados). */
async function relatorioDepois(year, month) {
  const regime = await detectMonthRegime(sb, year, month);
  const closedSource = regime === "open" ? undefined : regime;
  const an = await buildPromoterAnalytics(sb, { year, month, closed: regime !== "open", closedSource });
  return { regime, rows: an.summaryRows || [] };
}

(async () => {
  let falhas = 0;

  console.log("=".repeat(96));
  console.log("1) COMISSAO DO RELATORIO — .find() legado (antes)  vs  RR+ADS somados (depois)");
  console.log("=".repeat(96));
  console.log("  " + pad("COMP", 9) + pad("regime", 13) + pad("ANTES (final)", 20) + pad("DEPOIS (final)", 20) + "veredito");
  for (const m of [1, 2, 3, 4, 5, 6, 7]) {
    const a = await relatorioAntes(2026, m);
    const d = await relatorioDepois(2026, m);
    const fa = soma(a.rows, "final_commission_value");
    const fd = soma(d.rows, "final_commission_value");
    const mudou = Math.abs(fa - fd) > 0.005;
    let veredito, ok;
    if (d.regime === "open") { ok = !mudou; veredito = ok ? "NO-OP (aberto)" : "!! MUDOU (deveria ser NO-OP)"; }
    else if (d.regime === "cms") { ok = !mudou; veredito = ok ? "NO-OP (cms inalterado)" : "!! MUDOU (deveria ser NO-OP)"; }
    else { ok = true; veredito = mudou ? `CONSERTO (+${brl(fd - fa)} recuperados)` : "coincide (nenhum promotor RR+ADS)"; }
    if (!ok) falhas++;
    console.log("  " + pad(`2026-${String(m).padStart(2, "0")}`, 9) + pad(d.regime, 13) + pad(brl(fa), 20) + pad(brl(fd), 20) + veredito);
  }

  console.log("\n" + "=".repeat(96));
  console.log("2) JUNHO — os promotores que o .find() TRUNCAVA (linha RR + linha ADS)");
  console.log("=".repeat(96));
  const { data: pmrJun } = await sb.from("promoter_monthly_results")
    .select("promoter_id, company_id, source, final_commission_value")
    .eq("year", 2026).eq("month", 6).in("source", ["fechamento", "bbts"]);
  const { data: proms } = await sb.from("promoters").select("id, name");
  const pn = new Map(proms.map((p) => [p.id, p.name]));
  const porProm = new Map();
  for (const r of pmrJun) { const a = porProm.get(r.promoter_id) || []; a.push(r); porProm.set(r.promoter_id, a); }
  const duplos = [...porProm.entries()].filter(([, a]) => a.length > 1);

  const aJun = await relatorioAntes(2026, 6);
  const dJun = await relatorioDepois(2026, 6);
  const antesById = new Map(aJun.rows.map((r) => [r.promoter_id, r]));
  const depoisById = new Map(dJun.rows.map((r) => [r.promoter_id, r]));

  console.log("  " + pad("PROMOTOR", 32) + pad("linhas PMR", 12) + pad("ANTES (.find)", 18) + pad("DEPOIS (soma)", 18) + "recuperado");
  let recuperado = 0;
  for (const [pid, linhas] of duplos) {
    const a = num(antesById.get(pid)?.final_commission_value);
    const d = num(depoisById.get(pid)?.final_commission_value);
    recuperado += d - a;
    console.log("  " + pad(pn.get(pid) || pid, 32) + pad(`${linhas.length} (RR+ADS)`, 12) +
      pad(brl(a), 18) + pad(brl(d), 18) + brl(d - a));
  }
  console.log("  " + pad(`TOTAL (${duplos.length} promotores)`, 32) + pad("", 12) + pad("", 18) + pad("", 18) + brl(recuperado));

  const totalAntes = soma(aJun.rows, "final_commission_value");
  const totalDepois = soma(dJun.rows, "final_commission_value");
  console.log(`\n  Comissao de junho:  ANTES ${brl(totalAntes)}  ->  DEPOIS ${brl(totalDepois)}`);

  // ---- OS DOIS LADOS COMPUTADOS NO MESMO RUN (era constante congelada) ----
  // ERA: `Math.abs(totalDepois - 118227.41) < 0.02`. O 118.227,41 foi cravado
  // quando a frente entrou e descrito como "o PMR fechado — o que /promotores e o
  // dashboard leem". So que o PMR e TABELA VIVA: as 52 linhas de jun/2026 foram
  // reescritas ate 27/08/2026 pelas reguas de agosto (teto 5,80%, carve-out INSS),
  // e a constante virou o retrato de um PMR que nao existe mais. O portao ficou
  // vermelho sem que nada tivesse quebrado.
  //
  // AGORA o lado direito e SOMADO do PMR nesta mesma execucao. Isso nao afrouxa a
  // assercao — ao contrario, ela passa a medir o que a frase sempre prometeu ("o
  // relatorio bate com o PMR que as outras telas leem") em vez de medir a idade da
  // constante. Reprocessar o mes deixa de reprovar; o relatorio DIVERGIR do PMR
  // volta a reprovar, que e o defeito real.
  //
  // ANTI-VACUIDADE: PMR vazio nao pode passar por 0 == 0.
  const pmrJunTotal = soma(pmrJun, "final_commission_value");
  const okJun = pmrJun.length > 0 && Math.abs(totalDepois - pmrJunTotal) < 0.02;
  console.log(`  Bate com o PMR fechado (${brl(pmrJunTotal)}, somado das ${pmrJun.length} linhas de jun ` +
    `com source fechamento|bbts — o que /promotores e o dashboard leem): ${okJun ? "OK" : "!! DIVERGE"}`);
  if (pmrJun.length === 0) console.log("  !! PMR de junho VAZIO — o portao recusa passar por vacuidade.");
  if (!okJun) falhas++;

  console.log("\n" + "=".repeat(96));
  console.log("3) ABRIL — 0 promotores RR+ADS, mas o .find() vazava comissao para CHAVE MASTER");
  console.log("=".repeat(96));
  const aAbr = await relatorioAntes(2026, 4);
  const dAbr = await relatorioDepois(2026, 4);
  const tA = soma(aAbr.rows, "final_commission_value");
  const tD = soma(dAbr.rows, "final_commission_value");
  const duplosAbr = [...(await (async () => {
    const { data } = await sb.from("promoter_monthly_results").select("promoter_id, source")
      .eq("year", 2026).eq("month", 4).in("source", ["fechamento", "bbts"]);
    const m = new Map();
    for (const r of data) m.set(r.promoter_id, (m.get(r.promoter_id) || 0) + 1);
    return [...m.values()].filter((v) => v > 1);
  })())].length;
  console.log(`  promotores com 2 linhas (RR+ADS): ${duplosAbr}  -> nenhum truncamento por aqui.`);
  console.log(`  linhas do relatorio: ANTES ${aAbr.rows.length}   DEPOIS ${dAbr.rows.length} (= o PMR fechado)`);

  // ACHADO do gate: o .find() legado nao so ignora o source — ele deixa entrar
  // promotor SEM linha no ledger fechado, inclusive CHAVE MASTER (que e CNPJ/balde,
  // nao promotor). Essa comissao tem que SUMIR do mes fechado. Nao e regressao.
  const { data: promsAll } = await sb.from("promoters").select("id, name, is_master");
  const masterById = new Map(promsAll.map((p) => [p.id, p.is_master === true]));
  const A4 = new Map(aAbr.rows.map((r) => [r.promoter_id, r]));
  const D4 = new Map(dAbr.rows.map((r) => [r.promoter_id, r]));
  const vazamentos = [];
  for (const [pid, r] of A4) {
    const antes = num(r.final_commission_value);
    const depois = num(D4.get(pid)?.final_commission_value);
    if (Math.abs(antes - depois) > 0.005) {
      vazamentos.push({ nome: r.promoter_name, master: masterById.get(pid) === true, antes, depois });
    }
  }
  console.log(`\n  ${pad("PROMOTOR", 46)}${pad("is_master", 11)}${pad("ANTES", 14)}DEPOIS`);
  let vaz = 0;
  for (const v of vazamentos) {
    vaz += v.antes - v.depois;
    console.log(`  ${pad(String(v.nome).slice(0, 44), 46)}${pad(v.master, 11)}${pad(brl(v.antes), 14)}${brl(v.depois)}`);
  }
  console.log(`  ${pad("TOTAL que ia para CHAVE MASTER", 46)}${pad("", 11)}${brl(vaz)}`);
  console.log(`\n  comissao de abril: ANTES ${brl(tA)}  ->  DEPOIS ${brl(tD)}  (delta ${brl(tD - tA)})`);

  // ---- DUAS CORRECOES DE TRIAGEM, 29/08/2026 ----
  //
  // (1) `vazamentos.length > 0` era assercao de TRANSICAO e foi APOSENTADA. Ela
  //     exigia que AINDA HOUVESSE vazamento para a chave master, para entao provar
  //     que todo vazamento era de master. Em 29/08/2026 nao ha mais nenhum: ANTES e
  //     DEPOIS dao o MESMO R$ 94.004,77 (delta R$ 0,00) e as 31 linhas a mais do
  //     "ANTES" sao todas de comissao zero. Ou seja: o portao reprovava PORQUE o
  //     defeito foi consertado. Assercao que so passa enquanto o bug existe nao e
  //     portao, e lembrete — e este ja cumpriu o papel.
  //     O que FICA (invariante permanente, vale com zero ou mil vazamentos): se
  //     houver vazamento, TODO ele tem de ser de chave master. Se um dia vazar
  //     comissao de promotor de verdade, isto reprova.
  //
  // (2) o 96.143,14 era CONSTANTE CONGELADA, pelo mesmo motivo do bloco de junho
  //     acima: retrato de um PMR que foi reescrito depois. Passa a ser somado do
  //     PMR de abril nesta mesma execucao, com guarda de nao-vacuidade.
  const todasMaster = vazamentos.every((v) => v.master);
  const { data: pmrAbr } = await sb.from("promoter_monthly_results")
    .select("final_commission_value")
    .eq("year", 2026).eq("month", 4).in("source", ["fechamento", "bbts"]);
  const pmrAbrTotal = soma(pmrAbr || [], "final_commission_value");
  const bateComPmr = (pmrAbr || []).length > 0 && Math.abs(tD - pmrAbrTotal) < 0.02;
  const okAbr = todasMaster && bateComPmr;
  console.log(`  Todo vazamento e de CHAVE MASTER (${vazamentos.length} vazamento(s) hoje; ` +
    `zero tambem satisfaz — a assercao "tem de haver vazamento" foi aposentada): ${todasMaster ? "OK" : "!! CONFERIR"}`);
  console.log(`  DEPOIS bate com o PMR fechado (${brl(pmrAbrTotal)}, somado das ${(pmrAbr || []).length} linhas ` +
    `de abr com source fechamento|bbts): ${bateComPmr ? "OK" : "!! DIVERGE"}`);
  if ((pmrAbr || []).length === 0) console.log("  !! PMR de abril VAZIO — o portao recusa passar por vacuidade.");
  if (!okAbr) falhas++;

  // A fonte das linhas do PDF
  const ids = dAbr.rows.map((r) => r.promoter_id);
  const cmsBatch = await buildCmsProposalRowsBatch(sb, ids, 2026, 4);
  let linhasCms = 0;
  for (const [, l] of cmsBatch) linhasCms += l.length;
  let linhasFech = 0;
  for (let i = 0; i < ids.length; i += 8) {
    const bloco = ids.slice(i, i + 8);
    const listas = await Promise.all(bloco.map((pid) => buildClosingProposalRows(sb, pid, 2026, 4)));
    for (const l of listas) linhasFech += l.length;
  }
  console.log(`  linhas do PDF — ANTES (cms): ${linhasCms}   DEPOIS (fechamento): ${linhasFech}`);
  const okFonte = linhasCms === 0 && linhasFech > 0;
  console.log(`  -> o PDF de abril saia SEM LINHA e agora traz o fechamento: ${okFonte ? "OK" : "!! CONFERIR"}`);
  if (!okFonte) falhas++;

  console.log("\n" + "=".repeat(96));
  console.log("4) AS 3 TELAS CONCORDAM? (relatorio vs /promotores vs dashboard — todos closedSource)");
  console.log("=".repeat(96));
  for (const m of [4, 6]) {
    const d = await relatorioDepois(2026, m);
    console.log(`  2026-0${m}:  promotores=${d.rows.length}  producao=${brl(soma(d.rows, "production_value"))}  comissao=${brl(soma(d.rows, "final_commission_value"))}`);
  }
  console.log("  (mesma funcao + mesmo closedSource => as 3 telas leem o MESMO consolidatedSummaryRows)");

  console.log("\n" + "=".repeat(96));
  console.log(falhas === 0 ? "GATE RELATORIOS: PASSOU" : `GATE RELATORIOS: ${falhas} FALHA(S)`);
  console.log("=".repeat(96));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
