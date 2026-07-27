// ============================================================================
// MEDIDA B — a etiqueta "SEM REGRA TRP" e falso positivo?
//
// A etiqueta afirma, no texto de ajuda, que "a Promotiva nao comissionou esta
// proposta" e a chama de "candidata a auditoria mensal". Nao e aviso visual: e
// a tela apontando proposta para cobranca contra a gestora.
//
// O CRITERIO DELA (app/comissoes/editar/page.js:1447-1466) e:
//     company_received_percent null | undefined | 0
// ou seja, o SEGUNDO degrau de tres, lido cru. O motor usa:
//     raw_payload -> company_received_percent -> deriveCompanyReceivedRate
//
// Este script reproduz o criterio da tela linha a linha e confronta com a taxa
// EFETIVA do motor (resolverTaxaAvistaEfetiva, a funcao exportada — nao uma
// reescrita: reescrever regra de dinheiro "so para medir" foi o que produziu os
// tres numeros invalidados da FRENTE 3).
//
// Somente leitura. npx tsx scripts/medida-b-etiqueta-sem-regra.mts
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
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");
const { detectMonthRegime } = await import("../lib/cmsMonthly.ts");
const { getAVistaPercent, computeComissaoPromotor } = await import(
  "../lib/proposalDetailing.ts"
);

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

// COLUNAS: as mesmas do select de /api/commissions/proposals (route.ts:302-328),
// mais as que o derive consome.
const COLUNAS =
  "id, company_id, assigned_promoter_id, proposal_number, product_description, status," +
  " movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value," +
  " has_insurance, interest_rate, term_months, installments, company_received_percent," +
  " is_srcc_restricted, raw_payload";

