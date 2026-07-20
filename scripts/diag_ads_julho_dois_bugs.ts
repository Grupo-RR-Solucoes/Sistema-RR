// ============================================================================
// scripts/diag_ads_julho_dois_bugs.ts — DRY-RUN puro (NAO grava nada).
//
// BUG 1: estado da linha PMR da ADS (que regua produziu o seguro gravado).
// BUG 2: de onde sai a producao da /projecao da ADS e o que falta para fechar
//        com o Portal BBTS.
//
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/diag_ads_julho_dois_bugs.ts')"
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildProjecaoMetas, consolidarGrupo, consolidarGrupoEquipe } from "@/lib/projecaoMetas.ts";
import { BBTS_COMPANY_ID } from "@/lib/bbtsCompanyId.ts";

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
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function paged<T = any>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    const b = (data ?? []) as T[];
    out.push(...b);
    if (b.length < 1000) break;
  }
  return out;
}

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam creds no env.");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const comp = `${YEAR}-${String(MONTH).padStart(2, "0")}`;

  console.log(`######## DIAG ADS ${comp} — DRY-RUN (nada gravado) ########\n`);

  // =====================================================================
  // BUG 1 — a linha PMR da ADS
  // =====================================================================
  console.log("=".repeat(78));
  console.log("BUG 1 — linha PMR da ADS: qual regua produziu o seguro GRAVADO?");
  console.log("=".repeat(78));

  const pmr = await paged<any>(() =>
    sb.from("promoter_monthly_results")
      .select("promoter_id, source, production_value, insured_production_value, insurance_penetration_percent, insurance_commission_value, final_commission_value, calculated_at")
      .eq("year", YEAR).eq("month", MONTH).eq("company_id", BBTS_COMPANY_ID)
  );
  const proms = await paged<any>(() => sb.from("promoters").select("id, name, is_master"));
  const nm = new Map(proms.map((p) => [p.id, p.name]));
  const isMaster = new Map(proms.map((p) => [p.id, p.is_master === true]));

  const h1 = pad("PROMOTOR", 28) + pad("source", 9) + padL("pen%", 8) + padL("segProm", 10) + "  calculated_at";
  console.log(h1); console.log("-".repeat(h1.length));
  for (const r of pmr) {
    console.log(pad(nm.get(r.promoter_id) ?? r.promoter_id, 28) + pad(r.source, 9) +
      padL(num(r.insurance_penetration_percent).toFixed(2), 8) + padL(brl(r.insurance_commission_value), 10) +
      "  " + r.calculated_at);
  }
  console.log("-".repeat(h1.length));
  const bySource = new Map<string, number>();
  for (const r of pmr) bySource.set(r.source, (bySource.get(r.source) ?? 0) + num(r.insurance_commission_value));
  for (const [s, v] of bySource) console.log(`  source='${s}': ${pmr.filter((r) => r.source === s).length} linha(s), seguro promotor ${brl(v)}`);

  // =====================================================================
  // BUG 2 — producao da /projecao da ADS
  // =====================================================================
  console.log("\n" + "=".repeat(78));
  console.log("BUG 2 — producao da /projecao da ADS vs total bruto do banco");
  console.log("=".repeat(78));

  const res = await buildProjecaoMetas(sb as any, { year: YEAR, month: MONTH, companyId: BBTS_COMPANY_ID });
  const g = consolidarGrupo(res);
  const ge = consolidarGrupoEquipe(res);

  console.log(`  consolidarGrupo       (atribuido-only) : ${padL(brl(g.producao_acumulada), 14)}`);
  console.log(`  consolidarGrupoEquipe (atrib + balde)  : ${padL(brl(ge.producao_acumulada), 14)}`);
  console.log(`     dos quais nao atribuido (balde)     : ${padL(brl(ge.nao_atribuido?.acumulada ?? 0), 14)}  em ${ge.nao_atribuido?.count ?? 0} proposta(s)`);
  console.log(`  (a /projecao renderiza consolidarGrupoEquipe)`);

  // Recorte cru do banco, para achar o que a projecao NAO conta.
  const recs = await paged<any>(() =>
    sb.from("daily_production_records")
      .select("proposal_number, assigned_promoter_id, gross_value, net_value, status, is_srcc_restricted, movement_date, contract_date, proposal_date")
      .eq("company_id", BBTS_COMPANY_ID)
  );
  const doMes = recs.filter((r) => {
    const raw = r.movement_date || r.contract_date || r.proposal_date;
    return String(raw ?? "").startsWith(comp);
  });
  const elegivel = (r: any) => {
    const st = String(r.status ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
    return (st === "PRODUCAO" || st === "PRODUCTION") && r.is_srcc_restricted !== true;
  };

  const somaG = (rs: any[]) => rs.reduce((s, r) => s + num(r.gross_value), 0);
  const somaN = (rs: any[]) => rs.reduce((s, r) => s + num(r.net_value), 0);

  const eleg = doMes.filter(elegivel);
  const naoEleg = doMes.filter((r) => !elegivel(r));
  const semProm = eleg.filter((r) => !r.assigned_promoter_id);
  const comProm = eleg.filter((r) => r.assigned_promoter_id);
  const paraMaster = comProm.filter((r) => isMaster.get(r.assigned_promoter_id) === true);

  console.log("\n  --- recorte cru de daily_production_records (empresa ADS, competencia) ---");
  console.log(`  TODAS as linhas do mes .............. ${padL(brl(somaG(doMes)), 14)} bruto | ${padL(brl(somaN(doMes)), 14)} liquido | ${doMes.length} linha(s)`);
  console.log(`  elegiveis (Producao, nao SRCC) ...... ${padL(brl(somaG(eleg)), 14)} bruto | ${padL(brl(somaN(eleg)), 14)} liquido | ${eleg.length} linha(s)`);
  console.log(`    - atribuidas a promotor ........... ${padL(brl(somaG(comProm)), 14)} bruto | ${comProm.length} linha(s)`);
  console.log(`        das quais a chave MASTER ...... ${padL(brl(somaG(paraMaster)), 14)} bruto | ${paraMaster.length} linha(s)`);
  console.log(`    - no balde (sem promotor) ......... ${padL(brl(somaG(semProm)), 14)} bruto | ${semProm.length} linha(s)`);
  console.log(`  NAO elegiveis (status/SRCC) ......... ${padL(brl(somaG(naoEleg)), 14)} bruto | ${naoEleg.length} linha(s)`);
  if (naoEleg.length) {
    const porStatus = new Map<string, { v: number; n: number }>();
    for (const r of naoEleg) {
      const k = `${r.status ?? "(null)"}${r.is_srcc_restricted === true ? " +SRCC" : ""}`;
      const a = porStatus.get(k) ?? { v: 0, n: 0 };
      a.v += num(r.gross_value); a.n += 1; porStatus.set(k, a);
    }
    for (const [k, a] of porStatus) console.log(`      status '${k}': ${brl(a.v)} em ${a.n} linha(s)`);
  }

  console.log("\n  --- conciliacao com o Portal BBTS (263.552,23) ---");
  const PORTAL = 263552.23;
  const mostrado = ge.producao_acumulada;
  console.log(`  Portal BBTS ......................... ${padL(brl(PORTAL), 14)}`);
  console.log(`  /projecao (consolidarGrupoEquipe) ... ${padL(brl(mostrado), 14)}`);
  console.log(`  DIFERENCA ........................... ${padL(brl(PORTAL - mostrado), 14)}`);
  console.log(`  candidatos a explicar a diferenca:`);
  console.log(`    bruto-liquido das elegiveis ....... ${padL(brl(somaG(eleg) - somaN(eleg)), 14)}`);
  console.log(`    linhas nao elegiveis .............. ${padL(brl(somaG(naoEleg)), 14)}`);
  console.log(`    atribuido a chave MASTER .......... ${padL(brl(somaG(paraMaster)), 14)}`);

  // --- Quem a projecao PERDE: comparacao por promotor (banco cru x res.promotores)
  console.log("\n  --- por promotor: banco cru x o que a /projecao enxerga ---");
  const cruPorProm = new Map<string, number>();
  for (const r of eleg) {
    const k = String(r.assigned_promoter_id);
    cruPorProm.set(k, (cruPorProm.get(k) ?? 0) + num(r.gross_value));
  }
  const projPorProm = new Map<string, number>(
    (res.promotores ?? []).map((p: any) => [String(p.promoter_id ?? p.id), num(p.producao_acumulada)])
  );
  const compById = new Map(proms.map((p: any) => [p.id, p]));
  const promsFull = await paged<any>(() => sb.from("promoters").select("id, name, active, is_master, company_id"));
  const full = new Map(promsFull.map((p) => [p.id, p]));
  const companies = await paged<any>(() => sb.from("companies").select("id, name"));
  const compName = new Map(companies.map((c) => [c.id, c.name]));

  const h2 = pad("PROMOTOR", 28) + padL("banco cru", 13) + padL("projecao", 13) + padL("PERDIDO", 13) + "  empresa do promotor / flags";
  console.log("  " + h2); console.log("  " + "-".repeat(h2.length));
  let perdido = 0;
  for (const [pid, v] of [...cruPorProm.entries()].sort((a, b) => b[1] - a[1])) {
    const p = full.get(pid);
    const vProj = projPorProm.get(pid) ?? 0;
    const d = v - vProj;
    perdido += d;
    const flags = [
      p ? `empresa=${compName.get(p.company_id) ?? p.company_id}` : "PROMOTOR INEXISTENTE",
      p && p.active === false ? "INATIVO" : "",
      p && p.is_master === true ? "IS_MASTER" : "",
      projPorProm.has(pid) ? "" : "FORA DA PROJECAO",
    ].filter(Boolean).join(" ");
    console.log("  " + pad(nm.get(pid) ?? pid, 28) + padL(brl(v), 13) + padL(brl(vProj), 13) +
      padL(Math.abs(d) < 0.005 ? "-" : brl(d), 13) + "  " + flags);
  }
  console.log("  " + "-".repeat(h2.length));
  console.log(`  TOTAL PERDIDO pela /projecao: ${brl(perdido)}`);
})().catch((e) => { console.error("ERRO:", e && e.stack ? e.stack : e); process.exit(1); });
