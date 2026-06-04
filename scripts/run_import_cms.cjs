/*
 * CMS-IMPORT — PASSO 2: import real dos arquivos do cms (jan + mar/2026).
 *
 * Chama a LIB REAL lib/cmsImport.ts -> importCmsWorkbook (mesma funcao da rota
 * POST /api/import/cms), gravando cms_imports COMPLETED + cms_promoter_entries.
 * Idempotente por competencia/empresa (delete-then-insert).
 *
 * Fevereiro/2026: arquivos AUSENTES no disco -> NAO importado (reportado).
 * Dezembro/2025: fora de escopo -> ignorado.
 *
 * Relatorio por mes/CNPJ vem do BANCO apos a gravacao (autoritativo):
 * entries, mapeadas, nao-mapeadas, Σ credito, Σ seguro, abas meta_atingida,
 * entries is_master. Nao-mapeadas detalhadas vem do retorno do import.
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { importCmsWorkbook } = require("../lib/cmsImport.ts");

const DOWNLOADS = "C:/Users/diego/Downloads";
// Arquivos via argv (basenames em Downloads); default = jan + mar/2026.
const DEFAULT_FILES = [
  // JANEIRO/2026 (nomes completos)
  "PRODUÇÃO GERAL RR ALAGOAS 1 JANEIRO 2026.xlsx",
  "PRODUÇÃO GERAL RR ALAGOAS 2 JANEIRO 2026.xlsx",
  "PRODUÇÃO GERAL RR ALAGOAS 3 JANEIRO 2026.xlsx",
  "PRODUÇÃO GERAL RR PERNAMBUCO JANEIRO 2026.xlsx",
  // MARÇO/2026 (tokens)
  "PRODUÇÃO GERAL RR AL1 MARÇO 2026.xlsx",
  "PRODUÇÃO GERAL RR AL2 MARÇO 2026.xlsx",
  "PRODUÇÃO GERAL RR AL3 MARÇO 2026.xlsx",
  "PRODUÇÃO GERAL RR PE MARÇO 2026.xlsx",
];
const FILES = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const fmt = (x) => Number(x).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MES = { 1: "JAN", 2: "FEV", 3: "MAR", 4: "ABR", 5: "MAI", 6: "JUN", 7: "JUL", 8: "AGO", 9: "SET", 10: "OUT", 11: "NOV", 12: "DEZ" };

(async () => {
  const unmappedByFile = [];
  const importedMonths = new Set();
  console.log("===================== PASSO 2 — IMPORT cms =====================\n");

  for (const name of FILES) {
    const full = path.join(DOWNLOADS, name);
    if (!fs.existsSync(full)) {
      console.log(`!! AUSENTE: ${name}`);
      continue;
    }
    const fileBase64 = fs.readFileSync(full).toString("base64");
    try {
      const r = await importCmsWorkbook({ fileBase64, fileName: name, createdBy: "runner:passo2" });
      console.log(
        `OK  ${MES[r.prodMonth]}/${r.prodYear}  ${r.company.name}  ` +
        `entries=${r.processedEntries} mapeadas=${r.mappedEntries} nao-map=${r.unmappedEntries} ` +
        `excl=${r.excludedRows} importId=${r.importId}`
      );
      importedMonths.add(r.prodMonth);
      if (r.unmapped && r.unmapped.length) {
        unmappedByFile.push({ file: name, unmapped: r.unmapped });
      }
    } catch (e) {
      console.log(`ERRO ao importar ${name}: ${e.message}`);
      throw e;
    }
  }

  // ---- relatorio autoritativo a partir do BANCO ----
  console.log("\n===================== RELATORIO POR MES / CNPJ (do banco) =====================");
  const companies = (await sb.from("companies").select("id, name, cnpj")).data;
  const coById = new Map(companies.map((c) => [c.id, c]));

  const { data: imports } = await sb
    .from("cms_imports")
    .select("id, company_id, prod_year, prod_month, status, file_name")
    .in("prod_month", importedMonths.size ? [...importedMonths] : [1, 2, 3])
    .eq("prod_year", 2026)
    .order("prod_month");

  for (const imp of imports) {
    const co = coById.get(imp.company_id);
    const { data: entries } = await sb
      .from("cms_promoter_entries")
      .select("promoter_id, promoter_credit, promoter_insurance, is_master, meta_atingida, source_sheet")
      .eq("prod_year", imp.prod_year)
      .eq("prod_month", imp.prod_month)
      .eq("company_id", imp.company_id);

    let cred = 0, ins = 0, mapped = 0, master = 0;
    const metaSheets = new Set();
    for (const e of entries) {
      cred += Number(e.promoter_credit);
      ins += Number(e.promoter_insurance);
      if (e.promoter_id) mapped += 1;
      if (e.is_master) master += 1;
      if (e.meta_atingida) metaSheets.add(e.source_sheet);
    }
    console.log(
      `\n[${MES[imp.prod_month]}/${imp.prod_year}] ${co.name} (${co.cnpj})  status=${imp.status}`
    );
    console.log(
      `   entries=${entries.length}  mapeadas=${mapped}  nao-mapeadas=${entries.length - mapped}  ` +
      `is_master=${master}  abas_meta_atingida=${metaSheets.size}`
    );
    console.log(`   Σ crédito=${fmt(cred)}   Σ seguro=${fmt(ins)}`);
  }

  // ---- nao-mapeadas detalhadas (NAO silenciar) ----
  console.log("\n===================== NAO-MAPEADAS (detalhe) =====================");
  if (unmappedByFile.length === 0) {
    console.log("  (nenhuma — 100% das entries mapeadas a um promoter_id)");
  } else {
    for (const u of unmappedByFile) {
      console.log(`  ${u.file}:`);
      for (const row of u.unmapped) console.log(`     ${row.reason} | aba=${row.sheet} contrato=${row.contract}`);
    }
  }
  console.log("\nPASSO 2 concluido.");
})().catch((e) => { console.error(e); process.exit(1); });
