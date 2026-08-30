/* ============================================================================
 * mov1_ledger_gate — MOVIMENTO 1 (ledger): gate de nao-regressao.
 * TUDO dryRun / leitura. NAO grava, NAO apaga, NAO reimporta.
 *
 * Rodar:
 *   TRP_SOURCE=db node scripts/mov1_ledger_gate.cjs
 *
 * O QUE ELE PROVA
 *   1. NO-OP DE CODIGO: reconsolidarCompetenciaFechada usa consolidateMonthlyGroup
 *      sem tocar no calculo. O hash das rows tem que bater com o de main.
 *      (rode com `git stash` para comparar — documentado no PR.)
 *   2. RECONCILIACAO: em junho, as 15 linhas source='daily' somem e as 50
 *      fechadas sobrevivem. Idempotente: 2 rodadas = mesmo conjunto.
 *   3. ABRIL: hoje e regime 'fechamento' com PMR 100% source='daily' (fossil do
 *      mes aberto). O gate mostra que reconsolidar PRODUZ PMR fechado real.
 *      NAO grava — abril e backfill manual pos-merge (/api/pmr/reconsolidar).
 *   4. JULHO: regime 'open' -> NO-OP mesmo com dryRun=false.
 *   5. HISTORICO cms (jan/fev/mar/mai): a guarda de regime RECUSA. O seed do
 *      financeiro nao e recalculado nem apagado.
 *
 * SOBRE A PARIDADE DE JUNHO (leia antes de interpretar a saida)
 *   O PMR fechado de junho que esta no banco foi gravado por SCRIPT, num estado
 *   ANTIGO do dado da ADS (soma de seguro bbts = 44,83). Desde entao o universo
 *   ADS de junho mudou (ex.: a proposta 213983877, movement_date 30/06, cai na
 *   competencia JULHO por getProductionPeriodFromValue e saiu de junho). Logo o
 *   payload de HOJE nao e deep-equal ao PMR gravado — e NAO deveria ser: o
 *   ledger esta congelado no ultimo script que alguem rodou na mao. Isso e
 *   exatamente a fratura que o Movimento 1 fecha.
 *   O criterio de no-op correto e o (1): o codigo desta frente nao muda o
 *   calculo. As divergencias vs o banco sao DEFASAGEM DE DADO, e o Diego as
 *   absorve rodando "reconsolidar junho" 1x pos-merge (Etapa 2).
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";
require("./_ts_register.cjs");
const { resolverCompetenciaAberta } = require("./_competenciaAberta.cjs");
const { createClient } = require("@supabase/supabase-js");
const { reconsolidarCompetenciaFechada } = require("../lib/reconsolidarCompetencia.ts");
const { consolidateMonthlyGroup } = require("../lib/bbtsOrchestrator.ts");
const crypto = require("crypto");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => { s = String(s ?? ""); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); };
const K = (p, c) => `${p}|${c ?? "NULL"}`;

(async () => {
  let falhas = 0;

  // ---- 1. NO-OP DE CODIGO (hash das rows do orquestrador) ----
  console.log("=".repeat(88));
  console.log("1) NO-OP DE CODIGO — hash das rows do consolidateMonthlyGroup (jun/2026)");
  console.log("=".repeat(88));
  const g = await consolidateMonthlyGroup(sb, { year: 2026, month: 6, dryRun: true });
  const norm = g.rows
    .map((r) => [r.promoter_id, Math.round(r.prod_total * 100), Math.round(r.repasse_credito_rr * 100),
      Math.round(r.repasse_credito_ads * 100), Math.round(r.repasse_seguro_rr * 100), Math.round(r.repasse_seguro_ads * 100), r.status_meta].join(":"))
    .sort();
  const hash = crypto.createHash("sha256").update(JSON.stringify(norm)).digest("hex").slice(0, 16);
  const tot = (k) => g.rows.reduce((s, x) => s + (x[k] || 0), 0);
  console.log(`   HASH_ROWS = ${hash}   (tem que ser IGUAL em main — rode com git stash)`);
  console.log(`   repasse_credito_rr=${brl(tot("repasse_credito_rr"))}  repasse_credito_ads=${brl(tot("repasse_credito_ads"))}  ` +
    `repasse_seguro_rr=${brl(tot("repasse_seguro_rr"))}  repasse_seguro_ads=${brl(tot("repasse_seguro_ads"))}`);

  // ---- 2. RECONCILIACAO (junho) ----
  console.log("\n" + "=".repeat(88));
  console.log("2) RECONCILIACAO (jun/2026, dryRun)");
  console.log("=".repeat(88));
  const jun = await reconsolidarCompetenciaFechada(sb, { year: 2026, month: 6, dryRun: true });
  const { data: pmrJun } = await sb.from("promoter_monthly_results").select("source").eq("year", 2026).eq("month", 6);
  const nDaily = pmrJun.filter((r) => r.source === "daily").length;
  const nFech = pmrJun.filter((r) => r.source === "fechamento" || r.source === "bbts").length;
  const rec = jun.reconciliacao;
  console.log(`   PMR hoje: ${nFech} fechadas + ${nDaily} daily`);
  console.log(`   payload novo: ${jun.payload.length} linhas fechadas`);
  console.log(`   apagadas_daily=${rec.apagadas_daily}  sobrescritas_daily=${rec.sobrescritas_daily}  ` +
    `apagadas_orfaos=${rec.apagadas_orfaos}  preservadas_cms=${rec.preservadas_cms}`);
  const okRec = rec.apagadas_daily + rec.sobrescritas_daily === nDaily && rec.preservadas_cms === 0;
  console.log(`   -> as ${nDaily} daily somem; as fechadas viram o conjunto novo: ${okRec ? "OK" : "FALHOU"}`);
  if (!okRec) falhas++;

  const jun2 = await reconsolidarCompetenciaFechada(sb, { year: 2026, month: 6, dryRun: true });
  const idem = JSON.stringify(jun.payload.map((r) => K(r.promoter_id, r.company_id)).sort()) ===
    JSON.stringify(jun2.payload.map((r) => K(r.promoter_id, r.company_id)).sort());
  console.log(`   IDEMPOTENCIA (2 rodadas = mesmo conjunto): ${idem ? "OK" : "FALHOU"}`);
  if (!idem) falhas++;

  // ---- 2b. DEFASAGEM do PMR gravado (diagnostico, nao e falha) ----
  const { data: pmrFull } = await sb.from("promoter_monthly_results").select("*").eq("year", 2026).eq("month", 6);
  const banco = new Map(pmrFull.filter((r) => r.source !== "daily").map((r) => [K(r.promoter_id, r.company_id), r]));
  const novo = new Map(jun.payload.map((r) => [K(r.promoter_id, r.company_id), r]));
  const difs = [];
  for (const [k, n] of novo) {
    const v = banco.get(k);
    if (!v) continue;
    for (const c of ["production_value", "proposal_count", "production_commission_value",
      "insurance_commission_value", "final_commission_value", "target_status"]) {
      const a = typeof n[c] === "number" ? Math.round(n[c] * 100) : n[c];
      const b = typeof n[c] === "number" ? Math.round(Number(v[c]) * 100) : v[c];
      if (String(a) !== String(b)) difs.push({ k, c, banco: v[c], novo: n[c] });
    }
  }
  console.log(`\n   DEFASAGEM do PMR gravado vs o calculo de hoje: ${difs.length} campo(s).`);
  console.log(`   (NAO e regressao — o ledger esta congelado no ultimo script manual. Etapa 2 absorve.)`);
  for (const d of difs) console.log(`      ${pad(d.c, 28)} banco=${pad(d.banco, 12)} hoje=${d.novo}`);

  // ---- 3. ABRIL (o buraco) ----
  console.log("\n" + "=".repeat(88));
  console.log("3) ABRIL/2026 — regime 'fechamento' com PMR fossil source='daily'");
  console.log("=".repeat(88));
  const abr = await reconsolidarCompetenciaFechada(sb, { year: 2026, month: 4, dryRun: true });
  const { data: pmrAbr } = await sb.from("promoter_monthly_results").select("source").eq("year", 2026).eq("month", 4);
  const cA = new Map(); for (const r of pmrAbr) cA.set(r.source, (cA.get(r.source) || 0) + 1);
  console.log(`   PMR de abril HOJE: ${[...cA.entries()].map(([k, v]) => k + "=" + v).join(" ")}`);
  console.log(`   regime=${abr.regime}  ran=${abr.ran}  promotores=${abr.promotores}  PMR fechado gerado: ${abr.payload?.length ?? 0} linhas`);
  if (abr.payload?.length) {
    console.log(`   producao=${brl(abr.payload.reduce((s, r) => s + Number(r.production_value || 0), 0))}  ` +
      `comissao_final=${brl(abr.payload.reduce((s, r) => s + Number(r.final_commission_value || 0), 0))}`);
    console.log(`   reconciliacao: apagaria ${abr.reconciliacao.apagadas_daily} daily fosseis`);
  }
  const okAbr = abr.ran && (abr.payload?.length ?? 0) > 0;
  console.log(`   -> abril produz PMR fechado real (backfill manual pos-merge): ${okAbr ? "OK" : "FALHOU"}`);
  if (!okAbr) falhas++;

  // ---- 4. MES ABERTO — no-op ----
  // A competencia sai do RUN, nao de literal. Era `2026, 7`: julho estava aberto
  // quando o portao foi escrito e FECHOU. Com julho fechado o PMR dele ganhou
  // linhas 'fechamento'/'bbts' — CORRETAS — e o portao acusava "julho nao esta
  // intacto", ou seja, media o fechamento de julho em vez do no-op do mes aberto.
  // Ver scripts/_competenciaAberta.cjs: seis portoes caiam por esta mesma causa.
  const ab = await resolverCompetenciaAberta(sb);
  console.log("\n" + "=".repeat(88));
  console.log(`4) MES ABERTO (${ab.comp}, resolvido no run) — regime 'open': NO-OP mesmo com dryRun=false`);
  console.log("=".repeat(88));
  for (const dry of [true, false]) {
    const j = await reconsolidarCompetenciaFechada(sb, { year: ab.year, month: ab.month, dryRun: dry });
    console.log(`   dryRun=${pad(dry, 6)} regime=${j.regime}  ran=${j.ran}  gravadas=${j.gravadas ?? 0}`);
    if (j.ran) falhas++;
  }
  const { data: pmrAb } = await sb.from("promoter_monthly_results").select("source").eq("year", ab.year).eq("month", ab.month);
  // ATENCAO ao caso VAZIO: mes aberto sem NENHUMA linha de PMR faz `every` devolver
  // true e o portao passar sem ter olhado nada. O tamanho do universo e impresso
  // para que a vacuidade fique visivel.
  const naoDaily = (pmrAb || []).filter((r) => r.source !== "daily");
  const okAb = naoDaily.length === 0;
  console.log(`   PMR de ${ab.comp} intacto (${(pmrAb || []).length} linha(s); nenhuma fechamento/bbts criada): ${okAb ? "OK" : `FALHOU — ${naoDaily.length} linha(s) nao-daily`}`);
  if (!okAb) falhas++;

  // ---- 5. HISTORICO cms ----
  console.log("\n" + "=".repeat(88));
  console.log("5) HISTORICO cms (jan/fev/mar/mai) — a guarda tem que RECUSAR (dryRun=false)");
  console.log("=".repeat(88));
  for (const m of [1, 2, 3, 5]) {
    const r = await reconsolidarCompetenciaFechada(sb, { year: 2026, month: m, dryRun: false });
    console.log(`   2026-0${m}  regime=${pad(r.regime, 11)} ran=${r.ran}  -> ${r.ran ? "!! TOCOU O HISTORICO" : "recusou (intacto)"}`);
    if (r.ran) falhas++;
  }
  const { data: pmrCms } = await sb.from("promoter_monthly_results").select("source").in("month", [1, 2, 3, 5]).eq("year", 2026);
  const okCms = pmrCms.every((r) => r.source === "cms");
  console.log(`   ${pmrCms.length} linhas source='cms' preservadas: ${okCms ? "OK" : "FALHOU"}`);
  if (!okCms) falhas++;

  console.log("\n" + "=".repeat(88));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log("=".repeat(88));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
