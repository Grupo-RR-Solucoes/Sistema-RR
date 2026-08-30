/* ============================================================================
 * mov2_dre_gate — MOV 2, Grupo B item 4 (DRE). So leitura.
 *
 * Rodar:  TRP_SOURCE=db node scripts/mov2_dre_gate.cjs
 *
 * O DRE tinha DOIS defeitos (e o gate achou um TERCEIRO):
 *  1. listClosedPeriods REIMPLEMENTAVA a cobertura lendo so cms_imports -> abril e
 *     junho NUNCA apareciam na lista de periodos. O guard de fechamento era
 *     inalcancavel para eles.
 *  2. o guard usava o BOOLEANO e o analytics era chamado SEM closedSource -> .find()
 *     legado (1 linha do PMR por promotor, sem filtrar source).
 *  3. [ACHADO] a linha consolidada carrega o company_id da linha de MAIOR producao.
 *     Promotor que so produziu na ADS cai na ADS — que tem CNPJ real, active=false e
 *     NENHUMA receita em fechamento_mensal_empresa. O DRE fabricaria um prejuizo.
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildDre } = require("../lib/dre.ts");
const { detectMonthRegime } = require("../lib/cmsMonthly.ts");
const { loadPromoterAnalyticsBase } = require("../lib/promoterAnalytics.ts");
const crypto = require("crypto");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const brl = (n) => "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => { s = String(s ?? ""); return s.length >= n ? s : s + " ".repeat(n - s.length); };
const num = (v) => Number(v || 0);

/** Hash do DRE de uma competencia (para provar no-op). */
function hashDre(d) {
  const norm = {
    closed: d.closed,
    companies: (d.companies || []).map((c) => [c.cnpj, Math.round(c.receita * 100), Math.round(c.comissoes * 100), Math.round(c.despesas * 100)]).sort(),
    group: d.group ? [Math.round(d.group.receita * 100), Math.round(d.group.comissoes * 100), Math.round(d.group.resultadoLiquido * 100)] : null,
  };
  return crypto.createHash("sha256").update(JSON.stringify(norm)).digest("hex").slice(0, 12);
}

