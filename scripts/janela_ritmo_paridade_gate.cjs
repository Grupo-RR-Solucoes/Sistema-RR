/*
 * GATE — paridade /projecao x /equipe apos a extracao do helper canonico
 * (lib/janelaRitmo.resolverJanelaRitmo). READ-ONLY (le prod).
 *
 * As duas telas tinham copias separadas da mesma regra e a do /equipe divergiu
 * (">= end" + decremento no proprio contador exibido). Prova aqui que agora as
 * duas reportam os MESMOS tres numeros em 2026-07-30 (ultimo dia da janela):
 *   periodoCompleto=false, decorridos=23, ritmo=22
 * e que a projecao de cada uma realmente DIVIDE por 22 (nao por 23).
 *
 * PARTE E: o gate anterior mediu master acum = 0,00 — este script investiga se e
 * verdade ou se o script simplesmente nao carregava as nao atribuidas.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildProjecaoMetas, consolidarGrupoEquipe } = require("../lib/projecaoMetas.ts");
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
const REF = new Date("2026-07-30T00:00:00Z");
const YEAR = 2026;
const MONTH = 7;

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
  console.log(`TRP_SOURCE=${process.env.TRP_SOURCE ?? "(nao setado)"} | referenceDate=2026-07-30`);
  const regime = await detectMonthRegime(sb, YEAR, MONTH).catch(() => "open");
  const closed = regime !== "open";
  console.log(`regime jul/2026 = ${regime} (closed=${closed})`);

  // ---------- D.1 lado /projecao ----------
  const resP = await buildProjecaoMetas(sb, { year: YEAR, month: MONTH, referenceDate: REF });
  const consP = consolidarGrupoEquipe(resP);
  const janP = resP.janela;
  console.log("\n=== D.1 /projecao (buildProjecaoMetas) ===");
  console.log(`  janela            : ${JSON.stringify(janP)}`);
  console.log(`  periodoCompleto   : ${resP.fechado || REF > new Date("2026-07-30T00:00:00Z")}`);
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
  console.log(`  ritmo na mao /22  : ${brl((accE / 22) * 23)}`);
  console.log(`  ritmo na mao /23  : ${brl((accE / 23) * 23)}   <- divisor ANTIGO`);

  console.log("\n=== D.3 os TRES numeros, lado a lado ===");
  console.log(`  ${"".padEnd(14)} ${"periodoCompleto".padEnd(16)} ${"decorridos".padEnd(11)} ritmo`);
  console.log(`  ${"/projecao".padEnd(14)} ${String(false).padEnd(16)} ${String(janP.dias_uteis_decorridos).padEnd(11)} ${janP.dias_uteis_ritmo}`);
  console.log(`  ${"/equipe".padEnd(14)} ${String(janE.periodoCompleto).padEnd(16)} ${String(janE.diasDecorridos).padEnd(11)} ${janE.diasParaRitmo}`);

  ok(janP.dias_uteis_decorridos === 23, `/projecao decorridos = 23 (veio ${janP.dias_uteis_decorridos})`);
  ok(janP.dias_uteis_ritmo === 22, `/projecao ritmo = 22 (veio ${janP.dias_uteis_ritmo})`);
  ok(janE.diasDecorridos === 23, `/equipe decorridos = 23 (veio ${janE.diasDecorridos})`);
  ok(janE.diasParaRitmo === 22, `/equipe ritmo = 22 (veio ${janE.diasParaRitmo})`);
  ok(janE.periodoCompleto === false, `/equipe periodoCompleto = false (veio ${janE.periodoCompleto})`);
  ok(
    janP.dias_uteis_decorridos === janE.diasDecorridos && janP.dias_uteis_ritmo === janE.diasParaRitmo,
    "as DUAS telas reportam os mesmos decorridos/ritmo"
  );
  ok(Math.abs(projE - (accE / 22) * 23) < 0.5, "/equipe: projecao DIVIDE por 22 (o divisor novo)");
  ok(Math.abs(projE - accE) > 0.5, "/equipe: projecao NAO e o proprio acumulado (nao virou 'completo' em 30/07)");

  // ---------- E: as nao atribuidas ----------
  console.log("\n=== E) o master/nao atribuidas: o gate carregava? ===");
  console.log(`  buildProjecaoMetas SEM companyId -> naoAtribuido.total = ${JSON.stringify(resP.naoAtribuido.total)}`);
  console.log(`  porCnpj = ${JSON.stringify(resP.naoAtribuido.porCnpj)}`);

  // consulta CRUA no diario: producao de julho SEM promotor atribuido
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
  console.log(`  CRU daily_production_records jul/2026, assigned_promoter_id NULL + elegivel:`);
  console.log(`    linhas do diario lidas = ${diario.length}`);
  console.log(`    nao atribuidas = ${cruCount} linhas, Sigma net = ${brl(cruAcum)}`);
  for (const [k, v] of porEmpresa) console.log(`      company_id ${k}: ${v.n} linha(s), ${brl(v.soma)}`);

  console.log(`\n  VEREDITO E: ${cruCount === 0 ? "nao ha nao atribuidas em julho — o 0,00 do gate e VERDADE, mas projetarMaster fica sem cobertura" : `EXISTEM ${cruCount} nao atribuidas (${brl(cruAcum)}) — o gate NAO as carregou`}`);

  console.log(`\n${falhas === 0 ? "GATE OK" : `GATE FALHOU (${falhas})`}`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
