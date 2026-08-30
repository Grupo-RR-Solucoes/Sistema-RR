/*
 * GATE — paridade /projecao x /equipe apos a extracao do helper canonico
 * (lib/janelaRitmo.resolverJanelaRitmo). READ-ONLY (le prod).
 *
 * As duas telas tinham copias separadas da mesma regra e a do /equipe divergiu
 * (">= end" + decremento no proprio contador exibido). Prova aqui que agora as
 * duas reportam os MESMOS tres numeros no ULTIMO dia util da janela da competencia
 * ABERTA (resolvida no run; era 2026-07-30 cravado):
 *   periodoCompleto=false, decorridos=total, ritmo=total-1
 * e que a projecao de cada uma realmente DIVIDE por total-1 (nao por total).
 *
 * PARTE E: o gate anterior mediu master acum = 0,00 — este script investiga se e
 * verdade ou se o script simplesmente nao carregava as nao atribuidas.
 */
require("./_ts_register.cjs");
const { resolverCompetenciaAberta } = require("./_competenciaAberta.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildProjecaoMetas, consolidarGrupoEquipe, productionBusinessWindow } = require("../lib/projecaoMetas.ts");
const { resolverJanelaRitmo } = require("../lib/janelaRitmo.ts");
const { assembleTeamProduction } = require("../lib/equipe/teamProduction.ts");
const { detectMonthRegime } = require("../lib/cmsMonthly.ts");
const { getProductionPeriodFromValue } = require("../lib/productionPeriod.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let falhas = 0;
const ok = (c, m) => {
  console.log(`  ${c ? "OK " : "XX "} ${m}`);
  if (!c) falhas++;
};
const brl = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// COMPETENCIA E DATA DE REFERENCIA SAEM DO RUN — preenchidas no inicio do main,
// com o porque escrito la. Eram `2026-07-30` / `2026` / `7`, cravados.
let REF = null;
let YEAR = 0;
let MONTH = 0;
let TOTAL_JANELA = 0; // dias uteis da janela — o "23" que estava escrito a mao

async function todasAsLinhas(tabela, colunas) {
  const out = [];
  for (let page = 0; ; page++) {
    const { data, error } = await sb.from(tabela).select(colunas).range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

(async () => {
  // ---- A COMPETENCIA E O REF SAEM DO RUN, nao de literal ----
  // Este portao cravava jul/2026 com referenceDate 30/07 e os numeros 23/22
  // escritos a mao. Julho estava ABERTO quando ele foi escrito; julho FECHOU, e
  // com a competencia fechada `periodoCompleto` vira true e o divisor deixa de
  // descontar o dia corrente — 4 assercoes caiam medindo o calendario.
  // A invariante que este portao existe para guardar — /projecao e /equipe
  // reportarem os MESMOS decorridos/ritmo — e de PARIDADE (dois lados computados)
  // e continuava passando o tempo todo.
  // Agora: mes ABERTO resolvido no run, REF = ULTIMO dia util da janela (a posicao
  // que 30/07 ocupava em julho) e o total sai de productionBusinessWindow.
  // Ver scripts/_competenciaAberta.cjs: seis portoes caiam por esta mesma causa.
  const ab = await resolverCompetenciaAberta(sb);
  YEAR = ab.year;
  MONTH = ab.month;
  const w = productionBusinessWindow(YEAR, MONTH);
  REF = w.end;
  TOTAL_JANELA = w.total;
  const refIso = REF.toISOString().slice(0, 10);
  console.log(`TRP_SOURCE=${process.env.TRP_SOURCE ?? "(nao setado)"} | competencia=${ab.comp} (aberta, do run) | referenceDate=${refIso} (ultimo dia util) | janela=${TOTAL_JANELA} dias uteis`);
  const regime = await detectMonthRegime(sb, YEAR, MONTH).catch(() => "open");
  const closed = regime !== "open";
  console.log(`regime ${ab.comp} = ${regime} (closed=${closed})`);
  // Se a competencia nao estiver ABERTA o resto do arquivo nao prova nada: com
  // periodoCompleto o divisor deixa de descontar o dia corrente, que e justamente
  // o comportamento sob teste.
  ok(!closed, `${ab.comp} esta ABERTA (closed=${closed}) — sem isso o divisor sob teste nao existe`);

  // ---------- D.1 lado /projecao ----------
  const resP = await buildProjecaoMetas(sb, { year: YEAR, month: MONTH, referenceDate: REF });
  const consP = consolidarGrupoEquipe(resP);
  const janP = resP.janela;
  console.log("\n=== D.1 /projecao (buildProjecaoMetas) ===");
  console.log(`  janela            : ${JSON.stringify(janP)}`);
  console.log(`  periodoCompleto   : ${resP.fechado || REF > w.end}`);
  console.log(`  acumulado (grupo) : ${brl(consP.producao_acumulada)}`);
  console.log(`  projecao  (grupo) : ${brl(consP.projecao)}`);

  // ---------- D.2 lado /equipe ----------
  // A janela que o assembleTeamProduction resolve internamente e ESTA (mesmos
  // argumentos que ele passa agora ao helper).
  const janE = resolverJanelaRitmo(YEAR, MONTH, { closed, referenceDate: REF });
  // ATENCAO: vw_team_production e mascarada por auth.uid() (helper de time, F3) e
  // devolve ZERO linhas para service_role — um gate que lesse a view mediria o
  // vazio e passaria por vacuidade. Lemos as MESMAS colunas da tabela-base
  // (daily_production_records), que e exatamente o que a view projeta antes do
  // mascaramento; a aritmetica exercitada e a mesma.
  const rows = await todasAsLinhas(
    "daily_production_records",
    "id, assigned_promoter_id, promoter_id, status, is_srcc_restricted, movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value, has_insurance"
  );
  const targets = await todasAsLinhas("monthly_targets", "promoter_id, year, month, meta, meta_1, meta_2");
  const payload = assembleTeamProduction(
    rows,
    targets,
    new Map(),
    new Map(),
    { year: YEAR, month: MONTH },
    REF,
    [],
    new Map(),
    regime
  );
  const accE = payload.totals.production_value;
  const projE = payload.period_projection.production_value;
  console.log("\n=== D.2 /equipe (assembleTeamProduction) ===");
  console.log(`  janela resolvida  : decorridos=${janE.diasDecorridos} ritmo=${janE.diasParaRitmo} totais=${janE.total} completo=${janE.periodoCompleto}`);
  console.log(`  linhas alimentadas: ${rows.length} (tabela-base; a view devolve 0 p/ service_role)`);
  console.log(`  promotores        : ${payload.totals.promoters}`);
  console.log(`  acumulado (total) : ${brl(accE)}`);
  console.log(`  projecao (period) : ${brl(projE)}`);
  console.log(`  ritmo na mao /${TOTAL_JANELA - 1}  : ${brl((accE / (TOTAL_JANELA - 1)) * TOTAL_JANELA)}`);
  console.log(`  ritmo na mao /${TOTAL_JANELA}  : ${brl(accE)}   <- divisor ANTIGO`);

  console.log("\n=== D.3 os TRES numeros, lado a lado ===");
  console.log(`  ${"".padEnd(14)} ${"periodoCompleto".padEnd(16)} ${"decorridos".padEnd(11)} ritmo`);
  console.log(`  ${"/projecao".padEnd(14)} ${String(false).padEnd(16)} ${String(janP.dias_uteis_decorridos).padEnd(11)} ${janP.dias_uteis_ritmo}`);
  console.log(`  ${"/equipe".padEnd(14)} ${String(janE.periodoCompleto).padEnd(16)} ${String(janE.diasDecorridos).padEnd(11)} ${janE.diasParaRitmo}`);

  // No ULTIMO dia util da janela, com a competencia ABERTA: decorridos = total (a
  // tela mostra "N/N") e o DIVISOR = total-1 (o dia corrente sai). Derivado, nao cravado.
  const DEC = TOTAL_JANELA;
  const DIV = TOTAL_JANELA - 1;
  ok(janP.dias_uteis_decorridos === DEC, `/projecao decorridos = ${DEC} (veio ${janP.dias_uteis_decorridos})`);
  ok(janP.dias_uteis_ritmo === DIV, `/projecao ritmo = ${DIV} (veio ${janP.dias_uteis_ritmo})`);
  ok(janE.diasDecorridos === DEC, `/equipe decorridos = ${DEC} (veio ${janE.diasDecorridos})`);
  ok(janE.diasParaRitmo === DIV, `/equipe ritmo = ${DIV} (veio ${janE.diasParaRitmo})`);
  ok(janE.periodoCompleto === false, `/equipe periodoCompleto = false (veio ${janE.periodoCompleto})`);
  ok(
    janP.dias_uteis_decorridos === janE.diasDecorridos && janP.dias_uteis_ritmo === janE.diasParaRitmo,
    "as DUAS telas reportam os mesmos decorridos/ritmo"
  );
  ok(Math.abs(projE - (accE / DIV) * TOTAL_JANELA) < 0.5, `/equipe: projecao DIVIDE por ${DIV} (o divisor novo)`);
  ok(Math.abs(projE - accE) > 0.5, `/equipe: projecao NAO e o proprio acumulado (nao virou 'completo' no ultimo dia util)`);

  // ---------- E: as nao atribuidas ----------
  console.log("\n=== E) o master/nao atribuidas: o gate carregava? ===");
  console.log(`  buildProjecaoMetas SEM companyId -> naoAtribuido.total = ${JSON.stringify(resP.naoAtribuido.total)}`);
  console.log(`  porCnpj = ${JSON.stringify(resP.naoAtribuido.porCnpj)}`);

  // consulta CRUA no diario: producao da competencia SEM promotor atribuido
  const diario = await todasAsLinhas(
    "daily_production_records",
    "id, company_id, assigned_promoter_id, status, is_srcc_restricted, movement_date, contract_date, proposal_date, net_value"
  );
  const elegivel = (r) => {
    const s = String(r.status ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
    return (s === "PRODUCAO" || s === "PRODUCTION") && r.is_srcc_restricted !== true;
  };
  let cruAcum = 0;
  let cruCount = 0;
  const porEmpresa = new Map();
  for (const r of diario) {
    if (r.assigned_promoter_id) continue;
    if (!elegivel(r)) continue;
    const comp =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    if (!comp || comp.year !== YEAR || comp.month !== MONTH) continue;
    const v = Number(r.net_value ?? 0);
    cruAcum += v;
    cruCount += 1;
    const k = r.company_id ?? "(sem company_id)";
    const cur = porEmpresa.get(k) ?? { soma: 0, n: 0 };
    porEmpresa.set(k, { soma: cur.soma + v, n: cur.n + 1 });
  }
  console.log(`  CRU daily_production_records ${ab.comp}, assigned_promoter_id NULL + elegivel:`);
  console.log(`    linhas do diario lidas = ${diario.length}`);
  console.log(`    nao atribuidas = ${cruCount} linhas, Sigma net = ${brl(cruAcum)}`);
  for (const [k, v] of porEmpresa) console.log(`      company_id ${k}: ${v.n} linha(s), ${brl(v.soma)}`);

  console.log(`\n  VEREDITO E: ${cruCount === 0 ? "nao ha nao atribuidas em ${ab.comp} — o 0,00 do gate e VERDADE, mas projetarMaster fica sem cobertura" : `EXISTEM ${cruCount} nao atribuidas (${brl(cruAcum)}) — o gate NAO as carregou`}`);

  console.log(`\n${falhas === 0 ? "GATE OK" : `GATE FALHOU (${falhas})`}`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
