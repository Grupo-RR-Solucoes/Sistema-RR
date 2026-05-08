#!/usr/bin/env node
/**
 * scripts/check_lookup_vs_v9.cjs — Validação extra 2.
 *
 * Carrega auditorias/RELATORIO_AUDITORIA_FINAL_v9.xlsx, sorteia 50 contratos
 * estratificados por regime e compara o pct retornado por lookupPctInRegra
 * (replicado inline) com a coluna "% Devido" da v9.
 *
 * Critério: ≥ 48/50 batendo com tolerância 1e-4.
 *
 * NOTA sobre regimes VOLUME: a v9 atribui Cat_Devida = Cat_Aplicada (critério
 * comercial não publicado). Para esses meses o teste compara contra a
 * Cat_Aplicada da v9 — se loader+JSON estão corretos, deve bater.
 */

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const ROOT = path.resolve(__dirname, "..");
const REGRAS_DIR = path.join(ROOT, "regras_promotiva", "json");
const XLSX_PATH = path.join(ROOT, "auditorias", "RELATORIO_AUDITORIA_FINAL_v9.xlsx");
const EPS = 1e-7;
const SEED = 42; // determinístico para reprodutibilidade

// ------------------------------------------------------------------ load --
const arquivos = fs.readdirSync(REGRAS_DIR).filter((f) => f.endsWith(".json")).sort();
const regras = {};
for (const f of arquivos) regras[f] = JSON.parse(fs.readFileSync(path.join(REGRAS_DIR, f), "utf8"));

const MAPA = {
  "2022-12": { json: "OPP060_2022-12.json", inferida: false },
  "2023-01": { json: "OPP060_2023-01.json", inferida: false },
  "2023-02": { json: "OPP060_2023-02.json", inferida: false },
  "2023-03": { json: "OPP060_2023-03.json", inferida: false },
  "2023-04": { json: "OPP060_2023-04.json", inferida: false },
  "2023-05": { json: "OPP060_2023-05.json", inferida: false },
  "2023-06": { json: "OPP060_2022-12_a_2023-05.json", inferida: true },
  "2023-07": { json: "OPP061_2023-07_a_2023-08.json", inferida: false },
  "2023-08": { json: "OPP061_2023-07_a_2023-08.json", inferida: false },
  "2023-09": { json: "TRP01_2024-01.json", inferida: true },
  "2023-10": { json: "TRP01_2024-01.json", inferida: true },
  "2023-11": { json: "TRP01_2024-01.json", inferida: true },
  "2023-12": { json: "TRP01_2024-01.json", inferida: true },
  "2024-01": { json: "TRP01_2024-01.json", inferida: false },
  "2024-02": { json: "TRP02_2024-02.json", inferida: false },
  "2024-03": { json: "TRP03_2024-03.json", inferida: false },
  "2024-04": { json: "TRP05_2024-04b.json", inferida: false },
  "2024-05": { json: "TRP05_2024-04b.json", inferida: true },
  "2024-06": { json: "TRP08_2024-06b.json", inferida: false },
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
  "2025-09": { json: "TRP27_2025-09.json", inferida: false },
  "2025-10": { json: "TRP29_2025-10.json", inferida: false },
  "2025-11": { json: "TRP30_2025-11.json", inferida: false },
  "2025-12": { json: "TRP31_2025-12.json", inferida: false },
  "2026-01": { json: "TRP32_2026-01.json", inferida: false },
  "2026-02": { json: "TRP33_2026-02.json", inferida: false },
  "2026-03": { json: "TRP34_2026-03.json", inferida: false },
  "2026-04": { json: "TRP35_2026-04.json", inferida: false },
};

function getRegime(mes) {
  if (mes >= "2022-12" && mes <= "2023-05") return "META_2_NIVEIS_MATRIZ_TAXA_PRAZO";
  if (mes >= "2023-06" && mes <= "2024-12") return "META_2_NIVEIS";
  if (mes >= "2025-01" && mes <= "2025-06") return "META_4_NIVEIS";
  if (mes >= "2025-07" && mes <= "2025-12") return "VOLUME_6_PERFIS";
  if (mes >= "2026-01" && mes <= "2026-03") return "VOLUME_3_PERFIS";
  return "VOLUME_5_FAIXAS";
}

function inRange(v, min, max) {
  const lo = typeof min === "number" ? min - EPS : -Infinity;
  const hi = typeof max === "number" ? max + EPS : Infinity;
  return v >= lo && v <= hi;
}

