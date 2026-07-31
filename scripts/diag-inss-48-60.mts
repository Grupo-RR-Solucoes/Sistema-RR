// ============================================================================
// SOMENTE LEITURA — A MATRIZ DO INSS TEM CELULA "48 A 60"?
//
// A pergunta que decide se ha frente: das linhas sem celula abaixo de prazo 61,
//   prazo 48..60  -> a celula EXISTE e a busca falhou  = LACUNA (vira frente)
//   prazo < 48    -> piso de elegibilidade             = LEGITIMO (encerra)
//
// Dumpa a matriz INTEIRA de cada categoria (nao so as fronteiras perto de 84) e
// classifica as linhas sem celula por faixa de prazo.
//
//   npx tsx scripts/diag-inss-48-60.mts
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const a of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), a);
  if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.TRP_SOURCE = "db";

const { calcularOperacao, inferCreditTable, getProductionBandByValue } = await import("../lib/motor.ts");
const { lookupPctInRegra, categoriasCandidatasFor } = await import("../lib/regrasLoader.ts");
const { buildTrpCreditProvider } = await import("../lib/trp/creditTrpProvider.ts");
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");
const { calcularProducaoMensalDoGrupo } = await import("../lib/promoterAnalytics.ts");
const { getPrazoTrp } = await import("../lib/prazoTrp.ts");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const p2 = (n: number) => String(n).padStart(2, "0");
const D = "=".repeat(116);
const L = "-".repeat(116);

