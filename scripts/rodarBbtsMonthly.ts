// ============================================================================
// scripts/rodarBbtsMonthly.ts — BBTS-2c: consolidador ADS. DRY-RUN por padrão
// (grava só com BBTS_WRITE=1). Imprime por promotor o cálculo de crédito (%TRP)
// + seguro (régua BBTS) + comissão do promotor, p/ conferência antes de gravar.
//
// Rodar:
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/rodarBbtsMonthly.ts')"
//   (competência via BBTS_YEAR/BBTS_MONTH; grava: BBTS_WRITE=1)
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { consolidateMonthlyFromBbts } from "@/lib/bbtsMonthly.ts";

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

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no env.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`############ consolidateMonthlyFromBbts — ${YEAR}/${String(MONTH).padStart(2, "0")} — ${DRY_RUN ? "DRY-RUN (não grava)" : "GRAVANDO"} ############\n`);

  const res = await consolidateMonthlyFromBbts(supabase as any, { year: YEAR, month: MONTH, dryRun: DRY_RUN });

  console.log(`competência ${res.competencia} | linhas ${res.linhas_competencia} | promotores ${res.promotores} | ignoradas: balde ${res.ignoradas.balde}, cancelada ${res.ignoradas.cancelada}, srcc ${res.ignoradas.srcc}\n`);

  // Detalhe por PROPOSTA.
  const hp = pad("contrato", 12) + padL("vfin", 12) + padL("juros", 7) + padL("parc", 6) + padL("conv", 9) + padL("%TRP", 8) + padL("avista_teto", 13) + padL("diferido", 12) + padL("com_empresa", 13);
  console.log(hp); console.log("-".repeat(hp.length));
  let sVf = 0, sAv = 0, sDif = 0, sEmp = 0;
  for (const p of res.propostas) {
    sVf += p.vfin; sAv += p.avista; sDif += p.diferido; sEmp += p.comEmpresa;
    console.log(pad(p.contrato, 12) + padL(brl(p.vfin), 12) + padL(String(p.juros), 7) + padL(String(p.parc), 6) + padL(p.conv, 9) + padL((p.trp * 100).toFixed(4), 8) + padL(brl(p.avista), 13) + padL(brl(p.diferido), 12) + padL(brl(p.comEmpresa), 13));
  }
  console.log("-".repeat(hp.length));
  console.log(pad(`TOTAL (${res.propostas.length} prop.)`, 12) + padL(brl(sVf), 12) + padL("", 7) + padL("", 6) + padL("", 9) + padL("", 8) + padL(brl(sAv), 13) + padL(brl(sDif), 12) + padL(brl(sEmp), 13));
  console.log(`  (comissão-empresa total ${brl(sEmp)} — deve ficar ACIMA de 7.707,03)\n`);

  const h =
    pad("PROMOTOR", 30) + padL("prod_ads", 13) + padL("cred%", 7) + padL("com_empr", 12) +
    padL("acordo%", 8) + padL("com_prom", 12) + padL("seg_base", 11) + padL("seg_com", 9) + padL("penetr%", 8);
  console.log(h);
  console.log("-".repeat(h.length));
  let tProd = 0, tEmp = 0, tProm = 0, tSegB = 0, tSegC = 0, tFinal = 0;
  for (const r of res.table) {
    tProd += r.producao_ads; tEmp += r.comissao_empresa_credito; tProm += r.comissao_promotor_credito;
    tSegB += r.seguro_base; tSegC += r.seguro_comissao_promotor; tFinal += r.final;
    console.log(
      pad((r.promoter_name || "?").slice(0, 29), 30) +
      padL(brl(r.producao_ads), 13) + padL(pct(r.credito_pct_efetivo), 7) +
      padL(brl(r.comissao_empresa_credito), 12) + padL(pct(r.acordo), 8) +
      padL(brl(r.comissao_promotor_credito), 12) + padL(brl(r.seguro_base), 11) +
      padL(brl(r.seguro_comissao_promotor), 9) + padL(pct(r.penetracao_ads), 8)
    );
  }
  console.log("-".repeat(h.length));
  console.log(
    pad(`TOTAL (${res.table.length})`, 30) + padL(brl(tProd), 13) + padL("", 7) +
    padL(brl(tEmp), 12) + padL("", 8) + padL(brl(tProm), 12) + padL(brl(tSegB), 11) + padL(brl(tSegC), 9)
  );
  console.log(`\nFINAL (crédito promotor + seguro promotor): ${brl(tFinal)}`);

  console.log("\nAvisos:");
  for (const a of res.avisos) console.log("  - " + a);

  console.log(`\n${res.dry_run ? "DRY-RUN: nada gravado." : `GRAVADO: ${res.gravadas} linhas PMR (source='bbts', company ADS).`}`);
})().catch((e) => {
  console.error("ERRO:", e && e.message ? e.message : e);
  process.exit(1);
});
