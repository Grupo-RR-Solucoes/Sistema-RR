// ============================================================================
// MEDIDA B — a FAIXA da Promotiva e apurada por CNPJ ou consolidada no GRUPO?
//
// Decide se as 54 linhas "abaixo" sao subpagamento ou se estao certas. Se a
// apuracao for por CNPJ, um CNPJ pequeno legitimamente cai em F1/F2 e a coluna
// esta certa — e o derive, que usa a producao do grupo, e que erra.
//
// O TESTE DECISIVO NAO SAO AS 54, E A BASE INTEIRA: para cada linha com valor
// plausivel, a coluna concorda mais com a faixa do GRUPO ou com a do CNPJ? Se
// as duas hipoteses empatassem, o teste nao decidiria nada — por isso o script
// reporta as duas taxas de acerto lado a lado, e tambem quantas linhas ficam em
// competencia/CNPJ onde as duas faixas COINCIDEM (essas nao discriminam).
//
// Somente leitura. npx tsx scripts/medida-b-faixa-cnpj-ou-grupo.mts
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

const { resolverTaxaAvistaEfetiva, calcularProducaoMensalDoGrupo } = await import(
  "../lib/promoterAnalytics.ts"
);
const { buildTrpCreditProvider } = await import("../lib/trp/creditTrpProvider.ts");
const { getProductionBandByValue } = await import("../lib/motor.ts");
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: unknown) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const rotulo = (f: string) => `F${f.slice(-1)}`;

const PISOS: Array<[string, number]> = [
  ["FAIXA_1", 0],
  ["FAIXA_2", 1_000_000],
  ["FAIXA_3", 3_000_000],
  ["FAIXA_4", 7_000_000],
  ["FAIXA_5", 20_000_000],
];

const COLUNAS =
  "id, company_id, proposal_number, product_description, convenio_code, status," +
  " movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value," +
  " has_insurance, interest_rate, term_months, installments, company_received_percent," +
  " is_srcc_restricted, raw_payload";

