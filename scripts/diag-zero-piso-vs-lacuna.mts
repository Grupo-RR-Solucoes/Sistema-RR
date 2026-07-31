// ============================================================================
// SOMENTE LEITURA — BLOCO 3: as linhas com comissao-empresa ZERO.
//
// Classifica cada uma pela RAZAO que a propria regua devolve (o campo `celula`
// de lookupPctInRegra), nao por chute:
//   PISO_LEGITIMO   a regua diz explicitamente por que nao paga:
//                     "prazo X < prazo_min Y (FORA_DA_TABELA)"
//                     "prazo X > prazo_max Y (FORA_DA_TABELA)"
//                     "taxa X < tx_juros_min Y (FORA_DA_TABELA)"
//   LACUNA_MATRIZ   nenhuma celula casa taxa+prazo, sem piso declarado
//                   -> deveria ter celula e nao acha
//
// E responde o prazo 84: em qual celula ele cai.
//
//   npx tsx scripts/diag-zero-piso-vs-lacuna.mts
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

const producao = todos.filter(
  (r) => (norm(r.status) === "PRODUCAO" || norm(r.status) === "PRODUCTION") && r.is_srcc_restricted !== true
);

const zeros: any[] = [];
for (const r of producao) {
  const c = compDe(r);
  if (c === "??") continue;
  const res: any = calcularOperacao(opDe(r, prodGrupo.get(c) ?? 0), { trpProvider: provider });
  if (num(res?.credito?.avista_empresa) <= 0) zeros.push({ ...r, _comp: c });
}

console.log(D);
console.log("BLOCO 3 — as linhas com comissao-empresa ZERO, classificadas pela razao da REGUA");
console.log(D);
console.log(`\nlinhas em PRODUCAO (nao restritas) ... ${producao.length}`);
console.log(`com avista_empresa = 0 .............. ${zeros.length}`);
console.log(`producao nelas ...................... R$ ${brl(zeros.reduce((s, r) => s + num(r.net_value), 0))}`);

// ---------------------------------------------------------------------------
// classificacao pela mensagem da regua
// ---------------------------------------------------------------------------
const piso: any[] = [];
const lacuna: any[] = [];
const semRegra: any[] = [];

for (const r of zeros) {
  const c = r._comp;
  const regra: any = provider ? provider(c) : null;
  if (!regra) {
    semRegra.push({ ...r, _motivo: `sem regra de TRP para ${c}` });
    continue;
  }
  const op = opDe(r, prodGrupo.get(c) ?? 0);
  const tableKey = inferCreditTable(op as any);
  const taxaDec = num(r.interest_rate) > 1 ? num(r.interest_rate) / 100 : num(r.interest_rate);
  const prazo = op.prazo;
  const band = getProductionBandByValue(prodGrupo.get(c) ?? 0);
  const faixaLabel = `Faixa ${["FAIXA_1", "FAIXA_2", "FAIXA_3", "FAIXA_4", "FAIXA_5"].indexOf(band) + 1}`;

  // MESMA lista de candidatas que o motor usa.
  let cands: string[] = [];
  try {
    cands = categoriasCandidatasFor(tableKey, op as any) as any;
  } catch {
    cands = [tableKey];
  }
  if (!Array.isArray(cands) || !cands.length) cands = [tableKey];

  const motivos: string[] = [];
  for (const cat of cands) {
    for (const tab of [faixaLabel, "pct_geral"]) {
      let out: any = null;
      try {
        out = lookupPctInRegra(regra, cat, taxaDec, prazo, tab, "db", false);
      } catch {
        continue;
      }
      if (out?.pct != null) continue;
      if (out?.celula) motivos.push(String(out.celula));
    }
  }
  const txt = motivos.join(" | ");
  const temPiso = /prazo_min|prazo_max|tx_juros_min|FORA_DA_TABELA/i.test(txt);
  const reg = { ...r, _motivo: txt || "(nenhuma celula casou taxa+prazo)", _cands: cands.join(","), _band: band };
  if (temPiso) piso.push(reg);
  else lacuna.push(reg);
}

const somaNet = (a: any[]) => a.reduce((s, r) => s + num(r.net_value), 0);

console.log("\n" + L);
console.log("CLASSIFICACAO");
console.log(L);
console.log(`  PISO_LEGITIMO ... ${String(piso.length).padStart(4)} linhas   producao R$ ${brl(somaNet(piso)).padStart(13)}   comissao devida: R$ 0,00 (a regua diz que nao paga)`);
console.log(`  LACUNA_MATRIZ ... ${String(lacuna.length).padStart(4)} linhas   producao R$ ${brl(somaNet(lacuna)).padStart(13)}`);
if (semRegra.length)
  console.log(`  SEM_REGUA ....... ${String(semRegra.length).padStart(4)} linhas   producao R$ ${brl(somaNet(semRegra)).padStart(13)}`);

function agr(t: string, arr: any[], f: (r: any) => string) {
  const m = new Map<string, { n: number; net: number }>();
  for (const r of arr) {
    const k = f(r);
    const a = m.get(k) || { n: 0, net: 0 };
    a.n += 1;
    a.net += num(r.net_value);
    m.set(k, a);
  }
  console.log(`\n  ${t}`);
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10))
    console.log(`     ${String(v.n).padStart(4)}x  R$ ${brl(v.net).padStart(13)}   ${k}`);
}
agr("PISO_LEGITIMO por motivo:", piso, (r) => String(r._motivo).split("|")[0].trim().slice(0, 70));
agr("PISO_LEGITIMO por competencia:", piso, (r) => r._comp);