function lookup(regra, cat, taxa, prazo, tabLabel) {
  const c = regra[cat];
  if (!c || typeof c !== "object") return { pct: null, motivo: `categoria ${cat} ausente` };
  if (typeof c.tx_juros_min === "number" && taxa < c.tx_juros_min - EPS)
    return { pct: null, motivo: `taxa<tx_juros_min` };
  if (typeof c.prazo_min === "number" && prazo < c.prazo_min)
    return { pct: null, motivo: `prazo<${c.prazo_min}` };
  if (typeof c.prazo_max === "number" && prazo > c.prazo_max)
    return { pct: null, motivo: `prazo>${c.prazo_max}` };
  if (typeof c.pct_geral === "number" && tabLabel === "pct_geral")
    return { pct: c.pct_geral, motivo: "pct_geral_categoria" };
  const matriz = c.celulas_taxa_prazo || c.celulas_taxa || c.celulas_prazo || c.celulas;
  if (!matriz || matriz.length === 0) return { pct: null, motivo: "sem_matriz" };
  for (const cel of matriz) {
    if (!inRange(taxa, cel.tx_min, cel.tx_max)) continue;
    if (!inRange(prazo, cel.prazo_min, cel.prazo_max)) continue;
    if (tabLabel === "pct_geral" && typeof cel.pct_geral === "number")
      return { pct: cel.pct_geral, motivo: "pct_geral_celula" };
    const p = cel[tabLabel];
    if (typeof p === "number") return { pct: p, motivo: "match" };
  }
  return { pct: null, motivo: "celula_nao_match" };
}

// --------------------------------------------------------- mapeamentos --
function normCat(catAplicada) {
  if (!catAplicada) return null;
  const s = String(catAplicada).trim().toUpperCase();
  // META 2 níveis
  if (s === "TABELA 1") return "Tabela 1";
  if (s === "TABELA 2") return "Tabela 2";
  // META 4 níveis (com e sem acento)
  if (s.includes("INTERMEDI") && s.includes("1")) return "Tabela Intermediaria 1";
  if (s.includes("INTERMEDI") && s.includes("2")) return "Tabela Intermediaria 2";
  // VOLUME 6
  if (s === "VAREJO I") return "Varejo I";
  if (s === "VAREJO II") return "Varejo II";
  if (s === "MIDDLE") return "Middle";
  if (s === "UPPER MIDDLE") return "Upper Middle";
  if (s === "CORPORATE") return "Corporate";
  if (s === "LARGE CORPORATE") return "Large Corporate";
  // VOLUME 3
  if (s === "RUBI") return "Rubi";
  if (s === "SAFIRA") return "Safira";
  if (s === "DIAMANTE") return "Diamante";
  // VOLUME 5
  const fm = s.match(/^FAIXA\s+(\d)$/);
  if (fm) return `Faixa ${fm[1]}`;
  // pct_geral (PORTAB em VOLUME, FGTS)
  if (s === "GERAL" || s === "PCT_GERAL") return "pct_geral";
  return null;
}

/**
 * Tentativa de mapear (mes, produto, tipo, convenio) → categoria do JSON.
 * Retorna lista de candidatos em ordem de preferência. lookup tenta cada um.
 */
