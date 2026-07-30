// ============================================================================
// SOMENTE LEITURA — ANTES x DEPOIS do conserto do derive (faixa do GRUPO).
//
// Reproduz fielmente deriveCompanyReceivedPercentFromMotor
// (app/api/calculate/monthly/route.ts:131-204): monta a Operation com os mesmos
// campos, chama calcularOperacao e devolve (avista_empresa / netValue) * 100.
// A UNICA coisa que muda entre ANTES e DEPOIS e production_value:
//   ANTES  = netValidProduction do CNPJ isolado
//   DEPOIS = netValidProduction somado dos CNPJs da gestora (o GRUPO)
//
// E mede o efeito do CURTO-CIRCUITO de getPersistedCompanyReceivedPercent
// (route.ts:118-121): a coluna JA GRAVADA vence o derive, entao consertar o
// derive so alcanca linha com a coluna vazia.
//
//   npx tsx scripts/medida-derive-grupo.mts
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

const { calcularOperacao, getProductionBandByValue } = await import("../lib/motor.ts");
const { buildTrpCreditProvider } = await import("../lib/trp/creditTrpProvider.ts");
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");
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
const chaveNum = (v: unknown) => String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");
const p2 = (n: number) => String(n).padStart(2, "0");
const D = "=".repeat(118);
const L = "-".repeat(118);

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

const { data: emps } = await sb.from("companies").select("id, name, active");
const nome = new Map((emps || []).map((e: any) => [e.id, e.name]));
// A rota e o motor da PROMOTIVA: semAds (route.ts:678). Grupo = CNPJs RR ativos.
const rrIds = (emps || [])
  .filter((e: any) => !String(e.name).toUpperCase().includes("ADS"))
  .map((e: any) => e.id);

