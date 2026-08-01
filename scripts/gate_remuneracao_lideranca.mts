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
/**
 * Ocupa o lugar do client ANON dentro do buildTeamProduction.
 *
 * REVISAO 01/08/2026 (a pergunta era: `rowsDaRede(s.ids)` mascara o defeito?).
 * NAO mascara. rowsDaRede reproduz o OR da view — `assigned IN ids OR
 * promoter IN ids` — que e literalmente 20260701_000003:144-145. O forasteiro
 * portanto ENTRA em `rows` e chega ao buildTeamProduction; o gate mede se ele
 * foi barrado la dentro. O shim que mascararia seria um que filtrasse `rows` so
 * por assigned_promoter_id: ai o forasteiro nunca chegaria e a secao 5 passaria
 * por vacuidade. Nao e o caso, e a NAO-VACUIDADE agora e assercao explicita.
 *
 * `rpc` acrescentado junto: o buildTeamProduction passou a resolver a arvore por
 * current_user_team_promoter_ids no proprio client ANON. Devolver `ids` aqui e o
 * comportamento do banco — view e helper leem o mesmo auth.uid().
 */
function shimDb(rows: any[], targets: any[], arvore: readonly string[]) {
  return {
    from(tabela: string) {
      const dados =
        tabela === "vw_team_production" ? rows : tabela === "monthly_targets" ? targets : [];
      return { select: () => Promise.resolve({ data: dados, error: null }) };
    },
    rpc: (nome: string) =>
      Promise.resolve(
        nome === "current_user_team_promoter_ids"
          ? { data: Array.from(arvore), error: null }
          : { data: null, error: { message: `rpc nao esperado no shim: ${nome}` } },
      ),
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
  const antiga = await resolverReguaLideranca(admin as any, s.cargo, COMP);
  const base = await construirBaseLideranca(admin as any, {
    promoterIds: s.ids, year: YEAR, month: MONTH, fechado: true,
    baseCalculo: antiga.base_calculo,
  });
  const rAntiga = calcularRemuneracaoLideranca(antiga, base, COMP);
  // O valor que o modulo REMOVIDO (lib/comissaoGestao) produzia: 0,001 sobre a
  // producao liquida. Escrito literal AQUI, e so aqui, para o gate continuar
  // provando a paridade depois que o modulo deixou de existir. Se este numero
  // divergir do seed da regua antiga, um dos dois esta errado.
  const atual = Math.round(base.producao_liquida * 0.001 * 100) / 100;

  console.log(`\n  ${nome(s.g)} (${s.cargo}, ${s.ids.length} promotores)`);
  console.log(`    producao liquida TOTAL  ${brl(base.producao_liquida).padStart(18)}`);
  console.log(`    comissao a vista TOTAL  ${brl(base.comissao_avista).padStart(18)}`);
  console.log(`      RR   liquido ${brl(base.composicao.rr_liquido).padStart(18)}   comissao ${brl(base.composicao.rr_comissao).padStart(15)}`);
  console.log(`      ADS  liquido ${brl(base.composicao.ads_liquido).padStart(18)}   comissao ${brl(base.composicao.ads_comissao).padStart(15)}`);
  console.log(`    comissao media da rede  ${(base.comissao_media == null ? "—" : pct(base.comissao_media)).padStart(18)}`);
  console.log(`    ${base.linhas_comissao} linhas de comissao | ${base.linhas_liquido} de liquido | ${base.linhas_srcc_excluidas} fora por SRCC`);
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
  const nova0 = await resolverReguaLideranca(admin as any, s.cargo, "2026-08");
  const base = await construirBaseLideranca(admin as any, {
    promoterIds: s.ids, year: YEAR, month: MONTH, fechado: true,
    baseCalculo: nova0.base_calculo,
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
  console.log(`    base: liquido ${brl(base.producao_liquida)} (RR ${brl(base.composicao.rr_liquido)} + ADS ${brl(base.composicao.ads_liquido)})`);
  console.log(`          comissao ${brl(base.comissao_avista)} (RR ${brl(base.composicao.rr_comissao)} + ADS ${brl(base.composicao.ads_comissao)})`);
  console.log(`          comissao media ${base.comissao_media == null ? "—" : pct(base.comissao_media)}`);
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

    // A REGUA VEM ANTES DA BASE, como na rota.
    const reguaR = await resolverReguaLideranca(admin as any, s.cargo, compR);
    const baseMotor = await construirBaseLideranca(admin as any, {
      promoterIds: s.ids,
      year: ano,
      month: mes,
      fechado: regime === "fechado",
      baseCalculo: reguaR.base_calculo,
    });
    const motor = calcularRemuneracaoLideranca(reguaR, baseMotor, compR);

    // Lado TELA: o payload que a rota serve, montado pela MESMA funcao.
    const team = await buildTeamProduction(shimDb(rowsDaRede(s.ids), targetsDaRede(s.ids), s.ids), admin as any, {
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
      baseCalculo: reguaR.base_calculo,
    });
    const resTela = calcularRemuneracaoLideranca(reguaR, baseTela, compR);
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
    console.log(`    regua ${reguaR.base_calculo} | composicao: RR liq ${brl(c.rr_liquido)} / com ${brl(c.rr_comissao)} | ADS liq ${brl(c.ads_liquido)} / com ${brl(c.ads_comissao)}`);

    if (reguaR.base_calculo === "AVISTA_CREDITO_PF") {
      // SIMETRIA: uma origem entra nos DOIS recortes ou em NENHUM. So faz
      // sentido aqui — e a unica regua com termo de comissao E piso.
      const dentroRR = c.rr_liquido > 0 || c.rr_comissao > 0;
      const dentroADS = c.ads_liquido > 0 || c.ads_comissao > 0;
      assere(
        (!dentroRR || (c.rr_liquido > 0 && c.rr_comissao > 0)) &&
          (!dentroADS || (c.ads_liquido > 0 && c.ads_comissao > 0)),
        `simetria (AVISTA_CREDITO_PF): origem no denominador tem comissao (${compR})`,
        `RR ${dentroRR ? "dentro" : "fora"} | ADS ${dentroADS ? "dentro" : "fora"}`,
      );
      if (regime === "aberto") {
        assere(
          baseMotor.ads_producao_sem_comissao_apurada > 0 && c.ads_liquido === 0,
          `ADS FORA dos dois no aberto sob a regua nova (${compR})`,
          `lacuna ${brl(baseMotor.ads_producao_sem_comissao_apurada)} | ads_liquido ${brl(c.ads_liquido)}`,
        );
      } else {
        assere(
          c.ads_liquido > 0 && c.ads_comissao > 0,
          `ADS DENTRO dos dois no fechado (${compR})`,
          `ads_liquido ${brl(c.ads_liquido)} | ads_comissao ${brl(c.ads_comissao)}`,
        );
      }
    } else {
      // PRODUCAO_LIQUIDA nao tem termo de comissao nem piso: nao ha assimetria a
      // corrigir. O risco aqui e o OPOSTO — a exclusao vazar para a regua antiga
      // e subtrair producao que conta. Foi o que aconteceu, e por isso o gate
      // exige a ADS DENTRO do denominador.
      assere(
        c.ads_liquido > 0,
        `PRODUCAO_LIQUIDA: ADS DENTRO do denominador, a exclusao NAO vaza (${compR})`,
        `ads_liquido ${brl(c.ads_liquido)} | lacuna reportada ${brl(baseMotor.ads_producao_sem_comissao_apurada)}`,
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

// -------------------------------------------------------------------------
// 5b) A COMBINACAO QUE NENHUMA COMPETENCIA REAL COBRE AINDA:
// regua NOVA (AVISTA_CREDITO_PF) num mes ABERTO. E o que agosto vai ser.
// Sem este bloco, a exclusao da ADS no aberto nunca seria exercitada — julho
// esta sob a regua antiga e agosto ainda nao tem producao.
// -------------------------------------------------------------------------
linha();
console.log(`5b) REGUA NOVA em mes ABERTO — o cenario de agosto, com dado de ${ultimaAberta}`);
linha();

for (const s of sujeitos) {
  const nova = await resolverReguaLideranca(admin as any, s.cargo, "2026-08");
  const comAds = await construirBaseLideranca(admin as any, {
    promoterIds: s.ids, year: ABERTO.year, month: ABERTO.month,
    fechado: false, baseCalculo: "PRODUCAO_LIQUIDA",
  });
  const semAds = await construirBaseLideranca(admin as any, {
    promoterIds: s.ids, year: ABERTO.year, month: ABERTO.month,
    fechado: false, baseCalculo: nova.base_calculo,
  });
  console.log(`\n  ${nome(s.g)} — ${ultimaAberta} aberto`);
  console.log(`    PRODUCAO_LIQUIDA  liquido ${brl(comAds.producao_liquida)} (ADS ${brl(comAds.composicao.ads_liquido)} dentro)`);
  console.log(`    AVISTA_CREDITO_PF liquido ${brl(semAds.producao_liquida)} (ADS ${brl(semAds.composicao.ads_liquido)} dentro) | TRP ${semAds.comissao_media == null ? "—" : pct(semAds.comissao_media)}`);
  assere(
    semAds.composicao.ads_liquido === 0 &&
      semAds.composicao.ads_comissao === 0 &&
      semAds.ads_producao_sem_comissao_apurada > 0,
    `regua nova em mes aberto EXCLUI a ADS dos dois (${nome(s.g)})`,
    `ads_liquido ${brl(semAds.composicao.ads_liquido)} | ads_comissao ${brl(semAds.composicao.ads_comissao)} | lacuna ${brl(semAds.ads_producao_sem_comissao_apurada)}`,
  );
  assere(
    comAds.composicao.ads_liquido > 0 &&
      Math.abs(comAds.producao_liquida - (semAds.producao_liquida + comAds.composicao.ads_liquido)) < 0.01,
    `as duas reguas diferem EXATAMENTE pela ADS (${nome(s.g)})`,
    `${brl(comAds.producao_liquida)} - ${brl(semAds.producao_liquida)} = ${brl(comAds.producao_liquida - semAds.producao_liquida)} | ads_liquido ${brl(comAds.composicao.ads_liquido)}`,
  );
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

// -------------------------------------------------------------------------
// 7) ESCOPO DE EXIBICAO — o /equipe e a /projecao so mostram a ARVORE.
//
// O defeito: o WHERE da vw_team_production e um OR (assigned OU promoter na
// arvore, 20260701_000003:144-145) e o buildTeamProduction agrupava por
// assigned_promoter_id. Contrato REATRIBUIDO entre redes virava linha de um
// promotor que nao e do time. Duas magnitudes, porque as linhas do periodo tem
// duas origens: no mes ABERTO entra so o registro-ponte (a view limita), no mes
// FECHADO entra a producao INTEIRA do forasteiro (o PMR e buscado por
// service_role sobre allIds, sem passar pela view).
// -------------------------------------------------------------------------
linha();
console.log("7) ESCOPO DE EXIBICAO — arvore, nao team.rows");
linha();

for (const s of sujeitos) {
  for (const [ano, mes] of [[YEAR, MONTH], [ABERTO.year, ABERTO.month]] as const) {
    const comp = `${ano}-${String(mes).padStart(2, "0")}`;
    const arvore = new Set(s.ids);
    const rowsView = rowsDaRede(s.ids); // o OR da view, como o banco devolve

    // NAO-VACUIDADE. Sem forasteiro na entrada, tudo abaixo passa por vacuidade:
    // "nenhum id fora da arvore" seria verdade porque nenhum id fora da arvore
    // chegou. Exige contrato REATRIBUIDO entre redes no periodo.
    const forasteirosNaEntrada = new Set(
      rowsView
        .filter((r: any) => r.assigned_promoter_id && !arvore.has(r.assigned_promoter_id))
        .map((r: any) => r.assigned_promoter_id as string),
    );
    const pontes = rowsView.filter(
      (r: any) => r.assigned_promoter_id && !arvore.has(r.assigned_promoter_id),
    );

    const team = await buildTeamProduction(shimDb(rowsView, targetsDaRede(s.ids), s.ids), admin as any, {
      year: ano,
      month: mes,
    });

    console.log(`\n  ${nome(s.g)} — ${comp} (fechado=${team.fechado})`);

    if (forasteirosNaEntrada.size === 0) {
      pula(
        `NAO-VACUIDADE do escopo (${nome(s.g)}, ${comp})`,
        `nenhum contrato reatribuido de outra rede chega pela view — o filtro nao e exercitado nesta rede/competencia`,
      );
    } else {
      assere(
        pontes.length > 0,
        `NAO-VACUIDADE: ha contrato reatribuido no periodo (${nome(s.g)}, ${comp})`,
        `${pontes.length} registro(s)-ponte, ${forasteirosNaEntrada.size} promotor(es) de fora na entrada da view`,
      );
    }

    // (a) TODO assigned_promoter_id exposto pertence a arvore.
    const expostos = team.rows.map((r) => r.promoter_id);
    const foraDaArvore = expostos.filter((id) => !arvore.has(id));
    assere(
      foraDaArvore.length === 0,
      `todo promotor exposto pertence a arvore (${nome(s.g)}, ${comp})`,
      `${expostos.length} exposto(s), ${foraDaArvore.length} fora da arvore${foraDaArvore.length ? ": " + foraDaArvore.join(", ") : ""}`,
    );

    // (a2) O MESMO vale para tudo que deriva de rows: serie por promotor e os
    // gestores que a /projecao monta a partir de r.supervisor_id. Era por aqui
    // que a IZABELA aparecia como gestora na tela da CARLA.
    const serieFora = team.perPromoterMonthly.map((p) => p.promoter_id).filter((id) => !arvore.has(id));
    assere(
      serieFora.length === 0,
      `serie por promotor tambem so tem a arvore (${nome(s.g)}, ${comp})`,
      `${team.perPromoterMonthly.length} na serie, ${serieFora.length} fora`,
    );
    const gestoresExpostos = [...new Set(team.rows.map((r) => r.supervisor_id).filter(Boolean))];
    assere(
      gestoresExpostos.length <= 1 && (gestoresExpostos.length === 0 || gestoresExpostos[0] === s.g.id),
      `nenhum gestor de outra rede exposto (${nome(s.g)}, ${comp})`,
      `gestores em team.rows: ${gestoresExpostos.join(", ") || "(nenhum)"} | esperado: ${s.g.id}`,
    );

    // (b) A producao cai EXATAMENTE pelo valor dos forasteiros, nem um centavo
    // a mais. O contrafactual e o payload montado SEM o filtro, reproduzido aqui
    // passando ao shim uma arvore que contem tambem os forasteiros — assim o
    // filtro interno vira no-op e o resultado e o comportamento ANTIGO.
    const arvoreLarga = [...s.ids, ...forasteirosNaEntrada];
    const teamAntigo = await buildTeamProduction(
      shimDb(rowsView, targetsDaRede(s.ids), arvoreLarga),
      admin as any,
      { year: ano, month: mes },
    );
    const somaDosForasteiros = teamAntigo.rows
      .filter((r) => !arvore.has(r.promoter_id))
      .reduce((acc, r) => acc + r.production_value, 0);
    const queda = teamAntigo.totals.production_value - team.totals.production_value;
    assere(
      Math.abs(queda - somaDosForasteiros) < 0.005,
      `producao cai EXATAMENTE pelos forasteiros (${nome(s.g)}, ${comp})`,
      `antes ${brl(teamAntigo.totals.production_value)} -> depois ${brl(team.totals.production_value)} | queda ${brl(queda)} | soma dos forasteiros ${brl(somaDosForasteiros)} | diferenca ${brl(queda - somaDosForasteiros)}`,
    );
    // A META nao pode se mexer: ela ja vinha escopada pela policy
    // monthly_targets_gestor_select. Se mexer, o filtro pegou meta legitima.
    assere(
      Math.abs(teamAntigo.totals.meta - team.totals.meta) < 0.005,
      `a meta do time NAO muda (${nome(s.g)}, ${comp})`,
      `antes ${brl(teamAntigo.totals.meta)} -> depois ${brl(team.totals.meta)}`,
    );

    // (c) O MESMO escopo alimenta PAGAMENTO e EXIBICAO. A incoerencia da
    // /projecao (pagava pela arvore, exibia por team.rows) nao pode voltar.
    const idsExibicao = new Set(team.rows.map((r) => r.promoter_id));
    const forasDaExibicao = [...idsExibicao].filter((id) => !arvore.has(id));
    assere(
      forasDaExibicao.length === 0,
      `pagamento e exibicao compartilham o escopo (${nome(s.g)}, ${comp})`,
      `pagamento: ${arvore.size} id(s) da arvore | exibicao: ${idsExibicao.size} id(s), ${forasDaExibicao.length} fora do escopo de pagamento`,
    );
  }
}

// -------------------------------------------------------------------------
// 8) insurance_commission_amount NUNCA entra na base pela ADS.
// Decisao de 01/08/2026: e residuo de regua do RR (3 linhas em toda a historia,
// R$ 27,08, `gross x 0,15%` com source TRP35_*), nao comissao-empresa nem
// repasse. O campo saiu do SELECT e do tipo em lib/lideranca/baseLideranca.
// Este bloco trava a VOLTA: se alguem reintroduzir a leitura, ads_comissao no
// mes aberto deixa de ser zero e o gate falha.
// -------------------------------------------------------------------------
linha();
console.log("8) ADS: insurance_commission_amount fora da base, em regua NENHUMA");
linha();

for (const s of sujeitos) {
  for (const bc of ["PRODUCAO_LIQUIDA", "AVISTA_CREDITO_PF"] as const) {
    const b = await construirBaseLideranca(admin as any, {
      promoterIds: s.ids,
      year: ABERTO.year,
      month: ABERTO.month,
      fechado: false,
      baseCalculo: bc,
    });
    const c = b.composicao;
    // No aberto a ADS nao tem comissao apurada por fonte nenhuma: sob a regua
    // nova ela sai dos dois recortes, sob a antiga entra so no denominador.
    assere(
      c.ads_comissao === 0,
      `${bc}: ADS nao contribui comissao no mes aberto (${nome(s.g)}, ${ultimaAberta})`,
      `ads_comissao ${brl(c.ads_comissao)} | ads_liquido ${brl(c.ads_liquido)} | antes da correcao entravam R$ 13,20 (Carla) / R$ 13,88 (Izabela)`,
    );
  }
}
{
  // Prova ESTRUTURAL, nao so numerica: o campo nao esta no SELECT nem no tipo.
  // A assercao numerica acima cai se alguem reintroduzir a leitura E houver
  // residuo; esta cai mesmo que o residuo tenha sumido do banco.
  //
  // Comentarios de linha sao removidos antes do teste DE PROPOSITO: o bloco de
  // decisao no proprio modulo cita o nome do campo varias vezes, e e assim que
  // se quer — o nome existe la como registro da decisao, nao como codigo.
  const src = fs.readFileSync(
    new URL("../lib/lideranca/baseLideranca.ts", import.meta.url),
    "utf8",
  );
  const semComentarios = src.replace(/^\s*\/\/.*$/gm, "");
  const voltou = semComentarios.includes("insurance_commission_amount");
  assere(
    !voltou,
    "baseLideranca nao le nem seleciona insurance_commission_amount",
    voltou
      ? "o campo VOLTOU ao codigo do modulo (fora de comentario)"
      : "ausente do SELECT, do tipo e de qualquer leitura — so citado em comentario",
  );
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
