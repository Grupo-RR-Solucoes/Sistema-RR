// ============================================================================
// scripts/rodarBbtsOrchestrator.ts — BBTS-2d. DRY-RUN por padrão (grava com
// BBTS_WRITE=1). Consolida por promotor (RR+ADS) e mostra as escalas resultantes.
//
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/rodarBbtsOrchestrator.ts')"
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { consolidateMonthlyGroup } from "@/lib/bbtsOrchestrator.ts";

(function preferEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
})();

const YEAR = Number(process.env.BBTS_YEAR || 2026);
const MONTH = Number(process.env.BBTS_MONTH || 6);
const DRY_RUN = process.env.BBTS_WRITE !== "1";
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => (n * 100).toFixed(2);
const pad = (s: any, n: number) => { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); };
const padL = (s: any, n: number) => { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; };
const faixa = (p: number) => (p >= 0.30 ? "≥30" : p >= 0.21 ? "21-30" : p >= 0.11 ? "11-21" : "<11");

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam creds no env.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`############ BBTS-2d ORQUESTRADOR — ${YEAR}/${String(MONTH).padStart(2, "0")} — ${DRY_RUN ? "DRY-RUN (não grava)" : "GRAVANDO"} ############\n`);
  const res: any = await consolidateMonthlyGroup(supabase as any, { year: YEAR, month: MONTH, dryRun: DRY_RUN });

  const h =
    pad("PROMOTOR", 26) + padL("prodRR", 12) + padL("prodADS", 11) + padL("prodTot", 12) +
    padL("statusMeta", 11) + padL("pen%", 7) + padL("fx", 6) + padL("shr%", 6) +
    padL("volCons", 12) + padL("acrd%", 7) + padL("credRR", 11) + padL("credADS", 10) + padL("segRR", 9) + padL("segADS", 8);
  console.log(h); console.log("-".repeat(h.length));
  for (const r of res.rows) {
    console.log(
      pad((r.promoter_name || "?").slice(0, 25), 26) + padL(brl(r.prod_rr), 12) + padL(brl(r.prod_ads), 11) +
      padL(brl(r.prod_total), 12) + padL(r.status_meta, 11) + padL(pct(r.penetracao_consolidada), 7) +
      padL(faixa(r.penetracao_consolidada), 6) + padL(pct(r.seguro_share), 6) + padL(brl(r.volume_consolidado), 12) +
      padL(pct(r.acordo), 7) + padL(brl(r.credito_rr), 11) + padL(brl(r.credito_ads), 10) +
      padL(brl(r.seguro_rr), 9) + padL(brl(r.seguro_ads), 8)
    );
  }
  console.log("-".repeat(h.length));
  const t = res.totals;
  console.log(`TOTAL — crédito RR ${brl(t.credito_rr)} | crédito ADS ${brl(t.credito_ads)} | seguro RR ${brl(t.seguro_rr)} | seguro ADS ${brl(t.seguro_ads)}`);
  console.log(`\n${res.dry_run ? "DRY-RUN: nada gravado." : `GRAVADO: RR ${res.rr_gravadas} linhas + ADS ${res.ads_gravadas} linhas.`}`);
})().catch((e) => { console.error("ERRO:", e && e.message ? e.message : e); process.exit(1); });