function categoriasCandidatas(mes, produto, tipo, convenio) {
  const p = String(produto || "").toUpperCase();
  const t = String(tipo || "").toUpperCase();
  const cv = String(convenio || "");

  if (p.includes("FGTS")) return ["FGTS"];
  if (p.includes("ADIANTAMENTO") || p.includes("13") || p.includes("13º")) return ["ADIANTAMENTO_13"];

  // PORTAB tem que vir ANTES de INSS — produto pode ser "PORTABILIDADE INSS"
  if (p.includes("PORTAB")) {
    // VOLUME (Jul/2025+) tem PORTAB_PUBLICO/PORTAB_PRIVADO; antes PORTAB_INSS/PORTAB_GERAL.
    if (mes >= "2025-07") return ["PORTAB_PUBLICO", "PORTAB_PRIVADO", "PORTAB_GERAL", "PORTAB_INSS"];
    if (p.includes("INSS")) return ["PORTAB_INSS", "PORTAB_GERAL"];
    return ["PORTAB_GERAL", "PORTAB_INSS"];
  }

  if (p.includes("INSS")) {
    // INSS_NOVO / INSS_RENOV existem a partir de TRP20 (2025-04). Antes só INSS.
    if (mes >= "2025-04") {
      if (t.includes("RENOV")) return ["INSS_RENOV", "INSS"];
      return ["INSS_NOVO", "INSS"];
    }
    return ["INSS"];
  }

  if (p.includes("NÃO CONSIGNADO") || p.includes("NAO CONSIGNADO") || p.includes("SALÁRIO") || p.includes("BENEFÍCIO") || p.includes("SALARIO")) {
    return ["NAO_CONSIGNADO"];
  }

  // Consignado — variantes por convênio/mês
  if (p.includes("CONSIGNADO MPDG") || p.includes("MPDG") || p.includes("SIAPE") || cv === "1078") {
    return ["SIAPE", "CONSIG_GERAL"];
  }
  if (p.includes("PÚBLICO") || p.includes("PUBLICO")) {
    return ["CONSIG_PUBLICO", "CONSIG_GERAL"];
  }
  if (p.includes("PRIVADO")) {
    return ["CONSIG_PRIVADO", "CONSIG_GERAL"];
  }
  if (p.includes("MG")) {
    if (mes >= "2025-01") return ["CONSIG_SP_MG", "CONSIG_GERAL"];
    return ["CONSIG_MG", "CONSIG_GERAL"];
  }
  if (p.includes("SP")) {
    if (mes >= "2025-01") return ["CONSIG_SP_MG", "CONSIG_GERAL"];
    if (mes >= "2024-01") return ["CONSIG_SP", "CONSIG_GERAL"];
    return ["CONSIG_GERAL"];
  }
  if (p.includes("CONSIGNADO")) {
    // Tipo genérico "CONSIGNADO" sem qualificador — pode ser geral/público dependendo de quando.
    if (mes >= "2024-08") return ["CONSIG_PUBLICO", "CONSIG_PRIVADO", "CONSIG_GERAL"];
    return ["CONSIG_GERAL"];
  }
  return [];
}

// ----------------------------------------------------------------- xlsx --
console.log(`Lendo XLSX: ${XLSX_PATH}`);
const wb = XLSX.readFile(XLSX_PATH, { dense: true });
const ws = wb.Sheets["Auditoria À Vista"];
const range = XLSX.utils.decode_range(ws["!ref"]);
const all = XLSX.utils.sheet_to_json(ws, {
  header: 1,
  range: { s: { r: range.s.r + 1, c: range.s.c }, e: range.e },
  raw: true, blankrows: false, defval: null,
});
const headers = all[0].map((h) => (h == null ? "" : String(h)));
const rows = all.slice(1).map((row) => {
  const o = {};
  headers.forEach((h, i) => (o[h] = row[i]));
  return o;
});
console.log(`Total contratos: ${rows.length}`);

// ----------------------------------------------------- amostragem --
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
const rand = rng(SEED);

function classify(mes) {
  if (!mes) return null;
  return getRegime(mes);
}

const buckets = {
  META_2_NIVEIS_MATRIZ_TAXA_PRAZO: [],
  META_2_NIVEIS: [],
  META_4_NIVEIS: [],
  VOLUME_6_PERFIS: [],
  VOLUME_3_PERFIS: [],
  VOLUME_5_FAIXAS: [],
};
for (const r of rows) {
  const mes = String(r["Mês"] || "");
  const status = String(r["Status Fase 1"] || "");
  if (status === "SRCC" || status === "FORA_DA_TABELA") continue; // não calculáveis
  const reg = classify(mes);
  if (reg && buckets[reg]) buckets[reg].push(r);
}

