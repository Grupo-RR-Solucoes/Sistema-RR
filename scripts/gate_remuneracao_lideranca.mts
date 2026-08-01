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
 *      SEM DESVIO o valor que lib/comissaoGestao.ts produz hoje.
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
import { calcularComissaoGestao } from "@/lib/comissaoGestao.ts";

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
  const base = baseDaRede(s.ids);
  const antiga = await resolverReguaLideranca(admin as any, s.cargo, COMP);
  const rAntiga = calcularRemuneracaoLideranca(antiga, base, COMP);
  // O valor ATUAL, do modulo que a tela usa hoje.
  const atual = calcularComissaoGestao(base.producao_liquida, null).valor_acumulado;

  console.log(`\n  ${nome(s.g)} (${s.cargo}, ${s.ids.length} promotores)`);
  console.log(`    base: ${base.linhas} linhas | comissao ${brl(base.comissao_avista)} | liquido ${brl(base.producao_liquida)} | ${base.srccFora} fora por SRCC`);
  console.log(`    regua ate ${antiga.competencia_fim}: aliquota ${pct(antiga.aliquota)} piso ${pct(antiga.piso)} base ${antiga.base_calculo}`);
  assere(
    Math.abs(rAntiga.valor - atual) < 0.01,
    `regua versionada == lib/comissaoGestao (${nome(s.g)})`,
    `versionada ${brl(rAntiga.valor)} vs atual ${brl(atual)}  (desvio ${brl(rAntiga.valor - atual)}) | criterio: ${rAntiga.criterio}`,
  );
}

linha();
console.log(`2) REGUA NOVA aplicada a ${COMP} — o que passaria a pagar`);
linha();

for (const s of sujeitos) {
  const base = baseDaRede(s.ids);
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

  const daComp = ads.filter((r) => {
    const d = String(r.movement_date || r.contract_date || r.proposal_date || "");
    return d.slice(0, 7) === COMP;
  });
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

linha();
console.log("4) TRAVA DE COMPETENCIA CONGELADA");
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
