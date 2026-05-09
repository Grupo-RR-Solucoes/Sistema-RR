#!/usr/bin/env node
/**
 * scripts/seed_validator.cjs — Fase 4.2 (CHECKPOINTs B + C.2).
 *
 * Lê os arquivos mensais Promotiva de:
 *   - C:\Users\diego\Downloads\RRCRED\Relatório de Produção (5 pastas: ALAGOAS,
 *     ALAGOAS 2, ALAGOAS 3, PERNAMBUCO, "Nova pasta")
 *   - C:\Users\diego\Downloads (raiz, para Abr/2026 — pasta de chegada antes
 *     do Diego mover para a estrutura padrão)
 *
 * Popula monthly_validator_snapshot com 1 linha por mês de Dez/2022 a Abr/2026
 * (41 meses).
 *
 * Diagnósticos rodados:
 *
 *  1. PCT_META — snapshot.pct_meta vs recalc (sum audit_v9_avista ex-SRCC) /
 *     meta_pf. Resultado conhecido do CHECKPOINT B: 6 meses flagged em 2023-Q1
 *     com snapshot corrupto, recalc é fonte de verdade.
 *
 *  2. PCT_PENETRACAO seletivo — para meses ELEGÍVEIS (regime META + mes>=2023-09 +
 *     pct_meta_recalc ∈ [0.90, 1.00)), abre a aba A Vista de cada CNPJ ativo,
 *     soma VALOR LÍQUIDO ex-SRCC com seguro / total ex-SRCC. Em meses não-
 *     elegíveis, pct_penetracao_recalc fica NULL com motivo registrado em
 *     raw_data._diagnostico.penetracao_recalc_motivo.
 *
 *  3. VOL_LIQUIDO_XLSX vs VOL_LIQUIDO_V9 — para todos os 41 meses. Soma da
 *     A Vista do XLSX (ex-SRCC, CNPJs ativos) versus sum(audit_v9_avista) idem.
 *     |delta| > threshold sinaliza divergência v9 vs XLSX original.
 *
 * Modos:
 *   node scripts/seed_validator.cjs --dry-run    # apenas relata, não escreve
 *   node scripts/seed_validator.cjs --execute    # DELETE + INSERT em monthly_validator_snapshot
 */

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

// ---------------------------------------------------------------- env --
const ROOT = path.resolve(__dirname, "..");
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em .env.local");
  process.exit(1);
}

// --------------------------------------------------------------- args --
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const EXECUTE = argv.includes("--execute");
if (!DRY_RUN && !EXECUTE) {
  console.error("Use --dry-run (apenas relata) ou --execute (DELETE + INSERT).");
  process.exit(1);
}

// --------------------------------------------------- paths/config -----
const REPORT_ROOT = "C:\\Users\\diego\\Downloads\\RRCRED\\Relatório de Produção";
const REPORT_FOLDERS = ["ALAGOAS", "ALAGOAS 2", "ALAGOAS 3", "PERNAMBUCO", "Nova pasta"];
const DOWNLOADS_ROOT = "C:\\Users\\diego\\Downloads"; // pasta alternativa (Abr/2026)

// CNPJ ativos: 4 empresas (espelha lib/cnpjActivePeriod.ts)
const CNPJ_ACTIVE_PERIODS = [
  { label: "RR Alagoas",    cnpj: "48357275000103", coban: "98250", firstActiveYearMonth: "2022-12" },
  { label: "RR Pernambuco", cnpj: "51457289000103", coban: "14692", firstActiveYearMonth: "2023-09" },
  { label: "RR Alagoas 2",  cnpj: "56140658000153", coban: "18309", firstActiveYearMonth: "2024-11" },
  { label: "RR Alagoas 3",  cnpj: "55867409000100", coban: "20466", firstActiveYearMonth: "2025-09" },
];
function ymOf(y, m) { return `${y}-${String(m).padStart(2, "0")}`; }
function activeCnpjsForMonth(y, m) {
  const ym = ymOf(y, m);
  return CNPJ_ACTIVE_PERIODS.filter((p) => ym >= p.firstActiveYearMonth);
}

// Helpers
function normLabel(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
function toNum(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.replace(/R\$/gi, "").replace(/%/g, "").replace(/\s/g, "").trim();
    if (s === "") return null;
    const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function toStr(v) { return v == null ? null : (String(v).trim() || null); }
function round2(n) { return n == null ? null : Math.round(n * 100) / 100; }

function getRegime(mes) {
  if (mes >= "2022-12" && mes <= "2023-05") return "META_2_NIVEIS_MATRIZ_TAXA_PRAZO";
  if (mes >= "2023-06" && mes <= "2024-12") return "META_2_NIVEIS";
  if (mes >= "2025-01" && mes <= "2025-06") return "META_4_NIVEIS";
  if (mes >= "2025-07" && mes <= "2025-12") return "VOLUME_6_PERFIS";
  if (mes >= "2026-01" && mes <= "2026-03") return "VOLUME_3_PERFIS";
  if (mes >= "2026-04") return "VOLUME_5_FAIXAS";
  return "META_2_NIVEIS_MATRIZ_TAXA_PRAZO";
}
function isMetaRegime(regime) {
  return regime === "META_2_NIVEIS_MATRIZ_TAXA_PRAZO" ||
         regime === "META_2_NIVEIS" ||
         regime === "META_4_NIVEIS";
}

// ------------------------------------------------------- arquivo lookup
// Para um mês, retorna lista de candidatos para o Validador snapshot
// (1 arquivo primário com Validador/Resumo).
function findValidadorCandidates(year, month) {
  const yr = String(year);
  const mm = String(month).padStart(2, "0");
  const newRx = new RegExp(`^C(\\d+)_\\d+_Todos_${month}_${yr}\\.xlsx$`, "i");
  const oldRx = new RegExp(`\\b${mm}[.\\-]${yr}\\b.*\\.xlsx$`, "i");
  const denyRx = /(BB\s*Cons[oó]rcio|CONS[OÓ]RCIO|BRASILCAP)/i;
  const out = [];
  // Pastas estruturadas
  for (const f of REPORT_FOLDERS) {
    const dir = path.join(REPORT_ROOT, f);
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      if (denyRx.test(e)) continue;
      const mNew = e.match(newRx);
      if (mNew) out.push({ rel: path.join(f, e), full: path.join(dir, e), isNew: true, c: parseInt(mNew[1], 10) });
      else if (oldRx.test(e)) out.push({ rel: path.join(f, e), full: path.join(dir, e), isNew: false, c: 0 });
    }
  }
  // Downloads root (alternativa — usada para Abr/2026)
  try {
    const entries = fs.readdirSync(DOWNLOADS_ROOT);
    for (const e of entries) {
      if (denyRx.test(e)) continue;
      const full = path.join(DOWNLOADS_ROOT, e);
      try { if (!fs.statSync(full).isFile()) continue; } catch { continue; }
      const mNew = e.match(newRx);
      if (mNew) out.push({ rel: path.join("[Downloads]", e), full, isNew: true, c: parseInt(mNew[1], 10) });
    }
  } catch { /* ignore */ }
  out.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    if (a.isNew) return a.c - b.c;
    const aRev = / 2\.xlsx$/i.test(a.rel) ? 1 : 0;
    const bRev = / 2\.xlsx$/i.test(b.rel) ? 1 : 0;
    return bRev - aRev;
  });
  return out;
}

