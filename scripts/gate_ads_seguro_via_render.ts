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
// REANCORADO em 01/08/2026: 34,55 -> 49,91.
//
// NAO foi cravado "o que da agora". O 49,91 foi PROVADO por reconstrucao
// independente: a regua BBTS lida direto de bbts_rule_versions (competencia
// 2026-07, v1, is_active) aplicada linha a linha sobre daily_production_records,
// SEM passar por promoterAnalytics nem por buildPromoterAnalytics. As 11 linhas
// da ADS com premio > 0 somam exatamente R$ 49,91, com 0 linha sem taxa
// resolvida:
//
//   ESTOQUE D0 x4 (0,100%)  13,00 + 8,80 + 8,00 + 7,15 = 36,95
//   SLIP NOVO  48 (0,150%)                              =  5,27
//   SLIP/SLIP NOVO x5 (0,100%)  2,10+2,09+1,26+0,60+0,55 =  6,60
//   ESTOQUE D0 120 (0,100%)                             =  1,10
//                                                        -------
//                                                          49,91
//
// A ancora antiga (34,55) era de quando a coluna crua do RR ainda contaminava a
// leitura da ADS. Este numero e comissao-EMPRESA; nao confundir com os R$ 27,08
// de residuo da regua do RR que sairam da base de lideranca no mesmo dia.
//
// SEGURO_ESPERADO continua sobrescrevendo, para investigacao pontual.
// ANCORA EXTERNA E DATADA (29/08/2026). Ela NAO e recomputada pelo sistema — se
// fosse, o portao viraria tautologia e provaria so que o sistema concorda consigo
// mesmo. O que ela ganha e PROCEDENCIA e IDADE, para que envelhecer seja visivel.
const ANCORA = {
  valor: 115.10,
  cravadaEm: "2026-08-29",
  procedencia:
    "Sigma bbts_seguro_pago das 12 linhas da ADS com seguro em 2026-07, conferida contra " +
    "a ancora EXTERNA do PDF de fechamento da BBTS: 115,10 (coluna) + 89,42 (so no " +
    "raw_payload) = 204,52 = seguro_calculo. Ver HANDOFF_ADS_FECHAMENTO_CAIXA §3 e §5.",
  escopo: { competencia: "2026-07", empresa: "ADS", linhas: 12 },
} as const;
// HISTORICO: a ancora anterior era 49,91, cravada em 01/08/2026 sobre 11 linhas.
// Ela nao estava errada — envelheceu. Em 26/08/2026 13:53:38 uma reimportacao do
// fechamento ADS de julho (documentada na §7 do HANDOFF_ADS_FECHAMENTO_CAIXA)
// reescreveu 43 linhas da ADS de 2026-07, 12 delas com seguro. O portao ficou
// vermelho e ninguem viu, porque ele e orfao do runner. Antes dela, 34,55.
const ESPERADO = Number(process.env.SEGURO_ESPERADO || ANCORA.valor);
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
    // AO REPROVAR, O PORTAO DISCRIMINA ancora vencida de divergencia viva. O sinal
    // e max(updated_at) das linhas somadas CONTRA a data em que a ancora foi cravada:
    // dado que se moveu DEPOIS da ancora => a ancora e a suspeita; dado parado com
    // numero diferente => o defeito esta no codigo.
    const dias = Math.floor((Date.now() - Date.parse(ANCORA.cravadaEm + "T00:00:00Z")) / 86400000);
    // proposalRows NAO carregam updated_at (vem do render, nao da tabela): o
    // discriminante busca a data na fonte, pelas propostas que acabaram de ser somadas.
    const props = linhas.map((r: any) => String(r.proposal_number || "")).filter(Boolean);
    const { data: upRows } = await sb
      .from("daily_production_records")
      .select("updated_at")
      .in("proposal_number", props);
    const ups = (upRows ?? []).map((r: any) => String(r.updated_at || "")).filter(Boolean).sort();
    const maxUp = ups.length ? ups[ups.length - 1] : "(sem updated_at)";
    const moveuDepois = ups.length > 0 && maxUp > ANCORA.cravadaEm;
    problemas.push(`comissao-empresa pela via de render ${brl(totEmpresa)} != ancora ${brl(ESPERADO)}`);
    console.log("");
    console.log(`  A ANCORA tem ${dias} dia(s) — cravada em ${ANCORA.cravadaEm}`);
    console.log(`  procedencia: ${ANCORA.procedencia}`);
    console.log(`  escopo cravado: ${JSON.stringify(ANCORA.escopo)} | linhas somadas hoje: ${linhas.length}`);
    console.log(`  max(updated_at) das linhas: ${maxUp}`);
    if (ups.length === 0) {
      console.log("  => NAO FOI POSSIVEL DATAR o dado (sem updated_at na fonte). Nao concluo nada;");
      console.log("     reprovo do mesmo jeito, porque nao medir nao e aprovar.");
    } else if (moveuDepois) {
      console.log("  => O DADO MUDOU DEPOIS DA ANCORA. Suspeita de ANCORA VENCIDA, nao de defeito.");
      console.log("     Quem recravar escreve valor, data, procedencia e o que mudou — aqui, no codigo.");
    } else {
      console.log("  => O DADO NAO SE MOVEU desde a ancora. Isto e DIVERGENCIA VIVA: o codigo mudou.");
    }
  } else {
    const dias = Math.floor((Date.now() - Date.parse(ANCORA.cravadaEm + "T00:00:00Z")) / 86400000);
    if (dias > 90) {
      console.log(`
  AVISO (nao reprova): a ancora tem ${dias} dias sem reconfirmacao.`);
    }
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
