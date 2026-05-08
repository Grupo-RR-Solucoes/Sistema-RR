#!/usr/bin/env node
/**
 * scripts/seed_v9.cjs — Fase 4.1 Etapa 6.
 *
 * Importa auditorias/RELATORIO_AUDITORIA_FINAL_v9.xlsx para 4 tabelas:
 *   - audit_v9_avista          (~23.884 contratos)
 *   - audit_v9_prt             (~12.612 contratos)
 *   - audit_v9_enquadramento   (41 meses)
 *   - audit_v9_reconciliacao   (41 linhas, cnpj="GRUPO_RR_CONSOLIDADO")
 *
 * Para audit_v9_avista, faz merge com aba "Solicitação Regularização 2.1"
 * para popular bloco e valor_solicitacao_regularizacao nos 2.501 contratos
 * do PEDIDO_FIRME_2.1. Idem para audit_v9_prt × "Sol Reg 2.2" (2.502).
 *
 * Modos:
 *   node scripts/seed_v9.cjs --dry-run    # apenas relata, não escreve
 *   node scripts/seed_v9.cjs --execute    # executa (TRUNCATE + INSERT)
 *
 * Validações pós-seed (--execute):
 *   - count em cada tabela
 *   - sum(valor_solicitacao_regularizacao) Bloco 2.1 ≈ R$ 60.040,89
 *   - sum(valor_solicitacao_regularizacao) Bloco 2.2 ≈ R$ 47.581,88
 *   - count(reconciliacao) WHERE delta != 0 = 0
 */

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

// ----------------------------------------------------------- env --------
const ROOT = path.resolve(__dirname, "..");
const envText = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em .env.local");
  process.exit(1);
}

// ----------------------------------------------------------- args -------
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const EXECUTE = argv.includes("--execute");
if (!DRY_RUN && !EXECUTE) {
  console.error("Use --dry-run (relata) ou --execute (TRUNCATE + INSERT).");
  process.exit(1);
}

// ----------------------------------------------------------- xlsx -------
const XLSX_PATH = path.join(ROOT, "auditorias", "RELATORIO_AUDITORIA_FINAL_v9.xlsx");
console.log(`Lendo XLSX: ${XLSX_PATH}`);
const wb = XLSX.readFile(XLSX_PATH, { dense: true, cellDates: false });

