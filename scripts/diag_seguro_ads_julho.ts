// ============================================================================
// scripts/diag_seguro_ads_julho.ts — DRY-RUN puro (NAO grava nada).
//
// Diagnostico do braco de seguro da ADS: imprime, por CONTRATO, a base do
// seguro, a taxa que a regua BBTS resolveu (ou o motivo de NAO ter resolvido),
// a comissao-empresa e a comissao-promotor; e por PROMOTOR o agregado.
//
// No topo imprime os TRES numeros que a arquitetura separa de proposito:
//   (a) penetracao EXIBIDA por empresa  = insuredProd_ADS / prod_ADS
//   (b) penetracao CONSOLIDADA usada no calculo = (liqSeg_RR + liqSeg_ADS) /
//       (net_RR + prod_ADS)  -- a que o BBTS-2d injeta
//   (c) faixa de repasse resultante de (b) na escala SEGURO_SLIP
//
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/diag_seguro_ads_julho.ts')"
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { consolidateMonthlyGroup } from "@/lib/bbtsOrchestrator.ts";
import { resolveBbtsRegraDb } from "@/lib/bbts/resolveBbtsRegra.ts";
import { seguroRateFromRegra } from "@/lib/bbts/seguroBbts.ts";
import { getProductionPeriodFromValue, getProductionPeriodKey } from "@/lib/productionPeriod.ts";

// Espelham os helpers locais do lib/bbtsMonthly.ts (nao sao exportados de la).
const BBTS_COMPANY_ID = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
async function fetchAllPaged<T = any>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < size) break;
  }
  return out;
}

(function preferEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
})();

