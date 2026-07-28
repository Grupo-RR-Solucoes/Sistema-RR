// ============================================================================
// MAPA — SRCC nao resolvido pelo fechamento. LEITURA, nao conserta nada.
//
// Cobre os 5 pontos do levantamento. Usa as funcoes REAIS do repo
// (getSrccEstado, getSrccRestrictionLabel) em vez de reimplementar a regra.
//
// npx tsx scripts/mapa-srcc-resolucao.mts
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

const { getSrccEstado, getSrccRestrictionLabel } = await import(
  "../lib/proposalDetailing.ts"
);
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const L = "-".repeat(96);
const D = "=".repeat(96);

async function pagina(tabela: string, colunas: string, aplicar: (q: any) => any) {
  const passo = 1000;
  let de = 0;
  const out: any[] = [];
  for (;;) {
    // ORDER estavel: sem ele a paginacao do PostgREST perde/duplica linha.
    const { data, error } = await aplicar(
      sb.from(tabela).select(colunas).order("id")
    ).range(de, de + passo - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return out;
}

const { data: empresas } = await sb.from("companies").select("id, name, cnpj");
const empPorId = new Map((empresas || []).map((e: any) => [e.id, e]));
const gestora = (id: string) =>
  String(empPorId.get(id)?.name ?? "").toUpperCase().includes("ADS") ? "ADS" : "RR";

// ---------------------------------------------------------------- diaria ---
const diaria = await pagina(
  "daily_production_records",
  "id, company_id, proposal_number, contract_number, status, is_srcc_restricted," +
    " net_value, movement_date, contract_date, proposal_date, raw_payload," +
    " promoter_commission_amount, assigned_promoter_id",
  (q) => q.gte("movement_date", "2026-01-01").lt("movement_date", "2027-01-01")
);

const compDe = (r: any) => {
  const p =
    getProductionPeriodFromValue(r.movement_date) ||
    getProductionPeriodFromValue(r.contract_date) ||
    getProductionPeriodFromValue(r.proposal_date);
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}` : "??";
};

console.log(D);
console.log("MAPA — SRCC nao resolvido pelo fechamento");
console.log(D);
console.log(`linhas da diaria em 2026: ${diaria.length}`);

// =========================================================================
// ITEM 5 — volume por competencia e estado
// =========================================================================
console.log("\n" + D);
console.log("ITEM 5 — VOLUME DE 'CONSULTA NAO REALIZADA' POR COMPETENCIA");
console.log(D);

type Cel = { restrito: number; indefinido: number; semInfo: number; neutro: number; total: number };
const porComp = new Map<string, Map<string, Cel>>();
for (const r of diaria) {
  const c = compDe(r);
  const g = gestora(r.company_id);
  if (!porComp.has(c)) porComp.set(c, new Map());
  const m = porComp.get(c)!;
  if (!m.has(g)) m.set(g, { restrito: 0, indefinido: 0, semInfo: 0, neutro: 0, total: 0 });
  const cel = m.get(g)!;
  const e = getSrccEstado(r);
  cel.total += 1;
  if (e === "restrito") cel.restrito += 1;
  else if (e === "indefinido") cel.indefinido += 1;
  else if (e === "sem-info") cel.semInfo += 1;
  else cel.neutro += 1;
}
console.log("\ncomp     gest   total   restrito  INDEFINIDO  sem-info   neutro");
for (const c of [...porComp.keys()].sort()) {
  for (const [g, v] of [...porComp.get(c)!.entries()].sort()) {
    console.log(
      `${c}  ${g.padEnd(4)} ${String(v.total).padStart(7)}   ${String(v.restrito).padStart(7)}  ` +
        `${String(v.indefinido).padStart(9)}  ${String(v.semInfo).padStart(8)}  ${String(v.neutro).padStart(7)}`
    );
  }
}

// =========================================================================
// ITEM 1 — o fechamento carrega a resposta?
// =========================================================================
console.log("\n" + D);
console.log("ITEM 1 — O FECHAMENTO CARREGA A RESPOSTA?");
console.log(D);

const fech = await pagina(
  "monthly_closing_entries",
  "id, company_id, year, month, entry_type, operation_number, contract_number, commission_value, net_value, metadata",
  (q) => q.eq("year", 2026).eq("entry_type", "CASH")
);
console.log(`\nlinhas CASH do fechamento em 2026: ${fech.length}`);

const A_SRCC = ["RESTRIÇÃO SRCC", "RESTRICAO SRCC", "INDICADOR RESTRIÇÃO SRCC"];
const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
function mget(meta: any, chaves: string[]) {
  if (!meta || typeof meta !== "object") return null;
  for (const k of Object.keys(meta)) {
    if (chaves.some((c) => norm(c) === norm(k))) {
      const v = meta[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") return v;
    }
  }
  return null;
}

const comSrcc = fech.filter((f) => mget(f.metadata, A_SRCC) != null);
console.log(`  com coluna RESTRICAO SRCC no metadata: ${comSrcc.length} (${((comSrcc.length / Math.max(1, fech.length)) * 100).toFixed(1)}%)`);
const valores = new Map<string, number>();
for (const f of comSrcc) {
  const v = String(mget(f.metadata, A_SRCC));
  valores.set(v, (valores.get(v) || 0) + 1);
}
console.log("  valores distintos:");
for (const [v, n] of [...valores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`      "${v}"  ->  ${n}`);
}

// =========================================================================
// ITEM 2 — as INDEFINIDAS de competencia FECHADA, cruzadas com o fechamento
// =========================================================================
console.log("\n" + D);
console.log("ITEM 2 — AS INDEFINIDAS DE COMPETENCIA FECHADA x FECHAMENTO");
console.log(D);

const { detectMonthRegime } = await import("../lib/cmsMonthly.ts");
const comps = [...porComp.keys()].filter((c) => c !== "??").sort();
const regime = new Map<string, string>();
for (const c of comps) {
  const [y, m] = c.split("-").map(Number);
  regime.set(c, await detectMonthRegime(sb, y, m).catch(() => "open"));
}
console.log("\nregime: " + comps.map((c) => `${c}=${regime.get(c)}`).join("  "));

const indefinidasFechadas = diaria.filter(
  (r) => getSrccEstado(r) === "indefinido" && regime.get(compDe(r)) !== "open"
);
console.log(`\nINDEFINIDAS em competencia FECHADA: ${indefinidasFechadas.length}`);

// indice do fechamento por (proposta|contrato) + competencia
const chave = (v: unknown) => String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");
const fechIdx = new Map<string, any[]>();
for (const f of fech) {
  const comp = `${f.year}-${String(f.month).padStart(2, "0")}`;
  for (const k of [chave(f.operation_number), chave(f.contract_number)]) {
    if (!k) continue;
    const kk = `${comp}|${k}`;
    if (!fechIdx.has(kk)) fechIdx.set(kk, []);
    fechIdx.get(kk)!.push(f);
  }
}

type Cruz = {
  r: any;
  achou: boolean;
  pago: boolean;
  srccFech: string | null;
};
const cruz: Cruz[] = [];
for (const r of indefinidasFechadas) {
  const comp = compDe(r);
  const cands = [
    ...(fechIdx.get(`${comp}|${chave(r.proposal_number)}`) || []),
    ...(fechIdx.get(`${comp}|${chave(r.contract_number)}`) || []),
  ];
  const f = cands[0] ?? null;
  cruz.push({
    r,
    achou: !!f,
    pago: !!f && num(f.commission_value) > 0,
    srccFech: f ? (mget(f.metadata, A_SRCC) as string | null) : null,
  });
}

const achadas = cruz.filter((c) => c.achou);
const pagas = cruz.filter((c) => c.pago);
const naoPagas = cruz.filter((c) => c.achou && !c.pago);
const ausentes = cruz.filter((c) => !c.achou);

console.log(`  achadas no fechamento .......... ${achadas.length}`);
console.log(`    PAGAS (comissao > 0) ......... ${pagas.length}   -> nao havia restricao`);
console.log(`    NAO pagas (comissao = 0) ..... ${naoPagas.length}   -> havia (ou outro motivo)`);
console.log(`  AUSENTES do fechamento ......... ${ausentes.length}   -> sem resposta`);

const srccDoFech = new Map<string, number>();
for (const c of achadas) {
  const v = c.srccFech == null ? "(sem coluna)" : String(c.srccFech);
  srccDoFech.set(v, (srccDoFech.get(v) || 0) + 1);
}
console.log("\n  o que o fechamento DIZ do SRCC dessas linhas:");
for (const [v, n] of [...srccDoFech.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`      "${v}"  ->  ${n}`);
}

// =========================================================================
// ITEM 3 — O DINHEIRO NA TRANSICAO
// =========================================================================
console.log("\n" + D);
console.log("ITEM 3 — O DINHEIRO NA TRANSICAO");
console.log(D);

const comComissao = cruz.filter((c) => num(c.r.promoter_commission_amount) > 0);
const comComissaoENaoPagas = comComissao.filter((c) => c.achou && !c.pago);
const comComissaoEAusentes = comComissao.filter((c) => !c.achou);

console.log(`\n  das ${cruz.length} indefinidas fechadas:`);
console.log(
  `    com comissao de promotor computada .... ${comComissao.length}  ·  R$ ${brl(comComissao.reduce((s, c) => s + num(c.r.promoter_commission_amount), 0))}`
);
console.log(
  `      dessas, o fechamento NAO pagou ...... ${comComissaoENaoPagas.length}  ·  R$ ${brl(comComissaoENaoPagas.reduce((s, c) => s + num(c.r.promoter_commission_amount), 0))}`
);
console.log(
  `      dessas, ausentes do fechamento ...... ${comComissaoEAusentes.length}  ·  R$ ${brl(comComissaoEAusentes.reduce((s, c) => s + num(c.r.promoter_commission_amount), 0))}`
);

// O valor ainda esta no PMR? O PMR do mes fechado e escrito pelo consolidador;
// comparamos a soma por promotor/competencia.
const suspeitas = [...comComissaoENaoPagas, ...comComissaoEAusentes];
if (suspeitas.length) {
  console.log("\n  DETALHE das linhas com comissao computada e sem pagamento no fechamento:");
  console.log("  prop         comp     gest  net            comissao    no fechamento");
  for (const c of suspeitas.slice(0, 40)) {
    console.log(
      `  ${String(c.r.proposal_number).padEnd(12)} ${compDe(c.r)}  ${gestora(c.r.company_id).padEnd(4)} ` +
        `${brl(num(c.r.net_value)).padStart(13)}  ${brl(num(c.r.promoter_commission_amount)).padStart(9)}   ` +
        `${c.achou ? "achada, comissao 0" : "AUSENTE"}`
    );
  }
}

// =========================================================================
// ITEM 4 — quem le is_srcc_restricted (superficie de risco do rewrite)
// =========================================================================
console.log("\n" + D);
console.log("ITEM 4 — SUPERFICIE DE RISCO: quem LE is_srcc_restricted");
console.log(D);
console.log(`
  (a varredura de codigo esta no relatorio; aqui so o dado)
`);
const pmr = await pagina(
  "promoter_monthly_results",
  "id, year, month, promoter_id, company_id, production_value, production_commission_value, final_commission_value, source",
  (q) => q.eq("year", 2026)
);
const pmrPorComp = new Map<string, { n: number; prod: number; com: number; sources: Set<string> }>();
for (const p of pmr) {
  const c = `2026-${String(p.month).padStart(2, "0")}`;
  if (!pmrPorComp.has(c)) pmrPorComp.set(c, { n: 0, prod: 0, com: 0, sources: new Set() });
  const v = pmrPorComp.get(c)!;
  v.n += 1;
  v.prod += num(p.production_value);
  v.com += num(p.final_commission_value);
  v.sources.add(String(p.source ?? "(null)"));
}
console.log("comp     linhas   producao          comissao final    source");
for (const c of [...pmrPorComp.keys()].sort()) {
  const v = pmrPorComp.get(c)!;
  console.log(
    `${c}  ${String(v.n).padStart(6)}   ${brl(v.prod).padStart(15)}  ${brl(v.com).padStart(15)}   ${[...v.sources].join(",")}`
  );
}
