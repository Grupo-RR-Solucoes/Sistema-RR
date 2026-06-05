/*
 * FRENTE C — copia metas + escala de MAIO/2026 para JUNHO/2026.
 *
 * Junho = exatamente igual a maio (decisao Diego, 2026-06-04). Daqui pra
 * frente as mudancas sao manuais na tela /metas (sem mais planilha).
 *
 *   node scripts/frente_c_copia_maio_para_junho.cjs                       (DRY-RUN)
 *   node scripts/frente_c_copia_maio_para_junho.cjs --apply               (SEED inicial)
 *   node scripts/frente_c_copia_maio_para_junho.cjs --apply --force-overwrite
 *
 * Copia:
 *   monthly_targets       2026/05 -> 2026/06   (meta/meta_1/meta_2)
 *   promoter_goal_repasse 2026-05-01 -> 2026-06-01 (pct_base/meta1/meta2)
 *
 * Idempotente: UPSERT por (promoter_id, year, month) e (promoter_id,
 * competencia). Rodar de novo NAO duplica.
 *
 * TRAVA DE SEGURANCA: --apply ABORTA se junho ja tiver dados em
 * monthly_targets OU promoter_goal_repasse — porque sobrescreveria edicoes
 * manuais feitas na tela /metas. Para sobrescrever de proposito (raro),
 * use --force-overwrite. O seed inicial roda com junho vazio e passa direto.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");

const SRC = { year: 2026, month: 5, comp: "2026-05-01" };
const DST = { year: 2026, month: 6, comp: "2026-06-01" };

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const forceOverwrite = argv.includes("--force-overwrite");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function fetchAll(table, select, filter) {
  let q = sb.from(table).select(select);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

(async () => {
  console.log("========= FRENTE C — COPIA maio/2026 -> junho/2026 =========");
  console.log(`Modo: ${apply ? "APPLY (escreve)" : "DRY-RUN (nao escreve)"}\n`);

  // --- monthly_targets ---
  const srcTargets = await fetchAll(
    "monthly_targets",
    "promoter_id, company_id, meta, meta_1, meta_2",
    { year: SRC.year, month: SRC.month }
  );
  const dstTargetsExist = await fetchAll(
    "monthly_targets",
    "promoter_id",
    { year: DST.year, month: DST.month }
  );
  const dstTargetIds = new Set(dstTargetsExist.map((r) => r.promoter_id));
  const targetRows = srcTargets.map((r) => ({
    promoter_id: r.promoter_id,
    company_id: r.company_id,
    year: DST.year,
    month: DST.month,
    meta: r.meta,
    meta_1: r.meta_1,
    meta_2: r.meta_2,
  }));
  const tNovos = targetRows.filter((r) => !dstTargetIds.has(r.promoter_id)).length;
  const tUpd = targetRows.length - tNovos;

  // --- promoter_goal_repasse ---
  const srcRepasse = await fetchAll(
    "promoter_goal_repasse",
    "promoter_id, pct_base, pct_meta1, pct_meta2",
    { competencia: SRC.comp }
  );
  const dstRepasseExist = await fetchAll(
    "promoter_goal_repasse",
    "promoter_id",
    { competencia: DST.comp }
  );
  const dstRepIds = new Set(dstRepasseExist.map((r) => r.promoter_id));
  const repasseRows = srcRepasse.map((r) => ({
    promoter_id: r.promoter_id,
    competencia: DST.comp,
    pct_base: r.pct_base,
    pct_meta1: r.pct_meta1,
    pct_meta2: r.pct_meta2,
  }));
  const rNovos = repasseRows.filter((r) => !dstRepIds.has(r.promoter_id)).length;
  const rUpd = repasseRows.length - rNovos;

  console.log(
    `monthly_targets       : copiaria ${targetRows.length} de maio  ` +
      `(novos em junho=${tNovos}, ja existem=${tUpd})`
  );
  console.log(
    `promoter_goal_repasse : copiaria ${repasseRows.length} de maio  ` +
      `(novos em junho=${rNovos}, ja existem=${rUpd})\n`
  );

  if (srcTargets.length === 0) {
    console.log("AVISO: maio nao tem monthly_targets. Rode o import de maio antes.");
  }

  if (!apply) {
    console.log("DRY-RUN: nada gravado. Rode com --apply (com OK do Diego) para copiar.");
    if (tUpd > 0 || rUpd > 0) {
      console.log(
        `Obs: junho JA tem dados (monthly_targets=${tUpd}, promoter_goal_repasse=${rUpd}). ` +
          "Nesse estado o --apply ABORTA pela trava; so prossegue com --force-overwrite."
      );
    }
    return;
  }

  // TRAVA: nao sobrescrever junho ja preenchido sem confirmacao explicita.
  if (!forceOverwrite && (dstTargetsExist.length > 0 || dstRepasseExist.length > 0)) {
    console.error(
      `\nABORTADO pela trava de seguranca: junho/2026 JA tem dados ` +
        `(monthly_targets=${dstTargetsExist.length}, promoter_goal_repasse=${dstRepasseExist.length}).\n` +
        `Aplicar agora SOBRESCREVERIA essas linhas com os valores de maio — ` +
        `perderia edicoes manuais feitas na tela /metas.\n` +
        `Se voce REALMENTE quer sobrescrever junho com maio, rode com --force-overwrite.`
    );
    process.exit(1);
  }

  if (targetRows.length) {
    const { error } = await sb
      .from("monthly_targets")
      .upsert(targetRows, { onConflict: "promoter_id,year,month" });
    if (error) throw error;
  }
  if (repasseRows.length) {
    const { error } = await sb
      .from("promoter_goal_repasse")
      .upsert(repasseRows, { onConflict: "promoter_id,competencia" });
    if (error) throw error;
  }
  console.log(
    `APLICADO. monthly_targets=${targetRows.length}  promoter_goal_repasse=${repasseRows.length} em junho/2026.`
  );
})().catch((e) => {
  console.error("ERRO:", e?.message || e);
  process.exit(1);
});
