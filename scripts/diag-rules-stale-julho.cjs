#!/usr/bin/env node
/*
 * scripts/diag-rules-stale-julho.cjs — POR QUE 2026-07 virou STALE. READ-ONLY.
 *
 * A PERGUNTA: e a mesma classe do caso de agosto (baseline gravado, e DEPOIS o
 * diario da ADS recebeu linha nova no balde daquele mes), ou e outra coisa?
 *
 * O QUE JA SE SABE SEM CONSULTAR NADA, so pela tabela de baselines:
 *   2026-04  baseline 2026-08-25T18:57:29  OK
 *   2026-06  baseline 2026-08-27T21:28:51  OK
 *   2026-07  baseline 2026-08-30T00:34:32  STALE
 *   2026-08  baseline 2026-09-02T21:09:44  OK
 * Abril e junho tem baseline MAIS ANTIGO que julho e continuam OK. Logo o que
 * mudou NAO pode ser um insumo global — se `companies` (grupo RR) ou uma regua
 * de promotor comum tivesse mudado depois de 25/08, abril e junho teriam caido
 * junto. O culpado esta num insumo RECORTADO POR JULHO, ou num promotor que so
 * existe no PMR de julho.
 *
 * Os 8 sub-hashes de compute_rules_fingerprint (migration 20260715_000001) e o
 * recorte de cada um:
 *   1 d_profile    promoter_share_profile   por PROMOTOR do PMR da competencia
 *   2 d_goal       promoter_goal_repasse    por PROMOTOR + competencia = julho
 *   3 d_targets    monthly_targets          por PROMOTOR + year/month = julho
 *   4 d_jkeys      j_keys                   por PROMOTOR do PMR
 *   5 d_companies  companies group_name='Grupo RR'   GLOBAL
 *   6 d_src_cash   monthly_closing_entries CASH de julho     (inclui max(created_at))
 *   7 d_src_ins    monthly_closing_entries INSURANCE 'A Vista ' de julho  (idem)
 *   8 d_src_ads    daily_production_records BBTS no balde de julho        (idem)
 *
 * `pmr_prom` (o conjunto de promotores do PMR daquela competencia) e o escopo de
 * 1-4: se o PMR de julho ganhou ou perdeu promotor DEPOIS do baseline, quatro
 * sub-hashes mudam de uma vez sem que regua nenhuma tenha sido editada.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

const BBTS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const BASELINE_JUL = "2026-08-30T00:34:32";
const BASELINE_AGO = "2026-09-02T21:09:44";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function todas(sb, t, sel, mod) {
  let out = [], from = 0;
  for (;;) {
    let q = sb.from(t).select(sel);
    if (mod) q = mod(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) return { erro: `${error.code || ""} ${error.message}`.trim(), data: [] };
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return { data: out };
}

/** Colunas de tempo REAIS da tabela (varias aqui nao tem, e mentir seria pior). */
async function colunasDeTempo(sb, tabela) {
  const { data } = await sb.from(tabela).select("*").limit(1);
  if (!data || !data[0]) return [];
  return ["created_at", "updated_at", "atualizado_em", "criado_em", "calculated_at", "computed_at"]
    .filter((c) => Object.keys(data[0]).indexOf(c) >= 0);
}

