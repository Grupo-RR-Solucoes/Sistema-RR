// ============================================================================
// MEDIDA B (item 1/2/3) — qual FAIXA vale para as 9 linhas de coluna sub-1?
//
// A pergunta deixou de ser "a tela esta errada" e passou a ser "qual faixa vale".
// O PMR paga o valor da COLUNA (F1/F2); o derive resolve pela faixa que a
// PRODUCAO do mes determina. Este script mede quem esta certo.
//
// COMO IDENTIFICA A CELULA sem reimplementar a busca da TRP: roda o DERIVE REAL
// cinco vezes por linha, forcando a producao do grupo em cada faixa (0, 1M, 3M,
// 7M, 20M). O pct que volta em cada rodada E o pct daquela faixa, na celula
// exata daquele contrato — enumerada pelo codigo de producao, nao por leitura
// minha do PDF.
//
// Somente leitura. npx tsx scripts/medida-b-faixa-das-9.mts
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

// Pisos das faixas — BAND_THRESHOLDS do motor (lib/motor.ts:69).
const PISOS: Array<[string, number]> = [
  ["FAIXA_1", 0],
  ["FAIXA_2", 1_000_000],
  ["FAIXA_3", 3_000_000],
  ["FAIXA_4", 7_000_000],
  ["FAIXA_5", 20_000_000],
];

const COLUNAS =
  "id, company_id, assigned_promoter_id, proposal_number, product_description, convenio_code," +
  " status, movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value," +
  " has_insurance, interest_rate, term_months, installments, company_received_percent," +
  " is_srcc_restricted, raw_payload, created_at";

