#!/usr/bin/env node
/**
 * scripts/diag-censo-fechamento-agosto.cjs — CENSO DO FECHAMENTO DE 2026-08.
 * READ-ONLY. Nao grava nada, nao reconsolida nada.
 *
 * Responde, contra dado real:
 *   1. censo do PMR do ALVO x CONTROLE (linhas por empresa e por source);
 *   2. valores por empresa: producao, comissao BRUTA, descontos, LIQUIDO
 *      (payable = final - desconto, com a regra do piso de promoterAnalytics);
 *   3. ledgerHealth INTEIRO (todos os checks), destacando o que toca o ALVO;
 *   4. os 3 efeitos colaterais best-effort do import de fechamento
 *      (app/api/import/closing/route.ts: materializar carteira PRT ->
 *       congelar previsao -> monitor de inadimplencia), que NAO derrubam o
 *       import e portanto podem ter falhado em silencio;
 *   5. o rastro dos imports de fechamento do ALVO (quando, qual empresa).
 *
 * Uso: node scripts/diag-censo-fechamento-agosto.cjs [alvo] [controle]
 *      default: 2026-08 2026-07
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

const ALVO = process.argv[2] || "2026-08";
const CONTROLE = process.argv[3] || "2026-07";
const ym = (c) => ({ year: Number(c.slice(0, 4)), month: Number(c.slice(5, 7)) });
const brl = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v) => Number(v) || 0;

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

/** Compila o ledgerHealth REAL — nada reimplementado aqui. */
function loadLedger() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".censo-out-"));
  process.on("exit", () => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_e) {} });
  fs.writeFileSync(path.join(OUT, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true,
      resolveJsonModule: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: [path.join(ROOT, "lib/diagnostico/ledgerHealth.ts")],
  }));
  try { execSync('npx tsc -p "' + path.join(OUT, "tsconfig.json") + '"', { cwd: ROOT, stdio: "pipe" }); } catch (_e) {}
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (r, ...rest) {
    if (r.startsWith("@/")) r = path.join(OUT, r.slice(2));
    return orig.call(this, r, ...rest);
  };
  const p1 = path.join(OUT, "lib/diagnostico/ledgerHealth.js");
  return fs.existsSync(p1) ? require(p1) : null;
}

