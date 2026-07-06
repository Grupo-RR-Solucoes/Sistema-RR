// ============================================================
// TESTE — sócio como gestor (PARTE B). Monta o read-model a partir de um
// fixture e prova:
//   (golden) Carla (supervisor, manager NULL) aparece na árvore ANTES e DEPOIS
//            — não-regressão do galho "supervisor sem gerente".
//   (1) supervisores puro (linhas do Vínculo 2) NÃO contém sócio.
//   (2) supervisorOptions/gerenteOptions incluem os sócios.
//   (3) sócio-supervisor (Diego, promotor aponta) vira galho de raiz própria.
//   (4) sócio-gerente (Renata, supervisor aponta) vira raiz com o supervisor sob ela.
//   (5) sócio NÃO vinculado (Zed) é OPÇÃO mas NÃO vira galho; gating por direção.
//
// Roda via tsconfig temporário (resolve o alias @/ do import type do model):
//   npx tsc -p .tmp-test/tsconfig.json && node .tmp-test/scripts/test_equipes_socio_gestor.js
// ============================================================

import {
  assembleEquipesModel,
  type GestorLite,
  type PromoterLite,
} from "../lib/equipes/model";

let fails = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FALHOU:"} ${msg}`);
  if (!cond) fails++;
}

const g = (
  id: string,
  role: GestorLite["role"],
  manager_user_id: string | null = null,
): GestorLite => ({ id, full_name: id, email: `${id}@rr`, role, manager_user_id, active: true });

const p = (id: string, supervisor_user_id: string | null): PromoterLite => ({
  id,
  name: id,
  company_id: null,
  active: true,
  supervisor_user_id,
});

// Fixture
const GER = g("G", "gerente_regional");
const CARLA = g("Carla", "supervisor", null); // golden: supervisor SEM gerente
const BOB = g("Bob", "supervisor", "G"); // supervisor com gerente G
const ANA = g("Ana", "supervisor", "Renata"); // supervisor com gerente = SÓCIO
const DIEGO = g("Diego", "socio"); // sócio atuando como supervisor (p3 aponta)
const RENATA = g("Renata", "socio"); // sócio atuando como gerente (Ana aponta)
const ZED = g("Zed", "socio"); // sócio NÃO vinculado a nada

const gestores = [GER, CARLA, BOB, ANA, DIEGO, RENATA, ZED];
const promotores = [
  p("p1", "Bob"),
  p("p2", "Carla"),
  p("p3", "Diego"), // sócio como supervisor
  p("p4", null), // sem supervisor
];

// ---- "ANTES": réplica da montagem antiga (só role='supervisor' vira supNode) ----
function beforeSupervisoresSemGerente() {
  const sup = gestores.filter((x) => x.role === "supervisor");
  const supNodes = sup.map((s) => ({
    ...s,
    promoters: promotores.filter((pr) => pr.supervisor_user_id === s.id),
  }));
  return supNodes.filter((s) => !s.manager_user_id);
}

const m = assembleEquipesModel(gestores, promotores);

console.log("\n(golden) Carla (supervisor, manager NULL) na árvore ANTES e DEPOIS");
const antes = beforeSupervisoresSemGerente();
const carlaAntes = antes.find((s) => s.id === "Carla");
ok(!!carlaAntes, "ANTES: Carla está em supervisoresSemGerente");
ok(!!carlaAntes && carlaAntes.promoters.some((x) => x.id === "p2"), "ANTES: Carla com o promotor p2");
const carlaDepois = m.tree.supervisoresSemGerente.find((s) => s.id === "Carla");
ok(!!carlaDepois, "DEPOIS: Carla continua em supervisoresSemGerente (não sumiu)");
ok(!!carlaDepois && carlaDepois.promoters.some((x) => x.id === "p2"), "DEPOIS: Carla continua com p2");

console.log("\n(1) supervisores PURO (linhas do Vínculo 2) não contém sócio");
ok(m.supervisores.length === 3, "supervisores = 3 (Carla, Bob, Ana)");
ok(!m.supervisores.some((s) => s.role === "socio"), "nenhum sócio nas linhas de supervisor");

console.log("\n(2) pickers incluem os sócios");
const hasId = (arr: GestorLite[], id: string) => arr.some((x) => x.id === id);
ok(hasId(m.supervisorOptions, "Diego") && hasId(m.supervisorOptions, "Renata") && hasId(m.supervisorOptions, "Zed"),
  "supervisorOptions inclui Diego, Renata e Zed (sócios)");
ok(hasId(m.supervisorOptions, "Carla") && hasId(m.supervisorOptions, "Bob"),
  "supervisorOptions mantém supervisores reais");
ok(hasId(m.gerenteOptions, "Diego") && hasId(m.gerenteOptions, "Renata") && hasId(m.gerenteOptions, "Zed"),
  "gerenteOptions inclui Diego, Renata e Zed (sócios)");
ok(hasId(m.gerenteOptions, "G"), "gerenteOptions mantém o gerente real G");

console.log("\n(3) sócio-supervisor (Diego) vira galho de raiz própria");
const diego = m.tree.supervisoresSemGerente.find((s) => s.id === "Diego");
ok(!!diego, "Diego aparece em supervisoresSemGerente (sócio-supervisor, sem manager)");
ok(!!diego && diego.promoters.some((x) => x.id === "p3"), "Diego com o promotor p3");

console.log("\n(4) sócio-gerente (Renata) vira raiz com o supervisor sob ela");
const renata = m.tree.gerentes.find((x) => x.id === "Renata");
ok(!!renata, "Renata aparece como raiz gerente na árvore");
ok(!!renata && renata.supervisores.some((s) => s.id === "Ana"), "Ana está sob Renata");
const gRoot = m.tree.gerentes.find((x) => x.id === "G");
ok(!!gRoot && gRoot.supervisores.some((s) => s.id === "Bob"), "G continua com Bob sob ele");

console.log("\n(5) gating por direção + sócio não-vinculado não vira galho");
ok(!m.tree.gerentes.some((x) => x.id === "Diego"), "Diego (só supervisor) NÃO é raiz gerente");
ok(!m.tree.supervisoresSemGerente.some((s) => s.id === "Renata"), "Renata (só gerente) NÃO é nó supervisor");
const zedEmArvore =
  m.tree.gerentes.some((x) => x.id === "Zed") ||
  m.tree.supervisoresSemGerente.some((s) => s.id === "Zed") ||
  m.tree.gerentes.some((x) => x.supervisores.some((s) => s.id === "Zed"));
ok(!zedEmArvore, "Zed (sócio não vinculado) NÃO aparece em nenhum galho da árvore");

console.log("\n(extra) promotor sem supervisor continua no balde próprio");
ok(m.tree.promotoresSemSupervisor.some((x) => x.id === "p4"), "p4 em promotoresSemSupervisor");

console.log(fails === 0 ? "\n✅ TODOS OS TESTES PASSARAM\n" : `\n❌ ${fails} TESTE(S) FALHARAM\n`);
process.exit(fails === 0 ? 0 : 1);
