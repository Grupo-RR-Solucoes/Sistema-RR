/* FRENTE 2 — a SOBRA medida nos DOIS lados (credito e seguro), jun e jul.
 * credito: base do promotor (TRP, pos-teto) x bbts_pag_avista
 * seguro : comissao-empresa (regua BBTS x insurance_value) x bbts_seguro_pago
 * READ-ONLY. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
(async () => {
  const { consolidateMonthlyFromBbts } = require("@/lib/bbtsMonthly.ts");
  const { resolveBbtsRegraDb } = require("@/lib/bbts/resolveBbtsRegra.ts");
  const { seguroRateFromRegra } = require("@/lib/bbts/seguroBbts.ts");
  for (const m of [6, 7]) {
    const comp = `2026-${String(m).padStart(2, "0")}`;
    console.log("\n" + "=".repeat(72));
    console.log(`COMPETENCIA ${comp}`);
    console.log("=".repeat(72));

    const { data: dpr } = await sb.from("daily_production_records")
      .select("proposal_number, gross_value, insurance_value, insurance_type, term_months, bbts_pag_avista, bbts_seguro_pago")
      .eq("company_id", ADS).eq("bbts_competencia_fechamento", `${comp}-01`);

    // --- CREDITO
    const res = await consolidateMonthlyFromBbts(sb, { year: 2026, month: m, dryRun: true });
    const props = res.propostas || [];
    const pago = new Map((dpr || []).map(r => [String(r.proposal_number), r]));
    let cTrp = 0, cBbts = 0, nC = 0;
    for (const p of props) { const d = pago.get(String(p.contrato)); if (!d) continue; cTrp += Number(p.avista)||0; cBbts += Number(d.bbts_pag_avista)||0; nC++; }
    console.log(`\nCREDITO (${nC} contratos)`);
    console.log(`  base do promotor (TRP, pos-teto) : ${f(cTrp).padStart(12)}`);
    console.log(`  a empresa RECEBEU (BBTS a vista) : ${f(cBbts).padStart(12)}`);
    console.log(`  SOBRA                            : ${f(cBbts - cTrp).padStart(12)}  ${cBbts-cTrp < 0 ? "<-- NEGATIVA" : ""}`);

    // --- SEGURO
    const rg = await resolveBbtsRegraDb({ competencia: comp }, sb);
    // A REGUA INTEIRA, nao regra.seguro: seguroRateFromRegra le a secao
    // 'seguro' por dentro. Passar um nivel a mais devolvia rate=null em
    // TODAS as linhas e a sobra do seguro saia 0,00 — erro do diagnostico,
    // nao do sistema. E o mesmo formato que bbtsMonthly.ts:189 usa.
    const regraSeguro = rg && rg.regra ? rg.regra : null;
    console.log(`\nSEGURO (regua ${rg ? rg.competenciaFornecedora || rg.competenciaUsada : "?"}${rg && rg.isFallback ? " [FALLBACK]" : ""})`);
    let sEmp = 0, sBbts = 0, nS = 0, semTaxa = 0;
    for (const r of dpr || []) {
      const base = Number(r.insurance_value) || 0;
      const pagoSeg = Number(r.bbts_seguro_pago) || 0;
      if (base <= 0 && pagoSeg === 0) continue;
      nS++;
      sBbts += pagoSeg;
      if (base > 0 && regraSeguro) {
        const t = seguroRateFromRegra(regraSeguro, r.insurance_type, r.term_months);
        if (t.rate === null) semTaxa++; else sEmp += base * t.rate;
      }
    }
    console.log(`  comissao-empresa pela regua BBTS : ${f(sEmp).padStart(12)}  (${nS} linhas com seguro, ${semTaxa} sem taxa)`);
    console.log(`  a empresa RECEBEU (BBTS seguro)  : ${f(sBbts).padStart(12)}`);
    console.log(`  SOBRA                            : ${f(sBbts - sEmp).padStart(12)}  ${sBbts-sEmp < 0 ? "<-- NEGATIVA" : ""}`);

    console.log(`\n  SOBRA TOTAL (credito + seguro)   : ${f((cBbts - cTrp) + (sBbts - sEmp)).padStart(12)}`);
  }
})().catch(e => { console.error("EXCECAO:", e.message, (e.stack||"").slice(0,300)); process.exit(1); });
