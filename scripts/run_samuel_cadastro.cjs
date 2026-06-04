/*
 * CMS-IMPORT — Samuel Correia (chave JI803091): cadastro como INATIVO +
 * atribuicao do historico de janeiro/2026 + reprocesso do PMR + re-auditoria.
 *
 * Samuel foi promotor (aba no cms de jan), recebeu comissao e saiu depois.
 * Cadastrado active=false / status=INACTIVE (nao recebe producao futura), com a
 * chave JI803091 vinculada, e as 2 linhas do cms de janeiro atribuidas a ele.
 *
 * Idempotente. Backup do estado anterior em scratch/samuel_backup.json.
 * Usa a LIB REAL lib/cmsMonthly.ts p/ reprocessar (mesma logica da rota).
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { consolidateMonthlyFromCms } = require("../lib/cmsMonthly.ts");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const JKEY = "JI803091";
const YEAR = 2026, MONTH = 1;
const fmt = (x) => Number(x).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
async function fa(t, sel, filt) { let f = 0, o = []; for (;;) { let q = sb.from(t).select(sel); for (const [k, v] of Object.entries(filt)) q = q.eq(k, v); const { data, error } = await q.range(f, f + 999); if (error) throw new Error(error.message); o.push(...data); if (data.length < 1000) break; f += 1000; } return o; }

async function janAudit(label) {
  const pmr = await fa("promoter_monthly_results", "promoter_id, production_commission_value, insurance_commission_value, final_commission_value", { year: YEAR, month: MONTH, source: "cms" });
  const pmrBy = new Map(pmr.map((p) => [p.promoter_id, p]));
  const entries = await fa("cms_promoter_entries", "promoter_id, promoter_credit, promoter_insurance", { prod_year: YEAR, prod_month: MONTH });
  const cmsBy = new Map();
  for (const e of entries) { if (!e.promoter_id) continue; const a = cmsBy.get(e.promoter_id) || { c: 0, i: 0 }; a.c += Number(e.promoter_credit); a.i += Number(e.promoter_insurance); cmsBy.set(e.promoter_id, a); }
  let totalPmr = 0, totalCms = 0, diverg = [];
  const ids = new Set([...cmsBy.keys(), ...pmr.filter((p) => Number(p.final_commission_value) !== 0).map((p) => p.promoter_id)]);
  for (const id of ids) {
    const cms = cmsBy.get(id) || { c: 0, i: 0 };
    const expFinal = r2(cms.c + cms.i);
    const row = pmrBy.get(id);
    const gotFinal = row ? r2(row.final_commission_value) : 0;
    totalPmr += gotFinal; totalCms += expFinal;
    if (Math.abs(gotFinal - expFinal) > 0.005 || (row && (Math.abs(r2(row.production_commission_value) - r2(cms.c)) > 0.005 || Math.abs(r2(row.insurance_commission_value) - r2(cms.i)) > 0.005))) diverg.push({ id, expFinal, gotFinal });
  }
  // tambem checa linhas cms sem promotor (orfas) — informativo
  const orphans = entries.filter((e) => !e.promoter_id);
  let oc = 0, oi = 0; for (const e of orphans) { oc += Number(e.promoter_credit); oi += Number(e.promoter_insurance); }
  console.log(`[${label}] PMR jan total=${fmt(r2(totalPmr))} | cms(mapeado) total=${fmt(r2(totalCms))} | promotores=${ids.size} | divergencias=${diverg.length} | orfas=${orphans.length} (cred ${fmt(r2(oc))}/seg ${fmt(r2(oi))})`);
  return { totalPmr: r2(totalPmr), diverg, ids: ids.size, orphans: orphans.length };
}

(async () => {
  // ---------- BACKUP ----------
  const pmrJanBefore = await fa("promoter_monthly_results", "*", { year: YEAR, month: MONTH });
  const entriesSamuelBefore = (await fa("cms_promoter_entries", "*", { prod_year: YEAR, prod_month: MONTH })).filter((e) => e.j_key === JKEY);
  fs.writeFileSync(path.join(__dirname, "..", "scratch", "samuel_backup.json"),
    JSON.stringify({ pmrJanBefore, entriesSamuelBefore }, null, 2));
  console.log(`BACKUP: PMR jan (${pmrJanBefore.length} linhas) + ${entriesSamuelBefore.length} entries da chave ${JKEY} -> scratch/samuel_backup.json\n`);

  console.log("=== ANTES ===");
  await janAudit("antes");

  // ---------- empresa PE ----------
  const pe = (await sb.from("companies").select("id, name").ilike("name", "%PERNAMBUCO%").single()).data;
  if (!pe) throw new Error("empresa PE nao encontrada");

  // ---------- promoter (idempotente) ----------
  let { data: existJk } = await sb.from("j_keys").select("promoter_id").eq("j_key", JKEY).maybeSingle();
  let promoterId = existJk?.promoter_id || null;
  if (!promoterId) {
    // tenta achar promoter ja criado por nome em PE
    const { data: existProm } = await sb.from("promoters").select("id").eq("company_id", pe.id).ilike("name", "SAMUEL CORREIA").maybeSingle();
    if (existProm) promoterId = existProm.id;
  }
  if (!promoterId) {
    const { data: ins, error } = await sb.from("promoters").insert({
      company_id: pe.id,
      name: "SAMUEL CORREIA",
      status: "INACTIVE",
      active: false,
      is_master: false,
      notes: "Desligado apos jan/2026. Cadastrado p/ atribuir historico do cms (chave JI803091). Nao recebe producao futura.",
    }).select("id").single();
    if (error) throw new Error("insert promoter: " + error.message);
    promoterId = ins.id;
    console.log(`PROMOTER criado: SAMUEL CORREIA (PE) id=${promoterId} status=INACTIVE active=false`);
  } else {
    console.log(`PROMOTER ja existente: id=${promoterId} (idempotente)`);
  }

  // ---------- j_key (idempotente) ----------
  if (!existJk) {
    const { error } = await sb.from("j_keys").insert({
      j_key: JKEY, company_id: pe.id, promoter_id: promoterId,
      key_type: "INDIVIDUAL", active: false, display_name: "SAMUEL CORREIA",
    });
    if (error) throw new Error("insert j_key: " + error.message);
    console.log(`J_KEY criada: ${JKEY} -> promoter ${promoterId} (active=false)`);
  } else {
    console.log(`J_KEY ${JKEY} ja existente (idempotente)`);
  }

  // ---------- atribui as 2 entries do cms (jan) ----------
  const { data: upd, error: updErr } = await sb.from("cms_promoter_entries")
    .update({ promoter_id: promoterId })
    .eq("prod_year", YEAR).eq("prod_month", MONTH).eq("j_key", JKEY)
    .is("promoter_id", null)
    .select("contract_number");
  if (updErr) throw new Error("update entries: " + updErr.message);
  console.log(`ENTRIES atribuidas ao Samuel: ${upd.length} (${upd.map((e) => e.contract_number).join(", ")})`);

  // ---------- reprocessa PMR jan (lib real) ----------
  const res = await consolidateMonthlyFromCms(sb, { year: YEAR, month: MONTH, companyId: null, promoterId: null });
  console.log(`PMR jan reprocessado (source=cms) p/ ${res.promoters_calculated} promotores.\n`);

  // ---------- DEPOIS + PMR do Samuel ----------
  console.log("=== DEPOIS ===");
  const after = await janAudit("depois");
  const sam = (await sb.from("promoter_monthly_results").select("production_commission_value, insurance_commission_value, final_commission_value, source").eq("promoter_id", promoterId).eq("year", YEAR).eq("month", MONTH).single()).data;
  console.log(`\nPMR SAMUEL jan: credito=${fmt(sam.production_commission_value)} seguro=${fmt(sam.insurance_commission_value)} final=${fmt(sam.final_commission_value)} source=${sam.source}`);

  // ---------- RE-AUDITORIA ----------
  console.log("\n===================== RE-AUDITORIA 2 — JANEIRO =====================");
  console.log(`  total PMR janeiro = ${fmt(after.totalPmr)}   (esperado COM Samuel = 104.808,65)  ${fmt(after.totalPmr) === "104.808,65" ? "✅" : "❌"}`);
  console.log(`  divergencias sistema x cms = ${after.diverg.length}  ${after.diverg.length === 0 ? "✅" : "❌"}`);
  console.log(`  Samuel final = ${fmt(sam.final_commission_value)}  (esperado 9,12)  ${fmt(sam.final_commission_value) === "9,12" ? "✅" : "❌"}`);
  console.log(`  linhas orfas restantes em jan = ${after.orphans}  ${after.orphans === 0 ? "✅" : "(ver detalhe)"}`);
  if (after.diverg.length > 0) { console.log("*** DIVERGENCIA — PARANDO ***"); process.exit(2); }
})().catch((e) => { console.error(e); process.exit(1); });
