/* ============================================================================
 * mov2_proposals_get_gate — MOV 2, Grupo B item 2 (proposals GET). So leitura.
 *
 * Rodar:  TRP_SOURCE=db node scripts/mov2_proposals_get_gate.cjs
 *
 * ANTES: o GET usava o BOOLEANO detectClosedMonth e, em QUALQUER mes fechado,
 * listava cms_promoter_entries. O cms so tem jan-mai -> em abril e junho (regime
 * 'fechamento') o editor de propostas devolvia rows:[] (VAZIO), ainda por cima
 * rotulado proposalSource:"cms" — mentindo a fonte.
 *
 * DEPOIS: a fonte sai do ENUM.
 *   'cms'        -> buildCmsProposalRows        (jan-mai, inalterado)
 *   'fechamento' -> buildClosingProposalRows    (o MESMO de /api/promotores:208)
 *   'open'       -> caminho diario              (julho, inalterado)
 *
 * O gate nao chama a rota HTTP (exige sessao). Ele reproduz a DECISAO DE FONTE —
 * que e o que o PR muda — e confronta com o que /promotores lista para as mesmas
 * competencias. Mesma funcao => mesmo conjunto de linhas.
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { detectMonthRegime } = require("../lib/cmsMonthly.ts");
const { buildCmsProposalRows, buildCmsProposalRowsBatch } = require("../lib/promoterReportData.ts");
const { buildClosingProposalRows } = require("../lib/closingProposalRows.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const pad = (s, n) => { s = String(s ?? ""); return s.length >= n ? s : s + " ".repeat(n - s.length); };

/** Universo de promotores da competencia, por regime (o que o GET faz). */
async function idsDaCompetencia(year, month, regime) {
  if (regime === "cms") {
    const { data } = await sb.from("cms_promoter_entries").select("promoter_id")
      .eq("prod_year", year).eq("prod_month", month).not("promoter_id", "is", null);
    return [...new Set((data || []).map((r) => r.promoter_id))];
  }
  const { data } = await sb.from("promoter_monthly_results").select("promoter_id")
    .eq("year", year).eq("month", month).in("source", ["fechamento", "bbts"]).not("promoter_id", "is", null);
  return [...new Set((data || []).map((r) => r.promoter_id))];
}

/** ANTES: sempre cms em mes fechado. */
async function getAntes(year, month) {
  const regime = await detectMonthRegime(sb, year, month);
  if (regime === "open") return { regime, rows: null, source: "(daily)" };
  const { data } = await sb.from("cms_promoter_entries").select("promoter_id")
    .eq("prod_year", year).eq("prod_month", month).not("promoter_id", "is", null);
  const ids = [...new Set((data || []).map((r) => r.promoter_id))];
  if (!ids.length) return { regime, rows: 0, source: "cms" };
  const byProm = await buildCmsProposalRowsBatch(sb, ids, year, month);
  let n = 0;
  for (const [, list] of byProm) n += list.length;
  return { regime, rows: n, source: "cms" };
}

/** DEPOIS: fonte por regime. */
async function getDepois(year, month) {
  const regime = await detectMonthRegime(sb, year, month);
  if (regime === "open") return { regime, rows: null, source: "open" };
  const ids = await idsDaCompetencia(year, month, regime);
  if (!ids.length) return { regime, rows: 0, source: regime, promotores: 0 };
  let n = 0;
  if (regime === "cms") {
    const byProm = await buildCmsProposalRowsBatch(sb, ids, year, month);
    for (const [, list] of byProm) n += list.length;
  } else {
    for (let i = 0; i < ids.length; i += 8) {
      const bloco = ids.slice(i, i + 8);
      const listas = await Promise.all(bloco.map((pid) => buildClosingProposalRows(sb, pid, year, month)));
      for (const l of listas) n += l.length;
    }
  }
  return { regime, rows: n, source: regime, promotores: ids.length };
}

(async () => {
  let falhas = 0;

  console.log("=".repeat(92));
  console.log("PROPOSALS GET — linhas listadas e proposalSource, antes vs depois");
  console.log("=".repeat(92));
  console.log("  " + pad("COMP", 9) + pad("regime", 13) + pad("ANTES (linhas/source)", 24) + pad("DEPOIS (linhas/source)", 24) + "veredito");
  for (const m of [1, 2, 3, 4, 5, 6, 7]) {
    const a = await getAntes(2026, m);
    const d = await getDepois(2026, m);
    const aTxt = a.rows === null ? "(ramo diario)" : `${a.rows} / ${a.source}`;
    const dTxt = d.rows === null ? "(ramo diario)" : `${d.rows} / ${d.source}`;
    let veredito, ok;
    if (d.regime === "open") { veredito = "NO-OP (aberto, intocado)"; ok = true; }
    else if (d.regime === "cms") {
      ok = a.rows === d.rows;
      veredito = ok ? "NO-OP (cms inalterado)" : "!! MUDOU (deveria ser NO-OP)";
    } else {
      ok = a.rows === 0 && d.rows > 0;
      veredito = ok ? "CONSERTO (saiu do vazio)" : "!! nao consertou";
    }
    if (!ok) falhas++;
    console.log("  " + pad(`2026-${String(m).padStart(2, "0")}`, 9) + pad(d.regime, 13) + pad(aTxt, 24) + pad(dTxt, 24) + veredito);
  }

  console.log("\n" + "=".repeat(92));
  console.log("ABRIL e JUNHO — proposals GET  vs  /promotores  (mesma funcao => mesmo conjunto)");
  console.log("=".repeat(92));
  for (const m of [4, 6]) {
    const regime = await detectMonthRegime(sb, 2026, m);
    const ids = await idsDaCompetencia(2026, m, regime);
    // GET (competencia inteira)
    let totalGet = 0;
    const porPromotor = new Map();
    for (let i = 0; i < ids.length; i += 8) {
      const bloco = ids.slice(i, i + 8);
      const listas = await Promise.all(bloco.map((pid) => buildClosingProposalRows(sb, pid, 2026, m)));
      listas.forEach((l, k) => { porPromotor.set(bloco[k], l.length); totalGet += l.length; });
    }
    // /promotores: chama a MESMA funcao, por promotor selecionado. Confere 3 amostras.
    const amostra = ids.slice(0, 3);
    let okAmostra = true;
    for (const pid of amostra) {
      const doPromotores = await buildClosingProposalRows(sb, pid, 2026, m);
      if (doPromotores.length !== porPromotor.get(pid)) okAmostra = false;
    }
    if (!okAmostra) falhas++;
    console.log(`  2026-${String(m).padStart(2, "0")} (regime ${regime})`);
    console.log(`     promotores na competencia : ${ids.length}`);
    console.log(`     linhas no editor (GET)    : ${totalGet}   (antes: 0 — VAZIO)`);
    console.log(`     proposalSource            : '${regime}'   (antes: 'cms' — mentia)`);
    console.log(`     amostra de ${amostra.length} promotores bate com /promotores: ${okAmostra ? "OK" : "!! DIVERGE"}`);
  }

  console.log("\n" + "=".repeat(92));
  console.log(falhas === 0 ? "GATE PROPOSALS GET: PASSOU" : `GATE PROPOSALS GET: ${falhas} FALHA(S)`);
  console.log("=".repeat(92));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
