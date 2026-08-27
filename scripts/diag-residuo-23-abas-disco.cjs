/* READ-ONLY. TODO xlsx de fechamento em disco: abas (nome exato) e o que a aba
   RESUMO declara como "Comissao Seguros". Testa a hipotese de que a aba de
   seguro existe com OUTRO NOME e o inferSheetType (includes "SEGURO") nao acha. */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const RAIZES = [
  "C:/Users/diego/Downloads",
  "C:/Users/diego/Downloads/RRCRED",
  "C:/Users/diego/Documents",
];
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
const num = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let r = String(v).trim().replace(/\s/g, "").replace("R$", "");
  if (r.includes(",") && r.includes(".")) r = r.lastIndexOf(",") > r.lastIndexOf(".") ? r.replace(/\./g, "").replace(",", ".") : r.replace(/,/g, "");
  else if (r.includes(",")) r = r.replace(/\./g, "").replace(",", ".");
  const n = Number(r);
  return Number.isFinite(n) ? n : 0;
};

function varrer(dir, prof) {
  const out = [];
  if (prof > 3) return out;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...varrer(p, prof + 1));
    else if (/\.xlsx$/i.test(e.name) && !/^~\$/.test(e.name)) out.push(p);
  }
  return out;
}

(async () => {
  const arquivos = [...new Set(RAIZES.flatMap((r) => varrer(r, 0)))];
  console.log(`xlsx varridos: ${arquivos.length}\n`);

  let comResumo = 0;
  for (const p of arquivos) {
    let wb;
    try { wb = XLSX.readFile(p, { sheetRows: 200 }); } catch { continue; }
    const temResumo = wb.SheetNames.some((n) => norm(n) === "RESUMO");
    if (!temResumo) continue;
    comResumo++;
    console.log(`### ${p}`);
    console.log(`  ABAS (${wb.SheetNames.length}): ${wb.SheetNames.map((n) => JSON.stringify(n)).join(", ")}`);
    // quais abas o inferSheetType classificaria
    const cls = (n) => {
      const x = norm(n);
      if (x.includes("A VISTA") || x.includes("AVISTA")) return "CASH";
      if (x.includes("SEGURO")) return "INSURANCE";
      if (x.includes("DEBIT")) return "DEBIT";
      if (x.includes("PRT") || x.includes("DIFERID")) return "PRT";
      if (x.includes("CREDITO")) return "CREDIT";
      return "OTHER";
    };
    const mapa = wb.SheetNames.map((n) => `${JSON.stringify(n)}->${cls(n)}`);
    console.log(`  inferSheetType: ${mapa.join(", ")}`);
    const insAbas = wb.SheetNames.filter((n) => cls(n) === "INSURANCE");
    console.log(`  abas que viram INSURANCE: ${insAbas.length ? insAbas.map((n) => JSON.stringify(n)).join(", ") : "NENHUMA  <<<"}`);

    // RESUMO: rotulos e valores
    const rname = wb.SheetNames.find((n) => norm(n) === "RESUMO");
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[rname], { header: 1, defval: "" });
    const achados = [];
    for (const row of rows) {
      row.forEach((cell, i) => {
        const lab = norm(cell);
        if (["COMISSAO A VISTA", "COMISSAO SEGUROS", "COMISSAO PRT", "CANCELAMENTO SEGURO", "PRT ESTOQUE SEGURO", "CREDITO", "DEBITO"].includes(lab)) {
          const v = num(row[i + 1]) || num(row[i + 2]) || num(row[i + 3]);
          achados.push(`${lab}=${f(v)}`);
        }
      });
    }
    console.log(`  RESUMO: ${achados.length ? achados.join("  |  ") : "(nenhum rotulo conhecido)"}`);
    console.log("");
  }
  console.log(`arquivos com aba RESUMO: ${comResumo}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