console.log("\n" + L);
console.log("LACUNA_MATRIZ — linha a linha (nenhuma celula casa taxa+prazo, sem piso declarado)");
console.log(L);
console.log("proposta      comp     empresa         prod  conv        taxa   prazo   net             categorias tentadas");
for (const r of lacuna.sort((a, b) => num(b.net_value) - num(a.net_value)))
  console.log(
    `${String(r.proposal_number).padEnd(13)} ${r._comp}  ${String(nome.get(r.company_id)).slice(0, 14).padEnd(14)} ` +
      `${String(r.product_code ?? "-").padEnd(5)} ${String(r.convenio_code ?? "-").padEnd(11)} ${String(r.interest_rate).padStart(5)} ` +
      `${String(r.term_months ?? "-").padStart(5)}   R$ ${brl(r.net_value).padStart(12)}   ${r._cands}`
  );

// para as de lacuna, qual a FAIXA de pct das celulas da categoria (sem inventar valor)
console.log("\n  Ordem de grandeza do que uma celula daria (min/max das celulas da categoria na faixa):");
for (const r of lacuna) {
  const regra: any = provider ? provider(r._comp) : null;
  if (!regra) continue;
  const cat = String(r._cands).split(",")[0];
  const c = regra[cat];
  const matriz = c?.celulas_taxa_prazo || c?.celulas_taxa || c?.celulas_prazo || c?.celulas || [];
  const idx = ["FAIXA_1", "FAIXA_2", "FAIXA_3", "FAIXA_4", "FAIXA_5"].indexOf(r._band) + 1;
  const pcts = matriz
    .map((cel: any) => cel?.[`Faixa ${idx}`] ?? cel?.pct ?? null)
    .filter((v: any) => typeof v === "number");
  console.log(
    `     ${String(r.proposal_number).padEnd(13)} cat=${cat.padEnd(16)} celulas=${String(matriz.length).padStart(3)}  ` +
      (pcts.length
        ? `pct entre ${Math.min(...pcts).toFixed(2)} e ${Math.max(...pcts).toFixed(2)} -> comissao entre R$ ${brl((num(r.net_value) * Math.min(...pcts)) / 100)} e R$ ${brl((num(r.net_value) * Math.max(...pcts)) / 100)}`
        : "sem pct legivel nas celulas (nao estimavel)")
  );
}

// ---------------------------------------------------------------------------
// O PRAZO 84
// ---------------------------------------------------------------------------
console.log("\n" + D);
console.log("O PRAZO 84 — em qual celula ele cai?");
console.log(D);
console.log("\ninRange (regrasLoader.ts:84-88) e INCLUSIVO nas duas pontas:");
console.log("    const lo = typeof min === 'number' ? min - EPS : -Infinity;");
console.log("    const hi = typeof max === 'number' ? max + EPS : Infinity;");
console.log("    return valor >= lo && valor <= hi;");
console.log("\nentao prazo 84 casa a celula cujo prazo_max = 84, e NAO a de prazo_min = 85.\n");
for (const c of comps) {
  const regra: any = provider ? provider(c) : null;
  if (!regra) continue;
  for (const cat of ["INSS_NOVO", "INSS_RENOV"]) {
    const cc = regra[cat];
    if (!cc) continue;
    const matriz = cc.celulas_taxa_prazo || cc.celulas_taxa || cc.celulas_prazo || cc.celulas || [];
    const perto = matriz.filter(
      (cel: any) =>
        (typeof cel.prazo_max === "number" && cel.prazo_max >= 80 && cel.prazo_max <= 90) ||
        (typeof cel.prazo_min === "number" && cel.prazo_min >= 80 && cel.prazo_min <= 90)
    );
    if (!perto.length) continue;
    console.log(`  ${c} ${cat}: celulas com fronteira perto de 84`);
    for (const cel of perto)
      console.log(
        `     prazo ${String(cel.prazo_min ?? "-").padStart(4)}..${String(cel.prazo_max ?? "-").padEnd(4)}  ` +
          `tx ${String(cel.tx_min ?? "-")}..${String(cel.tx_max ?? "-")}  ` +
          `-> 84 casa? ${(cel.prazo_min ?? -Infinity) <= 84 && 84 <= (cel.prazo_max ?? Infinity) ? "SIM" : "nao"}   ${JSON.stringify(cel).slice(0, 120)}`
      );
  }
}

// ha alguma linha de prazo 84 no universo?
const p84 = todos.filter((r) => num(r.term_months) === 84 || num(r.installments) === 84);
console.log(`\nlinhas com prazo 84 na diaria: ${p84.length}`);
for (const r of p84.slice(0, 12)) {
  const c = compDe(r);
  const res: any = calcularOperacao(opDe(r, prodGrupo.get(c) ?? 0), { trpProvider: provider });
  const av = num(res?.credito?.avista_empresa);
  console.log(
    `   ${String(r.proposal_number).padEnd(13)} ${c} ${String(nome.get(r.company_id)).slice(0, 14).padEnd(14)} ` +
      `prod=${r.product_code} conv=${r.convenio_code} taxa=${r.interest_rate} net=R$ ${brl(r.net_value).padStart(12)} ` +
      `-> avista R$ ${brl(av)} (${num(r.net_value) > 0 ? ((av / num(r.net_value)) * 100).toFixed(4) : "0"}%)  status=${r.status}`
  );
}

console.log("\n" + D);
console.log("FIM — nada foi escrito no banco.");
console.log(D);
