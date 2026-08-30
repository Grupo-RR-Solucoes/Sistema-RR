/* (a) No CREDITO da ADS o promotor recebe pela TRP, e a BBTS paga OUTRA coisa.
 * Mede os DOIS numeros por contrato em 2026-07. READ-ONLY. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
(async () => {
  const { consolidateMonthlyFromBbts } = require("@/lib/bbtsMonthly.ts");
  const res = await consolidateMonthlyFromBbts(sb, { year: 2026, month: Number(process.env.MES||7), dryRun: true });
  const props = res.propostas || res.detalhe || [];
  console.log(`propostas devolvidas pelo consolidador: ${props.length}`);
  const { data: dpr } = await sb.from("daily_production_records")
    .select("proposal_number, gross_value, bbts_pag_avista, bbts_seguro_pago, insurance_value")
    .eq("company_id", ADS).eq("bbts_competencia_fechamento", `2026-${String(process.env.MES||7).padStart(2,"0")}-01`);
  const pago = new Map((dpr || []).map(r => [String(r.proposal_number), r]));

  let somaTrp = 0, somaBbts = 0, n = 0;
  const linhas = [];
  for (const p of props) {
    const d = pago.get(String(p.contrato));
    if (!d) continue;
    const trpAvista = Number(p.avista) || 0;       // comissao-empresa pela TRP, pos-teto
    const dif = Number(p.diferido) || 0;
    const bbtsPagou = Number(d.bbts_pag_avista) || 0;
    somaTrp += trpAvista; somaBbts += bbtsPagou; n++;
    linhas.push({ c: p.contrato, vfin: Number(p.vfin)||0, trpPct: Number(p.trp)||0, trpAvista, dif, bbtsPagou, sobra: bbtsPagou - trpAvista });
  }
  linhas.sort((a,b) => b.sobra - a.sobra);
  console.log("\ncontrato      vfin        %TRP    base promotor(TRP)  diferido   BBTS pagou   sobra empresa");
  for (const l of linhas.slice(0, 6)) console.log(`${l.c}  ${f(l.vfin).padStart(11)}  ${(l.trpPct*100).toFixed(3)}%  ${f(l.trpAvista).padStart(14)}  ${f(l.dif).padStart(9)}  ${f(l.bbtsPagou).padStart(10)}  ${f(l.sobra).padStart(12)}`);
  console.log("...");
  for (const l of linhas.slice(-3)) console.log(`${l.c}  ${f(l.vfin).padStart(11)}  ${(l.trpPct*100).toFixed(3)}%  ${f(l.trpAvista).padStart(14)}  ${f(l.dif).padStart(9)}  ${f(l.bbtsPagou).padStart(10)}  ${f(l.sobra).padStart(12)}`);
  console.log(`\n${n} contratos casados`);
  console.log(`  base do promotor pela TRP (pos-teto) : ${f(somaTrp)}`);
  console.log(`  o que a BBTS PAGOU a vista           : ${f(somaBbts)}`);
  console.log(`  SOBRA que fica na empresa            : ${f(somaBbts - somaTrp)}`);
})().catch(e => { console.error("EXCECAO:", e.message, e.stack ? e.stack.slice(0,400):""); process.exit(1); });
