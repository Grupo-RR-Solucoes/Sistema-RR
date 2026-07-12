/*
 * SEED — 10 débitos MANUAIS de JUNHO/2026 (dry-run por padrão).
 *
 * Modelo (migration 20260709_000001): promoter_debits = o PLANO;
 * promoter_discounts = as PARCELAS (1 linha = 1 competência), com status/applied_at.
 *
 * Regras deste seed:
 *   - kind='MANUAL', status(plano)='ACTIVE'.
 *   - Gera TODAS as parcelas (start_month..start_month+N-1), base=round2(total/N),
 *     ajuste de centavos na ÚLTIMA (total − Σ anteriores).
 *   - Parcela com competência < 2026-06  -> status='APPLIED', applied_at=fim do mês.
 *   - Parcela com competência = 2026-06   -> status='PENDING'.
 *   - Parcela com competência > 2026-06   -> status='PENDING' (futura).
 *   - company_id = empresa da linha DOMINANTE do PMR (promoter_monthly_results
 *     2026-06, MAIOR production_value) do promotor — a "dona" determinística.
 *
 * DRY-RUN por padrão (não grava). Para gravar: node scripts/seed_debitos_junho.cjs --apply
 * (o --apply só grava se a Σ das parcelas de junho bater com EXPECTED_JUNE_SUM).
 */
require("./_ts_register.cjs"); // carrega .env.local > .env (precedência corrigida)
const { createClient } = require("@supabase/supabase-js");

const APPLY = process.argv.includes("--apply");
const YEAR = 2026;
const JUNE = 6;
const JUNE_ORD = YEAR * 12 + JUNE; // ordinal p/ comparar competências
const EXPECTED_JUNE_SUM = 2168.84; // corrigido: Σ das 10 linhas (o 2.158,84 do chamado era erro de soma)
const CREATED_BY = "seed_debitos_junho.cjs (Diego)";

// ---- as 10 débitos MANUAIS (total/N/início; parcelas derivadas) ----
// stated_june = valor da parcela de JUNHO informado no chamado (cross-check).
const DEBITS = [
  { promoter: "Thaynara",         type: "ADIANTAMENTO",          total: 2520.00, n: 9, sy: 2026, sm: 4, stated_june: 280.00 },
  { promoter: "Eduarda Manoela",  type: "ADIANTAMENTO",          total: 1107.54, n: 6, sy: 2026, sm: 3, stated_june: 184.59 },
  { promoter: "Luciana Matias",   type: "ADIANTAMENTO",          total:  700.00, n: 1, sy: 2026, sm: 6, stated_june: 700.00 },
  { promoter: "Severina Cesario", type: "LIQUIDACAO_ANTECIPADA", total:  666.00, n: 3, sy: 2026, sm: 5, stated_june: 222.00 },
  { promoter: "Rute Markene",     type: "ADIANTAMENTO",          total:  318.28, n: 1, sy: 2026, sm: 6, stated_june: 318.28 },
  { promoter: "Rute Markene",     type: "LIQUIDACAO_ANTECIPADA", total:  248.00, n: 1, sy: 2026, sm: 6, stated_june: 248.00 },
  { promoter: "Eduarda Manoela",  type: "PASSAGEM",              total:  200.00, n: 4, sy: 2026, sm: 6, stated_june:  50.00 },
  { promoter: "Maria de Fatima",  type: "ADIANTAMENTO",          total:   95.76, n: 1, sy: 2026, sm: 6, stated_june:  95.76 },
  { promoter: "Camila Gomes",     type: "CERTIFICACAO",          total:   68.00, n: 1, sy: 2026, sm: 6, stated_june:  68.00 },
  { promoter: "Erivan Vital",     type: "LIQUIDACAO_ANTECIPADA", total:    2.21, n: 1, sy: 2026, sm: 6, stated_june:   2.21 },
];

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const BRL = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compStr = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
function endOfMonthISO(y, m) { return new Date(Date.UTC(y, m, 0, 23, 59, 59)).toISOString(); }

function buildSchedule(d) {
  const n = Math.max(1, Math.floor(d.n || 1));
  const total = round2(d.total);
  const base = round2(total / n);
  const rows = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    let m = d.sm + i, y = d.sy;
    while (m > 12) { m -= 12; y += 1; }
    const amount = i === n - 1 ? round2(total - acc) : base;
    acc = round2(acc + base);
    const ord = y * 12 + m;
    const status = ord < JUNE_ORD ? "APPLIED" : "PENDING";
    rows.push({
      installment_number: i + 1,
      year: y, month: m,
      amount,
      status,
      applied_at: status === "APPLIED" ? endOfMonthISO(y, m) : null,
    });
  }
  return { n, total, rows };
}

