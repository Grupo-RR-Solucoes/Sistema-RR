// ============================================================================
// scripts/auditSeguroClosing.ts — DRY-RUN da correção do seguro (penetração
// INDIVIDUAL + cortes oficiais 0,11/0,21/0,30). NÃO grava. Compara, por promotor,
// o repasse CORRETO (novo) vs o GRAVADO hoje no PMR (35% do grupo).
//
// Rodar:
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/auditSeguroClosing.ts')"
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { consolidateMonthlyFromClosing } from "@/lib/closingMonthly.ts";

(function preferEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
})();

const YEAR = 2026, MONTH = 6;
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctS = (n: number) => (n * 100).toFixed(2);
const pad = (s: any, n: number) => { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); };
const padL = (s: any, n: number) => { s = String(s); return s.length >= n ? s : " ".repeat(n - s.length) + s; };
const faixaLabel = (p: number) => (p >= 0.30 ? "≥30" : p >= 0.21 ? "21-30" : p >= 0.11 ? "11-21" : "<11");

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam creds no env.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // 1. Recalcula em DRY-RUN (não grava).
  const res: any = await consolidateMonthlyFromClosing(supabase as any, { year: YEAR, month: MONTH, dryRun: true });

  // 2. Lê o gravado (PMR atual, source=fechamento) p/ comparar.
  const { data: pmr } = await supabase
    .from("promoter_monthly_results")
    .select("promoter_id, insurance_commission_value, insurance_penetration_percent")
    .eq("year", YEAR).eq("month", MONTH).eq("source", "fechamento");
  const gravadoByPid = new Map<string, { seg: number; pen: number }>();
  for (const r of pmr || []) gravadoByPid.set(r.promoter_id, { seg: Number(r.insurance_commission_value), pen: Number(r.insurance_penetration_percent) });

  console.log(`############ AUDITORIA SEGURO — fechamento ${YEAR}/${String(MONTH).padStart(2, "0")} — DRY-RUN (não grava) ############\n`);
  const h = pad("PROMOTOR", 30) + padL("penet%", 8) + padL("faixa", 7) + padL("share%", 8) +
    padL("com_empr", 11) + padL("correto", 11) + padL("gravado", 11) + padL("delta", 10);
  console.log(h); console.log("-".repeat(h.length));

  const rows = res.table.slice().sort((a: any, b: any) => (b.insurance_commission_value) - (a.insurance_commission_value));
  let tCorr = 0, tGrav = 0, tEmp = 0;
  for (const r of rows) {
    const g = gravadoByPid.get(r.promoter_id);
    const gravado = g ? g.seg : 0;
    const correto = r.insurance_commission_value;
    const delta = correto - gravado;
    tCorr += correto; tGrav += gravado; tEmp += r.seguro_empresa;
    if (r.seguro_empresa <= 0 && gravado <= 0) continue; // sem seguro dos dois lados
    const flag = Math.abs(delta) > 0.005 ? (delta > 0 ? "  ▲" : "  ▼") : "";
    console.log(
      pad((r.promoter_name || "?").slice(0, 29), 30) + padL(pctS(r.penetracao_individual), 8) +
      padL(faixaLabel(r.penetracao_individual), 7) + padL(pctS(r.seguro_share), 8) +
      padL(brl(r.seguro_empresa), 11) + padL(brl(correto), 11) + padL(brl(gravado), 11) +
      padL((delta >= 0 ? "+" : "") + brl(delta), 10) + flag
    );
  }
  console.log("-".repeat(h.length));
  console.log(pad("TOTAL", 30) + padL("", 8) + padL("", 7) + padL("", 8) + padL(brl(tEmp), 11) + padL(brl(tCorr), 11) + padL(brl(tGrav), 11) + padL((tCorr - tGrav >= 0 ? "+" : "") + brl(tCorr - tGrav), 10));
  console.log(`\nSeguro: CORRETO ${brl(tCorr)} vs GRAVADO ${brl(tGrav)} → delta ${brl(tCorr - tGrav)}`);
  console.log(`(embutido CASH + avulso INSURANCE/A Vista; seguro avulso diag: ${JSON.stringify(res.seguro_avulso)})`);
  console.log(`\nDRY-RUN: nada gravado. dry_run=${res.dry_run}`);
})().catch((e) => { console.error("ERRO:", e && e.message ? e.message : e); process.exit(1); });