function loadSheet(name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Aba ausente: ${name}`);
  const range = XLSX.utils.decode_range(ws["!ref"]);
  // Linha 1 = título, linha 2 = headers, linha 3+ = dados
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

const toNum = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.replace(/R\$/gi, "").replace(/%/g, "").replace(/\s/g, "").trim();
    const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const toStr = (v) => (v == null ? null : String(v).trim() || null);
const toBigInt = (v) => {
  const n = toNum(v);
  if (n == null) return null;
  return Math.trunc(n);
};
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// ------------------------------------------------------- mapping -------
function mapAvista(r, solReg21Map) {
  const c = toStr(r["Contrato"]);
  if (!c) return null;
  const sol = solReg21Map.get(c);
  return {
    contract_number: c,
    empresa: toStr(r["Empresa"]) || "",
    mes: toStr(r["Mês"]) || "",
    tipo: toStr(r["Tipo"]),
    produto: toStr(r["Produto"]),
    convenio: toBigInt(r["Convênio"]),
    tx_juros: toNum(r["Tx Juros (%)"]),
    prazo: toBigInt(r["Prazo"]),
    cat_aplicada: toStr(r["Cat Aplicada"]),
    cat_devida: toStr(r["Cat Devida"]),
    // valor_liquido: vem arredondado da Promotiva → numeric(14,2)
    valor_liquido: round2(toNum(r["Valor Líquido (R$)"])),
    pct_aplicado: toNum(r["% Aplicado"]),
    pct_devido: toNum(r["% Devido"]),
    // Colunas de cálculo (numeric(14,6) após migration 20260507_000002):
    // passar Number nativo do XLSX SEM round2 — preserva sub-centavos
    // necessários para SUM exato (Δ=0 em Bloco 2.1).
    comissao_paga: toNum(r["Comissão Paga (R$)"]),
    comissao_devida: toNum(r["Comissão Devida (R$)"]),
    diferenca: toNum(r["Diferença (R$)"]),
    status_fase1: toStr(r["Status Fase 1"]),
    observacoes: toStr(r["Observações"]),
    bloco: sol ? sol.bloco : null,
    valor_solicitacao_regularizacao: sol ? sol.valor : null,
    trace: null,
  };
}

function mapPrt(r, solReg22Map) {
  const c = toStr(r["Contrato"]);
  if (!c) return null;
  const sol = solReg22Map.get(c);
  return {
    contract_number: c,
    empresa: toStr(r["Empresa"]) || "",
    mes_origem: toStr(r["Mês Origem"]) || "",
    tipo: toStr(r["Tipo"]),
    produto: toStr(r["Produto"]),
    convenio: toBigInt(r["Convênio"]),
    tabela: toStr(r["Tabela"]),
    // Valores PRT: chegam arredondados da Promotiva → numeric(14,2)
    base_prt: round2(toNum(r["Base PRT (R$)"])),
    parc_tot: toBigInt(r["Parc Tot"]),
    meses_pagos: toBigInt(r["# Meses Pagos"]),
    prt_pago: round2(toNum(r["PRT Pago (R$)"])),
    prt_listado_nao_pago: round2(toNum(r["PRT Listado mas Não Pago (R$)"])),
    excedente_devido: round2(toNum(r["Excedente Devido (R$)"])),
    status_fase2: toStr(r["Status Fase 2"]),
    observacoes: toStr(r["Observações"]),
    bloco: sol ? sol.bloco : null,
    // valor_solicitacao_regularizacao: numeric(14,6) após migration
    // 20260507_000002 — passa Number nativo sem round2 por consistência
    // com audit_v9_avista (apesar de já bater em 14,2 para PRT).
    valor_solicitacao_regularizacao: sol ? sol.valor : null,
    trace: null,
  };
}

function mapEnquadramento(r) {
  const m = toStr(r["Mês"]);
  if (!m) return null;
  return {
    mes: m,
    cnpjs_ativos: toBigInt(r["CNPJs Ativos"]),
    vol_bruto: round2(toNum(r["Vol Bruto (R$)"])),
    vol_liquido: round2(toNum(r["Vol Líquido (R$)"])),
    qtd_contratos: toBigInt(r["Qtd Contratos"]),
    vol_prestamista: round2(toNum(r["Vol Prestamista (penetração)"])),
    penetracao: toNum(r["Penetração %"]),
    meta_declarada: round2(toNum(r["Meta Declarada (R$)"])),
    pct_atingido: toNum(r["% Atingido"]),
    regime: toStr(r["Regime"]),
    cat_devida: toStr(r["Cat Devida"]),
    cat_aplicada: toStr(r["Cat Aplicada"]),
    status_enquadramento: toStr(r["Status Enquadramento"]),
    impacto_estimado: round2(toNum(r["Impacto Estimado (R$)"])),
    observacoes: toStr(r["Observações"]),
  };
}

function mapReconciliacao(r) {
  const m = toStr(r["Mês"]);
  if (!m) return null;
  // Reconciliação Caixa: 41 linhas consolidadas (1 por mês × Grupo RR).
  // A v9 humana não fornece quebra por CNPJ. A Fase 4.5 (motor TS) vai
  // recalcular por CNPJ a partir de monthly_closing_entries e popular
  // 41×4=164 linhas adicionais com cnpj real. unique(mes, cnpj) permite
  // ambas (consolidado + por CNPJ) coexistirem.
  return {
    mes: m,
    cnpj: "GRUPO_RR_CONSOLIDADO",
    avista_calculado: round2(toNum(r["À Vista Calculado (R$)"])),
    avista_caixa: round2(toNum(r["À Vista Caixa (R$)"])),
    delta_avista: round2(toNum(r["Δ À Vista (R$)"])),
    prt_pago_calculado: round2(toNum(r["PRT Pago Calculado (R$)"])),
    prt_pago_caixa: round2(toNum(r["PRT Pago Caixa (R$)"])),
    delta_prt: round2(toNum(r["Δ PRT (R$)"])),
    status: toStr(r["Status"]),
  };
}

// -------------------------------------------------- carga em memória ---
console.log("Carregando abas...");
const avistaRaw = loadSheet("Auditoria À Vista");
const prtRaw = loadSheet("Auditoria PRT");
const enqRaw = loadSheet("Mapa Enquadramento");
const reconcRaw = loadSheet("Reconciliação Caixa");
const solReg21Raw = loadSheet("Solicitação Regularização 2.1");
const solReg22Raw = loadSheet("Solicitação Regularização 2.2");

console.log(`  Auditoria À Vista: ${avistaRaw.length}`);
console.log(`  Auditoria PRT: ${prtRaw.length}`);
console.log(`  Mapa Enquadramento: ${enqRaw.length}`);
console.log(`  Reconciliação Caixa: ${reconcRaw.length}`);
console.log(`  Sol Reg 2.1: ${solReg21Raw.length}`);
console.log(`  Sol Reg 2.2: ${solReg22Raw.length}`);

// Maps de Sol Reg → contract_number
const solReg21Map = new Map();
for (const r of solReg21Raw) {
  const c = toStr(r["Contrato"]);
  if (!c) continue;
  solReg21Map.set(c, {
    bloco: toStr(r["Bloco"]),
    valor: toNum(r["Valor Solicitação Regularização (R$)"]),
  });
}
const solReg22Map = new Map();
for (const r of solReg22Raw) {
  const c = toStr(r["Contrato"]);
  if (!c) continue;
  solReg22Map.set(c, {
    bloco: toStr(r["Bloco"]),
    valor: toNum(r["Valor Solicitação Regularização (R$)"]),
  });
}

// Mapeamento + dedup (PK contract_number, mantém primeira ocorrência).
// Coleta lista das duplicatas para diagnóstico + linhas de quarantine.
function dedupAndMap(rows, fnMap, sourceTable, rawRows) {
  const out = [];
  const seen = new Map(); // contract_number → { mapped, raw }
  const dupList = [];
  const quarantineRows = []; // 2 linhas (occurrence 1 e 2) por duplicata
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const m = fnMap(r);
    if (!m) continue;
    if (seen.has(m.contract_number)) {
      const first = seen.get(m.contract_number);
      // Adiciona PRIMEIRA ocorrência apenas uma vez (quando detectar dup)
      if (!first.alreadyQuarantined) {
        quarantineRows.push({
          contract_number: m.contract_number,
          occurrence: 1,
          raw_data: first.raw,
          reason: "SEM_LOOKUP_DUPLICATE_JUL_2024",
        });
        first.alreadyQuarantined = true;
      }
      // Adiciona segunda (e posteriores) ocorrências
      const occN = quarantineRows.filter((q) => q.contract_number === m.contract_number).length + 1;
      quarantineRows.push({
        contract_number: m.contract_number,
        occurrence: occN,
        raw_data: rawRows ? rawRows[i] : r,
        reason: "SEM_LOOKUP_DUPLICATE_JUL_2024",
      });
      dupList.push({
        contract: m.contract_number,
        primeiro: { mes: first.mapped.mes || first.mapped.mes_origem, status: first.mapped.status_fase1 || first.mapped.status_fase2 },
        duplicado: { mes: m.mes || m.mes_origem, status: m.status_fase1 || m.status_fase2 },
      });
      continue;
    }
    seen.set(m.contract_number, {
      mapped: m,
      raw: rawRows ? rawRows[i] : r,
      alreadyQuarantined: false,
    });
    out.push(m);
  }
  return { rows: out, dups: dupList.length, dupList, quarantineRows };
}

const {
  rows: avistaRows, dups: avistaDups, dupList: avistaDupList,
  quarantineRows: avistaQuarantine,
} = dedupAndMap(avistaRaw, (r) => mapAvista(r, solReg21Map), "audit_v9_avista", avistaRaw);
const {
  rows: prtRows, dups: prtDups, dupList: prtDupList,
  quarantineRows: prtQuarantine,
} = dedupAndMap(prtRaw, (r) => mapPrt(r, solReg22Map), "audit_v9_prt", prtRaw);
const allQuarantineRows = [...avistaQuarantine, ...prtQuarantine];
const enqRows = enqRaw.map(mapEnquadramento).filter(Boolean);
const reconcRows = reconcRaw.map(mapReconciliacao).filter(Boolean);

console.log("\n=== Mapeamento completo ===");
console.log(`  audit_v9_avista: ${avistaRows.length} (${avistaDups} dups removidos)`);
console.log(`  audit_v9_prt: ${prtRows.length} (${prtDups} dups removidos)`);
console.log(`  audit_v9_enquadramento: ${enqRows.length}`);
console.log(`  audit_v9_reconciliacao: ${reconcRows.length} (cnpj=GRUPO_RR_CONSOLIDADO)`);
console.log(`  audit_v9_duplicates_quarantine: ${allQuarantineRows.length} (esperado: 10 = 5 dups × 2 ocorrências)`);

if (avistaDupList.length) {
  console.log("\n=== Duplicatas À Vista (mantém primeira; lista para diagnóstico) ===");
  for (const d of avistaDupList) {
    console.log(
      `  contract=${d.contract} | 1ª: mes=${d.primeiro.mes} status=${d.primeiro.status} | 2ª: mes=${d.duplicado.mes} status=${d.duplicado.status}`
    );
  }
}
if (prtDupList.length) {
  console.log("\n=== Duplicatas PRT ===");
  for (const d of prtDupList) console.log(`  ${JSON.stringify(d)}`);
}

// Somas previstas (sanidade no XLSX antes de tocar o banco).
// Bloco 2.1 = SUBPAGAMENTO + SUBPAG_ABAIXO_TETO (regime VOLUME). Spec v9 §1.3.
const sumBloco21 = avistaRows
  .filter((r) => r.bloco && /^2\.1_/.test(r.bloco))
  .reduce((s, r) => s + (r.valor_solicitacao_regularizacao || 0), 0);
const sumBloco22 = prtRows
  .filter((r) => r.bloco && /^2\.2_/.test(r.bloco))
  .reduce((s, r) => s + (r.valor_solicitacao_regularizacao || 0), 0);
const reconcViolacoes = reconcRows.filter(
  (r) => Math.abs(r.delta_avista || 0) > 0.01 || Math.abs(r.delta_prt || 0) > 0.01
);

console.log("\n=== Somas previstas (do XLSX, pré-banco) ===");
console.log(`  Bloco 2.1 Σ valor_solicitacao_regularizacao: R$ ${sumBloco21.toFixed(2)} (esperado ~60.040,89)`);
console.log(`  Bloco 2.2 Σ valor_solicitacao_regularizacao: R$ ${sumBloco22.toFixed(2)} (esperado ~47.581,88)`);
console.log(`  Reconciliação violações Δ≠0: ${reconcViolacoes.length} (esperado 0)`);

// Listar blocos detectados (debug)
const blocosAvista = new Map();
for (const r of avistaRows) if (r.bloco) blocosAvista.set(r.bloco, (blocosAvista.get(r.bloco) || 0) + 1);
const blocosPrt = new Map();
for (const r of prtRows) if (r.bloco) blocosPrt.set(r.bloco, (blocosPrt.get(r.bloco) || 0) + 1);
console.log("\n=== Blocos detectados ===");
for (const [b, n] of blocosAvista) console.log(`  audit_v9_avista.bloco='${b}': ${n}`);
for (const [b, n] of blocosPrt) console.log(`  audit_v9_prt.bloco='${b}': ${n}`);

if (DRY_RUN) {
  console.log("\n=== DRY-RUN — não escreve no banco ===");
  console.log("Para executar de verdade: node scripts/seed_v9.cjs --execute");
  process.exit(0);
}

// ----------------------------------------------------- execução --------
console.log("\n=== EXECUTE — TRUNCATE + INSERT ===");
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function truncate(tabela, pkCol) {
  // Sem RPC custom — usamos delete com filtro tautológico.
  // Limite de 1000 padrão do Supabase REST exige iterar até count=0.
  while (true) {
    const { count, error } = await supabase
      .from(tabela)
      .select("*", { count: "exact", head: true });
    if (error) throw new Error(`Erro contando ${tabela}: ${error.message}`);
    if (!count) break;
    const filter = pkCol === "id" ? "gte" : "neq";
    const value = pkCol === "id" ? -1 : "__nope_unlikely_pk__";
    const { error: delErr } = await supabase.from(tabela).delete()[filter](pkCol, value);
    if (delErr) throw new Error(`Erro deletando ${tabela}: ${delErr.message}`);
  }
}

async function insertBatched(tabela, rows, batchSize = 500) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(tabela).insert(batch);
    if (error) {
      console.error(`Erro batch ${i}-${i + batch.length} em ${tabela}: ${error.message}`);
      // Tenta debugar mostrando 1 linha
      console.error("Primeira linha do batch:", JSON.stringify(batch[0], null, 2));
      throw error;
    }
    inserted += batch.length;
    process.stdout.write(`\r  ${tabela}: ${inserted}/${rows.length}`);
  }
  process.stdout.write("\n");
  return inserted;
}

async function main() {
  // Verifica que a tabela quarantine existe (criada via migration
  // 20260507_000003_audit_v9_quarantine.sql, executada manualmente no
  // Studio antes do --execute).
  const { error: errQ } = await supabase
    .from("audit_v9_duplicates_quarantine")
    .select("contract_number", { count: "exact", head: true });
  if (errQ) {
    console.error("ERRO: tabela audit_v9_duplicates_quarantine ausente.");
    console.error("Execute primeiro a migration:");
    console.error("  supabase/migrations/20260507_000003_audit_v9_quarantine.sql");
    process.exit(1);
  }

  console.log("\n--- TRUNCATE ---");
  await truncate("audit_v9_duplicates_quarantine", "id");
  await truncate("audit_v9_avista", "contract_number");
  await truncate("audit_v9_prt", "contract_number");
  await truncate("audit_v9_enquadramento", "mes");
  await truncate("audit_v9_reconciliacao", "id");
  console.log("  OK");

  console.log("\n--- INSERT ---");
  await insertBatched("audit_v9_enquadramento", enqRows);
  await insertBatched("audit_v9_reconciliacao", reconcRows);
  await insertBatched("audit_v9_avista", avistaRows);
  await insertBatched("audit_v9_prt", prtRows);
  if (allQuarantineRows.length > 0) {
    await insertBatched("audit_v9_duplicates_quarantine", allQuarantineRows);
  }

  console.log("\n--- Validações pós-seed (Condição 3) ---");

  async function countTable(t) {
    const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
    if (error) throw error;
    return count;
  }
  // Soma agregada via paginação (PostgREST limita 1000 por page; precisamos
  // varrer tudo para somar exato com numeric(14,6)).
  async function sumColuna(tabela, coluna, filtroFn) {
    let total = 0;
    let from = 0;
    const PAGE = 1000;
    while (true) {
      let q = supabase.from(tabela).select(`${coluna},bloco`).range(from, from + PAGE - 1);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;
      for (const r of data) {
        if (!filtroFn || filtroFn(r)) total += Number(r[coluna] || 0);
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return total;
  }

  const cAvista = await countTable("audit_v9_avista");
  const cPrt = await countTable("audit_v9_prt");
  const cEnq = await countTable("audit_v9_enquadramento");
  const cRec = await countTable("audit_v9_reconciliacao");
  const cQuar = await countTable("audit_v9_duplicates_quarantine");

  const sBloco21 = await sumColuna(
    "audit_v9_avista",
    "valor_solicitacao_regularizacao",
    (r) => r.bloco && /^2\.1_/.test(r.bloco)
  );
  const sBloco22 = await sumColuna(
    "audit_v9_prt",
    "valor_solicitacao_regularizacao",
    (r) => r.bloco && /^2\.2_/.test(r.bloco)
  );

  const { count: cVioReconc, error: erVio } = await supabase
    .from("audit_v9_reconciliacao")
    .select("*", { count: "exact", head: true })
    .or("delta_avista.gt.0.01,delta_avista.lt.-0.01,delta_prt.gt.0.01,delta_prt.lt.-0.01");
  if (erVio) throw erVio;

  // 8 verificações Condição 3
  const checks = [
    { nome: "1. count audit_v9_avista = 23.879", obtido: cAvista, esperado: 23879, ok: cAvista === 23879 },
    { nome: "2. count audit_v9_prt = 12.612", obtido: cPrt, esperado: 12612, ok: cPrt === 12612 },
    { nome: "3. count audit_v9_enquadramento = 41", obtido: cEnq, esperado: 41, ok: cEnq === 41 },
    { nome: "4. count audit_v9_reconciliacao = 41 (consolidado)", obtido: cRec, esperado: 41, ok: cRec === 41 },
    { nome: "5. Σ Bloco 2.1 audit_v9_avista = R$ 60.040,89", obtido: sBloco21.toFixed(2), esperado: "60040.89", ok: Math.abs(sBloco21 - 60040.89) < 0.005 },
    { nome: "6. Σ Bloco 2.2 audit_v9_prt = R$ 47.581,88", obtido: sBloco22.toFixed(2), esperado: "47581.88", ok: Math.abs(sBloco22 - 47581.88) < 0.005 },
    { nome: "7. Reconciliação violações Δ≠0 = 0", obtido: cVioReconc, esperado: 0, ok: cVioReconc === 0 },
    { nome: "8. count audit_v9_duplicates_quarantine = 10", obtido: cQuar, esperado: 10, ok: cQuar === 10 },
  ];
  console.log("");
  let failures = 0;
  for (const c of checks) {
    const tag = c.ok ? "PASS" : "FAIL";
    console.log(`  ${tag} — ${c.nome} (obtido=${c.obtido}, esperado=${c.esperado})`);
    if (!c.ok) failures += 1;
  }

  // ROLLBACK se qualquer item 1-7 falhar (item 8 quarantine não bloqueia,
  // mas é reportado como aviso).
  const failuresCriticos = checks.slice(0, 7).filter((c) => !c.ok).length;
  if (failuresCriticos > 0) {
    console.error(`\n=== ROLLBACK: ${failuresCriticos} validação(ões) crítica(s) falharam ===`);
    await truncate("audit_v9_duplicates_quarantine", "id");
    await truncate("audit_v9_avista", "contract_number");
    await truncate("audit_v9_prt", "contract_number");
    await truncate("audit_v9_enquadramento", "mes");
    await truncate("audit_v9_reconciliacao", "id");
    console.error("4 tabelas + quarantine zeradas. Investigue e re-execute.");
    process.exit(1);
  }

  console.log(`\n=== Seed concluído (${checks.length - failures}/${checks.length} validações PASS) ===`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\nERRO:", e.message || e);
  process.exit(1);
});
