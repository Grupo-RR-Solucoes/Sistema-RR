#!/usr/bin/env node
/**
 * scripts/check_tx_juros_min.cjs — Validação extra 1.
 *
 * Para cada um dos 41 JSONs em regras_promotiva/json/, varre todas as
 * categorias procurando tx_juros_min. Para cada uma encontrada, executa
 * 3 testes de borda:
 *   - taxa = tx_juros_min - 0.0001 → esperado: null (FORA_DA_TABELA)
 *   - taxa = tx_juros_min          → esperado: pct válido (limite inclusivo)
 *   - taxa = tx_juros_min + 0.0001 → esperado: pct válido
 *
 * Se algum mês falhar, sai com exit 1.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REGRAS_DIR = path.join(ROOT, "regras_promotiva", "json");
const EPS = 1e-7;

function inRange(valor, min, max) {
  const lo = typeof min === "number" ? min - EPS : -Infinity;
  const hi = typeof max === "number" ? max + EPS : Infinity;
  return valor >= lo && valor <= hi;
}

function lookupPctInRegra(regra, categoriaProduto, taxa, prazo, tabLabel) {
  const cat = regra[categoriaProduto];
  if (!cat || typeof cat !== "object") return { pct: null };
  if (typeof cat.tx_juros_min === "number" && taxa < cat.tx_juros_min - EPS) {
    return { pct: null, motivo: "FORA_DA_TABELA_tx_juros_min" };
  }
  if (typeof cat.prazo_min === "number" && prazo < cat.prazo_min) return { pct: null, motivo: "prazo<min" };
  if (typeof cat.prazo_max === "number" && prazo > cat.prazo_max) return { pct: null, motivo: "prazo>max" };
  if (typeof cat.pct_geral === "number" && tabLabel === "pct_geral") return { pct: cat.pct_geral };
  const matriz = cat.celulas_taxa_prazo || cat.celulas_taxa || cat.celulas_prazo || cat.celulas;
  if (!matriz || matriz.length === 0) return { pct: null, motivo: "sem_matriz" };
  for (const c of matriz) {
    if (!inRange(taxa, c.tx_min, c.tx_max)) continue;
    if (!inRange(prazo, c.prazo_min, c.prazo_max)) continue;
    if (tabLabel === "pct_geral" && typeof c.pct_geral === "number") return { pct: c.pct_geral };
    const pct = c[tabLabel];
    if (typeof pct === "number") return { pct };
  }
  return { pct: null, motivo: "celula_nao_match" };
}

function pickTabLabel(cat, regra) {
  // Pega uma tabLabel válida para essa categoria — primeira chave de "Tabela X"
  // ou "Faixa X" ou "Rubi/Safira/Diamante" presente em alguma célula.
  const matriz = cat.celulas_taxa_prazo || cat.celulas_taxa || cat.celulas_prazo || cat.celulas;
  if (!matriz || !matriz.length) return null;
  for (const c of matriz) {
    for (const k of Object.keys(c)) {
      if (["tx_min", "tx_max", "prazo_min", "prazo_max", "pct_geral"].includes(k)) continue;
      if (typeof c[k] === "number") return k;
    }
  }
  return null;
}

function pickPrazoValido(cat) {
  // Busca um prazo dentro do intervalo válido da categoria
  const matriz = cat.celulas_taxa_prazo || cat.celulas_taxa || cat.celulas_prazo || cat.celulas;
  if (matriz && matriz.length) {
    const c = matriz.find(
      (cell) => typeof cell.prazo_min === "number" || typeof cell.prazo_max === "number"
    );
    if (c) {
      const min = typeof c.prazo_min === "number" ? c.prazo_min : 1;
      const max = typeof c.prazo_max === "number" ? c.prazo_max : 999;
      return Math.min(min + 1, max);
    }
  }
  if (typeof cat.prazo_min === "number") return cat.prazo_min + 1;
  return 12; // default seguro
}

const arquivos = fs.readdirSync(REGRAS_DIR).filter((f) => f.endsWith(".json")).sort();

const reportRows = [];
let totalCategorias = 0;
let totalTestes = 0;
let totalOk = 0;
let totalFail = 0;
const falhas = [];

for (const arq of arquivos) {
  const regra = JSON.parse(fs.readFileSync(path.join(REGRAS_DIR, arq), "utf8"));
  if (!regra || typeof regra !== "object") continue;
  for (const catName of Object.keys(regra)) {
    if (catName === "_meta") continue;
    const cat = regra[catName];
    if (!cat || typeof cat !== "object") continue;
    if (typeof cat.tx_juros_min !== "number") continue;
    totalCategorias += 1;
    const txMin = cat.tx_juros_min;
    const tabLabel = pickTabLabel(cat, regra);
    const prazo = pickPrazoValido(cat);
    if (!tabLabel) {
      reportRows.push({
        arq, cat: catName, txMin, tabLabel: null, prazo,
        ok: 0, falha: 1, motivo: "sem tabLabel detectada",
      });
      falhas.push(`${arq}::${catName} — sem tabLabel detectável`);
      totalFail += 1;
      continue;
    }
    // Teste A: taxa abaixo do mínimo → esperado null
    const a = lookupPctInRegra(regra, catName, txMin - 0.0001, prazo, tabLabel);
    // Teste B: taxa exata → esperado pct
    const b = lookupPctInRegra(regra, catName, txMin, prazo, tabLabel);
    // Teste C: taxa acima do mínimo → esperado pct
    const c = lookupPctInRegra(regra, catName, txMin + 0.0001, prazo, tabLabel);

    const okA = a.pct === null;
    const okB = b.pct !== null;
    const okC = c.pct !== null;
    const ok = (okA ? 1 : 0) + (okB ? 1 : 0) + (okC ? 1 : 0);
    totalTestes += 3;
    totalOk += ok;
    totalFail += 3 - ok;

    if (!okA) falhas.push(`${arq}::${catName} A: taxa ${txMin - 0.0001} deveria ser null mas retornou ${a.pct}`);
    if (!okB) falhas.push(`${arq}::${catName} B: taxa ${txMin} deveria retornar pct mas retornou null (motivo: ${b.motivo})`);
    if (!okC) falhas.push(`${arq}::${catName} C: taxa ${txMin + 0.0001} deveria retornar pct mas retornou null (motivo: ${c.motivo})`);

    reportRows.push({
      arq, cat: catName, txMin,
      txFixa: cat.tx_juros_fixa ?? "—",
      prazoMin: cat.prazo_min ?? "—",
      prazoMax: cat.prazo_max ?? "—",
      prazo, tabLabel, ok, falha: 3 - ok,
    });
  }
}

console.log("\n=== Validação 1: tx_juros_min em todos os meses ===");
console.log(`JSONs varridos: ${arquivos.length}`);
console.log(`Categorias com tx_juros_min: ${totalCategorias}`);
console.log("");
console.log("| Arquivo | Categoria | tx_juros_min | tx_juros_fixa | prazo_min | prazo_max | tabLabel | OK/3 |");
console.log("|---|---|---:|---:|---:|---:|---|---:|");
for (const r of reportRows) {
  console.log(
    `| ${r.arq} | ${r.cat} | ${r.txMin} | ${r.txFixa ?? "—"} | ${r.prazoMin ?? "—"} | ${r.prazoMax ?? "—"} | ${r.tabLabel} | ${r.ok}/3 |`
  );
}

console.log("");
console.log(`Testes totais: ${totalTestes}`);
console.log(`PASS: ${totalOk}`);
console.log(`FAIL: ${totalFail}`);

if (falhas.length > 0) {
  console.log("\n=== Falhas ===");
  for (const f of falhas) console.log(`- ${f}`);
  process.exit(1);
}
process.exit(0);