/**
 * Para o mês informado, encontra TODOS os arquivos XLSX A Vista por CNPJ
 * ativo (primário + revisões/incrementais). Retorna lista de
 *   { cnpj, label, files: [{path, rel, isNew, c}] }
 *
 * Os arquivos podem ser:
 *  - Formato novo Cxxxx_<CNPJ>_Todos_<m>_<y>.xlsx (múltiplos Cxxxx por mês —
 *    Promotiva re-emite com contratos incrementais; somar todos cobre o mês)
 *  - Formato antigo `<COBAN> - RR ... <MM>.<YYYY>.xlsx` + revisão " 2.xlsx"
 *  - Pasta padrão (REPORT_FOLDERS) + Downloads (Apr/2026)
 *
 * Não filtra por categoria — todos os "Todos" + revisões são incluídos.
 * "BB Consórcio" e "BRASILCAP" continuam excluídos via denyRx.
 */
function findAvistaFilesPerCnpj(year, month) {
  const yr = String(year);
  const mm = String(month).padStart(2, "0");
  const cnpjs = activeCnpjsForMonth(year, month);
  const denyRx = /(BB\s*Cons[oó]rcio|CONS[OÓ]RCIO|BRASILCAP)/i;
  const out = [];
  for (const cnpjInfo of cnpjs) {
    const newRx = new RegExp(`^C(\\d+)_${cnpjInfo.cnpj}_Todos_${month}_${yr}\\.xlsx$`, "i");
    const oldRx = new RegExp(`^${cnpjInfo.coban}\\s*-\\s.*\\b${mm}[.\\-]${yr}\\b.*\\.xlsx$`, "i");
    const files = [];
    const seenFulls = new Set();
    function pushIfNew(entry) {
      if (seenFulls.has(entry.full)) return;
      seenFulls.add(entry.full);
      files.push(entry);
    }
    for (const folder of REPORT_FOLDERS) {
      const dir = path.join(REPORT_ROOT, folder);
      let entries; try { entries = fs.readdirSync(dir); } catch { continue; }
      for (const e of entries) {
        if (denyRx.test(e)) continue;
        const mNew = e.match(newRx);
        if (mNew) {
          pushIfNew({ rel: path.join(folder, e), full: path.join(dir, e), c: parseInt(mNew[1], 10), isNew: true });
        } else if (oldRx.test(e)) {
          pushIfNew({ rel: path.join(folder, e), full: path.join(dir, e), c: 0, isNew: false });
        }
      }
    }
    try {
      const entries = fs.readdirSync(DOWNLOADS_ROOT);
      for (const e of entries) {
        if (denyRx.test(e)) continue;
        const full = path.join(DOWNLOADS_ROOT, e);
        try { if (!fs.statSync(full).isFile()) continue; } catch { continue; }
        const mNew = e.match(newRx);
        if (mNew) pushIfNew({ rel: path.join("[Downloads]", e), full, c: parseInt(mNew[1], 10), isNew: true });
      }
    } catch { /* ignore */ }
    files.sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      if (a.isNew) return a.c - b.c;
      const aRev = / 2\.xlsx$/i.test(a.rel) ? 1 : 0;
      const bRev = / 2\.xlsx$/i.test(b.rel) ? 1 : 0;
      return aRev - bRev; // primário (sem " 2.xlsx") primeiro
    });
    out.push({ cnpj: cnpjInfo.cnpj, label: cnpjInfo.label, files });
  }
  return out;
}

// --------------------------------------------------- parsers Validador --
//
// Layout 1 (Aug/2024 a Mar/2026): 14 colunas alinhadas.
// Layout 2 (Abr/2026 — TRP35 FAIXA 5): Promotiva inseriu coluna FAIXA em
// posição 2 sem atualizar o cabeçalho. Detecta-se quando data[2] é string
// (não numérico) e shift os índices subsequentes em +1.

