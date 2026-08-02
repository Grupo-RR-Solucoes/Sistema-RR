/* ============================================================================
 * gate_projecao_gestor — o ramo do gestor da /projecao, contra PRODUCAO.
 * SOMENTE LEITURA. NAO grava.
 *
 * Rodar:  TRP_SOURCE=db npx tsx scripts/gate_projecao_gestor.mts
 *
 * Extensao .mts (nao .ts) porque o arquivo usa await no topo: com .ts o
 * compilador emite CommonJS e o top-level await falha.
 *
 * O QUE ELE EXERCITA
 * O MESMO caminho da rota: buildTeamProduction -> montarPayloadGestor, e dentro
 * dela projecaoResultadoDoGestor + os 4 agregadores puros. Nao ha reimplementacao
 * do payload aqui; a funcao importada e literalmente a que /api/projecao serve.
 *
 * O QUE ELE **NAO** EXERCITA — LIMITACAO ESTRUTURAL, LEIA ANTES DE CONFIAR
 * A autorizacao real e RLS por auth.uid(): a vw_team_production filtra por
 * current_user_team_promoter_ids(), que le app_users pelo JWT do usuario logado.
 * Um script com service_role tem auth.uid() NULO — a view devolveria ZERO linhas.
 * Entao aqui a arvore e REPRODUZIDA a partir das tabelas cruas, espelhando o SQL
 * do helper (migration 20260701_000003:74-96), e injetada num shim que ocupa o
 * lugar do client anon.
 *
 * Consequencia honesta: este gate prova a MONTAGEM (agregacao, comissao,
 * ausencia de campos), NAO prova a RLS. Se o helper do banco divergir do que
 * esta reproduzido abaixo, o gate nao percebe. A RLS so se testa com sessao real.
 *
 * ASSERCOES SAO POR DELTA, nunca por valor absoluto: numero absoluto de producao
 * muda todo dia e transformaria o gate em alarme falso.
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

// .env -> process.env. MESMA precedencia do scripts/_ts_register.cjs (que so
// serve CommonJS e nao alcanca este .mts): shell > .env.local > .env, com o
// guard impedindo o .env de sobrescrever a chave do .env.local.
const ROOT = path.resolve(import.meta.dirname, "..");
for (const arquivo of [".env.local", ".env"]) {
  const p = path.join(ROOT, arquivo);
  if (!fs.existsSync(p)) continue;
  for (const linhaEnv of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = linhaEnv.match(/^([A-Z0-9_]+)=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

import { buildTeamProduction } from "@/lib/equipe/teamProduction.ts";
import { montarPayloadGestor } from "@/lib/projecao/gestorAdapter.ts";
import { buildProjecaoMetas, consolidarGrupoEquipe } from "@/lib/projecaoMetas.ts";
import { calcularRemuneracaoLideranca, resolverReguaLideranca } from "@/lib/remuneracaoLideranca.ts";
import { construirBaseLideranca } from "@/lib/lideranca/baseLideranca.ts";
import { mediaTresMeses } from "@/lib/projecao/mediaTresMeses.ts";
import { nowInFortaleza } from "@/lib/dateFortaleza.ts";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const brl = (n: number) =>
  "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const linha = (c = "=") => console.log(c.repeat(96));

let falhas = 0;
const pulos: string[] = [];
function assere(ok: boolean, titulo: string, detalhe: string) {
  console.log(`  [${ok ? "OK  " : "FALHA"}] ${titulo}`);
  console.log(`         ${detalhe}`);
  if (!ok) falhas += 1;
}
/** Assercao que nao pode rodar. NUNCA some do resumo — silencio vira falso OK. */
function pula(titulo: string, motivo: string) {
  console.log(`  [PULO ] ${titulo}`);
  console.log(`         ${motivo}`);
  pulos.push(`${titulo} — ${motivo}`);
}

/** Pagina uma query ate o fim (as tabelas passam de 1000 linhas). */
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

/**
 * Reproduz public.current_user_team_promoter_ids() para um app_user especifico.
 * Espelha 20260701_000003:74-96 — supervisor pega os promotores diretos; gerente
 * pega os promotores dos supervisores que reportam a ele; is_master fora dos dois.
 */
