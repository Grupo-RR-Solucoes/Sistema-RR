// Diagnostico: qual o alcance da ambiguidade de escala em
// company_received_percent quando o valor e < 1? Somente leitura.
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
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const passo = 1000;
let de = 0;
const linhas: any[] = [];
for (;;) {
  const { data, error } = await supabase
    .from("daily_production_records")
    .select("id, company_received_percent, net_value, movement_date, status, is_srcc_restricted")
    .gte("movement_date", "2026-01-01")
    .lt("movement_date", "2027-01-01")
    .eq("status", "Produção")
    .range(de, de + passo - 1);
  if (error) throw new Error(error.message);
  linhas.push(...(data || []));
  if (!data || data.length < passo) break;
  de += passo;
}

console.log("=".repeat(80));
console.log("AMBIGUIDADE DE ESCALA em company_received_percent");
console.log("=".repeat(80));
console.log(
  "\ngetAVistaPercent (tela):        num <= 1 ? num*100 : num   -> 0,95 vira 95%"
);
console.log(
  "toPercentUnits (calculate):     num <= 1 ? num*100 : num   -> 0,95 vira 95%"
);
console.log(
  "toPercentRate (promoterAnalyt): num  > 1 ? num/100 : num   -> 0,95 vira 95% (fracao)"
);
console.log(
  "\nOs TRES leem 0,95 como 95%. A diferenca e o que cada um faz depois:"
);
console.log("  tela        -> capAvistaRRPercent clampa em 5,80%  (usa 5,80%)");
console.log("  calculate   -> guarda `<= 6.5` REJEITA 95 e cai no derive");
console.log("  motor       -> guarda `<= 0.065` REJEITA e cai no derive");

const porFaixa = new Map<string, { n: number; net: number }>();
for (const r of linhas) {
  const v = r.company_received_percent;
  if (v === null || v === undefined) continue;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) continue;
  const faixa =
    n < 1 ? "0 < v < 1   (AMBIGUO)" : n <= 6.5 ? "1 <= v <= 6,5 (ok)" : "v > 6,5 (implausivel)";
  const cur = porFaixa.get(faixa) || { n: 0, net: 0 };
  cur.n += 1;
  cur.net += Number(r.net_value) || 0;
  porFaixa.set(faixa, cur);
}

console.log("\n" + "-".repeat(80));
console.log("DISTRIBUICAO (2026, status Producao)");
console.log("-".repeat(80));
for (const [faixa, v] of [...porFaixa.entries()].sort()) {
  console.log(`  ${faixa.padEnd(24)} ${String(v.n).padStart(5)} linhas · R$ ${brl(v.net)} financiados`);
}

const ambiguas = linhas.filter((r) => {
  const n = Number(r.company_received_percent);
  return Number.isFinite(n) && n > 0 && n < 1;
});
const valores = [...new Set(ambiguas.map((r) => Number(r.company_received_percent)))].sort(
  (a, b) => a - b
);
console.log(`\n  valores distintos na faixa ambigua: ${valores.join(", ")}`);
console.log(
  `\n  Se forem PERCENTUAIS (0,95 = 0,95%), a tela mostra ~6x a mais nessas ${ambiguas.length} linhas.`
);
console.log(
  "  Se fossem DECIMAIS (0,95 = 95%), estariam acima de qualquer teto e seriam lixo."
);