function parseValidador(ws) {
  if (!ws["!ref"]) throw new Error("Validador vazia");
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: null });
  const headers = (all[0] || []).map((h) => normLabel(h));
  let dataRow = null;
  for (let i = 1; i < all.length; i += 1) {
    const r = all[i] || [];
    const text = r.map((v) => v == null ? "" : String(v)).join(" ");
    if (/GRUPO\s+RR/i.test(text)) { dataRow = r; break; }
  }
  if (!dataRow) dataRow = all[1] || [];

  // Detecta layout shift Apr/2026: Promotiva inseriu coluna FAIXA/PERFIL na
  // posição 2 (col C, antes da PRODUÇÃO BRUTA) sem atualizar o cabeçalho.
  // Inspeção cell-by-cell confirmada (vide stress_test_workspace_local/scratch/
  // _inspect_apr_validador_cells.cjs):
  //   - Posições 0-1 (CÓD. GRUPO, GRUPO): inalteradas
  //   - Posição 2: contém o NOVO valor "FAIXA N" (header diz PRODUÇÃO BRUTA)
  //   - Posições 3-9: deslocadas em +1 vs cabeçalho (PRODUÇÃO BRUTA→col 3 etc.)
  //   - Posição 9: % CRÉDITO NOVO (não desloca além daqui)
  //   - Posições 10-13 (TABELA, BÔNUS INSS, OBS, % PENETRAÇÃO): em alinhamento
  //     com cabeçalho (não deslocadas)
  // Por isso shifted(i) só aplica para 2 ≤ i < 10.
  const shift = (typeof dataRow[2] === "string" && /^(FAIXA|RUBI|SAFIRA|DIAMANTE|VAREJO|MIDDLE|UPPER|CORPORATE|LARGE)/i.test(dataRow[2]));

  const idx = (variants) => headers.findIndex((h) => variants.some((v) => h === v));
  const idxMeta = idx(["meta pf", "metapf"]);
  const idxProd = idx(["producao liquida"]);
  const idxPctMeta = idx(["% meta"]);
  const idxPen = idx(["% penetracao"]);
  const idxTab = idx(["tabela"]);
  if (idxMeta < 0) throw new Error("Validador sem META PF: " + headers.join("|"));
  if (idxProd < 0) throw new Error("Validador sem PRODUÇÃO LÍQUIDA: " + headers.join("|"));
  if (idxPctMeta < 0) throw new Error("Validador sem % META: " + headers.join("|"));
  if (idxTab < 0) throw new Error("Validador sem TABELA: " + headers.join("|"));

  const shifted = (i) => (shift && i >= 2 && i < 10) ? i + 1 : i;

  // Para Apr/2026: TABELA já está em K2 (posição 10 não-shiftada) com "FAIXA N".
  // Posição 2 também repete "FAIXA N" (inserida sem header) — usar como fallback.
  let catAplicada = toStr(dataRow[shifted(idxTab)]);
  if (shift && (!catAplicada || /^[-—]?$/.test(catAplicada)) && typeof dataRow[2] === "string") {
    catAplicada = toStr(dataRow[2]);
  }

  const meta_pf = toNum(dataRow[shifted(idxMeta)]);
  const volume_liquido_atingido = toNum(dataRow[shifted(idxProd)]);
  const pct_meta = toNum(dataRow[shifted(idxPctMeta)]);
  const pct_penetracao = idxPen < 0 ? null : toNum(dataRow[shifted(idxPen)]);

  const volume_prestamista =
    pct_penetracao != null && volume_liquido_atingido != null
      ? round2(pct_penetracao * volume_liquido_atingido) : null;

  const raw_data = { _layout_shift_apr2026: shift };
  headers.forEach((h, i) => { if (h) raw_data[h] = dataRow[shifted(i)] ?? null; });
  if (shift) raw_data._faixa_inserida_col2 = dataRow[2] ?? null;

  return {
    meta_pf, volume_liquido_atingido, pct_meta, volume_prestamista, pct_penetracao,
    cat_aplicada: catAplicada, raw_data, _layout_shift: shift,
  };
}

function parseResumo(ws) {
  if (!ws["!ref"]) throw new Error("Resumo vazia");
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: null });
  function findVal(variants) {
    for (const r of rows) {
      if (!r) continue;
      for (let j = 0; j < r.length; j += 1) {
        const v = r[j];
        if (typeof v !== "string") continue;
        if (variants.some((x) => normLabel(v) === x)) {
          for (let k = j + 1; k < r.length; k += 1) {
            if (r[k] != null && r[k] !== "") return r[k];
          }
          return null;
        }
      }
    }
    return null;
  }
  const prodRaw = findVal(["producao do grupo credito pf"]);
  const metaRaw = findVal(["meta"]);
  const pctMetaRaw = findVal(["% meta atingida"]);
  const pctPenRaw = findVal(["% penetracao prestamista"]);
  const resultadoRaw = findVal(["resultado"]);
  if (metaRaw == null && pctMetaRaw == null && resultadoRaw == null) {
    throw new Error("Resumo sem campos esperados");
  }
  const volume_liquido_atingido = toNum(prodRaw);
  const meta_pf = toNum(metaRaw);
  const pct_meta = toNum(pctMetaRaw);
  const pct_penetracao = toNum(pctPenRaw);
  const cat_aplicada = toStr(resultadoRaw);
  const volume_prestamista = pct_penetracao != null && volume_liquido_atingido != null
    ? round2(pct_penetracao * volume_liquido_atingido) : null;
  return {
    meta_pf, volume_liquido_atingido, pct_meta, volume_prestamista, pct_penetracao,
    cat_aplicada,
    raw_data: {
      "producao do grupo credito pf": prodRaw ?? null,
      meta: metaRaw ?? null,
      "% meta atingida": pctMetaRaw ?? null,
      "% penetracao prestamista": pctPenRaw ?? null,
      resultado: resultadoRaw ?? null,
    },
  };
}

function hasUsableData(s) {
  if (s.cat_aplicada && String(s.cat_aplicada).trim() !== "") return true;
  if (s.meta_pf != null && s.meta_pf > 0) return true;
  if (s.pct_meta != null && s.pct_meta > 0) return true;
  return false;
}

