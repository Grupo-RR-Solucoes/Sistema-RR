// ============================================================================
// MEDIDA C — quanto muda o card "Comissao bruta (empresa)" se a rota do painel
// principal for ligada em calcularComissaoEmpresaRecortada.
//
// Roda ANTES de mexer na rota, de proposito: o numero decide se a ligacao vale
// (e expoe o efeito colateral que a conta escondia — ver "TROCA DE FONTE").
//
// NAO REESCREVE A REGRA DE DINHEIRO. Importa e chama a funcao de verdade,
// calcularComissaoEmpresaRecortada (lib/promoterAnalytics.ts), com os dois
// parametros separados exatamente como a rota vai chamar:
//
//   producaoMensalDoGrupo  producao do MES INTEIRO, nas DUAS competencias
//   ateDia                 so decide QUAIS linhas somam
//
// Somente leitura. Rode com:  npx tsx scripts/medida-c-comissao-recortada.mts
// (.mts porque tem await no topo — .ts daria "await is only valid in async".)
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
// ARMADILHA CONHECIDA: em producao TRP_SOURCE=db. Sem isto o script leria o
// JSON embutido e devolveria comissao diferente da que a tela mostra.
process.env.TRP_SOURCE = "db";

const { calcularComissaoEmpresaRecortada } = await import("../lib/promoterAnalytics.ts");
const { buildTrpCreditProvider } = await import("../lib/trp/creditTrpProvider.ts");
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");
const { resolverJanela, competenciaAnterior } = await import("../lib/delta/calcularDelta.ts");
const { detectMonthRegime } = await import("../lib/cmsMonthly.ts");
const { nowInFortaleza } = await import("../lib/dateFortaleza.ts");

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
const pct = (n: number | null) =>
  n == null ? "  —  " : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const norm = (s: unknown) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

// Colunas: as MESMAS que loadPromoterAnalyticsBase carrega (promoterAnalytics
// :717). A consulta dailyRecorte da rota e um subconjunto enxuto disto — e por
// isso que ligar a rota exige alargar aquela query.
const COLUNAS =
  "id, company_id, j_key, assigned_promoter_id, original_promoter_id, proposal_number, contract_number, product_description, status, movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value, insurance_type, has_insurance, interest_rate, term_months, installments, company_received_percent, is_srcc_restricted, promoter_commission_percent, promoter_commission_amount, insurance_commission_percent, insurance_commission_amount, commission_rule_source, raw_payload, cancellation_date";

