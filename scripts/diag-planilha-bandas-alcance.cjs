/* ALCANCE da divergencia de BANDA: a planilha traz os VALORES da TRP39 nas
 * BANDAS da TRP38. Monta a "regua que a planilha promete" (celula da TRP39 +
 * limites da planilha) e roda o MOTOR REAL contra a TRP39. READ-ONLY. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const DL = "C:/Users/diego/Downloads";
const f = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p4 = (v) => (v == null ? "—" : (Number(v) * 100).toFixed(4) + "%");
/* BANDAS DA PLANILHA, lidas das abas CERTAS pelo nome — nao pelo indice, que e
 * justamente o que esta quebrado no parser. Valores em decimal. */
const PLANILHA = {
  CONSIG_SP_MG: [[0.0172,0.0179,0.0097],[0.0180,0.0189,0.0252],[0.0190,0.0199,0.0366],[0.0200,0.0209,0.0448],[0.0210,0.0219,0.0529],[0.0220,0.0229,0.0580],[0.0230,0.0239,0.0580],[0.0240,0.0249,0.0580],[0.0250,null,0.0580]],
  NAO_CONSIGNADO: [[0.0292,0.0337,0.0183],[0.0338,0.0383,0.0264],[0.0384,0.0429,0.0346],[0.0430,0.0475,0.0427],[0.0476,0.0538,0.0529],[0.0539,null,0.0580]],
};
const META = new Set(["tx_min","tx_max","prazo_min","prazo_max"]);
const arrays = (c) => !c || typeof c !== "object" ? [] : Object.keys(c).filter((k) => {
  const v = c[k];
  return Array.isArray(v) && v.length && v.every((x)=>x&&typeof x==="object") &&
    v.some((x)=>Object.entries(x).some(([kk,vv])=>!META.has(kk)&&typeof vv==="number"));
});
(async () => {
  const { buildTrpDraft } = require("@/lib/trp/parseTrpDraft.ts");
  const { calcularOperacao } = require("@/lib/motor.ts");
  const { tetoAvistaRR } = require("@/lib/tetoAvistaRR.ts");
  const t39 = (await buildTrpDraft(new Uint8Array(fs.readFileSync(DL + "/TRP39 - PROMOTIVA 082026.pdf")), { competencia: "2026-08", sourceFilename: "T39", sha256: "39" })).regraDraft;

  /* A REGUA QUE A PLANILHA PROMETE: para cada banda da planilha, pega a CELULA
   * da TRP39 cuja Faixa 3 bate com o valor prometido (assim as 5 faixas vem
   * coerentes) e troca so os LIMITES pelos da planilha. */
  const promessa = JSON.parse(JSON.stringify(t39));
  for (const cat of Object.keys(PLANILHA)) {
    const chave = arrays(t39[cat])[0];
    const celsTrp = t39[cat][chave];
    const novas = [];
    for (const [lo, hi, pct] of PLANILHA[cat]) {
      const base = celsTrp.find((c) => Math.abs((c["Faixa 3"] ?? -1) - pct) < 1e-9)
        || celsTrp.find((c) => Math.min(c["Faixa 3"] ?? 0, 0.058) === Math.min(pct, 0.058));
      if (!base) { console.log(`  AVISO: ${cat} banda ${lo}-${hi} pct ${pct} sem celula equivalente na TRP39`); continue; }
      novas.push({ ...base, tx_min: lo, tx_max: hi == null ? 999 : hi });
    }
    promessa[cat] = { ...t39[cat], [chave]: novas };
  }

  const teto = tetoAvistaRR({ year: 2026, month: 8 });
  const { data: recs } = await sb.from("daily_production_records")
    .select("proposal_number, assigned_promoter_id, gross_value, net_value, interest_rate, term_months, installments, product_description, product_code, convenio_code, convenio_type, convenio_segment, insurance_value, has_insurance, movement_date, contract_date, proposal_date")
    .neq("company_id", ADS).gte("movement_date","2026-08-01").lte("movement_date","2026-08-31");
  const { data: proms } = await sb.from("promoters").select("id, name");
  const nome = new Map((proms||[]).map(p=>[p.id,p.name]));
  const prov = (r) => () => r;

  let n = 0, deltaTot = 0, aMais = 0, aMenos = 0;
  const porPromotor = new Map(); const amostra = [];
  for (const r of recs || []) {
    const liq = Number(r.net_value) || Number(r.gross_value) || 0;
    const op = { valor_liquido: liq, valor_bruto: Number(r.gross_value)||0, valor_seguro: Number(r.insurance_value)||0,
      tem_seguro: !!r.has_insurance, taxa_juros: Number(r.interest_rate)||0,
      prazo: Number(r.term_months)||Number(r.installments)||0,
      product_code: r.product_code??null, product_description: r.product_description??null,
      convenio_code: r.convenio_code??null, convenio_type: r.convenio_type??null, convenio_segment: r.convenio_segment??null,
      contract_date: r.contract_date||r.movement_date, movement_date: r.movement_date,
      proposal_date: r.proposal_date||r.movement_date, production_value: 0, company_cash_percent: null };
    let pp, pt;
    try { pp = Number(calcularOperacao(op, { trpProvider: prov(promessa) }).credito.percentual); } catch { continue; }
    try { pt = Number(calcularOperacao(op, { trpProvider: prov(t39) }).credito.percentual); } catch { continue; }
    if (!Number.isFinite(pp) || !Number.isFinite(pt) || pp === pt) continue;
    n++;
    const d = liq * (Math.min(pp, teto) - Math.min(pt, teto)); // planilha - TRP39
    deltaTot += d; if (d > 0) aMais += d; else aMenos += d;
    const pid = r.assigned_promoter_id || "(sem promotor)";
    const a = porPromotor.get(pid) || { n: 0, d: 0 }; a.n++; a.d += d; porPromotor.set(pid, a);
    // interest_rate JA vem em percentual (5.54 = 5,54%). Multiplicar por 100
    // aqui imprimia "554,00%" — erro so de EXIBICAO: o motor recebe o valor cru
    // e faz `rate > 1 ? rate/100 : rate` por dentro, entao a conta sempre esteve
    // certa. Fica o registro porque numero errado na tela vira citacao errada.
    if (amostra.length < 10) amostra.push(`    ${r.proposal_number} taxa ${Number(r.interest_rate).toFixed(2)}% liq ${f(liq)}  planilha ${p4(pp)} x TRP39 ${p4(pt)}  ${f(d)}`);
  }
  console.log(`\n=== (3) ALCANCE da divergencia de BANDA — RR, agosto/2026 ===`);
  console.log(`  contratos avaliados: ${(recs||[]).length}`);
  console.log(`  caem em intervalo onde as duas DISCORDAM: ${n}`);
  console.log(`  promotores afetados: ${porPromotor.size}`);
  console.log(`\n  efeito (planilha - TRP39), pos-teto ${p4(teto)}:`);
  console.log(`    a planilha promete A MAIS : ${f(aMais)}`);
  console.log(`    a planilha promete A MENOS: ${f(aMenos)}`);
  console.log(`    LIQUIDO                   : ${f(deltaTot)}  ${deltaTot > 0 ? "<- promete mais do que a TRP39 paga" : "<- promete menos"}`);
  if (amostra.length) { console.log("\n  amostra:"); for (const l of amostra) console.log(l); }
  console.log("\n  por promotor:");
  for (const [pid, v] of [...porPromotor.entries()].sort((a,b)=>b[1].d-a[1].d)) console.log(`    ${String(nome.get(pid)||pid).slice(0,34).padEnd(36)} ${String(v.n).padStart(3)} contrato(s)  ${f(v.d).padStart(10)}`);
  console.log("\nNADA GRAVADO, NADA IMPORTADO.");
})().catch(e => { console.error("EXCECAO:", e.message, (e.stack||"").slice(0,400)); process.exit(1); });