async function arvoreDe(appUserId: string, role: string): Promise<string[]> {
  if (role === "supervisor") {
    const { data, error } = await admin
      .from("promoters")
      .select("id, is_master")
      .eq("supervisor_user_id", appUserId);
    if (error) throw new Error(error.message);
    return (data ?? []).filter((p: any) => p.is_master !== true).map((p: any) => p.id);
  }
  const { data: sups, error: e1 } = await admin
    .from("app_users")
    .select("id")
    .eq("manager_user_id", appUserId);
  if (e1) throw new Error(e1.message);
  const supIds = (sups ?? []).map((s: any) => s.id);
  if (supIds.length === 0) return [];
  const { data, error } = await admin
    .from("promoters")
    .select("id, is_master")
    .in("supervisor_user_id", supIds);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((p: any) => p.is_master !== true).map((p: any) => p.id);
}

/** Colunas EXATAS da vw_team_production que o buildTeamProduction seleciona. */
const COLS_VIEW =
  "id, assigned_promoter_id, promoter_id, status, is_srcc_restricted, movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value, has_insurance";

/**
 * Shim no lugar do client ANON: devolve o que a view/policy devolveriam.
 *
 * `rpc` foi acrescentado em 01/08/2026: o buildTeamProduction passou a resolver
 * a arvore por current_user_team_promoter_ids no proprio client ANON. O shim
 * devolve `arvore` ali — a MESMA lista que alimenta o WHERE reproduzido em
 * `rows` logo abaixo, que e exatamente como o banco se comporta (a view e o
 * helper leem o mesmo auth.uid()).
 *
 * NAO mascara o defeito: `rows` continua reproduzindo o OR da view
 * (assigned OU promoter na arvore), entao o forasteiro CHEGA ao
 * buildTeamProduction e o gate mede se ele foi barrado la dentro. Um shim que
 * filtrasse `rows` so por assigned e que tornaria o teste vacuo.
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

async function payloadDoGestor(appUserId: string, role: string, year: number, month: number) {
  const ids = await arvoreDe(appUserId, role);
  if (ids.length === 0) return { ids, payload: null as any };

  // .order("id") OBRIGATORIO: range() sem ordem estavel repete/pula linhas entre
  // paginas. Estava faltando aqui nas duas paginacoes.
  const cruas = await todas<any>((de, ate) =>
    admin.from("daily_production_records").select(COLS_VIEW).order("id").range(de, ate),
  );
  const setIds = new Set(ids);
  const rows = cruas.filter(
    (r) => (r.assigned_promoter_id && setIds.has(r.assigned_promoter_id)) || (r.promoter_id && setIds.has(r.promoter_id)),
  );

  const alvos = await todas<any>((de, ate) =>
    admin.from("monthly_targets").select("promoter_id, year, month, meta, meta_1, meta_2").order("id").range(de, ate),
  );
  const targets = alvos.filter((t) => setIds.has(t.promoter_id));

  const team = await buildTeamProduction(shimDb(rows, targets, ids), admin as any, { year, month });

  // ESTE GATE ESTAVA QUEBRADO desde a frente da regua de lideranca: o
  // montarPayloadGestor ganhou um 2o parametro OBRIGATORIO (`lideranca`) e a
  // chamada aqui continuou com um argumento so, entao o script morria em
  // TypeError ANTES da primeira assercao — nao provava nada e nao acusava.
  // `scripts` esta em tsconfig.json:41 (exclude), entao o tsc nao pega.
  //
  // Reproduz o que a rota faz, na mesma ordem: regua ANTES da base (o
  // base_calculo decide se a ADS entra no mes aberto), base sobre a ARVORE.
  const competencia = `${team.period.year}-${String(team.period.month).padStart(2, "0")}`;
  const regua = await resolverReguaLideranca(admin as any, role as any, competencia);
  const base = await construirBaseLideranca(admin as any, {
    promoterIds: ids,
    year: team.period.year,
    month: team.period.month,
    fechado: team.fechado,
    baseCalculo: regua.base_calculo,
  });
  const resultado = calcularRemuneracaoLideranca(regua, base, competencia);

  return { ids, payload: montarPayloadGestor(team, { resultado, base }) };
}

// ---------------------------------------------------------------- competencia
const hoje = nowInFortaleza();
const YEAR = Number(process.env.GATE_YEAR || 0) || hoje.year;
const MONTH = Number(process.env.GATE_MONTH || 0) || hoje.month;

linha();
console.log(`GATE /projecao DO GESTOR — competencia ${String(MONTH).padStart(2, "0")}/${YEAR}`);
console.log("ATENCAO: a arvore e REPRODUZIDA por service_role. Este gate prova a");
console.log("MONTAGEM, nao a RLS. Ver o cabecalho do arquivo.");
linha();

// -------------------------------------------------- escolhe gestores REAIS
const { data: gestores, error: eg } = await admin
  .from("app_users")
  .select("id, full_name, email, role, manager_user_id")
  .in("role", ["supervisor", "gerente_regional"]);
if (eg) throw new Error(eg.message);

const nome = (g: any) => (g.full_name && g.full_name.trim()) || g.email;

// gerente com supervisores abaixo
let gerente: any = null;
let supDoGerente: any = null;
for (const g of (gestores ?? []).filter((x: any) => x.role === "gerente_regional")) {
  const abaixo = (gestores ?? []).filter((s: any) => s.role === "supervisor" && s.manager_user_id === g.id);
  for (const s of abaixo) {
    if ((await arvoreDe(s.id, "supervisor")).length > 0) {
      gerente = g;
      supDoGerente = s;
      break;
    }
  }
  if (gerente) break;
}

// supervisor com mais promotores (pode ser o mesmo de cima)
let supervisor: any = null;
let maior = 0;
for (const s of (gestores ?? []).filter((x: any) => x.role === "supervisor")) {
  const n = (await arvoreDe(s.id, "supervisor")).length;
  if (n > maior) {
    maior = n;
    supervisor = s;
  }
}

console.log("\nSUJEITOS DO TESTE");
console.log("  supervisor :", supervisor ? `${nome(supervisor)} (${supervisor.id})` : "NENHUM ENCONTRADO");
console.log("  gerente    :", gerente ? `${nome(gerente)} (${gerente.id})` : "NENHUM ENCONTRADO");
console.log("  sup. abaixo do gerente:", supDoGerente ? `${nome(supDoGerente)} (${supDoGerente.id})` : "n/a");

if (!supervisor) {
  console.log("\nSem supervisor com rede em producao. Gate ABORTADO (nao simula).");
  process.exit(1);
}

// -------------------------------------------------- monta os payloads
const sup = await payloadDoGestor(supervisor.id, "supervisor", YEAR, MONTH);
const ger = gerente ? await payloadDoGestor(gerente.id, "gerente_regional", YEAR, MONTH) : null;
const supAbaixo = supDoGerente ? await payloadDoGestor(supDoGerente.id, "supervisor", YEAR, MONTH) : null;

// -------------------------------------------------- socio, para o teto
const resSocio = await buildProjecaoMetas(admin as any, { year: YEAR, month: MONTH });
const consSocio = consolidarGrupoEquipe(resSocio);

linha();
console.log("1) NUMEROS BRUTOS");
linha();
console.log(`  socio      promotores=${resSocio.promotores.length}  producao=${brl(consSocio.producao_acumulada)}`);
console.log(
  `  supervisor promotores=${sup.ids.length}  producao=${brl(sup.payload?.consolidado.producao_acumulada ?? 0)}  comissao=${brl(sup.payload?.comissao_gestao.valor_acumulado ?? 0)}`,
);
if (ger?.payload) {
  console.log(
    `  gerente    promotores=${ger.ids.length}  producao=${brl(ger.payload.consolidado.producao_acumulada)}  comissao=${brl(ger.payload.comissao_gestao.valor_acumulado)}`,
  );
}
if (supAbaixo?.payload) {
  console.log(
    `  sup.abaixo promotores=${supAbaixo.ids.length}  producao=${brl(supAbaixo.payload.consolidado.producao_acumulada)}  comissao=${brl(supAbaixo.payload.comissao_gestao.valor_acumulado)}`,
  );
}

linha();
console.log("2) ASSERCOES");
linha();

// -------------------------------------------------- GUARDA DE VACUIDADE
// Sem esta guarda o gate passa sozinho numa competencia sem producao: toda
// desigualdade vira 0 <= 0 e todo delta vira zero. Ja aconteceu neste repo
// (vw_team_production devolvendo 0 linhas para service_role). Competencia vazia
// nao e aprovacao — e ausencia de teste, e sai com codigo de erro.
if (consSocio.producao_acumulada <= 0 || (sup.payload?.consolidado.producao_acumulada ?? 0) <= 0) {
  console.log("  [ABORTA] competencia SEM PRODUCAO — assercoes seriam vacuas (0 <= 0).");
  console.log(`           socio=${brl(consSocio.producao_acumulada)}  supervisor=${brl(sup.payload?.consolidado.producao_acumulada ?? 0)}`);
  console.log("           Rode numa competencia com dado: GATE_YEAR=2026 GATE_MONTH=7");
  linha();
  process.exit(1);
}

// (a) rede e subconjunto do grupo
const prodSup = sup.payload?.consolidado.producao_acumulada ?? 0;
assere(
  prodSup <= consSocio.producao_acumulada + 0.01,
  "producao do supervisor <= producao do socio",
  `${brl(prodSup)} <= ${brl(consSocio.producao_acumulada)}  (delta ${brl(consSocio.producao_acumulada - prodSup)})`,
);
if (ger?.payload) {
  const prodGer = ger.payload.consolidado.producao_acumulada;
  assere(
    prodGer <= consSocio.producao_acumulada + 0.01,
    "producao do gerente <= producao do socio",
    `${brl(prodGer)} <= ${brl(consSocio.producao_acumulada)}  (delta ${brl(consSocio.producao_acumulada - prodGer)})`,
  );
}

// (b) comissao do gerente >= comissao do supervisor abaixo dele
if (ger?.payload && supAbaixo?.payload) {
  const cg = ger.payload.comissao_gestao.valor_acumulado;
  const cs = supAbaixo.payload.comissao_gestao.valor_acumulado;
  assere(
    cg >= cs - 0.01,
    "comissao do gerente >= comissao do supervisor abaixo",
    `${brl(cg)} >= ${brl(cs)}  (delta ${brl(cg - cs)})`,
  );
} else {
  pula(
    "comissao do gerente >= comissao do supervisor abaixo",
    "nao ha gerente_regional com supervisor abaixo em producao — nao simulado",
  );
}

// (c) nenhum campo de comissao de PROMOTOR no payload
const PROIBIDAS = ["seguro_comissao", "seguro_share", "commission", "comissao_promotor", "final_commission"];
function varre(o: any, caminho = "", achados: string[] = []): string[] {
  if (o === null || typeof o !== "object") return achados;
  if (Array.isArray(o)) {
    o.forEach((v, i) => varre(v, `${caminho}[${i}]`, achados));
    return achados;
  }
  for (const [k, v] of Object.entries(o)) {
    const p = caminho ? `${caminho}.${k}` : k;
    // comissao_gestao e a comissao DO GESTOR — a unica permitida.
    if (!p.includes("comissao_gestao") && PROIBIDAS.some((t) => k.includes(t))) achados.push(p);
    varre(v, p, achados);
  }
  return achados;
}
const vazou = varre(sup.payload);
assere(
  vazou.length === 0,
  "nenhum campo de comissao de promotor no payload",
  vazou.length === 0 ? "0 chaves proibidas encontradas" : `VAZOU: ${vazou.slice(0, 8).join(", ")}`,
);

// (d) campos que devem estar AUSENTES
for (const campo of ["seguro_comissao_grupo_empresa", "companies", "nao_atribuido"]) {
  assere(
    !(campo in (sup.payload ?? {})),
    `${campo} ausente da raiz`,
    `in payload = ${campo in (sup.payload ?? {})}`,
  );
}
assere(
  !("nao_atribuido" in (sup.payload?.consolidado ?? {})),
  "nao_atribuido ausente do consolidado",
  `in consolidado = ${"nao_atribuido" in (sup.payload?.consolidado ?? {})}`,
);

// (e) soma dos promotores == consolidado
const somaGrupos = (sup.payload?.grupos ?? []).reduce(
  (s: number, g: any) => s + g.promotores.reduce((x: number, p: any) => x + p.producao_acumulada, 0),
  0,
);
assere(
  Math.abs(somaGrupos - prodSup) < 0.01,
  "soma da producao dos promotores == producao consolidada",
  `${brl(somaGrupos)} vs ${brl(prodSup)}  (delta ${brl(somaGrupos - prodSup)})`,
);

// (f) a comissao e mesmo a regua sobre a base
if (sup.payload) {
  const c = sup.payload.comissao_gestao;
  // A regua vem de leadership_rule_versions, nao de constante em codigo.
  const regua = await resolverReguaLideranca(admin as any, "supervisor", `${YEAR}-${String(MONTH).padStart(2, "0")}`);
  const esperado = calcularRemuneracaoLideranca(
    regua,
    { comissao_avista: c.base_comissao_avista, producao_liquida: c.base_producao_liquida },
    `${YEAR}-${String(MONTH).padStart(2, "0")}`,
  );
  assere(
    Math.abs(c.valor - esperado.valor) < 0.01 && c.criterio === esperado.criterio,
    `comissao do payload == regua versionada aplicada a mesma base`,
    `payload ${brl(c.valor)} criterio "${c.criterio}" vs helper ${brl(esperado.valor)} criterio "${esperado.criterio}"`,
  );
}

// -------------------------------------------------------------------------
// 3) MEDIA DE 3 MESES — soma por competencia, nunca por linha (fase 7).
// Casos REAIS: todo par (promotor, competencia) com mais de uma linha no PMR.
// A media de UMA competencia (n=1) tem de dar a SOMA das linhas dela; a regra
// antiga daria soma/numero-de-linhas. Nao ha caso sintetico aqui.
// -------------------------------------------------------------------------
linha();
console.log("3) MEDIA DE 3 MESES — soma por competencia");
linha();

const pmr = await todas<any>((de, ate) =>
  admin
    .from("promoter_monthly_results")
    .select("promoter_id, year, month, company_id, source, production_value")
    // .order("id") OBRIGATORIO: range() sem ordem estavel repete/pula linhas.
    // Hoje a tabela tem 343 linhas e nao pagina, entao nao ha erro vivo aqui —
    // mas o defeito nasce sozinho no dia em que passar de 1000.
    .order("id")
    .range(de, ate),
);

const porPromotorComp = new Map<string, any[]>();
for (const r of pmr) {
  const k = `${r.promoter_id}|${r.year}|${r.month}`;
  porPromotorComp.set(k, (porPromotorComp.get(k) ?? []).concat([r]));
}
const multi = [...porPromotorComp.entries()].filter(([, v]) => v.length > 1);

console.log(`  pares (promotor, competencia) com >1 linha no PMR: ${multi.length}`);

if (multi.length === 0) {
  pula(
    "media de 3 meses soma por competencia",
    "nenhum promotor com 2 linhas de PMR na mesma competencia — sem caso real para exercitar",
  );
} else {
  const { data: nomes } = await admin.from("promoters").select("id, name");
  const nomeDe = new Map((nomes ?? []).map((p: any) => [p.id, p.name]));

  for (const [k, linhas] of multi) {
    const [pid, ano, mes] = k.split("|");
    const y = Number(ano);
    const m = Number(mes);
    const soma = linhas.reduce((s: number, r: any) => s + Number(r.production_value || 0), 0);
    const regraAntiga = soma / linhas.length;

    // n=1 e referencia = competencia SEGUINTE => a janela e exatamente esta
    // competencia, entao a media dela e a soma das suas linhas.
    const seguinte = new Date(Date.UTC(y, m, 1));
    const obtido = mediaTresMeses(
      linhas.map((r: any) => ({ year: r.year, month: r.month, valor: Number(r.production_value || 0) })),
      seguinte.getUTCFullYear(),
      seguinte.getUTCMonth() + 1,
      1,
    );

    assere(
      Math.abs(obtido - soma) < 0.01 && Math.abs(obtido - regraAntiga) > 0.01,
      `${nomeDe.get(pid) ?? pid} ${ano}-${String(m).padStart(2, "0")}: media == soma, nao metade`,
      `${linhas.length} linhas (${linhas.map((r: any) => r.source).join("/")}) | soma=${brl(soma)} | helper=${brl(obtido)} | regra antiga daria ${brl(regraAntiga)}`,
    );
  }
}

linha();
console.log(
  falhas === 0
    ? `GATE OK — 0 FALHAS, ${pulos.length} PULO(S)`
    : `GATE: ${falhas} FALHA(S), ${pulos.length} PULO(S)`,
);
if (pulos.length > 0) {
  console.log("\nNAO EXERCITADO (leia antes de tratar o OK como cobertura):");
  for (const p of pulos) console.log("  - " + p);
}
console.log("\nNAO EXERCITADO SEMPRE: a RLS. A arvore acima foi reproduzida por");
console.log("service_role espelhando 20260701_000003:74-96. Divergencia entre o");
console.log("helper do banco e essa reproducao passa despercebida por este gate.");
linha();
process.exit(falhas === 0 ? 0 : 1);
