// ============================================================
// TESTE — Entrega 1 da /equipe (série mensal + projeção + supervisor).
// Prova, sobre a montagem PURA assembleTeamProduction:
//   (NÃO-REGRESSÃO) o ponto do mês corrente na série == totals.production_value
//     (o número que a /equipe já mostrava não muda).
//   (série) cobre jan/2026 → corrente sem buracos.
//   (soma) Σ perPromoterMonthly no mês == monthlySeries do mês (time = Σ promotores).
//   (supervisor) Σ produção por supervisor_id == totals.production_value.
//   (projeção passada) mês já encerrado -> projeção == acumulado (ritmo completo).
//   (projeção aberta) mês corrente -> projeção >= acumulado (extrapola o ritmo).
//
// Roda via tsconfig temporário (resolve o alias @/ dos imports do módulo):
//   npx tsc -p .tmp-test/tsconfig.json && node .tmp-test/scripts/test_equipe_dashboard.js
// ============================================================

import {
  assembleTeamProduction,
  type TeamProductionPayload,
} from "../lib/equipe/teamProduction";

let fails = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FALHOU:"} ${msg}`);
  if (!cond) fails++;
}
const round = (n: number) => Math.round(n * 100) / 100;

// Fixture: P1,P2 sob supervisor S1; P3 sob S2. Produção em mai e jun/2026.
type Row = Parameters<typeof assembleTeamProduction>[0][number];
const row = (
  id: string,
  pid: string,
  date: string,
  net: number,
  status = "PRODUCAO",
): Row => ({
  id,
  assigned_promoter_id: pid,
  promoter_id: pid,
  status,
  is_srcc_restricted: false,
  movement_date: date,
  contract_date: null,
  proposal_date: null,
  net_value: net,
  gross_value: net,
  insurance_value: 0,
  has_insurance: false,
});

const rows: Row[] = [
  // junho (mês "corrente" do refDate abaixo)
  row("j1", "P1", "2026-06-10", 1000),
  row("j2", "P2", "2026-06-12", 500),
  row("j3", "P3", "2026-06-14", 300),
  // maio
  row("m1", "P1", "2026-05-10", 800),
  row("m2", "P3", "2026-05-20", 200),
  // um SRCC-restrito em junho (NÃO deve contar)
  { ...row("x1", "P1", "2026-06-15", 9999), is_srcc_restricted: true },
];

const targets = [
  { promoter_id: "P1", year: 2026, month: 6, meta: 2000, meta_1: 2500, meta_2: 3000 },
  { promoter_id: "P2", year: 2026, month: 6, meta: 1000, meta_1: null, meta_2: null },
  { promoter_id: "P3", year: 2026, month: 6, meta: 500, meta_1: null, meta_2: null },
];

const nameById = new Map([["P1", "Promotor 1"], ["P2", "Promotor 2"], ["P3", "Promotor 3"]]);
const supById = new Map([
  ["P1", { id: "S1", name: "Supervisor 1" }],
  ["P2", { id: "S1", name: "Supervisor 1" }],
  ["P3", { id: "S2", name: "Supervisor 2" }],
]);

// refDate = 15/jun/2026 (UTC-midnight) → junho é o mês corrente e está ABERTO.
const refDate = new Date(Date.UTC(2026, 5, 15));

function build(year: number, month: number): TeamProductionPayload {
  return assembleTeamProduction(rows, targets, nameById, supById, { year, month }, refDate);
}

console.log("\n(NÃO-REGRESSÃO) mês corrente: série == total exibido");
const jun = build(2026, 6);
ok(jun.totals.production_value === 1800, `total junho = 1800 (got ${jun.totals.production_value}) — SRCC excluído`);
const junPoint = jun.monthlySeries.find((p) => p.year === 2026 && p.month === 6);
ok(!!junPoint && junPoint.production_value === jun.totals.production_value,
  `monthlySeries[jun].production_value (${junPoint?.production_value}) == totals.production_value (${jun.totals.production_value})`);

console.log("\n(série) jan/2026 → corrente sem buracos");
ok(jun.monthlySeries.length === 6, `6 pontos jan..jun (got ${jun.monthlySeries.length})`);
ok(jun.monthlySeries[0].label === "jan/26" && jun.monthlySeries[5].label === "jun/26",
  `primeiro=jan/26, último=jun/26 (got ${jun.monthlySeries[0].label}, ${jun.monthlySeries[5].label})`);
const maioPoint = jun.monthlySeries.find((p) => p.month === 5);
ok(!!maioPoint && maioPoint.production_value === 1000, `maio na série = 1000 (got ${maioPoint?.production_value})`);

console.log("\n(soma) Σ perPromoterMonthly[jun] == monthlySeries[jun]");
const somaJun = jun.perPromoterMonthly.reduce((s, pm) => {
  const mp = pm.months.find((m) => m.month === 6);
  return s + (mp?.production_value ?? 0);
}, 0);
ok(round(somaJun) === 1800, `Σ promotores junho = 1800 (got ${round(somaJun)})`);

console.log("\n(supervisor) Σ produção por supervisor_id == total");
const bySup = new Map<string, number>();
for (const r of jun.rows) bySup.set(r.supervisor_id ?? "—", (bySup.get(r.supervisor_id ?? "—") ?? 0) + r.production_value);
ok(bySup.get("S1") === 1500, `S1 (P1+P2) = 1500 (got ${bySup.get("S1")})`);
ok(bySup.get("S2") === 300, `S2 (P3) = 300 (got ${bySup.get("S2")})`);
const somaSup = Array.from(bySup.values()).reduce((s, v) => s + v, 0);
ok(somaSup === jun.totals.production_value, `Σ supervisores (${somaSup}) == total (${jun.totals.production_value})`);

console.log("\n(projeção passada) maio já encerrado -> projeção == acumulado");
const mai = build(2026, 5);
ok(mai.totals.production_value === 1000, `total maio = 1000 (got ${mai.totals.production_value})`);
ok(mai.period_projection.production_value === mai.totals.production_value,
  `projeção maio (${mai.period_projection.production_value}) == acumulado (${mai.totals.production_value}) [mês completo]`);
ok(mai.rows.every((r) => r.projection_value === r.production_value),
  "cada promotor: projeção == produção no mês encerrado");

console.log("\n(projeção aberta) junho corrente -> projeção >= acumulado (extrapola)");
ok(jun.period_projection.production_value >= jun.totals.production_value,
  `projeção time junho (${round(jun.period_projection.production_value)}) >= acumulado (${jun.totals.production_value})`);
ok(jun.rows.every((r) => r.projection_value >= r.production_value),
  "cada promotor: projeção >= produção no mês aberto");
ok(jun.period_projection.production_value > jun.totals.production_value,
  `projeção junho estritamente > acumulado (ritmo parcial): ${round(jun.period_projection.production_value)} > 1800`);

console.log(fails === 0 ? "\n✅ TODOS OS TESTES PASSARAM\n" : `\n❌ ${fails} TESTE(S) FALHARAM\n`);
process.exit(fails === 0 ? 0 : 1);