function lerValidadorMes(year, month) {
  const cs = findValidadorCandidates(year, month);
  if (!cs.length) return null;
  let firstWithoutData = null;
  const errs = [];
  for (const chosen of cs) {
    let wb;
    try { wb = XLSX.readFile(chosen.full, { dense: false, cellDates: false }); }
    catch (e) { errs.push(`${chosen.rel}: leitura ${e.message}`); continue; }
    const validador = wb.SheetNames.find((n) => /^valida/i.test(normLabel(n)));
    if (validador) {
      try {
        const data = parseValidador(wb.Sheets[validador]);
        const snap = { year, month, ...data, source_file: chosen.rel, formato: "validador" };
        if (hasUsableData(snap)) return snap;
        firstWithoutData = firstWithoutData ?? snap;
        continue;
      } catch (e) { errs.push(`${chosen.rel} Validador: ${e.message}`); continue; }
    }
    const resumo = wb.SheetNames.find((n) => normLabel(n) === "resumo");
    if (resumo) {
      try {
        const data = parseResumo(wb.Sheets[resumo]);
        const snap = { year, month, ...data, source_file: chosen.rel, formato: "resumo" };
        if (hasUsableData(snap)) return snap;
        firstWithoutData = firstWithoutData ?? snap;
        continue;
      } catch (e) { errs.push(`${chosen.rel} Resumo: ${e.message}`); continue; }
    }
    errs.push(`${chosen.rel}: sem aba Validador nem Resumo`);
  }
  if (firstWithoutData) return firstWithoutData;
  if (errs.length) throw new Error(`Falhou todos os candidatos para ${year}-${month}: ${errs.join(" ; ")}`);
  return null;
}

// --------------------------------------------------- A Vista reader ----
//
// Lê a aba A Vista (ou "A Vista " com espaço) de um único arquivo Cxxxx ou
// 98250-style. Filtra ex-SRCC (RESTRIÇÃO SRCC ≠ "Sim"). Retorna totais.

function readAvistaTotalsFromFile(fullPath) {
  let wb;
  try { wb = XLSX.readFile(fullPath, { dense: false, cellDates: false }); }
  catch (e) { throw new Error(`A Vista leitura ${fullPath}: ${e.message}`); }
  const sn = wb.SheetNames.find((n) => /^a\s*vista\s*$/i.test(n));
  if (!sn) {
    // Aba A Vista pode ter nome com espaço final ou diferente — tenta variantes
    const sn2 = wb.SheetNames.find((n) => /^a\s*vista/i.test(n.trim()));
    if (!sn2) throw new Error(`A Vista ausente em ${fullPath}: abas ${wb.SheetNames.join("|")}`);
    return readAvistaSheet(wb.Sheets[sn2], fullPath);
  }
  return readAvistaSheet(wb.Sheets[sn], fullPath);
}

function readAvistaSheet(ws, sourceLabel) {
  if (!ws["!ref"]) {
    return { contractCount: 0, srccCount: 0, totalExSrcc: 0, totalSeguroExSrcc: 0, pctPenContrato: null, pctPenContratoCount: 0 };
  }
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: null });
  if (all.length < 2) {
    return { contractCount: 0, srccCount: 0, totalExSrcc: 0, totalSeguroExSrcc: 0, pctPenContrato: null, pctPenContratoCount: 0 };
  }
  const headers = (all[0] || []).map((h) => normLabel(h));
  const idxValor = headers.findIndex((h) => h === "valor liquido");
  const idxSeguro = headers.findIndex((h) => h === "valor seguro");
  const idxSrcc = headers.findIndex((h) => h === "restricao srcc");
  // % PENETRAÇÃO por contrato — Promotiva grava o valor GRUPO em cada linha.
  // Validado em Dez/2023: per-contract = 39.41% (real), Resumo cell = 23.10%
  // (corrupto). Usamos esta coluna como fonte de verdade para penetração.
  const idxPenContrato = headers.findIndex((h) => h === "% penetracao");
  if (idxValor < 0) {
    throw new Error(`A Vista sem coluna VALOR LÍQUIDO em ${sourceLabel}: headers=${headers.join("|")}`);
  }
  if (idxSrcc < 0) {
    throw new Error(`A Vista sem coluna RESTRIÇÃO SRCC em ${sourceLabel}: headers=${headers.join("|")}`);
  }
  const hasSeguroCol = idxSeguro >= 0;
  const hasPenCol = idxPenContrato >= 0;
  let contractCount = 0, srccCount = 0, totalExSrcc = 0, totalSeguroExSrcc = 0;
  // Coleta valores distintos da coluna % PENETRAÇÃO (esperado: 1 valor por mês)
  const penValues = new Map(); // valor → count
  for (let i = 1; i < all.length; i += 1) {
    const r = all[i] || [];
    const valor = toNum(r[idxValor]) ?? 0;
    const srccRaw = String(r[idxSrcc] ?? "").trim().toUpperCase();
    const isSrcc = srccRaw === "SIM";
    contractCount += 1;
    if (isSrcc) {
      srccCount += 1;
      continue;
    }
    totalExSrcc += valor;
    if (hasSeguroCol) {
      const seg = toNum(r[idxSeguro]) ?? 0;
      if (seg > 0) totalSeguroExSrcc += valor;
    }
    if (hasPenCol) {
      const p = toNum(r[idxPenContrato]);
      if (p != null && Number.isFinite(p)) {
        const k = Math.round(p * 1e6) / 1e6; // arredonda para evitar drift fp
        penValues.set(k, (penValues.get(k) || 0) + 1);
      }
    }
  }
  // pctPenContrato: maioria modal (mais frequente). Se houver > 1 valor distinto,
  // mantém o mais frequente e reporta dispersão para diagnóstico.
  let pctPenContrato = null;
  let pctPenContratoCount = 0;
  let pctPenDistinctCount = 0;
  if (penValues.size > 0) {
    pctPenDistinctCount = penValues.size;
    let bestK = null, bestN = 0;
    for (const [k, n] of penValues) {
      if (n > bestN) { bestN = n; bestK = k; }
    }
    pctPenContrato = bestK;
    pctPenContratoCount = bestN;
  }
  return {
    contractCount,
    srccCount,
    totalExSrcc: Math.round(totalExSrcc * 100) / 100,
    totalSeguroExSrcc: Math.round(totalSeguroExSrcc * 100) / 100,
    hasSeguroCol,
    hasPenCol,
    pctPenContrato,
    pctPenContratoCount,
    pctPenDistinctCount,
  };
}

