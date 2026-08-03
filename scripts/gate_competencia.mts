/* ============================================================================
 * gate_competencia — COMPETENCIA CANONICA. SOMENTE LEITURA. NAO grava.
 *
 * Rodar:  npx tsx scripts/gate_competencia.mts
 *
 * Extensao .mts (nao .ts) porque o arquivo usa await no topo: com .ts o
 * compilador emite CommonJS e o top-level await falha. Mesmo motivo de
 * gate_projecao_gestor.mts.
 *
 * O QUE ELE PROVA
 * Que a competencia PEDIDA nunca e trocada por outra em silencio, e que o mes
 * corrente e sempre alcancavel. Para cada resolvedor de competencia do sistema:
 *
 *   (a) a lista de competencias CONTEM o mes corrente
 *   (b) sem parametro, a competencia efetiva E o mes corrente
 *   (c) pedindo uma competencia que EXISTE, a efetiva e a pedida
 *   (d) pedindo uma competencia SEM DADO, a efetiva e a pedida (nao outra) e os
 *       valores vem ZERADOS — nunca valores de outro mes
 *   (e) o rotulo exibido bate com a competencia efetiva
 *
 * A ASSERCAO (d) E A QUE PEGA O BUG DE 01/08/2026: o Dashboard exibia a
 * comissao bruta e a comissao de seguro de JULHO sob a etiqueta "ago/2026",
 * porque `periods.find(...) || periods[0]` trocava a competencia sem avisar.
 *
 * DUAS CAMADAS
 *   ESTATICA — le o codigo-fonte e prova invariantes que nao dependem de banco
 *              (rotulo remontado, literal fixo, regra de abertura). Sempre roda.
 *   BANCO    — exercita os resolvedores de verdade. Exige .env.local.
 *
 * TELAS COBERTAS e por qual resolvedor:
 *   /dashboard          promoterAnalytics + closingAnalytics (+ estatica da rota)
 *   /promotores         promoterAnalytics
 *   /relatorios         promoterAnalytics
 *   /financeiro         financialAnalytics
 *   /fechamento         getClosingPeriods + closingAnalytics
 *   /equipe             teamProduction
 *   /projecao           projecaoMetas (+ estatica do cliente)
 *   /receitas           estatica (lista de calendario, 100% cliente)
 *   /comissoes/editar   estatica (sem lista; dois inputs numericos)
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

// .env -> process.env. MESMA precedencia do scripts/_ts_register.cjs (que so
// serve CommonJS e nao alcanca este .mts): shell > .env.local > .env.
const ROOT = path.resolve(import.meta.dirname, "..");
for (const arquivo of [".env.local", ".env"]) {
  const p = path.join(ROOT, arquivo);
  if (!fs.existsSync(p)) continue;
  for (const linhaEnv of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = linhaEnv.match(/^([A-Z0-9_]+)=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

import { loadPromoterAnalyticsBase } from "@/lib/promoterAnalytics.ts";
import { buildClosingAnalytics } from "@/lib/closingAnalytics.ts";
import { buildFinancialAnalytics } from "@/lib/financialAnalytics.ts";
import { buildProjecaoMetas, consolidarGrupoEquipe } from "@/lib/projecaoMetas.ts";
import { getClosingPeriods } from "@/lib/auditoria.ts";
import { nowInFortaleza } from "@/lib/dateFortaleza.ts";

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const linha = () => console.log("-".repeat(78));
const ym = (c: { year: number; month: number }) => `${c.year}-${String(c.month).padStart(2, "0")}`;

let falhas = 0;
let passes = 0;
function assert(ok: boolean, titulo: string, detalhe: string) {
  if (ok) {
    passes += 1;
    console.log(`  OK    ${titulo}`);
    if (detalhe) console.log(`        ${detalhe}`);
  } else {
    falhas += 1;
    console.log(`  FALHA ${titulo}`);
    if (detalhe) console.log(`        ${detalhe}`);
  }
}

// ============================================================
// CAMADA ESTATICA — invariantes do codigo-fonte.
// ============================================================
// As assercoes estaticas tem de olhar CODIGO, nao comentario. Os comentarios
// desta frente CITAM o codigo antigo ("antes era periods.find(isClosed)...") de
// proposito, para o proximo leitor saber o que morreu — e uma busca ingenua
// casaria com a citacao e acusaria falha onde nao ha. Primeira versao deste
// gate falhou exatamente assim, em 3 assercoes.
function leia(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function semComentarios(fonte: string) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}
// O rotulo bate com a competencia efetiva? Os resolvedores nao compartilham
// convencao de ano (promoterAnalytics/financialAnalytics usam "ago/26";
// a rota do dashboard usa "ago/2026"). Em vez de impor uma, exigimos o que
// realmente importa: o rotulo tem de codificar O MES e O ANO da efetiva.
function rotuloBate(label: string, c: { year: number; month: number }) {
  const mes = MES[c.month - 1];
  const ano4 = String(c.year);
  const ano2 = ano4.slice(-2);
  return label === `${mes}/${ano4}` || label === `${mes}/${ano2}`;
}

// ============================================================
// O GATE TEM DE RODAR NAS DUAS VERSOES DO CODIGO.
//
// Um gate que so executa depois do conserto nao prova nada: ele precisa FALHAR
// no codigo antigo, e falhar REPORTANDO, nao estourando. A primeira versao
// desta camada lia `payload.competencia` direto e morria com TypeError na
// versao anterior a esta frente (o campo nasceu aqui) — sem chegar as
// assercoes, isto e, sem provar coisa alguma.
//
// Por isso a IDENTIDADE da competencia (as assercoes b/c/d) e lida de
// `latestPeriod` / `selectedPeriod`, que existem nas DUAS versoes. E
// exatamente onde o recuo silencioso aparecia, entao e ali que ele tem de ser
// pego. O campo novo `competencia` so e consultado para origem/temDado, sempre
// sob guarda.
// ============================================================
const AUSENTE = "(campo ausente nesta versao do codigo)";
function competenciaDe(payload: any): { year: number; month: number; label: string } | null {
  const p = payload?.latestPeriod ?? payload?.selectedPeriod ?? null;
  if (!p || typeof p.year !== "number" || typeof p.month !== "number") return null;
  return { year: p.year, month: p.month, label: String(p.label ?? "") };
}
function campoNovo(payload: any, campo: "origem" | "temDado"): string {
  const c = payload?.competencia;
  if (!c || c[campo] === undefined) return AUSENTE;
  return String(c[campo]);
}

console.log("");
linha();
console.log("GATE COMPETENCIA CANONICA");
linha();
console.log("\n[ESTATICA] invariantes de codigo (nao dependem de banco)\n");

{
  const rota = semComentarios(leia("app/api/dashboard/route.ts"));
  // (e) — o rotulo nao pode ser remontado. Sobra UMA ocorrencia: a definicao de
  // competenciaEfetiva.label, que e a fonte unica.
  const remontagens = (rota.match(/MES\[month - 1\]/g) || []).length;
  assert(
    remontagens === 1,
    "/dashboard rota: rotulo de competencia tem fonte unica",
    `ocorrencias de MES[month - 1]: ${remontagens} (esperado 1 = a definicao)`
  );
  assert(
    rota.includes("competencia: competenciaEfetiva"),
    "/dashboard rota: competencia efetiva vai no payload",
    "payload expoe competencia (key/label/regime/parcial/divergente)"
  );
  // (a) — a lista sempre contem a competencia renderizada.
  assert(
    rota.includes("monthsSet.add(month)"),
    "/dashboard rota: lista sempre contem a competencia renderizada",
    "monthsSet.add(month) presente"
  );
  // 3.4 — a previsao de receita passou a receber competencia.
  assert(
    /buildClosingAnalytics\(supabase, \{ year, month, fastDashboardMode: true \}\)/.test(rota),
    "/dashboard rota: previsao de receita recebe a competencia",
    "buildClosingAnalytics chamado com year/month"
  );
}

{
  const page = semComentarios(leia("app/dashboard/page.tsx"));
  // (e) — o literal fixo que mentia em qualquer mes que nao o corrente.
  assert(
    !page.includes("mês corrente · parcial"),
    "/dashboard tela: sub do cartao de producao nao e literal fixo",
    'literal "mes corrente · parcial" ausente'
  );
  // (a) guarda de cliente.
  assert(
    page.includes("base.unshift({ month: data.competencia.month"),
    "/dashboard tela: guarda de reinsercao no seletor",
    "competencia renderizada volta ao topo se nao vier na serie"
  );
  // (e) — badge de fonte unica.
  assert(
    page.includes("REGIME_LABEL[data.competencia.regime]") &&
      page.includes("`${data.competencia.year}-${data.competencia.month}`"),
    "/dashboard tela: badge le mes e regime da MESMA fonte",
    "ano, selKey e regime descem de data.competencia"
  );
}

{
  const receitas = semComentarios(leia("app/receitas/page.tsx"));
  // (b) — abre no corrente. buildPeriods comeca em i=0 (o proprio mes), entao
  // periods[0] E o mes corrente; o que importa e nao haver find(isClosed).
  assert(
    !/periods\.find\(\(p\) => isClosed\(p\.ano, p\.mes\)\)/.test(receitas),
    "/receitas: abre no mes corrente, nao no primeiro fechado",
    "find(isClosed) removido do default"
  );
  assert(
    /for \(let i = 0; i < 14; i\+\+\)/.test(receitas),
    "/receitas: lista de calendario contem o mes corrente",
    "buildPeriods comeca em i=0 = o proprio mes"
  );
}

{
  const editar = semComentarios(leia("app/comissoes/editar/page.js"));
  assert(
    /useState\(new Date\(\)\.getFullYear\(\)\)/.test(editar) &&
      /useState\(new Date\(\)\.getMonth\(\) \+ 1\)/.test(editar),
    "/comissoes/editar: abre no mes corrente",
    "sem lista de competencias (dois inputs numericos livres)"
  );
}

{
  const proj = semComentarios(leia("app/projecao/ProjecaoClient.tsx"));
  // A lista e o estado tem de usar o MESMO relogio, senao discordam na virada.
  assert(
    !/now\.getUTCFullYear\(\)/.test(proj) && !/now\.getUTCMonth\(\)/.test(proj),
    "/projecao: estado e lista usam o mesmo relogio (local)",
    "getters UTC removidos; nao ha desencontro na virada do mes"
  );
}

{
  const fech = semComentarios(leia("app/api/fechamento/route.ts"));
  assert(
    fech.includes("const selected = pedido ?? corrente ?? lastClosed"),
    "/fechamento: abre no mes corrente, nao no ultimo fechado",
    "default = corrente; lastClosed so como ultimo recurso"
  );
  assert(
    fech.includes("aguardandoFechamento: true") && fech.includes("summary: null"),
    "/fechamento: mes corrente nao fechado cai em aguardando, nao em zeros",
    "ramo !selected.fechado devolve summary null e companyRows vazio"
  );
}

{
  const fin = semComentarios(leia("app/financeiro/page.tsx"));
  assert(
    fin.includes("add(now.getFullYear(), now.getMonth() + 1)"),
    "/financeiro: lista sempre contem o mes corrente",
    "mes corrente adicionado explicitamente a cashPeriods"
  );
  assert(
    fin.includes("setSelectedKey((corrente ?? cashPeriods[0]).key)"),
    "/financeiro: abre no mes corrente, nao no topo da lista",
    "topo viraria o mes SEGUINTE quando o fechamento do corrente entrasse"
  );
}

// ============================================================
// CAMADA DE BANCO — os resolvedores de verdade.
// ============================================================
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("\n[BANCO] PULADO — faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  console.log("        A camada estatica acima rodou; a de banco, nao.");
  linha();
  console.log(`RESULTADO PARCIAL: ${passes} OK, ${falhas} FALHA(S) — camada de banco NAO executada`);
  linha();
  process.exit(falhas > 0 ? 1 : 0);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const corrente = nowInFortaleza();
const COMP_CORRENTE = { year: corrente.year, month: corrente.month };

// Competencia COM DADO, descoberta por MEDICAO (nunca hardcode: o gate tem de
// sobreviver a passagem do tempo). E a mais recente com linha no PMR.
const { data: pmrRows, error: pmrErr } = await sb
  .from("promoter_monthly_results")
  .select("year, month")
  .order("year", { ascending: false })
  .order("month", { ascending: false })
  .limit(1);
if (pmrErr) throw new Error(`PMR: ${pmrErr.message}`);

// GUARDA DE VACUIDADE (4.3): sem NENHUMA competencia com dado, todas as
// assercoes de valor passariam por vacuidade — tudo zero compara igual a tudo
// zero. Aborta em vez de aprovar.
if (!pmrRows || pmrRows.length === 0) {
  console.log("\n[BANCO] ABORTADO — nao ha NENHUMA competencia com dado no PMR.");
  console.log("        Sem competencia com dado, a assercao (c) passaria por vacuidade");
  console.log("        e a (d) nao distinguiria 'zerado por estar vazio' de 'zerado por bug'.");
  linha();
  process.exit(1);
}
const COMP_COM_DADO = { year: pmrRows[0].year, month: pmrRows[0].month };

// Competencia SEM DADO — DESCOBERTA POR RESOLVEDOR, nunca assumida.
//
// A primeira versao deste gate fixou "corrente + 6 meses" para todos e falhou
// no closingAnalytics: fev/2027 TEM dado la (R$ 52.247,09 em 5 empresas), e com
// razao — a carteira diferida projeta parcelas PRT para o futuro. "Sem dado" e
// propriedade de CADA resolvedor, nao do calendario. Entao perguntamos a cada
// um qual e a lista dele e andamos para a frente ate achar um mes ausente.
//
// Para a FRENTE de proposito: uma competencia passada pode ganhar dado por
// reprocessamento e tornar o gate intermitente.
function proximaAusente(
  periods: Array<{ year: number; month: number }>,
  base: { year: number; month: number }
): { year: number; month: number } {
  const existe = new Set(periods.map((p) => `${p.year}-${p.month}`));
  for (let passo = 1; passo <= 120; passo++) {
    const bruto = base.month + passo;
    const c = {
      year: base.year + Math.floor((bruto - 1) / 12),
      month: ((bruto - 1) % 12) + 1,
    };
    if (!existe.has(`${c.year}-${c.month}`)) return c;
  }
  throw new Error("nenhuma competencia ausente em 120 meses a frente — impossivel");
}

console.log("\n[BANCO] competencias do teste (descobertas por medicao)\n");
console.log(`  corrente  : ${ym(COMP_CORRENTE)}  (${MES[COMP_CORRENTE.month - 1]}/${COMP_CORRENTE.year})`);
console.log(`  com dado  : ${ym(COMP_COM_DADO)}  (mais recente no PMR)`);
console.log("  sem dado  : descoberta por resolvedor (a lista de cada um difere)");

// -------------------------------------------------- promoterAnalytics
console.log("\n[promoterAnalytics] serve /dashboard, /promotores, /relatorios\n");
{
  const semParam = await loadPromoterAnalyticsBase(sb as any, {});
  const cSemParam = competenciaDe(semParam);
  assert(
    cSemParam !== null &&
      cSemParam.year === COMP_CORRENTE.year &&
      cSemParam.month === COMP_CORRENTE.month,
    "(b) sem parametro, a efetiva e o mes corrente",
    `efetiva=${cSemParam ? ym(cSemParam) : "?"} esperada=${ym(COMP_CORRENTE)} origem=${campoNovo(semParam, "origem")}`
  );
  assert(
    semParam.periods.some(
      (p: any) => p.year === COMP_CORRENTE.year && p.month === COMP_CORRENTE.month
    ),
    "(a) a lista contem o mes corrente",
    `${semParam.periods.length} competencias na lista`
  );
  assert(
    cSemParam !== null && rotuloBate(cSemParam.label, COMP_CORRENTE),
    "(e) o rotulo bate com a competencia efetiva",
    `label="${cSemParam?.label ?? "?"}" para ${ym(COMP_CORRENTE)}`
  );

  // Competencia ausente DESTA lista (ver proximaAusente).
  const COMP_SEM_DADO = proximaAusente(semParam.periods as any, COMP_CORRENTE);
  console.log(`  ..... competencia sem dado neste resolvedor: ${ym(COMP_SEM_DADO)}`);

  const comDado = await loadPromoterAnalyticsBase(sb as any, {
    year: COMP_COM_DADO.year,
    month: COMP_COM_DADO.month,
  });
  const cComDado = competenciaDe(comDado);
  assert(
    cComDado !== null &&
      cComDado.year === COMP_COM_DADO.year &&
      cComDado.month === COMP_COM_DADO.month,
    "(c) pedindo competencia que existe, a efetiva e a pedida",
    `pedida=${ym(COMP_COM_DADO)} efetiva=${cComDado ? ym(cComDado) : "?"} origem=${campoNovo(comDado, "origem")} temDado=${campoNovo(comDado, "temDado")}`
  );

  // ---------- (d) A ASSERCAO QUE PEGA O BUG ----------
  const semDado = await loadPromoterAnalyticsBase(sb as any, {
    year: COMP_SEM_DADO.year,
    month: COMP_SEM_DADO.month,
  });
  const cSemDado = competenciaDe(semDado);
  assert(
    cSemDado !== null &&
      cSemDado.year === COMP_SEM_DADO.year &&
      cSemDado.month === COMP_SEM_DADO.month,
    "(d) pedindo competencia SEM DADO, a efetiva e a pedida",
    `pedida=${ym(COMP_SEM_DADO)} efetiva=${cSemDado ? ym(cSemDado) : "?"} origem=${campoNovo(semDado, "origem")}`
  );
  assert(
    campoNovo(semDado, "temDado") === "false",
    "(d) competencia sem dado se declara sem dado",
    `temDado=${campoNovo(semDado, "temDado")} (o DRE usa isto para recusar montar)`
  );
  assert(
    semDado.recordsForPeriod.length === 0,
    "(d) competencia sem dado nao traz registro de OUTRO mes",
    `recordsForPeriod=${semDado.recordsForPeriod.length} (esperado 0)`
  );
  assert(
    Math.abs(semDado.companyGrossCommission) < 0.005,
    "(d) comissao bruta zerada, nao a de outro mes",
    `companyGrossCommission=${semDado.companyGrossCommission.toFixed(2)} (esperado 0.00)`
  );
  const seguroSemDado = (semDado.filteredSummaryRows || []).reduce(
    (s: number, r: any) => s + Number(r.insurance_commission_value || 0),
    0
  );
  assert(
    Math.abs(seguroSemDado) < 0.005,
    "(d) comissao de seguro zerada, nao a de outro mes",
    `soma insurance_commission_value=${seguroSemDado.toFixed(2)} (esperado 0.00)`
  );
  assert(
    cSemDado !== null && rotuloBate(cSemDado.label, COMP_SEM_DADO),
    "(e) rotulo da competencia sem dado bate com a pedida",
    `label="${cSemDado?.label ?? "?"}" para ${ym(COMP_SEM_DADO)}`
  );
  assert(
    semDado.periods.some(
      (p: any) => p.year === COMP_SEM_DADO.year && p.month === COMP_SEM_DADO.month
    ),
    "(a) a competencia sem dado entra na lista (fica selecionavel)",
    "sem isto o <select> nao teria <option> e o React marcaria a primeira"
  );

  // PROVA DE NAO-VACUIDADE: a competencia COM dado tem de ter numero DIFERENTE
  // de zero em algo. Sem isto, "zerado" acima nao provaria nada.
  const temNumero =
    comDado.recordsForPeriod.length > 0 || (comDado.filteredSummaryRows || []).length > 0;
  assert(
    temNumero,
    "[nao-vacuidade] a competencia com dado realmente tem dado",
    `records=${comDado.recordsForPeriod.length} summaryRows=${(comDado.filteredSummaryRows || []).length}`
  );
}

// -------------------------------------------------- closingAnalytics
console.log("\n[closingAnalytics] serve a Previsao de receita do /dashboard e o /fechamento\n");
{
  const semParam = await buildClosingAnalytics(sb as any, { fastDashboardMode: true });
  const cSemParam = competenciaDe(semParam);
  assert(
    cSemParam !== null &&
      cSemParam.year === COMP_CORRENTE.year &&
      cSemParam.month === COMP_CORRENTE.month,
    "(b) sem parametro, a efetiva e o mes corrente",
    `efetiva=${cSemParam ? ym(cSemParam) : "?"} esperada=${ym(COMP_CORRENTE)} origem=${campoNovo(semParam, "origem")}`
  );

  // A lista do closingAnalytics vai ALEM do calendario com producao: a carteira
  // diferida projeta PRT para meses futuros. Por isso a competencia ausente sai
  // da lista DELE, e nao de um palpite de calendario.
  const COMP_SEM_DADO = proximaAusente(semParam.periods as any, COMP_CORRENTE);
  console.log(`  ..... competencia sem dado neste resolvedor: ${ym(COMP_SEM_DADO)}`);

  const semDado = await buildClosingAnalytics(sb as any, {
    year: COMP_SEM_DADO.year,
    month: COMP_SEM_DADO.month,
    fastDashboardMode: true,
  });
  const cSemDado = competenciaDe(semDado);
  assert(
    cSemDado !== null &&
      cSemDado.year === COMP_SEM_DADO.year &&
      cSemDado.month === COMP_SEM_DADO.month,
    "(d) pedindo competencia SEM DADO, a efetiva e a pedida",
    `pedida=${ym(COMP_SEM_DADO)} efetiva=${cSemDado ? ym(cSemDado) : "?"} origem=${campoNovo(semDado, "origem")}`
  );
  // (d) AQUI A ASSERCAO CORRETA NAO E "ZERADO".
  //
  // Este resolvedor projeta PRT para o FUTURO de proposito: a carteira diferida
  // tem parcelas a vencer, e uma competencia futura legitimamente traz valor
  // (medido: set/2026 devolve R$ 52.247,09 em 5 empresas). Exigir zero aqui
  // seria exigir que a tela mentisse — foi o que a primeira versao deste gate
  // fez, e a "falha" era do gate.
  //
  // O invariante que importa contra o bug desta frente e mais forte que zero:
  // TODA linha devolvida tem de pertencer a competencia PEDIDA. Se o resolvedor
  // recuasse para outro mes, apareceriam linhas de julho sob setembro — e ISSO
  // esta assercao pega, inclusive quando o total nao e zero.
  const forasteiras = semDado.companyRows.filter(
    (r: any) => r.year !== COMP_SEM_DADO.year || r.month !== COMP_SEM_DADO.month
  );
  assert(
    forasteiras.length === 0,
    "(d) nenhuma linha pertence a outra competencia",
    `${semDado.companyRows.length} linha(s), ${forasteiras.length} de outro mes (esperado 0)` +
      (forasteiras.length > 0 ? ` — intrusas: ${forasteiras.map((r: any) => ym(r)).join(", ")}` : "")
  );
  assert(
    semDado.selectedPeriod !== null &&
      semDado.selectedPeriod.year === COMP_SEM_DADO.year &&
      semDado.selectedPeriod.month === COMP_SEM_DADO.month,
    "(e) selectedPeriod (o que a tela rotula) e a competencia pedida",
    `selectedPeriod=${semDado.selectedPeriod ? ym(semDado.selectedPeriod) : "null"}`
  );
}

// -------------------------------------------------- financialAnalytics
console.log("\n[financialAnalytics] serve /financeiro\n");
{
  const semParam = await buildFinancialAnalytics(sb as any, {});
  assert(
    semParam.selectedPeriod.year === COMP_CORRENTE.year &&
      semParam.selectedPeriod.month === COMP_CORRENTE.month,
    "(b) sem parametro, a efetiva e o mes corrente",
    `efetiva=${ym(semParam.selectedPeriod)}`
  );
  assert(
    semParam.periods.some(
      (p: any) => p.year === COMP_CORRENTE.year && p.month === COMP_CORRENTE.month
    ),
    "(a) a lista contem o mes corrente",
    `${semParam.periods.length} competencias na lista`
  );

  const COMP_SEM_DADO = proximaAusente(semParam.periods as any, COMP_CORRENTE);
  console.log(`  ..... competencia sem dado neste resolvedor: ${ym(COMP_SEM_DADO)}`);

  const semDado = await buildFinancialAnalytics(sb as any, {
    year: COMP_SEM_DADO.year,
    month: COMP_SEM_DADO.month,
  });
  assert(
    semDado.selectedPeriod.year === COMP_SEM_DADO.year &&
      semDado.selectedPeriod.month === COMP_SEM_DADO.month,
    "(d) pedindo competencia SEM DADO, a efetiva e a pedida",
    `pedida=${ym(COMP_SEM_DADO)} efetiva=${ym(semDado.selectedPeriod)}`
  );
  assert(
    rotuloBate(semDado.selectedPeriod.label, COMP_SEM_DADO),
    "(e) o rotulo bate com a competencia efetiva",
    `label="${semDado.selectedPeriod.label}" para ${ym(COMP_SEM_DADO)}`
  );
}

// -------------------------------------------------- /fechamento
console.log("\n[getClosingPeriods] serve a lista do /fechamento\n");
{
  const { periods } = await getClosingPeriods(sb as any, COMP_CORRENTE);
  assert(
    periods.some(
      (p: any) => p.year === COMP_CORRENTE.year && p.month === COMP_CORRENTE.month
    ),
    "(a) a lista contem o mes corrente",
    `${periods.length} competencias; o corrente entra como fechado=false se ainda nao fechou`
  );
}

// -------------------------------------------------- projecaoMetas
console.log("\n[projecaoMetas] serve /projecao\n");
{
  // A /projecao nao expoe lista propria; usa a do promoterAnalytics. Reusamos a
  // mesma descoberta, a partir da base sem parametro.
  const baseProj = await loadPromoterAnalyticsBase(sb as any, {});
  const COMP_SEM_DADO = proximaAusente(baseProj.periods as any, COMP_CORRENTE);
  console.log(`  ..... competencia sem dado neste resolvedor: ${ym(COMP_SEM_DADO)}`);

  const semDado = await buildProjecaoMetas(sb as any, {
    year: COMP_SEM_DADO.year,
    month: COMP_SEM_DADO.month,
  });
  const cons = consolidarGrupoEquipe(semDado);
  assert(
    Math.abs(cons.producao_acumulada) < 0.005,
    "(d) competencia sem dado tem producao zerada, nao a de outro mes",
    `producao_acumulada=${cons.producao_acumulada.toFixed(2)} (esperado 0.00)`
  );
}

linha();
console.log(`RESULTADO: ${passes} OK, ${falhas} FALHA(S)`);
linha();
process.exit(falhas > 0 ? 1 : 0);