async function paginar<T>(f: () => any): Promise<T[]> {
  let de = 0;
  const out: T[] = [];
  for (;;) {
    const { data, error } = await f().order("id").range(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
    de += 1000;
  }
  return out;
}

const { data: emps } = await sb.from("companies").select("id, name");
const nome = new Map((emps || []).map((e: any) => [e.id, e.name]));

const todos = await paginar<any>(() =>
  sb.from("daily_production_records").select(
    "id, company_id, proposal_number, product_code, product_description, convenio_code," +
      " convenio_type, convenio_segment, interest_rate, term_months, installments, net_value," +
      " gross_value, insurance_value, insurance_type, has_insurance, status, movement_date," +
      " contract_date, proposal_date, is_srcc_restricted, raw_payload"
  )
);
const provider = await buildTrpCreditProvider(todos.map((r) => r.contract_date));
const compDe = (r: any) => {
  const p =
    getProductionPeriodFromValue(r.movement_date) ||
    getProductionPeriodFromValue(r.contract_date) ||
    getProductionPeriodFromValue(r.proposal_date);
  return p ? `${p.year}-${p2(p.month)}` : "??";
};
const comps = [...new Set(todos.map(compDe))].filter((c) => c !== "??").sort();
const prodGrupo = new Map<string, number>();
for (const c of comps) {
  const [y, m] = c.split("-").map(Number);
  prodGrupo.set(c, calcularProducaoMensalDoGrupo({ records: todos, competencia: { year: y, month: m } }).total);
}

const opDe = (r: any, prod: number) => ({
  valor_liquido: num(r.net_value),
  valor_bruto: num(r.gross_value),
  valor_seguro: num(r.insurance_value),
  taxa_juros: num(r.interest_rate),
  prazo: getPrazoTrp(r) ?? num(r.term_months || r.installments),
  tem_seguro: num(r.insurance_value) > 0 || Boolean(r.has_insurance),
  product_code: r.product_code,
  product_description: r.product_description,
  convenio_code: r.convenio_code,
  convenio_type: r.convenio_type,
  convenio_segment: r.convenio_segment,
  insurance_type: r.insurance_type,
  production_value: prod,
  movement_date: r.movement_date,
  contract_date: r.contract_date,
  proposal_date: r.proposal_date,
});

// ===========================================================================
// (A) A MATRIZ INTEIRA — todas as celulas, todas as categorias
// ===========================================================================
console.log(D);
console.log("(A) A MATRIZ DA TRP — todas as celulas por categoria e prazo");
console.log(D);
for (const c of comps) {
  const regra: any = provider ? provider(c) : null;
  if (!regra) continue;
  console.log(`\n### ${c}`);
  for (const cat of Object.keys(regra).filter((k) => regra[k] && typeof regra[k] === "object")) {
    const cc = regra[cat];
    const matriz = cc.celulas_taxa_prazo || cc.celulas_taxa || cc.celulas_prazo || cc.celulas || [];
    if (!matriz.length) continue;
    const faixas = matriz
      .map((cel: any) => `${cel.prazo_min ?? "-"}..${cel.prazo_max ?? "-"}`)
      .join("  ");
    console.log(
      `  ${cat.padEnd(18)} prazo_min_cat=${String(cc.prazo_min ?? "-").padStart(4)}  celulas(${String(matriz.length).padStart(2)}): ${faixas}`
    );
  }
  break; // a matriz e a mesma nas 3 competencias; dump so a primeira
}
console.log("\n(as demais competencias tem a mesma estrutura de prazo; conferido no dump anterior)");

// ===========================================================================
// (B) AS LINHAS SEM CELULA, SEPARADAS POR PRAZO
// ===========================================================================
const producao = todos.filter(
  (r) => (norm(r.status) === "PRODUCAO" || norm(r.status) === "PRODUCTION") && r.is_srcc_restricted !== true
);

const semCelula: any[] = [];
for (const r of producao) {
  const c = compDe(r);
  if (c === "??") continue;
  const res: any = calcularOperacao(opDe(r, prodGrupo.get(c) ?? 0), { trpProvider: provider });
  if (num(res?.credito?.avista_empresa) > 0) continue;

  const regra: any = provider ? provider(c) : null;
  if (!regra) continue;
  const op = opDe(r, prodGrupo.get(c) ?? 0);
  const tableKey = inferCreditTable(op as any);
  const taxaDec = num(r.interest_rate) > 1 ? num(r.interest_rate) / 100 : num(r.interest_rate);
  const band = getProductionBandByValue(prodGrupo.get(c) ?? 0);
  const faixaLabel = `Faixa ${["FAIXA_1", "FAIXA_2", "FAIXA_3", "FAIXA_4", "FAIXA_5"].indexOf(band) + 1}`;
  let cands: string[] = [];
  try {
    cands = categoriasCandidatasFor(tableKey, op as any) as any;
  } catch {
    cands = [tableKey];
  }
  if (!Array.isArray(cands) || !cands.length) cands = [tableKey];

  const motivos: string[] = [];
  for (const cat of cands)
    for (const tab of [faixaLabel, "pct_geral"]) {
      let out: any = null;
      try {
        out = lookupPctInRegra(regra, cat, taxaDec, op.prazo, tab, "db", false);
      } catch {
        continue;
      }
      if (out?.pct != null) continue;
      if (out?.celula) motivos.push(String(out.celula));
    }
  const txt = motivos.join(" | ");
  if (/prazo_min|prazo_max|tx_juros_min|FORA_DA_TABELA/i.test(txt)) continue; // PISO declarado
  semCelula.push({ ...r, _comp: c, _prazo: op.prazo, _cat: cands[0], _band: band, _faixaLabel: faixaLabel });
}

console.log("\n" + D);
console.log(`(B) AS ${semCelula.length} LINHAS SEM CELULA — separadas por prazo`);
console.log(D);

const g48a60 = semCelula.filter((r) => r._prazo >= 48 && r._prazo <= 60);
const gAbaixo48 = semCelula.filter((r) => r._prazo < 48);
const gAcima60 = semCelula.filter((r) => r._prazo > 60);
const somaNet = (a: any[]) => a.reduce((s, r) => s + num(r.net_value), 0);

/** Comissao devida SE a celula existisse: usa a celula da categoria que cobre o prazo. */
function pctSeExistisse(r: any) {
  const regra: any = provider ? provider(r._comp) : null;
  if (!regra) return null;
  const cc = regra[r._cat];
  if (!cc) return null;
  const matriz = cc.celulas_taxa_prazo || cc.celulas_taxa || cc.celulas_prazo || cc.celulas || [];
  const cel = matriz.find(
    (x: any) =>
      (x.prazo_min ?? -Infinity) <= r._prazo && r._prazo <= (x.prazo_max ?? Infinity)
  );
  if (!cel) return null;
  const v = cel[r._faixaLabel];
  return typeof v === "number" ? v * 100 : null;
}

for (const [titulo, arr] of [
  ["PRAZO 48..60 — a celula DEVERIA existir (LACUNA / falha de busca)", g48a60],
  ["PRAZO < 48 — piso de elegibilidade (LEGITIMO, sem comissao devida)", gAbaixo48],
  ["PRAZO > 60 — fora das duas perguntas", gAcima60],
] as Array<[string, any[]]>) {
  console.log("\n" + L);
  console.log(`${titulo}: ${arr.length} linhas   producao R$ ${brl(somaNet(arr))}`);
  console.log(L);
  let devida = 0;
  let semPct = 0;
  for (const r of arr.sort((a, b) => num(b.net_value) - num(a.net_value))) {
    const pct = pctSeExistisse(r);
    if (pct == null) semPct += 1;
    else devida += (num(r.net_value) * pct) / 100;
    console.log(
      `  ${String(r.proposal_number).padEnd(13)} ${r._comp} ${String(nome.get(r.company_id)).slice(0, 14).padEnd(14)} ` +
        `prod=${String(r.product_code ?? "-").padEnd(5)} conv=${String(r.convenio_code ?? "-").padEnd(11)} ` +
        `taxa=${String(r.interest_rate).padStart(5)} prazo=${String(r._prazo).padStart(4)} ` +
        `net=R$ ${brl(r.net_value).padStart(12)} cat=${String(r._cat).padEnd(16)} ` +
        `${pct == null ? "celula inexistente p/ este prazo" : `celula daria ${pct.toFixed(2)}% -> R$ ${brl((num(r.net_value) * pct) / 100)}`}`
    );
  }
  if (arr.length)
    console.log(
      `\n  comissao devida se a celula existisse: R$ ${brl(devida)}` +
        (semPct ? `   (${semPct} linhas sem celula que cubra o prazo — nao estimavel)` : "")
    );
}

console.log("\n" + D);
console.log("VEREDITO");
console.log(D);
console.log(`  prazo 48..60 (LACUNA real) ....... ${g48a60.length} linhas   R$ ${brl(somaNet(g48a60))}`);
console.log(`  prazo < 48 (piso legitimo) ....... ${gAbaixo48.length} linhas   R$ ${brl(somaNet(gAbaixo48))}`);
console.log(`  prazo > 60 ....................... ${gAcima60.length} linhas   R$ ${brl(somaNet(gAcima60))}`);
console.log(
  `\n  ${g48a60.length === 0 ? ">>> NAO HA LACUNA abaixo de 61: todas sao piso. O assunto ENCERRA." : ">>> HA LACUNA: a celula existe e a busca nao acha. VIRA FRENTE."}`
);

console.log("\n" + D);
console.log("FIM — nada foi escrito no banco.");
console.log(D);
