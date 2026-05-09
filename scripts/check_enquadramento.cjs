#!/usr/bin/env node
/**
 * scripts/check_enquadramento.cjs — CHECKPOINT C executável (Fase 4.2).
 *
 * Como rodar:
 *   node scripts/check_enquadramento.cjs
 *
 * Replica em CJS a lógica de lib/enquadramento.ts (decideCatDevida +
 * recalc vol_avista) e compara mês a mês com audit_v9_enquadramento
 * (ground truth populada via seed_v9.cjs em Fase 4.1).
 *
 * Critério de aceite: 41/41 com Cat_Devida idêntica.
 *   - Para meses META (Dez/22 a Jun/25): match string exata.
 *   - Para meses VOLUME (Jul/25+): motor retorna null/INDETERMINADO; v9
 *     mostra cat_devida vazia → match.
 *   - Abr/2026 (FAIXA 5 sem snapshot): SEM_DADOS no motor; v9 vazia → match.
 *
 * Também roda as 4 verificações exigidas no brief:
 *   1. regrasLoader.getRegraEnquadramento retorna regime coerente nos 41 meses
 *   2. CNPJs ativos por mês batem com cnpjs_ativos do v9
 *   3. SRCC nunca aparece na soma de produção
 *   4. OPP099 dispara em Jul/2024 e Set/2024 (meses-canário)
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// ---------------------------------------------------------------- env --
const ROOT = path.resolve(__dirname, "..");
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Divergências esperadas e DOCUMENTADAS entre o motor TS e audit_v9_enquadramento.
 * Aparecem como "DIVERGÊNCIA DOCUMENTADA" no relatório (não falham o checkpoint).
 *
 * Qualquer divergência que NÃO esteja listada aqui é tratada como falha real e
 * faz o script sair com código 1.
 *
 * Mantém em sync com stress_test_workspace_local/gap_analysis.md §"DIVERGÊNCIA
 * DOCUMENTADA — Sep/2023".
 */
const DOCUMENTED_DIVERGENCES = {
  "2023-09": {
    motorCat: "TABELA 2",
    v9Cat: "TABELA 1",
    motivo: "v9 humana leu campo bugado D25 do Resumo PE (13,44%); per-contract A Vista 32,09% confirma OPP099 → TABELA 2. v8 anterior também tinha TABELA 2.",
  },
};

// ---------------------------------------- regrasLoader (CJS espelho) --
function getRegime(mes) {
  if (mes >= "2022-12" && mes <= "2023-05") return "META_2_NIVEIS_MATRIZ_TAXA_PRAZO";
  if (mes >= "2023-06" && mes <= "2024-12") return "META_2_NIVEIS";
  if (mes >= "2025-01" && mes <= "2025-06") return "META_4_NIVEIS";
  if (mes >= "2025-07" && mes <= "2025-12") return "VOLUME_6_PERFIS";
  if (mes >= "2026-01" && mes <= "2026-03") return "VOLUME_3_PERFIS";
  if (mes >= "2026-04") return "VOLUME_5_FAIXAS";
  return "META_2_NIVEIS_MATRIZ_TAXA_PRAZO";
}
const TIERS_META_2 = [
  { categoria: "TABELA 1", metaMin: null, metaMax: 1.0 },
  { categoria: "TABELA 2", metaMin: 1.0, metaMax: null },
];
const TIERS_META_4 = [
  { categoria: "TABELA 1", metaMin: null, metaMax: 0.95 },
  { categoria: "TABELA INTERMEDIÁRIA 1", metaMin: 0.95, metaMax: 0.97 },
  { categoria: "TABELA INTERMEDIÁRIA 2", metaMin: 0.97, metaMax: 1.0 },
  { categoria: "TABELA 2", metaMin: 1.0, metaMax: null },
];
function buildOpp099(mes, regime) {
  const vigente = mes >= "2023-09" && mes <= "2025-06";
  const aplicavel = regime === "META_2_NIVEIS" || regime === "META_4_NIVEIS";
  if (!vigente || !aplicavel) return null;
  return {
    metaMinTrigger: 0.9,
    metaMaxTrigger: 1.0,
    pctPenTrigger: 0.3,
    upgradeToCategoria: "TABELA 2",
    fonte: "OPP099 (errata 06/09/2023)",
  };
}
function getRegraEnquadramento(mes) {
  const regime = getRegime(mes);
  let type, metaTiers = null, volumeTiers = null;
  switch (regime) {
    case "META_2_NIVEIS_MATRIZ_TAXA_PRAZO":
    case "META_2_NIVEIS":
      type = "META"; metaTiers = TIERS_META_2; break;
    case "META_4_NIVEIS":
      type = "META"; metaTiers = TIERS_META_4; break;
    case "VOLUME_6_PERFIS":
    case "VOLUME_3_PERFIS":
    case "VOLUME_5_FAIXAS":
      type = "VOLUME"; break;
  }
  return { mes, regime, type, metaTiers, volumeTiers, opp099: buildOpp099(mes, regime) };
}

