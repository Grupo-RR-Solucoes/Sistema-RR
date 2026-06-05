/*
 * FRENTE C — PASSO 2: importador de METAS + seed da ESCALA (maio/2026).
 *
 * Chama a LIB REAL lib/metasImport.ts -> importMetasWorkbook (mesma funcao
 * da rota POST /api/metas/import), via client service_role (sem precisar de
 * dev server nem cookie de sessao).
 *
 *   node scripts/run_metas_import_maio.cjs "<caminho-do-xlsx>"           (DRY-RUN)
 *   node scripts/run_metas_import_maio.cjs "<caminho-do-xlsx>" --apply   (ESCREVE)
 *
 * Sem caminho: procura "Alteracoes_de_Metas.xlsx"/"Alterações_de_Metas.xlsx"
 * em C:/Users/diego/Downloads.
 *
 * Idempotente: UPSERT por (promoter_id, year, month) e (promoter_id,
 * competencia). NAO cria promoter; lista os nao-mapeados/ambiguos.
 * REQUER a migration 20260604000000 ja aplicada (promoter_goal_repasse).
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");

const DOWNLOADS = "C:/Users/diego/Downloads";

const fmt = (x) =>
  Number(x || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (f) => (f == null ? "—" : `${(Number(f) * 100).toFixed(2)}%`);

function resolveFile(explicitPath) {
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;
  const candidates = [
    "Alterações de Metas.xlsx",
    "Alteracoes de Metas.xlsx",
    "Alteracoes_de_Metas.xlsx",
    "Alterações_de_Metas.xlsx",
    "ALTERACOES_DE_METAS.xlsx",
  ];
  for (const c of candidates) {
    const p = path.join(DOWNLOADS, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Impressao do relatorio — null-safe para os 3 grupos (escala / so-meta /
// nao-mapeadas). NAO le escala_pct quando a linha nao tem escala.
function printReport(report, { apply } = {}) {
  const c = report.counts;
  console.log(`Aba lida: ${report.sheet}  |  competencia ${report.competencia}`);
  console.log(
    `Linhas  : AL=${c.al_rows}  PE=${c.pe_rows}  | mapeadas=${c.mapped}  ` +
      `(escala=${c.mapped - c.only_meta}, so-meta=${c.only_meta})  ` +
      `nao-mapeadas=${c.unmatched}  ambiguas=${c.ambiguous}  excluidas=${c.excluded}`
  );
  console.log(
    `Upserts : monthly_targets=${c.targets_upserted}  promoter_goal_repasse=${c.repasse_upserted}\n`
  );

  // Nomeados (ganham escala): mostra base/meta1/meta2.
  const escala = report.mapped.filter((m) => m.escala_pct);
  if (escala.length) {
    console.log(`---- ESCALA (nomeados no Acordo): ${escala.length} ----`);
    for (const m of escala) {
      const p = m.escala_pct;
      const flag = m.state_mismatch ? "  [!ESTADO]" : "";
      console.log(
        `  [${m.block}] L${m.row} "${m.nome}" -> ${m.promoter_name}  ` +
          `META=${fmt(m.meta)} B1=${fmt(m.bonus1)} B2=${fmt(m.bonus2)}  ` +
          `base ${pct(p.pct_base)} / meta1 ${pct(p.pct_meta1)} / meta2 ${pct(p.pct_meta2)}${flag}`
      );
    }
    console.log("");
  }

  // So-meta (mapeados nao-nomeados): SEM escala, nao le pct_base.
  const soMeta = report.mapped.filter((m) => !m.escala_pct);
  if (soMeta.length) {
    console.log(`---- SO META (mapeados nao-nomeados — acordo atual): ${soMeta.length} ----`);
    for (const m of soMeta) {
      const flag = m.state_mismatch ? "  [!ESTADO]" : "";
      console.log(
        `  [${m.block}] L${m.row} "${m.nome}" -> ${m.promoter_name}  ` +
          `META=${fmt(m.meta)} B1=${fmt(m.bonus1)} B2=${fmt(m.bonus2)}  ` +
          `sem escala (acordo atual)${flag}`
      );
    }
    console.log("");
  }

  if (report.ambiguous.length) {
    console.log(`---- AMBIGUAS (Diego decide): ${report.ambiguous.length} ----`);
    for (const a of report.ambiguous) {
      console.log(
        `  [${a.block}] L${a.row} "${a.nome}" -> ${a.candidates.map((x) => x.name).join(" | ")}`
      );
    }
    console.log("");
  }

  if (report.unmatched.length) {
    console.log(`---- NAO-MAPEADAS (Diego decide; nada gravado): ${report.unmatched.length} ----`);
    for (const u of report.unmatched) {
      const sug = (u.sugestoes || []).map((x) => x.name).join(" | ") || "(nenhuma)";
      console.log(`  [${u.block}] L${u.row} "${u.nome}"  META=${fmt(u.meta)}  sugestoes: ${sug}`);
    }
    console.log("");
  }

  if (report.excluded.length) {
    console.log(`---- EXCLUIDAS (552710): ${report.excluded.length} ----`);
  }

  if (!apply) {
    console.log("\nDRY-RUN: nada foi gravado. Reveja acima e rode com --apply para aplicar.");
  }
}

async function main() {
  const { createClient } = require("@supabase/supabase-js");
  const { importMetasWorkbook } = require("../lib/metasImport.ts");

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const explicitPath = args.find((a) => !a.startsWith("--"));

  const filePath = resolveFile(explicitPath);
  if (!filePath) {
    console.error(
      "Arquivo nao encontrado. Passe o caminho:\n" +
        '  node scripts/run_metas_import_maio.cjs "C:/Users/diego/Downloads/Alteracoes_de_Metas.xlsx"'
    );
    process.exit(1);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  console.log("============== FRENTE C — IMPORT METAS (maio/2026) ==============");
  console.log(`Arquivo : ${filePath}`);
  console.log(`Modo    : ${apply ? "APPLY (escreve no banco)" : "DRY-RUN (nao escreve)"}\n`);

  const fileBuffer = fs.readFileSync(filePath);
  const report = await importMetasWorkbook({ supabase: sb, fileBuffer, dryRun: !apply });

  printReport(report, { apply });

  if (apply) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = path.join(__dirname, "..", "scratch", `frente_c_import_backup_${stamp}.json`);
    fs.writeFileSync(out, JSON.stringify(report.backup, null, 2));
    console.log(`\nAPLICADO. Backup do estado ANTERIOR salvo em: ${out}`);
  }
}

module.exports = { printReport, resolveFile };

if (require.main === module) {
  main().catch((e) => {
    console.error("ERRO:", e?.message || e);
    process.exit(1);
  });
}
