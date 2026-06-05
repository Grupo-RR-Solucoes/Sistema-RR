/*
 * FRENTE C — SIMULACAO maio/2026 (somente leitura, NAO grava, NAO recalcula).
 *
 * maio/2026 esta FECHADO por cms (ground truth): o repasse JA veio com a escala
 * embutida, entao o motor NAO reprocessa maio (espelha o cms). Este relatorio
 * mostra, so para conferencia visual, em qual FAIXA cada promotor nomeado cairia
 * e qual % a escala aplicaria — comparando produccao da competencia com
 * bonus1/bonus2 (meta_1/meta_2 de monthly_targets).
 *
 *   node scripts/frente_c_simular_maio.cjs
 *
 * Le promoter_goal_repasse (so nomeados), monthly_targets e
 * promoter_monthly_results de maio/2026. Nada e escrito.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");

const YEAR = 2026;
const MONTH = 5;
const COMPETENCIA = "2026-05-01";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const fmt = (x) =>
  Number(x || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (f) => (f == null ? "—" : `${(Number(f) * 100).toFixed(2)}%`);

function faixaAtingida(prod, b1, b2) {
  if (b2 > 0 && prod >= b2) return "META2";
  if (b1 > 0 && prod >= b1) return "META1";
  return "BASE";
}

(async () => {
  const { data: repasses, error: repErr } = await sb
    .from("promoter_goal_repasse")
    .select("promoter_id, pct_base, pct_meta1, pct_meta2")
    .eq("competencia", COMPETENCIA);
  if (repErr) {
    console.error(
      "Nao consegui ler promoter_goal_repasse (a migration ja foi aplicada?).",
      repErr.message
    );
    process.exit(1);
  }
  if (!repasses || repasses.length === 0) {
    console.log("Nenhuma linha de escala em maio/2026. Rode o import com --apply primeiro.");
    return;
  }
  const ids = repasses.map((r) => r.promoter_id);
  const repMap = new Map(repasses.map((r) => [r.promoter_id, r]));

  const [{ data: promoters }, { data: targets }, { data: results }] = await Promise.all([
    sb.from("promoters").select("id, name").in("id", ids),
    sb.from("monthly_targets").select("promoter_id, meta, meta_1, meta_2").eq("year", YEAR).eq("month", MONTH).in("promoter_id", ids),
    sb.from("promoter_monthly_results").select("promoter_id, production_value").eq("year", YEAR).eq("month", MONTH).in("promoter_id", ids),
  ]);
  const nameMap = new Map((promoters || []).map((p) => [p.id, p.name]));
  const tgtMap = new Map((targets || []).map((t) => [t.promoter_id, t]));
  const resMap = new Map((results || []).map((r) => [r.promoter_id, r]));

  console.log("============ FRENTE C — SIMULACAO maio/2026 (so leitura) ============");
  console.log("maio espelha o cms (ground truth). Nada recalculado, nada gravado.\n");
  console.log(
    "PROMOTOR".padEnd(26) +
      "PRODUCAO".padStart(14) +
      "META1".padStart(14) +
      "META2".padStart(14) +
      "  FAIXA " +
      "  %BASE   %META1  %META2  %VIGENTE"
  );

  const rows = Array.from(repMap.keys()).map((id) => {
    const rep = repMap.get(id);
    const t = tgtMap.get(id) || {};
    const prod = Number(resMap.get(id)?.production_value || 0);
    const b1 = Number(t.meta_1 || 0);
    const b2 = Number(t.meta_2 || 0);
    const faixa = faixaAtingida(prod, b1, b2);
    const vig = faixa === "META2" ? rep.pct_meta2 ?? rep.pct_base : faixa === "META1" ? rep.pct_meta1 ?? rep.pct_base : rep.pct_base;
    return { id, name: nameMap.get(id) || id, prod, b1, b2, faixa, rep, vig };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  for (const r of rows) {
    console.log(
      r.name.slice(0, 25).padEnd(26) +
        fmt(r.prod).padStart(14) +
        fmt(r.b1).padStart(14) +
        fmt(r.b2).padStart(14) +
        "  " + r.faixa.padEnd(6) +
        "  " + pct(r.rep.pct_base).padStart(7) +
        " " + pct(r.rep.pct_meta1).padStart(7) +
        " " + pct(r.rep.pct_meta2).padStart(7) +
        "  " + pct(r.vig).padStart(8)
    );
  }
  console.log(`\nPromotores nomeados na escala (maio): ${rows.length}`);
  const semProducao = rows.filter((r) => r.prod === 0).map((r) => r.name);
  if (semProducao.length) {
    console.log(
      `Aviso: sem production_value em promoter_monthly_results: ${semProducao.join(", ")}` +
        " (faixa cai em BASE por falta de producao consolidada de maio)."
    );
  }
})().catch((e) => {
  console.error("ERRO:", e?.message || e);
  process.exit(1);
});