async function lerTudo(aplicar: (q: any) => any) {
  const passo = 1000;
  let de = 0;
  const saida: any[] = [];
  for (;;) {
    // ORDER estavel e obrigatorio: sem ele o PostgREST pagina em ordem
    // arbitraria e a mesma linha pode vir duas vezes ou nenhuma. Sem isto a
    // producao do grupo saiu R$ 4,75 mi contra R$ 5,24 mi das outras medidas.
    const { data, error } = await aplicar(
      supabase.from("daily_production_records").select(COLUNAS).order("id")
    ).range(de, de + passo - 1);
    if (error) throw new Error(error.message);
    saida.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return saida;
}

const todos = await lerTudo((q) =>
  q.gte("movement_date", "2026-01-01").lt("movement_date", "2027-01-01")
);
const trpProvider = await buildTrpCreditProvider(todos.map((r) => r.contract_date));

const compDe = (r: any) => {
  const p =
    getProductionPeriodFromValue(r.movement_date) ||
    getProductionPeriodFromValue(r.contract_date) ||
    getProductionPeriodFromValue(r.proposal_date);
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}` : "??";
};

// Producao do grupo por competencia — a base da faixa.
const comps = [...new Set(todos.map(compDe))].filter((c) => c !== "??").sort();
const producaoPorComp = new Map<string, number>();
for (const c of comps) {
  const [y, m] = c.split("-").map(Number);
  producaoPorComp.set(
    c,
    calcularProducaoMensalDoGrupo({ records: todos, competencia: { year: y, month: m } }).total
  );
}

// Forca o DERIVE: zera os dois primeiros degraus para a cascata cair no terceiro.
const ALIASES = ["% A VISTA", "% À VISTA", "% A VISTA EMPRESA", "% AVISTA", "PERCENTUAL A VISTA"];
function soDerive(r: any) {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r.raw_payload || {})) {
    if (!ALIASES.some((a) => norm(a) === norm(k))) raw[k] = v;
  }
  return { ...r, company_received_percent: null, raw_payload: raw };
}

/** pct (em %) que o derive devolve com a producao forcada em cada faixa. */
function pctPorFaixa(r: any) {
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
  return out;
}

const rotulo = (f: string) => `F${f.slice(-1)}`;

// ===========================================================================
// ITEM 3 — quem sao as 9
// ===========================================================================
const noveLinhas = todos.filter((r) => {
  const n = Number(r.company_received_percent);
  return Number.isFinite(n) && n > 0 && n < 1;
});

console.log("=".repeat(100));
console.log(`ITEM 3 — AS ${noveLinhas.length} LINHAS DE COLUNA SUB-1`);
console.log("=".repeat(100));
console.log(
  "\nprop         comp     conv     produto                     juros  prazo   coluna  net"
);
for (const r of noveLinhas.sort((a, b) => compDe(a).localeCompare(compDe(b)))) {
  console.log(
    `${String(r.proposal_number).padEnd(11)} ${compDe(r)}  ${String(r.convenio_code ?? "-").padEnd(8)} ` +
      `${String(r.product_description ?? "-").slice(0, 26).padEnd(26)} ${String(r.interest_rate).padStart(5)} ` +
      `${String(r.term_months ?? r.installments).padStart(5)}   ${String(r.company_received_percent).padStart(5)}  ${brl(num(r.net_value)).padStart(12)}`
  );
}

const porComp = new Map<string, number>();
const porConv = new Map<string, number>();
const porDia = new Map<string, number>();
for (const r of noveLinhas) {
  porComp.set(compDe(r), (porComp.get(compDe(r)) || 0) + 1);
  porConv.set(String(r.convenio_code ?? "-"), (porConv.get(String(r.convenio_code ?? "-")) || 0) + 1);
  const d = String(r.created_at ?? "").slice(0, 10);
  porDia.set(d, (porDia.get(d) || 0) + 1);
}
console.log("\nPADRAO:");
console.log(`  competencias: ${[...porComp.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`  convenios:    ${[...porConv.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`  created_at:   ${[...porDia.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);

// ===========================================================================
// ITEM 1 — qual faixa a producao justifica, e o que a coluna implica
// ===========================================================================
console.log("\n" + "=".repeat(100));
console.log("ITEM 1 — PRODUCAO x COLUNA x DERIVE, linha a linha");
console.log("=".repeat(100));

let colunaErrada = 0;
let colunaCerta = 0;
for (const r of noveLinhas.sort((a, b) => compDe(a).localeCompare(compDe(b)))) {
  const comp = compDe(r);
  const producao = producaoPorComp.get(comp) ?? 0;
  const faixaProducao = getProductionBandByValue(producao);
  const pcts = pctPorFaixa(r);
  const coluna = num(r.company_received_percent);
  const aplicado =
    resolverTaxaAvistaEfetiva({
      record: r,
      producaoMensalDoGrupo: producao,
      trpProvider,
    }).taxa * 100;

  // Qual faixa tem pct == valor da coluna?
  const faixaDaColuna =
    PISOS.map(([f]) => f).find((f) => Math.abs(pcts[f] - coluna) < 0.005) ?? null;

  console.log(`\n--- ${r.proposal_number}  (${comp})`);
  console.log(
    `    producao do grupo no mes: R$ ${brl(producao)}  ->  ${rotulo(faixaProducao)}`
  );
  console.log(
    `    celula da TRP (pct por faixa, enumerada pelo motor):  ` +
      PISOS.map(([f]) => `${rotulo(f)}=${pcts[f].toFixed(2)}`).join("  ")
  );
  console.log(
    `    coluna = ${coluna}  ->  ${faixaDaColuna ? rotulo(faixaDaColuna) : "NAO BATE COM NENHUMA FAIXA"}`
  );
  console.log(`    derive aplicou = ${aplicado.toFixed(2)}  ->  ${rotulo(faixaProducao)}`);
  if (faixaDaColuna && faixaDaColuna !== faixaProducao) {
    colunaErrada += 1;
    console.log(
      `    >>> DIVERGEM: a producao justifica ${rotulo(faixaProducao)}, a coluna traz ${rotulo(faixaDaColuna)}.`
    );
  } else if (faixaDaColuna === faixaProducao) {
    colunaCerta += 1;
    console.log(`    >>> CONCORDAM.`);
  }
}

console.log("\n" + "-".repeat(100));
console.log(
  `  coluna com a faixa da producao: ${colunaCerta}   ·   coluna com faixa DIFERENTE: ${colunaErrada}`
);

// ===========================================================================
// ITEM 2 — e as 1732 "ok"? a coluna concorda com a faixa da producao?
// ===========================================================================
console.log("\n" + "=".repeat(100));
console.log("ITEM 2 — AMOSTRA DAS LINHAS 'OK' (coluna entre 1 e 6,5)");
console.log("=".repeat(100));

const ok = todos.filter((r) => {
  const n = Number(r.company_received_percent);
  return Number.isFinite(n) && n >= 1 && n <= 6.5 && norm(r.status) === "PRODUCAO";
});

// Amostra deterministica: 1 a cada N, ate 60 linhas.
const N = Math.max(1, Math.floor(ok.length / 60));
const amostra = ok.filter((_, i) => i % N === 0).slice(0, 60);
// tambem varre TUDO, para saber se a amostra representa
let todasConcorda = 0, todasAcima = 0, todasAbaixo = 0, todasSemCelula = 0;
for (const r of ok) {
  const comp = compDe(r);
  const producao = producaoPorComp.get(comp) ?? 0;
  const faixaProducao = getProductionBandByValue(producao);
  const esperado = pctPorFaixa(r)[faixaProducao];
  const coluna = num(r.company_received_percent);
  if (!(esperado > 0)) todasSemCelula += 1;
  else if (Math.abs(coluna - esperado) < 0.005) todasConcorda += 1;
  else if (coluna > esperado) todasAcima += 1;
  else todasAbaixo += 1;
}
console.log(`
VARREDURA COMPLETA das ${ok.length} linhas ok:`);
console.log(`  concordam ${todasConcorda} · acima ${todasAcima} · abaixo ${todasAbaixo} · sem celula ${todasSemCelula}`);

let concorda = 0;
let divergeParaCima = 0;
let divergeParaBaixo = 0;
let semCelula = 0;
const exemplos: string[] = [];
for (const r of amostra) {
  const comp = compDe(r);
  const producao = producaoPorComp.get(comp) ?? 0;
  const faixaProducao = getProductionBandByValue(producao);
  const pcts = pctPorFaixa(r);
  const coluna = num(r.company_received_percent);
  const esperado = pcts[faixaProducao];
  if (!(esperado > 0)) {
    semCelula += 1;
    continue;
  }
  if (Math.abs(coluna - esperado) < 0.005) concorda += 1;
  else if (coluna > esperado) {
    divergeParaCima += 1;
    if (exemplos.length < 40)
      exemplos.push(
        `    ${r.proposal_number} ${comp} coluna=${coluna} esperado(${rotulo(faixaProducao)})=${esperado.toFixed(2)}`
      );
  } else {
    divergeParaBaixo += 1;
    if (exemplos.length < 40)
      exemplos.push(
        `    ${r.proposal_number} ${comp} coluna=${coluna} esperado(${rotulo(faixaProducao)})=${esperado.toFixed(2)}`
      );
  }
}

console.log(`\n  universo 'ok': ${ok.length} linhas · amostra de ${amostra.length} (1 a cada ${N})`);
console.log(`  coluna == pct da faixa da producao ....... ${concorda}`);
console.log(`  coluna ACIMA do pct da faixa ............. ${divergeParaCima}`);
console.log(`  coluna ABAIXO do pct da faixa ............ ${divergeParaBaixo}`);
console.log(`  sem celula na TRP (derive zerou) ......... ${semCelula}`);
if (exemplos.length) {
  console.log("\n  exemplos de divergencia:");
  for (const e of exemplos) console.log(e);
}

console.log("\n" + "=".repeat(100));
console.log("LEITURA");
console.log("=".repeat(100));
console.log(
  colunaErrada > 0 && colunaCerta === 0
    ? "  As 9: producao e derive CONCORDAM, a coluna DIVERGE -> a coluna esta com faixa errada."
    : colunaCerta > 0 && colunaErrada === 0
    ? "  As 9: a coluna bate com a faixa da producao -> o derive e que esta forcando outra faixa."
    : "  As 9: resultado MISTO — ver linha a linha acima."
);
console.log(
  `  As 'ok': ${concorda}/${amostra.length - semCelula} da amostra batem com a faixa da producao.`
);