const todos = await paginar<any>(() =>
  sb.from("daily_production_records").select(
    "id, company_id, proposal_number, contract_number, product_code, product_description," +
      " convenio_code, convenio_type, convenio_segment, interest_rate, term_months, installments," +
      " net_value, gross_value, insurance_value, insurance_type, has_insurance, status," +
      " movement_date, contract_date, proposal_date, company_received_percent," +
      " is_srcc_restricted, raw_payload"
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

// ---------------------------------------------------------------------------
// isValidRecord + isProductionStatus, como calculateCompanyExpectedValues usa
// (route.ts:~470-491). netValidProduction = soma dos net das linhas validas.
// ---------------------------------------------------------------------------
const ehProducao = (r: any) => norm(r.status) === "PRODUCAO" || norm(r.status) === "PRODUCTION";
const ehValida = (r: any) => r.is_srcc_restricted !== true;

function netValidProduction(records: any[]) {
  let t = 0;
  for (const r of records) if (ehValida(r)) t += num(r.net_value);
  return t;
}

/** COPIA FIEL de deriveCompanyReceivedPercentFromMotor (route.ts:131-204). */
function derive(record: any, companyProductionValue: number) {
  const netValue = num(record.net_value);
  if (netValue <= 0) return 0;
  const operation: any = calcularOperacao(
    {
      valor_liquido: netValue,
      valor_bruto: num(record.gross_value),
      valor_seguro: num(record.insurance_value),
      taxa_juros: num(record.interest_rate),
      prazo: getPrazoTrp(record) ?? num(record.term_months || record.installments),
      tem_seguro: num(record.insurance_value) > 0 || Boolean(record.has_insurance),
      product_code: record.product_code,
      product_description: record.product_description,
      convenio_code: record.convenio_code,
      convenio_type: record.convenio_type,
      convenio_segment: record.convenio_segment,
      insurance_type: record.insurance_type,
      production_value: companyProductionValue,
      movement_date: record.movement_date,
      contract_date: record.contract_date,
      proposal_date: record.proposal_date,
    },
    { trpProvider: provider }
  );
  const avistaEmpresa = num(operation?.credito?.avista_empresa);
  if (avistaEmpresa <= 0) return 0;
  return (avistaEmpresa / netValue) * 100;
}

// ---------------------------------------------------------------------------
// regime de cada competencia (fechada x aberta)
// ---------------------------------------------------------------------------
const regime = new Map<string, string>();
for (const c of comps) {
  const [y, m] = c.split("-").map(Number);
  const { data } = await sb
    .from("fechamento_mensal_empresa")
    .select("regime, company_id")
    .eq("year", y)
    .eq("month", m);
  const regs = [...new Set((data || []).map((x: any) => String(x.regime)))];
  regime.set(c, regs.length ? regs.join("/") : "(sem registro)");
}

console.log(D);
console.log("ANTES x DEPOIS — derive com producao do CNPJ vs producao do GRUPO");
console.log(D);
console.log(`\nCNPJs RR no grupo: ${rrIds.length}`);
console.log(`linhas na diaria: ${todos.length}`);

console.log("\n" + L);
console.log("BASE DA FAIXA, por competencia");
console.log(L);
console.log("comp     regime            producao do GRUPO      faixa    | producao por CNPJ (faixa)");
const grupoProd = new Map<string, number>();
const cnpjProd = new Map<string, number>();
for (const c of comps) {
  const doMes = todos.filter((r) => compDe(r) === c && rrIds.includes(r.company_id));
  const g = netValidProduction(doMes);
  grupoProd.set(c, g);
  const porCnpj: string[] = [];
  for (const id of rrIds) {
    const v = netValidProduction(doMes.filter((r) => r.company_id === id));
    cnpjProd.set(`${c}|${id}`, v);
    if (v > 0) porCnpj.push(`${String(nome.get(id)).slice(0, 13)} R$ ${brl(v)} ${getProductionBandByValue(v)}`);
  }
  console.log(
    `${c}  ${String(regime.get(c)).slice(0, 16).padEnd(16)}  R$ ${brl(g).padStart(14)}  ${getProductionBandByValue(g).padEnd(8)}`
  );
  for (const s of porCnpj) console.log(`             ${s}`);
}

// ---------------------------------------------------------------------------
// ANTES x DEPOIS por linha
// ---------------------------------------------------------------------------
console.log("\n" + L);
console.log("EFEITO POR COMPETENCIA — quantas linhas o derive mudaria de faixa");
console.log(L);
console.log("\ncomp     regime          linhas  derive MUDA  delta comissao-empresa   | com coluna JA gravada  com coluna VAZIA");

let totalMuda = 0;
let totalDelta = 0;
const mudam: any[] = [];
for (const c of comps) {
  const doMes = todos.filter((r) => compDe(r) === c && rrIds.includes(r.company_id) && ehProducao(r) && ehValida(r));
  if (!doMes.length) continue;
  const g = grupoProd.get(c) ?? 0;
  let nMuda = 0;
  let delta = 0;
  let comColuna = 0;
  let semColuna = 0;
  for (const r of doMes) {
    const antes = derive(r, cnpjProd.get(`${c}|${r.company_id}`) ?? 0);
    const depois = derive(r, g);
    if (Math.abs(depois - antes) < 0.0005) continue;
    nMuda += 1;
    delta += (num(r.net_value) * (depois - antes)) / 100;
    // o curto-circuito: a coluna gravada vence o derive (route.ts:118-121)
    const stored = num(r.company_received_percent);
    if (stored > 0 && stored <= 6.5) comColuna += 1;
    else semColuna += 1;
    mudam.push({ ...r, _comp: c, _antes: antes, _depois: depois });
  }
  totalMuda += nMuda;
  totalDelta += delta;
  console.log(
    `${c}  ${String(regime.get(c)).slice(0, 14).padEnd(14)}  ${String(doMes.length).padStart(6)} ${String(nMuda).padStart(12)}  R$ ${brl(delta).padStart(12)}   | ${String(comColuna).padStart(20)} ${String(semColuna).padStart(17)}`
  );
}
console.log(L);
console.log(`TOTAL: ${totalMuda} linhas mudariam de faixa; delta comissao-empresa R$ ${brl(totalDelta)}`);

console.log("\n" + L);
console.log("O CURTO-CIRCUITO — quantas linhas o conserto do derive REALMENTE alcanca");
console.log(L);
const alcanca = mudam.filter((r) => {
  const s = num(r.company_received_percent);
  return !(s > 0 && s <= 6.5);
});
console.log(`\n  linhas em que o derive daria resultado diferente ......... ${mudam.length}`);
console.log(`  dessas, com company_received_percent JA GRAVADA .......... ${mudam.length - alcanca.length}`);
console.log(`     -> getPersistedCompanyReceivedPercent devolve a COLUNA (route.ts:118-121)`);
console.log(`     -> o derive NAO e chamado. O conserto NAO as alcanca.`);
console.log(`  dessas, com a coluna vazia (o conserto alcanca) .......... ${alcanca.length}`);

// ---------------------------------------------------------------------------
// A prova contra o "% A VISTA" da Promotiva
// ---------------------------------------------------------------------------
console.log("\n" + L);
console.log('CONFERENCIA — o DEPOIS bate com o "% A VISTA" que a Promotiva carimba?');
console.log(L);
const fech = new Map<string, any>();
for (const id of rrIds) {
  for (let mes = 1; mes <= 12; mes++) {
    const linhas = await paginar<any>(() =>
      sb.from("monthly_closing_entries")
        .select("operation_number, contract_number, metadata")
        .eq("company_id", id).eq("year", 2026).eq("month", mes).eq("entry_type", "CASH")
    );
    for (const f of linhas)
      for (const k of [chaveNum(f.operation_number), chaveNum(f.contract_number)])
        if (k && !fech.has(k)) fech.set(k, f);
  }
}
let bateDepois = 0;
let bateAntes = 0;
let nenhum = 0;
let semLinha = 0;
for (const r of mudam) {
  const f = fech.get(chaveNum(r.proposal_number)) ?? fech.get(chaveNum(r.contract_number));
  if (!f) {
    semLinha += 1;
    continue;
  }
  const raw = num(f.metadata?.["% A VISTA"]);
  const prom = Math.abs(raw) > 1 ? raw : raw * 100;
  if (Math.abs(prom - r._depois) < 0.005) bateDepois += 1;
  else if (Math.abs(prom - r._antes) < 0.005) bateAntes += 1;
  else nenhum += 1;
}
console.log(`\n  linhas que mudam e ESTAO no fechamento: ${mudam.length - semLinha}   (ausentes: ${semLinha})`);
console.log(`     o % da Promotiva bate com o DEPOIS (faixa do grupo) ... ${bateDepois}`);
console.log(`     bate com o ANTES (faixa do CNPJ) ...................... ${bateAntes}`);
console.log(`     nao bate com nenhum .................................. ${nenhum}`);

console.log("\n" + D);
console.log("FIM — nada foi escrito no banco. Nenhum arquivo de codigo alterado.");
console.log(D);
