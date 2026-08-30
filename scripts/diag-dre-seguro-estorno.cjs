/* BLOCO 1 / FASE A — READ-ONLY, nada e escrito.
 *
 * Pergunta: em QUANTAS competencias ha estorno de seguro da ADS, e quanto o DRE
 * infla em cada uma?
 *
 * Mede pelos DOIS lados, cada um pela consulta que o consumidor real faz:
 *   (1) o BRUTO que a TELA do DRE soma  -> lib/dre.ts:338-348, literal:
 *       daily_production_records.bbts_seguro_pago da ADS, competencia resolvida
 *       por movement_date || contract_date || proposal_date (janela).
 *   (2) o ESTORNO que existe no banco -> promoter_debits (resolvido) MAIS
 *       promoter_debit_assignments source_kind='DAILY_CANCEL' (fila, nunca virou
 *       debito). Olhar so promoter_debits perde a fila inteira.
 *   (3) para cada operacao estornada, ONDE o positivo dela entrou no DRE.
 *       Essa e a pergunta que decide a FASE B: subtrair na competencia do PDF
 *       so esta certo se o positivo estiver na MESMA competencia.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

(async () => {
  const { getProductionPeriodFromValue, getProductionPeriodKey } = require("../lib/productionPeriod.ts");
  const { buildDre } = require("../lib/dre.ts");
  const compDe = (r) => {
    const p =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    return p ? getProductionPeriodKey(p.year, p.month) : null;
  };

  // ---------------- (1) o BRUTO, pela consulta literal do dre.ts ----------------
  let from = 0, page = 1000, daily = [];
  for (;;) {
    const { data, error } = await sb
      .from("daily_production_records")
      .select("id, proposal_number, bbts_seguro_pago, movement_date, contract_date, proposal_date")
      .eq("company_id", ADS)
      .range(from, from + page - 1);
    if (error) throw error;
    daily = daily.concat(data);
    if (data.length < page) break;
    from += page;
  }
  const bruto = new Map(), nlin = new Map();
  let negativas = 0, semPeriodo = 0;
  for (const r of daily) {
    const v = Number(r.bbts_seguro_pago) || 0;
    if (v < 0) negativas++;
    if (!v) continue;
    const k = compDe(r);
    if (!k) { semPeriodo++; continue; }
    bruto.set(k, (bruto.get(k) || 0) + v);
    nlin.set(k, (nlin.get(k) || 0) + 1);
  }

  // ---------------- (2) o ESTORNO: debitos resolvidos + fila ----------------
  const { data: deb, error: eD } = await sb
    .from("promoter_debits")
    .select("id, total_amount, start_year, start_month, status")
    .eq("company_id", ADS).eq("debit_type", "CANCELAMENTO_SEGURO");
  if (eD) throw eD;
  const { data: src } = deb.length
    ? await sb.from("promoter_debit_sources").select("debit_id, operation, estorno_amount").in("debit_id", deb.map((d) => d.id))
    : { data: [] };
  const compDoDebito = new Map(deb.map((d) => [d.id, `${d.start_year}-${String(d.start_month).padStart(2, "0")}`]));
  const statusDoDebito = new Map(deb.map((d) => [d.id, d.status]));
  const { data: fila } = await sb
    .from("promoter_debit_assignments")
    .select("year, month, operation, estorno_amount, source_kind, status")
    .eq("debit_type", "CANCELAMENTO_SEGURO");

  const estornos = [];
  for (const s of src || [])
    estornos.push({ comp: compDoDebito.get(s.debit_id), op: String(s.operation), valor: Number(s.estorno_amount) || 0, onde: `promoter_debits/${statusDoDebito.get(s.debit_id)}` });
  for (const a of fila || [])
    if (a.source_kind === "DAILY_CANCEL") // CLOSING_INSURANCE e do RR, nao da ADS
      estornos.push({ comp: `${a.year}-${String(a.month).padStart(2, "0")}`, op: String(a.operation), valor: Number(a.estorno_amount) || 0, onde: `fila/${a.status}` });

  // ---------------- (3) onde vive o POSITIVO de cada operacao estornada ----------------
  const posByOp = new Map();
  for (const r of daily) if (Number(r.bbts_seguro_pago)) posByOp.set(String(r.proposal_number), { v: Number(r.bbts_seguro_pago), comp: compDe(r) });

  const dre = await buildDre(sb);
  const dreKeys = new Set((dre.periods || []).map((p) => p.key));

  console.log("bbts_seguro_pago NEGATIVO em todo o banco (ADS):", negativas, "| com valor e sem competencia:", semPeriodo);
  console.log("linhas daily da ADS:", daily.length, "| com seguro != 0:", [...nlin.values()].reduce((a, b) => a + b, 0));

  const keys = [...new Set([...bruto.keys(), ...estornos.map((e) => e.comp)])].sort();
  console.log("\n== (1)+(2) por competencia ==");
  console.log("comp    | no DRE? | BRUTO na tela | n lin | estorno do PDF | virou debito | ainda na fila");
  for (const k of keys) {
    const es = estornos.filter((e) => e.comp === k);
    const tot = es.reduce((a, b) => a + b.valor, 0);
    const vir = es.filter((e) => e.onde.startsWith("promoter_debits")).reduce((a, b) => a + b.valor, 0);
    console.log(`${k} |   ${dreKeys.has(k) ? "SIM" : "nao"}   | ${f(bruto.get(k) || 0).padStart(13)} | ${String(nlin.get(k) || 0).padStart(5)} | ${f(tot).padStart(14)} | ${f(vir).padStart(12)} | ${f(tot - vir).padStart(13)}`);
  }

  console.log("\n== (3) cada estorno, e onde o DRE contou o positivo dele ==");
  console.log("comp PDF | operacao   | estorno | onde vive             | positivo na daily | comp do POSITIVO");
  for (const e of estornos.sort((a, b) => a.comp.localeCompare(b.comp) || b.valor - a.valor)) {
    const p = posByOp.get(e.op);
    console.log(` ${e.comp} | ${e.op.padEnd(10)} | ${f(e.valor).padStart(7)} | ${e.onde.padEnd(21)} | ${(p ? f(p.v) : "NAO EXISTE").padStart(17)} | ${p ? p.comp : "-"}`);
  }

  const mesmaComp = estornos.filter((e) => posByOp.get(e.op) && posByOp.get(e.op).comp === e.comp);
  const outraComp = estornos.filter((e) => posByOp.get(e.op) && posByOp.get(e.op).comp !== e.comp);
  const semPos = estornos.filter((e) => !posByOp.get(e.op));
  console.log(`\nestorno TOTAL da ADS no banco: R$ ${f(estornos.reduce((a, b) => a + b.valor, 0))} em ${new Set(estornos.map((e) => e.comp)).size} competencia(s)`);
  console.log(`  positivo na MESMA competencia do PDF: ${mesmaComp.length} op, R$ ${f(mesmaComp.reduce((a, b) => a + b.valor, 0))}`);
  console.log(`  positivo em OUTRA competencia:        ${outraComp.length} op, R$ ${f(outraComp.reduce((a, b) => a + b.valor, 0))}`);
  console.log(`  SEM positivo nenhum na daily:         ${semPos.length} op, R$ ${f(semPos.reduce((a, b) => a + b.valor, 0))}`);
  console.log(`\ncompetencias que o DRE oferece: ${[...dreKeys].sort().join(", ")}`);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