async function lerTudo(aplicar: (q: any) => any) {
  const passo = 1000;
  let de = 0;
  const saida: any[] = [];
  for (;;) {
    const { data, error } = await aplicar(
      supabase.from("daily_production_records").select(COLUNAS)
    ).range(de, de + passo - 1);
    if (error) throw new Error(error.message);
    saida.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return saida;
}

// Janela ampla: a tela e navegada por competencia; medimos todas as que existem.
const todos = await lerTudo((q) =>
  q.gte("movement_date", "2026-01-01").lt("movement_date", "2027-01-01")
);

const empresas = await supabase.from("companies").select("id, name");
const nomeEmpresa = new Map((empresas.data || []).map((e: any) => [e.id, e.name]));
const gestora = (id: string) =>
  String(nomeEmpresa.get(id) || "").toUpperCase().includes("ADS") ? "ADS" : "RR";

// ---------------------------------------------------------------------------
// O UNIVERSO DA TELA — mais estreito do que parece, e isto muda o numero.
//
// 1) /api/commissions/proposals filtra server-side:
//        status = 'Produção'  (com acento, exatamente assim)
//        assigned_promoter_id NOT NULL
//
// 2) SO O MES ABERTO le a diaria. Em regime != 'open' a rota devolve linhas do
//    cms/fechamento (mapCmsRowToEditor / buildClosingProposalRows) e nem chega
//    na query do daily.
//
// 3) E a etiqueta so e RENDERIZADA quando readOnly e false (page.js:1252) —
//    readOnly = data.closed = (regime != 'open'). Em mes fechado a celula
//    inteira vira um traco.
//
// Portanto: a etiqueta so existe, hoje, nas competencias ABERTAS. Medir a
// diaria de mes fechado conta linha que a tela nunca mostra assim.
// ---------------------------------------------------------------------------
const compsNaDiaria = [
  ...new Set(
    todos
      .map((r) => getProductionPeriodFromValue(r.movement_date))
      .filter(Boolean)
      .map((p: any) => `${p.year}-${String(p.month).padStart(2, "0")}`)
  ),
].sort();

const regimePorComp = new Map<string, string>();
for (const c of compsNaDiaria) {
  const [y, m] = c.split("-").map(Number);
  regimePorComp.set(c, await detectMonthRegime(supabase, y, m).catch(() => "open"));
}
const abertas = new Set(
  [...regimePorComp.entries()].filter(([, r]) => r === "open").map(([c]) => c)
);

console.log("\nregime por competencia na diaria:");
for (const c of compsNaDiaria) {
  const r = regimePorComp.get(c);
  console.log(`  ${c}  ${String(r).padEnd(11)} ${r === "open" ? "<- a etiqueta aparece aqui" : "(tela le cms/fechamento; etiqueta nao e renderizada)"}`);
}

const compDe = (r: any) => {
  const p = getProductionPeriodFromValue(r.movement_date);
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}` : "??";
};

const naTela = todos.filter(
  (r) =>
    r.status === "Produção" &&
    r.assigned_promoter_id != null &&
    abertas.has(compDe(r))
);

// O CRITERIO DA ETIQUETA, copiado da pagina (page.js:1453-1457).
const exibeEtiqueta = (r: any) =>
  r.company_received_percent === null ||
  r.company_received_percent === undefined ||
  Number(r.company_received_percent) === 0;

const comEtiqueta = naTela.filter(exibeEtiqueta);

// A base da FAIXA, por competencia — mes INTEIRO, do universo COMPLETO (nao so
// o da tela): a faixa da TRP e por volume do grupo, nao por recorte de tela.
const compsSet = new Set<string>();
for (const r of comEtiqueta) {
  const p = getProductionPeriodFromValue(r.movement_date);
  if (p) compsSet.add(`${p.year}-${String(p.month).padStart(2, "0")}`);
}
const baseFaixa = new Map<string, number>();
for (const c of compsSet) {
  const [y, m] = c.split("-").map(Number);
  baseFaixa.set(
    c,
    calcularProducaoMensalDoGrupo({ records: todos, competencia: { year: y, month: m } }).total
  );
}

const trpProvider = await buildTrpCreditProvider(todos.map((r) => r.contract_date));

console.log("=".repeat(88));
console.log('MEDIDA B — a etiqueta "SEM REGRA TRP" e falso positivo?');
console.log("=".repeat(88));
console.log(`TRP_SOURCE=${process.env.TRP_SOURCE}   provider=${trpProvider ? "DB" : "JSON"}`);
console.log(
  `\nregistros 2026: ${todos.length}   ·   no universo da tela (Producao + com promotor): ${naTela.length}` +
    `\nEXIBEM A ETIQUETA HOJE: ${comEtiqueta.length}`
);

// ---------------------------------------------------------------------------
type Linha = {
  comp: string;
  gestora: string;
  net: number;
  taxa: number;
  degrau: string;
  mente: boolean;
  comissaoTela: number;
  comissaoReal: number;
};

const linhas: Linha[] = comEtiqueta.map((r) => {
  const comp = compDe(r);
  const efetiva = resolverTaxaAvistaEfetiva({
    record: r,
    producaoMensalDoGrupo: baseFaixa.get(comp) ?? 0,
    trpProvider,
  });
  // SEGUNDO SINTOMA, mesma raiz: a COMISSAO PROMOTOR da tela sai de
  // getAVistaPercent, que so tem DOIS degraus (raw_payload -> coluna). Sem o
  // derive ela devolve null, computeComissaoPromotor recebe 0 e a celula
  // mostra R$ 0,00 na mesma linha em que a etiqueta acusa "sem regra".
  const aVista2Degraus = getAVistaPercent(r);
  return {
    comp,
    gestora: gestora(r.company_id),
    net: num(r.net_value),
    taxa: efetiva.taxa,
    degrau: efetiva.degrau,
    mente: !efetiva.semRegra, // o motor PAGA -> a etiqueta mente
    comissaoTela: computeComissaoPromotor(num(r.net_value), aVista2Degraus, 0.5833),
    comissaoReal: computeComissaoPromotor(num(r.net_value), efetiva.taxa * 100, 0.5833),
  };
});

const mentem = linhas.filter((l) => l.mente);
const certas = linhas.filter((l) => !l.mente);
const soma = (xs: Linha[], f: (l: Linha) => number) => xs.reduce((s, l) => s + f(l), 0);

console.log("\n" + "-".repeat(88));
console.log("POR COMPETENCIA E GESTORA");
console.log("-".repeat(88));
console.log(
  "comp     gest   etiqueta   MENTE (motor paga)              CERTA (motor zera)"
);
const chaves = [...new Set(linhas.map((l) => `${l.comp}|${l.gestora}`))].sort();
for (const k of chaves) {
  const [comp, g] = k.split("|");
  const grupo = linhas.filter((l) => l.comp === comp && l.gestora === g);
  const m = grupo.filter((l) => l.mente);
  const c = grupo.filter((l) => !l.mente);
  console.log(
    `${comp}  ${g.padEnd(4)}  ${String(grupo.length).padStart(7)}   ` +
      `${String(m.length).padStart(4)} · R$ ${brl(soma(m, (l) => l.net)).padStart(14)}   ` +
      `${String(c.length).padStart(4)} · R$ ${brl(soma(c, (l) => l.net)).padStart(13)}`
  );
}

console.log("\n" + "=".repeat(88));
console.log("VEREDITO");
console.log("=".repeat(88));
const pctMente = comEtiqueta.length ? (mentem.length / comEtiqueta.length) * 100 : 0;
console.log(
  `\n  exibem a etiqueta hoje ........ ${String(comEtiqueta.length).padStart(4)} linhas · R$ ${brl(soma(linhas, (l) => l.net))} financiados`
);
console.log(
  `  A ETIQUETA MENTE .............. ${String(mentem.length).padStart(4)} linhas · R$ ${brl(soma(mentem, (l) => l.net))} financiados   (${pctMente.toFixed(1)}%)`
);
console.log(
  `    -> comissao-empresa que o motor de fato paga nessas: R$ ${brl(soma(mentem, (l) => l.net * l.taxa))}`
);
console.log(
  `  a etiqueta esta CERTA ......... ${String(certas.length).padStart(4)} linhas · R$ ${brl(soma(certas, (l) => l.net))} financiados   (${(100 - pctMente).toFixed(1)}%)`
);

// De qual degrau vem a taxa das que mentem — mostra POR QUE a tela erra.
console.log("\n  De onde vem a taxa das linhas em que a etiqueta mente:");
for (const d of ["bruto", "coluna", "derive"]) {
  const g = mentem.filter((l) => l.degrau === d);
  if (!g.length) continue;
  console.log(
    `    ${d.padEnd(7)} ${String(g.length).padStart(4)} linhas · R$ ${brl(soma(g, (l) => l.net)).padStart(14)} financiados`
  );
}
console.log(
  "\n  'bruto' = a taxa estava no raw_payload o tempo todo; a tela nem olhou o 1o degrau."
);
console.log(
  "  'derive' = a TRP responde; a tela nao chegou no 3o degrau."
);

console.log("\n" + "-".repeat(88));
console.log("SEGUNDO SINTOMA — a coluna COMISSAO PROMOTOR, na mesma linha");
console.log("-".repeat(88));
console.log(
  "getAVistaPercent (lib/proposalDetailing.ts) tem so DOIS degraus: raw_payload e a"
);
console.log(
  "coluna. Sem o derive ela devolve null, computeComissaoPromotor recebe 0, e a"
);
console.log(
  "celula mostra R$ 0,00 na MESMA linha em que a etiqueta acusa 'sem regra'."
);
console.log(`\n  simulando share 58,33% nas ${mentem.length} linhas em que a etiqueta mente:`);
console.log(`    o que a tela mostra hoje ... R$ ${brl(soma(mentem, (l) => l.comissaoTela))}`);
console.log(`    o que o motor pagaria ...... R$ ${brl(soma(mentem, (l) => l.comissaoReal))}`);
console.log(
  `    diferenca .................. R$ ${brl(soma(mentem, (l) => l.comissaoReal - l.comissaoTela))}`
);
