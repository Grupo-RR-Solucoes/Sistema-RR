// FIX-1.E.4.B: lê o XLSX migracao_chaves_master_abril_2026.xlsx e
// imprime as 37 linhas com colunas relevantes. Script descartável.
import XLSX from "xlsx";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Excel pode estar com o arquivo aberto (lockfile ~$...); usar copia em /tmp.
const xlsxPath = process.env.MIGRACAO_XLSX || resolve(__dirname, "migracao_copy.xlsx");

const buf = fs.readFileSync(xlsxPath);
const wb = XLSX.read(buf, { type: "buffer" });
console.log("Sheets:", wb.SheetNames);

for (const sheetName of wb.SheetNames) {
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  console.log(`\n=== Sheet: ${sheetName} (${rows.length} rows) ===`);
  if (rows.length > 0) {
    console.log("Cols:", Object.keys(rows[0]));
    console.log(JSON.stringify(rows, null, 2));
  }
}
