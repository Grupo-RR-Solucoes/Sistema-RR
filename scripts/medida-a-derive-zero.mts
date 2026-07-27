// ============================================================================
// MEDIDA A — das linhas que caem no TERCEIRO degrau, para quantas o derive
// retorna ZERO?
//
// Esta e a pergunta que decide se a FRENTE 3 existe. Roda o motor DE VERDADE
// (calcularOperacao + buildTrpCreditProvider), nao uma reescrita a mao — foi a
// reescrita a mao que produziu os tres numeros errados que tivemos de invalidar.
//
// Reproduz deriveCompanyReceivedRate (promoterAnalytics.ts:330-388) chamando as
// MESMAS funcoes, com os MESMOS campos.
//
// Somente leitura. Rode com: npx tsx scripts/medida-a-derive-zero.ts
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const arquivo of [".env", ".env.local"]) {
  const p = path.join(process.cwd(), arquivo);
  if (!fs.existsSync(p)) continue;
  for (const linha of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
// O motor so consulta a regua versionada com esta variavel — e o modo de prod.
process.env.TRP_SOURCE = "db";

const { calcularOperacao } = await import("../lib/motor.ts");
const { buildTrpCreditProvider } = await import("../lib/trp/creditTrpProvider.ts");
const { getPrazoTrp } = await import("../lib/prazoTrp.ts");

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

function doBruto(raw: any, chaves: string[]) {
  if (!raw || typeof raw !== "object") return null;
  for (const k of Object.keys(raw)) {
    if (chaves.some((c) => norm(c) === norm(k))) {
      const v = raw[k];
      if (v != null && String(v).trim() !== "") return v;
    }
  }
  return null;
}

const CHAVES_AVISTA = ["% A VISTA", "% À VISTA", "% A VISTA EMPRESA", "% AVISTA", "Percentual A Vista"];
function taxaPropria(r: any) {
  const b = doBruto(r.raw_payload, CHAVES_AVISTA);
  if (b != null) {
    const n = Number(String(b).replace("%", "").replace(",", "."));
    const t = Number.isFinite(n) ? (n > 1 ? n / 100 : n) : 0;
    if (t > 0 && t <= 0.065) return t;
  }
  const g = num(r.company_received_percent);
  const t2 = g > 1 ? g / 100 : g;
  if (t2 > 0 && t2 <= 0.065) return t2;
  return null;
}

async function lerTudo(colunas: string, filtros: any[]) {
  const passo = 1000;
  let de = 0;
  const saida: any[] = [];
  for (;;) {
    let q: any = supabase.from("daily_production_records").select(colunas).range(de, de + passo - 1);
    for (const f of filtros) q = q[f.op](...f.args);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    saida.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return saida;
}

const empresas = await supabase.from("companies").select("id, name");
const nomeEmpresa = new Map((empresas.data || []).map((e: any) => [e.id, e.name]));
const gestora = (id: string) =>
  String(nomeEmpresa.get(id) || "").toUpperCase().includes("ADS") ? "ADS (BBTS)" : "RR (Promotiva)";

const linhas = await lerTudo(
  "company_id, movement_date, status, net_value, gross_value, insurance_value, has_insurance, interest_rate, term_months, installments, product_code, product_description, company_received_percent, contract_date, proposal_date, proposal_number, raw_payload",
  [
    { op: "gte", args: ["movement_date", "2026-03-01"] },
    { op: "lt", args: ["movement_date", "2026-08-10"] },
  ]
);

const emProducao = linhas.filter((r) => norm(r.status).includes("PRODUC"));
const terceiroDegrau = emProducao.filter((r) => taxaPropria(r) == null);

// producao do grupo por competencia — a base da FAIXA (conceito mensal)
const prodPorComp = new Map<string, number>();
for (const r of emProducao) {
  const c = String(r.movement_date).slice(0, 7);
  prodPorComp.set(c, (prodPorComp.get(c) || 0) + num(r.net_value));
}

const trpProvider = await buildTrpCreditProvider(
  terceiroDegrau.map((r) => r.contract_date)
);

console.log("=".repeat(84));
console.log("MEDIDA A — o derive retorna zero para quantas?");
console.log("=".repeat(84));
console.log(`em Producao: ${emProducao.length} · caem no 3o degrau: ${terceiroDegrau.length}\n`);

type Agg = { total: number; zero: number; netZero: number };
const porChave = new Map<string, Agg>();
const zeradas: any[] = [];

for (const r of terceiroDegrau) {
  const comp = String(r.movement_date).slice(0, 7);
  const net = num(r.net_value);
  let taxa = 0;
  if (net > 0) {
    const op = calcularOperacao(
      {
        valor_liquido: net,
        valor_bruto: num(r.gross_value),
        valor_seguro: num(r.insurance_value),
        taxa_juros: num(r.interest_rate),
        prazo: getPrazoTrp(r) ?? num(r.term_months || r.installments),
        tem_seguro: num(r.insurance_value) > 0 || Boolean(r.has_insurance),
        product_code: doBruto(r.raw_payload, ["Produto", "Codigo Produto"]) ?? r.product_code ?? null,
        product_description: r.product_description,
        convenio_code: doBruto(r.raw_payload, ["Codigo Convenio", "Cod Convenio", "Convenio"]) ?? null,
        convenio_type: doBruto(r.raw_payload, ["Tipo Convenio", "Tipo de Convenio"]) ?? null,
        convenio_segment: doBruto(r.raw_payload, ["Segmento Convenio", "Convenio Segmento"]) ?? null,
        insurance_type: doBruto(r.raw_payload, ["Tipo Seguro"]) ?? null,
        production_value: prodPorComp.get(comp) || 0,
        movement_date: r.movement_date,
        contract_date: r.contract_date,
        proposal_date: r.proposal_date,
      } as any,
      { trpProvider } as any
    );
    const avista = num((op as any)?.credito?.avista_empresa);
    taxa = avista > 0 ? avista / net : 0;
  }
  const chave = `${comp} ${gestora(r.company_id)}`;
  if (!porChave.has(chave)) porChave.set(chave, { total: 0, zero: 0, netZero: 0 });
  const a = porChave.get(chave)!;
  a.total += 1;
  if (!(taxa > 0)) {
    a.zero += 1;
    a.netZero += net;
    zeradas.push(r);
  }
}

console.log("competencia  gestora            3o degrau   derive=0     % zerado        net zerado");
console.log("-".repeat(84));
let totGeral = 0;
let zeroGeral = 0;
let netGeral = 0;
for (const k of [...porChave.keys()].sort()) {
  const [comp, ...g] = k.split(" ");
  const v = porChave.get(k)!;
  totGeral += v.total;
  zeroGeral += v.zero;
  netGeral += v.netZero;
  const pct = v.total ? (v.zero / v.total) * 100 : 0;
  console.log(
    `${comp}      ${g.join(" ").padEnd(18)} ${String(v.total).padStart(9)} ${String(v.zero).padStart(10)} ${pct.toFixed(1).padStart(10)}%  ${brl(v.netZero).padStart(16)}`
  );
}
console.log("-".repeat(84));
console.log(
  `TOTAL: ${totGeral} no 3o degrau · ${zeroGeral} zeradas (${totGeral ? ((zeroGeral / totGeral) * 100).toFixed(1) : 0}%) · net zerado R$ ${brl(netGeral)}`
);

if (zeradas.length) {
  console.log("\nAS ZERADAS — agrupadas por produto x prazo x convenio:");
  const g = new Map<string, { n: number; net: number }>();
  for (const r of zeradas) {
    const conv = doBruto(r.raw_payload, ["Codigo Convenio", "Cod Convenio", "Convenio"]) ?? "-";
    const k = `prod ${r.product_code ?? "?"} | prazo ${r.term_months ?? "?"} | conv ${conv} | juros ${r.interest_rate ?? "-"}`;
    if (!g.has(k)) g.set(k, { n: 0, net: 0 });
    const a = g.get(k)!;
    a.n += 1;
    a.net += num(r.net_value);
  }
  for (const [k, v] of [...g.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) {
    console.log(`  ${String(v.n).padStart(4)} x  ${k}  ·  R$ ${brl(v.net)}`);
  }
}
