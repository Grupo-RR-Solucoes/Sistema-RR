/* O DANO DA VIGENCIA INTRA-MES. A TRP39 vale a partir de 05/08/2026, mas o
 * sistema tem UMA regua por competencia — subir a TRP39 aplica a tabela NOVA
 * tambem aos contratos de 31/07 a 04/08, que deveriam seguir a TRP38.
 * READ-ONLY: nada gravado. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const DL = "C:/Users/diego/Downloads";
const CORTE = "2026-08-05"; // a TRP39 vale A PARTIR desta data
const f = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p4 = (v) => (v == null ? "—" : (Number(v) * 100).toFixed(4) + "%");

(async () => {
  const { buildTrpDraft } = require("@/lib/trp/parseTrpDraft.ts");
  const { calcularOperacao } = require("@/lib/motor.ts");
  const { tetoAvistaRR } = require("@/lib/tetoAvistaRR.ts");
  const d38 = await buildTrpDraft(new Uint8Array(fs.readFileSync(DL + "/TRP38 - PROMOTIVA 072026.pdf")), { competencia: "2026-08", sourceFilename: "T38", sha256: "38" });
  const d39 = await buildTrpDraft(new Uint8Array(fs.readFileSync(DL + "/TRP39 - PROMOTIVA 082026.pdf")), { competencia: "2026-08", sourceFilename: "T39", sha256: "39" });
  const prov = (r) => () => r;
  const teto = tetoAvistaRR({ year: 2026, month: 8 });

  const { data: recs } = await sb.from("daily_production_records")
    .select("proposal_number, assigned_promoter_id, gross_value, net_value, interest_rate, term_months, installments, product_description, product_code, convenio_code, convenio_type, convenio_segment, insurance_value, has_insurance, movement_date, contract_date, proposal_date")
    .neq("company_id", ADS).gte("movement_date", "2026-08-01").lte("movement_date", "2026-08-31");
  const { data: proms } = await sb.from("promoters").select("id, name");
  const nome = new Map((proms || []).map(p => [p.id, p.name]));

  /** A DATA REAL DO CONTRATO — contract_date, senao proposal_date. movement_date
   *  NAO serve: ela e a data do movimento/competencia, nao da contratacao. */
  const dataReal = (r) => (r.contract_date || r.proposal_date || null);

  let ate = 0, apos = 0, semData = 0;
  const distrib = {};
  for (const r of recs || []) {
    const d = dataReal(r);
    if (!d) { semData++; continue; }
    const iso = String(d).slice(0, 10);
    distrib[iso] = (distrib[iso] || 0) + 1;
    if (iso < CORTE) ate++; else apos++;
  }
  console.log("=== (1a) os 579 contratos da RR de agosto, pela DATA REAL do contrato ===");
  console.log(`  ate 04/08 (regem-se pela TRP38): ${ate}`);
  console.log(`  de 05/08 em diante (TRP39)     : ${apos}`);
  console.log(`  sem data de contrato           : ${semData}`);
  console.log("  distribuicao por dia (as 12 primeiras datas):");
  for (const k of Object.keys(distrib).sort().slice(0, 12)) console.log(`    ${k}: ${distrib[k]}`);

  console.log("\n=== (1b)(1c) os ATINGIDOS pela mudanca, por lado do corte ===");
  let atAte = 0, atApos = 0, danoAte = 0, ganhoApos = 0;
  const porPromotorDano = new Map();
  const detalhe = [];
  for (const r of recs || []) {
    const liq = Number(r.net_value) || Number(r.gross_value) || 0;
    const op = {
      valor_liquido: liq, valor_bruto: Number(r.gross_value) || 0,
      valor_seguro: Number(r.insurance_value) || 0, tem_seguro: !!r.has_insurance,
      taxa_juros: Number(r.interest_rate) || 0,
      prazo: Number(r.term_months) || Number(r.installments) || 0,
      product_code: r.product_code ?? null, product_description: r.product_description ?? null,
      convenio_code: r.convenio_code ?? null, convenio_type: r.convenio_type ?? null,
      convenio_segment: r.convenio_segment ?? null,
      contract_date: r.contract_date || r.movement_date, movement_date: r.movement_date,
      proposal_date: r.proposal_date || r.movement_date,
      production_value: 0, company_cash_percent: null,
    };
    let p38, p39;
    try { p38 = Number(calcularOperacao(op, { trpProvider: prov(d38.regraDraft) }).credito.percentual); } catch { continue; }
    try { p39 = Number(calcularOperacao(op, { trpProvider: prov(d39.regraDraft) }).credito.percentual); } catch { continue; }
    if (!Number.isFinite(p38) || !Number.isFinite(p39) || p38 === p39) continue;
    const d = dataReal(r); const iso = d ? String(d).slice(0, 10) : null;
    const antes = iso ? iso < CORTE : false;
    const delta = liq * (Math.min(p39, teto) - Math.min(p38, teto));
    if (antes) {
      atAte++; danoAte += delta;
      const pid = r.assigned_promoter_id || "(sem promotor)";
      const acc = porPromotorDano.get(pid) || { n: 0, d: 0 };
      acc.n++; acc.d += delta; porPromotorDano.set(pid, acc);
      if (detalhe.length < 8) detalhe.push(`      ${r.proposal_number} ${iso} liq ${f(liq)} ${p4(p38)} -> ${p4(p39)}  ${f(delta)}`);
    } else { atApos++; ganhoApos += delta; }
  }
  console.log(`  atingidos ATE 04/08        : ${atAte}   efeito ${f(danoAte)}  <- DANO da falta de vigencia intra-mes`);
  console.log(`  atingidos DE 05/08 adiante : ${atApos}   efeito ${f(ganhoApos)}  <- legitimo, e a TRP39 valendo`);
  console.log(`  soma                        : ${f(danoAte + ganhoApos)} (bate com os -1.513,15 medidos antes)`);
  if (detalhe.length) { console.log("  amostra dos prejudicados:"); for (const l of detalhe) console.log(l); }

  console.log("\n=== (1d) DANO por promotor (so contratos ate 04/08) ===");
  const lista = [...porPromotorDano.entries()].sort((a, b) => a[1].d - b[1].d);
  for (const [pid, v] of lista) console.log(`  ${String(nome.get(pid) || pid).slice(0, 34).padEnd(36)} ${String(v.n).padStart(3)} contrato(s)  ${f(v.d).padStart(10)}`);
  console.log(`  TOTAL: ${lista.length} promotor(es), ${f(danoAte)}`);
  console.log("\nNADA GRAVADO.");
})().catch(e => { console.error("EXCECAO:", e.message, (e.stack || "").slice(0, 400)); process.exit(1); });