// --------------------------------------------------- meses-alvo --------
const MONTHS = [];
{
  let y = 2022, m = 12;
  while (true) {
    MONTHS.push([y, m]);
    if (y === 2026 && m === 4) break;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
}

// ----------------------------------------- carga snapshots -------------
console.log(`Lendo Validador/Resumo + A Vista de ${MONTHS.length} meses (Dez/2022 → Abr/2026)...\n`);

const snapshots = [];
const semDados = [];
const erros = [];

for (const [y, m] of MONTHS) {
  const ym = ymOf(y, m);
  let snap;
  try { snap = lerValidadorMes(y, m); }
  catch (e) { erros.push({ ym, error: e.message }); continue; }
  if (!snap) { semDados.push(ym); continue; }
  snapshots.push(snap);
}

console.log(`  Snapshots Validador/Resumo lidos: ${snapshots.length}`);
console.log(`  SEM_DADOS Validador (arquivo não encontrado): ${semDados.length} ${semDados.length ? `[${semDados.join(", ")}]` : ""}`);
console.log(`  Erros parsing Validador: ${erros.length}`);
for (const e of erros) console.log(`    ${e.ym}: ${e.error}`);

// ------------------------------------------ Carrega audit_v9_avista por mês --
async function loadAvistaSumsFromV9(supabase) {
  const sumByMonth = new Map();
  const unmappedEmpresas = new Set();
  function empresaToLabel(emp) {
    if (!emp) return null;
    const u = String(emp).toUpperCase();
    if (u.includes("ALAGOAS 3") || u.includes("RR AL SOLUCOES")) return "RR Alagoas 3";
    if (u.includes("ALAGOAS 2") || u.includes("RR SOLUCOES AL")) return "RR Alagoas 2";
    if (u.includes("PERNAMBUCO") || u.includes("RR SOLUCOES PE")) return "RR Pernambuco";
    if (u.includes("ALAGOAS") || u.includes("RR SOLUCOES LTDA")) return "RR Alagoas";
    return null;
  }
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("audit_v9_avista")
      .select("mes,empresa,valor_liquido,status_fase1")
      .neq("status_fase1", "SRCC")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) {
      if (!r.mes) continue;
      const lab = empresaToLabel(r.empresa);
      if (!lab) { unmappedEmpresas.add(r.empresa); continue; }
      let bucket = sumByMonth.get(r.mes);
      if (!bucket) { bucket = { byLabel: {} }; sumByMonth.set(r.mes, bucket); }
      bucket.byLabel[lab] = (bucket.byLabel[lab] || 0) + Number(r.valor_liquido || 0);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  if (unmappedEmpresas.size) {
    console.log(`  AVISO: empresas v9 sem mapeamento: ${[...unmappedEmpresas].slice(0, 5).join(" | ")}`);
  }
  return sumByMonth;
}

// ----------------------------------------- ETAPA 2B core: A Vista do XLSX -----
async function runDiagnostics(supabase) {
  console.log("\n=== Carregando audit_v9_avista (paginated full scan, ex-SRCC)...");
  const v9SumByMonth = await loadAvistaSumsFromV9(supabase);
  console.log(`  ${[...v9SumByMonth.keys()].length} meses indexados.`);

  console.log("\n=== Lendo A Vista do XLSX por CNPJ ativo (todos os 41 meses)...");
  // Para cada mês: por CNPJ ativo, lê A Vista do XLSX. Acumula totais.
  const xlsxByMonth = new Map();
  const aVistaErrs = [];
  const aVistaWarns = [];
  for (const [y, m] of MONTHS) {
    const ym = ymOf(y, m);
    const filesPerCnpj = findAvistaFilesPerCnpj(y, m);
    let totalExSrcc = 0;
    let totalSeguroExSrcc = 0;
    let anyMissing = false;
    let anyNoSeguroCol = false;
    let anyNoPenCol = false;
    const filesUsed = [];
    // Coleta o valor da coluna % PENETRAÇÃO per-contract (modal por arquivo).
    // Espera-se 1 valor único por mês (o GRUPO). Se múltiplos files mostrarem
    // valores diferentes, usamos a mediana ponderada por contagem.
    const penContratoCandidates = new Map(); // valor → contagem total
    for (const cnpjEntry of filesPerCnpj) {
      if (!cnpjEntry.files || cnpjEntry.files.length === 0) {
        anyMissing = true;
        aVistaWarns.push(`${ym} ${cnpjEntry.label} (CNPJ ${cnpjEntry.cnpj}): nenhum arquivo XLSX encontrado`);
        continue;
      }
      for (const f of cnpjEntry.files) {
        try {
          const t = readAvistaTotalsFromFile(f.full);
          totalExSrcc += t.totalExSrcc;
          totalSeguroExSrcc += t.totalSeguroExSrcc;
          if (!t.hasSeguroCol) anyNoSeguroCol = true;
          if (!t.hasPenCol) anyNoPenCol = true;
          if (t.pctPenContrato != null) {
            const k = t.pctPenContrato;
            penContratoCandidates.set(k, (penContratoCandidates.get(k) || 0) + (t.pctPenContratoCount || 0));
          }
          filesUsed.push({ cnpj: cnpjEntry.cnpj, label: cnpjEntry.label, rel: f.rel, ...t });
        } catch (e) {
          aVistaErrs.push(`${ym} ${f.rel}: ${e.message}`);
        }
      }
    }
    // Modal global do % PENETRAÇÃO entre os arquivos do mês
    let pctPenContratoMonth = null;
    let pctPenDistinctCount = penContratoCandidates.size;
    if (penContratoCandidates.size > 0) {
      let bestK = null, bestN = 0;
      for (const [k, n] of penContratoCandidates) {
        if (n > bestN) { bestN = n; bestK = k; }
      }
      pctPenContratoMonth = bestK;
    }
    xlsxByMonth.set(ym, {
      totalExSrcc: Math.round(totalExSrcc * 100) / 100,
      totalSeguroExSrcc: Math.round(totalSeguroExSrcc * 100) / 100,
      filesUsed,
      anyMissing,
      anyNoSeguroCol,
      anyNoPenCol,
      pctPenContratoMonth,
      pctPenDistinctCount,
    });
  }
  if (aVistaErrs.length) {
    console.log(`  ERROS de leitura A Vista: ${aVistaErrs.length}`);
    for (const e of aVistaErrs.slice(0, 10)) console.log(`    ${e}`);
  }
  if (aVistaWarns.length) {
    console.log(`  WARNINGS A Vista (CNPJ sem arquivo): ${aVistaWarns.length}`);
    for (const w of aVistaWarns.slice(0, 10)) console.log(`    ${w}`);
  }

  // ------------- Cálculo final por mês: vol_liq_xlsx, delta v9, pct_pen ---
  console.log("\n=== Tabela completa (41 meses) ===");
  console.log("ym\tregime\tmeta_pf\tvol_xlsx\tvol_v9\tdelta_v9\tpct_meta_recalc\teleg_pen\tpct_pen_recalc\tpct_pen_snap\tdelta_pp_pen");
  const flaggedMeta = [];
  const flaggedPen = [];
  const flaggedConsistency = [];
  for (const snap of snapshots) {
    const ym = ymOf(snap.year, snap.month);
    const xlsx = xlsxByMonth.get(ym) || { totalExSrcc: null, totalSeguroExSrcc: null };
    const v9bucket = v9SumByMonth.get(ym) || { byLabel: {} };
    const active = activeCnpjsForMonth(snap.year, snap.month).map((p) => p.label);
    let v9Sum = 0;
    for (const lab of active) v9Sum += (v9bucket.byLabel[lab] || 0);
    v9Sum = Math.round(v9Sum * 100) / 100;
    const deltaV9 = xlsx.totalExSrcc != null
      ? Math.round((xlsx.totalExSrcc - v9Sum) * 100) / 100
      : null;

    // pct_meta_recalc usa audit_v9_avista (mesma fonte do CHECKPOINT B,
    // mantido para retrocompatibilidade com o fluxo aprovado).
    const pctMetaRecalc = (snap.meta_pf && snap.meta_pf > 0)
      ? Math.round((v9Sum / snap.meta_pf) * 1e6) / 1e6
      : null;
    const deltaPctMetaPp = (snap.pct_meta != null && pctMetaRecalc != null)
      ? Math.round((pctMetaRecalc - snap.pct_meta) * 1e6) / 1e6
      : null;
    if (deltaPctMetaPp != null && Math.abs(deltaPctMetaPp) > 0.005) {
      flaggedMeta.push({ ym, snap: snap.pct_meta, recalc: pctMetaRecalc });
    }

    // Elegibilidade penetração
    const regime = getRegime(ym);
    const elegivel =
      isMetaRegime(regime) &&
      ym >= "2023-09" &&
      pctMetaRecalc != null &&
      pctMetaRecalc >= 0.9 &&
      pctMetaRecalc < 1.0;

    let pctPenRecalc = null;
    let volPrestRecalc = null;
    let penStatus, penMotivo;
    if (!elegivel) {
      penStatus = "NAO_APLICAVEL";
      penMotivo =
        !isMetaRegime(regime) ? `regime=${regime}` :
        ym < "2023-09" ? "OPP099 não vigente (mes < 2023-09)" :
        pctMetaRecalc == null ? "pct_meta_recalc indisponível (meta_pf=0?)" :
        pctMetaRecalc < 0.9 ? `pct_meta_recalc=${(pctMetaRecalc * 100).toFixed(2)}% < 90%` :
        pctMetaRecalc >= 1.0 ? `pct_meta_recalc=${(pctMetaRecalc * 100).toFixed(2)}% >= 100%` :
        "(motivo desconhecido)";
    } else {
      // Elegível — usa coluna per-contract `% PENETRAÇÃO` da aba A Vista.
      // Confirmado em Dez/2023: per-contract = 39.41% (real, OPP099 dispara);
      // Resumo cell = 23.10% (corrupto). Promotiva grava 1 valor por mês
      // replicado em cada linha da A Vista — fonte de verdade para o GRUPO.
      if (xlsx.totalExSrcc == null || xlsx.totalExSrcc === 0) {
        penStatus = "ERRO_SEM_AVISTA";
        penMotivo = "XLSX A Vista não pôde ser lida ou veio zerada";
      } else if (xlsx.anyNoPenCol) {
        penStatus = "ERRO_SEM_COLUNA_PENETRACAO";
        penMotivo = "Algum arquivo do mês não tem coluna % PENETRAÇÃO na A Vista";
      } else if (xlsx.pctPenContratoMonth == null) {
        penStatus = "ERRO_SEM_VALOR_PENETRACAO";
        penMotivo = "Coluna % PENETRAÇÃO existe mas está vazia em todos os contratos";
      } else {
        pctPenRecalc = xlsx.pctPenContratoMonth;
        volPrestRecalc = Math.round(pctPenRecalc * xlsx.totalExSrcc * 100) / 100;
        penStatus = "CALCULADO";
        penMotivo = xlsx.pctPenDistinctCount > 1
          ? `aviso: ${xlsx.pctPenDistinctCount} valores distintos por contrato (modal selecionado)`
          : null;
      }
    }
    const deltaPenPp = (snap.pct_penetracao != null && pctPenRecalc != null)
      ? Math.round((pctPenRecalc - snap.pct_penetracao) * 1e6) / 1e6
      : null;
    const flaggedPenetracao = deltaPenPp != null && Math.abs(deltaPenPp) > 0.005;
    if (flaggedPenetracao) flaggedPen.push({ ym, snap: snap.pct_penetracao, recalc: pctPenRecalc });

    // Anota tudo no snapshot
    snap.vol_liquido_avista_recalc_xlsx = xlsx.totalExSrcc;
    snap.delta_vol_liquido_xlsx_vs_v9 = deltaV9;
    snap.pct_penetracao_recalc = pctPenRecalc;
    snap.volume_prestamista_recalc = volPrestRecalc;

    snap.raw_data = snap.raw_data || {};
    snap.raw_data._diagnostico = {
      vol_avista_v9: v9Sum,
      pct_meta_recalc: pctMetaRecalc,
      pct_meta_snapshot: snap.pct_meta,
      delta_pp_meta: deltaPctMetaPp,
      flagged_meta: deltaPctMetaPp != null && Math.abs(deltaPctMetaPp) > 0.005,
      vol_avista_xlsx: xlsx.totalExSrcc,
      delta_v9: deltaV9,
      flagged_v9_consistency: false, // preenchido após threshold ser definido
      penetracao_recalc_status: penStatus,
      penetracao_recalc_motivo: penMotivo,
      pct_penetracao_recalc: pctPenRecalc,
      pct_penetracao_snapshot: snap.pct_penetracao,
      delta_pp_penetracao: deltaPenPp,
      flagged_penetracao: flaggedPenetracao,
      avista_files_used: (xlsx.filesUsed || []).map((f) => ({ cnpj: f.cnpj, label: f.label, rel: f.rel })),
    };

    // Print row
    console.log([
      ym,
      regime,
      snap.meta_pf,
      xlsx.totalExSrcc,
      v9Sum,
      deltaV9,
      pctMetaRecalc != null ? (pctMetaRecalc * 100).toFixed(4) + "%" : "",
      elegivel ? "SIM" : "NAO",
      pctPenRecalc != null ? (pctPenRecalc * 100).toFixed(4) + "%" : "",
      snap.pct_penetracao != null ? (snap.pct_penetracao * 100).toFixed(4) + "%" : "",
      deltaPenPp != null ? (deltaPenPp * 100).toFixed(4) + "pp" : "",
    ].join("\t"));
  }

  // ----------------- Threshold delta v9 — proposta a partir dos dados ----
  console.log("\n=== Distribuição |delta_vol_liquido_xlsx_vs_v9| ===");
  const absDeltas = snapshots
    .filter((s) => s.delta_vol_liquido_xlsx_vs_v9 != null)
    .map((s) => Math.abs(s.delta_vol_liquido_xlsx_vs_v9))
    .sort((a, b) => a - b);
  if (absDeltas.length) {
    console.log(`  N = ${absDeltas.length}`);
    console.log(`  min/max:    ${absDeltas[0]} / ${absDeltas[absDeltas.length - 1]}`);
    const p = (q) => absDeltas[Math.floor(q * (absDeltas.length - 1))];
    console.log(`  p50/p90/p95/p99: ${p(0.5)} / ${p(0.9)} / ${p(0.95)} / ${p(0.99)}`);
  }

  // Proposta de threshold (pode ser ajustada): R$ 0,50 absoluto. Acima disso
  // marca flagged_v9_consistency. Abaixo, considera arredondamento aceitável.
  const PROPOSED_THRESHOLD_RS = 0.5;
  for (const snap of snapshots) {
    const flagged = snap.delta_vol_liquido_xlsx_vs_v9 != null &&
                    Math.abs(snap.delta_vol_liquido_xlsx_vs_v9) > PROPOSED_THRESHOLD_RS;
    if (flagged) {
      flaggedConsistency.push({ ym: ymOf(snap.year, snap.month), delta: snap.delta_vol_liquido_xlsx_vs_v9 });
    }
    snap.raw_data._diagnostico.flagged_v9_consistency = flagged;
    snap.raw_data._diagnostico.flagged_v9_consistency_threshold_rs = PROPOSED_THRESHOLD_RS;
  }

  // ---------------------- Sumários ---------------------------------------
  console.log("\n=== Sumário ===");
  console.log(`  Snapshots gerados: ${snapshots.length}/41`);
  const elegiveis = snapshots.filter((s) => s.raw_data._diagnostico.penetracao_recalc_status === "CALCULADO");
  const naoApl = snapshots.filter((s) => s.raw_data._diagnostico.penetracao_recalc_status === "NAO_APLICAVEL");
  const erroPen = snapshots.filter((s) => /^ERRO_/.test(s.raw_data._diagnostico.penetracao_recalc_status || ""));
  console.log(`  Meses ELEGÍVEIS (penetração calculada): ${elegiveis.length}`);
  for (const s of elegiveis) {
    const ym = ymOf(s.year, s.month);
    const d = s.raw_data._diagnostico;
    console.log(
      `    ${ym}: pct_pen_recalc=${(d.pct_penetracao_recalc * 100).toFixed(2)}%` +
      ` (snap=${d.pct_penetracao_snapshot != null ? (d.pct_penetracao_snapshot * 100).toFixed(2) + "%" : "null"})` +
      ` Δ=${d.delta_pp_penetracao != null ? (d.delta_pp_penetracao * 100).toFixed(2) + "pp" : "—"}` +
      ` flag=${d.flagged_penetracao ? "SIM" : "—"}`
    );
  }
  console.log(`  Meses NÃO-APLICÁVEL: ${naoApl.length}`);
  console.log(`  Meses com ERRO penetração: ${erroPen.length}`);
  for (const s of erroPen) {
    const d = s.raw_data._diagnostico;
    console.log(`    ${ymOf(s.year, s.month)}: ${d.penetracao_recalc_status} — ${d.penetracao_recalc_motivo}`);
  }

  // Detalhes pedidos por Diego
  const dez23 = snapshots.find((s) => s.year === 2023 && s.month === 12);
  console.log("\n=== Detalhe Dez/2023 ===");
  if (!dez23) { console.log("  (sem snapshot)"); }
  else {
    const d = dez23.raw_data._diagnostico;
    console.log(`  meta_pf:                      ${dez23.meta_pf}`);
    console.log(`  vol_avista_xlsx (ex-SRCC):    ${d.vol_avista_xlsx}`);
    console.log(`  vol_avista_v9 (ex-SRCC):      ${d.vol_avista_v9}`);
    console.log(`  delta_v9:                     ${d.delta_v9}`);
    console.log(`  pct_meta_snapshot (corrupto): ${(dez23.pct_meta * 100).toFixed(4)}%`);
    console.log(`  pct_meta_recalc:              ${d.pct_meta_recalc != null ? (d.pct_meta_recalc * 100).toFixed(4) + "%" : "null"}`);
    console.log(`  pct_pen_snapshot (corrupto):  ${(dez23.pct_penetracao * 100).toFixed(4)}%`);
    console.log(`  pct_pen_recalc (XLSX A Vista):${d.pct_penetracao_recalc != null ? (d.pct_penetracao_recalc * 100).toFixed(4) + "%" : "null"}`);
    console.log(`  delta_pp_penetracao:          ${d.delta_pp_penetracao != null ? (d.delta_pp_penetracao * 100).toFixed(4) + "pp" : "null"}`);
    console.log(`  Arquivos A Vista usados:`);
    for (const f of d.avista_files_used) console.log(`    ${f.cnpj} (${f.label}): ${f.rel}`);
    console.log(`  OPP099 dispara? Critérios: regime=META + 2023-09<=mes + meta∈[0.90,1.00) + pen>=0.30`);
    const opp099Disp = pctMetaInRange(d.pct_meta_recalc) && (d.pct_penetracao_recalc != null && d.pct_penetracao_recalc >= 0.30);
    console.log(`  → OPP099 dispara: ${opp099Disp ? "SIM" : "NÃO"}`);
    console.log(`  → Cat_Devida esperada: ${opp099Disp ? "TABELA 2" : "TABELA 1"}`);
  }

  const abr26 = snapshots.find((s) => s.year === 2026 && s.month === 4);
  console.log("\n=== Detalhe Abr/2026 ===");
  if (!abr26) { console.log("  (sem snapshot — arquivo Validador não encontrado)"); }
  else {
    const d = abr26.raw_data._diagnostico;
    console.log(`  source_file (Validador):      ${abr26.source_file}`);
    console.log(`  formato:                      ${abr26.formato}`);
    console.log(`  layout_shift_apr2026:         ${abr26.raw_data._layout_shift_apr2026}`);
    console.log(`  meta_pf:                      ${abr26.meta_pf}`);
    console.log(`  volume_liquido_atingido (val):${abr26.volume_liquido_atingido}`);
    console.log(`  cat_aplicada:                 ${abr26.cat_aplicada}`);
    console.log(`  pct_penetracao snapshot:      ${abr26.pct_penetracao != null ? (abr26.pct_penetracao * 100).toFixed(4) + "%" : "null"}`);
    console.log(`  vol_avista_xlsx (ex-SRCC):    ${d.vol_avista_xlsx}`);
    console.log(`  vol_avista_v9 (ex-SRCC):      ${d.vol_avista_v9}`);
    console.log(`  delta_v9:                     ${d.delta_v9}`);
    console.log(`  Arquivos A Vista usados (${d.avista_files_used.length}):`);
    for (const f of d.avista_files_used) console.log(`    ${f.cnpj} (${f.label}): ${f.rel}`);
    console.log(`  Penetração: ${d.penetracao_recalc_status} — ${d.penetracao_recalc_motivo || "(calculada)"}`);
  }

  // Flagged consistency
  console.log("\n=== Meses flagged_v9_consistency (|delta| > " + PROPOSED_THRESHOLD_RS + " R$) ===");
  console.log(`  Threshold proposto: R$ ${PROPOSED_THRESHOLD_RS}`);
  console.log(`  Total flagged: ${flaggedConsistency.length}/${snapshots.length}`);
  for (const f of flaggedConsistency) console.log(`    ${f.ym}: delta = R$ ${f.delta}`);

  return { flaggedMeta, flaggedPen, flaggedConsistency, elegiveis, naoApl, erroPen };
}

function pctMetaInRange(p) { return p != null && p >= 0.9 && p < 1.0; }

// ----------------------------------------- main --------------------------
async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  await runDiagnostics(supabase);

  if (DRY_RUN) {
    console.log("\n=== DRY-RUN — nada escrito em monthly_validator_snapshot ===");
    process.exit(0);
  }

  console.log("\n=== EXECUTE — DELETE + INSERT ===");
  while (true) {
    const { count, error } = await supabase
      .from("monthly_validator_snapshot")
      .select("*", { count: "exact", head: true });
    if (error) throw new Error(`count: ${error.message}`);
    if (!count) break;
    const { error: derr } = await supabase
      .from("monthly_validator_snapshot")
      .delete()
      .gte("year", 0);
    if (derr) throw new Error(`delete: ${derr.message}`);
  }

  const rowsToInsert = snapshots.map((s) => ({
    year: s.year,
    month: s.month,
    meta_pf: s.meta_pf,
    volume_liquido_atingido: s.volume_liquido_atingido,
    pct_meta: s.pct_meta,
    volume_prestamista: s.volume_prestamista,
    pct_penetracao: s.pct_penetracao,
    cat_aplicada: s.cat_aplicada,
    source_file: s.source_file,
    formato: s.formato,
    raw_data: s.raw_data || {},
    pct_penetracao_recalc: s.pct_penetracao_recalc ?? null,
    volume_prestamista_recalc: s.volume_prestamista_recalc ?? null,
    vol_liquido_avista_recalc_xlsx: s.vol_liquido_avista_recalc_xlsx ?? null,
    delta_vol_liquido_xlsx_vs_v9: s.delta_vol_liquido_xlsx_vs_v9 ?? null,
  }));
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < rowsToInsert.length; i += BATCH) {
    const slice = rowsToInsert.slice(i, i + BATCH);
    const { error } = await supabase.from("monthly_validator_snapshot").insert(slice);
    if (error) {
      console.error(`Erro batch ${i}: ${error.message}`);
      console.error("Primeira linha:", JSON.stringify(slice[0], null, 2));
      throw error;
    }
    inserted += slice.length;
    process.stdout.write(`\r  inseridos: ${inserted}/${rowsToInsert.length}`);
  }
  process.stdout.write("\n");
  const { count: cFinal, error: cErr } = await supabase
    .from("monthly_validator_snapshot")
    .select("*", { count: "exact", head: true });
  if (cErr) throw cErr;
  console.log(`\n  count(monthly_validator_snapshot) = ${cFinal}`);
  console.log(`  esperado: ${snapshots.length}`);
  if (cFinal !== snapshots.length) {
    console.error(`  FALHA: contagem inesperada (esperado ${snapshots.length}, obtido ${cFinal})`);
    process.exit(1);
  }
  console.log("\n=== Seed concluído ===");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nERRO:", e.message || e);
  process.exit(1);
});
