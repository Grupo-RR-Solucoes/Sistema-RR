/*
 * CONFERÊNCIA (read-back autoritativo do banco) dos 10 débitos MANUAIS jun/26.
 *   - promoter_debits kind='MANUAL' (10)
 *   - cronograma das parcelas por competência (jun, jul, ago...) com status
 *   - Σ das parcelas PENDING de junho (esperado 2.168,84)
 *   - AUTO de junho + fila pendente + líquido resultante
 */
require("./_ts_register.cjs"); // carrega .env.local > .env (precedência corrigida)
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BRL = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const comp = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
const BRUTO = 118227.41;

async function main() {
  const { data: comps } = await sb.from("companies").select("id, name");
  const companyById = new Map((comps || []).map((c) => [c.id, c]));
  const { data: proms } = await sb.from("promoters").select("id, name");
  const promById = new Map((proms || []).map((p) => [p.id, p]));

  // 1) os 10 débitos MANUAL
  const { data: debits } = await sb
    .from("promoter_debits")
    .select("id, promoter_id, company_id, debit_type, total_amount, installments_total, status, start_year, start_month, created_at")
    .eq("kind", "MANUAL")
    .order("created_at", { ascending: true });
  const manual = (debits || []).filter((d) => d.start_year === 2026); // seed de 2026

  console.log(`\n=== 1) promoter_debits kind='MANUAL' (${manual.length}) ===\n`);
  console.log("promotor".padEnd(34), "tipo".padEnd(22), "total".padStart(10), " Nx", " empresa");
  let totalPlanos = 0;
  for (const d of manual) {
    totalPlanos = round2(totalPlanos + Number(d.total_amount));
    console.log(
      (promById.get(d.promoter_id)?.name || d.promoter_id).slice(0, 33).padEnd(34),
      d.debit_type.padEnd(22),
      BRL(d.total_amount).padStart(10),
      String(d.installments_total).padStart(2) + "x",
      companyById.get(d.company_id)?.name || "-"
    );
  }
  console.log("─".repeat(80));
  console.log(`Σ total dos 10 planos = R$ ${BRL(totalPlanos)}  (installments_total soma ${manual.reduce((a, d) => a + d.installments_total, 0)} parcelas)`);

  // 2) cronograma das parcelas por competência (só das MANUAL do seed)
  const ids = manual.map((d) => d.id);
  const { data: parc } = await sb
    .from("promoter_discounts")
    .select("debit_id, year, month, amount, status, installment_number")
    .in("debit_id", ids);
  const byComp = new Map();
  for (const p of parc || []) {
    const k = comp(p.year, p.month);
    if (!byComp.has(k)) byComp.set(k, { pend: 0, pendN: 0, appl: 0, applN: 0 });
    const b = byComp.get(k);
    if (p.status === "PENDING") { b.pend = round2(b.pend + Number(p.amount)); b.pendN++; }
    else if (p.status === "APPLIED") { b.appl = round2(b.appl + Number(p.amount)); b.applN++; }
  }
  console.log(`\n=== 2) cronograma das parcelas por competência (${(parc || []).length} parcelas) ===\n`);
  console.log("comp".padEnd(9), "PENDING".padStart(12), "n".padStart(3), "  APPLIED".padStart(12), "n".padStart(3));
  let totPend = 0, totAppl = 0;
  for (const k of [...byComp.keys()].sort()) {
    const b = byComp.get(k);
    totPend = round2(totPend + b.pend); totAppl = round2(totAppl + b.appl);
    console.log(k.padEnd(9), BRL(b.pend).padStart(12), String(b.pendN).padStart(3), BRL(b.appl).padStart(12), String(b.applN).padStart(3),
      k === "2026-06" ? "  ← JUNHO (desce no fechamento)" : (b.applN ? "  (histórico, já descontado)" : "  (futura)"));
  }
  console.log("─".repeat(60));
  console.log(`Σ PENDING (todas) = R$ ${BRL(totPend)}   Σ APPLIED (histórico) = R$ ${BRL(totAppl)}   Σ geral = R$ ${BRL(round2(totPend + totAppl))}`);

  // 3) Σ das parcelas PENDING de JUNHO (autoritativo, todas as MANUAL)
  const junPend = round2((parc || []).filter((p) => p.year === 2026 && p.month === 6 && p.status === "PENDING").reduce((a, p) => a + Number(p.amount), 0));
  console.log(`\n=== 3) Σ parcelas PENDING de JUNHO/2026 (MANUAL) = R$ ${BRL(junPend)} ${round2(junPend) === 2168.84 ? "✅" : "❌ (esperado 2.168,84)"} ===`);

  // 4) AUTO de junho + fila pendente + líquido
  const { data: autoDeb } = await sb
    .from("promoter_debits")
    .select("id, total_amount")
    .eq("kind", "AUTO")
    .eq("start_year", 2026)
    .eq("start_month", 6);
  const autoJun = round2((autoDeb || []).reduce((a, d) => a + Number(d.total_amount), 0));

  const { data: fila } = await sb
    .from("promoter_debit_assignments")
    .select("source_kind, estorno_amount, status")
    .eq("year", 2026).eq("month", 6).eq("status", "PENDING");
  const filaTot = round2((fila || []).reduce((a, r) => a + Number(r.estorno_amount), 0));
  const filaByKind = {};
  for (const r of fila || []) filaByKind[r.source_kind] = round2((filaByKind[r.source_kind] || 0) + Number(r.estorno_amount));

  const liquidoPreFila = round2(BRUTO - autoJun - junPend);
  const liquidoFinal = round2(liquidoPreFila - filaTot);

  console.log(`\n=== 4) reconciliação / líquido resultante ===\n`);
  console.log(`  BRUTO                       ${BRL(BRUTO).padStart(12)}`);
  console.log(`  − AUTO (${(autoDeb || []).length} débitos jun)     ${("−" + BRL(autoJun)).padStart(12)}`);
  console.log(`  − MANUAIS (10, PENDING jun) ${("−" + BRL(junPend)).padStart(12)}`);
  console.log(`  ${"─".repeat(38)}`);
  console.log(`  = LÍQUIDO (pré-fila)        ${BRL(liquidoPreFila).padStart(12)}`);
  console.log(`  − fila pendente             ${("−" + BRL(filaTot)).padStart(12)}   (${Object.entries(filaByKind).map(([k, v]) => `${k}=${BRL(v)}`).join(" + ") || "vazia"})`);
  console.log(`  ${"─".repeat(38)}`);
  console.log(`  = LÍQUIDO FINAL             ${BRL(liquidoFinal).padStart(12)}`);
}
main().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
