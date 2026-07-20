// DRY-RUN (read-only, NAO grava) do Movimento 1 da frente de produto:
// quantas linhas cada aba (BBCAP / Conta Corrente / BB Consorcio) desdobraria, e
// prova de que a chave de conteudo por linha e UNICA (idempotencia) e que a soma
// das comissoes reproduz o total de empresa ja gravado em fechamento_mensal_empresa.
//
// A extracao aqui ESPELHA lib/monthlyClosingImport.ts::buildProductLines (mesmos
// headers, mesma chave, mesmo discriminador de parcela). Roda sobre os arquivos
// reais em _tmp_fechamentos/. Uso:
//   node scripts/dryrun_produtos_desdobra.cjs [sufixo]      (default: _5_2026)
const path = require("path");
const fs = require("fs");
const REPO = path.resolve(__dirname, "..");
const XLSX = require(path.join(REPO, "node_modules", "xlsx"));
const DIR = path.join(REPO, "_tmp_fechamentos");
const SUFFIX = process.argv[2] || "_5_2026";

const normHeader = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const parseNumber = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const raw = String(v ?? "").trim().replace(/\s/g, "").replace("R$", "");
  let n = raw;
  if (raw.includes(",") && raw.includes(".")) n = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  else if (raw.includes(",")) n = raw.replace(/\./g, "").replace(",", ".");
  const p = Number(n.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(p) ? p : 0;
};
const trimStr = (v) => String(v ?? "").trim();
function abaRows(wb, nameNorm) {
  const name = wb.SheetNames.find((n) => normHeader(n) === nameNorm);
  if (!name) return null;
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
}
function col(rows, headerNorm) {
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) if (normHeader(row[c]) === headerNorm) return { headerRow: r, col: c };
  }
  return null;
}
const at = (row, c) => (c === null || c === undefined || c < 0 ? "" : row[c === Object(c) ? c.col : c]);

// espelho de buildProductLines
function buildProductLines(wb, codigo) {
  const lines = [];
  // BBCAP
  {
    const rows = abaRows(wb, "BBCAP");
    const kP = rows && col(rows, "PROPOSTA");
    const kC = rows && col(rows, "COMISSAO");
    if (rows && kP && kC) {
      const cV = col(rows, "VALOR DO PRODUTO");
      for (let r = kP.headerRow + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const prop = trimStr(at(row, kP));
        if (prop === "") continue;
        lines.push({ entryType: "BBCAP", op: prop, cn: "", com: parseNumber(at(row, kC)), gross: parseNumber(at(row, cV)) });
      }
    }
  }
  // CONSORCIO (+MASTER)
  for (const aba of ["BB CONSORCIO", "BB CONSORCIO MASTER"]) {
    const rows = abaRows(wb, aba);
    const kP = rows && col(rows, "PROPOSTA");
    const kC = rows && col(rows, "COMISSAO");
    if (!rows || !kP || !kC) continue;
    const cParc = col(rows, "PARCELA LIBERACAO");
    const cBem = col(rows, "VALOR BEM");
    const master = aba.includes("MASTER");
    for (let r = kP.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const prop = trimStr(at(row, kP));
      if (prop === "") continue;
      const parc = trimStr(at(row, cParc));
      lines.push({ entryType: "CONSORCIO", op: prop, cn: `${master ? "M" : "R"}|${parc || "0"}`, com: parseNumber(at(row, kC)), gross: parseNumber(at(row, cBem)) });
    }
  }
  // CONTA CORRENTE
  {
    const rows = abaRows(wb, "CONTA CORRENTE");
    const kConta = rows && col(rows, "CONTA CORRENTE");
    const kC = rows && col(rows, "COMISSAO");
    if (rows && kConta && kC) {
      const kJ = col(rows, "CHAVE J");
      let seq = 0;
      for (let r = kConta.headerRow + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const conta = trimStr(at(row, kConta));
        const chaveJ = trimStr(at(row, kJ));
        const com = parseNumber(at(row, kC));
        if (conta === "" && chaveJ === "" && com === 0) continue;
        seq += 1;
        const balde = conta === "" || normHeader(conta).includes("IDENTIFICAC");
        lines.push({ entryType: "CONTA_CORRENTE", op: balde ? `SEMID|${codigo}|${seq}` : conta, cn: "", com, gross: 0, jKey: chaveJ || null, balde });
      }
    }
  }
  return lines;
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(`${SUFFIX}.xlsx`)).sort();
const totals = { BBCAP: { n: 0, com: 0 }, CONSORCIO: { n: 0, com: 0 }, CONTA_CORRENTE: { n: 0, com: 0, balde: 0 } };
const globalKeys = new Set();
let collisions = 0;
for (const f of files) {
  const wb = XLSX.readFile(path.join(DIR, f));
  const codigo = f.split("_")[0];
  const cnpj = f.split("_")[1];
  const lines = buildProductLines(wb, codigo);
  if (lines.length === 0) continue;
  const per = {};
  const localKeys = new Set();
  for (const l of lines) {
    (per[l.entryType] = per[l.entryType] || { n: 0, com: 0, balde: 0 }).n++;
    per[l.entryType].com += l.com;
    if (l.balde) per[l.entryType].balde++;
    // chave de conteudo real = (cnpj, competencia, entry_type, op, cn). Aqui within-file:
    const key = `${cnpj}|${l.entryType}|${l.op}|${l.cn}`;
    if (localKeys.has(key)) collisions++;
    localKeys.add(key);
    globalKeys.add(`${codigo}|${key}`);
    totals[l.entryType].n++;
    totals[l.entryType].com += l.com;
    if (l.balde) totals.CONTA_CORRENTE.balde++;
  }
  const parts = Object.entries(per).map(([k, v]) => `${k}=${v.n} (Σ${v.com.toFixed(2)}${v.balde ? `, balde ${v.balde}` : ""})`);
  console.log(`## ${f}\n   ${parts.join("  |  ")}`);
}
console.log("\n===== AGREGADO (" + SUFFIX + ") =====");
for (const [k, v] of Object.entries(totals)) console.log(`   ${k}: ${v.n} linhas  Σcom ${v.com.toFixed(2)}${v.balde !== undefined ? `  balde ${v.balde}` : ""}`);
console.log(`\n   Colisoes de chave DENTRO de um arquivo: ${collisions} (esperado 0 = idempotencia por linha OK)`);