(async () => {
  let falhas = 0;

  // ---- 1. COBERTURA: a lista de periodos ----
  console.log("=".repeat(94));
  console.log("1) COBERTURA — a lista de periodos do DRE");
  console.log("=".repeat(94));
  const d0 = await buildDre(sb);
  const lista = (d0.periods || []).map((p) => p.key).sort();
  console.log("  DEPOIS (esta branch): " + lista.join("  "));
  console.log("  ANTES  (main)       : so os meses com cms_imports COMPLETED (jan/fev/mar/mai)");
  console.log("                        -> abril e junho NAO apareciam");
  const temAbr = lista.includes("2026-04");
  const temJun = lista.includes("2026-06");
  console.log(`  abril na lista: ${temAbr ? "OK" : "!! FALTA"}    junho na lista: ${temJun ? "OK" : "!! FALTA"}`);
  if (!temAbr || !temJun) falhas++;

  // ---- 2. NO-OP dos meses cms + julho ----
  console.log("\n" + "=".repeat(94));
  console.log("2) NO-OP — jan/fev/mar/mai (cms) e julho (open)");
  console.log("=".repeat(94));
  console.log("  " + pad("COMP", 9) + pad("regime", 13) + pad("closed", 8) + pad("receita", 16) + pad("comissoes", 16) + "hash");
  for (const m of [1, 2, 3, 5, 7]) {
    const regime = await detectMonthRegime(sb, 2026, m);
    const d = await buildDre(sb, 2026, m);
    console.log("  " + pad(`2026-${String(m).padStart(2, "0")}`, 9) + pad(regime, 13) + pad(d.closed, 8) +
      pad(d.group ? brl(d.group.receita) : "—", 16) + pad(d.group ? brl(d.group.comissoes) : "—", 16) + hashDre(d));
  }
  console.log("  (compare os hashes com os de main via `git stash` — tem que ser IDENTICOS)");

  // ---- 3. ABRIL e JUNHO: agora aparecem E leem o fechado real ----
  console.log("\n" + "=".repeat(94));
  console.log("3) ABRIL e JUNHO — passam a montar o DRE");
  console.log("=".repeat(94));
  for (const m of [4, 6]) {
    const d = await buildDre(sb, 2026, m);
    console.log(`  2026-${String(m).padStart(2, "0")}  closed=${d.closed}  periodo=${d.period ? d.period.label : "—"}`);
    if (!d.closed || !d.group) { console.log("     !! NAO MONTOU"); falhas++; continue; }
    console.log("     " + pad("CNPJ", 26) + pad("receita", 16) + pad("comissoes", 15) + pad("despesas", 14) + "resultado");
    for (const c of d.companies) {
      console.log("     " + pad(c.name, 26) + pad(brl(c.receita), 16) + pad(brl(c.comissoes), 15) + pad(brl(c.despesas), 14) + brl(c.resultadoLiquido));
    }
    console.log("     " + pad("GRUPO", 26) + pad(brl(d.group.receita), 16) + pad(brl(d.group.comissoes), 15) + pad(brl(d.group.despesas), 14) + brl(d.group.resultadoLiquido));
    for (const a of d.alerts || []) console.log("     [alerta] " + a);
  }

  // ---- 4. O "ACHADO" DA ADS — ASSERCAO APOSENTADA EM 29/08/2026 ----
  //
  // ERA: "a ADS nao pode aparecer no DRE", porque em 2026-07 ela tinha CNPJ real,
  // active=false e NENHUMA receita em fechamento_mensal_empresa — incluir o custo
  // dela sem receita FABRICARIA um prejuizo.
  //
  // A PREMISSA MORREU, e nao por conserto colateral: por decisao explicita. O
  // commit 24625ef ("mov3: DRE inclui ADS e inativos — nao excluir nada que saiu
  // ou entrou") REVERTEU esta regra de proposito, e lib/dre.ts diz porque, com
  // todas as letras: "agora que a receita da ADS entra (AVT+PRT+seguro), a
  // exclusao perdeu o motivo — e ela VIOLAVA a regra: o DRE nao descarta custo que
  // saiu". O caso do dado incompleto passou a ser tratado por ALERTA DURO
  // (dre.ts:608), nao por exclusao silenciosa.
  //
  // O FATO MEDIDO EM 29/08/2026 que fecha a questao: em 2026-06 a ADS entra no DRE
  // com receita R$ 9.321,02, comissao R$ 5.194,69 e resultado POSITIVO de
  // R$ 4.126,33. O prejuizo fabricado que esta assercao existia para impedir nao
  // tem como acontecer — incluir a ADS MELHORA o resultado. Em 2026-04 ela nao
  // aparece, mas por nao ter movimento nenhum (receita, comissao e despesa todas
  // zero, filtradas em dre.ts:654), nao por regra de exclusao: essa regra nao
  // existe mais no codigo.
  //
  // NAO FICA DESCOBERTO (a varredura antes de aposentar): o lado PERMANENTE desta
  // assercao — a ADS carregar a comissao dela e o alerta disparar quando falta
  // receita — e hoje asserido por mov3_dre_inclui_tudo_gate.cjs, que cobra o
  // OPOSTO ("o CNPJ da ADS carrega a comissao ADS INTEIRA" e "resultado da ADS
  // POSITIVO"). Os dois portoes se contradiziam; o vencedor e o que espelha o
  // codigo de hoje. Aqui sobra o DIAGNOSTICO, que continua util e nao reprova.
  console.log("\n" + "=".repeat(94));
  console.log("4) ADS no DRE — DIAGNOSTICO (assercao aposentada em 29/08/2026, ver comentario)");
  console.log("=".repeat(94));
  const { data: comps } = await sb.from("companies").select("id, name, cnpj, active");
  const ads = comps.find((c) => c.active === false);
  for (const m of [4, 6]) {
    const base = await loadPromoterAnalyticsBase(sb, { year: 2026, month: m, closed: true, closedSource: "fechamento" });
    let naAds = 0;
    for (const r of base.filteredSummaryRows) {
      if (!r.active) continue;
      if ((r.company_id || "") === ads.id) naAds += num(r.payable_commission_value);
    }
    const d = await buildDre(sb, 2026, m);
    const linhaAds = (d.companies || []).find((c) => c.cnpj === ads.cnpj);
    console.log(`  2026-${String(m).padStart(2, "0")}  comissao que cairia na ADS: ${brl(naAds)}   ADS no DRE? ` +
      (linhaAds
        ? `SIM — receita ${brl(linhaAds.receita)}, comissao ${brl(linhaAds.comissoes)}, resultado ${brl(linhaAds.resultadoLiquido)}`
        : "nao (sem movimento nesta competencia)"));
  }

  // ---- 5. Conferencia contra as outras 3 telas ----
  console.log("\n" + "=".repeat(94));
  console.log("5) O DRE bate com /promotores + Dashboard + Relatorios?");
  console.log("=".repeat(94));
  for (const m of [4, 6]) {
    const base = await loadPromoterAnalyticsBase(sb, { year: 2026, month: m, closed: true, closedSource: "fechamento" });
    const rows = base.filteredSummaryRows;
    const final = rows.reduce((s, r) => s + num(r.final_commission_value), 0);
    const payableTodos = rows.reduce((s, r) => s + num(r.payable_commission_value), 0);
    const payableAtivos = rows.filter((r) => r.active).reduce((s, r) => s + num(r.payable_commission_value), 0);
    const d = await buildDre(sb, 2026, m);
    const dreCom = d.group ? d.group.comissoes : 0;
    console.log(`  2026-${String(m).padStart(2, "0")}`);
    console.log(`     final_commission (as 3 telas)          : ${brl(final)}`);
    console.log(`     payable (final - descontos), todos     : ${brl(payableTodos)}`);
    console.log(`     payable, so ATIVOS                     : ${brl(payableAtivos)}`);
    console.log(`     COMISSOES DO DRE                       : ${brl(dreCom)}`);
    console.log(`     delta DRE vs payable-ativos            : ${brl(dreCom - payableAtivos)}  (= comissao da ADS, fora do DRE)`);
  }
  console.log("\n  O DRE NAO exibe o mesmo numero das outras 3 telas — e nao deveria:");
  console.log("   - as telas mostram final_commission (bruta); o DRE usa payable = final - DESCONTOS;");
  console.log("   - o DRE soma so promotores ATIVOS (regra propria, ja existia);");
  console.log("   - e a comissao da ADS fica FORA (sem receita -> prejuizo falso). Alerta na tela.");

  console.log("\n" + "=".repeat(94));
  console.log(falhas === 0 ? "GATE DRE: PASSOU" : `GATE DRE: ${falhas} FALHA(S)`);
  console.log("=".repeat(94));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
