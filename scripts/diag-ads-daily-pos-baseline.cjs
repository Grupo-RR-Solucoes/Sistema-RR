#!/usr/bin/env node
/**
 * scripts/diag-ads-daily-pos-baseline.cjs — o insumo da ADS mudou DEPOIS do
 * baseline do fingerprint de 2026-08? READ-ONLY.
 *
 * O fingerprint da Camada 2 inclui um agregado de daily_production_records da
 * empresa BBTS/ADS, recortado por date_trunc('month', coalesce(movement_date,
 * contract_date, proposal_date)) — e esse agregado carrega max(created_at)
 * (migration 20260715_000001, linhas 227-235). Logo QUALQUER linha nova caindo
 * no balde de agosto, mesmo sem regua nenhuma mudar, move o hash.
 *
 * O baseline de 2026-08 foi gravado em 2026-09-02T14:25:34.163 (computed_at de
 * pmr_rules_fingerprint). Se o balde de agosto tem created_at posterior a isso,
 * o STALE esta explicado — e e um STALE LEGITIMO: o PMR da ADS de agosto foi
 * calculado sobre um dado que ja nao e o de hoje.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

const BBTS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const BASELINE_2026_08 = "2026-09-02T14:25:34.163";

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

  let all = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from("daily_production_records")
      .select("id,created_at,movement_date,contract_date,proposal_date,gross_value,net_value,insurance_value")
      .eq("company_id", BBTS).range(from, from + 999);
    if (error) { console.log("ERRO: " + error.message); return; }
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  const bucket = (r) => String(r.movement_date || r.contract_date || r.proposal_date || "").slice(0, 7);
  const g = new Map();
  for (const r of all) {
    const b = bucket(r);
    const a = g.get(b) || { n: 0, max: "", gross: 0 };
    a.n++;
    a.gross += Number(r.gross_value) || 0;
    if (String(r.created_at) > a.max) a.max = String(r.created_at);
    g.set(b, a);
  }
  console.log("\nADS/BBTS daily_production_records por balde de competencia (total " + all.length + " linhas):");
  for (const kv of [...g].sort()) {
    console.log("  " + kv[0] + "  n=" + String(kv[1].n).padStart(5) + "  max(created_at)=" + kv[1].max.slice(0, 23) + "  soma gross=" + kv[1].gross.toFixed(2));
  }
  console.log("\n  baseline do fingerprint de 2026-08 gravado em: " + BASELINE_2026_08);
  const ag = g.get("2026-08");
  if (!ag) { console.log("  balde 2026-08 VAZIO — nao explica o STALE."); }
  else {
    console.log("  max(created_at) do balde 2026-08            : " + ag.max);
    console.log("  >>> " + (ag.max > BASELINE_2026_08 ? "POSTERIOR ao baseline — EXPLICA o STALE" : "anterior ao baseline — NAO explica o STALE"));
  }

  console.log("\n  linhas da ADS criadas DEPOIS do baseline (qualquer balde):");
  const depois = all.filter((r) => String(r.created_at) > BASELINE_2026_08);
  const gd = new Map();
  for (const r of depois) gd.set(bucket(r), (gd.get(bucket(r)) || 0) + 1);
  if (!depois.length) console.log("    nenhuma");
  for (const kv of [...gd].sort()) console.log("    balde " + kv[0] + ": " + kv[1] + " linhas");

  console.log("\n=== fim (nada foi gravado) ===");
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
