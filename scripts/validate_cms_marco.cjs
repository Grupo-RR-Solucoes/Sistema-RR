/*
 * CMS-IMPORT.A3 — validacao do import do cms de MARCO/2026 (4 CNPJs).
 *
 * NAO escreve nas tabelas novas (cms_imports / cms_promoter_entries) — elas
 * ainda nao foram aplicadas no banco (Diego roda a migration no Studio). Este
 * script apenas:
 *   - faz o parsing dos 4 arquivos com o MESMO algoritmo de lib/cmsImport.ts
 *     (cabecalho por NOME, ultima col COMISSAO SEGURO = repasse, pula GERAL,
 *      pula linhas TOTAL/CANCELAMENTO, exclui JJJ552710);
 *   - resolve empresa (token do nome) e promotor (CHAVE J -> j_keys, fallback
 *     nome da aba) contra o banco em modo SOMENTE LEITURA;
 *   - imprime relatorio mapeadas vs nao-mapeadas por CNPJ;
 *   - prova o aceite: Thaynara (JJ177329, PE) = 14.889,29 + 1.162,28 = 16.051,57.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

// ---- .env ----
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

// ---- helpers (espelham lib/cmsImport.ts) ----
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value).trim().replace(/\s/g, "").replace("R$", "");
  let n = raw;
  if (raw.includes(",") && raw.includes(".")) {
    n =
      raw.lastIndexOf(",") > raw.lastIndexOf(".")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "");
  } else if (raw.includes(",")) {
    n = raw.replace(/\./g, "").replace(",", ".");
  }
  const p = Number(n.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(p) ? p : 0;
}

const MONTHS = { JANEIRO:1,FEVEREIRO:2,MARCO:3,ABRIL:4,MAIO:5,JUNHO:6,JULHO:7,AGOSTO:8,SETEMBRO:9,OUTUBRO:10,NOVEMBRO:11,DEZEMBRO:12 };
const TOKEN_NAME = { AL1:"ALAGOAS 1", AL2:"ALAGOAS 2", AL3:"ALAGOAS 3", PE:"PERNAMBUCO" };
const EXCLUDED = new Set(["JJJ552710"]);
const ALIASES = { MONALIZA:"MONALISA", JARLLES:"JARLES" };

function extractToken(fileName) {
  const c = norm(fileName).replace(/AL\s+(\d)/g, "AL$1");
  if (/(^|[^A-Z0-9])AL1([^A-Z0-9]|$)/.test(c)) return "AL1";
  if (/(^|[^A-Z0-9])AL2([^A-Z0-9]|$)/.test(c)) return "AL2";
  if (/(^|[^A-Z0-9])AL3([^A-Z0-9]|$)/.test(c)) return "AL3";
  if (/(^|[^A-Z0-9])PE([^A-Z0-9]|$)/.test(c)) return "PE";
  return null;
}
function extractCompetencia(fileName) {
  const t = norm(fileName);
  let mo = 0;
  for (const [k, v] of Object.entries(MONTHS)) if (t.includes(k)) { mo = v; break; }
  const y = t.match(/(20\d{2})/);
  return mo && y ? { prodYear: Number(y[1]), prodMonth: mo } : null;
}

function findHeaderMap(matrix) {
  for (let r = 0; r < Math.min(matrix.length, 12); r++) {
    const cells = (matrix[r] || []).map(norm);
    if (cells.includes("CONTRATO") && cells.includes("CHAVE J")) {
      let seguroLast = -1;
      cells.forEach((c, i) => { if (c === "COMISSAO SEGURO" || c === "COMISSAO SEGURO2") seguroLast = i; });
      return {
        headerRow: r,
        contrato: cells.indexOf("CONTRATO"),
        bruto: cells.indexOf("VALOR BRUTO"),
        liquido: cells.indexOf("VALOR LIQUIDO"),
        chaveJ: cells.indexOf("CHAVE J"),
        promotor: cells.indexOf("PROMOTOR(A)"),
        promCred: cells.indexOf("COMISSAO PROMOTOR"),
        promSeg: seguroLast,
      };
    }
  }
  return null;
}

function parseWorkbook(buffer, fileName) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const token = extractToken(fileName);
  const comp = extractCompetencia(fileName);
  const entries = [];
  const skipped = [];
  let excluded = 0, totalRows = 0;
  for (const name of wb.SheetNames) {
    if (norm(name) === "GERAL") { skipped.push(name); continue; }
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const h = findHeaderMap(matrix);
    if (!h || h.promCred < 0 || h.promSeg < 0) { skipped.push(name); continue; }
    for (let r = h.headerRow + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const contrato = String(row[h.contrato] ?? "").trim();
      if (!/^\d+$/.test(contrato)) continue;
      totalRows++;
      const jKey = String(row[h.chaveJ] ?? "").trim() || null;
      if (jKey && EXCLUDED.has(jKey.toUpperCase())) { excluded++; continue; }
      entries.push({
        sheetName: name,
        jKey,
        contract: contrato,
        promoterCredit: parseNumber(row[h.promCred]),
        promoterInsurance: parseNumber(row[h.promSeg]),
      });
    }
  }
  return { token, comp, entries, skipped, excluded, totalRows };
}

(async () => {
  const [coRes, jkRes, prRes] = await Promise.all([
    sb.from("companies").select("id, name, cnpj").order("name"),
    sb.from("j_keys").select("j_key, promoter_id"),
    sb.from("promoters").select("id, name"),
  ]);
  if (coRes.error || jkRes.error || prRes.error)
    throw new Error((coRes.error||jkRes.error||prRes.error).message);

  const companies = coRes.data;
  const jKeyToPromoter = new Map();
  for (const k of jkRes.data) if (k.j_key && k.promoter_id) jKeyToPromoter.set(k.j_key.trim().toUpperCase(), k.promoter_id);

  const nameCount = new Map(), nameToId = new Map();
  for (const p of prRes.data) { const key = norm(p.name); if (!key) continue; nameCount.set(key, (nameCount.get(key)||0)+1); nameToId.set(key, p.id); }
  const promoterByName = new Map();
  for (const [k, id] of nameToId) if (nameCount.get(k) === 1) promoterByName.set(k, id);
  const promoterNameById = new Map(prRes.data.map((p) => [p.id, p.name]));

  function resolveCompany(token) {
    const needle = TOKEN_NAME[token];
    return companies.find((c) => norm(c.name).includes(needle)) || null;
  }
  function resolveBySheet(sheet) {
    const n = norm(sheet).split(/\s+/).map((t) => ALIASES[t] || t).join(" ");
    if (promoterByName.get(n)) return promoterByName.get(n);
    const matches = [];
    for (const [name, id] of promoterByName) if (name === n || name.startsWith(n + " ")) matches.push(id);
    const u = [...new Set(matches)];
    return u.length === 1 ? u[0] : null;
  }

  const fmt = (x) => x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  console.log("================ RELATORIO IMPORT cms MARCO/2026 ================\n");

  let thaynaraCredit = 0, thaynaraInsurance = 0;
  const thaynaraId = jKeyToPromoter.get("JJ177329");

  for (const file of FILES) {
    const full = path.join(DOWNLOADS, file);
    if (!fs.existsSync(full)) { console.log("!! ARQUIVO AUSENTE:", file, "\n"); continue; }
    const parsed = parseWorkbook(fs.readFileSync(full), file);
    const company = resolveCompany(parsed.token);

    let mapped = 0, unmapped = 0, sumCred = 0, sumIns = 0;
    const unmappedDetail = [];
    const sheetCache = new Map();
    for (const e of parsed.entries) {
      sumCred += e.promoterCredit; sumIns += e.promoterInsurance;
      let pid = e.jKey ? jKeyToPromoter.get(e.jKey.toUpperCase()) : null;
      let src = pid ? "J_KEY" : null;
      if (!pid) {
        if (!sheetCache.has(e.sheetName)) sheetCache.set(e.sheetName, resolveBySheet(e.sheetName));
        pid = sheetCache.get(e.sheetName);
        if (pid) src = "SHEET_NAME";
      }
      if (pid) {
        mapped++;
        if (thaynaraId && pid === thaynaraId) { thaynaraCredit += e.promoterCredit; thaynaraInsurance += e.promoterInsurance; }
      } else {
        unmapped++;
        unmappedDetail.push(`     aba="${e.sheetName}" chaveJ=${e.jKey || "(vazia)"} contrato=${e.contract}`);
      }
    }

    console.log(`### ${parsed.token}  ->  ${company ? company.name + " (" + company.cnpj + ")" : "EMPRESA NAO RESOLVIDA"}`);
    console.log(`    arquivo: ${file}`);
    console.log(`    competencia (do nome): ${parsed.comp ? String(parsed.comp.prodMonth).padStart(2,"0") + "/" + parsed.comp.prodYear : "NAO RESOLVIDA"}`);
    console.log(`    abas puladas (GERAL/sem cabecalho): ${parsed.skipped.join(", ") || "(nenhuma)"}`);
    console.log(`    linhas de contrato lidas: ${parsed.totalRows}  | excluidas (JJJ552710): ${parsed.excluded}`);
    console.log(`    entries: ${parsed.entries.length}  | MAPEADAS: ${mapped}  | NAO-MAPEADAS: ${unmapped}`);
    console.log(`    Σ COMISSAO PROMOTOR: ${fmt(sumCred)}  | Σ COMISSAO SEGURO (repasse): ${fmt(sumIns)}`);
    if (unmappedDetail.length) {
      console.log(`    -- nao-mapeadas (relatorio de erro, NAO silenciado) --`);
      console.log(unmappedDetail.join("\n"));
    }
    console.log("");
  }

  console.log("================ TESTE DE ACEITE — THAYNARA (JJ177329, PE) ================");
  console.log(`  promoter_id JJ177329: ${thaynaraId || "NAO ENCONTRADO"} (${thaynaraId ? promoterNameById.get(thaynaraId) : ""})`);
  console.log(`  Σ promoter_credit    = ${fmt(thaynaraCredit)}   (esperado 14.889,29)`);
  console.log(`  Σ promoter_insurance = ${fmt(thaynaraInsurance)}    (esperado 1.162,28)`);
  console.log(`  TOTAL                = ${fmt(thaynaraCredit + thaynaraInsurance)}   (esperado 16.051,57)`);
  const ok = fmt(thaynaraCredit + thaynaraInsurance) === "16.051,57";
  console.log(`  ACEITE: ${ok ? "✅ PASSOU" : "❌ FALHOU"}`);
})().catch((e) => { console.error(e); process.exit(1); });
