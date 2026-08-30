/* BLOCO 1 / FASE B — medicoes (1) e (2). READ-ONLY, nada e escrito.
 *
 * (1) quantas linhas de SEGURO da ADS caem em competencia DIFERENTE da do PDF
 *     que as trouxe?
 * (2) o mesmo criterio para o AVT: casa por SORTE ou ha GARANTIA?
 *
 * COMO SE SABE A COMPETENCIA DO PDF DE UMA LINHA. Medido no importador:
 *   bbtsClosingImport.ts:385  compMovementDate = `${year}-${month}-15`
 *   :493  movement_date = compMovementDate                  (bloco de CREDITO)
 *   :589-591  proposal/movement/contract = compMovementDate (linha SO-SEGURO)
 * Ou seja: o importador CARIMBA a competencia do PDF como DIA 15. O dia 15 esta
 * sempre dentro da janela da propria competencia, entao para toda linha que o
 * importador escreveu vale competencia-do-PDF == competencia-por-janela.
 * O carimbo e a evidencia; onde ele nao existe, a competencia do PDF nao esta
 * gravada em lugar nenhum da linha.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const L = (c) => c.repeat(100);

(async () => {
  const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");

  let daily = [], from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("daily_production_records")
      .select("id, proposal_number, bbts_pag_avista, bbts_seguro_pago, movement_date, contract_date, proposal_date, raw_payload, created_at, updated_at")
      .eq("company_id", ADS).range(from, from + 999);
    if (error) throw error;
    daily = daily.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const janelaDe = (r) => {
    const p = getProductionPeriodFromValue(r.movement_date) || getProductionPeriodFromValue(r.contract_date) || getProductionPeriodFromValue(r.proposal_date);
    return p ? getProductionPeriodKey(p.year, p.month) : null;
  };
  // competencia do PDF = o CARIMBO do importador (dia 15). Sem carimbo -> desconhecida.
  const carimboDe = (r) => {
    const d = String(r.movement_date || "").slice(0, 10);
    return /^\d{4}-\d{2}-15$/.test(d) ? d.slice(0, 7) : null;
  };
  const fonteDe = (r) => {
    try { return r.raw_payload && r.raw_payload.__bbts_meta ? r.raw_payload.__bbts_meta.fonte || "(sem fonte)" : "(sem __bbts_meta)"; }
    catch { return "(raw ilegivel)"; }
  };

  for (const [rotulo, campo] of [["SEGURO", "bbts_seguro_pago"], ["AVT (pag_avista)", "bbts_pag_avista"]]) {
    const linhas = daily.filter((r) => Number(r[campo]) !== 0 && r[campo] !== null);
    console.log("\n" + L("="));
    console.log(`${rotulo} — ${linhas.length} linha(s) com valor != 0`);
    console.log(L("="));
    let comCarimbo = 0, semCarimbo = 0, divergem = 0;
    const divergentes = [];
    for (const r of linhas) {
      const jan = janelaDe(r), car = carimboDe(r);
      if (car) comCarimbo++; else semCarimbo++;
      if (car && jan !== car) { divergem++; divergentes.push({ r, jan, car }); }
      if (!car) divergentes.push({ r, jan, car: null });
    }
    console.log(`  com carimbo do importador (movement_date = dia 15): ${comCarimbo}`);
    console.log(`  SEM carimbo (competencia do PDF NAO gravada na linha): ${semCarimbo}`);
    console.log(`  carimbadas em que janela != carimbo: ${divergem}`);
    if (divergentes.length) {
      console.log("\n  as linhas que nao sao 'carimbo == janela':");
      console.log("  id(8)    | operacao   | valor  | movement   | contract   | proposal   | janela  | carimbo | fonte");
      for (const d of divergentes) {
        const r = d.r;
        console.log(`  ${String(r.id).slice(0, 8)} | ${String(r.proposal_number || "?").padEnd(10)} | ${f(r[campo]).padStart(6)} | ${String(r.movement_date || "-").slice(0, 10).padEnd(10)} | ${String(r.contract_date || "-").slice(0, 10).padEnd(10)} | ${String(r.proposal_date || "-").slice(0, 10).padEnd(10)} | ${String(d.jan || "??").padEnd(7)} | ${String(d.car || "AUSENTE").padEnd(7)} | ${fonteDe(r)}`);
      }
    }
    // distribuicao das fontes, para ver quem escreveu o que
    const porFonte = new Map();
    for (const r of linhas) {
      const k = fonteDe(r);
      const a = porFonte.get(k) || { n: 0, v: 0, semCarimbo: 0 };
      a.n++; a.v += Number(r[campo]) || 0;
      if (!carimboDe(r)) a.semCarimbo++;
      porFonte.set(k, a);
    }
    console.log("\n  por fonte declarada no raw_payload.__bbts_meta:");
    for (const [k, a] of [...porFonte].sort((x, y) => y[1].n - x[1].n))
      console.log(`    ${String(k).padEnd(34)} n=${String(a.n).padStart(3)}  Sigma=${f(a.v).padStart(12)}  sem carimbo: ${a.semCarimbo}`);
  }

  // ---- o que a competencia POR JANELA entrega hoje, lado a lado ----
  console.log("\n" + L("="));
  console.log("EFEITO NA TELA — o que o DRE soma hoje (janela) x o que o carimbo diria");
  console.log(L("="));
  for (const [rotulo, campo] of [["SEGURO", "bbts_seguro_pago"], ["AVT", "bbts_pag_avista"]]) {
    const porJanela = new Map(), porCarimbo = new Map();
    for (const r of daily) {
      const v = Number(r[campo]) || 0;
      if (!v) continue;
      const jan = janelaDe(r), car = carimboDe(r);
      if (jan) porJanela.set(jan, (porJanela.get(jan) || 0) + v);
      const k = car || "SEM CARIMBO";
      porCarimbo.set(k, (porCarimbo.get(k) || 0) + v);
    }
    console.log(`\n  ${rotulo}:`);
    const keys = [...new Set([...porJanela.keys(), ...porCarimbo.keys()])].sort();
    console.log("    comp        | por JANELA (hoje) | por CARIMBO do PDF");
    for (const k of keys)
      console.log(`    ${k.padEnd(11)} | ${f(porJanela.get(k) || 0).padStart(17)} | ${f(porCarimbo.get(k) || 0).padStart(18)}`);
  }

  // ---- cabecalho do PDF, para conferir os dois criterios contra a verdade ----
  const { data: tot } = await sb.from("bbts_fechamento_totais").select("competencia, pagamento_avt, pagamento_prt, abertura_conta").eq("company_id", ADS).order("competencia");
  console.log("\n  ancora do cabecalho (bbts_fechamento_totais):");
  for (const t of tot || []) console.log(`    ${String(t.competencia).slice(0, 7)}  AVT ${f(t.pagamento_avt).padStart(12)}  PRT ${f(t.pagamento_prt).padStart(8)}  abertura ${f(t.abertura_conta).padStart(8)}`);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