async function lerTudo() {
  const passo = 1000;
  let de = 0;
  const saida: any[] = [];
  for (;;) {
    // ORDER estavel — sem ele a paginacao do PostgREST perde/duplica linha.
    const { data, error } = await supabase
      .from("daily_production_records")
      .select(COLUNAS)
      .order("id")
      .gte("movement_date", "2026-01-01")
      .lt("movement_date", "2027-01-01")
      .range(de, de + passo - 1);
    if (error) throw new Error(error.message);
    saida.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return saida;
}

const todos = await lerTudo();
const { data: empresas } = await supabase.from("companies").select("id, name, cnpj, active");
const empresaPorId = new Map((empresas || []).map((e: any) => [e.id, e]));
const trpProvider = await buildTrpCreditProvider(todos.map((r) => r.contract_date));

const compDe = (r: any) => {
  const p =
    getProductionPeriodFromValue(r.movement_date) ||
    getProductionPeriodFromValue(r.contract_date) ||
    getProductionPeriodFromValue(r.proposal_date);
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}` : "??";
};

const comps = [...new Set(todos.map(compDe))].filter((c) => c !== "??").sort();
const cnpjs = [...new Set(todos.map((r) => r.company_id).filter(Boolean))];

// Producao do GRUPO e producao POR CNPJ, na mesma funcao — o companyIds e o
// unico parametro que muda, entao as duas somas usam a MESMA definicao de
// elegibilidade e de competencia.
const prodGrupo = new Map<string, number>();
const prodCnpj = new Map<string, number>();
for (const c of comps) {
  const [y, m] = c.split("-").map(Number);
  prodGrupo.set(
    c,
    calcularProducaoMensalDoGrupo({ records: todos, competencia: { year: y, month: m } }).total
  );
  for (const id of cnpjs) {
    prodCnpj.set(
      `${c}|${id}`,
      calcularProducaoMensalDoGrupo({
        records: todos,
        competencia: { year: y, month: m },
        companyIds: [id],
      }).total
    );
  }
}

console.log("=".repeat(104));
console.log("PRODUCAO POR COMPETENCIA — GRUPO x CADA CNPJ");
console.log("=".repeat(104));
for (const c of comps) {
  const g = prodGrupo.get(c) ?? 0;
  console.log(`\n${c}   GRUPO R$ ${brl(g).padStart(14)}  ->  ${rotulo(getProductionBandByValue(g))}`);
  for (const id of cnpjs) {
    const v = prodCnpj.get(`${c}|${id}`) ?? 0;
    if (v <= 0) continue;
    const e: any = empresaPorId.get(id);
    console.log(
      `        ${String(e?.name ?? id).slice(0, 26).padEnd(26)} R$ ${brl(v).padStart(14)}  ->  ${rotulo(getProductionBandByValue(v))}`
    );
  }
}

// Forca o DERIVE para enumerar a celula por faixa.
const ALIASES = ["% A VISTA", "% À VISTA", "% A VISTA EMPRESA", "% AVISTA", "PERCENTUAL A VISTA"];
function soDerive(r: any) {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r.raw_payload || {})) {
    if (!ALIASES.some((a) => norm(a) === norm(k))) raw[k] = v;
  }
  return { ...r, company_received_percent: null, raw_payload: raw };
}
const cachePct = new Map<string, Record<string, number>>();
function pctPorFaixa(r: any) {
  if (cachePct.has(r.id)) return cachePct.get(r.id)!;
  const base = soDerive(r);
  const out: Record<string, number> = {};
  for (const [faixa, piso] of PISOS) {
    out[faixa] =
      resolverTaxaAvistaEfetiva({
        record: base,
        producaoMensalDoGrupo: piso === 0 ? 1 : piso,
        trpProvider,
      }).taxa * 100;
  }
  cachePct.set(r.id, out);
  return out;
}

const elegivel = (r: any) => norm(r.status) === "PRODUCAO" && r.is_srcc_restricted !== true;
const comValor = todos.filter((r) => {
  const n = num(r.company_received_percent);
  return elegivel(r) && n > 0 && r.company_id;
});

// =========================================================================
// TESTE DECISIVO — a coluna concorda mais com a faixa do GRUPO ou do CNPJ?
// =========================================================================
let soGrupo = 0;
let soCnpj = 0;
let ambas = 0;
let nenhuma = 0;
let naoDiscrimina = 0; // grupo e cnpj caem na MESMA faixa: a linha nao decide nada
const exemplosSoCnpj: string[] = [];

for (const r of comValor) {
  const c = compDe(r);
  const g = getProductionBandByValue(prodGrupo.get(c) ?? 0);
  const k = getProductionBandByValue(prodCnpj.get(`${c}|${r.company_id}`) ?? 0);
  const pcts = pctPorFaixa(r);
  const coluna = num(r.company_received_percent);
  const bateG = pcts[g] > 0 && Math.abs(coluna - pcts[g]) < 0.005;
  const bateK = pcts[k] > 0 && Math.abs(coluna - pcts[k]) < 0.005;
  if (g === k) {
    naoDiscrimina += 1;
    continue;
  }
  if (bateG && bateK) ambas += 1;
  else if (bateG) soGrupo += 1;
  else if (bateK) {
    soCnpj += 1;
    if (exemplosSoCnpj.length < 8) {
      const e: any = empresaPorId.get(r.company_id);
      exemplosSoCnpj.push(
        `    ${r.proposal_number} ${c} ${String(e?.name ?? "").slice(0, 18).padEnd(18)} coluna=${coluna} grupo(${rotulo(g)})=${pcts[g].toFixed(2)} cnpj(${rotulo(k)})=${pcts[k].toFixed(2)}`
      );
    }
  } else nenhuma += 1;
}

console.log("\n" + "=".repeat(104));
console.log("TESTE DECISIVO — so as linhas em que GRUPO e CNPJ dao faixas DIFERENTES");
console.log("=".repeat(104));
console.log(`\n  linhas com valor plausivel ................. ${comValor.length}`);
console.log(`  nao discriminam (grupo == cnpj) ........... ${naoDiscrimina}`);
console.log(`  DISCRIMINAM ............................... ${comValor.length - naoDiscrimina}`);
console.log(`\n    coluna bate SO com a faixa do GRUPO ..... ${soGrupo}`);
console.log(`    coluna bate SO com a faixa do CNPJ ...... ${soCnpj}`);
console.log(`    bate com as duas ........................ ${ambas}`);
console.log(`    nao bate com nenhuma .................... ${nenhuma}`);
if (exemplosSoCnpj.length) {
  console.log("\n  exemplos que batem so com o CNPJ:");
  for (const e of exemplosSoCnpj) console.log(e);
}

// =========================================================================
// AS 54 — grupo x cnpj x coluna, linha a linha
// =========================================================================
const abaixo = comValor.filter((r) => {
  const c = compDe(r);
  const g = getProductionBandByValue(prodGrupo.get(c) ?? 0);
  const esperado = pctPorFaixa(r)[g];
  return esperado > 0 && num(r.company_received_percent) < esperado - 0.005;
});

console.log("\n" + "=".repeat(104));
console.log(`AS ${abaixo.length} LINHAS ABAIXO DA FAIXA DO GRUPO`);
console.log("=".repeat(104));
console.log(
  "\nprop         comp     empresa              col    grupo        cnpj             veredito"
);
let colBateCnpj = 0;
let colBateNada = 0;
for (const r of abaixo.sort((a, b) => compDe(a).localeCompare(compDe(b)))) {
  const c = compDe(r);
  const g = getProductionBandByValue(prodGrupo.get(c) ?? 0);
  const pk = prodCnpj.get(`${c}|${r.company_id}`) ?? 0;
  const k = getProductionBandByValue(pk);
  const pcts = pctPorFaixa(r);
  const coluna = num(r.company_received_percent);
  const e: any = empresaPorId.get(r.company_id);
  const bateK = pcts[k] > 0 && Math.abs(coluna - pcts[k]) < 0.005;
  if (bateK) colBateCnpj += 1;
  else colBateNada += 1;
  console.log(
    `${String(r.proposal_number).padEnd(11)} ${c}  ${String(e?.name ?? "").slice(0, 18).padEnd(18)} ` +
      `${String(coluna).padStart(5)}  ${rotulo(g)}=${pcts[g].toFixed(2).padStart(5)}  ` +
      `${rotulo(k)}=${pcts[k].toFixed(2).padStart(5)} (R$ ${brl(pk).padStart(12)})  ` +
      `${bateK ? "COLUNA = FAIXA DO CNPJ" : "nao bate nem grupo nem cnpj"}`
  );
}
console.log(
  `\n  das ${abaixo.length}: ${colBateCnpj} batem com a faixa do CNPJ · ${colBateNada} nao batem com nenhuma`
);

// =========================================================================
// AS "ACIMA" — e o teto?
// =========================================================================
const acima = comValor.filter((r) => {
  const c = compDe(r);
  const g = getProductionBandByValue(prodGrupo.get(c) ?? 0);
  const esperado = pctPorFaixa(r)[g];
  return esperado > 0 && num(r.company_received_percent) > esperado + 0.005;
});

console.log("\n" + "=".repeat(104));
console.log(`AS ${acima.length} LINHAS ACIMA DA FAIXA DO GRUPO — e o teto?`);
console.log("=".repeat(104));
const distrib = new Map<number, number>();
for (const r of acima) {
  const v = num(r.company_received_percent);
  distrib.set(v, (distrib.get(v) || 0) + 1);
}
console.log("\n  valor da coluna x quantidade:");
for (const [v, n] of [...distrib.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`    ${String(v).padStart(6)}  ${String(n).padStart(4)} linhas`);
}
const noTeto = acima.filter((r) => num(r.company_received_percent) >= 5.8 - 0.005).length;
const bateCnpjAcima = acima.filter((r) => {
  const c = compDe(r);
  const k = getProductionBandByValue(prodCnpj.get(`${c}|${r.company_id}`) ?? 0);
  const pcts = pctPorFaixa(r);
  return pcts[k] > 0 && Math.abs(num(r.company_received_percent) - pcts[k]) < 0.005;
}).length;
console.log(
  `\n  no teto ou acima (>= 5,80) ......... ${noTeto} de ${acima.length}  (${((noTeto / Math.max(1, acima.length)) * 100).toFixed(1)}%)`
);
console.log(`  abaixo de 5,80 (nao e teto) ........ ${acima.length - noTeto}`);
console.log(`  bateriam com a faixa do CNPJ ....... ${bateCnpjAcima}`);

// TAMANHO: se a faixa do GRUPO e a que vale, quanto ficou de fora nas "abaixo"?
let netAfetado = 0;
let difEmpresa = 0;
for (const r of abaixo) {
  const c = compDe(r);
  const g = getProductionBandByValue(prodGrupo.get(c) ?? 0);
  const pcts = pctPorFaixa(r);
  const net = num(r.net_value);
  netAfetado += net;
  difEmpresa += (net * (pcts[g] - num(r.company_received_percent))) / 100;
}
console.log("");
console.log("=".repeat(104));
console.log("TAMANHO — se a faixa do GRUPO e a que vale");
console.log("=".repeat(104));
console.log(`  producao financiada nas ${abaixo.length} linhas ............ R$ ${brl(netAfetado)}`);
console.log(`  diferenca de comissao-EMPRESA (grupo - coluna) .. R$ ${brl(difEmpresa)}`);
console.log(`  repasse do promotor a 58,33% sobre a diferenca .. R$ ${brl(difEmpresa * 0.5833)}`);