async function lerTudo(aplicar: (q: any) => any) {
  const passo = 1000;
  let de = 0;
  const saida: any[] = [];
  for (;;) {
    const q = aplicar(supabase.from("daily_production_records").select(COLUNAS)).range(
      de,
      de + passo - 1
    );
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    saida.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return saida;
}

// ---------------------------------------------------------------- contexto --
const agora = nowInFortaleza();
const competencia = { year: agora.year, month: agora.month };
const compAnterior = competenciaAnterior(competencia);

console.log("=".repeat(78));
console.log("MEDIDA C — comissao bruta (empresa) com recorte por dia");
console.log("=".repeat(78));
console.log(
  `competencia ${competencia.year}-${String(competencia.month).padStart(2, "0")}  vs  ${compAnterior.year}-${String(compAnterior.month).padStart(2, "0")}   ·   hoje = dia ${agora.day} (Fortaleza)   ·   TRP_SOURCE=${process.env.TRP_SOURCE}`
);

// JANELA — comeca DOIS meses antes, como o recorteRange da rota
// (dashboard/route.ts:258-262). A competencia comeca no ultimo dia UTIL do mes
// anterior, entao a competencia de junho ja pega 29-31/05: uma janela que
// comecasse em 15/06 decapitaria junho pela metade (364 linhas em vez de 714) e
// todo o resto da medida sairia errado.
const doisMesesAntes = competenciaAnterior(compAnterior);
const mesSeguinte = {
  year: competencia.month === 12 ? competencia.year + 1 : competencia.year,
  month: competencia.month === 12 ? 1 : competencia.month + 1,
};
const ini = `${doisMesesAntes.year}-${String(doisMesesAntes.month).padStart(2, "0")}-15`;
const fim = `${mesSeguinte.year}-${String(mesSeguinte.month).padStart(2, "0")}-15`;
const registros = await lerTudo((q) => q.gte("movement_date", ini).lt("movement_date", fim));
// extractYearMonth cai para contract_date/proposal_date quando movement_date e
// nulo — essas linhas nao entram no filtro acima e viriam a menos.
const semMovimento = await lerTudo((q) => q.is("movement_date", null));
const todos = [...registros, ...semMovimento];

console.log(
  `\nregistros carregados: ${todos.length}  (${registros.length} por movement_date + ${semMovimento.length} sem movement_date)`
);

// ------------------------------------------------- N: o dia de corte da rota --
// Mesmo predicado do dashboard (isProductionStatus + isValidDailyRecord) e da
// Fase 2.1: so dias do MES-CALENDARIO da competencia, para o dia-cabeca herdado
// do mes anterior nao virar o maximo.
const empresasAtivas = await supabase.from("companies").select("id").eq("active", true);
const idsAtivas = new Set((empresasAtivas.data || []).map((c: any) => c.id));

const cancelado = (s: unknown) => /CANCEL|ESTORN|RECUS/.test(norm(s));
const pendente = (s: unknown) => /PEND|ANALIS|PROCESS/.test(norm(s));
const emProducao = (s: unknown) => norm(s) === "PRODUCAO" || norm(s) === "PRODUCTION";
const validoNoDaily = (r: any) =>
  !r.cancellation_date && !cancelado(r.status) && !pendente(r.status) && r.is_srcc_restricted !== true;

const prefixo = `${competencia.year}-${String(competencia.month).padStart(2, "0")}-`;
const diasComDado = new Set<number>();
for (const r of todos) {
  if (!r.company_id || !idsAtivas.has(r.company_id)) continue;
  if (!emProducao(r.status)) continue;
  if (!validoNoDaily(r)) continue;
  const period = getProductionPeriodFromValue(r.movement_date);
  if (!period || period.year !== competencia.year || period.month !== competencia.month) continue;
  const bruta = String(r.movement_date ?? "");
  if (!bruta.startsWith(prefixo)) continue;
  const dia = Number(bruta.slice(8, 10));
  if (dia >= 1 && dia <= 31) diasComDado.add(dia);
}

const janela = resolverJanela({
  competencia,
  modo: "ate-dia-N",
  dia: agora.day,
  diasComDadoNoMesCorrente: diasComDado,
});

console.log(
  `janela: N=${janela.diaCorteAtual} no mes corrente, N=${janela.diaCorteAnterior} no anterior` +
    `${janela.limitadoPorDado ? `  (LIMITADO PELO DADO: hoje e ${janela.diaHoje}, a diaria so vai ate ${janela.diaCorteAtual})` : ""}` +
    `${janela.clampado ? "  (clampado pelo fim do mes anterior)" : ""}`
);

// -------------------------------------------- producao mensal (base da faixa) --
// Espelha buildPromoterAnalytics:795-805 — Sigma net das linhas ELEGIVEIS da
// competencia, mes INTEIRO, sem recorte e sem filtro de empresa. E so um filtro
// (nao regra de dinheiro); a conferencia contra linhasNaCompetencia, que sai da
// funcao real, prova que o recorte enxerga o mesmo conjunto.
function producaoMensalCheia(comp: { year: number; month: number }) {
  let total = 0;
  let linhas = 0;
  for (const r of todos) {
    if (!r.company_id) continue;
    if (!emProducao(r.status) || r.is_srcc_restricted === true) continue;
    const p =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    if (!p || p.year !== comp.year || p.month !== comp.month) continue;
    total += num(r.net_value);
    linhas += 1;
  }
  return { total: round2(total), linhas };
}

const prodAtual = producaoMensalCheia(competencia);
const prodAnterior = producaoMensalCheia(compAnterior);
console.log(
  `\nproducao do grupo (MES INTEIRO — a base da FAIXA, nunca recortada):` +
    `\n  ${competencia.month}/${competencia.year}: R$ ${brl(prodAtual.total)}  (${prodAtual.linhas} linhas)` +
    `\n  ${compAnterior.month}/${compAnterior.year}: R$ ${brl(prodAnterior.total)}  (${prodAnterior.linhas} linhas)`
);

const trpProvider = await buildTrpCreditProvider(todos.map((r) => r.contract_date));
console.log(`provider da TRP: ${trpProvider ? "DB (trp_rule_versions)" : "JSON embutido"}`);

// ------------------------------------------------------------- as 4 somas ---
const soma = (comp: { year: number; month: number }, base: number, ateDia: number | null) =>
  calcularComissaoEmpresaRecortada({
    records: todos as any,
    competencia: comp,
    producaoMensalDoGrupo: base,
    ateDia,
    trpProvider,
  });

const atualCheio = soma(competencia, prodAtual.total, null);
const atualRecorte = soma(competencia, prodAtual.total, janela.diaCorteAtual);
const antCheioMotor = soma(compAnterior, prodAnterior.total, null);
const antRecorte = soma(compAnterior, prodAnterior.total, janela.diaCorteAnterior);

// Conferencia do espelho: linhasNaCompetencia sai da funcao REAL.
console.log(
  `\nconferencia do filtro: linhasNaCompetencia ${atualCheio.linhasNaCompetencia} / ${antCheioMotor.linhasNaCompetencia}` +
    ` vs espelho ${prodAtual.linhas} / ${prodAnterior.linhas}  ->  ` +
    (atualCheio.linhasNaCompetencia === prodAtual.linhas &&
    antCheioMotor.linhasNaCompetencia === prodAnterior.linhas
      ? "IGUAL"
      : "DIVERGE — a base da faixa nao ve o mesmo conjunto que a soma")
);

// ----------------------------------------- a ponta fechada que a rota usa HOJE --
const regimeAnterior = await detectMonthRegime(supabase, compAnterior.year, compAnterior.month);
let antFechado = 0;
if (regimeAnterior === "cms") {
  const { data } = await supabase
    .from("cms_promoter_entries")
    .select("company_commission")
    .eq("prod_year", compAnterior.year)
    .eq("prod_month", compAnterior.month);
  antFechado = round2((data || []).reduce((s: number, r: any) => s + num(r.company_commission), 0));
} else {
  const { data } = await supabase
    .from("fechamento_mensal_empresa")
    .select("valor_avista")
    .eq("ano", compAnterior.year)
    .eq("mes", compAnterior.month);
  antFechado = round2((data || []).reduce((s: number, r: any) => s + num(r.valor_avista), 0));
}

const variacao = (a: number, b: number) => (b > 0 ? (a - b) / b : null);

console.log("\n" + "=".repeat(78));
console.log("RESULTADO");
console.log("=".repeat(78));

const M = (c: { month: number }) =>
  ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][c.month - 1];