async function ultimoCarimbo(sb, tabela, mod) {
  const cols = await colunasDeTempo(sb, tabela);
  if (!cols.length) return { cols: [], texto: "(tabela SEM coluna de tempo — mudanca aqui e invisivel por data)" };
  const out = [];
  for (const c of cols) {
    let q = sb.from(tabela).select(c);
    if (mod) q = mod(q);
    const { data } = await q.order(c, { ascending: false }).limit(1);
    out.push(`${c}=${data && data[0] ? String(data[0][c]).slice(0, 19) : "?"}`);
  }
  return { cols, texto: out.join("  ") };
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  console.log("\n############ estado dos baselines ############");
  const { data: det } = await sb.rpc("detect_rules_stale");
  const { data: fps } = await sb.from("pmr_rules_fingerprint").select("year,month,computed_at").order("year").order("month");
  const fpDe = new Map((fps || []).map((r) => [`${r.year}-${String(r.month).padStart(2, "0")}`, r.computed_at]));
  for (const r of det || []) {
    const k = `${r.year}-${String(r.month).padStart(2, "0")}`;
    console.log(`  ${k}  ${String(r.state).padEnd(13)} baseline ${String(fpDe.get(k)).slice(0, 19)}`);
  }
  console.log("\n  DEDUCAO SEM CONSULTA: abril (baseline 25/08) e junho (27/08) sao MAIS ANTIGOS");
  console.log("  que julho (30/08) e continuam OK. Insumo GLOBAL alterado depois de 25/08 teria");
  console.log("  derrubado os tres. Logo o culpado e recortado por JULHO, ou por um promotor");
  console.log("  que so aparece no PMR de julho.");

  // ---------------------------------------------------------------- 8 insumos
  console.log("\n############ os 8 insumos, e o que mudou depois de " + BASELINE_JUL + " ############");

  // 8. d_src_ads — a classe do caso de agosto
  console.log("\n  [8] d_src_ads — daily da ADS no balde de JULHO (a classe do caso de agosto)");
  const dpr = await todas(sb, "daily_production_records",
    "id,created_at,movement_date,contract_date,proposal_date", (q) => q.eq("company_id", BBTS));
  if (dpr.erro) console.log("      ERRO: " + dpr.erro);
  else {
    const bucket = (r) => String(r.movement_date || r.contract_date || r.proposal_date || "").slice(0, 7);
    const jul = dpr.data.filter((r) => bucket(r) === "2026-07");
    const maxJul = jul.reduce((m, r) => (String(r.created_at) > m ? String(r.created_at) : m), "");
    const posBaseline = jul.filter((r) => String(r.created_at) > BASELINE_JUL);
    console.log(`      linhas no balde 2026-07: ${jul.length}   max(created_at)=${maxJul.slice(0, 19)}`);
    console.log(`      criadas DEPOIS do baseline: ${posBaseline.length}`);
    console.log(`      >>> ${posBaseline.length > 0 ? "EXPLICA (mesma classe de agosto)" : "NAO explica — classe DIFERENTE da de agosto"}`);
  }

  // 6/7. d_src_cash e d_src_ins — entries de julho
  console.log("\n  [6][7] d_src_cash / d_src_ins — monthly_closing_entries de JULHO");
  for (const [nome, filtro] of [
    ["CASH", (q) => q.eq("year", 2026).eq("month", 7).eq("entry_type", "CASH")],
    ["INSURANCE 'A Vista '", (q) => q.eq("year", 2026).eq("month", 7).eq("entry_type", "INSURANCE").eq("sheet_name", "A Vista ")],
  ]) {
    const { count } = await filtro(sb.from("monthly_closing_entries").select("*", { count: "exact", head: true }));
    const u = await ultimoCarimbo(sb, "monthly_closing_entries", filtro);
    const { data: pos } = await filtro(sb.from("monthly_closing_entries").select("id")).gt("created_at", BASELINE_JUL).limit(5);
    console.log(`      ${nome.padEnd(22)} linhas=${String(count).padStart(6)}  ${u.texto}`);
    console.log(`      ${"".padEnd(22)} criadas depois do baseline: ${(pos || []).length}`);
  }

  // pmr_prom — o ESCOPO de 1..4
  console.log("\n  [escopo 1-4] pmr_prom — o PMR de JULHO mudou depois do baseline?");
  const pmrJul = await todas(sb, "promoter_monthly_results",
    "promoter_id,company_id,source,created_at,calculated_at", (q) => q.eq("year", 2026).eq("month", 7));
  if (pmrJul.erro) console.log("      ERRO: " + pmrJul.erro);
  else {
    const calcs = [...new Set(pmrJul.data.map((r) => String(r.calculated_at).slice(0, 19)))].sort();
    const proms = new Set(pmrJul.data.map((r) => r.promoter_id));
    const depois = pmrJul.data.filter((r) => String(r.calculated_at) > BASELINE_JUL);
    console.log(`      linhas=${pmrJul.data.length}  promotores distintos=${proms.size}`);
    console.log(`      calculated_at distintos: ${calcs.join(" | ")}`);
    console.log(`      linhas recalculadas DEPOIS do baseline: ${depois.length}`);
    console.log(`      >>> ${depois.length > 0 ? "o escopo pode ter mudado — 4 sub-hashes de uma vez" : "PMR de julho intacto desde o baseline; o escopo NAO mudou"}`);
  }

  // 1..5 — as reguas
  console.log("\n  [1-5] as reguas: existe carimbo de tempo utilizavel?");
  for (const t of ["promoter_share_profile", "promoter_goal_repasse", "monthly_targets", "j_keys", "companies"]) {
    const u = await ultimoCarimbo(sb, t);
    const { count } = await sb.from(t).select("*", { count: "exact", head: true });
    console.log(`      ${t.padEnd(24)} linhas=${String(count).padStart(5)}  ${u.texto}`);
    for (const c of u.cols) {
      const { data: pos } = await sb.from(t).select("id").gt(c, BASELINE_JUL).limit(50);
      if ((pos || []).length) console.log(`         ${(pos || []).length}+ linha(s) com ${c} > baseline de julho`);
    }
  }

  // controle: o mesmo para AGOSTO, cujo caso ja e conhecido
  console.log("\n############ controle — o caso de AGOSTO, ja diagnosticado ############");
  if (!dpr.erro) {
    const bucket = (r) => String(r.movement_date || r.contract_date || r.proposal_date || "").slice(0, 7);
    const ago = dpr.data.filter((r) => bucket(r) === "2026-08");
    const maxAgo = ago.reduce((m, r) => (String(r.created_at) > m ? String(r.created_at) : m), "");
    console.log(`  balde 2026-08: ${ago.length} linhas, max(created_at)=${maxAgo.slice(0, 19)}, baseline ${BASELINE_AGO}`);
    console.log(`  (em agosto o baseline foi reescrito DEPOIS do ultimo daily, por isso esta OK agora)`);
  }

  console.log("\n=== fim (nada foi gravado) ===");
}

main().catch((e) => { console.error("ERRO:", e.message); process.exitCode = 1; });
