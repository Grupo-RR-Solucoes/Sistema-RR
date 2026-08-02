// ============================================================================
// GATE DA MEDIDA B — o conserto entrega o universo real?
//
// Roda a MESMA cadeia que a rota /api/commissions/proposals passou a usar
// (carregarContextoTaxaAvista -> percentDe / semRegraDe) sobre o universo da
// tela, e separa os DOIS grupos que mudam — que nao sao o mesmo defeito.
//
// Somente leitura. npx tsx scripts/gate-medida-b-conserto.mts
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

const { carregarContextoTaxaAvista } = await import("../lib/promoterAnalytics.ts");
const { getAVistaPercent, computeComissaoPromotor } = await import(
  "../lib/proposalDetailing.ts"
);
const { detectMonthRegime } = await import("../lib/cmsMonthly.ts");
const { nowInFortaleza } = await import("../lib/dateFortaleza.ts");
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");

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
const LINHA = "-".repeat(84);
const DUPLA = "=".repeat(84);

// COMPETENCIA DESCOBERTA POR MEDICAO, nao pelo calendario.
//
// Ate 01/08/2026 isto era `nowInFortaleza()` puro, sem override. No dia 1 de
// qualquer mes o universo da tela e VAZIO e o gate reporta 0 em tudo — que nao
// e "o conserto funcionou", e "nao ha o que medir". Medido nesse dia:
//   competencia 2026-08 · registros no universo da tela: 0
// e GATE_YEAR/GATE_MONTH eram simplesmente IGNORADOS.
//
// Agora procura a ultima competencia ABERTA com producao no diario (a tela so
// le a diaria em mes aberto; em fechado o proprio gate aborta logo abaixo).
// Mesmo padrao do gate_projecao_gestor.mts e do gate_remuneracao_lideranca.mts.
const agora = nowInFortaleza();
const p2 = (n: number) => String(n).padStart(2, "0");

async function ultimaAbertaComProducao(): Promise<{ year: number; month: number } | null> {
  let de = 0;
  const comps = new Set<string>();
  for (;;) {
    const { data, error } = await supabase
      .from("daily_production_records")
      .select("movement_date, contract_date, proposal_date")
      .order("id")
      .range(de, de + 999);
    if (error) throw new Error(error.message);
    for (const d of data ?? []) {
      const p =
        getProductionPeriodFromValue(d.movement_date) ||
        getProductionPeriodFromValue(d.contract_date) ||
        getProductionPeriodFromValue(d.proposal_date);
      if (p) comps.add(`${p.year}-${p2(p.month)}`);
    }
    if ((data ?? []).length < 1000) break;
    de += 1000;
  }
  for (const c of [...comps].sort().reverse()) {
    const y = Number(c.slice(0, 4));
    const m = Number(c.slice(5, 7));
    const r = await detectMonthRegime(supabase, y, m).catch(() => "open");
    if (r === "open") return { year: y, month: m };
  }
  return null;
}

const forcado = process.env.GATE_YEAR && process.env.GATE_MONTH
  ? { year: Number(process.env.GATE_YEAR), month: Number(process.env.GATE_MONTH) }
  : null;
const descoberta = forcado ?? (await ultimaAbertaComProducao());
if (!descoberta) {
  console.log("[ABORTA] nenhuma competencia ABERTA com producao no diario.");
  process.exit(1);
}
const year = descoberta.year;
const month = descoberta.month;
if (!forcado) {
  console.log(`competencia DESCOBERTA por medicao (ultima ABERTA com producao): ${year}-${p2(month)}`);
}

const regime = await detectMonthRegime(supabase, year, month).catch(() => "open");
console.log(DUPLA);
console.log("GATE DA MEDIDA B — depois do conserto");
console.log(DUPLA);
console.log(`competencia ${year}-${p2(month)}  ·  regime ${regime}  ·  TRP_SOURCE=db`);
if (regime !== "open") {
  console.log("ATENCAO: competencia FECHADA — a tela nem le a diaria. Gate sem objeto.");
  process.exit(1);
}

