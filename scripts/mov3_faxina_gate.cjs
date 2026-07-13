/* ============================================================================
 * mov3_faxina_gate — MOV 3 (faxina): prova que a remocao de codigo morto e NO-OP.
 * Somente leitura. NAO grava.
 *
 * Rodar:  TRP_SOURCE=db node scripts/mov3_faxina_gate.cjs
 *   Compare o HASH FINAL com o de main (git stash). Tem que ser IDENTICO.
 *
 * O QUE FOI REMOVIDO (tudo provado morto por grep ANTES de sair):
 *  1. motor: getComissaoPromotorSeguro (2a escala de seguro, cortes 0,6/0,4/0,2 —
 *     incompativel com a oficial 0,30/0,21/0,11 de lib/insurancePenetration) e os
 *     campos que ela alimentava: seguro.promotor, credito.avista_promotor,
 *     credito.spreadEmpresa, total_geral. ZERO leitores nos 6 consumidores de
 *     calcularOperacao. Os campos LIDOS (credito.regra/faixa_producao/percentual/
 *     total/avista_empresa/diferido, seguro.empresa, diferido.*) ficaram.
 *  2. cmsMonthly: detectClosedMonth — o booleano que colapsava cms+fechamento e foi
 *     a causa raiz do Movimento 2. Sem call-site em lib/ e app/ depois do Mov 2.
 *  3. proposalDetailing: monthlyVolumesMap passa a filtrar status/SRCC (antes somava
 *     cancelada e SRCC no volume que decide a faixa da escala ENTRANTE).
 *
 * O (3) e o unico que PODERIA mudar numero.
 *
 * CORRECAO DE UMA AFIRMACAO ERRADA do mapeamento: a escala ENTRANTE E SIM alcancada —
 * por 1 promotor em cada competencia (PROFILE_ENTRANTE_CUSTOM_VOL_*). O volume dele
 * MUDA com o filtro (abril 99K -> 77K, junho 67K -> 59K: a diferenca e cancelada/SRCC
 * que nao deveria contar). O que NAO muda e a FAIXA: o volume corrigido cai no mesmo
 * tier, entao o `acordo` (share) e identico. Por isso o consolidador da o MESMO numero.
 *
 * A prova e o HASH do consolidateMonthlyGroup (que inclui o acordo): tem que bater com
 * o de main. BASELINE_MAIN abaixo foi medido em main (git stash) ANTES da faxina.
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { consolidateMonthlyGroup } = require("../lib/bbtsOrchestrator.ts");
const { fetchPromoterShareData, resolvePromoterShareSync } = require("../lib/proposalDetailing.ts");
const crypto = require("crypto");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const brl = (n) => "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => { s = String(s ?? ""); return s.length >= n ? s : s + " ".repeat(n - s.length); };

(async () => {
  let falhas = 0;

  // ---- 1. Quem consome o volume, e o que muda nele ----
  console.log("=".repeat(92));
  console.log("1) Quem resolve o repasse VIA ESCALA ENTRANTE (o unico consumidor do volume)");
  console.log("=".repeat(92));
  console.log("  O nome da fonte embute o volume (PROFILE_ENTRANTE_CUSTOM_VOL_xxK) — da para ver");
  console.log("  o volume corrigir sem a faixa mudar. Em main: abril VOL_99K, junho VOL_67K.\n");
  const { data: rr } = await sb.from("companies").select("id").eq("group_name", "Grupo RR");
  const rrIds = rr.map((c) => c.id);
  const { data: proms } = await sb.from("promoters").select("id, name");
  const pn = new Map(proms.map((p) => [p.id, p.name]));

  for (const m of [4, 6, 7]) {
    const s = await fetchPromoterShareData(sb, [...pn.keys()], 2026, m, rrIds);
    const fontes = new Map();
    for (const [pid, vol] of s.monthlyVolumesMap) {
      const res = resolvePromoterShareSync({
        record: { assigned_promoter_id: pid, share_percent_override: null },
        profilesMap: s.profilesMap,
        scalesMap: s.scalesMap,
        monthlyVolumesMap: new Map([[pid, vol]]),
        frenteC: null,
      });
      const f = String(res.source ?? "?");
      fontes.set(f, (fontes.get(f) ?? 0) + 1);
    }
    const entrantes = [...fontes.keys()].filter((f) => /ENTRANTE/i.test(f));
    console.log(`  2026-${String(m).padStart(2, "0")}  fontes: ${[...fontes.entries()].map(([f, n]) => f + "=" + n).join("  ")}`);
    console.log(`            via ESCALA ENTRANTE: ${entrantes.join(", ") || "(nenhum)"}`);
  }

  // ---- 2. HASH do orquestrador (RR + ADS) — tem que bater com main ----
  console.log("\n" + "=".repeat(92));
  console.log("2) HASH do consolidateMonthlyGroup (RR + ADS) — compare com main via `git stash`");
  console.log("=".repeat(92));
  const partes = [];
  for (const m of [4, 6, 7]) {
    const g = await consolidateMonthlyGroup(sb, { year: 2026, month: m, dryRun: true });
    const norm = (g.rows || [])
      .map((r) => [
        r.promoter_id,
        Math.round(r.prod_total * 100),
        Math.round(r.credito_rr * 100),
        Math.round(r.credito_ads * 100),
        Math.round(r.seguro_rr * 100),
        Math.round(r.seguro_ads * 100),
        Math.round(r.acordo * 1e6),
        r.status_meta,
      ].join(":"))
      .sort();
    const h = crypto.createHash("sha256").update(JSON.stringify(norm)).digest("hex").slice(0, 12);
    const tot = (k) => (g.rows || []).reduce((s, x) => s + (x[k] || 0), 0);
    partes.push(h);
    console.log(`  2026-${String(m).padStart(2, "0")}  hash=${h}  credito_rr=${pad(brl(tot("credito_rr")), 16)} credito_ads=${pad(brl(tot("credito_ads")), 14)} seguro_rr=${pad(brl(tot("seguro_rr")), 13)} seguro_ads=${brl(tot("seguro_ads"))}`);
  }
  // BASELINE medido em MAIN (git stash) ANTES da faxina — abril+junho+julho.
  const BASELINE_MAIN = "49296f8dee56be95";
  const hashFinal = crypto.createHash("sha256").update(partes.join("|")).digest("hex").slice(0, 16);
  const bate = hashFinal === BASELINE_MAIN;
  console.log(`\n  HASH FINAL (abril+junho+julho) = ${hashFinal}`);
  console.log(`  BASELINE de main (pre-faxina)   = ${BASELINE_MAIN}`);
  console.log(`  -> NO-OP: ${bate ? "OK — nenhum numero mudou" : "!! MUDOU ALGUM NUMERO"}`);
  if (!bate) falhas++;

  console.log("\n" + "=".repeat(92));
  console.log(falhas === 0 ? "GATE FAXINA: PASSOU" : `GATE FAXINA: ${falhas} FALHA(S)`);
  console.log("=".repeat(92));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