/** Le uma tabela tolerando que ela nao exista (PGRST205) — diz o que houve. */
async function tenta(sb, tabela, sel, mod) {
  let q = sb.from(tabela).select(sel);
  if (mod) q = mod(q);
  const { data, error, count } = await q;
  if (error) return { ok: false, erro: ((error.code || "") + " " + error.message).trim() };
  return { ok: true, data: data || [], count };
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(2); }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: comps } = await sb.from("companies").select("id,name,cnpj");
  const empresa = (id) => (comps || []).find((c) => c.id === id) || { name: String(id).slice(0, 8), cnpj: "-" };

  // ---------------------------------------------------------------- 0. schema
  const { data: amostra } = await sb.from("promoter_monthly_results").select("*").limit(1);
  const COLS = amostra && amostra[0] ? Object.keys(amostra[0]) : [];
  const temCarimboTempo = ["created_at", "updated_at"].filter((c) => COLS.includes(c));

  const SEL = [
    "promoter_id", "company_id", "year", "month", "source",
    "production_value", "production_commission_value", "insurance_commission_value",
    "final_commission_value", "discount_value",
  ].concat(
    ["agreement_adjustment_value", "bbcap_commission_value", "conta_corrente_commission_value",
     "consorcio_commission_value", "piso_zerou", "trp_version_id", "trp_multi_versao"]
      .filter((c) => COLS.includes(c)),
    temCarimboTempo
  ).join(",");

  async function pmr(comp) {
    const { year, month } = ym(comp);
    const { data, error } = await sb.from("promoter_monthly_results").select(SEL).eq("year", year).eq("month", month);
    if (error) throw new Error("PMR " + comp + ": " + error.message);
    return data || [];
  }

  const alvo = await pmr(ALVO);
  const ctrl = await pmr(CONTROLE);

  // ------------------------------------------------------------- 1. CENSO
  console.log("\n############ 1. CENSO DO PMR — " + ALVO + " vs " + CONTROLE + " ############");
  for (const par of [[ALVO, alvo], [CONTROLE, ctrl]]) {
    const comp = par[0], linhas = par[1];
    console.log("\n--- " + comp + ": " + linhas.length + " linhas ---");
    const g = new Map();
    for (const r of linhas) {
      const k = empresa(r.company_id).name + " | " + r.source;
      g.set(k, (g.get(k) || 0) + 1);
    }
    console.log("  empresa | source                              linhas");
    console.log("  -------------------------------------------  ------");
    for (const kv of [...g].sort()) console.log("  " + kv[0].padEnd(43) + "  " + String(kv[1]).padStart(6));
    const porSource = new Map();
    for (const r of linhas) porSource.set(r.source, (porSource.get(r.source) || 0) + 1);
    console.log("  por source: " + [...porSource].sort().map((kv) => kv[0] + "=" + kv[1]).join("  "));
  }

  console.log("\n--- DELTA " + ALVO + " - " + CONTROLE + " (linhas por empresa) ---");
  const chaves = new Set();
  const cont = (linhas) => {
    const m = new Map();
    for (const r of linhas) { const k = empresa(r.company_id).name; m.set(k, (m.get(k) || 0) + 1); chaves.add(k); }
    return m;
  };
  const cA = cont(alvo), cC = cont(ctrl);
  console.log("  empresa                            " + CONTROLE + "   " + ALVO + "   delta");
  for (const k of [...chaves].sort()) {
    const a = cA.get(k) || 0, c = cC.get(k) || 0;
    console.log("  " + k.padEnd(33) + "  " + String(c).padStart(7) + "  " + String(a).padStart(7) + "  " + (a - c > 0 ? "+" : "") + (a - c));
  }
  const dTot = alvo.length - ctrl.length;
  console.log("  " + "TOTAL".padEnd(33) + "  " + String(ctrl.length).padStart(7) + "  " + String(alvo.length).padStart(7) + "  " + (dTot > 0 ? "+" : "") + dTot);

  if (temCarimboTempo.length) {
    console.log("\n--- carimbo de tempo das linhas de " + ALVO + " (" + temCarimboTempo.join("/") + ") ---");
    const g = new Map();
    for (const r of alvo) {
      const t = r.updated_at || r.created_at;
      const k = empresa(r.company_id).name + " | " + r.source;
      if (!g.has(k)) g.set(k, { min: t, max: t, n: 0 });
      const a = g.get(k);
      a.n++;
      if (t < a.min) a.min = t;
      if (t > a.max) a.max = t;
    }
    for (const kv of [...g].sort()) {
      console.log("  " + kv[0].padEnd(43) + " n=" + String(kv[1].n).padStart(3) + "  " + kv[1].min + "  ->  " + kv[1].max);
    }
  }

  // ------------------------------------------------------------- 2. VALORES
  console.log("\n############ 2. VALORES de " + ALVO + " por empresa (CNPJ) ############");
  const yA = ym(ALVO).year, mA = ym(ALVO).month;
  const desc = await tenta(sb, "promoter_discounts", "promoter_id,year,month,amount,apply_to_company,status",
    (q) => q.eq("year", yA).eq("month", mA));
  const descPorPromotor = new Map();
  if (desc.ok) {
    for (const d of desc.data) {
      if (d.apply_to_company === true) continue;
      descPorPromotor.set(d.promoter_id, (descPorPromotor.get(d.promoter_id) || 0) + n(d.amount));
    }
  } else {
    console.log("  (promoter_discounts: " + desc.erro + ")");
  }

  const porEmp = new Map();
  for (const r of alvo) {
    const e = empresa(r.company_id);
    const k = e.name + "::" + (e.cnpj || "-") + "::" + r.source;
    if (!porEmp.has(k)) porEmp.set(k, { nome: e.name, cnpj: e.cnpj, source: r.source, n: 0, prod: 0, cProd: 0, cSeg: 0, cOutros: 0, bruta: 0, descMan: 0, liq: 0 });
    const a = porEmp.get(k);
    a.n++;
    a.prod += n(r.production_value);
    a.cProd += n(r.production_commission_value);
    a.cSeg += n(r.insurance_commission_value);
    a.cOutros += n(r.agreement_adjustment_value) + n(r.bbcap_commission_value) + n(r.conta_corrente_commission_value) + n(r.consorcio_commission_value);
    a.bruta += n(r.final_commission_value);
    // mesma regra de promoterAnalytics:1509 — piso zerado NAO consome desconto
    const manual = descPorPromotor.get(r.promoter_id) || 0;
    const dv = r.piso_zerou ? 0 : (manual || n(r.discount_value));
    a.descMan += dv;
    a.liq += n(r.final_commission_value) - dv;
  }
  console.log("  empresa (source)                 CNPJ                   n        Σ producao       Σ com.prod    Σ com.seguro     Σ BRUTA(final)      Σ desconto        Σ LIQUIDO");
  console.log("  " + "-".repeat(160));
  const T = { n: 0, prod: 0, cProd: 0, cSeg: 0, bruta: 0, descMan: 0, liq: 0 };
  for (const kv of [...porEmp].sort()) {
    const a = kv[1];
    T.n += a.n; T.prod += a.prod; T.cProd += a.cProd; T.cSeg += a.cSeg; T.bruta += a.bruta; T.descMan += a.descMan; T.liq += a.liq;
    console.log("  " + (a.nome + " (" + a.source + ")").padEnd(32) + " " + String(a.cnpj || "-").padEnd(20) + " " + String(a.n).padStart(3) + " " + brl(a.prod).padStart(17) + " " + brl(a.cProd).padStart(16) + " " + brl(a.cSeg).padStart(15) + " " + brl(a.bruta).padStart(18) + " " + brl(a.descMan).padStart(15) + " " + brl(a.liq).padStart(16));
  }
  console.log("  " + "TOTAL".padEnd(32) + " " + "".padEnd(20) + " " + String(T.n).padStart(3) + " " + brl(T.prod).padStart(17) + " " + brl(T.cProd).padStart(16) + " " + brl(T.cSeg).padStart(15) + " " + brl(T.bruta).padStart(18) + " " + brl(T.descMan).padStart(15) + " " + brl(T.liq).padStart(16));
  const outros = [...porEmp.values()].reduce((s, a) => s + a.cOutros, 0);
  console.log("  (comissoes de outros produtos — bbcap/cc/consorcio/acordo — somadas: " + brl(outros) + ")");
  console.log("  (descontos de " + ALVO + " em promoter_discounts: " + (desc.ok ? desc.data.length + " linhas, " + brl(desc.data.reduce((s, d) => s + n(d.amount), 0)) : desc.erro) + ")");

  // ------------------------------------------------------- 3. LEDGER HEALTH
  console.log("\n############ 3. ledgerHealth INTEIRO ############");
  const ledger = loadLedger();
  if (!ledger || !ledger.buildLedgerHealth) {
    console.log("  (NAO consegui compilar/carregar buildLedgerHealth — isto NAO conta como verde)");
  } else {
    const h = await ledger.buildLedgerHealth(sb);
    console.log("  gerado em: " + (h.generatedAt || "-") + "   status geral: " + (h.status || "-"));
    console.log("  check                    sev       count  detalhe");
    console.log("  -----------------------  --------  -----  ------------------------------------------------");
    for (const c of h.checks || []) {
      const det = c.count > 0 && c.detalhe ? JSON.stringify(c.detalhe) : "";
      console.log("  " + String(c.id).padEnd(23) + "  " + String(c.severity).padEnd(8) + "  " + String(c.count).padStart(5) + "  " + det.slice(0, 500));
      if (c.count > 0 && c.label) console.log("      " + c.label);
    }
    const tocaAlvo = (h.checks || []).filter((c) => {
      const s = JSON.stringify(c.detalhe || "");
      return c.count > 0 && s.indexOf('"year":' + yA) >= 0 && s.indexOf('"month":' + mA) >= 0;
    });
    console.log("\n  --- checks que citam " + ALVO + ": " + (tocaAlvo.length ? tocaAlvo.map((c) => c.id + "(" + c.severity + ")").join(", ") : "nenhum") + " ---");
    const erros = (h.checks || []).filter((c) => c.severity === "erro" && c.count > 0);
    const alertas = (h.checks || []).filter((c) => c.severity === "alerta" && c.count > 0);
    console.log("  ERROS acesos  : " + (erros.length ? erros.map((c) => c.id + "=" + c.count).join(", ") : "nenhum"));
    console.log("  ALERTAS acesos: " + (alertas.length ? alertas.map((c) => c.id + "=" + c.count).join(", ") : "nenhum"));
  }

  // -------------------------------------------- 4. IMPORTS
  console.log("\n############ 4. IMPORTS de fechamento de " + ALVO + " ############");
  const imps = await tenta(sb, "monthly_closing_imports", "*", (q) => q.eq("year", yA).eq("month", mA));
  if (!imps.ok) console.log("  ERRO: " + imps.erro);
  else {
    console.log("  " + imps.data.length + " import(s) para " + ALVO);
    if (imps.data[0]) console.log("  colunas: " + Object.keys(imps.data[0]).join(", "));
    const ord = imps.data.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    for (const i of ord) {
      const e = i.company_id ? empresa(i.company_id).name : "(sem empresa)";
      console.log("   - " + String(i.created_at || i.imported_at || "?") + "  " + e.padEnd(26) +
        " status=" + (i.status || "-") +
        "  linhas=" + (i.rows_count != null ? i.rows_count : (i.row_count != null ? i.row_count : (i.total_rows != null ? i.total_rows : "?"))) +
        "  arq=" + String(i.file_name || i.filename || i.source_file || "-").slice(0, 60));
    }
    const todos = await tenta(sb, "monthly_closing_imports", "year,month,created_at,company_id");
    if (todos.ok) {
      const recentes = todos.data.filter((r) => r.created_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 10);
      console.log("  ultimos 10 imports do banco (qualquer competencia):");
      for (const r of recentes) console.log("   - " + r.created_at + "  " + r.year + "-" + String(r.month).padStart(2, "0") + "  " + (r.company_id ? empresa(r.company_id).name : "-"));
    }
  }

  console.log("\n############ 5. OS 3 EFEITOS COLATERAIS best-effort ############");
  console.log("  (app/api/import/closing/route.ts:42-163 — logam e NAO derrubam o import)\n");

  console.log("  (1) MATERIALIZACAO DA CARTEIRA PRT — fn_materializar_producao_contrato + _carteira_contrato");
  for (const t of ["producao_contrato", "carteira_contrato"]) {
    const r = await tenta(sb, t, "*", (q) => q.limit(1));
    if (!r.ok) { console.log("      " + t.padEnd(20) + " ERRO: " + r.erro); continue; }
    const cols = r.data[0] ? Object.keys(r.data[0]) : [];
    const cnt = await sb.from(t).select("*", { count: "exact", head: true });
    const tcol = ["atualizado_em", "updated_at", "created_at", "materializado_em"].find((c) => cols.indexOf(c) >= 0);
    let quando = "(sem coluna de tempo)";
    if (tcol) {
      const ult = await sb.from(t).select(tcol).order(tcol, { ascending: false }).limit(1);
      const pri = await sb.from(t).select(tcol).order(tcol, { ascending: true }).limit(1);
      quando = tcol + ": " + (pri.data && pri.data[0] ? pri.data[0][tcol] : "?") + " -> " + (ult.data && ult.data[0] ? ult.data[0][tcol] : "?");
    }
    console.log("      " + t.padEnd(20) + " linhas=" + cnt.count + "  " + quando);
    if (!tcol) console.log("         colunas: " + cols.join(", ").slice(0, 300));
  }

  console.log("\n  (2) CONGELAMENTO DA PREVISAO — previsao_snapshot");
  const prev = await tenta(sb, "previsao_snapshot", "competencia_snapshot,competencia_alvo,previsto_prt,previsto_avista,previsto_diferido,base_snapshot_prt,contratos_avista_fallback,data_congelamento");
  if (!prev.ok) console.log("      ERRO: " + prev.erro);
  else {
    const porVintage = new Map();
    for (const r of prev.data) {
      const k = r.competencia_snapshot;
      if (!porVintage.has(k)) porVintage.set(k, { n: 0, prt: 0, av: 0, quando: r.data_congelamento, alvos: [] });
      const a = porVintage.get(k);
      a.n++; a.prt += n(r.previsto_prt); a.av += n(r.previsto_avista);
      a.alvos.push(r.competencia_alvo);
      if (String(r.data_congelamento) > String(a.quando)) a.quando = r.data_congelamento;
    }
    console.log("      vintage   linhas    Σ previsto_prt   Σ previsto_avista   congelado em          alvos");
    for (const kv of [...porVintage].sort()) {
      const a = kv[1];
      console.log("      " + kv[0] + "   " + String(a.n).padStart(6) + "  " + brl(a.prt).padStart(16) + "  " + brl(a.av).padStart(17) + "   " + String(a.quando).slice(0, 19).padEnd(20) + "  " + a.alvos.sort().join(","));
    }
    const maisRecente = [...porVintage.keys()].sort().pop();
    console.log("      >>> vintage mais recente: " + (maisRecente || "(nenhum)"));
  }

  console.log("\n  (3) MONITOR DE INADIMPLENCIA PRT — prt_inadimplencia_monitor");
  let mon = await tenta(sb, "prt_inadimplencia_monitor", "competencia,operation_number,status,primeira_deteccao,status_acompanhamento,recuperavel_estimado,criado_em,atualizado_em");
  if (!mon.ok) {
    const m2 = await tenta(sb, "prt_inadimplencia_monitor", "competencia,operation_number,status,primeira_deteccao,recuperavel_estimado");
    if (m2.ok) { console.log("      (sem colunas de tempo — usando so competencia)"); mon = m2; }
    else console.log("      ERRO: " + mon.erro);
  }
  if (mon.ok) {
    const porComp = new Map();
    for (const r of mon.data) {
      const k = r.competencia;
      if (!porComp.has(k)) porComp.set(k, { n: 0, novos: 0, rec: 0, quando: r.criado_em || r.atualizado_em || "" });
      const a = porComp.get(k);
      a.n++; a.rec += n(r.recuperavel_estimado);
      if (r.primeira_deteccao === k) a.novos++;
      const t = r.criado_em || r.atualizado_em || "";
      if (t > a.quando) a.quando = t;
    }
    console.log("      competencia  itens  novos(1a det.)   Σ recuperavel      ultimo carimbo");
    for (const kv of [...porComp].sort()) {
      const a = kv[1];
      console.log("      " + String(kv[0]).padEnd(11) + "  " + String(a.n).padStart(5) + "  " + String(a.novos).padStart(14) + "  " + brl(a.rec).padStart(16) + "    " + (String(a.quando).slice(0, 19) || "-"));
    }
    console.log("      >>> " + ALVO + " presente? " + (porComp.has(ALVO) ? "SIM (" + porComp.get(ALVO).n + " itens)" : "NAO"));
  }

  console.log("\n  (4 - bonus) CARTEIRA DO CONSORCIO (bloco 4 da mesma rota)");
  for (const t of ["consorcio_carteira", "consorcio_inadimplencia_monitor"]) {
    const r = await tenta(sb, t, "*", (q) => q.limit(1));
    if (!r.ok) { console.log("      " + t.padEnd(32) + " ERRO: " + r.erro); continue; }
    const cnt = await sb.from(t).select("*", { count: "exact", head: true });
    console.log("      " + t.padEnd(32) + " linhas=" + cnt.count);
  }

  console.log("\n=== fim (nada foi gravado) ===");
}

main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
