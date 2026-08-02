/* ============================================================================
 * mov3_equipe_gate — MOV 3: /equipe converge para o PMR em mes fechado.
 * Somente leitura. NAO grava.
 *
 * Rodar:  TRP_SOURCE=db node scripts/mov3_equipe_gate.cjs
 *
 * O /equipe era o ULTIMO leitor fora do consenso do Mov 2: em mes FECHADO ele
 * recomputava do diario (vw_team_production) em vez de derivar do PMR. Diario e
 * fechamento sao universos DIFERENTES — o diario e o que o promotor lancou, o
 * fechamento e o que o banco PAGOU. A tela mostrava producao nao paga.
 *
 * O gate roda assembleTeamProduction (a funcao PURA) com as MESMAS entradas nos
 * dois modos. A view e RLS por auth.uid(), entao aqui ela e reproduzida a partir da
 * tabela crua via service_role — para SOCIO o time e todo mundo, que e o escopo
 * maximo e o pior caso.
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { assembleTeamProduction } = require("../lib/equipe/teamProduction.ts");
const { detectMonthRegime } = require("../lib/cmsMonthly.ts");
const { ymKey } = require("../lib/historicoMensal.ts");
const { todayInFortaleza } = require("../lib/dateFortaleza.ts");
const crypto = require("crypto");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const brl = (n) => "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => { s = String(s ?? ""); return s.length >= n ? s : s + " ".repeat(n - s.length); };
const num = (v) => Number(v || 0);

async function pageAll(tabela, cols) {
  let from = 0, all = [];
  for (;;) {
    const { data, error } = await sb.from(tabela).select(cols).range(from, from + 999);
    if (error) throw error;
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

(async () => {
  let falhas = 0;

  // ---- entradas (as mesmas nos dois modos) ----
  const rows = await pageAll(
    "daily_production_records",
    "id, assigned_promoter_id, promoter_id, status, is_srcc_restricted, movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value, has_insurance"
  );
  const targets = await pageAll("monthly_targets", "promoter_id, year, month, meta, meta_1, meta_2");
  const proms = await pageAll("promoters", "id, name");
  const nameById = new Map(proms.map((p) => [p.id, p.name]));
  const supById = new Map();

  // PMR: mesma query do buildTeamProduction, SOMANDO por (promotor, ym) — RR + ADS.
  const pmr = await pageAll("promoter_monthly_results", "promoter_id, year, month, production_value, insurance_penetration_percent");
  const pmrByPromoterYm = new Map();
  const penNum = new Map(), penDen = new Map();
  for (const p of pmr) {
    const k = ymKey(p.year, p.month);
    let inner = pmrByPromoterYm.get(p.promoter_id);
    if (!inner) { inner = new Map(); pmrByPromoterYm.set(p.promoter_id, inner); }
    const prod = num(p.production_value);
    const pen = p.insurance_penetration_percent == null ? null : num(p.insurance_penetration_percent) / 100;
    const agg = k + "|" + p.promoter_id;
    if (pen != null) penNum.set(agg, (penNum.get(agg) ?? 0) + pen * prod);
    penDen.set(agg, (penDen.get(agg) ?? 0) + prod);
    const prev = inner.get(k);
    const den = penDen.get(agg) ?? 0;
    inner.set(k, {
      production: (prev?.production ?? 0) + prod,
      penetracao: den > 0 ? (penNum.get(agg) ?? 0) / den : prev?.penetracao ?? pen,
    });
  }

  const refDate = todayInFortaleza();
  const monta = (y, m, regime) =>
    assembleTeamProduction(rows, targets, nameById, supById, { year: y, month: m }, refDate, [], pmrByPromoterYm, regime);
  const hash = (p) =>
    crypto.createHash("sha256").update(JSON.stringify(
      (p.rows || []).map((r) => [r.promoter_id, Math.round(r.production_value * 100), Math.round(r.insurance_penetration_percent * 100)]).sort()
    )).digest("hex").slice(0, 12);

  // ---- 1. antes vs depois, por competencia ----
  console.log("=".repeat(96));
  console.log("1) PRODUCAO DO /equipe — ANTES (sempre diario) vs DEPOIS (PMR em mes fechado)");
  console.log("=".repeat(96));
  console.log("  " + pad("COMP", 9) + pad("regime", 13) + pad("ANTES (diario)", 20) + pad("DEPOIS", 20) + "veredito");
  for (const m of [1, 2, 3, 4, 5, 6, 7]) {
    const regime = await detectMonthRegime(sb, 2026, m);
    const antes = monta(2026, m, "open");       // comportamento antigo: sempre diario
    const depois = monta(2026, m, regime);      // novo: regime decide
    const a = num(antes.totals?.production_value);
    const d = num(depois.totals?.production_value);
    const mudou = Math.abs(a - d) > 0.005;
    let ok, veredito;
    if (regime === "open") { ok = !mudou; veredito = ok ? "NO-OP (aberto, segue no diario)" : "!! MUDOU (deveria ser NO-OP)"; }
    else { ok = true; veredito = mudou ? `CONSERTO (${brl(d - a)})` : "coincide (diario ja batia)"; }
    if (!ok) falhas++;
    console.log("  " + pad(`2026-${String(m).padStart(2, "0")}`, 9) + pad(regime, 13) + pad(brl(a), 20) + pad(brl(d), 20) + veredito);
  }

  // ---- 2. julho: hash identico ----
  console.log("\n" + "=".repeat(96));
  console.log("2) JULHO (open) — NO-OP: hash das linhas identico");
  console.log("=".repeat(96));
  const jul = await detectMonthRegime(sb, 2026, 7);
  const hAntes = hash(monta(2026, 7, "open"));
  const hDepois = hash(monta(2026, 7, jul));
  console.log(`  regime=${jul}   hash ANTES=${hAntes}   hash DEPOIS=${hDepois}   ${hAntes === hDepois ? "OK" : "!! DIVERGE"}`);
  if (hAntes !== hDepois) falhas++;

  // ---- 3. abril e junho: bate com as outras telas? ----
  console.log("\n" + "=".repeat(96));
  console.log("3) ABRIL e JUNHO — /equipe vs o PMR fechado (o que as outras 3 telas leem)");
  console.log("=".repeat(96));
  for (const m of [4, 6]) {
    const regime = await detectMonthRegime(sb, 2026, m);
    const d = monta(2026, m, regime);
    const { data: led } = await sb.from("promoter_monthly_results")
      .select("production_value").eq("year", 2026).eq("month", m).in("source", ["fechamento", "bbts"]);
    const ledger = led.reduce((s, r) => s + num(r.production_value), 0);
    const equipe = num(d.totals?.production_value);
    const bate = Math.abs(equipe - ledger) < 0.02;
    if (!bate) falhas++;
    console.log(`  2026-${String(m).padStart(2, "0")}  /equipe ${pad(brl(equipe), 18)} PMR fechado ${pad(brl(ledger), 18)} ${bate ? "OK — as 4 telas concordam" : "!! DIVERGE"}`);
  }

  // A SECAO 4 FOI APOSENTADA EM 01/08/2026.
  //
  // Ela media que a proposta 213615547 (R$ 80.000,00) — SRCC no fechamento mas
  // is_srcc_restricted=false no diario — saia do /equipe quando o mes fechado
  // passou a derivar do PMR. Provou o MOV 3 no dia em que ele entrou.
  //
  // O dado foi corrigido: is_srcc_restricted da 213615547 e `true` hoje, entao
  // diario e fechamento concordam, o delta virou 0 e a assercao passou a acusar
  // SUCESSO como falha (esperava -80.000,00 e obtinha 0,00).
  //
  // NAO foi reancorada porque a SECAO 3 ja garante o que importa, e melhor:
  // /equipe == PMR fechado, vivo contra vivo, sobre TODA a competencia em vez de
  // um contrato. Reancorar aqui seria manter um caso particular mais fraco que a
  // regra geral que ja existe duas secoes acima.
  //
  // `depoisJun` continua sendo montado abaixo porque a secao 5 depende dele.
  const regJun = await detectMonthRegime(sb, 2026, 6);
  const depoisJun = monta(2026, 6, regJun);

  // ---- 5. mascaramento ----
  console.log("\n" + "=".repeat(96));
  console.log("5) MASCARAMENTO — o gestor NAO pode ver comissao");
  console.log("=".repeat(96));
  const campos = new Set();
  for (const r of depoisJun.rows || []) Object.keys(r).forEach((k) => campos.add(k));
  const proibidos = [...campos].filter((k) => /commission|comissao|discount|payable|final_/i.test(k));
  console.log(`  campos das linhas: ${[...campos].join(", ")}`);
  console.log(`  campos de COMISSAO expostos: ${proibidos.length ? "!! " + proibidos.join(", ") : "NENHUM"}`);
  if (proibidos.length) falhas++;

  console.log("\n" + "=".repeat(96));
  console.log(falhas === 0 ? "GATE /equipe: PASSOU" : `GATE /equipe: ${falhas} FALHA(S)`);
  console.log("=".repeat(96));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
