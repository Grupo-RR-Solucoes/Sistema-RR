/* Ate onde para TRAS cada fonte de dono alcanca? READ-ONLY.
 * Decide se as duas operacoes de junho sao "dado faltando" (recuperavel) ou
 * "contrato anterior ao alcance do sistema" (nao recuperavel por codigo). */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const ALVOS = ["209621970", "209867885"];

const pag = async (tabela, colunas, filtro) => {
  let out = [], from = 0;
  for (;;) {
    let q = sb.from(tabela).select(colunas).range(from, from + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw error;
    out = out.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
};

(async () => {
  const daily = await pag("daily_production_records", "proposal_number, movement_date", (q) => q.eq("company_id", ADS));
  const cms = await pag("cms_promoter_entries", "contract_number, promoter_id");

  const numsDaily = daily.map((r) => String(r.proposal_number)).filter((s) => /^\d+$/.test(s)).sort();
  const numsCms = cms.map((r) => String(r.contract_number)).filter((s) => /^\d+$/.test(s)).sort();

  console.log("ALCANCE DE CADA FONTE DE DONO (por numero de operacao):");
  console.log(`  daily da ADS ......... ${daily.length} linha(s)   menor ${numsDaily[0]}   maior ${numsDaily[numsDaily.length - 1]}`);
  console.log(`  cms_promoter_entries . ${cms.length} linha(s)   menor ${numsCms[0]}   maior ${numsCms[numsCms.length - 1]}`);
  console.log("");
  const setDaily = new Set(numsDaily), setCms = new Set(numsCms);
  for (const op of ALVOS) {
    console.log(`  ${op}:`);
    console.log(`     esta na daily da ADS? ${setDaily.has(op)}`);
    console.log(`     esta no cms?          ${setCms.has(op)}`);
    console.log(`     abaixo do MENOR da daily (${numsDaily[0]})? ${op < numsDaily[0]}`);
    console.log(`     abaixo do MENOR do cms (${numsCms[0]})?     ${op < numsCms[0]}`);
  }

  // quantas operacoes do cms sao ANTERIORES ao menor da daily? (o cms e o seed
  // historico: se ele alcanca 209.x, "nao achei" seria dado faltando de verdade)
  const anterioresNoCms = numsCms.filter((n) => n < numsDaily[0]);
  console.log(`\n  operacoes no cms ANTERIORES ao menor da daily: ${anterioresNoCms.length}`);
  if (anterioresNoCms.length) {
    console.log(`     faixa: ${anterioresNoCms[0]} .. ${anterioresNoCms[anterioresNoCms.length - 1]}`);
    const comDono = cms.filter((r) => anterioresNoCms.includes(String(r.contract_number)) && r.promoter_id).length;
    console.log(`     dessas, com promoter_id preenchido: ${comDono}`);
    // as duas caem DENTRO dessa faixa historica?
    for (const op of ALVOS)
      console.log(`     ${op} cai dentro da faixa historica do cms? ${anterioresNoCms[0] <= op && op <= anterioresNoCms[anterioresNoCms.length - 1]}`);
  }

  // o PDF de junho: quantas linhas de seguro ele trouxe, e quantas viraram daily?
  const junho = daily.filter((r) => String(r.movement_date || "").startsWith("2026-06"));
  console.log(`\n  linhas da ADS com movement_date em 2026-06: ${junho.length}`);
  console.log(`     menor ${junho.map((r) => String(r.proposal_number)).sort()[0]}`);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
