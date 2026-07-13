/* ============================================================================
 * mov2_grupoA_gate — MOVIMENTO 2, GRUPO A: gate de NO-OP.
 * Somente leitura. Nao grava nada.
 *
 * Rodar:  TRP_SOURCE=db node scripts/mov2_grupoA_gate.cjs
 *
 * O Grupo A migra 3 consumidores do BOOLEANO (detectClosedMonth) para o ENUM
 * (detectMonthRegime), onde a pergunta e binaria de verdade:
 *   1. debitsData/resolveCompetenciaAberta — 1a competencia ABERTA p/ lancar parcela
 *   2. projecaoMetas                       — mes completo vs mes em curso
 *   3. commissions/proposals PUT+DELETE    — bloqueia edicao (403) em mes fechado
 *
 * Nos TRES, cms e fechamento sao IGUALMENTE "nao aberto". A condicao correta e
 * `regime !== 'open'`. Se alguem escrever `regime === 'fechamento'`, jan-mai (cms)
 * viram "abertos" e o comportamento quebra — este gate pega isso.
 *
 * PROVA: para cada competencia, o booleano antigo (detectClosedMonth) e o novo
 * predicado (regime !== 'open') tem que dar o MESMO valor. Se derem, os 3
 * consumidores sao no-op por construcao — todos consomem so esse booleano.
 * ========================================================================== */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { detectClosedMonth, detectMonthRegime } = require("../lib/cmsMonthly.ts");
const { resolveCompetenciaAberta } = require("../lib/debitsData.ts");
const { buildProjecaoMetas } = require("../lib/projecaoMetas.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const pad = (s, n) => { s = String(s ?? ""); return s.length >= n ? s : s + " ".repeat(n - s.length); };
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  let falhas = 0;

  // ---- 1. O predicado: booleano antigo == (regime !== 'open') ? ----
  console.log("=".repeat(84));
  console.log("1) O PREDICADO — booleano antigo  vs  enum novo (regime !== 'open')");
  console.log("=".repeat(84));
  console.log("  " + pad("COMP", 10) + pad("regime", 13) + pad("detectClosedMonth", 20) + pad("regime!=='open'", 17) + "igual?");
  for (const m of [1, 2, 3, 4, 5, 6, 7]) {
    const regime = await detectMonthRegime(sb, 2026, m);
    const velho = await detectClosedMonth(sb, 2026, m);
    const novo = regime !== "open";
    const ok = velho === novo;
    if (!ok) falhas++;
    console.log("  " + pad(`2026-${String(m).padStart(2, "0")}`, 10) + pad(regime, 13) +
      pad(String(velho), 20) + pad(String(novo), 17) + (ok ? "OK" : "!! DIVERGIU"));
  }
  console.log("\n  ARMADILHA (o erro que quebraria o Mov 2): se alguem usar `regime === 'fechamento'`");
  console.log("  em vez de `!== 'open'`, jan/fev/mar/mai (cms) viram ABERTOS:");
  for (const m of [1, 5]) {
    const regime = await detectMonthRegime(sb, 2026, m);
    console.log(`     2026-0${m}  regime=${pad(regime, 12)} !== 'open' => ${regime !== "open"}   ` +
      `=== 'fechamento' => ${regime === "fechamento"}  <- ERRADO`);
  }

  // ---- 2. debitsData: a competencia ABERTA resolvida ----
  console.log("\n" + "=".repeat(84));
  console.log("2) debitsData/resolveCompetenciaAberta — destino do lancamento de parcela");
  console.log("=".repeat(84));
  for (const [y, m] of [[2026, 4], [2026, 6], [2026, 7]]) {
    const r = await resolveCompetenciaAberta(sb, y, m);
    const destino = `${r.year}-${String(r.month).padStart(2, "0")}`;
    console.log(`  partindo de 2026-${String(m).padStart(2, "0")} -> lanca em ${destino}  (pulou ${r.pulou} mes(es) fechado(s))`);
  }
  console.log("  esperado: abril e junho PULAM (fechados) e caem em julho; julho e o proprio (aberto).");
  const abr = await resolveCompetenciaAberta(sb, 2026, 4);
  const jun = await resolveCompetenciaAberta(sb, 2026, 6);
  const jul = await resolveCompetenciaAberta(sb, 2026, 7);
  const okDeb = abr.month === 7 && jun.month === 7 && jul.month === 7 && jul.pulou === 0;
  console.log(`  -> ${okDeb ? "OK" : "FALHOU"}`);
  if (!okDeb) falhas++;

  // ---- 3. projecaoMetas: fechado/aberto e o numero ----
  console.log("\n" + "=".repeat(84));
  console.log("3) projecaoMetas — flag `fechado` e a producao do grupo");
  console.log("=".repeat(84));
  for (const m of [4, 6, 7]) {
    const p = await buildProjecaoMetas(sb, { year: 2026, month: m });
    const prod = (p.promotores || []).reduce((s, r) => s + Number(r.producao_acumulada || 0), 0);
    console.log(`  2026-${String(m).padStart(2, "0")}  fechado=${pad(p.fechado, 6)} promotores=${pad((p.promotores || []).length, 4)} producao_acumulada=${brl(prod)}`);
  }
  const p4 = await buildProjecaoMetas(sb, { year: 2026, month: 4 });
  const p6 = await buildProjecaoMetas(sb, { year: 2026, month: 6 });
  const p7 = await buildProjecaoMetas(sb, { year: 2026, month: 7 });
  const okProj = p4.fechado === true && p6.fechado === true && p7.fechado === false;
  console.log(`  esperado: abril e junho fechado=true (mes completo); julho fechado=false (em curso)`);
  console.log(`  -> ${okProj ? "OK" : "FALHOU"}`);
  if (!okProj) falhas++;

  // ---- 4. proposals PUT/DELETE: o 403 dispara nos mesmos meses ----
  console.log("\n" + "=".repeat(84));
  console.log("4) proposals PUT/DELETE — o 403 (bloqueio de edicao) dispara em que meses?");
  console.log("=".repeat(84));
  for (const m of [1, 4, 6, 7]) {
    const regime = await detectMonthRegime(sb, 2026, m);
    const bloqueia = regime !== "open";
    const msg = !bloqueia
      ? "(edicao liberada)"
      : regime === "cms"
        ? "Competencia fechada (consolidada via cms, valores finais da Promotiva) — edicao bloqueada."
        : "Competencia fechada (consolidada pelo fechamento) — edicao bloqueada.";
    console.log(`  2026-${String(m).padStart(2, "0")}  regime=${pad(regime, 12)} 403=${pad(bloqueia, 6)} ${msg}`);
  }
  console.log("  esperado: bloqueia em jan(cms), abril e junho(fechamento); libera em julho(open).");
  console.log("  a MENSAGEM agora diz a verdade: 'cms' so para meses cms; 'fechamento' para jun+.");

  console.log("\n" + "=".repeat(84));
  console.log(falhas === 0 ? "GATE GRUPO A: PASSOU (no-op)" : `GATE GRUPO A: ${falhas} FALHA(S)`);
  console.log("=".repeat(84));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