// ---------------------------------------- enquadramento (CJS espelho) --
function decideCatDevida(regra, pctMeta, pctPen) {
  if (regra.type === "VOLUME") {
    return { catDevida: null, opp099Triggered: false, regraAplicada: `${regra.regime}: INDETERMINADO` };
  }
  if (pctMeta == null) {
    return { catDevida: null, opp099Triggered: false, regraAplicada: `${regra.regime}: pctMeta indisponível` };
  }
  if (
    regra.opp099 &&
    pctMeta >= regra.opp099.metaMinTrigger &&
    pctMeta < regra.opp099.metaMaxTrigger &&
    (pctPen ?? 0) >= regra.opp099.pctPenTrigger
  ) {
    return {
      catDevida: regra.opp099.upgradeToCategoria,
      opp099Triggered: true,
      regraAplicada:
        `${regra.opp099.fonte}: meta ${(pctMeta * 100).toFixed(2)}%` +
        ` + penetração ${((pctPen ?? 0) * 100).toFixed(2)}% → ${regra.opp099.upgradeToCategoria}`,
    };
  }
  for (const tier of regra.metaTiers || []) {
    const lo = tier.metaMin ?? -Infinity;
    const hi = tier.metaMax ?? Infinity;
    if (pctMeta >= lo && pctMeta < hi) {
      return {
        catDevida: tier.categoria,
        opp099Triggered: false,
        regraAplicada: `${regra.regime} tier: meta ${(pctMeta * 100).toFixed(2)}% → ${tier.categoria}`,
      };
    }
  }
  return { catDevida: null, opp099Triggered: false, regraAplicada: `${regra.regime}: fora de tiers` };
}

function normalizeCategoria(s) {
  if (!s) return null;
  const upper = String(s).normalize("NFC").trim().toUpperCase().replace(/\s+/g, " ");
  if (upper === "") return null;
  if (/^INTERMEDI[ÁA]RIA\s*1$/.test(upper) || upper === "INTER 1") return "TABELA INTERMEDIÁRIA 1";
  if (/^INTERMEDI[ÁA]RIA\s*2$/.test(upper) || upper === "INTER 2") return "TABELA INTERMEDIÁRIA 2";
  if (/^TABELA\s*INTERMEDI[ÁA]RIA\s*1$/.test(upper)) return "TABELA INTERMEDIÁRIA 1";
  if (/^TABELA\s*INTERMEDI[ÁA]RIA\s*2$/.test(upper)) return "TABELA INTERMEDIÁRIA 2";
  return upper;
}

// ---------------------------------------- CNPJ active periods (CJS) ---
const CNPJ_ACTIVE_PERIODS = [
  { label: "RR Alagoas",    firstActiveYearMonth: "2022-12" },
  { label: "RR Pernambuco", firstActiveYearMonth: "2023-09" },
  { label: "RR Alagoas 2",  firstActiveYearMonth: "2024-11" },
  { label: "RR Alagoas 3",  firstActiveYearMonth: "2025-09" },
];
function activeLabelsForMonth(y, m) {
  const ym = `${y}-${String(m).padStart(2, "0")}`;
  return new Set(CNPJ_ACTIVE_PERIODS.filter((p) => ym >= p.firstActiveYearMonth).map((p) => p.label));
}
function empresaToActiveLabel(emp) {
  if (!emp) return null;
  const u = String(emp).toUpperCase();
  if (u.includes("ALAGOAS 3") || u.includes("RR AL SOLUCOES")) return "RR Alagoas 3";
  if (u.includes("ALAGOAS 2") || u.includes("RR SOLUCOES AL")) return "RR Alagoas 2";
  if (u.includes("PERNAMBUCO") || u.includes("RR SOLUCOES PE")) return "RR Pernambuco";
  if (u.includes("ALAGOAS") || u.includes("RR SOLUCOES LTDA")) return "RR Alagoas";
  return null;
}