const YEAR = Number(process.env.BBTS_YEAR || 2026);
const MONTH = Number(process.env.BBTS_MONTH || 7);
const brl = (n: number) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s: any, n: number) => { s = String(s ?? ""); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); };
const padL = (s: any, n: number) => { s = String(s ?? ""); return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s; };
const toNumber = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam creds no env.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const compKey = getProductionPeriodKey(YEAR, MONTH);

  console.log(`######## DIAG SEGURO ADS — ${compKey} — DRY-RUN (nada gravado) ########\n`);

  // ---- Regua BBTS da competencia ----
  const bbtsRegra = await resolveBbtsRegraDb({ competencia: compKey }, supabase as any);
  console.log("== REGUA BBTS (bbts_rule_versions) ==");
  if (!bbtsRegra) {
    console.log("  !! NENHUMA regua encontrada para", compKey, "(nem em fallback)");
  } else {
    console.log(`  competencia pedida: ${compKey} | fornecedora: ${bbtsRegra.competenciaFornecedora} | fallback: ${bbtsRegra.isFallback} (${bbtsRegra.direcao ?? "-"})`);
    console.log("  secao seguro:", JSON.stringify(bbtsRegra.regra?.seguro ?? null));
  }
  console.log("");

  // ---- Orquestrador BBTS-2d (dry-run) -> penetracao consolidada + faixa ----
  const grupo: any = await consolidateMonthlyGroup(supabase as any, { year: YEAR, month: MONTH, dryRun: true });
  const consByPid = new Map<string, any>(grupo.rows.map((r: any) => [r.promoter_id, r]));

  // ---- Linhas ADS da competencia (mesma query do consolidador) ----
  const rows = await fetchAllPaged<any>(() =>
    supabase
      .from("daily_production_records")
      .select("proposal_number, assigned_promoter_id, gross_value, insurance_value, insurance_type, term_months, installments, product_code, movement_date, contract_date, proposal_date, status, is_srcc_restricted, raw_payload")
      .eq("company_id", BBTS_COMPANY_ID)
  );
  const emComp = rows.filter((r) => {
    const p = getProductionPeriodFromValue(r.movement_date) || getProductionPeriodFromValue(r.contract_date) || getProductionPeriodFromValue(r.proposal_date);
    return p && getProductionPeriodKey(p.year, p.month) === compKey;
  });

  const regraSeguro = bbtsRegra?.regra ?? null;
  const porPromotor = new Map<string, { prod: number; insuredProd: number; base: number; comEmp: number; n: number }>();
  const linhas: any[] = [];

  for (const r of emComp) {
    const pid = r.assigned_promoter_id as string | null;
    if (!pid) continue;
    const meta = (r.raw_payload && r.raw_payload.__bbts_meta) || {};
    if (meta.cancelado === true || String(r.status ?? "").toUpperCase() === "CANCELADO") continue;
    if (r.is_srcc_restricted === true) continue;

    const gross = toNumber(r.gross_value);
    const base = toNumber(r.insurance_value);
    const tipo = meta.seguro_tipo ?? r.insurance_type;
    const taxa = base > 0 ? seguroRateFromRegra(regraSeguro, tipo, r.term_months) : null;
    const comEmp = taxa && taxa.rate !== null ? base * taxa.rate : 0;

    const a = porPromotor.get(pid) || { prod: 0, insuredProd: 0, base: 0, comEmp: 0, n: 0 };
    a.prod += gross; a.base += base; a.comEmp += comEmp; a.n += 1;
    if (base > 0) a.insuredProd += gross;
    porPromotor.set(pid, a);

    if (base > 0) {
      linhas.push({
        pid,
        contrato: String(r.proposal_number),
        gross,
        base,
        tipo: String(tipo ?? "(null)"),
        prazo: r.term_months ?? null,
        parcelas: r.installments ?? null,
        rate: taxa?.rate ?? null,
        modality: taxa?.modality ?? "-",
        motivo: (taxa as any)?.motivo ?? "",
        comEmp,
      });
    }
  }

  // ---- Os tres numeros, por promotor ----
  console.log("== (a) penetracao EXIBIDA (ADS isolada) | (b) penetracao CONSOLIDADA RR+ADS | (c) faixa de repasse ==");
  const hp = pad("PROMOTOR", 28) + padL("prodADS", 13) + padL("segurADS", 13) + padL("(a)pen%", 9) + padL("(b)pen%", 9) + padL("(c)fx%", 8);
  console.log(hp); console.log("-".repeat(hp.length));
  for (const [pid, a] of porPromotor) {
    const c = consByPid.get(pid);
    const penA = a.prod > 0 ? a.insuredProd / a.prod : 0;
    console.log(
      pad(c?.promoter_name ?? pid, 28) + padL(brl(a.prod), 13) + padL(brl(a.insuredProd), 13) +
      padL((penA * 100).toFixed(2), 9) + padL(((c?.penetracao_consolidada ?? 0) * 100).toFixed(2), 9) +
      padL(((c?.seguro_share ?? 0) * 100).toFixed(2), 8)
    );
  }
  console.log("");

  // ---- Detalhe por contrato ----
  console.log("== POR CONTRATO (so linhas com insurance_value > 0) ==");
  const hc = pad("CONTRATO", 13) + pad("PROMOTOR", 20) + padL("seguro_base", 13) + pad("  tipo", 16) +
    padL("prazo", 6) + padL("taxa%", 8) + padL("comEmp", 10) + padL("(c)fx%", 8) + padL("comPromotor", 12) + "  motivo_se_nulo";
  console.log(hc); console.log("-".repeat(hc.length));
  let totBase = 0, totEmp = 0, totProm = 0, nNulos = 0;
  for (const l of linhas.sort((x, y) => y.base - x.base)) {
    const c = consByPid.get(l.pid);
    const fx = c?.seguro_share ?? 0;
    const comProm = l.comEmp * fx;
    totBase += l.base; totEmp += l.comEmp; totProm += comProm;
    if (l.rate === null) nNulos += 1;
    console.log(
      pad(l.contrato, 13) + pad((c?.promoter_name ?? "?").slice(0, 19), 20) + padL(brl(l.base), 13) +
      pad("  " + l.tipo.slice(0, 14), 16) + padL(l.prazo ?? "-", 6) +
      padL(l.rate === null ? "NULO" : (l.rate * 100).toFixed(3), 8) + padL(brl(l.comEmp), 10) +
      padL((fx * 100).toFixed(2), 8) + padL(brl(comProm), 12) + "  " + l.motivo
    );
  }
  console.log("-".repeat(hc.length));
  console.log(`TOTAIS — base ${brl(totBase)} | comissao empresa ${brl(totEmp)} | comissao PROMOTOR ${brl(totProm)}`);
  console.log(`linhas com seguro: ${linhas.length} | taxa NAO resolvida (NULO): ${nNulos}`);
})().catch((e) => { console.error("ERRO:", e && e.stack ? e.stack : e); process.exit(1); });
