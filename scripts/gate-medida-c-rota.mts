// ============================================================================
// GATE DA MEDIDA C — a rota, com a query DELA, chega no numero medido?
//
// A MEDIDA C mediu com uma janela propria (dois meses para tras, dia 15). A
// rota usa a janela dela, recorteRange (dashboard/route.ts:258-262), que comeca
// no dia 20 de dois meses antes. Se essa janela decapitasse a competencia do
// M-1 — que comeca no ultimo dia UTIL do mes anterior — a rota somaria meio mes
// e a variacao sairia inventada, exatamente o erro que a primeira rodada da
// MEDIDA C cometeu (janela comecando em 15/06 -> junho com 364 linhas em vez de
// 724, variacao +100,4% em vez de +3,8%).
//
// Este gate roda a query da ROTA, com as colunas da ROTA, e confere contra os
// valores medidos.
//
// Somente leitura. npx tsx scripts/gate-medida-c-rota.mts
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

const { calcularComissaoEmpresaRecortada, calcularProducaoMensalDoGrupo } = await import(
  "../lib/promoterAnalytics.ts"
);
const { buildTrpCreditProvider } = await import("../lib/trp/creditTrpProvider.ts");
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");
const { resolverJanela, competenciaAnterior } = await import("../lib/delta/calcularDelta.ts");
const { nowInFortaleza } = await import("../lib/dateFortaleza.ts");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: unknown) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// ---- exatamente o que a rota faz ----
const agora = nowInFortaleza();
const competencia = { year: agora.year, month: agora.month };
const compAnterior = competenciaAnterior(competencia);
const doisMesesAntes = competenciaAnterior(compAnterior);
const mesSeguinte = {
  year: competencia.month === 12 ? competencia.year + 1 : competencia.year,
  month: competencia.month === 12 ? 1 : competencia.month + 1,
};
const recorteRange = {
  inicio: `${doisMesesAntes.year}-${String(doisMesesAntes.month).padStart(2, "0")}-20`,
  fim: `${mesSeguinte.year}-${String(mesSeguinte.month).padStart(2, "0")}-10`,
};

// COLUNAS DA ROTA — copiadas do select de dailyRecorte.
const COLUNAS_DA_ROTA =
  "id, company_id, status, is_srcc_restricted, net_value, movement_date, cancellation_date, insurance_commission_amount, contract_date, proposal_date, gross_value, insurance_value, has_insurance, interest_rate, term_months, installments, product_description, company_received_percent, raw_payload";

const passo = 1000;
let de = 0;
const dailyRecorte: any[] = [];
for (;;) {
  const { data, error } = await supabase
    .from("daily_production_records")
    .select(COLUNAS_DA_ROTA)
    .gte("movement_date", recorteRange.inicio)
    .lt("movement_date", recorteRange.fim)
    .range(de, de + passo - 1);
  if (error) throw new Error(error.message);
  dailyRecorte.push(...(data || []));
  if (!data || data.length < passo) break;
  de += passo;
}

console.log("=".repeat(78));
console.log("GATE DA MEDIDA C — a query da ROTA");
console.log("=".repeat(78));
console.log(`recorteRange: ${recorteRange.inicio} .. ${recorteRange.fim}`);
console.log(`linhas carregadas: ${dailyRecorte.length}`);

// janela (mesma logica da rota, Fase 2.1)
const empresas = await supabase.from("companies").select("id").eq("active", true);
const idsAtivas = new Set((empresas.data || []).map((c: any) => c.id));
const emProducao = (s: unknown) => norm(s) === "PRODUCAO" || norm(s) === "PRODUCTION";
const valido = (r: any) =>
  !r.cancellation_date &&
  !/CANCEL|ESTORN|RECUS/.test(norm(r.status)) &&
  !/PEND|ANALIS|PROCESS/.test(norm(r.status)) &&
  r.is_srcc_restricted !== true;