console.log(`\nHOJE NA TELA — mes cheio, e as duas pontas vem de FONTES DIFERENTES:`);
console.log(`  ${M(competencia)} cheio (motor vivo)        R$ ${brl(atualCheio.total)}`);
console.log(`  ${M(compAnterior)} cheio (${regimeAnterior})            R$ ${brl(antFechado)}`);
console.log(`  variacao                        ${pct(variacao(atualCheio.total, antFechado))}`);

console.log(`\nCOM O RECORTE — 1..N nas duas pontas, MESMA fonte (motor):`);
console.log(
  `  ${M(competencia)} 1-${janela.diaCorteAtual}  R$ ${brl(atualRecorte.total)}   (${atualRecorte.linhasSomadas} de ${atualRecorte.linhasNaCompetencia} linhas; ${atualRecorte.linhasComDerive} pelo derive)`
);
console.log(
  `  ${M(compAnterior)} 1-${janela.diaCorteAnterior}  R$ ${brl(antRecorte.total)}   (${antRecorte.linhasSomadas} de ${antRecorte.linhasNaCompetencia} linhas; ${antRecorte.linhasComDerive} pelo derive)`
);
console.log(`  variacao                        ${pct(variacao(atualRecorte.total, antRecorte.total))}`);

console.log(`\nEFEITO DA LIGACAO:`);
const vHoje = variacao(atualCheio.total, antFechado);
const vNovo = variacao(atualRecorte.total, antRecorte.total);
console.log(
  `  ${pct(vHoje)}  ->  ${pct(vNovo)}` +
    (vHoje != null && vNovo != null
      ? `   (${((vNovo - vHoje) * 100).toFixed(1)} pontos percentuais)`
      : "")
);

console.log("\n" + "-".repeat(78));
console.log("TROCA DE FONTE — o que a conta acima esconde");
console.log("-".repeat(78));
console.log(
  `Recortar obriga a ponta de ${M(compAnterior)} a sair do MOTOR, e nao do ${regimeAnterior}: o\n` +
    `fechamento nao tem data por linha, entao nao da para cortar nele. Quanto\n` +
    `custa essa troca, no mes INTEIRO de ${M(compAnterior)} (mesma janela, so muda a fonte):`
);
console.log(`  ${M(compAnterior)} cheio pelo ${regimeAnterior.padEnd(10)}  R$ ${brl(antFechado)}   <- ground truth do mes fechado`);
console.log(`  ${M(compAnterior)} cheio pelo motor        R$ ${brl(antCheioMotor.total)}`);
const desvio = antFechado > 0 ? (antCheioMotor.total - antFechado) / antFechado : null;
console.log(
  `  desvio                        R$ ${brl(antCheioMotor.total - antFechado)}  (${pct(desvio)})`
);

console.log(
  `\nFatia sujeita a faixa (o unico ponto onde a separacao faixa/recorte importa):`
);
console.log(
  `  ${M(competencia)}: ${atualRecorte.linhasComDerive}/${atualRecorte.linhasSomadas} linhas` +
    ` (${((atualRecorte.linhasComDerive / Math.max(1, atualRecorte.linhasSomadas)) * 100).toFixed(1)}%)` +
    `   ${M(compAnterior)}: ${antRecorte.linhasComDerive}/${antRecorte.linhasSomadas} linhas` +
    ` (${((antRecorte.linhasComDerive / Math.max(1, antRecorte.linhasSomadas)) * 100).toFixed(1)}%)`
);
