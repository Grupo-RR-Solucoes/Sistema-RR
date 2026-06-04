/*
 * CMS-IMPORT — PASSO 3: grava o PMR de jan + mar/2026 (mes fechado -> le cms,
 * source='cms') e roda a AUDITORIA 2 (sistema x cms).
 *
 * Usa a LIB REAL lib/cmsMonthly.ts (mesma funcao que a rota /api/calculate/
 * monthly executa no mes fechado) -> a auditoria valida o SISTEMA, nao uma copia.
 *
 * Fevereiro/2026 nao foi importado (arquivos ausentes) -> NAO esta fechado ->
 * NAO recebe PMR cms aqui (segue o caminho diario quando recalculado).
 *
 * Backup do PMR atual (jan+mar) antes de sobrescrever: scratch/pmr_backup_*.json
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { detectClosedMonth, consolidateMonthlyFromCms } = require("../lib/cmsMonthly.ts");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const YEAR = 2026;
// meses via argv (ex.: "node run_pmr_cms.cjs 2"); default = jan + mar.
const MONTHS = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [1, 3];
const MES = { 1: "JAN", 2: "FEV", 3: "MAR" };
// valores de aceite conhecidos (informados pelo Diego) p/ Thaynara final.
const THAYNARA_ESPERADO = { 2: "12.283,69", 3: "16.051,57" };
const fmt = (x) => Number(x).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

async function fetchAll(table, sel, filt) {
  let from = 0, out = [];
  for (;;) {
    let q = sb.from(table).select(sel);
    for (const [k, v] of Object.entries(filt)) q = q.eq(k, v);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

(async () => {
  // ---------- BACKUP ----------
  const backup = [];
  for (const m of MONTHS) backup.push(...await fetchAll("promoter_monthly_results", "*", { year: YEAR, month: m }));
  const backupName = `pmr_backup_${MONTHS.join("-")}_2026.json`;
  const backupPath = path.join(__dirname, "..", "scratch", backupName);
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`BACKUP: ${backup.length} linhas de PMR (meses ${MONTHS.join(",")}) salvas em scratch/${backupName}\n`);

  // ---------- GRAVA PMR (cms) ----------
  console.log("===================== PASSO 3 — GRAVAR PMR (source=cms) =====================");
  for (const m of MONTHS) {
    const closed = await detectClosedMonth(sb, YEAR, m);
    if (!closed) {
      console.log(`!! ${MES[m]}/${YEAR} NAO esta fechado (cms incompleto) — PULADO. NAO deveria ocorrer.`);
      continue;
    }
    const res = await consolidateMonthlyFromCms(sb, { year: YEAR, month: m, companyId: null, promoterId: null });
    console.log(`OK  ${MES[m]}/${YEAR}: PMR gravado (source=cms) p/ ${res.promoters_calculated} promotores.`);
  }

  // ---------- AUDITORIA 2 (sistema x cms) ----------
  console.log("\n===================== AUDITORIA 2 — SISTEMA x cms =====================");
  console.log("mês | promotores | total PMR | total cms | divergências");
  console.log("-".repeat(70));

  const allDivergences = [];
  const perMonth = {}; // month -> { total, thaynara }
  const thaynaraId = (await sb.from("j_keys").select("promoter_id").eq("j_key", "JJ177329").single()).data?.promoter_id;

  for (const m of MONTHS) {
    // PMR gravado (source=cms)
    const pmr = await fetchAll("promoter_monthly_results", "promoter_id, production_commission_value, insurance_commission_value, final_commission_value, source", { year: YEAR, month: m, source: "cms" });
    const pmrBy = new Map(pmr.map((p) => [p.promoter_id, p]));

    // cms agregado por promotor (so mapeados)
    const entries = await fetchAll("cms_promoter_entries", "promoter_id, promoter_credit, promoter_insurance", { prod_year: YEAR, prod_month: m });
    const cmsBy = new Map();
    for (const e of entries) {
      if (!e.promoter_id) continue;
      const a = cmsBy.get(e.promoter_id) || { credit: 0, insurance: 0 };
      a.credit += Number(e.promoter_credit);
      a.insurance += Number(e.promoter_insurance);
      cmsBy.set(e.promoter_id, a);
    }

    // compara por promotor (cent precision)
    let totalPmr = 0, totalCms = 0, diverg = 0;
    const promoterIds = new Set([...cmsBy.keys(), ...pmr.filter((p) => Number(p.final_commission_value) !== 0).map((p) => p.promoter_id)]);
    for (const pid of promoterIds) {
      const cms = cmsBy.get(pid) || { credit: 0, insurance: 0 };
      const expProd = r2(cms.credit), expIns = r2(cms.insurance), expFinal = r2(cms.credit + cms.insurance);
      const row = pmrBy.get(pid);
      const gotProd = row ? r2(row.production_commission_value) : 0;
      const gotIns = row ? r2(row.insurance_commission_value) : 0;
      const gotFinal = row ? r2(row.final_commission_value) : 0;
      totalPmr += gotFinal;
      totalCms += expFinal;
      // Criterio (regra original): compara o FINAL por promotor (= o que e pago).
      // A quebra credito/seguro pode arredondar em meia-casa (ex.: seguro cms
      // 85,635) sem afetar o final nem o total — artefato float, NAO divergencia.
      // Nao se aplica arredondamento artificial ao split (divergiria do cms).
      if (Math.abs(gotFinal - expFinal) > 0.005) {
        diverg++;
        allDivergences.push({ month: m, promoter_id: pid, expProd, gotProd, expIns, gotIns, expFinal, gotFinal });
      }
      if (pid === thaynaraId) perMonth[m] = { ...(perMonth[m] || {}), thaynara: gotFinal };
    }
    totalPmr = r2(totalPmr); totalCms = r2(totalCms);
    perMonth[m] = { ...(perMonth[m] || {}), total: totalPmr };
    console.log(`${MES[m]} | ${String(promoterIds.size).padStart(10)} | ${fmt(totalPmr).padStart(12)} | ${fmt(totalCms).padStart(12)} | ${String(diverg).padStart(6)}`);
  }

  // ---------- DIVERGENCIAS ----------
  console.log("\n===================== DIVERGENCIAS =====================");
  if (allDivergences.length === 0) {
    console.log("  ✅ ZERO divergencias — o PMR reproduz o cms exatamente (por promotor/mes).");
  } else {
    console.log(`  ❌ ${allDivergences.length} divergencia(s):`);
    for (const d of allDivergences) {
      const nm = (await sb.from("promoters").select("name").eq("id", d.promoter_id).single()).data?.name;
      console.log(`   ${MES[d.month]} ${nm} (${d.promoter_id}): PMR final ${fmt(d.gotFinal)} x cms ${fmt(d.expFinal)} ` +
        `[prod ${fmt(d.gotProd)}/${fmt(d.expProd)} seg ${fmt(d.gotIns)}/${fmt(d.expIns)}]`);
    }
  }

  // ---------- TESTES ----------
  console.log("\n===================== TESTES =====================");
  for (const m of MONTHS) {
    const pm = perMonth[m] || {};
    const th = pm.thaynara != null ? fmt(pm.thaynara) : "(sem aba)";
    const esp = THAYNARA_ESPERADO[m];
    const ok = esp ? (th === esp ? "✅" : "❌") : "";
    console.log(`  ${MES[m]} THAYNARA final = ${th}${esp ? `   (esperado ${esp}) ${ok}` : ""}   | total PMR ${MES[m]} = ${fmt(pm.total || 0)}`);
  }

  if (allDivergences.length > 0) { console.log("\n*** PARANDO: ha divergencia sistema != cms ***"); process.exit(2); }
  console.log("\nPASSO 3 concluido.");
})().catch((e) => { console.error(e); process.exit(1); });
