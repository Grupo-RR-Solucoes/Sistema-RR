// Diagnostico: a coluna company_received_percent tem UM padrao de escala, ou
// dois escritores com convencoes opostas? Somente leitura.
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
    .select(
      "id, company_received_percent, net_value, movement_date, status, commission_rule_source, raw_payload"
    )
    .gte("movement_date", "2025-01-01")
    .range(de, de + passo - 1);
  if (error) throw new Error(error.message);
  linhas.push(...(data || []));
  if (!data || data.length < passo) break;
  de += passo;
}

console.log("=".repeat(92));
console.log("OS DOIS ESCRITORES DE company_received_percent");
console.log("=".repeat(92));
console.log(`
  app/api/import/daily/route.ts:97   parsePercent = (v > 1 ? v/100 : v)
      planilha "5,80"  ->  0.058     <- grava FRACAO
      planilha "0,95"  ->  0.95      <- 0,95 nao e > 1, entao NAO divide

  app/api/calculate/monthly:1372     persistedCompanyReceivedPercent
      toPercentUnits = (v <= 1 ? v*100 : v)
      0.058            ->  5.8       <- grava PERCENTUAL
`);

const comValor = linhas.filter((r) => {
  const n = Number(r.company_received_percent);
  return Number.isFinite(n) && n > 0;
});

const balde = (n: number) => {
  if (n < 0.1) return "A. 0,00 - 0,10   (fracao do import: 5,8% = 0,058)";
  if (n < 1) return "B. 0,10 - 1,00   (AMBIGUO)";
  if (n <= 6.5) return "C. 1,00 - 6,50   (percentual do calculate)";
  return "D. acima de 6,50 (implausivel)";
};

const agg = new Map<string, { n: number; net: number; fontes: Map<string, number> }>();
for (const r of comValor) {
  const b = balde(Number(r.company_received_percent));
  const cur = agg.get(b) || { n: 0, net: 0, fontes: new Map() };
  cur.n += 1;
  cur.net += Number(r.net_value) || 0;
  const f = String(r.commission_rule_source ?? "(null)").split("+")[0];
  cur.fontes.set(f, (cur.fontes.get(f) || 0) + 1);
  agg.set(b, cur);
}

console.log("-".repeat(92));
console.log("DISTRIBUICAO (tudo desde 2025, qualquer status)");
console.log("-".repeat(92));
for (const [b, v] of [...agg.entries()].sort()) {
  console.log(`\n  ${b}`);
  console.log(`     ${v.n} linhas · R$ ${brl(v.net)} financiados`);
  const top = [...v.fontes.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 4);
  console.log(`     commission_rule_source: ${top.map(([k, c]) => `${k}=${c}`).join("  ")}`);
}

// A pergunta decisiva: existe HOJE alguma linha com a fracao do import intacta?
const fracoes = comValor.filter((r) => Number(r.company_received_percent) < 0.1);
console.log("\n" + "=".repeat(92));
console.log("PERGUNTA DECISIVA");
console.log("=".repeat(92));
console.log(
  `\n  Linhas com valor < 0,10 (fracao do import ainda nao reescrita): ${fracoes.length}`
);
if (fracoes.length) {
  const amostra = fracoes.slice(0, 8);
  for (const r of amostra) {
    console.log(
      `    ${String(r.movement_date).slice(0, 10)}  v=${r.company_received_percent}  source=${r.commission_rule_source ?? "(null)"}  status=${r.status}`
    );
  }
  console.log(
    "\n  >>> A coluna NAO e percentual sempre. Ha fracao viva; ler direto daria 100x menos."
  );
} else {
  console.log(
    "\n  >>> Nenhuma fracao viva hoje: o calculate reescreveu todas em percentual."
  );
  console.log(
    "      Mas o import CONTINUA gravando fracao — a proxima diaria recria o caso."
  );
}

// Quantas linhas NUNCA passaram pelo calculate (source nulo)?
const semSource = comValor.filter((r) => !r.commission_rule_source);
console.log(`\n  Linhas com valor e SEM commission_rule_source: ${semSource.length}`);
if (semSource.length) {
  const vals = [...new Set(semSource.map((r) => Number(r.company_received_percent)))]
    .sort((a, b) => a - b)
    .slice(0, 12);
  console.log(`    valores: ${vals.join(", ")}`);
}
