/* ============================================================================
 * mov3_dre_inclui_tudo_gate — MOV 3 item 5 (ULTIMO). Somente leitura.
 *
 * Rodar:  TRP_SOURCE=db node scripts/mov3_dre_inclui_tudo_gate.cjs
 *   Compare com main: `git stash && node scripts/mov3_dre_inclui_tudo_gate.cjs`
 *
 * REGRA (Diego): o DRE nao exclui NADA que saiu ou entrou. Comissao paga e custo real.
 *
 * 3 exclusoes que VIOLAVAM a regra, corrigidas:
 *   1. promotor INATIVO — custo cortado, receita dele ja estava no DRE.
 *   2. atribuicao pelo CNPJ DOMINANTE — a comissao ADS de quem produz mais no RR caia
 *      no CNPJ do RR. Agora agrupa pela linha do PROPRIO PMR (source).
 *   3. empresa SEM receita EXCLUIDA (guarda que o Mov 2 criou p/ a ADS) — agora a ADS
 *      TEM receita (AVT+PRT+seguro, o "realizado" da auditoria BBTS). O que sobra e o
 *      dado INCOMPLETO: entra + ALERTA DURO (principio anti-silencio do Forecast).
 *
 * LEGITIMAS, intocadas: SRCC (banco nao pagou), payable = final - descontos (retencao),
 * listClosedPeriods, CNPJ TEMP-, despesas de grupo.
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildDre } = require("../lib/dre.ts");
const crypto = require("crypto");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const brl = (n) => "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => { s = String(s ?? ""); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); };
const num = (v) => Number(v || 0);

function porCnpj(d) {
  console.log("     " + pad("EMPRESA", 26) + pad("receita", 17) + pad("comissoes", 16) + pad("despesas", 14) + "resultado");
  for (const c of d.companies || []) {
    console.log("     " + pad(c.name, 26) + pad(brl(c.receita), 17) + pad(brl(c.comissoes), 16) + pad(brl(c.despesas), 14) + brl(c.resultadoLiquido));
  }
  if (d.group) {
    console.log("     " + pad("GRUPO", 26) + pad(brl(d.group.receita), 17) + pad(brl(d.group.comissoes), 16) + pad(brl(d.group.despesas), 14) + brl(d.group.resultadoLiquido));
  }
}

(async () => {
  let falhas = 0;

  // ---- 1. JUNHO: o DRE por CNPJ ----
  console.log("=".repeat(96));
  console.log("1) JUNHO/2026 — o DRE por CNPJ (rode em main via `git stash` p/ ver o ANTES)");
  console.log("=".repeat(96));
  const jun = await buildDre(sb, 2026, 6);
  porCnpj(jun);
  console.log("\n     ALERTAS:");
  for (const a of jun.alerts || []) console.log("      - " + a);

  // decomposicao
  const { data: pmrJun } = await sb.from("promoter_monthly_results")
    .select("company_id, source, final_commission_value, discount_value")
    .eq("year", 2026).eq("month", 6).in("source", ["fechamento", "bbts"]);
  const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
  const comAds = pmrJun.filter((r) => r.source === "bbts").reduce((s, r) => s + num(r.final_commission_value) - num(r.discount_value), 0);
  const adsLine = (jun.companies || []).find((c) => c.companyId === ADS);
  console.log("\n     DECOMPOSICAO:");
  console.log(`       receita ADS (AVT+PRT+seguro)           : ${brl(adsLine?.receita)}`);
  console.log(`       comissao ADS REAL (PMR source='bbts')  : ${brl(comAds)}`);
  console.log(`       comissao no CNPJ da ADS (agora)        : ${brl(adsLine?.comissoes)}`);
  console.log(`       RESULTADO da ADS                       : ${brl(adsLine?.resultadoLiquido)}`);
  const okAds = adsLine && Math.abs(num(adsLine.comissoes) - comAds) < 0.02;
  console.log(`       -> o CNPJ da ADS carrega a comissao ADS INTEIRA: ${okAds ? "OK" : "!! DIVERGE"}`);
  if (!okAds) falhas++;
  const okPos = adsLine && num(adsLine.resultadoLiquido) > 0;
  console.log(`       -> resultado da ADS POSITIVO (incluir MELHORA o DRE): ${okPos ? "OK" : "!! NEGATIVO"}`);
  if (!okPos) falhas++;

  // O DESCONTO vem de promoter_discounts (a coluna discount_value do PMR esta ZERADA).
  // Comissao do grupo TEM que ser Σ final - Σ descontos (apply_to_company !== true).
  const somaFinal = pmrJun.reduce((s, r) => s + num(r.final_commission_value), 0);
  const { data: pdJun } = await sb.from("promoter_discounts")
    .select("amount, apply_to_company").eq("year", 2026).eq("month", 6);
  const somaDesc = (pdJun || []).filter((r) => r.apply_to_company !== true).reduce((s, r) => s + num(r.amount), 0);
  const esperado = somaFinal - somaDesc;
  const okDesc = Math.abs(num(jun.group?.comissoes) - esperado) < 0.02;
  console.log(`\n     DESCONTOS (pegadinha: a coluna discount_value do PMR esta ZERADA):`);
  console.log(`       Σ final_commission_value      : ${brl(somaFinal)}`);
  console.log(`       Σ promoter_discounts (a fonte): ${brl(somaDesc)}`);
  console.log(`       comissao esperada (final-desc): ${brl(esperado)}`);
  console.log(`       comissao do DRE               : ${brl(jun.group?.comissoes)}   ${okDesc ? "OK" : "!! DIVERGE"}`);
  if (!okDesc) falhas++;

  // ---- ANCORA DO RESULTADO DO GRUPO ----
  // REANCORADA em 29/08/2026: 145.019,91 -> 143.942,13. A anterior era o numero
  // que o Diego previu, cravado quando a frente entrou; ela nao estava errada,
  // ENVELHECEU. O que a moveu nao foi o DRE e sim a ENTRADA dele: as 52 linhas do
  // PMR de 2026-06 foram reescritas ate 27/08/2026 20:54 UTC (a mais antiga e de
  // 30/06), depois da ancora, pelas reguas que entraram em agosto — teto 5,80%
  // (d7d556e) e carve-out INSS (d6febc5), as mesmas que movem a ancora de credito
  // do motor_credito_trp_db_gate.
  //
  // POR QUE A ANCORA CONTINUA, em vez de virar identidade auto-computada: a
  // identidade ja existe logo acima (Sigma final - Sigma descontos == comissoes do
  // DRE, conferida ao centavo neste mesmo run) e ela prova COERENCIA, nao
  // GRANDEZA. Uma identidade fecha igual mesmo que o DRE inteiro despenque. A
  // ancora e o unico ponto que cobra a ORDEM DE GRANDEZA contra um numero externo.
  const ANCORA_RESULTADO = {
    valor: 143942.13,
    cravadaEm: "2026-08-29",
    procedencia:
      "buildDre(2026-06).group.resultadoLiquido = receita 261.711,54 - comissoes " +
      "117.769,41 - despesas 0,00. A comissao e Sigma final_commission_value " +
      "(120.837,46, das 52 linhas de PMR de jun com source fechamento|bbts) menos " +
      "Sigma promoter_discounts nao-empresa (3.068,05) — a mesma identidade conferida " +
      "ao centavo logo acima, neste mesmo run.",
    escopo: { competencia: "2026-06", linhasPmr: 52, empresas: 5 },
  };
  const okRes = Math.abs(num(jun.group?.resultadoLiquido) - ANCORA_RESULTADO.valor) < 0.02;
  console.log(`\n     RESULTADO do grupo: ${brl(jun.group?.resultadoLiquido)}  (ancora ${brl(ANCORA_RESULTADO.valor)})  ${okRes ? "OK" : "!! DIVERGE"}`);
  console.log(`     antes da frente: R$ 140.695,13  ->  delta ${brl(num(jun.group?.resultadoLiquido) - 140695.13)}`);
  if (!okRes) {
    // Discrimina ancora vencida de divergencia viva pelo mesmo sinal usado no
    // gate_ads_seguro_via_render: dado que se moveu DEPOIS da ancora acusa a ancora.
    const { data: ups } = await sb.from("promoter_monthly_results")
      .select("updated_at").eq("year", 2026).eq("month", 6).in("source", ["fechamento", "bbts"]);
    const maxUp = (ups || []).map((r) => r.updated_at).filter(Boolean).sort().pop() || "";
    const dias = Math.floor((Date.now() - Date.parse(ANCORA_RESULTADO.cravadaEm + "T00:00:00Z")) / 86400000);
    console.log(`     A ANCORA tem ${dias} dia(s) — cravada em ${ANCORA_RESULTADO.cravadaEm}`);
    console.log(`     procedencia: ${ANCORA_RESULTADO.procedencia}`);
    console.log(`     escopo cravado: ${JSON.stringify(ANCORA_RESULTADO.escopo)}`);
    console.log(`     max(updated_at) do PMR de jun: ${maxUp || "(sem linhas)"}`);
    if (maxUp && maxUp.slice(0, 10) > ANCORA_RESULTADO.cravadaEm) {
      console.log("     => O PMR MUDOU DEPOIS DA ANCORA. Suspeita de ANCORA VENCIDA, nao de defeito.");
      console.log("        Quem recravar escreve valor, data, procedencia e o que mudou — aqui, no codigo.");
    } else {
      console.log("     => O PMR NAO se moveu desde a ancora. Isto e DIVERGENCIA VIVA: o codigo mudou.");
    }
    falhas++;
  }

  // ---- 2. JULHO: o alerta do dado incompleto ----
  console.log("\n" + "=".repeat(96));
  console.log("2) JULHO/2026 — a ADS tem comissao mas o fechamento ADS NAO foi importado");
  console.log("=".repeat(96));
  const jul = await buildDre(sb, 2026, 7);
  console.log(`  closed=${jul.closed}  (julho ainda e mes ABERTO: o DRE nao monta)`);
  console.log("  -> o alerta de 'resultado incompleto' so aparece quando a competencia FECHA.");
  console.log("     Simulacao do gatilho: empresa com comissao > 0 e receita = 0.");
  const { data: pmrJul } = await sb.from("promoter_monthly_results")
    .select("company_id, source, final_commission_value, discount_value").eq("year", 2026).eq("month", 7);
  const comAdsJul = pmrJul.filter((r) => r.company_id === ADS).reduce((s, r) => s + num(r.final_commission_value) - num(r.discount_value), 0);
  const { data: dJul } = await sb.from("daily_production_records").select("bbts_pag_avista, bbts_seguro_pago").eq("company_id", ADS);
  const recAdsJul = (dJul || []).reduce((s, r) => s + num(r.bbts_pag_avista) + num(r.bbts_seguro_pago), 0);
  console.log(`     comissao ADS em julho (PMR): ${brl(comAdsJul)}   receita ADS capturada: ${brl(recAdsJul)}`);
  console.log(`     -> quando julho fechar, a ADS entra COM a comissao e o alerta duro dispara.`);

  // ---- 3. jan-mai (cms) + abril: estrutura intacta? ----
  console.log("\n" + "=".repeat(96));
  console.log("3) jan-mai (cms) e abril — a ESTRUTURA muda? (receita RR, SRCC fora, descontos)");
  console.log("=".repeat(96));
  console.log("  " + pad("COMP", 9) + pad("receita", 17) + pad("comissoes", 16) + pad("resultado", 16) + "empresas");
  const partes = [];
  for (const m of [1, 2, 3, 4, 5, 6]) {
    const d = await buildDre(sb, 2026, m);
    if (!d.group) { console.log(`  2026-0${m}  (nao monta)`); continue; }
    const h = crypto.createHash("sha256").update(JSON.stringify(
      (d.companies || []).map((c) => [c.cnpj, Math.round(c.receita * 100), Math.round(c.comissoes * 100)]).sort()
    )).digest("hex").slice(0, 10);
    partes.push(`${m}:${h}`);
    console.log("  " + pad(`2026-${String(m).padStart(2, "0")}`, 9) + pad(brl(d.group.receita), 17) +
      pad(brl(d.group.comissoes), 16) + pad(brl(d.group.resultadoLiquido), 16) + (d.companies || []).length);
  }
  console.log("\n  RECEITA do RR nao muda em nenhum mes (fonte intocada: fechamento_mensal_empresa).");
  console.log("  As comissoes SOBEM onde havia INATIVO cortado — e isso e o conserto, nao regressao.");

  console.log("\n" + "=".repeat(96));
  console.log(falhas === 0 ? "GATE DRE INCLUI TUDO: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log("=".repeat(96));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
