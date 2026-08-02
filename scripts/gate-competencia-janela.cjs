/*
 * GATE — o recorte do VOLUME (escala ENTRANTE) e da PRODUCAO DA FRENTE C usa a
 * JANELA DE PRODUCAO, nao o mes de calendario. READ-ONLY (le prod).
 *
 * Fecha o bug medido em 31/07/2026: fetchPromoterShareData recortava por
 * `${year}-${mm}-01` ate o dia 1 do mes seguinte, jogando o ULTIMO DIA UTIL do
 * mes no balde errado. Ver a TRAVA no topo do bloco "3. Volume mensal por
 * promotor" em lib/proposalDetailing.ts antes de reprocessar mes fechado.
 *
 * ASSERCOES — todas em DELTA/IGUALDADE, nenhuma em valor absoluto. Nada aqui
 * depende de quantos promotores, empresas ou linhas existem hoje; se o banco
 * dobrar de tamanho ou esvaziar, o gate continua valido.
 *
 *   A) para CADA competencia presente no dado: o conjunto de linhas selecionado
 *      pelo RANGE da janela (getProductionWindow, o que a query faz) e identico
 *      ao conjunto classificado linha a linha por getProductionPeriodFromValue
 *      (o que o resto do sistema usa). Diferenca simetrica = 0.
 *   B) nenhuma linha cujo movement_date seja o ULTIMO DIA UTIL do mes cai no
 *      bucket do mes corrente — ela pertence a competencia seguinte.
 *   C) o range da janela e coerente: start < endExclusive, e o endExclusive de
 *      uma competencia e o start da seguinte (as janelas se encaixam sem furo
 *      nem sobreposicao).
 *
 * ============================================================================
 * NOTA DE CORRECAO — O NUMERO DO COMMIT 3daea7e ESTA ERRADO (medido 01/08/2026)
 * ============================================================================
 * O commit 3daea7e (e a memoria da frente) diz que reprocessar jun/2026 tira
 * R$ 82,29 da ERIKA LILIAM. O valor MEDIDO POR EXECUCAO e -R$ 23,17.
 * A nota vive aqui, e nao num commit de texto, porque este arquivo e o que
 * alguem abre antes de reprocessar uma competencia fechada. O historico do
 * git NAO foi reescrito.
 *
 * DE ONDE VEIO O ERRO. Os -82,29 foram ESTIMATIVA que assumiu uniformidade:
 * aplicaram a queda de degrau (Frente C 0,6355 -> 0,6250 = 1,05 p.p.) sobre a
 * base INTEIRA da ERIKA.
 *
 *     estimativa antiga:  7.931,48 x 0,0105 = 83,28   (~ os 82,29 do commit)
 *     medido de verdade:  2.206,71 x 0,0105 = 23,17
 *
 * POR QUE SO UMA PARTE DA BASE. acordoDoContrato (closingMonthly.ts:340-358)
 * so passa a Frente C nos contratos da FAIXA 5,80% (flag isFaixa580); fora
 * dela vale o acordo base (62,50%), que nao depende do degrau. Dos 42
 * contratos da ERIKA em jun/2026 (7 deles por heranca master, __pid em
 * closingMonthly.ts:229), apenas 7 mudam:
 *
 *     FAIXA 5,80%    63,5500% -> 62,5000%   n= 7   comEmp 2.206,71   -23,17
 *     fora da faixa  62,5000% -> 62,5000%   n=35   comEmp 5.724,77     0,00
 *
 * Reproduzido chamando consolidateMonthlyFromClosing REAL e injetando os dois
 * volumes (225.634,94 e 216.344,94) por volumeConsolidadoByPromoter /
 * prodConsolidadoByPromoter: production_commission_value vai de 4.980,35 para
 * 4.957,18.
 *
 * ---------------------------------------------------------------------------
 * PMR HIBRIDO — 26 DE 41, E E ANTERIOR AO 3daea7e
 * ---------------------------------------------------------------------------
 * O PMR de jun/2026 tem production_value vindo do FECHAMENTO (janela) enquanto
 * o degrau foi decidido pelo volume do proposalDetailing (CALENDARIO). Medido
 * sobre os 41 promotores com PMR source='fechamento' em jun/2026: 26 estavam
 * HIBRIDOS, 15 coerentes. O 3daea7e ALINHOU os 26 (volume-janela ==
 * production_value gravado). Ele NAO introduziu divergencia: revelou e fechou
 * uma que ja existia em 26 linhas.
 *
 * A ERIKA e so a 14a maior divergencia. As maiores:
 *     357d85d6   R$ 107.000,00      1962afcb   R$  26.975,00
 *     bbca7d0f   R$  27.699,15      9286ee24   R$   9.290,00  (ERIKA)
 *     c747e058   R$  27.000,00
 *
 * ***  O SILENCIO DOS OUTROS 25 E CIRCUNSTANCIAL, NAO ESTRUTURAL.  ***
 * Hoje so a ERIKA muda dinheiro. Os outros 25 estao quietos porque nao tem
 * promoter_goal_repasse, ou nao tem contrato na faixa 5,80% para a Frente C
 * morder, ou nao cruzam fronteira de degrau — nao porque o codigo os proteja.
 * Se qualquer um deles ganhar acordo de Frente C ou passar a vender na faixa,
 * a divergencia dele VIRA DINHEIRO na hora. A maior (357d85d6, R$ 107.000,00)
 * e mais de dez vezes a da ERIKA. Reavaliar esta lista antes de reprocessar,
 * e nao confiar no "so um promotor" de hoje.
 *
 * JULHO EM DIANTE JA NASCE ALINHADO: o recorte por janela vale desde o
 * 3daea7e, entao competencia nova nao acumula divergencia. O problema e
 * historico e finito, nao recorrente.
 * ============================================================================
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { getProductionPeriodFromValue, getProductionWindow } = require("../lib/productionPeriod.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let falhas = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK " : "XX "} ${m}`); if (!c) falhas++; };
const brl = n => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
// MESMA elegibilidade da query real (lib/proposalDetailing.ts, bloco do volume)
const valido = r => {
  const st = norm(r.status);
  return (st === "PRODUCAO" || st === "PRODUCTION") && !r.cancellation_date && !r.is_srcc_restricted;
};
async function todas(t, c) {
  const o = [];
  for (let p = 0; ; p++) {
    // .order("id") OBRIGATORIO: range() sem ordem estavel repete/pula linhas
    // entre paginas. Faltava aqui — num gate que decide se se reprocessa mes
    // fechado, ler o conjunto errado e pior que nao ler.
    const { data, error } = await sb.from(t).select(c).order("id").range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    o.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return o;
}
const ymOf = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
const proximo = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1]);

(async () => {
  const rows = (await todas(
    "daily_production_records",
    "id, proposal_number, net_value, status, cancellation_date, is_srcc_restricted, movement_date"
  )).filter(r => /^\d{4}-\d{2}-\d{2}/.test(String(r.movement_date ?? "")) && valido(r));

  // competencias DERIVADAS do dado (nada hardcoded)
  const comps = new Set();
  for (const r of rows) {
    const p = getProductionPeriodFromValue(r.movement_date);
    if (p) comps.add(ymOf(p.year, p.month));
  }
  const lista = [...comps].sort();
  console.log(`linhas elegiveis: ${rows.length} | competencias derivadas do dado: ${lista.join(", ")}\n`);
  ok(rows.length > 0 && lista.length > 0, `ha dado para medir (${rows.length} linha(s), ${lista.length} competencia(s))`);

  console.log("=== A) range da janela == classificacao linha a linha (diferenca simetrica 0) ===");
  for (const comp of lista) {
    const [Y, M] = comp.split("-").map(Number);
    const w = getProductionWindow(Y, M);
    // o que a QUERY seleciona (range, igual ao .gte/.lt do fetchPromoterShareData)
    const porRange = new Set(rows.filter(r => {
      const d = String(r.movement_date).slice(0, 10);
      return d >= w.start && d < w.endExclusive;
    }).map(r => r.id));
    // o que o RESTO DO SISTEMA classifica (linha a linha)
    const porClassificacao = new Set(rows.filter(r => {
      const p = getProductionPeriodFromValue(r.movement_date);
      return p && ymOf(p.year, p.month) === comp;
    }).map(r => r.id));
    const soRange = [...porRange].filter(id => !porClassificacao.has(id));
    const soClass = [...porClassificacao].filter(id => !porRange.has(id));
    const somaRange = rows.filter(r => porRange.has(r.id)).reduce((a, r) => a + Number(r.net_value ?? 0), 0);
    console.log(`  ${comp} janela ${w.start}..<${w.endExclusive} | range ${porRange.size} linha(s) ${brl(somaRange)} | classificacao ${porClassificacao.size}`);
    ok(soRange.length === 0 && soClass.length === 0,
      `${comp}: diferenca simetrica = 0 (so-range ${soRange.length}, so-classificacao ${soClass.length})`);
  }

  console.log("\n=== B) o ultimo dia util do mes NAO cai no bucket do mes corrente ===");
  for (const comp of lista) {
    const [Y, M] = comp.split("-").map(Number);
    const w = getProductionWindow(Y, M);
    // endExclusive E o ultimo dia util do mes da competencia (getLastBusinessDay)
    const ultimoDiaUtil = w.endExclusive;
    const noBucket = rows.filter(r => {
      const d = String(r.movement_date).slice(0, 10);
      return d >= w.start && d < w.endExclusive && d >= ultimoDiaUtil;
    });
    const naquelaData = rows.filter(r => String(r.movement_date).slice(0, 10) === ultimoDiaUtil);
    const vaoProProximo = naquelaData.filter(r => {
      const p = getProductionPeriodFromValue(r.movement_date);
      const [ny, nm] = proximo(Y, M);
      return p && ymOf(p.year, p.month) === ymOf(ny, nm);
    });
    console.log(`  ${comp} ultimo dia util ${ultimoDiaUtil} | linhas naquela data: ${naquelaData.length} (${brl(naquelaData.reduce((a, r) => a + Number(r.net_value ?? 0), 0))})`);
    ok(noBucket.length === 0, `${comp}: 0 linha(s) do ultimo dia util no bucket do mes corrente`);
    ok(vaoProProximo.length === naquelaData.length,
      `${comp}: as ${naquelaData.length} linha(s) daquela data classificam na competencia SEGUINTE`);
  }

  console.log("\n=== C) as janelas se encaixam (sem furo, sem sobreposicao) ===");
  for (const comp of lista) {
    const [Y, M] = comp.split("-").map(Number);
    const w = getProductionWindow(Y, M);
    const [ny, nm] = proximo(Y, M);
    const wn = getProductionWindow(ny, nm);
    ok(w.start < w.endExclusive, `${comp}: start (${w.start}) < endExclusive (${w.endExclusive})`);
    ok(w.endExclusive === wn.start, `${comp}: endExclusive == start de ${ymOf(ny, nm)} (${w.endExclusive} == ${wn.start})`);
  }

  console.log("\n===================== VEREDITO =====================");
  if (falhas === 0) {
    console.log("  OK — range da janela identico a classificacao; ultimo dia util fora do mes corrente; janelas encaixadas.");
    process.exit(0);
  }
  console.log(`  FALHA — ${falhas} assercao(oes).`);
  process.exit(2);
})().catch(e => { console.error("ERRO INFRA:", e.message || e); process.exit(3); });