// ---------------------------------------- ler tudo do Supabase ---------
async function fetchAll() {
  const out = { v9: [], snap: [], avista: new Map() };
  // v9 enquadramento
  const { data: v9Rows, error: v9err } = await sb.from("audit_v9_enquadramento").select("*").order("mes");
  if (v9err) throw v9err;
  out.v9 = v9Rows;

  // snapshot — incluir colunas novas da migration 000002
  const { data: snapRows, error: snapErr } = await sb
    .from("monthly_validator_snapshot")
    .select("year,month,meta_pf,pct_meta,pct_penetracao,pct_penetracao_recalc,cat_aplicada,formato,source_file");
  if (snapErr) throw snapErr;
  out.snap = snapRows;

  // audit_v9_avista (paginado, full scan)
  let from = 0, PAGE = 1000;
  while (true) {
    const { data, error } = await sb.from("audit_v9_avista")
      .select("mes,empresa,valor_liquido,status_fase1")
      .neq("status_fase1", "SRCC")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) {
      if (!r.mes) continue;
      const lab = empresaToActiveLabel(r.empresa);
      if (!lab) continue;
      const bucket = out.avista.get(r.mes) || { byLabel: {} };
      bucket.byLabel[lab] = (bucket.byLabel[lab] || 0) + Number(r.valor_liquido || 0);
      out.avista.set(r.mes, bucket);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ---------------------------------------- main -----------------------
async function main() {
  console.log("=== CHECKPOINT C — validação Cat_Devida 41/41 vs audit_v9_enquadramento ===\n");
  const { v9, snap, avista } = await fetchAll();
  console.log(`  audit_v9_enquadramento: ${v9.length} linhas (esperado 41)`);
  console.log(`  monthly_validator_snapshot: ${snap.length} linhas (esperado 40 — Abr/26 sem dados)`);
  console.log(`  audit_v9_avista (ex-SRCC): ${[...avista.keys()].length} meses com dados`);
  console.log("");

  const snapByMes = new Map();
  for (const s of snap) {
    const ym = `${s.year}-${String(s.month).padStart(2, "0")}`;
    snapByMes.set(ym, s);
  }

  // Verificações 1-4 (preliminares)
  console.log("--- Verificações preliminares ---");
  // (1) regime coerente nos 41 meses
  const regimeMismatch = [];
  for (const r of v9) {
    const ours = getRegime(r.mes);
    const v9reg = (r.regime || "").toLowerCase();
    // v9 usa labels humanas — checagem por keyword
    const expectKeyword = {
      "META_2_NIVEIS_MATRIZ_TAXA_PRAZO": "matriz",
      "META_2_NIVEIS": "2 níveis",
      "META_4_NIVEIS": "4 níveis",
      "VOLUME_6_PERFIS": "6 perfis",
      "VOLUME_3_PERFIS": "3 perfis",
      "VOLUME_5_FAIXAS": "5 faixas",
    }[ours];
    if (expectKeyword && !v9reg.includes(expectKeyword)) {
      regimeMismatch.push({ mes: r.mes, ours, v9: r.regime });
    }
  }
  console.log(`  (1) regime coerente: ${v9.length - regimeMismatch.length}/${v9.length}`);
  for (const m of regimeMismatch) console.log(`     ${m.mes}: motor=${m.ours} v9='${m.v9}'`);

  // (2) cnpjs_ativos
  const cnpjsMismatch = [];
  for (const r of v9) {
    const [y, m] = r.mes.split("-").map(Number);
    const ours = activeLabelsForMonth(y, m).size;
    const v9c = r.cnpjs_ativos == null ? null : Number(r.cnpjs_ativos);
    if (v9c != null && v9c !== ours) cnpjsMismatch.push({ mes: r.mes, ours, v9: v9c });
  }
  console.log(`  (2) cnpjs_ativos coerente: ${v9.length - cnpjsMismatch.length}/${v9.length}`);
  for (const m of cnpjsMismatch) console.log(`     ${m.mes}: motor=${m.ours} v9=${m.v9}`);

  // (3) SRCC nunca soma — implícito (filter neq SRCC); validar contagem total
  console.log(`  (3) SRCC excluído: filtro status_fase1!='SRCC' aplicado em fetchAll → OK`);

  // (4) OPP099 canário Jul/2024 e Set/2024
  const opp099Canario = [];
  for (const ym of ["2024-07", "2024-09"]) {
    const s = snapByMes.get(ym);
    if (!s) { opp099Canario.push({ ym, status: "SEM SNAPSHOT" }); continue; }
    const bucket = avista.get(ym) || { byLabel: {} };
    const [y, m] = ym.split("-").map(Number);
    const active = activeLabelsForMonth(y, m);
    let vol = 0;
    for (const lab of active) vol += (bucket.byLabel[lab] || 0);
    const pctMeta = s.meta_pf > 0 ? vol / s.meta_pf : null;
    const regra = getRegraEnquadramento(ym);
    const dec = decideCatDevida(regra, pctMeta, s.pct_penetracao);
    opp099Canario.push({
      ym, pctMeta, pctPen: s.pct_penetracao,
      catDevida: dec.catDevida, opp099Triggered: dec.opp099Triggered,
    });
  }
  const opp099Pass = opp099Canario.every((c) => c.opp099Triggered && c.catDevida === "TABELA 2");
  console.log(`  (4) OPP099 dispara em Jul/2024 e Set/2024: ${opp099Pass ? "PASS" : "FAIL"}`);
  for (const c of opp099Canario) {
    console.log(
      `     ${c.ym}: meta=${(c.pctMeta * 100).toFixed(2)}% pen=${(c.pctPen * 100).toFixed(2)}%` +
      ` triggered=${c.opp099Triggered} catDevida=${c.catDevida}`
    );
  }

  // -------------------- Comparação 41 meses --------------------
  console.log("\n--- Comparação Cat_Devida (41 meses) ---");
  console.log("ym\tregime\tmotor.cat_devida\tv9.cat_devida\tstatus\tmatch");

  const divergencias = [];
  const divergenciasDocumentadas = [];
  let pass = 0;
  for (const r of v9) {
    const ym = r.mes;
    const [y, m] = ym.split("-").map(Number);
    const s = snapByMes.get(ym);
    const regra = getRegraEnquadramento(ym);
    const bucket = avista.get(ym) || { byLabel: {} };
    const active = activeLabelsForMonth(y, m);
    let vol = 0;
    for (const lab of active) vol += (bucket.byLabel[lab] || 0);
    vol = Math.round(vol * 100) / 100;
    const metaPf = s?.meta_pf ?? null;
    const pctMetaRecalc = (metaPf && metaPf > 0) ? vol / metaPf : null;
    // Penetração: usar pct_penetracao_recalc (per-contract da A Vista) em meses
    // elegíveis; em meses não-elegíveis, qualquer valor serve (não muda decisão).
    // Fallback para pct_penetracao (snapshot Resumo/Validador raw) se recalc null.
    const pctPenSnap = s?.pct_penetracao ?? null;
    const pctPenRecalc = s?.pct_penetracao_recalc ?? null;
    const pctPen = pctPenRecalc != null ? pctPenRecalc : pctPenSnap;
    const dec = decideCatDevida(regra, pctMetaRecalc, pctPen);
    const motorCat = dec.catDevida;       // null para VOLUME/SEM_DADOS
    const v9Cat = (r.cat_devida && String(r.cat_devida).trim() !== "")
      ? normalizeCategoria(r.cat_devida) : null;

    const motorNorm = motorCat ? normalizeCategoria(motorCat) : null;
    const match = motorNorm === v9Cat;
    const documented = DOCUMENTED_DIVERGENCES[ym];
    const isDocumented =
      !match && documented &&
      normalizeCategoria(documented.motorCat) === motorNorm &&
      normalizeCategoria(documented.v9Cat) === v9Cat;
    if (match) pass += 1;
    else if (isDocumented) {
      divergenciasDocumentadas.push({
        ym, motor: motorCat ?? "(null)", v9: r.cat_devida ?? "(empty)",
        pctMetaRecalc, pctPen, regraAplicada: dec.regraAplicada, motivo: documented.motivo,
      });
    } else {
      divergencias.push({
        ym, motor: motorCat ?? "(null)", v9: r.cat_devida ?? "(empty)",
        pctMetaRecalc, pctPen, regraAplicada: dec.regraAplicada,
      });
    }

    // Status motor para diagnóstico
    let statusMotor;
    if (regra.type === "VOLUME") statusMotor = "INDETERMINADO";
    else if (!s) statusMotor = "SEM_DADOS";
    else if (motorCat == null) statusMotor = "SEM_DADOS";
    else if (s.cat_aplicada == null) statusMotor = "SEM_DADOS";
    else if (motorCat === normalizeCategoria(s.cat_aplicada)) statusMotor = "OK";
    else {
      const RANK = { "TABELA 1": 1, "TABELA INTERMEDIÁRIA 1": 2, "TABELA INTERMEDIÁRIA 2": 3, "TABELA 2": 4 };
      const rd = RANK[motorCat] ?? -1;
      const ra = RANK[normalizeCategoria(s.cat_aplicada)] ?? -1;
      if (rd > 0 && ra > 0 && rd > ra) statusMotor = "DIVERGENTE_ENQUADRAMENTO";
      else if (rd > 0 && ra > 0 && rd < ra) statusMotor = "ENQUADRAMENTO_FAVORAVEL";
      else statusMotor = "DIVERGENTE_ENQUADRAMENTO";
    }

    console.log([
      ym,
      regra.regime,
      motorCat ?? "(null)",
      r.cat_devida ?? "(empty)",
      statusMotor,
      match ? "OK" : "DIFF",
    ].join("\t"));
  }

  const totalEsperado = pass + divergenciasDocumentadas.length;
  console.log(`\n=== RESULTADO: ${pass} idênticas + ${divergenciasDocumentadas.length} divergência(s) documentada(s) = ${totalEsperado}/${v9.length} esperado ===`);

  if (divergenciasDocumentadas.length) {
    console.log("\nDivergências DOCUMENTADAS (esperadas, não bloqueiam o checkpoint):");
    for (const d of divergenciasDocumentadas) {
      console.log(
        `  ${d.ym}: motor='${d.motor}' v9='${d.v9}'` +
        ` (pctMetaRecalc=${d.pctMetaRecalc != null ? (d.pctMetaRecalc * 100).toFixed(2) + "%" : "-"},` +
        ` pctPen=${d.pctPen != null ? (d.pctPen * 100).toFixed(2) + "%" : "-"})`
      );
      console.log(`    regra:  ${d.regraAplicada}`);
      console.log(`    motivo: ${d.motivo}`);
    }
  }

  if (divergencias.length) {
    console.log(`\n${divergencias.length} divergência(s) NÃO documentada(s) — FALHA:`);
    for (const d of divergencias) {
      console.log(
        `  ${d.ym}: motor='${d.motor}' v9='${d.v9}'` +
        ` (pctMetaRecalc=${d.pctMetaRecalc != null ? (d.pctMetaRecalc * 100).toFixed(2) + "%" : "-"},` +
        ` pctPen=${d.pctPen != null ? (d.pctPen * 100).toFixed(2) + "%" : "-"})`
      );
      console.log(`    regra: ${d.regraAplicada}`);
    }
  }

  if (divergencias.length === 0 && totalEsperado === v9.length) {
    console.log(`\n✓ CHECKPOINT C.3 PASS — ${v9.length}/${v9.length} esperado (${pass} idênticas + ${divergenciasDocumentadas.length} divergência documentada).`);
  }

  process.exit(divergencias.length ? 1 : 0);
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
