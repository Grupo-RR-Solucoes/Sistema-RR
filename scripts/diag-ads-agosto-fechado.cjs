#!/usr/bin/env node
/*
 * scripts/diag-ads-agosto-fechado.cjs — agosto DEPOIS dos 2 PDFs da ADS.
 * READ-ONLY.
 *
 * ARMADILHA DE LEITURA que este script existe para evitar: `created_at` do PMR
 * NAO se move num upsert, e nao ha trigger de `updated_at` neste banco (medido:
 * zero triggers de updated_at em 64 migrations). Entao os dois carimbam a
 * PRIMEIRA gravacao para sempre, e usa-los para responder "quem reescreveu, e
 * quando" da a resposta errada com cara de certa. Quem responde e
 * `calculated_at`, que o consolidador escreve em toda rodada.
 *
 * Mede:
 *   1. QUEM reescreveu o PMR de 2026-08 e QUANDO (calculated_at por empresa/source);
 *   2. o SEGURO: bbts_fechamento_totais de 2026-08 (seguro_total) e as colunas de
 *      seguro no daily da ADS;
 *   3. o RASTRO: a coluna pos_import_diag existe? Se nao, o UPDATE do import
 *      levou 42703 e o rastro se perdeu — de novo, e no caso que a instrumentacao
 *      foi feita para pegar;
 *   4. os imports da ADS (daily_imports) e o rules_stale de agora.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

const BBTS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const brl = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: comps } = await sb.from("companies").select("id,name");
  const ne = (id) => ((comps || []).find((c) => c.id === id) || {}).name || String(id).slice(0, 8);

  // ---------------------------------------------------------------- 1. quem/quando
  console.log("\n############ 1. quem reescreveu o PMR de 2026-08, e quando ############");
  const { data: pmr, error: ePmr } = await sb
    .from("promoter_monthly_results")
    .select("promoter_id, company_id, source, production_value, final_commission_value, created_at, calculated_at")
    .eq("year", 2026).eq("month", 8);
  if (ePmr) { console.log("  ERRO: " + ePmr.message); }
  else {
    const g = new Map();
    for (const r of pmr || []) {
      const k = ne(r.company_id) + " | " + r.source;
      const a = g.get(k) || { n: 0, calcMin: "", calcMax: "", criadoMin: "", prod: 0, com: 0 };
      a.n++;
      a.prod += Number(r.production_value) || 0;
      a.com += Number(r.final_commission_value) || 0;
      const c = String(r.calculated_at || "");
      if (!a.calcMin || c < a.calcMin) a.calcMin = c;
      if (c > a.calcMax) a.calcMax = c;
      const cr = String(r.created_at || "");
      if (!a.criadoMin || cr < a.criadoMin) a.criadoMin = cr;
      g.set(k, a);
    }
    console.log("  empresa | source                        n   created_at (1a gravacao)   calculated_at (ULTIMA rodada)");
    for (const kv of [...g].sort()) {
      const a = kv[1];
      console.log("  " + kv[0].padEnd(36) + String(a.n).padStart(3) + "   " +
        a.criadoMin.slice(0, 19) + "   " + a.calcMin.slice(0, 19) +
        (a.calcMin !== a.calcMax ? " .. " + a.calcMax.slice(0, 19) : ""));
    }
    console.log("\n  valores de AGORA x a medicao das 14h25 (antes dos PDFs da ADS):");
    const antes = {
      "ADS Consultoria Negocial | bbts": { prod: 321023.07, com: 6028.12 },
      "RR ALAGOAS 1 | fechamento": { prod: 740053.27, com: 17863.56 },
      "RR ALAGOAS 2 | fechamento": { prod: 791738.59, com: 13953.67 },
      "RR ALAGOAS 3 | fechamento": { prod: 1863437.67, com: 35745.35 },
      "RR PERNAMBUCO | fechamento": { prod: 1389946.36, com: 29197.12 },
    };
    console.log("  chave                                  Δ producao        Δ comissao");
    for (const kv of [...g].sort()) {
      const a = kv[1];
      const b = antes[kv[0]];
      if (!b) { console.log("  " + kv[0].padEnd(36) + "  (sem baseline)"); continue; }
      const dp = Math.round((a.prod - b.prod) * 100) / 100;
      const dc = Math.round((a.com - b.com) * 100) / 100;
      console.log("  " + kv[0].padEnd(36) + brl(dp).padStart(16) + brl(dc).padStart(16) +
        (dp || dc ? "   <-- MUDOU" : ""));
    }
  }

  // ---------------------------------------------------------------- 2. o seguro
  console.log("\n############ 2. o SEGURO ############");
  const { data: tot, error: eTot } = await sb.from("bbts_fechamento_totais").select("*").order("competencia");
  if (eTot) console.log("  ERRO: " + eTot.message);
  else {
    console.log("  bbts_fechamento_totais (" + tot.length + " linhas):");
    console.log("  competencia   pagamento_avt   pag_prt  abertura   glosa  pagamento_total  seguro_total  arquivo");
    for (const r of tot) {
      console.log("  " + String(r.competencia).slice(0, 10) +
        String(brl(r.pagamento_avt)).padStart(16) +
        String(brl(r.pagamento_prt)).padStart(10) +
        String(brl(r.abertura_conta)).padStart(11) +
        String(brl(r.glosa)).padStart(8) +
        String(brl(r.pagamento_total)).padStart(17) +
        String(r.seguro_total === null ? "NULL" : brl(r.seguro_total)).padStart(14) +
        "  " + String(r.arquivo_origem || "-").slice(0, 32));
      const soma = Math.round((Number(r.pagamento_avt) + Number(r.pagamento_prt) + Number(r.abertura_conta) + Number(r.glosa)) * 100) / 100;
      const fecha = Math.abs(soma - Number(r.pagamento_total)) < 0.005;
      console.log("      identidade avt+prt+abertura+glosa = " + brl(soma) + "  -> " + (fecha ? "FECHA" : "NAO FECHA"));
    }
  }

  console.log("\n  --- colunas de seguro no daily da ADS (balde por mes de movimento) ---");
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from("daily_production_records")
      .select("id,created_at,movement_date,contract_date,proposal_date,bbts_pag_avista,bbts_seguro_pago,gross_value,net_value,insurance_value")
      .eq("company_id", BBTS).range(from, from + 999);
    if (error) { console.log("  ERRO: " + error.message); break; }
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  const bucket = (r) => String(r.movement_date || r.contract_date || r.proposal_date || "").slice(0, 7);
  const gd = new Map();
  for (const r of all) {
    const b = bucket(r);
    const a = gd.get(b) || { n: 0, avista: 0, seguroPago: 0, seguroPagoNaoNulo: 0, insurance: 0, max: "" };
    a.n++;
    a.avista += Number(r.bbts_pag_avista) || 0;
    a.seguroPago += Number(r.bbts_seguro_pago) || 0;
    if (r.bbts_seguro_pago !== null && r.bbts_seguro_pago !== undefined) a.seguroPagoNaoNulo++;
    a.insurance += Number(r.insurance_value) || 0;
    if (String(r.created_at) > a.max) a.max = String(r.created_at);
    gd.set(b, a);
  }
  console.log("  balde     n   Σ bbts_pag_avista   Σ bbts_seguro_pago  (nao-nulos)   Σ insurance_value   ultimo created_at");
  for (const kv of [...gd].sort()) {
    const a = kv[1];
    console.log("  " + kv[0] + String(a.n).padStart(5) + brl(a.avista).padStart(20) + brl(a.seguroPago).padStart(21) +
      String(a.seguroPagoNaoNulo).padStart(12) + brl(a.insurance).padStart(20) + "   " + a.max.slice(0, 19));
  }

  // ---------------------------------------------------------------- 3. o rastro
  console.log("\n############ 3. o RASTRO — a coluna pos_import_diag existe? ############");
  const { error: eCol } = await sb.from("monthly_closing_imports").select("id, pos_import_diag").limit(1);
  if (eCol) {
    console.log("  NAO EXISTE: " + (eCol.code || "") + " " + eCol.message);
    console.log("  >>> qualquer UPDATE da rota nesta coluna levaria exatamente este 42703.");
  } else {
    console.log("  EXISTE.");
    const { data: comDiag } = await sb.from("monthly_closing_imports")
      .select("id, year, month, created_at, pos_import_diag").not("pos_import_diag", "is", null)
      .order("created_at", { ascending: false }).limit(10);
    console.log("  imports com rastro: " + (comDiag || []).length);
    for (const i of comDiag || []) console.log("    " + String(i.created_at).slice(0, 19) + "  " + i.year + "-" + String(i.month).padStart(2, "0") + "  " + JSON.stringify(i.pos_import_diag).slice(0, 200));
  }

  // ---------------------------------------------------------------- 4. imports
  console.log("\n############ 4. os imports da ADS e o estado das reguas ############");
  const { data: di } = await sb.from("daily_imports").select("*").order("created_at", { ascending: false }).limit(8);
  console.log("  ultimos 8 daily_imports (e por onde o fechamento da ADS se registra):");
  for (const d of di || []) {
    console.log("    " + String(d.created_at).slice(0, 19) + "  " + String(d.file_name || "-").slice(0, 46).padEnd(46) +
      " status=" + d.status + "  linhas=" + (d.rows_count != null ? d.rows_count : "?"));
  }
  const { data: det, error: eDet } = await sb.rpc("detect_rules_stale");
  if (eDet) console.log("  detect_rules_stale: ERRO " + eDet.message);
  else {
    console.log("\n  detect_rules_stale:");
    for (const r of det || []) console.log("    " + r.year + "-" + String(r.month).padStart(2, "0") + "  " + r.state);
  }
  const { data: fps } = await sb.from("pmr_rules_fingerprint").select("year,month,source_group,computed_at").order("year").order("month");
  console.log("\n  pmr_rules_fingerprint (quando cada baseline foi gravado):");
  for (const r of fps || []) console.log("    " + r.year + "-" + String(r.month).padStart(2, "0") + "  " + String(r.computed_at).slice(0, 19));

  console.log("\n=== fim (nada foi gravado) ===");
}

main().catch((e) => { console.error("ERRO:", e.message); process.exitCode = 1; });
