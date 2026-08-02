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

// INDEPENDENCIA DO DIA. Rodar no dia 1 ou 2 do mes torna a comparacao vacua: o
// recorte "ate o dia N" da competencia CORRENTE cobre 1 dia, e a rota devolve
// zero. Medido em 01/08/2026: N=1 contra os 24 da medida, producao atual 0.
// Pular com motivo NOMINAL e melhor que reprovar por causa da data — mas nao
// pode sumir do resumo, senao silencio vira falso OK.
if ((janela.diaCorteAtual ?? 0) < 3) {
  console.log(
    `
[PULO] N=${janela.diaCorteAtual} na competencia corrente: a janela ate-dia-N cobre ` +
    `menos de 3 dias e a comparacao seria vacua. Rode a partir do dia 3.`
  );
  process.exitCode = 0;
  process.exit(0);
}

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

// ---- as ancoras da MEDIDA C ----
//
// ATENCAO — ESTAS ANCORAS SAO ABSOLUTAS SOBRE DADO VIVO E JA ESTAO VELHAS.
// Medido em 01/08/2026, com N valido: `producao mes inteiro (anterior)` da
// 6.482.490,15 contra os 5.607.522,23 congelados aqui — julho cresceu depois
// que a medida foi cravada. Das 8 conferencias, 6 falham por isso e apenas 2
// falhavam pela data (o N), ja tratado pelo PULO acima.
//
// Ou seja: tornar o gate independente do dia NAO o deixa verde. Ele compara a
// rota VIVA contra um retrato CONGELADO, o que so funciona no dia em que o
// retrato foi tirado. Enquanto isso nao for decidido (reancorar, e envelhecer
// de novo no mes que vem; ou reescrever para comparar rota x recalculo
// independente, ambos vivos) ele NAO entra no run_all_gates — registrar
// vermelho conhecido treina todo mundo a ignorar o runner.
const ESPERADO = {
  prodAtual: 5243424.32,
  prodAnterior: 5607522.23,
  linhasAtual: 633,
  linhasAnterior: 724,
  n: 24,
  nAnterior: 24,
  atual: 170828.97,
  anterior: 164533.04,
};

const checks: Array<[string, number | null, number | null]> = [
  ["producao mes inteiro (atual)", prodAtual.total, ESPERADO.prodAtual],
  ["producao mes inteiro (anterior)", prodAnterior.total, ESPERADO.prodAnterior],
  ["linhas na competencia (atual)", prodAtual.linhas, ESPERADO.linhasAtual],
  ["linhas na competencia (anterior)", prodAnterior.linhas, ESPERADO.linhasAnterior],
  ["N do mes corrente", janela.diaCorteAtual, ESPERADO.n],
  ["N do mes anterior", janela.diaCorteAnterior, ESPERADO.nAnterior],
  ["comissao recortada (atual)", atual.total, ESPERADO.atual],
  ["comissao recortada (anterior)", anterior.total, ESPERADO.anterior],
];

console.log("\n" + "-".repeat(78));
console.log("CONFERENCIA contra a MEDIDA C (janela propria, 15 de dois meses antes)");
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
