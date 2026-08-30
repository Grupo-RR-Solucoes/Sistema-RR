/* FASE B / PASSO 5 — READ-ONLY, nada e escrito.
 *
 * Depois de a migration 20260830_000001 ter rodado, roda a consulta que CADA
 * TELA faz, pelas funcoes REAIS (nao por replicacao), nas tres competencias:
 *   1. buildDre                — a mesma que /api/dre chama
 *   1b. a perna do pagamento por carimbo — a leitura do bloco da ADS do dre.ts,
 *       necessaria porque o DRE NAO monta agosto (mes aberto, guarda de receita)
 *   2. buildFinancialAnalytics — a mesma que o /financeiro chama
 *   3. e confere que NENHUM alerta de "valor sem carimbo" acendeu.
 *
 * ATENCAO ao ler a matriz: o card Recebido e REGIME DE CAIXA e usa M-1. A matriz
 * da competencia M mostra o caixa de M-1 — entao os 19.048,86 de JULHO aparecem
 * na matriz de AGOSTO, nao na de julho.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const L = (c) => c.repeat(88);
const COMPS = [[2026, 6], [2026, 7], [2026, 8]];
const RX_SEM_CARIMBO = /sem carimbo|sem compet[eê]ncia de fechamento|bbts_competencia_fechamento/i;
const prev = (comp) => {
  const [y, m] = comp.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

(async () => {
  const { buildDre } = require("../lib/dre.ts");
  const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
  const alertasSuspeitos = [];

  // ------------------------------------------------------------------ (1) DRE
  console.log(L("="));
  console.log("(1) DRE — buildDre(sb, ano, mes), a mesma funcao que /api/dre chama");
  console.log(L("="));
  console.log("comp    | receita ADS  | receitaFechamento | comissoes   | resultadoLiquido");
  for (const [y, m] of COMPS) {
    const dre = await buildDre(sb, y, m);
    const ads = (dre.companies || []).find((c) => c.companyId === ADS);
    const comp = `${y}-${String(m).padStart(2, "0")}`;
    if (!ads) {
      console.log(`${comp} | (a ADS nao aparece — closed=${dre.closed}, period=${dre.period ? dre.period.key : "null"})`);
    } else {
      console.log(
        `${comp} | ${f(ads.receita).padStart(12)} | ${f(ads.receitaFechamento).padStart(17)} | ${f(ads.comissoes).padStart(11)} | ${f(ads.resultadoLiquido).padStart(16)}`
      );
    }
    for (const a of dre.alerts || []) if (RX_SEM_CARIMBO.test(a)) alertasSuspeitos.push(`DRE ${comp}: ${a}`);
  }

  // ---------------------------------------------------------------- (1b)
  console.log("\n" + L("-"));
  console.log("(1b) a PERNA DO PAGAMENTO por carimbo — a leitura do bloco da ADS do dre.ts");
  console.log("     (necessaria porque o DRE nao monta agosto: mes ABERTO)");
  console.log(L("-"));
  let dailyAll = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("daily_production_records")
      .select("bbts_pag_avista, bbts_seguro_pago, bbts_competencia_fechamento")
      .eq("company_id", ADS)
      .range(from, from + 999);
    if (error) throw error;
    dailyAll = dailyAll.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log("comp    | AVT           | SEGURO   | linhas");
  for (const [y, m] of COMPS) {
    const comp = `${y}-${String(m).padStart(2, "0")}`;
    let avt = 0;
    let seg = 0;
    let n = 0;
    for (const r of dailyAll) {
      if (String(r.bbts_competencia_fechamento || "").slice(0, 7) !== comp) continue;
      avt += Number(r.bbts_pag_avista) || 0;
      seg += Number(r.bbts_seguro_pago) || 0;
      n++;
    }
    console.log(`${comp} | ${f(avt).padStart(13)} | ${f(seg).padStart(8)} | ${String(n).padStart(6)}`);
  }
  const semCarimboComValor = dailyAll.filter(
    (r) => !r.bbts_competencia_fechamento && ((Number(r.bbts_pag_avista) || 0) !== 0 || (Number(r.bbts_seguro_pago) || 0) !== 0)
  ).length;
  console.log(`\n  linhas da ADS com valor de fechamento e SEM carimbo: ${semCarimboComValor}`);

  // -------------------------------------------------- (2) card Recebido
  console.log("\n" + L("="));
  console.log("(2) CARD RECEBIDO — buildFinancialAnalytics(sb, {year, month})");
  console.log(L("="));
  console.log("comp    | receivedClosing | receivedNet   | receivedManual");
  for (const [y, m] of COMPS) {
    const fin = await buildFinancialAnalytics(sb, { year: y, month: m });
    const s = fin.summary || {};
    const comp = `${y}-${String(m).padStart(2, "0")}`;
    console.log(`${comp} | ${f(s.receivedClosing).padStart(15)} | ${f(s.receivedNet).padStart(13)} | ${f(s.receivedManual).padStart(14)}`);
    for (const a of fin.alerts || []) if (RX_SEM_CARIMBO.test(a)) alertasSuspeitos.push(`FIN ${comp}: ${a}`);
  }

  console.log("\n" + L("-"));
  console.log("A LINHA DA ADS NA MATRIZ DE ENTRADA, celula a celula");
  console.log(L("-"));
  for (const [y, m] of COMPS) {
    const comp = `${y}-${String(m).padStart(2, "0")}`;
    const fin = await buildFinancialAnalytics(sb, { year: y, month: m });
    const linhas = ((fin.detalhamento || {}).entrada || {}).linhas || [];
    const ads = linhas.find((r) => String(r.chave) === ADS);
    console.log(`\n  matriz de ${comp}  (mostra o caixa de ${prev(comp)}, regime M-1):`);
    if (!ads) {
      console.log(`    (a ADS nao tem linha nesta matriz; ${linhas.length} linha(s) no total)`);
      continue;
    }
    console.log(`    celulas: ${JSON.stringify(ads.celulas)}`);
    console.log(`    total  : ${f(ads.total)}`);
  }

  // ------------------------------------------------------- (3) os alertas
  console.log("\n" + L("="));
  console.log("(3) ALERTAS de 'valor de fechamento sem carimbo'");
  console.log(L("="));
  if (alertasSuspeitos.length === 0) {
    console.log("  NENHUM. As duas telas leram pelo carimbo e nao encontraram linha com");
    console.log("  valor de fechamento e sem competencia.");
  } else {
    for (const a of alertasSuspeitos) console.log("  ACENDEU: " + a);
  }
  console.log("\n  (todos os alertas das duas telas, para conferencia:)");
  for (const [y, m] of COMPS) {
    const comp = `${y}-${String(m).padStart(2, "0")}`;
    const dre = await buildDre(sb, y, m);
    const fin = await buildFinancialAnalytics(sb, { year: y, month: m });
    for (const a of dre.alerts || []) console.log(`    DRE ${comp}: ${String(a).slice(0, 140)}`);
    for (const a of fin.alerts || []) console.log(`    FIN ${comp}: ${String(a).slice(0, 140)}`);
  }
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