async function resolvePromoter(allProms, name) {
  const tokens = norm(name).split(/\s+/).filter(Boolean);
  const hits = allProms.filter((p) => {
    const pn = norm(p.name);
    return tokens.every((t) => pn.includes(t));
  });
  return hits;
}

async function resolveDonaCompany(promoterId, companyById) {
  const { data, error } = await sb
    .from("promoter_monthly_results")
    .select("company_id, production_value")
    .eq("promoter_id", promoterId)
    .eq("year", YEAR)
    .eq("month", JUNE);
  if (error) throw error;
  const rows = (data || []).filter((r) => r.company_id);
  if (rows.length === 0) return { companyId: null, via: "SEM linha PMR jun/26", rows: [] };
  rows.sort((a, b) => Number(b.production_value) - Number(a.production_value));
  const top = rows[0];
  return {
    companyId: top.company_id,
    via: `PMR jun/26 dominante (prod ${BRL(top.production_value)})`,
    rows: rows.map((r) => ({ c: companyById.get(r.company_id)?.name || r.company_id, prod: Number(r.production_value) })),
  };
}

async function main() {
  console.log(`\n=== SEED DÉBITOS MANUAIS jun/${YEAR} — ${APPLY ? "APLICAR (grava)" : "DRY-RUN (não grava)"} ===\n`);

  const { data: proms, error: eP } = await sb
    .from("promoters")
    .select("id, name, company_id, active, status");
  if (eP) throw eP;
  const { data: comps, error: eC } = await sb.from("companies").select("id, name, cnpj");
  if (eC) throw eC;
  const companyById = new Map((comps || []).map((c) => [c.id, c]));

  const resolved = [];
  let anyProblem = false;

  for (const d of DEBITS) {
    const hits = await resolvePromoter(proms, d.promoter);
    let problem = null, promoter = null, dona = null;
    if (hits.length === 0) { problem = "NENHUM promotor casado"; anyProblem = true; }
    else if (hits.length > 1) { problem = `AMBÍGUO (${hits.length}): ${hits.map((h) => h.name).join(" | ")}`; anyProblem = true; }
    else {
      promoter = hits[0];
      dona = await resolveDonaCompany(promoter.id, companyById);
      if (!dona.companyId) { problem = `sem company_id (${dona.via})`; anyProblem = true; }
    }
    const sched = buildSchedule(d);
    const juneRow = sched.rows.find((r) => r.year === YEAR && r.month === JUNE);
    resolved.push({ d, promoter, dona, sched, juneRow, problem });
  }

  // ---- impressão detalhada ----
  let sumJune = 0;
  let sumStatedJune = 0;
  const mismatches = [];
  resolved.forEach((r, idx) => {
    const { d, promoter, dona, sched, juneRow, problem } = r;
    console.log(`── (${idx + 1}/10) ${d.promoter} — ${d.type} — total R$ ${BRL(d.total)} em ${d.n}x (início ${compStr(d.sy, d.sm)})`);
    if (problem) console.log(`   ⚠️  ${problem}`);
    if (promoter) console.log(`   promotor: ${promoter.name}  [${promoter.id}]  (home ${companyById.get(promoter.company_id)?.name || "-"})`);
    if (dona) console.log(`   company_id (dona): ${dona.companyId ? (companyById.get(dona.companyId)?.name + " [" + dona.companyId + "]") : "—"}  via ${dona.via}`);
    if (dona && dona.rows.length > 1) console.log(`   linhas PMR jun: ${dona.rows.map((x) => `${x.c}=${BRL(x.prod)}`).join(" | ")}`);
    console.log(`   cronograma:`);
    for (const p of sched.rows) {
      const tag = p.status === "APPLIED" ? "APPLIED (histórico)" : (p.year === YEAR && p.month === JUNE ? "PENDING ← JUNHO" : "PENDING (futura)");
      console.log(`      ${String(p.installment_number).padStart(2)}/${sched.n}  ${compStr(p.year, p.month)}  R$ ${BRL(p.amount).padStart(9)}  ${tag}${p.applied_at ? "  applied_at=" + p.applied_at.slice(0, 10) : ""}`);
    }
    const jv = juneRow ? juneRow.amount : 0;
    sumJune += jv;
    sumStatedJune += d.stated_june;
    if (round2(jv) !== round2(d.stated_june)) {
      mismatches.push(`   ${d.promoter}/${d.type}: derivada jun=${BRL(jv)} vs informada=${BRL(d.stated_june)}`);
    }
    // sanidade: Σ parcelas == total
    const sTot = round2(sched.rows.reduce((a, p) => a + p.amount, 0));
    if (sTot !== round2(d.total)) console.log(`   ⚠️  Σ parcelas ${BRL(sTot)} ≠ total ${BRL(d.total)}`);
    console.log("");
  });

  sumJune = round2(sumJune);
  sumStatedJune = round2(sumStatedJune);

  console.log("──────────────────────────────────────────────────────────────");
  console.log(`Σ parcelas de JUNHO (derivadas)  = R$ ${BRL(sumJune)}`);
  console.log(`Σ parcelas de JUNHO (informadas) = R$ ${BRL(sumStatedJune)}`);
  console.log(`Σ ESPERADA (chamado)             = R$ ${BRL(EXPECTED_JUNE_SUM)}`);
  if (mismatches.length) {
    console.log(`\n⚠️  parcela de junho derivada ≠ informada:`);
    mismatches.forEach((m) => console.log(m));
  }
  const okSum = round2(sumJune) === round2(EXPECTED_JUNE_SUM);
  console.log(`\n${okSum ? "✅" : "❌"} Σ junho ${okSum ? "confere" : "NÃO confere"} com ${BRL(EXPECTED_JUNE_SUM)} (Δ = R$ ${BRL(round2(sumJune - EXPECTED_JUNE_SUM))})`);

  if (!APPLY) {
    console.log(`\n(DRY-RUN — nada gravado.)`);
    return;
  }
  if (anyProblem) { console.log(`\n❌ ABORT: há promotor/empresa não resolvido. Corrija antes de gravar.`); process.exit(1); }
  if (!okSum) { console.log(`\n❌ ABORT: Σ junho não confere com ${BRL(EXPECTED_JUNE_SUM)}. Reconcilie antes de gravar.`); process.exit(1); }

  // ---- GUARDA de idempotência: aborta se já existe débito MANUAL para algum
  //      (promoter_id, debit_type, start_year, start_month) que vamos inserir. ----
  const wantKeys = new Set(resolved.map((r) => `${r.promoter.id}|${r.d.type}|${r.d.sy}|${r.d.sm}`));
  const promoterIds = [...new Set(resolved.map((r) => r.promoter.id))];
  const { data: existing, error: eX } = await sb
    .from("promoter_debits")
    .select("promoter_id, debit_type, start_year, start_month")
    .eq("kind", "MANUAL")
    .in("promoter_id", promoterIds);
  if (eX) throw eX;
  const dup = (existing || []).filter((e) => wantKeys.has(`${e.promoter_id}|${e.debit_type}|${e.start_year}|${e.start_month}`));
  if (dup.length) {
    console.log(`\n❌ ABORT: já existem ${dup.length} débito(s) MANUAL com a mesma chave (rodada anterior?). Nada gravado.`);
    process.exit(1);
  }

  // ---- GRAVAÇÃO ----
  console.log(`\n=== GRAVANDO ===`);
  for (const r of resolved) {
    const { d, promoter, dona, sched } = r;
    const { data: ins, error: e1 } = await sb.from("promoter_debits").insert({
      promoter_id: promoter.id,
      company_id: dona.companyId,
      kind: "MANUAL",
      debit_type: d.type,
      total_amount: sched.total,
      installments_total: sched.n,
      start_year: d.sy,
      start_month: d.sm,
      status: "ACTIVE",
      notes: `Seed jun/26 — ${d.type} ${d.n}x.`,
      created_by: CREATED_BY,
    }).select("id").single();
    if (e1) throw e1;
    const debitId = ins.id;
    const rows = sched.rows.map((p) => ({
      promoter_id: promoter.id,
      company_id: dona.companyId,
      year: p.year,
      month: p.month,
      discount_type: d.type,
      amount: p.amount,
      installments: sched.n,
      installment_number: p.installment_number,
      apply_to_company: false,
      debit_id: debitId,
      status: p.status,
      applied_at: p.applied_at,
      notes: `Seed jun/26 — ${d.type} ${p.installment_number}/${sched.n}.`,
    }));
    const { error: e2 } = await sb.from("promoter_discounts").insert(rows);
    if (e2) throw e2;
    console.log(`   ✓ ${d.promoter}/${d.type}: débito ${debitId} + ${rows.length} parcela(s).`);
  }
  console.log(`\n✅ GRAVADO: ${resolved.length} débitos.`);
}

main().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
