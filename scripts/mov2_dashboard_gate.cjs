/* ============================================================================
 * mov2_dashboard_gate — MOV 2, Grupo B item 1 (Dashboard). Somente leitura.
 *
 * Rodar:  TRP_SOURCE=db node scripts/mov2_dashboard_gate.cjs
 *
 * O dashboard nao era so "fonte errada": ele era PRESO ao mes corrente
 * (GET() sem req, year/month = nowInFortaleza()), entao o ramo de mes fechado
 * NUNCA rodava. Este PR faz as duas metades:
 *   (A) GET(req) le ?year&month  -> o mes fechado passa a ser renderizavel
 *   (B) leitura por REGIME       -> 'fechamento' para de ler cms (0 linhas)
 *
 * O gate NAO chama a rota HTTP (ela exige sessao de socio). Ele reproduz a
 * DECISAO DE FONTE da rota — que e o que o PR muda — e confronta com o PMR
 * fechado que /api/promotores serve (consolidatedSummaryRows: source IN
 * ('fechamento','bbts')). Se as duas telas divergirem, ha bug.
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { detectMonthRegime } = require("../lib/cmsMonthly.ts");
const { buildPromoterAnalytics } = require("../lib/promoterAnalytics.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const brl = (n) => "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (Number(n || 0) * 100).toFixed(2) + "%";
const pad = (s, n) => { s = String(s ?? ""); return s.length >= n ? s : s + " ".repeat(n - s.length); };
const num = (v) => Number(v || 0);

/** A decisao de fonte do dashboard, DEPOIS do PR (o que a rota faz agora). */
async function dashboardDepois(year, month) {
  const regime = await detectMonthRegime(sb, year, month);
  const closedSource = regime === "open" ? undefined : regime;
  const an = await buildPromoterAnalytics(sb, { year, month, closed: regime !== "open", closedSource });
  const rows = an.summaryRows || [];

  let credito = 0;
  if (regime === "cms") {
    const { data } = await sb.from("cms_promoter_entries").select("company_commission").eq("prod_year", year).eq("prod_month", month);
    credito = (data || []).reduce((s, r) => s + num(r.company_commission), 0);
  } else if (regime === "fechamento") {
    const { data } = await sb.from("fechamento_mensal_empresa").select("valor_avista").eq("ano", year).eq("mes", month);
    credito = (data || []).reduce((s, r) => s + num(r.valor_avista), 0);
  } else {
    credito = num(an.summary.companyGrossCommission);
  }

  let pen = 0;
  if (regime === "cms") {
    const { data } = await sb.from("cms_promoter_entries").select("penetration, net_value").eq("prod_year", year).eq("prod_month", month);
    let a = 0, b = 0;
    for (const r of data || []) { const nv = num(r.net_value); a += num(r.penetration) * nv; b += nv; }
    pen = b > 0 ? a / b : 0;
  } else if (regime === "fechamento") {
    let a = 0, b = 0;
    for (const r of rows) { const p = num(r.production_value); a += (num(r.insurance_penetration_percent) / 100) * p; b += p; }
    pen = b > 0 ? a / b : 0;
  }
  return { regime, credito, pen, rows };
}

/** A decisao de fonte ANTES do PR (booleano -> cms em QUALQUER mes fechado). */
async function dashboardAntes(year, month) {
  const regime = await detectMonthRegime(sb, year, month);
  const fechado = regime !== "open";
  if (!fechado) return { credito: null, pen: null }; // ramo aberto: identico
  const { data: e } = await sb.from("cms_promoter_entries").select("company_commission, penetration, net_value").eq("prod_year", year).eq("prod_month", month);
  const credito = (e || []).reduce((s, r) => s + num(r.company_commission), 0);
  let a = 0, b = 0;
  for (const r of e || []) { const nv = num(r.net_value); a += num(r.penetration) * nv; b += nv; }
  return { credito, pen: b > 0 ? a / b : 0 };
}

/** O que /api/promotores serve para a competencia (a fonte-modelo). */
async function promotores(year, month) {
  const regime = await detectMonthRegime(sb, year, month);
  const closedSource = regime === "open" ? undefined : regime;
  const an = await buildPromoterAnalytics(sb, { year, month, closed: regime !== "open", closedSource });
  const rows = an.summaryRows || [];
  return {
    promotores: rows.length,
    producao: rows.reduce((s, r) => s + num(r.production_value), 0),
  };
}

(async () => {
  let falhas = 0;

  console.log("=".repeat(94));
  console.log("B) LEITURA DE FONTE — antes vs depois, por regime");
  console.log("=".repeat(94));
  console.log("  " + pad("COMP", 9) + pad("regime", 13) + pad("credito ANTES", 18) + pad("credito DEPOIS", 18) + "veredito");
  for (const m of [1, 2, 3, 4, 5, 6, 7]) {
    const antes = await dashboardAntes(2026, m);
    const dep = await dashboardDepois(2026, m);
    const aTxt = antes.credito === null ? "(ramo aberto)" : brl(antes.credito);
    const mudou = antes.credito !== null && Math.abs(antes.credito - dep.credito) > 0.005;
    const esperaMudar = dep.regime === "fechamento";
    const ok = mudou === esperaMudar;
    if (!ok) falhas++;
    const veredito = dep.regime === "open"
      ? "NO-OP (aberto, ramo intocado)"
      : dep.regime === "cms"
        ? (mudou ? "!! MUDOU (deveria ser NO-OP)" : "NO-OP (cms inalterado)")
        : (mudou ? "CONSERTO (saiu do cms vazio)" : "!! NAO MUDOU (deveria consertar)");
    console.log("  " + pad(`2026-${String(m).padStart(2, "0")}`, 9) + pad(dep.regime, 13) +
      pad(aTxt, 18) + pad(brl(dep.credito), 18) + veredito);
  }

  console.log("\n" + "=".repeat(94));
  console.log("B) ABRIL e JUNHO — Dashboard  vs  /promotores  (mesma fonte => mesmo numero)");
  console.log("=".repeat(94));
  for (const m of [4, 6]) {
    const d = await dashboardDepois(2026, m);
    const p = await promotores(2026, m);
    const prodDash = d.rows.reduce((s, r) => s + num(r.production_value), 0);
    const okProm = d.rows.length === p.promotores;
    const okProd = Math.abs(prodDash - p.producao) < 0.005;
    if (!okProm || !okProd) falhas++;
    console.log(`  2026-${String(m).padStart(2, "0")} (regime ${d.regime})`);
    console.log(`     ${pad("", 22)}${pad("DASHBOARD", 22)}${pad("/PROMOTORES", 22)}bate?`);
    console.log(`     ${pad("promotores", 22)}${pad(d.rows.length, 22)}${pad(p.promotores, 22)}${okProm ? "OK" : "!! DIVERGE"}`);
    console.log(`     ${pad("producao", 22)}${pad(brl(prodDash), 22)}${pad(brl(p.producao), 22)}${okProd ? "OK" : "!! DIVERGE"}`);
    console.log(`     ${pad("comissao bruta empr.", 22)}${pad(brl(d.credito), 22)}${pad("(nao exibe)", 22)}fechamento_mensal_empresa.valor_avista`);
    console.log(`     ${pad("penetracao seguro", 22)}${pad(pct(d.pen), 22)}${pad("(por promotor)", 22)}ponderada pelo PMR fechado`);
  }

  console.log("\n" + "=".repeat(94));
  console.log(falhas === 0 ? "GATE DASHBOARD: PASSOU" : `GATE DASHBOARD: ${falhas} FALHA(S)`);
  console.log("=".repeat(94));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