const prefixo = `${competencia.year}-${String(competencia.month).padStart(2, "0")}-`;
const diasComDado = new Set<number>();
for (const r of dailyRecorte) {
  if (!r.company_id || !idsAtivas.has(r.company_id)) continue;
  if (!emProducao(r.status) || !valido(r)) continue;
  const p = getProductionPeriodFromValue(r.movement_date);
  if (!p || p.year !== competencia.year || p.month !== competencia.month) continue;
  const b = String(r.movement_date ?? "");
  if (!b.startsWith(prefixo)) continue;
  const d = Number(b.slice(8, 10));
  if (d >= 1 && d <= 31) diasComDado.add(d);
}
const janela = resolverJanela({
  competencia,
  modo: "ate-dia-N",
  dia: agora.day,
  diasComDadoNoMesCorrente: diasComDado,
});

// O PULO POR N<3 FOI REMOVIDO em 01/08/2026, junto com as ancoras congeladas.
// Ele existia porque as 8 conferencias antigas comparavam o recorte "ate o dia
// N" contra um retrato: no dia 1 do mes N=1 e a comparacao ficava vacua. A
// invariante que ficou no lugar — a janela da rota contem a competencia M-1
// inteira — NAO depende do dia em que se roda, entao o gate voltou a valer todo
// dia. Os numeros de producao/comissao abaixo continuam impressos como
// DIAGNOSTICO; nenhum deles e mais assercao.
const prodAtual = calcularProducaoMensalDoGrupo({ records: dailyRecorte, competencia });
const prodAnterior = calcularProducaoMensalDoGrupo({ records: dailyRecorte, competencia: compAnterior });
const trpProvider = await buildTrpCreditProvider(dailyRecorte.map((r) => r.contract_date));

const atual = calcularComissaoEmpresaRecortada({
  records: dailyRecorte,
  competencia,
  producaoMensalDoGrupo: prodAtual.total,
  ateDia: janela.diaCorteAtual,
  trpProvider,
});
const anterior = calcularComissaoEmpresaRecortada({
  records: dailyRecorte,
  competencia: compAnterior,
  producaoMensalDoGrupo: prodAnterior.total,
  ateDia: janela.diaCorteAnterior,
  trpProvider,
});

console.log(
  `\nproducao mes inteiro:  atual R$ ${brl(prodAtual.total)} (${prodAtual.linhas} linhas)` +
    `   anterior R$ ${brl(prodAnterior.total)} (${prodAnterior.linhas} linhas)`
);
console.log(`janela: N=${janela.diaCorteAtual} / ${janela.diaCorteAnterior}`);
console.log(
  `\ncomissao bruta recortada:` +
    `\n  atual    R$ ${brl(atual.total)}   (${atual.linhasSomadas} de ${atual.linhasNaCompetencia} linhas)` +
    `\n  anterior R$ ${brl(anterior.total)}   (${anterior.linhasSomadas} de ${anterior.linhasNaCompetencia} linhas)` +
    `\n  variacao ${(((atual.total - anterior.total) / anterior.total) * 100).toFixed(1)}%`
);

