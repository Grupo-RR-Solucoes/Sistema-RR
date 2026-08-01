/* ============================================================================
 * gate_remuneracao_lideranca — as DUAS reguas em jun/2026 FECHADO.
 * SOMENTE LEITURA. NAO grava.
 *
 * Rodar:  TRP_SOURCE=db npx tsx scripts/gate_remuneracao_lideranca.mts
 *
 * .mts e nao .ts: usa await no topo; com .ts o compilador emite CommonJS e o
 * top-level await quebra.
 *
 * O QUE PROVA
 *   1. A regua ANTIGA (leadership_rule_versions, vigencia ate 2026-07) reproduz
 *      SEM DESVIO a formula do lib/comissaoGestao removido (0,001 x liquido).
 *   2. A regua NOVA, aplicada a mesma competencia, produz o valor esperado e diz
 *      qual criterio prevaleceu (aliquota ou piso).
 *   3. A trava de competencia congelada recusa regua que retroage sobre mes
 *      fechado.
 *
 * O QUE **NAO** PROVA
 *   - A RLS. A arvore do gestor e reproduzida por service_role espelhando o SQL
 *     de current_user_team_promoter_ids (20260701_000003:74-96), porque
 *     auth.uid() e nulo em script. Prova a REGUA, nao a autorizacao.
 *   - O ramo gerente_regional contra dado real: medido em 01/08/2026, nao ha
 *     gerente_regional cadastrado em producao.
 *
 * PAGINACAO SEMPRE COM ORDER. Sem order, o range() do PostgREST repete/pula
 * linhas entre paginas: na primeira medicao desta frente isso deu CASH com 1164
 * linhas / R$ 313.000,01 quando o correto e 707 / R$ 187.848,62.
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  assertReguaNaoAlcancaFechado,
  calcularRemuneracaoLideranca,
  entraNaComissaoDaBase,
  entraNaProducaoLiquidaDaBase,
  resolverReguaLideranca,
  type BaseLideranca,
  type CargoLideranca,
} from "@/lib/remuneracaoLideranca.ts";
// Competencia de um registro: a janela RR NAO e o mes calendario, entao o mes
// da data NAO serve. Este e o mesmo helper que promoterAnalytics e teamProduction
// usam. Usar slice(0,7) da data punha 30/06 em junho quando o canonico diz julho.
import { getProductionPeriodFromValue } from "@/lib/productionPeriod.ts";
import { construirBaseLideranca } from "@/lib/lideranca/baseLideranca.ts";
import { montarPayloadGestor } from "@/lib/projecao/gestorAdapter.ts";
import { buildTeamProduction } from "@/lib/equipe/teamProduction.ts";
import { remuneracaoLideranca } from "@/lib/remuneracaoLideranca.ts";

// .env -> process.env (mesma precedencia do scripts/_ts_register.cjs, que so
// serve CommonJS e nao alcanca este .mts): shell > .env.local > .env.
const ROOT = path.resolve(import.meta.dirname, "..");
for (const arquivo of [".env.local", ".env"]) {
  const p = path.join(ROOT, arquivo);
  if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const brl = (n: number) =>
  "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => (n * 100).toFixed(4).replace(".", ",") + "%";
const linha = (c = "=") => console.log(c.repeat(100));

let falhas = 0;
const pulos: string[] = [];
function assere(ok: boolean, titulo: string, detalhe: string) {
  console.log(`  [${ok ? "OK  " : "FALHA"}] ${titulo}`);
  console.log(`         ${detalhe}`);
  if (!ok) falhas += 1;
}
function pula(titulo: string, motivo: string) {
  console.log(`  [PULO ] ${titulo}`);
  console.log(`         ${motivo}`);
  pulos.push(`${titulo} — ${motivo}`);
}

/** Paginacao COM order estavel. Ver o cabecalho. */
async function todas<T>(fn: (de: number, ate: number) => any): Promise<T[]> {
  const out: T[] = [];
  let de = 0;
  for (;;) {
    const { data, error } = await fn(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
    de += 1000;
  }
  return out;
}

const YEAR = Number(process.env.GATE_YEAR || 0) || 2026;
const MONTH = Number(process.env.GATE_MONTH || 0) || 6;
const COMP = `${YEAR}-${String(MONTH).padStart(2, "0")}`;

linha();
console.log(`GATE REMUNERACAO DE LIDERANCA — competencia ${COMP} (fechada)`);
console.log("Arvore reproduzida por service_role: prova a REGUA, nao a RLS.");
linha();

// ---------------------------------------------------------------- 0) a tabela existe?
{
  const { error } = await admin.from("leadership_rule_versions").select("cargo").limit(1);
  if (error) {
    console.log("\n  [ABORTA] leadership_rule_versions inacessivel:", error.message);
    console.log("           Aplique supabase/migrations/20260801_000001_leadership_rule_versions.sql");
    console.log("           antes de rodar o gate. NAO simulo a regua.");
    linha();
    process.exit(1);
  }
}

// ---------------------------------------------------------------- 1) arvores reais
const { data: gestores, error: eg } = await admin
  .from("app_users")
  .select("id, full_name, email, role, manager_user_id")
  .in("role", ["supervisor", "gerente_regional"]);
if (eg) throw new Error(eg.message);
const nome = (g: any) => (g.full_name && g.full_name.trim()) || g.email;

const promoters = await todas<any>((de, ate) =>
  admin.from("promoters").select("id, supervisor_user_id, is_master").order("id").range(de, ate),
);

function arvoreDe(userId: string, role: string): string[] {
  if (role === "supervisor") {
    return promoters
      .filter((p) => p.supervisor_user_id === userId && p.is_master !== true)
      .map((p) => p.id);
  }
  const supIds = (gestores ?? []).filter((s: any) => s.manager_user_id === userId).map((s: any) => s.id);
  return promoters
    .filter((p) => p.supervisor_user_id && supIds.includes(p.supervisor_user_id) && p.is_master !== true)
    .map((p) => p.id);
}

// ---------------------------------------------------------------- 2) a BASE da competencia
const jkeys = await todas<any>((de, ate) =>
  admin.from("j_keys").select("j_key, promoter_id").order("id").range(de, ate),
);
const promotorDaChave = new Map<string, string>();
for (const k of jkeys) if (k.j_key && k.promoter_id) promotorDaChave.set(String(k.j_key), k.promoter_id);

const daily = await todas<any>((de, ate) =>
  admin
    .from("daily_production_records")
    .select("proposal_number, contract_number, is_srcc_restricted")
    .order("id")
    .range(de, ate),
);
const srcc = new Set<string>();
for (const d of daily) {
  if (d.is_srcc_restricted !== true) continue;
  if (d.proposal_number) srcc.add(String(d.proposal_number));
  if (d.contract_number) srcc.add(String(d.contract_number));
}

/**
 * Reproduz a vw_team_production para uma rede. A view e RLS por auth.uid(), que
 * e nulo em script; aqui o WHERE dela e reproduzido espelhando
 * 20260701_000003:144-145 (assigned_promoter_id OU promoter_id na arvore).
 * Prova a MONTAGEM, nao a RLS.
 */
const COLS_VIEW =
  "id, assigned_promoter_id, promoter_id, status, is_srcc_restricted, movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value, has_insurance";
const diarioBruto = await todas<any>((de, ate) =>
  admin.from("daily_production_records").select(COLS_VIEW).order("id").range(de, ate),
);
const targetsBruto = await todas<any>((de, ate) =>
  admin
    .from("monthly_targets")
    .select("promoter_id, year, month, meta, meta_1, meta_2")
    .order("id")
    .range(de, ate),
);
function rowsDaRede(ids: readonly string[]) {
  const set = new Set(ids);
  return diarioBruto.filter(
    (r) =>
      (r.assigned_promoter_id && set.has(r.assigned_promoter_id)) ||
      (r.promoter_id && set.has(r.promoter_id)),
  );
}
function targetsDaRede(ids: readonly string[]) {
  const set = new Set(ids);
  return targetsBruto.filter((t) => set.has(t.promoter_id));
}
/** Ocupa o lugar do client ANON dentro do buildTeamProduction. */
function shimDb(rows: any[], targets: any[]) {
  return {
    from(tabela: string) {
      const dados =
        tabela === "vw_team_production" ? rows : tabela === "monthly_targets" ? targets : [];
      return { select: () => Promise.resolve({ data: dados, error: null }) };
    },
  } as any;
}

const fechamento = await todas<any>((de, ate) =>
  admin
    .from("monthly_closing_entries")
    .select("id, entry_type, sheet_name, commission_value, net_value, j_key, operation_number, contract_number")
    .eq("year", YEAR)
    .eq("month", MONTH)
    .order("id")
    .range(de, ate),
);

// DOIS recortes: a comissao soma CASH + prestamista; o liquido e SO CASH.
// O prestamista e o subconjunto segurado dos MESMOS contratos (194 de 194 com
// par em CASH, medido) — somar o liquido dele duplica a producao.
const daComissao = fechamento.filter((r) => entraNaComissaoDaBase(r.entry_type, r.sheet_name));
const doLiquido = fechamento.filter((r) => entraNaProducaoLiquidaDaBase(r.entry_type, r.sheet_name));
const ehSrcc = (r: any) =>
  (r.operation_number && srcc.has(String(r.operation_number))) ||
  (r.contract_number && srcc.has(String(r.contract_number)));

/** Base da REDE: soma as linhas da base cujo j_key cai num promotor da arvore. */
function baseDaRede(ids: readonly string[]): BaseLideranca & { linhas: number; srccFora: number } {
  const set = new Set(ids);
  let comissao = 0;
  let liquido = 0;
  let linhas = 0;
  let srccFora = 0;
  const daRede = (r: any) => {
    const pid = r.j_key ? promotorDaChave.get(String(r.j_key)) : undefined;
    return Boolean(pid && set.has(pid));
  };
  for (const r of daComissao) {
    if (!daRede(r)) continue;
    if (ehSrcc(r)) { srccFora += 1; continue; }
    comissao += Number(r.commission_value || 0);
    linhas += 1;
  }
  for (const r of doLiquido) {
    if (!daRede(r)) continue;
    if (ehSrcc(r)) continue;
    liquido += Number(r.net_value || 0);
  }
  return { comissao_avista: comissao, producao_liquida: liquido, linhas, srccFora };
}

// ---------------------------------------------------------------- 3) sujeitos
const sujeitos: Array<{ g: any; cargo: CargoLideranca; ids: string[] }> = [];
for (const g of gestores ?? []) {
  const ids = arvoreDe(g.id, g.role);
  if (ids.length > 0) sujeitos.push({ g, cargo: g.role as CargoLideranca, ids });
}

console.log("\nGRUPO — base da competencia (todas as redes somadas nao e o grupo:");
console.log("o grupo inclui promotor sem supervisor, que nao entra em rede nenhuma)");
console.log(`  linhas do fechamento             ${fechamento.length}`);
console.log(`  linhas da comissao (CASH + prestamista)      ${daComissao.length}`);
console.log(`  linhas do liquido  (CASH apenas)             ${doLiquido.length}`);
console.log(`  comissao da BASE                 ${brl(daComissao.filter((r) => !ehSrcc(r)).reduce((s, r) => s + Number(r.commission_value || 0), 0))}`);
console.log(`  liquido  da BASE (so CASH)       ${brl(doLiquido.filter((r) => !ehSrcc(r)).reduce((s, r) => s + Number(r.net_value || 0), 0))}`);
console.log(`  linhas excluidas por SRCC        ${daComissao.filter(ehSrcc).length}`);

if (sujeitos.length === 0) {
  console.log("\n  [ABORTA] nenhum gestor com rede em producao. NAO simulo.");
  linha();
  process.exit(1);
}

// ---------------------------------------------------------------- 4) assercoes
linha();
console.log(`1) REGUA ANTIGA reproduz o valor atual — ${COMP}`);
linha();

for (const s of sujeitos) {
  // MESMO construtor da secao 5. Antes havia uma funcao local aqui que ignorava
  // a ADS, e as duas secoes discordavam da mesma rede.
  const base = await construirBaseLideranca(admin as any, {
    promoterIds: s.ids, year: YEAR, month: MONTH, fechado: true,
  });
  const antiga = await resolverReguaLideranca(admin as any, s.cargo, COMP);
  const rAntiga = calcularRemuneracaoLideranca(antiga, base, COMP);
  // O valor que o modulo REMOVIDO (lib/comissaoGestao) produzia: 0,001 sobre a
  // producao liquida. Escrito literal AQUI, e so aqui, para o gate continuar
  // provando a paridade depois que o modulo deixou de existir. Se este numero
  // divergir do seed da regua antiga, um dos dois esta errado.
  const atual = Math.round(base.producao_liquida * 0.001 * 100) / 100;

  console.log(`\n  ${nome(s.g)} (${s.cargo}, ${s.ids.length} promotores)`);
  console.log(`    base: ${base.linhas_comissao} linhas de comissao | ${brl(base.comissao_avista)} | liquido ${brl(base.producao_liquida)} | ${base.linhas_srcc_excluidas} fora por SRCC`);
  console.log(`    regua ate ${antiga.competencia_fim}: aliquota ${pct(antiga.aliquota)} piso ${pct(antiga.piso)} base ${antiga.base_calculo}`);
  assere(
    Math.abs(rAntiga.valor - atual) < 0.01,
    `regua versionada == 0,001 x liquido, a formula do modulo removido (${nome(s.g)})`,
    `versionada ${brl(rAntiga.valor)} vs atual ${brl(atual)}  (desvio ${brl(rAntiga.valor - atual)}) | criterio: ${rAntiga.criterio}`,
  );
}

linha();
console.log(`2) REGUA NOVA aplicada a ${COMP} — o que passaria a pagar`);
linha();

for (const s of sujeitos) {
  const base = await construirBaseLideranca(admin as any, {
    promoterIds: s.ids, year: YEAR, month: MONTH, fechado: true,
  });
  // A regua NOVA vive na vigencia 2026-08+; resolvo por ela e aplico a base de
  // junho, que e a comparacao que o entregavel pede.
  const nova = await resolverReguaLideranca(admin as any, s.cargo, "2026-08");
  const rNova = calcularRemuneracaoLideranca(nova, base, COMP);
  const antiga = await resolverReguaLideranca(admin as any, s.cargo, COMP);
  const rAntiga = calcularRemuneracaoLideranca(antiga, base, COMP);

  const esperadoAliq = Math.round(base.comissao_avista * nova.aliquota * 100) / 100;
  const esperadoPiso = Math.round(base.producao_liquida * nova.piso * 100) / 100;
  const esperado = Math.max(esperadoAliq, esperadoPiso);

  console.log(`\n  ${nome(s.g)} (${s.cargo})`);
  console.log(`    regua nova: aliquota ${pct(nova.aliquota)} sobre comissao | piso ${pct(nova.piso)} sobre liquido`);
  console.log(`    (a) aliquota x comissao = ${brl(base.comissao_avista)} x ${pct(nova.aliquota)} = ${brl(esperadoAliq)}`);
  console.log(`    (b) piso x liquido      = ${brl(base.producao_liquida)} x ${pct(nova.piso)} = ${brl(esperadoPiso)}`);
  assere(
    Math.abs(rNova.valor - esperado) < 0.01 && rNova.criterio === (esperadoPiso > esperadoAliq ? "piso" : "aliquota"),
    `regua nova = maior entre (a) e (b) (${nome(s.g)})`,
    `helper ${brl(rNova.valor)} criterio "${rNova.criterio}" vs esperado ${brl(esperado)} criterio "${esperadoPiso > esperadoAliq ? "piso" : "aliquota"}"`,
  );
  console.log(`    DELTA antiga -> nova: ${brl(rAntiga.valor)} -> ${brl(rNova.valor)}  (${brl(rNova.valor - rAntiga.valor)})`);
}

if (!sujeitos.some((s) => s.cargo === "gerente_regional")) {
  pula(
    "regua do gerente_regional contra dado real",
    "nao ha gerente_regional com rede em producao — nao simulado",
  );
}

// -------------------------------------------------------------------------
// 3) COBERTURA DA BASE ADS — bbts_pag_avista nao pode estar nulo em linha
// elegivel de competencia FECHADA. Falha com o numero; nao assume.
//
// A ADS nao entra em monthly_closing_entries (medido: as 4 empresas de lá sao
// RR AL1/AL2/AL3/PE). O lado PAGO dela vive em colunas do diario:
// bbts_pag_avista (o que a BBTS pagou a vista) e bbts_seguro_pago.
//
// COMPETENCIA ABERTA NAO CONTA: o "pago" so existe depois do fechamento BBTS
// ser importado. Medido em 01/08/2026: jun/2026 (fechada) tem 19/19; jul/2026
// tem 0/43 porque o fechamento de julho nao foi importado — as chaves de
// __bbts_meta de julho sao todas da diaria (situacao/transacao/base_credito),
// sem pag_avista_relatorio. Cobrar cobertura de mes aberto seria falhar por
// algo que ainda nem deveria existir.
// -------------------------------------------------------------------------
linha();
console.log("3) COBERTURA DA BASE ADS (competencia FECHADA)");
linha();
{
  const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
  const norm = (s: unknown) =>
    String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  const elegivelAds = (r: any) => {
    const s = norm(r.status);
    return (s === "PRODUCAO" || s === "PRODUCTION") && r.is_srcc_restricted !== true;
  };

  const ads = await todas<any>((de, ate) =>
    admin
      .from("daily_production_records")
      .select("id, status, is_srcc_restricted, net_value, bbts_pag_avista, bbts_seguro_pago, movement_date, contract_date, proposal_date")
      .eq("company_id", ADS)
      .order("id")
      .range(de, ate),
  );

  const competenciaDe = (r: any) => {
    const p =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    return p ? `${p.year}-${String(p.month).padStart(2, "0")}` : null;
  };
  const daComp = ads.filter((r) => competenciaDe(r) === COMP);
  const elegiveis = daComp.filter(elegivelAds);
  const semPago = elegiveis.filter((r) => r.bbts_pag_avista == null);

  if (elegiveis.length === 0) {
    pula(
      `cobertura ADS em ${COMP}`,
      "nenhuma linha elegivel da ADS nesta competencia — nada a cobrir",
    );
  } else {
    const soma = elegiveis.reduce((s, r) => s + Number(r.bbts_pag_avista || 0), 0);
    const liq = elegiveis.reduce((s, r) => s + Number(r.net_value || 0), 0);
    assere(
      semPago.length === 0,
      `bbts_pag_avista preenchido em TODA linha elegivel da ADS (${COMP})`,
      semPago.length === 0
        ? `${elegiveis.length}/${elegiveis.length} preenchidas | pag_avista ${brl(soma)} sobre liquido ${brl(liq)} = ${pct(liq ? soma / liq : 0)}`
        : `${semPago.length} de ${elegiveis.length} SEM bbts_pag_avista. ` +
          `Se a competencia esta fechada, o fechamento BBTS nao foi importado — a base ADS ficaria incompleta.`,
    );
  }
}

// -------------------------------------------------------------------------
// 4) BORDA DA VIGENCIA. competencia_fim = 2026-07-01 tem de ser INCLUSIVO:
// julho e o ULTIMO mes da regua antiga. O gate compara junho, que esta no MEIO
// da vigencia e nao exercita a borda — um resolvedor que comparasse com < em vez
// de <= passaria em junho e deixaria julho SEM regua nenhuma.
// -------------------------------------------------------------------------
linha();
console.log("4) BORDA DA VIGENCIA (julho fecha a antiga, agosto abre a nova)");
linha();

for (const cargo of ["supervisor", "gerente_regional"] as CargoLideranca[]) {
  const jul = await resolverReguaLideranca(admin as any, cargo, "2026-07");
  assere(
    jul.base_calculo === "PRODUCAO_LIQUIDA" && jul.competencia_fim === "2026-07-01",
    `${cargo} em 2026-07 resolve para a regua ANTIGA (fim inclusivo)`,
    `base ${jul.base_calculo} | aliquota ${pct(jul.aliquota)} | piso ${pct(jul.piso)} | vigencia ${jul.competencia_inicio}..${jul.competencia_fim}`,
  );

  const ago = await resolverReguaLideranca(admin as any, cargo, "2026-08");
  const aliqEsperada = cargo === "supervisor" ? 0.025 : 0.035;
  const pisoEsperado = cargo === "supervisor" ? 0.0007 : 0.001;
  assere(
    ago.base_calculo === "AVISTA_CREDITO_PF" &&
      Math.abs(ago.aliquota - aliqEsperada) < 1e-9 &&
      Math.abs(ago.piso - pisoEsperado) < 1e-9 &&
      ago.competencia_fim === null,
    `${cargo} em 2026-08 resolve para a regua NOVA`,
    `base ${ago.base_calculo} | aliquota ${pct(ago.aliquota)} | piso ${pct(ago.piso)} | vigencia ${ago.competencia_inicio}..${ago.competencia_fim ?? "aberta"}`,
  );

  // Borda de INICIO da regua antiga.
  const jan = await resolverReguaLideranca(admin as any, cargo, "2026-01");
  assere(
    jan.competencia_inicio === "2026-01-01" && jan.base_calculo === "PRODUCAO_LIQUIDA",
    `${cargo} em 2026-01 resolve (borda de inicio, inclusiva)`,
    `vigencia ${jan.competencia_inicio}..${jan.competencia_fim}`,
  );

  // Antes de qualquer vigencia o resolvedor tem de FALHAR, nao devolver default.
  let lancou = false;
  try {
    await resolverReguaLideranca(admin as any, cargo, "2025-12");
  } catch {
    lancou = true;
  }
  assere(
    lancou,
    `${cargo} em 2025-12 (antes de toda vigencia) LANCA em vez de assumir default`,
    lancou ? "lancou" : "NAO lancou — devolveu regua para competencia sem regua",
  );
}

// Competencia ABERTA com dado: a mais recente do diario que NAO tem fechamento.
// A existencia do fechamento e testada com HEAD+limit(1) por competencia — sao
// poucas competencias, e varrer monthly_closing_entries inteira para isso estoura
// o statement timeout (aconteceu).
const compsDoDiario = new Set<string>();
for (const d of diarioBruto) {
  const p =
    getProductionPeriodFromValue(d.movement_date) ||
    getProductionPeriodFromValue(d.contract_date) ||
    getProductionPeriodFromValue(d.proposal_date);
  if (p) compsDoDiario.add(`${p.year}-${String(p.month).padStart(2, "0")}`);
}
const abertas: string[] = [];
for (const c of [...compsDoDiario].sort()) {
  const { count, error } = await admin
    .from("monthly_closing_entries")
    .select("id", { head: true, count: "exact" })
    .eq("year", Number(c.slice(0, 4)))
    .eq("month", Number(c.slice(5, 7)));
  if (error) throw new Error(error.message);
  if (!count) abertas.push(c);
}
if (abertas.length === 0) {
  console.log("\n  [ABORTA] nenhuma competencia ABERTA com dado — o teste de mes aberto seria vacuo.");
  linha();
  process.exit(1);
}
const ultimaAberta = abertas[abertas.length - 1];
const ABERTO = { year: Number(ultimaAberta.slice(0, 4)), month: Number(ultimaAberta.slice(5, 7)) };
console.log(`\ncompetencias ABERTAS com dado: ${abertas.join(", ")} -> testando ${ultimaAberta}`);

// -------------------------------------------------------------------------
// 5) FONTE UNICA: a TELA e o MOTOR tem de dar o MESMO numero.
// O payload que a rota serve sai de montarPayloadGestor; o "motor" e
// remuneracaoLideranca sobre construirBaseLideranca. Se divergirem, ha uma
// segunda conta em algum lugar — exatamente o que esta frente veio matar.
//
// Exercita os DOIS regimes: a competencia do gate (fechada) e a competencia
// corrente (aberta, fonte 'motor', parcial=true).
// -------------------------------------------------------------------------
linha();
console.log("5) FONTE UNICA — tela x motor, nos dois regimes");
linha();

for (const s of sujeitos) {
  for (const regime of ["fechado", "aberto"] as const) {
    // Mes ABERTO = a ultima competencia COM dado e SEM fechamento. Agosto esta
    // vazio e o teste passaria por vacuidade (0 == 0) — o mesmo modo de falha
    // que a guarda da secao 2 barra.
    const ano = regime === "fechado" ? YEAR : ABERTO.year;
    const mes = regime === "fechado" ? MONTH : ABERTO.month;
    const compR = `${ano}-${String(mes).padStart(2, "0")}`;

    // Lado MOTOR: base + regua, direto.
    const baseMotor = await construirBaseLideranca(admin as any, {
      promoterIds: s.ids,
      year: ano,
      month: mes,
      fechado: regime === "fechado",
    });
    const motor = await remuneracaoLideranca(admin as any, s.cargo, compR, baseMotor);

    // Lado TELA: o payload que a rota serve, montado pela MESMA funcao.
    const team = await buildTeamProduction(shimDb(rowsDaRede(s.ids), targetsDaRede(s.ids)), admin as any, {
      year: ano,
      month: mes,
    });
    // A rota passa a ARVORE (via RPC current_user_team_promoter_ids), NAO
    // team.rows — ver o comentario em app/api/projecao/route.ts. Aqui s.ids e a
    // reproducao dessa arvore.
    const baseTela = await construirBaseLideranca(admin as any, {
      promoterIds: s.ids,
      year: team.period.year,
      month: team.period.month,
      fechado: team.fechado,
    });
    const resTela = await remuneracaoLideranca(admin as any, s.cargo, compR, baseTela);
    const payload = montarPayloadGestor(team, { resultado: resTela, base: baseTela });

    console.log(`\n  ${nome(s.g)} — ${compR} (${regime})`);
    console.log(`    base: comissao ${brl(baseMotor.comissao_avista)} | liquido ${brl(baseMotor.producao_liquida)} | fonte ${baseMotor.fonte} | parcial ${baseMotor.parcial}`);
    console.log(`    comissao media da rede: ${baseMotor.comissao_media == null ? "—" : pct(baseMotor.comissao_media)}`);
    if (baseMotor.ads_linhas_sem_comissao_apurada > 0) {
      console.log(`    LACUNA ADS: ${brl(baseMotor.ads_producao_sem_comissao_apurada)} em ${baseMotor.ads_linhas_sem_comissao_apurada} contrato(s) sem comissao apurada`);
    }
    assere(
      Math.abs(payload.comissao_gestao.valor - motor.valor) < 0.01 &&
        payload.comissao_gestao.criterio === motor.criterio,
      `tela == motor (${nome(s.g)}, ${compR})`,
      `tela ${brl(payload.comissao_gestao.valor)} "${payload.comissao_gestao.criterio}" vs motor ${brl(motor.valor)} "${motor.criterio}"`,
    );
    // SIMETRIA POR ORIGEM: uma origem entra nos DOIS recortes ou em NENHUM.
    // Se entrasse so no denominador, o piso multiplicaria producao cuja comissao
    // o numerador nao conta. Foi o defeito medido em jul/2026 (ADS com 100% do
    // liquido e ~0,006% da comissao dentro).
    const c = baseMotor.composicao;
    const dentroRR = c.rr_liquido > 0 || c.rr_comissao > 0;
    const dentroADS = c.ads_liquido > 0 || c.ads_comissao > 0;
    console.log(`    composicao: RR liq ${brl(c.rr_liquido)} / com ${brl(c.rr_comissao)} | ADS liq ${brl(c.ads_liquido)} / com ${brl(c.ads_comissao)}`);
    assere(
      (!dentroRR || (c.rr_liquido > 0 && c.rr_comissao > 0)) &&
        (!dentroADS || (c.ads_liquido > 0 && c.ads_comissao > 0)),
      `simetria: toda origem no denominador tem comissao no numerador (${compR})`,
      `RR ${dentroRR ? "dentro" : "fora"} (liq ${c.rr_liquido > 0}, com ${c.rr_comissao > 0}) | ADS ${dentroADS ? "dentro" : "fora"} (liq ${c.ads_liquido > 0}, com ${c.ads_comissao > 0})`,
    );
    // NAO-VACUIDADE: no ABERTO tem de haver ADS efetivamente EXCLUIDA, senao a
    // simetria acima passaria so por nao existir ADS na rede.
    if (regime === "aberto") {
      assere(
        baseMotor.ads_producao_sem_comissao_apurada > 0 && c.ads_liquido === 0,
        `ADS exclusiva do aberto: fora dos dois recortes e marcada (${compR})`,
        `lacuna ${brl(baseMotor.ads_producao_sem_comissao_apurada)} em ${baseMotor.ads_linhas_sem_comissao_apurada} linha(s) | ads_liquido no denominador ${brl(c.ads_liquido)}`,
      );
    } else {
      assere(
        c.ads_liquido > 0 && c.ads_comissao > 0,
        `ADS entra nos DOIS no fechado — a assimetria e exclusiva do aberto (${compR})`,
        `ads_liquido ${brl(c.ads_liquido)} | ads_comissao ${brl(c.ads_comissao)}`,
      );
    }
    assere(
      payload.comissao_gestao.parcial === (regime === "aberto") &&
        payload.comissao_gestao.fonte === (regime === "aberto" ? "motor" : "fechamento"),
      `regime marcado corretamente (${compR})`,
      `fonte "${payload.comissao_gestao.fonte}" parcial ${payload.comissao_gestao.parcial}`,
    );
  }
}

linha();
console.log("6) TRAVA DE COMPETENCIA CONGELADA");
linha();
{
  const fechadas = ["2026-06", "2026-07"];
  let barrou = false;
  let msg = "";
  try {
    assertReguaNaoAlcancaFechado(
      { cargo: "supervisor", competencia_inicio: "2026-06-01", competencia_fim: null },
      fechadas,
    );
  } catch (e) {
    barrou = true;
    msg = e instanceof Error ? e.message : String(e);
  }
  assere(barrou, "regua retroagindo sobre 2026-06 e RECUSADA", barrou ? msg.slice(0, 150) : "NAO barrou");

  let passou = true;
  try {
    assertReguaNaoAlcancaFechado(
      { cargo: "supervisor", competencia_inicio: "2026-08-01", competencia_fim: null },
      fechadas,
    );
  } catch {
    passou = false;
  }
  assere(passou, "regua comecando em 2026-08 (aberta) e ACEITA", `fechadas: ${fechadas.join(", ")}`);
}

linha();
console.log(falhas === 0 ? `GATE OK — 0 FALHAS, ${pulos.length} PULO(S)` : `GATE: ${falhas} FALHA(S), ${pulos.length} PULO(S)`);
if (pulos.length > 0) {
  console.log("\nNAO EXERCITADO:");
  for (const p of pulos) console.log("  - " + p);
}
console.log("\nNAO EXERCITADO SEMPRE: a RLS (arvore reproduzida por service_role).");
linha();
process.exit(falhas === 0 ? 0 : 1);
