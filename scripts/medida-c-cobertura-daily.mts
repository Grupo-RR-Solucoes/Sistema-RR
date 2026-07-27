// ============================================================================
// MEDIDA C (addendum) — o daily de junho cobre o mes inteiro?
//
// A MEDIDA C deu +100,4% no recorte, contra -8,6% de mes cheio. Salto grande
// demais para ser desempenho. Esta sonda testa a hipotese obvia: o daily de
// junho esta RALO, e o recorte 1-24 de junho nao e "junho ate o dia 24", e sim
// "o pedaco de junho que sobrou no daily".
//
// Somente leitura. npx tsx scripts/medida-c-cobertura-daily.mts
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const arquivo of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), arquivo);
  if (!fs.existsSync(p)) continue;
  for (const linha of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.TRP_SOURCE = "db";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: unknown) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

async function paginar(tabela: string, colunas: string, aplicar: (q: any) => any) {
  const passo = 1000;
  let de = 0;
  const saida: any[] = [];
  for (;;) {
    const { data, error } = await aplicar(supabase.from(tabela).select(colunas)).range(
      de,
      de + passo - 1
    );
    if (error) throw new Error(error.message);
    saida.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return saida;
}

const daily = await paginar(
  "daily_production_records",
  "company_id, status, is_srcc_restricted, net_value, movement_date, cancellation_date",
  (q) => q.gte("movement_date", "2026-03-15").lt("movement_date", "2026-08-15")
);

const emProducao = (s: unknown) => norm(s) === "PRODUCAO" || norm(s) === "PRODUCTION";

console.log("=".repeat(78));
console.log("COBERTURA DO DAILY — linhas em Producao por mes-calendario de movement_date");
console.log("=".repeat(78));

type Mes = { linhas: number; net: number; dias: Set<number> };
const porMes = new Map<string, Mes>();
for (const r of daily) {
  if (!emProducao(r.status) || r.is_srcc_restricted === true) continue;
  const mes = String(r.movement_date).slice(0, 7);
  if (!porMes.has(mes)) porMes.set(mes, { linhas: 0, net: 0, dias: new Set() });
  const m = porMes.get(mes)!;
  m.linhas += 1;
  m.net += num(r.net_value);
  m.dias.add(Number(String(r.movement_date).slice(8, 10)));
}

console.log("\nmes      linhas        net (R$)   dias distintos   faixa de dias");
for (const mes of [...porMes.keys()].sort()) {
  const m = porMes.get(mes)!;
  const dias = [...m.dias].sort((a, b) => a - b);
  console.log(
    `${mes}  ${String(m.linhas).padStart(6)}  ${brl(m.net).padStart(14)}   ${String(dias.length).padStart(6)}` +
      `           ${dias.length ? `${dias[0]}..${dias[dias.length - 1]}` : "-"}`
  );
}

// Junho, dia a dia — mostra se ha buraco no meio ou corte no comeco.
console.log("\n" + "-".repeat(78));
console.log("JUNHO/2026 dia a dia (Producao, nao-SRCC)");
console.log("-".repeat(78));
const junho = new Map<number, { linhas: number; net: number }>();
for (const r of daily) {
  if (!emProducao(r.status) || r.is_srcc_restricted === true) continue;
  if (!String(r.movement_date).startsWith("2026-06-")) continue;
  const d = Number(String(r.movement_date).slice(8, 10));
  if (!junho.has(d)) junho.set(d, { linhas: 0, net: 0 });
  const x = junho.get(d)!;
  x.linhas += 1;
  x.net += num(r.net_value);
}
for (let d = 1; d <= 30; d += 1) {
  const x = junho.get(d);
  console.log(
    `  ${String(d).padStart(2)}  ${x ? String(x.linhas).padStart(4) : "   -"}  ${x ? brl(x.net).padStart(14) : "".padStart(14)}`
  );
}

// PMR de junho — o que o mes fechado diz que junho produziu.
const pmr = await paginar(
  "promoter_monthly_results",
  "year, month, production_value, final_commission_value",
  (q) => q.eq("year", 2026).in("month", [4, 5, 6, 7])
);
console.log("\n" + "-".repeat(78));
console.log("PMR (ledger do mes fechado) x daily");
console.log("-".repeat(78));
console.log("mes     PMR producao      daily producao   cobertura do daily");
for (const m of [4, 5, 6, 7]) {
  const p = pmr.filter((r) => r.month === m).reduce((s, r) => s + num(r.production_value), 0);
  const chave = `2026-${String(m).padStart(2, "0")}`;
  const d = porMes.get(chave)?.net ?? 0;
  console.log(
    `${chave}  ${brl(p).padStart(15)}  ${brl(d).padStart(16)}   ${p > 0 ? `${((d / p) * 100).toFixed(1)}%` : "—"}`
  );
}
