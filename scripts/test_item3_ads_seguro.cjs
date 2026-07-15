/*
 * ITEM 3 e2e — detecção de origem + classificação da diária de seguro (Prestamista).
 * READ-ONLY: NÃO grava em produção (um teste não precisa gravar pra provar que
 * funciona). O import roda em dryRun:true — só PROJETA. Antes gravava dado REAL de
 * julho com dryRun:false (blindado 2026-07: era um "test" que escrevia em prod).
 * A) detectDailySource classifica os arquivos reais.
 * B) dry-run de Prestamista (1).xlsx (7 propostas julho): confirma que o parser
 *    marca prod_segurada true SÓ nas que têm "Seguro" preenchido (contadores do
 *    dry-run) e confere contra o dado já importado pela via oficial (read-back).
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
(function preferEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
})();
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");
const { detectDailySource } = require("../lib/dailySourceDetect.ts");
const { importAdsSeguroDaily } = require("../lib/adsSeguroDailyImport.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const DL = "C:/Users/diego/Downloads";

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${x ? "— " + x : ""}`)); };

function headerOf(file) {
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  const header = (XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false })[0] || []);
  return { sheetNames: wb.SheetNames, headers: header };
}

async function main() {
  console.log("\n=== ITEM 3 — A) DETECÇÃO DE ORIGEM ===\n");
  ok("Prestamista (1).xlsx -> ads-seguro", detectDailySource(headerOf(DL + "/Prestamista (1).xlsx")) === "ads-seguro");
  ok("Prestamista.xlsx -> ads-seguro", detectDailySource(headerOf(DL + "/Prestamista.xlsx")) === "ads-seguro");
  // sintéticos (não tenho a diária de crédito snake_case nem uma Promotiva à mão)
  ok("headers snake_case -> ads-credito", detectDailySource({ sheetNames: ["Total"], headers: ["cd_mci_correspondente", "nu_proposta", "cd_chave_j_operador", "vl_solicitado"] }) === "ads-credito");
  ok("headers Promotiva (MCI+Proposta) -> promotiva", detectDailySource({ sheetNames: ["Plan1"], headers: ["Data Movimento", "MCI", "Chave J", "Proposta", "Valor Financiado"] }) === "promotiva");
  ok("Crédito ADS-BBTS.xlsx (fechamento PDF-export) -> null (não é diária)", detectDailySource(headerOf(DL + "/Crédito ADS-BBTS.xlsx")) === null);

  // READ-ONLY: um TESTE nao grava em producao. O import roda em dryRun:true (so
  // PROJETA); a classificacao prod_segurada e provada pelos contadores do dry-run
  // (res.seguradas/res.nao_seguradas, computados no parser antes de qualquer
  // escrita), e o read-back confere contra o dado JA importado pela via oficial.
  console.log("\n=== ITEM 3 — B) DRY-RUN Prestamista (1).xlsx (prod_segurada, NADA gravado) ===\n");
  const wb = XLSX.read(fs.readFileSync(DL + "/Prestamista (1).xlsx"), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Prestamista"]);
  const esperado = new Map(); // contrato -> segurada?
  for (const r of rows) {
    const contrato = String(r["Contrato"]).trim();
    esperado.set(contrato, Boolean(r["Seguro"] && String(r["Seguro"]).trim()));
  }
  const seguradasEsperadas = [...esperado.values()].filter(Boolean).length;
  console.log("propostas no arquivo:", rows.length, "| seguradas esperadas:", seguradasEsperadas);

  const res = await importAdsSeguroDaily(sb, { rows, fileName: "Prestamista (1).xlsx", dryRun: true });
  console.log(`DRY-RUN: processadas=${res.processadas} seguradas=${res.seguradas} nao_seguradas=${res.nao_seguradas} inseriria=${res.inseridas} atualizaria=${res.atualizadas} pularia=${res.puladas} (NADA gravado)`);
  if (res.vfin_divergente.length) console.log("avisos vfin divergente:", JSON.stringify(res.vfin_divergente));

  // Prova da classificacao SEM gravar: os contadores do parser (dry-run) batem
  // com o esperado do arquivo.
  ok("parser classifica seguradas certo (dry-run)", res.seguradas === seguradasEsperadas, `res.seguradas=${res.seguradas} esperado=${seguradasEsperadas}`);

  // read-back: confere contra o dado JA importado pela via oficial (read-only)
  const contratos = [...esperado.keys()];
  const { data: got } = await sb.from("daily_production_records")
    .select("proposal_number, prod_segurada, insurance_type, insurance_value, has_insurance, insurance_number")
    .eq("company_id", ADS).in("proposal_number", contratos);
  const gotBy = new Map((got || []).map((g) => [String(g.proposal_number), g]));

  console.log("\n  contrato        Seguro(arquivo)  prod_segurada(db)  tipo         base");
  let mismatch = 0, seguradaComLinha = 0;
  for (const [contrato, seg] of esperado) {
    const g = gotBy.get(contrato);
    const dbSeg = g ? g.prod_segurada : "(sem linha)";
    console.log(`  ${contrato.padEnd(15)} ${String(seg).padEnd(16)} ${String(dbSeg).padEnd(18)} ${String(g?.insurance_type ?? "-").padEnd(12)} ${g ? Number(g.insurance_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "-"}`);
    if (seg) {
      seguradaComLinha += g ? 1 : 0;
      if (!g || g.prod_segurada !== true) { mismatch++; }
    } else {
      // não-segurada: se tem linha (crédito já existia), prod_segurada deve ser false; se não tem, ok (não cria fantasma)
      if (g && g.prod_segurada !== false) mismatch++;
    }
  }
  ok("toda proposta SEGURADA tem prod_segurada=true", mismatch === 0 && seguradaComLinha === [...esperado.values()].filter(Boolean).length, `mismatch=${mismatch}`);
  ok("nenhuma NÃO-segurada ficou prod_segurada=true", mismatch === 0);

  console.log(`\n=== ${pass} passaram, ${fail} falharam ===`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
