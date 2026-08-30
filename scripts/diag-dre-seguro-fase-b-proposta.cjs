/* BLOCO 1 / FASE B — insumo da PROPOSTA. READ-ONLY, nada e escrito.
 *
 * (A) o que MAIS existe na linha de 89,42 alem do seguro — recarimbar a data
 *     move a linha INTEIRA, nao so o valor de seguro.
 * (B) quem le as tres datas (censo de consumidores).
 * (C) efeito medido, competencia a competencia, pela consulta de cada TELA:
 *     DRE (lib/dre.ts) e card Recebido (lib/financialAnalytics.ts).
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const ALVO = "5240028e-464b-428a-870d-86576c31dfc6";
const L = (c) => c.repeat(96);

(async () => {
  const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");

  // ---------------- (A) a linha inteira ----------------
  console.log(L("="));
  console.log("(A) O QUE MAIS EXISTE NA LINHA DE 89,42 — recarimbar move a linha INTEIRA");
  console.log(L("="));
  const { data: alvo } = await sb.from("daily_production_records").select("*").eq("id", ALVO);
  const r = alvo[0];
  const interessantes = [
    "proposal_number", "status", "product_description", "gross_value", "net_value",
    "insurance_value", "insurance_net_value", "has_insurance", "bbts_pag_avista",
    "bbts_seguro_pago", "assigned_promoter_id", "j_key", "term_months", "interest_rate",
    "movement_date", "contract_date", "proposal_date", "is_srcc_restricted",
    "promoter_commission_amount", "insurance_commission_amount",
  ];
  for (const k of interessantes) if (k in r) console.log(`  ${k.padEnd(28)} ${JSON.stringify(r[k])}`);
  const jan = (() => {
    const p = getProductionPeriodFromValue(r.movement_date) || getProductionPeriodFromValue(r.contract_date) || getProductionPeriodFromValue(r.proposal_date);
    return p ? getProductionPeriodKey(p.year, p.month) : null;
  })();
  console.log(`\n  competencia HOJE (janela): ${jan}`);
  console.log("  => a linha carrega PRODUCAO DE CREDITO, nao so o seguro. Mexer na data");
  console.log("     move tambem gross_value/insurance_value/contagem de proposta.");

  // ---------------- (C) efeito, pela consulta de cada TELA ----------------
  console.log("\n" + L("="));
  console.log("(C) EFEITO POR COMPETENCIA, pela consulta que CADA TELA faz");
  console.log(L("="));

  // -- DRE: receita da ADS, replicando dre.ts:330-380 --
  let daily = [], from = 0;
  for (;;) {
    const { data } = await sb.from("daily_production_records")
      .select("id, bbts_pag_avista, bbts_seguro_pago, movement_date, contract_date, proposal_date, gross_value, insurance_value")
      .eq("company_id", ADS).range(from, from + 999);
    daily = daily.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const compDe = (x) => {
    const p = getProductionPeriodFromValue(x.movement_date) || getProductionPeriodFromValue(x.contract_date) || getProductionPeriodFromValue(x.proposal_date);
    return p ? getProductionPeriodKey(p.year, p.month) : null;
  };
  // competencia do PDF: carimbo dia-15; para a linha alvo, o PDF que trouxe o
  // valor e o de JULHO (ancora seguro_calculo 204,52 = 115,10 + 89,42).
  const compPdfDe = (x) => {
    const d = String(x.movement_date || "").slice(0, 10);
    if (/^\d{4}-\d{2}-15$/.test(d)) return d.slice(0, 7);
    if (x.id === ALVO) return "2026-07"; // o PDF de julho declarou os 89,42
    return null;
  };

  const { data: prt } = await sb.from("bbts_prt_parcelas").select("competencia, valor_parcela").eq("company_id", ADS);
  const { data: cab } = await sb.from("bbts_fechamento_totais").select("competencia, abertura_conta").eq("company_id", ADS);
  const prtPor = new Map(), abePor = new Map();
  for (const p of prt || []) prtPor.set(String(p.competencia).slice(0, 7), (prtPor.get(String(p.competencia).slice(0, 7)) || 0) + (Number(p.valor_parcela) || 0));
  for (const c of cab || []) abePor.set(String(c.competencia).slice(0, 7), (abePor.get(String(c.competencia).slice(0, 7)) || 0) + (Number(c.abertura_conta) || 0));

  // estorno por competencia do PDF (promoter_debits + fila DAILY_CANCEL)
  const { data: deb } = await sb.from("promoter_debits").select("id, start_year, start_month").eq("company_id", ADS).eq("debit_type", "CANCELAMENTO_SEGURO");
  const { data: src } = await sb.from("promoter_debit_sources").select("debit_id, estorno_amount").in("debit_id", (deb || []).map((d) => d.id));
  const compDeb = new Map((deb || []).map((d) => [d.id, `${d.start_year}-${String(d.start_month).padStart(2, "0")}`]));
  const { data: fila } = await sb.from("promoter_debit_assignments").select("year, month, estorno_amount, source_kind").eq("debit_type", "CANCELAMENTO_SEGURO");
  const estPor = new Map();
  for (const s of src || []) { const k = compDeb.get(s.debit_id); estPor.set(k, (estPor.get(k) || 0) + (Number(s.estorno_amount) || 0)); }
  for (const a of fila || []) if (a.source_kind === "DAILY_CANCEL") { const k = `${a.year}-${String(a.month).padStart(2, "0")}`; estPor.set(k, (estPor.get(k) || 0) + (Number(a.estorno_amount) || 0)); }

  const comps = ["2026-06", "2026-07", "2026-08"];
  const agg = (chave) => {
    const avt = new Map(), seg = new Map();
    for (const x of daily) {
      const k = chave(x);
      if (!k) continue;
      avt.set(k, (avt.get(k) || 0) + (Number(x.bbts_pag_avista) || 0));
      seg.set(k, (seg.get(k) || 0) + (Number(x.bbts_seguro_pago) || 0));
    }
    return { avt, seg };
  };
  const hoje = agg(compDe), depois = agg(compPdfDe);

  console.log("\nRECEITA DA ADS no DRE (dre.ts:338-360) — AVT + PRT + SEGURO + Abertura");
  console.log("comp    | AVT       | PRT  | SEGURO hoje | SEGURO depois | Abert | RECEITA hoje | RECEITA depois | delta");
  for (const k of comps) {
    const avt = hoje.avt.get(k) || 0, p = prtPor.get(k) || 0, ab = abePor.get(k) || 0;
    const sH = hoje.seg.get(k) || 0, sD = depois.seg.get(k) || 0;
    const rH = avt + p + sH + ab, rD = avt + p + sD + ab;
    console.log(`${k} | ${f(avt).padStart(9)} | ${f(p).padStart(4)} | ${f(sH).padStart(11)} | ${f(sD).padStart(13)} | ${f(ab).padStart(5)} | ${f(rH).padStart(12)} | ${f(rD).padStart(14)} | ${f(rD - rH).padStart(7)}`);
  }

  console.log("\nCONFERENCIA contra o DEPOSITO (a regra do Diego: bruto - estorno = caixa)");
  console.log("comp    | SEGURO bruto depois | estorno do PDF | liquido | ancora do PDF");
  const ancora = { "2026-06": null, "2026-07": 155.07, "2026-08": null };
  for (const k of comps) {
    const sD = depois.seg.get(k) || 0, e = estPor.get(k) || 0;
    console.log(`${k} | ${f(sD).padStart(19)} | ${f(e).padStart(14)} | ${f(sD - e).padStart(7)} | ${ancora[k] != null ? f(ancora[k]) : "(nao medida)"}`);
  }

  // -- card Recebido: pela consulta do financialAnalytics --
  console.log("\n" + L("-"));
  console.log("CARD RECEBIDO (financialAnalytics.ts:925 le as MESMAS 3 datas)");
  console.log(L("-"));
  const fs = require("fs");
  const fa = fs.readFileSync("lib/financialAnalytics.ts", "utf8");
  const trecho = fa.split("\n").slice(920, 935).join("\n");
  console.log(trecho);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
