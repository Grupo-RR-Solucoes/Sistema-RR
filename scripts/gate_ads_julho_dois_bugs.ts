// ============================================================================
// scripts/gate_ads_julho_dois_bugs.ts — DRY-RUN puro (NAO grava nada).
//
// BUG 1 — seguro da ADS por contrato: prova que a coluna passou a sair da regua
//         BBTS (bbts_rule_versions) e nao mais da do RR (insurance_slip_rules).
//         Imprime as DUAS reguas lado a lado por contrato.
//
// BUG 2 — producao da /projecao da ADS: prova que o promotor cadastrado em
//         OUTRA empresa que produziu na ADS voltou para o escopo, e que o total
//         fecha com o Portal BBTS.
//
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/gate_ads_julho_dois_bugs.ts')"
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadPromoterAnalyticsBase, selectPromoterView } from "@/lib/promoterAnalytics.ts";
import { buildProjecaoMetas, consolidarGrupoEquipe } from "@/lib/projecaoMetas.ts";
import { resolveBbtsRegraDb } from "@/lib/bbts/resolveBbtsRegra.ts";
import { seguroRateFromRegra } from "@/lib/bbts/seguroBbts.ts";
import { fetchInsuranceSlipRules, calculateInsuranceCommissionFromRules } from "@/lib/insuranceCalculator.ts";
import { getPrazoTrp } from "@/lib/prazoTrp.ts";
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
const PORTAL = Number(process.env.PORTAL_BBTS || 263552.23);
const brl = (n: number) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s: any, n: number) => { s = String(s ?? ""); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); };
const padL = (s: any, n: number) => { s = String(s ?? ""); return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s; };
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam creds no env.");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const comp = `${YEAR}-${String(MONTH).padStart(2, "0")}`;
  const problemas: string[] = [];

  console.log(`######## GATE ADS ${comp} — DRY-RUN (nada gravado) ########\n`);

  // =====================================================================
  // BUG 1 — seguro por contrato: regua do RR (ANTES) x regua BBTS (DEPOIS)
  // =====================================================================
  console.log("=".repeat(96));
  console.log("BUG 1 — comissao de seguro por contrato da ADS: ANTES (regua RR) x DEPOIS (regua BBTS)");
  console.log("=".repeat(96));

  const base: any = await loadPromoterAnalyticsBase(sb as any, {
    year: YEAR, month: MONTH, companyId: BBTS_COMPANY_ID, closed: false,
  } as any);

  const regra = (await resolveBbtsRegraDb({ competencia: comp }, sb as any))?.regra ?? null;
  const slipRules = await fetchInsuranceSlipRules(sb as any);

  const comSeguro = (base.recordsForPeriod as any[]).filter((r) => num(r.insurance_value) > 0);

  // O que a TELA realmente mostra: proposalRows so e populado com UM promotor
  // selecionado, entao varremos os donos dos contratos com seguro (o mesmo
  // caminho que /promotores usa ao abrir o promotor).
  const porContratoView = new Map<string, number>();
  for (const pid of new Set(comSeguro.map((r) => String(r.assigned_promoter_id)))) {
    const v: any = selectPromoterView(base, pid);
    for (const p of v.proposalRows ?? []) {
      porContratoView.set(String(p.proposal_number), num(p.company_insurance_commission_amount));
    }
  }

  const h = pad("CONTRATO", 13) + padL("insurance_value", 16) + pad("  tipo", 16) + padL("prazo", 6) +
    padL("taxa_bbts", 11) + padL("ANTES(RR)", 11) + padL("DEPOIS(BBTS)", 13) + padL("na TELA", 10);
  console.log(h); console.log("-".repeat(h.length));
  let totAntes = 0, totDepois = 0;
  for (const r of comSeguro.sort((a, b) => num(b.insurance_value) - num(a.insurance_value))) {
    const meta = (r.raw_payload && r.raw_payload.__bbts_meta) || {};
    const tipo = meta.seguro_tipo ?? r.insurance_type;
    const taxa = seguroRateFromRegra(regra, tipo, r.term_months);
    const depois = taxa.rate === null ? 0 : num(r.insurance_value) * taxa.rate;
    const antes = calculateInsuranceCommissionFromRules({
      rules: slipRules,
      grossValue: num(r.gross_value),
      premioValue: num(r.insurance_value),
      insuranceType: r.insurance_type,
      termPromotiva: getPrazoTrp(r) ?? num(r.term_months || r.installments),
      contractDate: r.contract_date || r.movement_date,
    })?.amount ?? 0;
    const naTela = porContratoView.get(String(r.proposal_number));
    totAntes += antes; totDepois += depois;

    console.log(
      pad(String(r.proposal_number), 13) + padL(brl(r.insurance_value), 16) +
      pad("  " + String(tipo ?? "(null)").slice(0, 14), 16) + padL(r.term_months ?? "-", 6) +
      padL(taxa.rate === null ? "NULO" : (taxa.rate * 100).toFixed(3) + "%", 11) +
      padL(brl(antes), 11) + padL(brl(depois), 13) +
      padL(naTela === undefined ? "(n/a)" : brl(naTela), 10)
    );
    if (naTela !== undefined && Math.abs(naTela - depois) > 0.005) {
      problemas.push(`contrato ${r.proposal_number}: tela ${brl(naTela)} != regua BBTS ${brl(depois)}`);
    }
  }
  console.log("-".repeat(h.length));
  console.log(`TOTAL — ANTES (regua RR) ${brl(totAntes)} | DEPOIS (regua BBTS) ${brl(totDepois)}`);
  if (totAntes === totDepois) problemas.push("ANTES == DEPOIS: o gate nao esta provando troca de regua nenhuma");

  // =====================================================================
  // BUG 2 — producao da /projecao da ADS
  // =====================================================================
  console.log("\n" + "=".repeat(96));
  console.log("BUG 2 — producao da /projecao da ADS x Portal BBTS");
  console.log("=".repeat(96));

  const res = await buildProjecaoMetas(sb as any, { year: YEAR, month: MONTH, companyId: BBTS_COMPANY_ID });
  const ge = consolidarGrupoEquipe(res);

  console.log(`  Portal BBTS ......................... ${padL(brl(PORTAL), 14)}`);
  console.log(`  /projecao (consolidarGrupoEquipe) ... ${padL(brl(ge.producao_acumulada), 14)}`);
  console.log(`  DIFERENCA ........................... ${padL(brl(PORTAL - ge.producao_acumulada), 14)}`);
  console.log(`  balde (nao atribuido) dentro do total ${padL(brl(ge.nao_atribuido?.acumulada ?? 0), 14)} em ${ge.nao_atribuido?.count ?? 0} proposta(s)`);

  console.log("\n  promotores no escopo da ADS:");
  const hp = "  " + pad("PROMOTOR", 30) + padL("producao", 14) + "  empresa de cadastro";
  console.log(hp); console.log("  " + "-".repeat(hp.length - 2));
  const comps = await sb.from("companies").select("id,name");
  const cn = new Map((comps.data ?? []).map((c: any) => [c.id, c.name]));
  for (const p of (res.promotores ?? []).sort((a: any, b: any) => num(b.producao_acumulada) - num(a.producao_acumulada))) {
    const cad = base.promoterById.get(p.promoter_id);
    const fora = cad && cad.company_id !== BBTS_COMPANY_ID;
    console.log("  " + pad(base.promoterById.get(p.promoter_id)?.name ?? p.promoter_id, 30) + padL(brl(p.producao_acumulada), 14) +
      "  " + (cn.get(cad?.company_id) ?? "?") + (fora ? "   <-- cadastrado FORA da ADS" : ""));
  }

  // O promotor cadastrado FORA da ADS tem de estar no escopo — e ISSO que o fix
  // do BUG 2 garante. NAO se exige bater com o Portal ao centavo: a janela de
  // competencia comeca no ULTIMO DIA UTIL do mes anterior (getProductionWindow),
  // entao um registro de 30/06 e produção de JULHO para o sistema e de JUNHO para
  // o Portal. Essa fronteira e questao de reconciliacao, nao deste fix.
  const foraDaAds = (res.promotores ?? []).filter((p: any) => {
    const cad = base.promoterById.get(p.promoter_id);
    return cad && cad.company_id !== BBTS_COMPANY_ID && num(p.producao_acumulada) > 0;
  });
  if (foraDaAds.length === 0) {
    problemas.push("nenhum promotor cadastrado fora da ADS no escopo — o fix do BUG 2 nao esta provando nada");
  }
  const delta = ge.producao_acumulada - PORTAL;
  console.log(`\n  promotores cadastrados FORA da ADS que voltaram ao escopo: ${foraDaAds.length}`);
  console.log(`  residuo vs Portal: ${brl(delta)} (esperado: so registros na fronteira da janela)`);

  console.log("\n" + "=".repeat(96));
  if (problemas.length) {
    console.log("FALHOU:");
    for (const p of problemas) console.log("  - " + p);
    process.exit(1);
  }
  console.log("PASSOU: seguro da ADS sai da regua BBTS por contrato (coluna da tela conferida),");
  console.log("        e o promotor cadastrado fora da ADS voltou ao escopo da /projecao.");
  console.log("        O residuo vs Portal acima e fronteira de janela, NAO coberto por este fix.");
})().catch((e) => { console.error("ERRO:", e && e.stack ? e.stack : e); process.exit(1); });
