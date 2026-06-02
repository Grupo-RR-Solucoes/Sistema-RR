/*
 * CMS-IMPORT.B3 — DRY-RUN read-only do PMR de MARCO/2026 (mes fechado).
 *
 * Mostra o promoter_monthly_results que SERIA gravado pelo branch 'cms' do
 * /api/calculate/monthly (SPEC §4), SEM gravar nada:
 *   production_commission_value = Σ promoter_credit    (por promoter_id)
 *   insurance_commission_value  = Σ promoter_insurance
 *   final_commission_value      = production + insurance  (sem 5,80/acordo/FIX-6/desconto)
 *
 * Fonte: como a migration do cms ainda NAO foi aplicada (cms_promoter_entries
 * inexistente no banco), o dry-run le os 4 arquivos do cms DIRETO (mesmo parser
 * de lib/cmsImport.ts e mesma agregacao do route) — o numero e identico ao que
 * a tabela conteria (validado na Fase A3). NENHUMA escrita no banco.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

for (const line of fs
  .readFileSync(path.join(__dirname, "..", ".env"), "utf8")
  .split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const DOWNLOADS = "C:/Users/diego/Downloads";
const FILES = [
  "PRODUÇÃO GERAL RR AL1 MARÇO 2026.xlsx",
  "PRODUÇÃO GERAL RR AL2 MARÇO 2026.xlsx",
  "PRODUÇÃO GERAL RR AL3 MARÇO 2026.xlsx",
  "PRODUÇÃO GERAL RR PE MARÇO 2026.xlsx",
];

const norm = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value).trim().replace(/\s/g, "").replace("R$", "");
  let n = raw;
  if (raw.includes(",") && raw.includes(".")) {
    n = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (raw.includes(",")) n = raw.replace(/\./g, "").replace(",", ".");
  const p = Number(n.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(p) ? p : 0;
}
const TOKEN_NAME = { AL1: "ALAGOAS 1", AL2: "ALAGOAS 2", AL3: "ALAGOAS 3", PE: "PERNAMBUCO" };
const EXCLUDED = new Set(["JJJ552710"]);
const ALIASES = { MONALIZA: "MONALISA", JARLLES: "JARLES" };
function extractToken(f) {
  const c = norm(f).replace(/AL\s+(\d)/g, "AL$1");
  if (/(^|[^A-Z0-9])AL1([^A-Z0-9]|$)/.test(c)) return "AL1";
  if (/(^|[^A-Z0-9])AL2([^A-Z0-9]|$)/.test(c)) return "AL2";
  if (/(^|[^A-Z0-9])AL3([^A-Z0-9]|$)/.test(c)) return "AL3";
  if (/(^|[^A-Z0-9])PE([^A-Z0-9]|$)/.test(c)) return "PE";
  return null;
}
function findHeaderMap(matrix) {
  for (let r = 0; r < Math.min(matrix.length, 12); r++) {
    const cells = (matrix[r] || []).map(norm);
    if (cells.includes("CONTRATO") && cells.includes("CHAVE J")) {
      let seguroLast = -1;
      cells.forEach((c, i) => { if (c === "COMISSAO SEGURO" || c === "COMISSAO SEGURO2") seguroLast = i; });
      return {
        headerRow: r, contrato: cells.indexOf("CONTRATO"), chaveJ: cells.indexOf("CHAVE J"),
        liquido: cells.indexOf("VALOR LIQUIDO"), valorSeguro: cells.indexOf("VALOR SEGURO"),
        promCred: cells.indexOf("COMISSAO PROMOTOR"), promSeg: seguroLast,
      };
    }
  }
  return null;
}
function parseWorkbook(buffer, fileName) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const token = extractToken(fileName);
  const entries = [];
  for (const name of wb.SheetNames) {
    if (norm(name) === "GERAL") continue;
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const h = findHeaderMap(matrix);
    if (!h || h.promCred < 0 || h.promSeg < 0) continue;
    for (let r = h.headerRow + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const contrato = String(row[h.contrato] ?? "").trim();
      if (!/^\d+$/.test(contrato)) continue;
      const jKey = String(row[h.chaveJ] ?? "").trim() || null;
      if (jKey && EXCLUDED.has(jKey.toUpperCase())) continue;
      entries.push({
        sheetName: name, jKey,
        net: parseNumber(row[h.liquido]),
        insurancePremium: parseNumber(row[h.valorSeguro]),
        promoterCredit: parseNumber(row[h.promCred]),
        promoterInsurance: parseNumber(row[h.promSeg]),
      });
    }
  }
  return { token, entries };
}

const fmt = (x) => x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

(async () => {
  const [coRes, jkRes, prRes] = await Promise.all([
    sb.from("companies").select("id, name, cnpj").order("name"),
    sb.from("j_keys").select("j_key, promoter_id"),
    sb.from("promoters").select("id, name, company_id"),
  ]);
  if (coRes.error || jkRes.error || prRes.error) throw new Error((coRes.error || jkRes.error || prRes.error).message);

  const companies = coRes.data;
  const jKeyToPromoter = new Map();
  for (const k of jkRes.data) if (k.j_key && k.promoter_id) jKeyToPromoter.set(k.j_key.trim().toUpperCase(), k.promoter_id);
  const nameCount = new Map(), nameToId = new Map();
  for (const p of prRes.data) { const key = norm(p.name); if (!key) continue; nameCount.set(key, (nameCount.get(key) || 0) + 1); nameToId.set(key, p.id); }
  const promoterByName = new Map();
  for (const [k, id] of nameToId) if (nameCount.get(k) === 1) promoterByName.set(k, id);
  const promoterById = new Map(prRes.data.map((p) => [p.id, p]));

  const resolveCompany = (t) => companies.find((c) => norm(c.name).includes(TOKEN_NAME[t])) || null;
  function resolveBySheet(sheet) {
    const n = norm(sheet).split(/\s+/).map((t) => ALIASES[t] || t).join(" ");
    if (promoterByName.get(n)) return promoterByName.get(n);
    const matches = [];
    for (const [name, id] of promoterByName) if (name === n || name.startsWith(n + " ")) matches.push(id);
    const u = [...new Set(matches)];
    return u.length === 1 ? u[0] : null;
  }

  // agregacao por promoter_id (mesma logica de consolidateMonthlyFromCms).
  const agg = new Map(); // promoterId -> {credit, insurance, companyId}
  let orphanCredit = 0, orphanInsurance = 0, orphanRows = 0;

  for (const file of FILES) {
    const full = path.join(DOWNLOADS, file);
    if (!fs.existsSync(full)) { console.log("!! ARQUIVO AUSENTE:", file); continue; }
    const parsed = parseWorkbook(fs.readFileSync(full), file);
    const company = resolveCompany(parsed.token);
    const sheetCache = new Map();
    for (const e of parsed.entries) {
      let pid = e.jKey ? jKeyToPromoter.get(e.jKey.toUpperCase()) : null;
      if (!pid) {
        if (!sheetCache.has(e.sheetName)) sheetCache.set(e.sheetName, resolveBySheet(e.sheetName));
        pid = sheetCache.get(e.sheetName);
      }
      if (!pid) { orphanCredit += e.promoterCredit; orphanInsurance += e.promoterInsurance; orphanRows++; continue; }
      // company_id do PMR = empresa-mãe do promotor (igual ao route), nao a do
      // arquivo — chaves MASTER aparecem em arquivos de outra empresa.
      const home = promoterById.get(pid);
      const a = agg.get(pid) || { credit: 0, insurance: 0, companyId: (home && home.company_id) || (company ? company.id : null) };
      a.credit += e.promoterCredit; a.insurance += e.promoterInsurance;
      agg.set(pid, a);
    }
  }

  // quadro ordenado por empresa e total desc
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const rows = [];
  for (const [pid, a] of agg) {
    const p = promoterById.get(pid);
    rows.push({
      company: companyName.get(a.companyId) || "?",
      promoter: p ? p.name : "(desconhecido)",
      credit: a.credit, insurance: a.insurance, total: a.credit + a.insurance,
    });
  }
  rows.sort((x, y) => (x.company < y.company ? -1 : x.company > y.company ? 1 : y.total - x.total));

  console.log("======================= DRY-RUN PMR cms — MARCO/2026 (mes fechado) =======================");
  console.log("  (read-only — NADA gravado em promoter_monthly_results)\n");
  console.log(pad("EMPRESA", 16) + pad("PROMOTOR", 34) + padL("CRÉDITO", 14) + padL("SEGURO", 13) + padL("TOTAL", 15));
  console.log("-".repeat(92));
  let curCompany = null, subCred = 0, subIns = 0, subTot = 0;
  let gCred = 0, gIns = 0, gTot = 0;
  const flushSub = () => {
    if (curCompany !== null) {
      console.log(pad("", 16) + pad("  » subtotal " + curCompany, 34) + padL(fmt(subCred), 14) + padL(fmt(subIns), 13) + padL(fmt(subTot), 15));
      console.log("");
    }
  };
  for (const r of rows) {
    if (r.company !== curCompany) { flushSub(); curCompany = r.company; subCred = subIns = subTot = 0; }
    console.log(pad(r.company, 16) + pad(r.promoter, 34) + padL(fmt(r.credit), 14) + padL(fmt(r.insurance), 13) + padL(fmt(r.total), 15));
    subCred += r.credit; subIns += r.insurance; subTot += r.total;
    gCred += r.credit; gIns += r.insurance; gTot += r.total;
  }
  flushSub();
  console.log("=".repeat(92));
  console.log(pad("", 16) + pad("TOTAL GERAL (" + rows.length + " promotores)", 34) + padL(fmt(gCred), 14) + padL(fmt(gIns), 13) + padL(fmt(gTot), 15));
  if (orphanRows > 0) {
    console.log(`\n  ⚠ ${orphanRows} linha(s) sem promotor mapeado (ficam com a empresa, NAO entram no PMR): ` +
      `crédito ${fmt(orphanCredit)} | seguro ${fmt(orphanInsurance)}`);
  }

  // ----- TESTE DE ACEITE -----
  const thaynaraId = jKeyToPromoter.get("JJ177329");
  const t = thaynaraId ? agg.get(thaynaraId) : null;
  const tc = t ? t.credit : 0, ti = t ? t.insurance : 0;
  console.log("\n================ TESTE DE ACEITE — THAYNARA (JJ177329, PE) ================");
  console.log(`  production_commission_value = ${fmt(tc)}   (esperado 14.889,29)`);
  console.log(`  insurance_commission_value  = ${fmt(ti)}    (esperado  1.162,28)`);
  console.log(`  final_commission_value      = ${fmt(tc + ti)}   (esperado 16.051,57)`);
  console.log(`  ACEITE: ${fmt(tc + ti) === "16.051,57" ? "✅ PASSOU" : "❌ FALHOU"}`);
})().catch((e) => { console.error(e); process.exit(1); });
