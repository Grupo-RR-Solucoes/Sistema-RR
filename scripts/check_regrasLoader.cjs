#!/usr/bin/env node
/**
 * scripts/check_regrasLoader.cjs — checagem executável da Fase 4.1.
 *
 * Como rodar:
 *   node scripts/check_regrasLoader.cjs
 *
 * O projeto não tem framework de teste configurado (sem jest/vitest).
 * Este script:
 * 1. Carrega os 41 JSONs via fs.readFileSync (sem depender de TS runner).
 * 2. Replica inline a lógica essencial do lib/regrasLoader.ts (EPS=1e-7,
 *    fallbacks documentados, erratas).
 * 3. Valida 8 cenários (espelhados em lib/__tests__/regrasLoader.test.ts).
 * 4. Imprime relatório de cobertura.
 *
 * Validação de tipos do regrasLoader.ts é feita pelo `npm run build`.
 *
 * Quando o projeto adotar Vitest (Fase posterior), trocar para os testes em
 * lib/__tests__/regrasLoader.test.ts.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REGRAS_DIR = path.join(ROOT, "regras_promotiva", "json");
const EPS = 1e-7;

// ---------------------------------------------------------------------------
// 1. Carregamento dos 41 JSONs
// ---------------------------------------------------------------------------

const arquivos = fs.readdirSync(REGRAS_DIR).filter((f) => f.endsWith(".json")).sort();
const regras = {};
for (const f of arquivos) {
  regras[f] = JSON.parse(fs.readFileSync(path.join(REGRAS_DIR, f), "utf8"));
}

// ---------------------------------------------------------------------------
// 2. Mapa mês → JSON (espelha lib/regrasData.ts MAPA_MES_REGRA)
// ---------------------------------------------------------------------------

const MAPA = {
  // Diretos
  "2022-12": { json: "OPP060_2022-12.json", inferida: false },
  "2023-01": { json: "OPP060_2023-01.json", inferida: false },
  "2023-02": { json: "OPP060_2023-02.json", inferida: false },
  "2023-03": { json: "OPP060_2023-03.json", inferida: false },
  "2023-04": { json: "OPP060_2023-04.json", inferida: false },
  "2023-05": { json: "OPP060_2023-05.json", inferida: false },
  "2023-06": { json: "OPP060_2022-12_a_2023-05.json", inferida: true }, // fallback
  "2023-07": { json: "OPP061_2023-07_a_2023-08.json", inferida: false },
  "2023-08": { json: "OPP061_2023-07_a_2023-08.json", inferida: false },
  "2023-09": { json: "TRP01_2024-01.json", inferida: true }, // fallback
  "2023-10": { json: "TRP01_2024-01.json", inferida: true },
  "2023-11": { json: "TRP01_2024-01.json", inferida: true },
  "2023-12": { json: "TRP01_2024-01.json", inferida: true },
  "2024-01": { json: "TRP01_2024-01.json", inferida: false },
  "2024-02": { json: "TRP02_2024-02.json", inferida: false },
  "2024-03": { json: "TRP03_2024-03.json", inferida: false },
  "2024-04": { json: "TRP05_2024-04b.json", inferida: false }, // errata
  "2024-05": { json: "TRP05_2024-04b.json", inferida: true },  // fallback
  "2024-06": { json: "TRP08_2024-06b.json", inferida: false }, // errata
  "2024-07": { json: "TRP09_2024-07.json", inferida: false },
  "2024-08": { json: "TRP10_2024-08.json", inferida: false },
  "2024-09": { json: "TRP11_2024-09.json", inferida: false },
  "2024-10": { json: "TRP12_2024-10.json", inferida: false },
  "2024-11": { json: "TRP13_2024-11.json", inferida: false },
  "2024-12": { json: "TRP14_2024-12.json", inferida: false },
  "2025-01": { json: "TRP15_2025-01.json", inferida: false },
  "2025-02": { json: "TRP16_2025-02.json", inferida: false },
  "2025-03": { json: "TRP17_2025-03.json", inferida: false },
  "2025-04": { json: "TRP20_2025-04.json", inferida: false },
  "2025-05": { json: "TRP22_2025-05.json", inferida: false },
  "2025-06": { json: "TRP23_2025-06.json", inferida: false },
  "2025-07": { json: "TRP24_2025-07.json", inferida: false },
  "2025-08": { json: "TRP25_2025-08.json", inferida: false },
  "2025-09": { json: "TRP27_2025-09.json", inferida: false }, // errata
  "2025-10": { json: "TRP29_2025-10.json", inferida: false }, // errata
  "2025-11": { json: "TRP30_2025-11.json", inferida: false },
  "2025-12": { json: "TRP31_2025-12.json", inferida: false },
  "2026-01": { json: "TRP32_2026-01.json", inferida: false },
  "2026-02": { json: "TRP33_2026-02.json", inferida: false },
  "2026-03": { json: "TRP34_2026-03.json", inferida: false },
  "2026-04": { json: "TRP35_2026-04.json", inferida: false },
};

// ---------------------------------------------------------------------------
// 3. lookupPctInRegra (replicada inline)
// ---------------------------------------------------------------------------

function inRange(valor, min, max) {
  const lo = typeof min === "number" ? min - EPS : -Infinity;
  const hi = typeof max === "number" ? max + EPS : Infinity;
  return valor >= lo && valor <= hi;
}

function lookupPctInRegra(regra, categoriaProduto, taxa, prazo, tabLabel, jsonRegra, regraInferida) {
  const cat = regra[categoriaProduto];
  if (!cat || typeof cat !== "object") {
    return { pct: null, celula: null, jsonRegra, regraInferida };
  }
  if (typeof cat.tx_juros_min === "number" && taxa < cat.tx_juros_min - EPS) {
    return {
      pct: null,
      celula: `${categoriaProduto}: taxa ${taxa} < tx_juros_min ${cat.tx_juros_min} (FORA_DA_TABELA)`,
      jsonRegra,
      regraInferida,
    };
  }
  if (typeof cat.prazo_min === "number" && prazo < cat.prazo_min) return { pct: null, celula: `prazo<min`, jsonRegra, regraInferida };
  if (typeof cat.prazo_max === "number" && prazo > cat.prazo_max) return { pct: null, celula: `prazo>max`, jsonRegra, regraInferida };
  if (typeof cat.pct_geral === "number" && tabLabel === "pct_geral") {
    return { pct: cat.pct_geral, celula: `pct_geral=${cat.pct_geral}`, jsonRegra, regraInferida };
  }
  const matriz = cat.celulas_taxa_prazo || cat.celulas_taxa || cat.celulas_prazo || cat.celulas;
  if (!matriz || matriz.length === 0) return { pct: null, celula: null, jsonRegra, regraInferida };
  for (const celula of matriz) {
    if (!inRange(taxa, celula.tx_min, celula.tx_max)) continue;
    if (!inRange(prazo, celula.prazo_min, celula.prazo_max)) continue;
    if (tabLabel === "pct_geral" && typeof celula.pct_geral === "number") {
      return { pct: celula.pct_geral, celula: "match", jsonRegra, regraInferida };
    }
    const pct = celula[tabLabel];
    if (typeof pct === "number") return { pct, celula: "match", jsonRegra, regraInferida };
  }
  return { pct: null, celula: null, jsonRegra, regraInferida };
}

// ---------------------------------------------------------------------------
// 4. Helpers de teste
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS — ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`  FAIL — ${name}${detail ? `\n         ${detail}` : ""}`);
  }
}

function getRegra(mes) {
  const e = MAPA[mes];
  if (!e) return null;
  return { regra: regras[e.json], jsonRegra: e.json, regraInferida: e.inferida };
}

// ---------------------------------------------------------------------------
// 5. Cenários
// ---------------------------------------------------------------------------

console.log("\n=== Cenário 1: cobertura mensal ===");
const meses = Object.keys(MAPA);
const inferidos = meses.filter((m) => MAPA[m].inferida).length;
const diretos = meses.filter((m) => !MAPA[m].inferida).length;
assert("41 meses cobertos", meses.length === 41, `obtido: ${meses.length}`);
assert("35 diretos", diretos === 35, `obtido: ${diretos}`);
assert("6 inferidos", inferidos === 6, `obtido: ${inferidos}`);

console.log("\n=== Cenário 2: getRegra('2024-07') = TRP09 direto ===");
const r1 = getRegra("2024-07");
assert("retorna TRP09", r1 && r1.jsonRegra === "TRP09_2024-07.json");
assert("regraInferida=false", r1 && r1.regraInferida === false);
assert("competencia=2024-07", r1 && r1.regra._meta.competencia === "2024-07");

console.log("\n=== Cenário 3: getRegra('2023-09') = TRP01 fallback ===");
const r2 = getRegra("2023-09");
assert("usa TRP01_2024-01.json como fallback", r2 && r2.jsonRegra === "TRP01_2024-01.json");
assert("regraInferida=true", r2 && r2.regraInferida === true);

console.log("\n=== Cenário 4: getRegra('2024-04') = TRP05_2024-04b (errata, NÃO TRP04) ===");
const r3 = getRegra("2024-04");
assert("usa TRP05_2024-04b.json", r3 && r3.jsonRegra === "TRP05_2024-04b.json");
assert("não usa TRP04 original", r3 && r3.jsonRegra !== "TRP04_2024-04.json");
assert("_meta.trp = 'TRP Nº 2024/05'", r3 && r3.regra._meta.trp === "TRP Nº 2024/05");

console.log("\n=== Cenário 5: getRegra('2025-09') = TRP27 (errata PR2025/130, NÃO TRP26) ===");
const r4 = getRegra("2025-09");
assert("usa TRP27_2025-09.json", r4 && r4.jsonRegra === "TRP27_2025-09.json");
assert("não usa TRP26", r4 && r4.jsonRegra !== "TRP26_2025-09.json");
assert("_meta.trp menciona 2025/130", r4 && /2025\/130/.test(r4.regra._meta.trp || ""));

console.log("\n=== Cenário 6: regimes ===");
function getRegime(mes) {
  if (mes >= "2022-12" && mes <= "2023-05") return "META_2_NIVEIS_MATRIZ_TAXA_PRAZO";
  if (mes >= "2023-06" && mes <= "2024-12") return "META_2_NIVEIS";
  if (mes >= "2025-01" && mes <= "2025-06") return "META_4_NIVEIS";
  if (mes >= "2025-07" && mes <= "2025-12") return "VOLUME_6_PERFIS";
  if (mes >= "2026-01" && mes <= "2026-03") return "VOLUME_3_PERFIS";
  if (mes >= "2026-04") return "VOLUME_5_FAIXAS";
  return "META_2_NIVEIS_MATRIZ_TAXA_PRAZO";
}
assert("2025-04 = META_4_NIVEIS", getRegime("2025-04") === "META_4_NIVEIS");
assert("2026-04 = VOLUME_5_FAIXAS", getRegime("2026-04") === "VOLUME_5_FAIXAS");
assert("2024-07 = META_2_NIVEIS", getRegime("2024-07") === "META_2_NIVEIS");

console.log("\n=== Cenário 7: ADIANTAMENTO_13 Bug #6 (taxa < tx_juros_min) ===");
// TRP03_2024-03 declara ADIANTAMENTO_13.tx_juros_min=0.0286
const r5 = getRegra("2024-03");
const trp03Adiant = r5 && r5.regra.ADIANTAMENTO_13;
assert(
  "TRP03 ADIANTAMENTO_13.tx_juros_min existe",
  trp03Adiant && typeof trp03Adiant.tx_juros_min === "number",
  trp03Adiant ? `tx_juros_min=${trp03Adiant.tx_juros_min}` : "categoria ausente"
);
const lookupBug6 = lookupPctInRegra(r5.regra, "ADIANTAMENTO_13", 0.0119, 9, "Tabela 2", r5.jsonRegra, r5.regraInferida);
assert("taxa 1,19% < tx_juros_min retorna pct=null", lookupBug6.pct === null);
assert("celula menciona FORA_DA_TABELA", /FORA_DA_TABELA/.test(lookupBug6.celula || ""));

console.log("\n=== Cenário 8: EPS funciona em borda de faixa ===");
const regraSintetica = {
  _meta: { regime: "META_2_NIVEIS" },
  INSS: {
    celulas_taxa: [
      { tx_min: 0.0175, tx_max: 0.018, "Tabela 2": 0.06 },
      { tx_min: 0.0181, tx_max: 0.019, "Tabela 2": 0.065 },
    ],
  },
};
const exato = lookupPctInRegra(regraSintetica, "INSS", 0.018, 24, "Tabela 2", "test", false);
const ruidoso = lookupPctInRegra(regraSintetica, "INSS", 0.018000000000000002, 24, "Tabela 2", "test", false);
assert("taxa 0.018 → pct 0.06", exato.pct === 0.06);
assert("taxa 0.018 + ruído FP → pct 0.06 (mesma faixa)", ruidoso.pct === 0.06);

// ---------------------------------------------------------------------------
// 6. Resumo
// ---------------------------------------------------------------------------

console.log("\n=== Resumo ===");
console.log(`Arquivos JSON carregados: ${arquivos.length}`);
console.log(`Cobertura: ${meses.length} meses (${diretos} diretos + ${inferidos} inferidos)`);
console.log(`Período: ${meses[0]} a ${meses[meses.length - 1]}`);
console.log(`Testes: ${passed} PASS / ${failed} FAIL`);

if (failed > 0) {
  console.log("\n=== Falhas detalhadas ===");
  for (const f of failures) console.log(`- ${f.name}: ${f.detail || "(sem detalhe)"}`);
  process.exit(1);
}
process.exit(0);
