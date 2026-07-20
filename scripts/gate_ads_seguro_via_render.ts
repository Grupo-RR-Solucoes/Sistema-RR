// ============================================================================
// scripts/gate_ads_seguro_via_render.ts — DRY-RUN puro (NAO grava nada).
//
// Le pela MESMA PORTA que a tela usa: buildPromoterAnalytics, a funcao que
// app/api/promotores/route.ts:190 chama para montar o payload da /promotores em
// mes ABERTO. Le exatamente as propriedades que o JSX pinta:
//
//   "Comissao seguro"          -> row.company_insurance_commission_amount
//                                 (PromotoresClient.tsx:2149)
//   "Comissao seguro promotor" -> row.insurance_commission_amount
//                                 (PromotoresClient.tsx:2161)
//   "% penetracao"             -> row.insurance_penetration_percent
//                                 (PromotoresClient.tsx:2152)
//
// Compara com o valor CRU persistido em daily_production_records (a regua do RR,
// que era o que a tela mostrava) e com a regua BBTS.
//
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/gate_ads_seguro_via_render.ts')"
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildPromoterAnalytics, loadPromoterAnalyticsBase } from "@/lib/promoterAnalytics.ts";
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
const ESPERADO = Number(process.env.SEGURO_ESPERADO || 34.55);
const brl = (n: number) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s: any, n: number) => { s = String(s ?? ""); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); };
const padL = (s: any, n: number) => { s = String(s ?? ""); return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s; };
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam creds no env.");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const problemas: string[] = [];

  console.log(`######## GATE SEGURO ADS PELA VIA DE RENDER — ${YEAR}-${String(MONTH).padStart(2, "0")} — DRY-RUN ########\n`);

  // Valor CRU persistido no banco = o que a tela mostrava ANTES.
  const { data: cru, error } = await sb
    .from("daily_production_records")
    .select("proposal_number, insurance_value, insurance_commission_amount, commission_rule_source")
    .eq("company_id", BBTS_COMPANY_ID);
  if (error) throw new Error(error.message);
  const antesPorContrato = new Map<string, { v: number; src: string }>(
    (cru ?? []).map((r: any) => [String(r.proposal_number), {
      v: num(r.insurance_commission_amount), src: String(r.commission_rule_source ?? ""),
    }])
  );

  // A MESMA porta da tela: mes ABERTO => closed:false, e promoterId por promotor
  // (a rota so popula proposalRows com um selecionado — app/api/promotores/
  // route.ts:159-167). Varremos os promotores do escopo, como a tela ao abrir
  // cada um, e juntamos as linhas.
  const escopo: any = await buildPromoterAnalytics(sb as any, {
    year: YEAR, month: MONTH, companyId: BBTS_COMPANY_ID, closed: false,
  } as any);
  // A faixa canonica so para CONFERIR o que o render devolveu. Os valores sob
  // teste (comissao-empresa e repasse) continuam vindo do payload de render.
  const baseCanon: any = await loadPromoterAnalyticsBase(sb as any, {
    year: YEAR, month: MONTH, companyId: BBTS_COMPANY_ID, closed: false,
  } as any);
  const share: Map<string, { penetracao: number; share: number }> =
    baseCanon.seguroShareByPromoter ?? new Map();
  const linhas: any[] = [];
  for (const s of escopo.summaryRows ?? []) {
    const p: any = await buildPromoterAnalytics(sb as any, {
      year: YEAR, month: MONTH, companyId: BBTS_COMPANY_ID, closed: false,
      promoterId: s.promoter_id,
    } as any);
    linhas.push(...(p.proposalRows ?? []).filter((r: any) => num(r.insurance_value) > 0));
  }
  if (linhas.length === 0) problemas.push("nenhuma proposalRow com seguro — a via de render nao devolveu nada");

  const h = pad("CONTRATO", 13) + pad("PROMOTOR", 22) + padL("com_EMPRESA", 12) +
    padL("pen_consol", 11) + padL("faixa", 7) + padL("REPASSE", 10) + padL("banco(RR)", 11) + "  rule_source ANTES";
  console.log(h); console.log("-".repeat(h.length));
  let totAntes = 0, totEmpresa = 0, totRepasse = 0;
  for (const r of linhas.sort((a: any, b: any) => num(b.insurance_value) - num(a.insurance_value))) {
    const antes = antesPorContrato.get(String(r.proposal_number));
    const empresa = num(r.company_insurance_commission_amount);
    const repasse = num(r.insurance_commission_amount);
    const cons = share.get(String(r.assigned_promoter_id));
    totAntes += antes?.v ?? 0;
    totEmpresa += empresa;
    totRepasse += repasse;
    console.log(
      pad(String(r.proposal_number), 13) + pad(String(r.promoter_name ?? "").slice(0, 21), 22) +
      padL(brl(empresa), 12) + padL(((cons?.penetracao ?? 0) * 100).toFixed(2) + "%", 11) +
      padL(((cons?.share ?? 0) * 100).toFixed(0) + "%", 7) + padL(brl(repasse), 10) +
      padL(brl(antes?.v ?? 0), 11) + "  " + (antes?.src ?? "-")
    );
    // O repasse tem de ser exatamente empresa x faixa.
    const esperado = empresa * (cons?.share ?? 0);
    if (Math.abs(repasse - esperado) > 0.005) {
      problemas.push(`contrato ${r.proposal_number}: repasse ${brl(repasse)} != empresa x faixa ${brl(esperado)}`);
    }
    // E tem de ser MENOR que a comissao-empresa (faixa maxima = 50%).
    if (empresa > 0 && repasse >= empresa) {
      problemas.push(`contrato ${r.proposal_number}: repasse >= comissao-empresa (faixa nao aplicada?)`);
    }
  }
  console.log("-".repeat(h.length));
  console.log(`TOTAL — comissao EMPRESA (regua BBTS) ${brl(totEmpresa)} | REPASSE ao promotor ${brl(totRepasse)}`);
  console.log(`        (antes, lixo persistido pela regua do RR: ${brl(totAntes)})`);

  if (Math.abs(totEmpresa - ESPERADO) > 0.005) {
    problemas.push(`comissao-empresa pela via de render ${brl(totEmpresa)} != esperado ${brl(ESPERADO)}`);
  }
  if (Math.abs(totRepasse - totEmpresa) < 0.005) {
    problemas.push("REPASSE == EMPRESA: a faixa nao esta sendo aplicada");
  }

  // Penetracao: e um valor UNICO do promotor selecionado, repetido por linha.
  const pens = new Set(linhas.map((r: any) => num(r.insurance_penetration_percent).toFixed(6)));
  console.log(`\n% penetracao nas linhas: ${[...pens].map((p) => (Number(p) * 100).toFixed(2) + "%").join(", ")}`);
  console.log("  (valor unico do promotor/escopo repetido por linha — promoterAnalytics: e por PROMOTOR,");
  console.log("   nao por contrato; penetracao por contrato nao existe como conceito)");

  console.log("\n" + "=".repeat(h.length));
  if (problemas.length) {
    console.log("FALHOU:");
    for (const p of problemas) console.log("  - " + p);
    process.exit(1);
  }
  console.log("PASSOU: a via de RENDER da /promotores devolve, para a ADS:");
  console.log("        - 'Comissao seguro'          = regua BBTS (receita da EMPRESA);");
  console.log("        - 'Comissao seguro promotor' = empresa x faixa SEGURO_SLIP da penetracao");
  console.log("          CONSOLIDADA do promotor (RR+ADS). As duas NAO batem — correto por design.");
})().catch((e) => { console.error("ERRO:", e && e.stack ? e.stack : e); process.exit(1); });
