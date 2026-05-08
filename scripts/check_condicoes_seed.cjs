#!/usr/bin/env node
/**
 * Investiga Condição 2 (Δ R$ 0,02) e Condição reconciliação (mes vs mes×cnpj)
 * sem alterar nada. Apenas leitura do XLSX.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const XLSX_PATH = path.resolve(__dirname, "..", "auditorias", "RELATORIO_AUDITORIA_FINAL_v9.xlsx");
console.log(`Lendo XLSX: ${XLSX_PATH}\n`);
const wb = XLSX.readFile(XLSX_PATH, { dense: true, cellDates: false });

function loadSheet(name) {
  const ws = wb.Sheets[name];
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const all = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    range: { s: { r: range.s.r + 1, c: range.s.c }, e: range.e },
    raw: true, blankrows: false, defval: null,
  });
  if (!all.length) return [];
  const headers = all[0].map((h) => (h == null ? "" : String(h)));
  return all.slice(1).map((row) => {
    const o = {};
    headers.forEach((h, i) => (o[h] = row[i]));
    return o;
  });
}

// =====================================================================
// CONDIÇÃO 2 — Investigar Δ R$ 0,02 no Bloco 2.1
// =====================================================================
console.log("=== CONDIÇÃO 2: investigar Δ R$ 0,02 no Bloco 2.1 ===\n");
const solReg21 = loadSheet("Solicitação Regularização 2.1");
console.log(`Linhas em "Solicitação Regularização 2.1": ${solReg21.length}`);

// Somar valores RAW (Number nativo do XLSX, sem manipulação)
let sumRaw = 0;
let sumRawNumberType = 0;
let sumRawJSStringy = 0;
let perBloco = new Map();
let nullCount = 0;
let nonNumberCount = 0;

for (const r of solReg21) {
  const v = r["Valor Solicitação Regularização (R$)"];
  if (v == null) { nullCount += 1; continue; }
  const bloco = r["Bloco"] || "(null)";
  if (typeof v === "number") {
    sumRaw += v;
    sumRawNumberType += v;
    perBloco.set(bloco, (perBloco.get(bloco) || 0) + v);
  } else {
    nonNumberCount += 1;
    const n = Number(String(v).replace(",", "."));
    if (Number.isFinite(n)) {
      sumRaw += n;
      sumRawJSStringy += n;
      perBloco.set(bloco, (perBloco.get(bloco) || 0) + n);
    }
  }
}

console.log(`\nSoma RAW (sem arredondamento, Number nativo XLSX):`);
console.log(`  Σ total Bloco 2.1 (todas as linhas): R$ ${sumRaw}`);
console.log(`  Σ total formatado (toFixed 2): R$ ${sumRaw.toFixed(2)}`);
console.log(`  Σ total formatado (toFixed 6): R$ ${sumRaw.toFixed(6)}`);
console.log(`  Linhas com valor Number nativo: ${solReg21.length - nullCount - nonNumberCount}`);
console.log(`  Linhas null: ${nullCount}`);
console.log(`  Linhas string-stringy: ${nonNumberCount}`);

console.log(`\nPor bloco (raw):`);
for (const [b, s] of perBloco) console.log(`  ${b}: R$ ${s.toFixed(6)} (${s})`);

console.log(`\nEsperado v9: R$ 60.040,89`);
console.log(`\nDelta vs esperado: R$ ${(sumRaw - 60040.89).toFixed(6)}`);

// Agora repete simulando round2 por linha
let sumRound2 = 0;
for (const r of solReg21) {
  const v = r["Valor Solicitação Regularização (R$)"];
  if (typeof v !== "number") continue;
  const r2 = Math.round(v * 100) / 100;
  sumRound2 += r2;
}
console.log(`\nSoma após round2 por linha: R$ ${sumRound2.toFixed(6)}`);
console.log(`Diferença round2 vs raw: R$ ${(sumRound2 - sumRaw).toFixed(6)}`);

// Ver alguns valores individuais com mais decimais para entender
console.log(`\nAmostra de 10 valores individuais (mostrar precisão XLSX):`);
let n = 0;
for (const r of solReg21) {
  const v = r["Valor Solicitação Regularização (R$)"];
  if (typeof v !== "number") continue;
  if (n++ >= 10) break;
  console.log(`  contrato=${r["Contrato"]} valor=${v} (toFixed 10: ${v.toFixed(10)})`);
}

// =====================================================================
// Reconciliação — estrutura
// =====================================================================
console.log("\n\n=== RECONCILIAÇÃO CAIXA: estrutura real ===\n");
const reconc = loadSheet("Reconciliação Caixa");
console.log(`Linhas: ${reconc.length}`);
if (reconc.length > 0) {
  const headers = Object.keys(reconc[0]);
  console.log(`Headers: ${headers.join(" | ")}`);
  console.log(`\nPrimeiras 3 linhas:`);
  for (const r of reconc.slice(0, 3)) {
    console.log(`  ${JSON.stringify(r, null, 2)}`);
  }
  // Verifica se há coluna CNPJ ou Empresa
  const hasCnpj = headers.some((h) => /CNPJ|cnpj|Empresa|empresa/i.test(h));
  console.log(`\nColuna CNPJ/Empresa presente? ${hasCnpj ? "SIM" : "NÃO"}`);

  // Se 41 linhas + sem CNPJ → consolidado por mês
  // Se >41 linhas → mes × cnpj
  if (reconc.length === 41 && !hasCnpj) {
    console.log("=> Estrutura: 1 linha por mês (consolidado, sem quebra por CNPJ)");
  } else if (reconc.length > 41) {
    console.log("=> Estrutura: múltiplas linhas por mês (provável mes × cnpj)");
  } else {
    console.log("=> Estrutura: ambígua, investigar manualmente");
  }
}
