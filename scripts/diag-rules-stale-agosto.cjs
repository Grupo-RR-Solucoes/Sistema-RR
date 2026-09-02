#!/usr/bin/env node
/**
 * scripts/diag-rules-stale-agosto.cjs — POR QUE 2026-08 acendeu `rules_stale`
 * (ERRO) logo depois do import. READ-ONLY.
 *
 * detect_rules_stale() e `stable` (so le) e compara, por competencia fechada, o
 * fingerprint GRAVADO no consolidador com o RECOMPUTADO agora. Aqui:
 *   - a saida crua da RPC (estado por competencia, com os dois hashes);
 *   - quando o baseline de cada competencia foi gravado (pmr_rules_fingerprint);
 *   - a ORDEM dos eventos do dia, que e a hipotese a testar: o fingerprint le SO
 *     os promotores que aparecem no PMR da competencia; se a consolidacao da ADS
 *     (source='bbts') entrou DEPOIS do baseline do fechamento da RR, o conjunto
 *     de promotores mudou e o hash muda sem que regua nenhuma tenha mudado.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

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

  console.log("\n### 1. detect_rules_stale() — saida crua (RPC `stable`, so leitura) ###");
  const { data: det, error: e1 } = await sb.rpc("detect_rules_stale");
  if (e1) console.log("  ERRO: " + e1.code + " " + e1.message);
  else {
    console.log("  comp      grupo     estado        stored_fp         current_fp");
    for (const r of det || []) {
      console.log("  " + r.year + "-" + String(r.month).padStart(2, "0") + "   " + String(r.source_group).padEnd(9) +
        " " + String(r.state).padEnd(13) + " " + String(r.stored_fp || "(nulo)").slice(0, 16).padEnd(17) + " " + String(r.current_fp || "-").slice(0, 16));
    }
  }

  console.log("\n### 2. pmr_rules_fingerprint — quando cada baseline foi gravado ###");
  const { data: fps, error: e2 } = await sb.from("pmr_rules_fingerprint").select("*");
  if (e2) console.log("  ERRO: " + e2.message);
  else {
    if (fps && fps[0]) console.log("  colunas: " + Object.keys(fps[0]).join(", "));
    for (const r of (fps || []).sort((a, b) => (a.year - b.year) || (a.month - b.month))) {
      const t = r.calculado_em || r.created_at || r.updated_at || r.atualizado_em || "";
      console.log("  " + r.year + "-" + String(r.month).padStart(2, "0") + "  " + String(r.source_group).padEnd(9) +
        "  fp=" + String(r.fingerprint).slice(0, 16) + "  " + String(t).slice(0, 19));
    }
  }

  console.log("\n### 3. ordem dos eventos de 2026-09-02 (a hipotese) ###");
  const { data: imps } = await sb.from("monthly_closing_imports").select("created_at,finished_at,company_id,year,month,status").gte("created_at", "2026-09-02");
  const { data: comps } = await sb.from("companies").select("id,name");
  const nome = (id) => ((comps || []).find((c) => c.id === id) || {}).name || String(id).slice(0, 8);
  const linha = [];
  for (const i of imps || []) {
    linha.push([String(i.created_at), "import fechamento INICIOU  " + nome(i.company_id) + "  (" + i.year + "-" + String(i.month).padStart(2, "0") + ")"]);
    if (i.finished_at) linha.push([String(i.finished_at), "import fechamento TERMINOU " + nome(i.company_id)]);
  }
  const { data: pmr } = await sb.from("promoter_monthly_results").select("company_id,source,created_at,updated_at").eq("year", 2026).eq("month", 8);
  const grupos = new Map();
  for (const r of pmr || []) {
    const k = nome(r.company_id) + " | source=" + r.source;
    const t = String(r.updated_at || r.created_at);
    const a = grupos.get(k) || { min: t, max: t, n: 0 };
    a.n++;
    if (t < a.min) a.min = t;
    if (t > a.max) a.max = t;
    grupos.set(k, a);
  }
  for (const kv of grupos) linha.push([kv[1].min, "PMR gravado (" + kv[1].n + " linhas)  " + kv[0]]);
  const { data: fp8 } = await sb.from("pmr_rules_fingerprint").select("*").eq("year", 2026).eq("month", 8);
  for (const r of fp8 || []) {
    const t = r.calculado_em || r.created_at || r.updated_at || r.atualizado_em;
    if (t) linha.push([String(t), "BASELINE fingerprint gravado (" + r.source_group + ")"]);
  }
  const { data: mon } = await sb.from("prt_inadimplencia_monitor").select("atualizado_em").eq("competencia", "2026-08").order("atualizado_em", { ascending: true });
  const distintos = [...new Set((mon || []).map((r) => String(r.atualizado_em)))];
  for (const t of distintos) linha.push([t, "monitor inadimplencia gravou (efeito colateral 3)"]);
  for (const l of linha.sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log("  " + l[0].slice(0, 23) + "  " + l[1]);
  }

  console.log("\n### 4. o conjunto de promotores do PMR de 2026-08 por source ###");
  const porSource = new Map();
  for (const r of pmr || []) porSource.set(r.source, (porSource.get(r.source) || 0) + 1);
  console.log("  " + [...porSource].map((kv) => kv[0] + "=" + kv[1]).join("  "));
  console.log("  (o fingerprint le SO as reguas dos promotores presentes no PMR — incluir a ADS");
  console.log("   depois do baseline muda o hash sem que regua nenhuma tenha mudado)");

  console.log("\n=== fim (nada foi gravado) ===");
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