function sample(arr, n) {
  // Fisher-Yates parcial determinístico
  const a = arr.slice();
  for (let i = a.length - 1; i > 0 && a.length - 1 - i < n; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(-n);
}

// 10 por regime; combinar VOLUME_6 e VOLUME_3 em 10 (preferência VOLUME_6, complementa com VOLUME_3 se faltar)
const amostras = [];
amostras.push(...sample(buckets["META_2_NIVEIS_MATRIZ_TAXA_PRAZO"], 10).map((r) => ({ regime: "META_2_NIVEIS_MATRIZ_TAXA_PRAZO", row: r })));
amostras.push(...sample(buckets["META_2_NIVEIS"], 10).map((r) => ({ regime: "META_2_NIVEIS", row: r })));
amostras.push(...sample(buckets["META_4_NIVEIS"], 10).map((r) => ({ regime: "META_4_NIVEIS", row: r })));
const v6 = sample(buckets["VOLUME_6_PERFIS"], 5);
const v3 = sample(buckets["VOLUME_3_PERFIS"], 5);
amostras.push(...v6.map((r) => ({ regime: "VOLUME_6_PERFIS", row: r })));
amostras.push(...v3.map((r) => ({ regime: "VOLUME_3_PERFIS", row: r })));
amostras.push(...sample(buckets["VOLUME_5_FAIXAS"], 10).map((r) => ({ regime: "VOLUME_5_FAIXAS", row: r })));

console.log(`\nAmostras coletadas: ${amostras.length}`);

// ----------------------------------------------------- comparação --
const TOL = 1e-4;
const resultados = { ok: [], divergente: [], nulo: [], puloMapa: [] };

/**
 * Teto à vista por categoria. Spec v9 §8 (tabela consolidada). Lookup primário
 * tenta no _meta.limites_categoria do JSON; fallback usa esta tabela canônica.
 *
 * NB: spec v9 §8 declara "Regimes VOLUME (todos): 6,00% (engine usa 6,0%
 * universal, mesmo quando JSON declara teto inferior por categoria)". Por
 * isso preferimos o teto canônico aqui em vez do JSON quando há conflito —
 * é o critério de cobrança da v9.
 */
const TETO_AVISTA_CANONICO = {
  "Tabela 1": 0.054,
  "Tabela 2": 0.060,
  "Tabela Intermediaria 1": 0.056,
  "Tabela Intermediaria 2": 0.058,
  "Faixa 1": 0.060, "Faixa 2": 0.060, "Faixa 3": 0.060,
  "Faixa 4": 0.060, "Faixa 5": 0.060,
  "Rubi": 0.060, "Safira": 0.060, "Diamante": 0.060, // VOLUME usa 6,0% universal
  "Varejo I": 0.060, "Varejo II": 0.060, "Middle": 0.060,
  "Upper Middle": 0.060, "Corporate": 0.060, "Large Corporate": 0.060,
};

function tetoCategoria(tabLabel) {
  if (!tabLabel) return null;
  return TETO_AVISTA_CANONICO[tabLabel] ?? null;
}

for (const a of amostras) {
  const r = a.row;
  const mes = String(r["Mês"] || "");
  const tipo = String(r["Tipo"] || "");
  const produto = String(r["Produto"] || "");
  const convenio = String(r["Convênio"] || "");
  const taxa = Number(r["Tx Juros (%)"]);
  const taxaDecimal = !Number.isFinite(taxa) ? null : (taxa > 1 ? taxa / 100 : taxa);
  const prazo = Number(r["Prazo"]);
  const catAplicada = String(r["Cat Aplicada"] || "");
  const pctDevidoV9 = Number(r["% Devido"]);

  const meta = MAPA[mes];
  if (!meta) { resultados.puloMapa.push({ contrato: r["Contrato"], mes, motivo: "mês fora do MAPA" }); continue; }

  const tabLabel = normCat(catAplicada);
  const cands = categoriasCandidatas(mes, produto, tipo, convenio);

  if (!tabLabel || cands.length === 0 || taxaDecimal == null || !Number.isFinite(prazo)) {
    resultados.puloMapa.push({
      contrato: r["Contrato"], mes, produto, tipo, catAplicada,
      motivo: `mapeamento incompleto: tabLabel=${tabLabel} cands=${cands.join("|")} taxa=${taxaDecimal} prazo=${prazo}`,
    });
    continue;
  }

  let acertou = null;
  let pctRet = null;
  let categoriaUsada = null;
  let motivoFinal = null;

  for (const cand of cands) {
    const out = lookup(regras[meta.json], cand, taxaDecimal, prazo, tabLabel);
    if (out.pct != null) {
      pctRet = out.pct;
      categoriaUsada = cand;
      motivoFinal = out.motivo;
      break;
    } else {
      // Para PORTAB tentar pct_geral também
      if (tabLabel !== "pct_geral") {
        const out2 = lookup(regras[meta.json], cand, taxaDecimal, prazo, "pct_geral");
        if (out2.pct != null) {
          pctRet = out2.pct;
          categoriaUsada = cand;
          motivoFinal = `pct_geral_fallback (${out2.motivo})`;
          break;
        }
      }
      motivoFinal = `${cand}: ${out.motivo}`;
    }
  }

  if (pctRet == null) {
    resultados.nulo.push({
      contrato: r["Contrato"], mes, regime: a.regime, produto, tipo, convenio, catAplicada,
      taxaDecimal, prazo, pctDevidoV9, motivoFinal,
    });
    continue;
  }
  // Spec v9 §2 Camada 2: pct_devido_avista = min(pct_cheio, teto_BACEN)
  const teto = tetoCategoria(tabLabel);
  const pctRetCapped = (typeof teto === "number" && pctRet > teto) ? teto : pctRet;
  acertou = Math.abs(pctRetCapped - pctDevidoV9) <= TOL;
  if (acertou) {
    resultados.ok.push({
      contrato: r["Contrato"], mes, regime: a.regime,
      pctCheio: pctRet, teto, pctRet: pctRetCapped, pctDevidoV9, categoriaUsada,
    });
  } else {
    resultados.divergente.push({
      contrato: r["Contrato"], mes, regime: a.regime, produto, tipo, convenio, catAplicada,
      taxaDecimal, prazo, pctDevidoV9,
      pctCheio: pctRet, teto, pctRet: pctRetCapped,
      diff: pctRetCapped - pctDevidoV9, categoriaUsada, motivoFinal,
    });
  }
}

// ----------------------------------------------------------- relato --
console.log("\n=== Resultados por regime ===");
const stats = {};
for (const x of resultados.ok) (stats[x.regime] ||= { ok: 0, div: 0, nul: 0 }).ok++;
for (const x of resultados.divergente) (stats[x.regime] ||= { ok: 0, div: 0, nul: 0 }).div++;
for (const x of resultados.nulo) (stats[x.regime] ||= { ok: 0, div: 0, nul: 0 }).nul++;
console.log("| Regime | OK | Divergente | Null/skip |");
console.log("|---|---:|---:|---:|");
for (const k of Object.keys(stats)) console.log(`| ${k} | ${stats[k].ok} | ${stats[k].div} | ${stats[k].nul} |`);

if (resultados.puloMapa.length) {
  console.log(`\nPulados (mapeamento incompleto): ${resultados.puloMapa.length}`);
  for (const p of resultados.puloMapa.slice(0, 5))
    console.log(`  - ${p.contrato || "?"} | ${p.mes} | ${p.motivo}`);
}

if (resultados.divergente.length) {
  console.log("\n=== Divergentes (esperado v9 ≠ retornado loader pós-cap) ===");
  for (const d of resultados.divergente) {
    console.log(
      `  contrato=${d.contrato} mes=${d.mes} regime=${d.regime} produto="${d.produto}" tipo=${d.tipo} cat=${d.catAplicada} taxa=${d.taxaDecimal} prazo=${d.prazo} → cheio=${d.pctCheio} teto=${d.teto} capped=${d.pctRet} v9=${d.pctDevidoV9} diff=${d.diff} (cat usada: ${d.categoriaUsada})`
    );
  }
}
if (resultados.nulo.length) {
  console.log("\n=== Nulos (loader não conseguiu calcular) ===");
  for (const n of resultados.nulo) {
    console.log(
      `  contrato=${n.contrato} mes=${n.mes} regime=${n.regime} produto="${n.produto}" tipo=${n.tipo} cat=${n.catAplicada} taxa=${n.taxaDecimal} prazo=${n.prazo} v9=${n.pctDevidoV9} motivo=${n.motivoFinal}`
    );
  }
}

const total = resultados.ok.length + resultados.divergente.length + resultados.nulo.length;
const pass = resultados.ok.length;
console.log(`\n=== Resumo ===`);
console.log(`Amostras testadas: ${total} (esperado 50, pulados ${resultados.puloMapa.length})`);
console.log(`OK: ${pass}`);
console.log(`Divergente: ${resultados.divergente.length}`);
console.log(`Null: ${resultados.nulo.length}`);

const minPass = 48;
const ratio = total > 0 ? (pass / total) * 100 : 0;
console.log(`Taxa de acerto: ${ratio.toFixed(1)}%`);

if (pass < minPass) {
  console.log(`\nFAIL: ${pass}/${total} < ${minPass} mínimo.`);
  process.exit(1);
}
console.log(`\nPASS: ${pass}/${total} ≥ ${minPass} mínimo.`);
process.exit(0);