// ---------------------------------------------------------------------------
// VIVO x VIVO — os dois lados computados NESTE run, por queries DIFERENTES
// ---------------------------------------------------------------------------
// A versao anterior comparava a rota contra 8 valores ABSOLUTOS congelados
// (producao 5.243.424,32, 633 linhas, comissao 170.828,97 ...). Medido em
// 01/08/2026: julho tinha crescido de 5.607.522,23 para 6.482.490,15 e as 8
// conferencias falhavam. Retrato so vale no dia em que foi tirado.
//
// O que este gate defende NAO e um numero: e que a JANELA DA ROTA
// (recorteRange, que comeca no dia 20 de dois meses antes) NAO DECAPITE a
// competencia M-1, que comeca no ultimo dia UTIL do mes anterior. Isso se
// verifica sem retrato nenhum.
//
// DE ONDE VEM CADA LADO — se os dois saissem da mesma query o gate passaria por
// CONSTRUCAO e nao provaria nada:
//   LADO A (rota)          `dailyRecorte` — query COM o filtro
//                          movement_date >= recorteRange.inicio e < fim.
//   LADO B (independente)  `universoDiario` — query SEM janela nenhuma; a
//                          competencia sai linha a linha de
//                          getProductionPeriodFromValue.
// Duas idas ao banco, com predicados diferentes.
const universoDiario: any[] = [];
{
  let d2 = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("daily_production_records")
      .select("id, company_id, status, is_srcc_restricted, net_value, movement_date, cancellation_date")
      .order("id")
      .range(d2, d2 + passo - 1);
    if (error) throw new Error(error.message);
    universoDiario.push(...(data || []));
    if (!data || data.length < passo) break;
    d2 += passo;
  }
}
const daComp = (r: any, c: { year: number; month: number }) => {
  const p = getProductionPeriodFromValue(r.movement_date);
  return !!p && p.year === c.year && p.month === c.month;
};
const elegivelAqui = (r: any) =>
  !!r.company_id && idsAtivas.has(r.company_id) && emProducao(r.status) && valido(r);

const idsRotaM1 = new Set(dailyRecorte.filter((r) => elegivelAqui(r) && daComp(r, compAnterior)).map((r) => r.id));
const idsIndepM1 = new Set(universoDiario.filter((r) => elegivelAqui(r) && daComp(r, compAnterior)).map((r) => r.id));
const faltamNaRota = [...idsIndepM1].filter((id) => !idsRotaM1.has(id));
const sobramNaRota = [...idsRotaM1].filter((id) => !idsIndepM1.has(id));
const liqPerdido = universoDiario.filter((r) => faltamNaRota.includes(r.id)).reduce((a, r) => a + Number(r.net_value || 0), 0);
const rotM1 = `${compAnterior.year}-${String(compAnterior.month).padStart(2, "0")}`;

console.log("");
console.log("-".repeat(78));
console.log("VIVO x VIVO — a janela da rota contem a competencia M-1 inteira?");
console.log("-".repeat(78));
console.log(`  LADO A  rota (janela ${recorteRange.inicio}..${recorteRange.fim}) ve ${idsRotaM1.size} linhas de ${rotM1}`);
console.log(`  LADO B  independente (sem janela, competencia por linha)  ve ${idsIndepM1.size} linhas de ${rotM1}`);
console.log(`  [nao-vacuidade] LADO B varreu ${universoDiario.length} linhas numa query PROPRIA, sem reusar a da rota`);
if (idsIndepM1.size === 0) console.log("  [ATENCAO] a competencia M-1 esta VAZIA — o gate passaria por vacuidade, nao por merito.");

const checks: Array<[string, number | null, number | null]> = [
  ["linhas da M-1 vistas pela rota", idsRotaM1.size, idsIndepM1.size],
  ["linhas da M-1 que a rota PERDE", faltamNaRota.length, 0],
  ["linhas que a rota inclui a MAIS", sobramNaRota.length, 0],
  ["liquido perdido pela janela", Math.round(liqPerdido * 100) / 100, 0],
];

console.log("\n" + "-".repeat(78));
console.log("CONFERENCIA — rota x recalculo independente, ambos DESTE run");
console.log("-".repeat(78));
let falhas = 0;
for (const [nome, obtido, esperado] of checks) {
  const ok = Math.abs((obtido ?? 0) - (esperado ?? 0)) < 0.005;
  if (!ok) falhas += 1;
  console.log(
    `  ${ok ? "OK  " : "FALHA"} ${nome.padEnd(34)} rota ${String(obtido).padStart(14)}  medida ${String(esperado).padStart(14)}`
  );
}

if (falhas) {
  console.log(
    `\n>>> GATE REPROVADO: ${falhas} divergencia(s). A janela da rota nao ve o mesmo conjunto.`
  );
  process.exitCode = 1;
} else {
  console.log("\n>>> GATE OK: a janela e as colunas da rota reproduzem a MEDIDA C.");
}
