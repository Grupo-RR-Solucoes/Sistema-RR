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
const { detectMonthRegime, consolidateMonthlyFromCms } = require("../lib/cmsMonthly.ts");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const YEAR = 2026;
// BLINDAGEM 2026-07: default DRY-RUN. Antes gravava o PMR ao rodar, sem guarda.
// Agora consolida SO com --apply (padrao do repo). O --apply e filtrado da lista
// de meses (que tambem vem via argv).
const rawArgs = process.argv.slice(2);
const APPLY = rawArgs.includes("--apply");
const monthArgs = rawArgs.filter((a) => a !== "--apply").map(Number).filter((n) => n >= 1 && n <= 12);
// meses via argv (ex.: "node run_pmr_cms.cjs 2 --apply"); default = jan + mar.
const MONTHS = monthArgs.length ? monthArgs : [1, 3];
const MES = { 1: "JAN", 2: "FEV", 3: "MAR", 4: "ABR", 5: "MAI", 6: "JUN", 7: "JUL", 8: "AGO", 9: "SET", 10: "OUT", 11: "NOV", 12: "DEZ" };
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
  if (!APPLY) {
    console.log(">>> DRY-RUN: nada sera gravado. Rode com --apply para consolidar o PMR (source=cms).\n");
  }

  // ---------- BACKUP (so antes de gravar de verdade) ----------
  if (APPLY) {
    const backup = [];
    for (const m of MONTHS) backup.push(...await fetchAll("promoter_monthly_results", "*", { year: YEAR, month: m }));
    const backupName = `pmr_backup_${MONTHS.join("-")}_2026.json`;
    const backupPath = path.join(__dirname, "..", "scratch", backupName);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`BACKUP: ${backup.length} linhas de PMR (meses ${MONTHS.join(",")}) salvas em scratch/${backupName}\n`);
  }

  // ---------- GRAVA PMR (cms) ----------
  console.log(`===================== PASSO 3 — ${APPLY ? "GRAVAR" : "SIMULAR"} PMR (source=cms) =====================`);
  for (const m of MONTHS) {
    // MOV 3: detectClosedMonth foi REMOVIDO (booleano colapsado). A pergunta aqui e
    // binaria — "da pra gravar?" — entao e `regime !== open` (cms E fechamento fecham).
    const closed = (await detectMonthRegime(sb, YEAR, m)) !== "open";
    if (!closed) {
      console.log(`!! ${MES[m]}/${YEAR} NAO esta fechado (cms incompleto) — PULADO. NAO deveria ocorrer.`);
      continue;
    }
    if (APPLY) {
      const res = await consolidateMonthlyFromCms(sb, { year: YEAR, month: m, companyId: null, promoterId: null });
      console.log(`OK  ${MES[m]}/${YEAR}: PMR gravado (source=cms) p/ ${res.promoters_calculated} promotores.`);
    } else {
      console.log(`DRY-RUN  ${MES[m]}/${YEAR}: consolidaria o PMR (source=cms). NADA gravado. A auditoria abaixo compara o PMR ATUAL x cms.`);
    }
  }

  // ---------- AUDITORIA 2 (sistema x cms) ----------
  console.log("\n===================== AUDITORIA 2 — SISTEMA x cms =====================");
  console.log("mês | promotores | total PMR | total cms | divergências");
  console.log("-".repeat(70));

  const allDivergences = [];
  const perMonth = {}; // month -> { total, thaynara }
  const thaynaraId = (await sb.from("j_keys").select("promoter_id").eq("j_key", "JJ177329").single()).data?.promoter_id;

  // MASTER NAO RECEBE COMISSAO NO LEDGER DERIVADO (ver lib/cmsMonthly.ts): o
  // consolidador zera credito/seguro do master no PMR de PROPOSITO. A regra da
  // comparacao (master fora + tolerancia meia-casa + FINAL por promotor) mora em
  // lib/cms/auditCmsVsPmr.ts — a MESMA que o vigia (/api/diagnostico) consome,
  // para nao haver drift entre a auditoria do script e a do health-check.
  const { auditCmsVsPmr } = require("../lib/cms/auditCmsVsPmr.ts");
  const masterIds = new Set(
    (await fetchAll("promoters", "id, is_master", {}))
      .filter((p) => p.is_master === true)
      .map((p) => p.id)
  );

  for (const m of MONTHS) {
    const audit = await auditCmsVsPmr(sb, YEAR, m, { masterIds });
    for (const row of audit.rows) {
      if (row.diverge) {
        allDivergences.push({
          month: m,
          promoter_id: row.promoter_id,
          expProd: row.cms_credit, gotProd: row.pmr_prod,
          expIns: row.cms_ins, gotIns: row.pmr_ins,
          expFinal: row.cms_esperado, gotFinal: row.pmr_final,
        });
      }
      if (row.promoter_id === thaynaraId) perMonth[m] = { ...(perMonth[m] || {}), thaynara: row.pmr_final };
    }
    perMonth[m] = { ...(perMonth[m] || {}), total: audit.total_pmr };
    console.log(`${MES[m]} | ${String(audit.rows.length).padStart(10)} | ${fmt(audit.total_pmr).padStart(12)} | ${fmt(audit.total_cms).padStart(12)} | ${String(audit.divergences).padStart(6)}`);
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