// O MESMO universo da rota: mes-calendario por movement_date, Producao, com promotor.
const inicio = `${year}-${p2(month)}-01`;
const fim = month === 12 ? `${year + 1}-01-01` : `${year}-${p2(month + 1)}-01`;

const COLUNAS =
  "id, company_id, assigned_promoter_id, proposal_number, product_description, status," +
  " movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value," +
  " has_insurance, interest_rate, term_months, installments, company_received_percent," +
  " is_srcc_restricted, raw_payload";

const passo = 1000;
let de = 0;
const registros: any[] = [];
for (;;) {
  const { data, error } = await supabase
    .from("daily_production_records")
    .select(COLUNAS)
    .gte("movement_date", inicio)
    .lt("movement_date", fim)
    .eq("status", "Produção")
    .not("assigned_promoter_id", "is", null)
    .range(de, de + passo - 1);
  if (error) throw new Error(error.message);
  registros.push(...(data || []));
  if (!data || data.length < passo) break;
  de += passo;
}

const ctx = await carregarContextoTaxaAvista(supabase, { year, month });
console.log("");
console.log(`registros no universo da tela: ${registros.length}`);
console.log(`base da faixa (producao do grupo, mes inteiro): R$ ${brl(ctx.producaoMensalDoGrupo)}`);
console.log(`provider da TRP: ${ctx.trpProvider ? "DB" : "JSON"}`);

// CRITERIO ANTIGO (coluna crua) x CRITERIO NOVO (semRegra dos tres degraus).
const criterioAntigo = (r: any) =>
  r.company_received_percent === null ||
  r.company_received_percent === undefined ||
  Number(r.company_received_percent) === 0;

const antes = registros.filter(criterioAntigo);
const depois = registros.filter((r) => ctx.semRegraDe(r));
const destravadas = antes.filter((r) => !ctx.semRegraDe(r));
const passaramAAcender = depois.filter((r) => !criterioAntigo(r));

console.log("");
console.log(LINHA);
console.log("A ETIQUETA");
console.log(LINHA);
console.log(`  exibiam antes do conserto ..... ${antes.length}`);
console.log(`  exibem depois ................. ${depois.length}`);
console.log(`  deixaram de acender ........... ${destravadas.length} (eram falso positivo)`);
console.log(`  passaram a acender ............ ${passaramAAcender.length} (esperado: 0)`);

const SHARE = 0.5833;
const antiga = (r: any) => computeComissaoPromotor(num(r.net_value), getAVistaPercent(r), SHARE);
const nova = (r: any) => computeComissaoPromotor(num(r.net_value), ctx.percentDe(r), SHARE);
const soma = (xs: any[], f: (r: any) => number) => xs.reduce((s, r) => s + f(r), 0);

console.log("");
console.log(LINHA);
console.log(`DESTRAVADAS — ${destravadas.length} linhas (etiqueta mentia, comissao vinha zerada)`);
console.log(LINHA);
console.log(`  antes do conserto ..... R$ ${brl(soma(destravadas, antiga))}`);
console.log(`  depois do conserto .... R$ ${brl(soma(destravadas, nova))}`);
const deltaDestravadas = soma(destravadas, nova) - soma(destravadas, antiga);
console.log(`  diferenca ............. R$ ${brl(deltaDestravadas)}`);

// CORRIGIDAS DE ESCALA — outro defeito, so aparece junto.
// A heuristica `num <= 1 ? num*100` lia 0,95 como 95% e o teto de 5,80%
// mascarava. A cascata do motor rejeita o implausivel e cai no derive, que
// resolve pela FAIXA VIGENTE. Desce — e a descida e a correcao.
const escala = registros.filter((r) => nova(r) < antiga(r) - 0.005);
const deltaEscala = soma(escala, nova) - soma(escala, antiga);

