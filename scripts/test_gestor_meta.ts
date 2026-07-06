// ============================================================
// TESTE — META DO GESTOR (Entrega 2). Helpers puros:
//   resolveGestorMeta: sem override -> efetiva == derivada (NÃO-REGRESSÃO);
//                      com override -> efetiva == override; mês diferente ignora.
//   buildGestorMetaEditor: deriva por supervisor (Σ promotores) e por gerente
//                      (Σ supervisores) e anexa o override.
//
//   npx tsc -p .tmp-test/tsconfig.json && node -r ./.tmp-test/alias.cjs .tmp-test/scripts/test_gestor_meta.js
// ============================================================

import { resolveGestorMeta } from "../lib/equipe/teamProduction";
import { buildGestorMetaEditor } from "../lib/equipe/gestorMeta";
import type { EquipesModel } from "../lib/equipes/model";

let fails = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FALHOU:"} ${msg}`);
  if (!cond) fails++;
}

console.log("\n(resolveGestorMeta) sem override == derivada (não-regressão)");
const r0 = resolveGestorMeta(1500, [], 2026, 7);
ok(r0.efetiva === 1500 && r0.override === null && r0.derivada === 1500, `sem override: efetiva=derivada=1500, override=null (got ${JSON.stringify(r0)})`);

console.log("\n(resolveGestorMeta) com override usa o override");
const r1 = resolveGestorMeta(1500, [{ year: 2026, month: 7, meta: 2000 }], 2026, 7);
ok(r1.override === 2000 && r1.efetiva === 2000, `override 2000 -> efetiva 2000 (got ${JSON.stringify(r1)})`);

console.log("\n(resolveGestorMeta) override de outro mês é ignorado");
const r2 = resolveGestorMeta(1500, [{ year: 2026, month: 6, meta: 9 }], 2026, 7);
ok(r2.override === null && r2.efetiva === 1500, `mês diferente -> override null, efetiva 1500 (got ${JSON.stringify(r2)})`);

console.log("\n(buildGestorMetaEditor) derivação por supervisor e gerente + override");
const model: EquipesModel = {
  gerentes: [{ id: "G1", full_name: "Gerente 1", email: "g1@rr", role: "gerente_regional", manager_user_id: null, active: true }],
  supervisores: [
    { id: "S1", full_name: "Sup 1", email: "s1@rr", role: "supervisor", manager_user_id: "G1", active: true },
    { id: "S2", full_name: "Sup 2", email: "s2@rr", role: "supervisor", manager_user_id: null, active: true },
  ],
  promotores: [
    { id: "P1", name: "P1", company_id: null, active: true, supervisor_user_id: "S1" },
    { id: "P2", name: "P2", company_id: null, active: true, supervisor_user_id: "S1" },
    { id: "P3", name: "P3", company_id: null, active: true, supervisor_user_id: "S2" },
  ],
  supervisorOptions: [],
  gerenteOptions: [],
  tree: { gerentes: [], supervisoresSemGerente: [], promotoresSemSupervisor: [] },
};
const metaByPromoter = new Map([["P1", 1000], ["P2", 500], ["P3", 300]]);
const overrideByUser = new Map([["S1", 2000]]);
const editor = buildGestorMetaEditor(model, metaByPromoter, overrideByUser);

const byId = new Map(editor.map((r) => [r.user_id, r]));
ok(byId.get("S1")?.meta_derivada === 1500, `S1 derivada = 1500 (P1+P2) (got ${byId.get("S1")?.meta_derivada})`);
ok(byId.get("S2")?.meta_derivada === 300, `S2 derivada = 300 (P3) (got ${byId.get("S2")?.meta_derivada})`);
ok(byId.get("G1")?.meta_derivada === 1500, `G1 derivada = 1500 (só S1 está sob ele; S2 sem gerente) (got ${byId.get("G1")?.meta_derivada})`);
ok(byId.get("S1")?.meta_override === 2000, `S1 override = 2000 (got ${byId.get("S1")?.meta_override})`);
ok(byId.get("S2")?.meta_override === null, `S2 sem override (got ${byId.get("S2")?.meta_override})`);
ok(byId.get("G1")?.role === "gerente_regional" && byId.get("S1")?.role === "supervisor", "papéis corretos nas linhas");

console.log(fails === 0 ? "\n✅ TODOS OS TESTES PASSARAM\n" : `\n❌ ${fails} TESTE(S) FALHARAM\n`);
process.exit(fails === 0 ? 0 : 1);
