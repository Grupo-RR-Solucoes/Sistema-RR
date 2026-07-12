#!/usr/bin/env node
/**
 * scripts/debitos_snapshot.cjs — SNAPSHOT read-only dos débitos de uma competência.
 *
 * Serve de LINHA DE BASE para provar que plugar o tipo A no fechamento RR não mexe
 * em junho (SUM_100, lançado à mão). Não grava nada.
 *
 * Uso: node scripts/debitos_snapshot.cjs [ano] [mes]   (default 2026 6)
 */
const fs = require("fs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const year = Number(process.argv[2] || 2026);
const month = Number(process.argv[3] || 6);
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

(async () => {
  const { data: debits, error } = await sb
    .from("promoter_debits")
    .select("id, promoter_id, company_id, kind, debit_type, total_amount, installments_total, start_year, start_month, status, notes")
    .eq("start_year", year)
    .eq("start_month", month)
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: discounts } = await sb
    .from("promoter_discounts")
    .select("id, promoter_id, year, month, discount_type, amount, installment_number, installments, status, debit_id")
    .eq("year", year)
    .eq("month", month)
    .order("id", { ascending: true });

  const { data: fila } = await sb
    .from("promoter_debit_assignments")
    .select("operation, status, estorno_amount, promoter_id")
    .eq("year", year)
    .eq("month", month)
    .order("operation", { ascending: true });

  const porKind = {};
  for (const d of debits ?? []) {
    const k = `${d.kind} / ${d.debit_type}`;
    porKind[k] = porKind[k] || { n: 0, soma: 0 };
    porKind[k].n++;
    porKind[k].soma += Number(d.total_amount ?? 0);
  }

  console.log(`\n=== SNAPSHOT débitos ${year}-${String(month).padStart(2, "0")} (read-only) ===`);
  console.log(`promoter_debits: ${(debits ?? []).length}`);
  for (const [k, v] of Object.entries(porKind)) console.log(`   ${k}: ${v.n} debito(s), soma ${v.soma.toFixed(2)}`);
  console.log(`promoter_discounts: ${(discounts ?? []).length} parcela(s), soma ${(discounts ?? []).reduce((s, d) => s + Number(d.amount ?? 0), 0).toFixed(2)}`);
  const filaPorStatus = {};
  for (const f of fila ?? []) filaPorStatus[f.status] = (filaPorStatus[f.status] ?? 0) + 1;
  console.log(`promoter_debit_assignments (fila): ${(fila ?? []).length} ${JSON.stringify(filaPorStatus)}`);

  // hash estável do conteúdo — muda se QUALQUER campo dos débitos/parcelas mudar.
  const canon = JSON.stringify({ debits, discounts, fila });
  const hash = crypto.createHash("sha256").update(canon).digest("hex");
  console.log(`\nHASH do estado (debits+discounts+fila): ${hash}`);
  console.log("(rode de novo depois de qualquer import: hash igual = nada foi tocado)\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