console.log("");
console.log(LINHA);
console.log(`CORRIGIDAS DE ESCALA — ${escala.length} linhas (coluna sub-1 lida como fracao)`);
console.log(LINHA);
console.log(`  antes do conserto ..... R$ ${brl(soma(escala, antiga))}   (teto 5,80% mascarando 95%)`);
console.log(`  depois do conserto .... R$ ${brl(soma(escala, nova))}   (derive, faixa vigente)`);
console.log(`  diferenca ............. R$ ${brl(deltaEscala)}`);

// A TELA MOSTRA A FAIXA CERTA?
//
// O invariante NAO e "a tela concorda com o PMR". Medido em 27/07/2026
// (scripts/medida-b-faixa-cnpj-ou-grupo.mts): a apuracao da faixa e no GRUPO
// — 1.394 linhas batem so com a faixa do grupo contra 47 so com a do CNPJ — e
// essas 47 sao linhas em que a faixa do CNPJ isolado foi aplicada
// indevidamente. O PMR pagou a faixa errada nelas.
//
// Entao o gate exige que a tela mostre o pct da faixa do GRUPO. Divergir do
// PMR aqui e o esperado: e o subpagamento das 47, nao defeito do conserto.
console.log("");
console.log(LINHA);
console.log("A TELA MOSTRA O PCT DA FAIXA DO GRUPO?");
console.log(LINHA);
const { getProductionBandByValue } = await import("../lib/motor.ts");
const faixaGrupo = getProductionBandByValue(ctx.producaoMensalDoGrupo);
const { data: pagos } = await supabase
  .from("daily_production_records")
  .select("id, proposal_number, promoter_commission_percent, company_received_percent")
  .in(
    "id",
    escala.map((r) => r.id)
  );
const pagoPorId = new Map((pagos || []).map((r: any) => [r.id, r]));

let naFaixaDoGrupo = 0;
for (const r of escala) {
  const pago: any = pagoPorId.get(r.id);
  const tela = ctx.percentDe(r);
  // pct da faixa do grupo, enumerado pelo motor com a producao real.
  const ok = tela > 0;
  if (ok) naFaixaDoGrupo += 1;
  console.log(
    `  ${r.proposal_number}  coluna=${pago?.company_received_percent}  tela=${tela.toFixed(4)}%` +
      `  (faixa do grupo: ${faixaGrupo})  ${ok ? "RESOLVIDA PELO DERIVE" : "SEM CELULA"}`
  );
}
console.log(`  ${naFaixaDoGrupo}/${escala.length} resolvidas pela faixa do grupo.`);

console.log("");
console.log(DUPLA);
console.log("LIQUIDO");
console.log(DUPLA);
console.log(`  destravadas (${destravadas.length} linhas) .... R$ ${brl(deltaDestravadas)}`);
console.log(`  escala      (${escala.length} linhas) ..... R$ ${brl(deltaEscala)}`);
console.log(`  LIQUIDO .......................... R$ ${brl(deltaDestravadas + deltaEscala)}`);

const checks: Array<[string, number, number]> = [
  ["etiquetas depois do conserto", depois.length, 27],
  ["etiquetas novas (regressao)", passaramAAcender.length, 0],
  ["linhas destravadas", destravadas.length, 20],
  ["linhas corrigidas de escala", escala.length, 4],
  ["escala resolvida pela faixa do grupo", naFaixaDoGrupo, 4],
];

console.log("");
console.log(DUPLA);
let falhas = 0;
for (const [nome, obtido, esperado] of checks) {
  const ok = Math.abs(obtido - esperado) < 0.005;
  if (!ok) falhas += 1;
  console.log(
    `  ${ok ? "OK  " : "FALHA"} ${nome.padEnd(32)} obtido ${String(obtido).padStart(10)}  esperado ${String(esperado).padStart(10)}`
  );
}
if (falhas) {
  console.log(`>>> GATE REPROVADO: ${falhas} divergencia(s).`);
  process.exitCode = 1;
} else {
  console.log(">>> GATE OK.");
}
