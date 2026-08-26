/*
 * GATE — a ADS ('bbts') entra em TODO sitio que le o PMR do regime FECHADO.
 *
 * POR QUE ESTE GATE EXISTE. O PMR da ADS e gravado com source='bbts'; o do RR com
 * source='fechamento'. Todo leitor de mes fechado tem de aceitar OS DOIS. Hoje
 * aceita — medido em 26/08/2026, 6 sitios, todos verdes. Mas nada impedia que o
 * proximo leitor nascesse so com 'fechamento', e a ADS sumiria daquela tela EM
 * SILENCIO: sem erro, sem linha faltando, so um numero menor. Foi exatamente essa
 * a suspeita que abriu a frente feat/ads-fechamento-caixa.
 *
 * DOIS LADOS NO MESMO RUN: le os ARQUIVOS REAIS do repo. Nao ha lista congelada de
 * sitios esperados — a parte (B) VARRE lib/ e app/ e reprova qualquer lista de
 * source que cite 'fechamento' sem 'bbts', inclusive arquivo que ainda nao existe.
 *
 * O QUE ESTE GATE NAO VIGIA (separacoes DELIBERADAS, nao tocar):
 *   - `semAds` em app/api/calculate/monthly/route.ts — exclui a ADS da escrita do
 *     motor RR de proposito.
 *   - `detectMonthRegime` ignora a ADS via companies.active=false
 *     (lib/cmsMonthly.ts:54, comentario explicito: "as 4 RR bastam").
 *   - o ramo `cms` dos seletores de regime: jan-mai/2026 le o SEED do financeiro,
 *     e misturar 'bbts' la recalcularia por cima do ground truth
 *     (lib/cmsMonthly.ts:52-54). A ADS tem 1 linha source='cms' no banco, com
 *     producao 0,00.
 *
 * self-contained: sem banco, sem caminho absoluto, sem rede.
 */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
let falhas = 0;
const ok = (nome, fn) => {
  try { fn(); console.log("  OK   " + nome); }
  catch (e) { falhas++; console.log("  FALHA " + nome + "\n         " + e.message); }
};
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

console.log("GATE: a ADS ('bbts') entra em todo leitor do regime FECHADO\n");

// ------------------------------------------------------- (A) sitios conhecidos
console.log("[A] os sitios mapeados aceitam 'bbts'");
const SITIOS = [
  ["lib/promoterAnalytics.ts", /closedSource === "cms" \? \["cms"\] : (\[[^\]]*\])/],
  ["lib/dre.ts", /regimeSel === "cms" \? \["cms"\] : (\[[^\]]*\])/],
  ["app/api/metas/route.ts", /regime === "open" \? \["daily"\] : (\[[^\]]*\])/],
  ["app/api/commissions/proposals/route.ts", /\.in\("source", (\[[^\]]*\])\)/],
  ["lib/closingProposalRows.ts", /\.in\("source", (\[[^\]]*\])\)/],
  ["lib/reconsolidarCompetencia.ts", /SOURCES_RECONCILIAVEIS = new Set\((\[[^\]]*\])\)/],
];
for (const [rel, re] of SITIOS) {
  ok(rel, () => {
    const m = ler(rel).match(re);
    assert.ok(m, "padrao do regime fechado NAO encontrado — o sitio mudou de forma, reveja o gate");
    assert.ok(m[1].includes('"bbts"'), `lista do regime fechado sem 'bbts': ${m[1]}`);
    assert.ok(m[1].includes('"fechamento"'), `lista sem 'fechamento': ${m[1]}`);
  });
}

// O Caixa usa a forma PERMISSIVA (exclui só 'daily'). Estreitar para
// .eq("source","fechamento") tiraria a ADS sem qualquer sintoma.
ok("lib/financialAnalytics.ts usa a forma permissiva .neq(source,'daily')", () => {
  const src = ler("lib/financialAnalytics.ts");
  assert.ok(src.includes('.neq("source", "daily")'), "o Caixa deixou de usar .neq(source,'daily')");
  assert.ok(!/\.eq\("source",\s*"fechamento"\)/.test(src), "o Caixa passou a filtrar SO 'fechamento' — a ADS sumiu do Caixa");
});

// ---------------------------------------------------------- (B) varredura viva
console.log("\n[B] varredura: nenhuma lista de source cita 'fechamento' sem 'bbts'");
function varrer(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === "__tests__") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) varrer(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const arquivos = [...varrer(path.join(ROOT, "lib")), ...varrer(path.join(ROOT, "app"))];
ok(`varreu ${arquivos.length} arquivos`, () => assert.ok(arquivos.length > 100, "varredura pequena demais"));

const suspeitos = [];
for (const abs of arquivos) {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  const src = fs.readFileSync(abs, "utf8");
  const linhas = src.split(/\r?\n/);
  linhas.forEach((ln, i) => {
    if (ln.trimStart().startsWith("//") || ln.trimStart().startsWith("*")) return; // comentario
    // array literal que cita "fechamento"
    for (const m of ln.matchAll(/\[[^\]\n]*"fechamento"[^\]\n]*\]/g)) {
      if (!m[0].includes('"bbts"')) suspeitos.push(`${rel}:${i + 1}  ${m[0]}`);
    }
    // .eq("source","fechamento") — filtro que exclui a ADS por construcao
    if (/\.eq\(\s*"source"\s*,\s*"fechamento"\s*\)/.test(ln)) suspeitos.push(`${rel}:${i + 1}  ${ln.trim()}`);
  });
}
ok("nenhum sitio novo com 'fechamento' sem 'bbts'", () => {
  assert.equal(suspeitos.length, 0, "sitio(s) que excluem a ADS do regime fechado:\n         " + suspeitos.join("\n         "));
});

console.log("\n" + (falhas === 0 ? "GATE VERDE" : "GATE VERMELHO — " + falhas + " falha(s)"));
process.exit(falhas === 0 ? 0 : 1);
