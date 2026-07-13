import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllRows } from "@/lib/queryHelpers";
import { detectMonthRegime, analyticsRegimeArgs, type MonthRegime } from "@/lib/cmsMonthly";
import { loadPromoterAnalyticsBase } from "@/lib/promoterAnalytics";
import { receitaFechamentoDoMes, type FechamentoRow } from "@/lib/rbt12";

// ============================================================
// DRE GERENCIAL (Demonstrativo de Resultado) — EIXO DE PRODUÇÃO, por competência.
// Instrumento GERENCIAL (regime de competência, mês de produção do negócio), NÃO
// fiscal. Por natureza NÃO bate o RBT12 (que é caixa/recebimento p/ o Simples):
// caixa ≠ competência. READ-ONLY — apenas SELECT, nenhuma escrita.
//
// Estrutura (Diego):
//   RECEITA               = vnf do fechamento (produção M) + complementares de
//                           produção M (lançamentos manuais, recebidos em M+1)
//   (−) COMISSÕES PAGAS   = Σ payable_commission_value dos promotores ATIVOS por
//                           CNPJ (mesma fonte/eixo do relatório geral/equipe)
//   = RESULTADO BRUTO
//   (−) DESPESAS          = Σ financial_expenses do mês por CNPJ (+ escopo grupo
//                           só no consolidado)
//   = RESULTADO LÍQUIDO
// Um DRE por CNPJ + consolidado do grupo. Só meses FECHADOS (receita só existe
// no fechamento; mês aberto => "aguardando fechamento", sem número enganoso).
// ============================================================

const MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function periodLabel(year: number, month: number): string {
  return `${MONTHS[(month - 1 + 12) % 12]}/${year}`;
}
function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}
function toNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

export type DrePeriod = { year: number; month: number; key: string; label: string };

export type DreLine = {
  scope: "COMPANY" | "GROUP";
  companyId: string | null;
  cnpj: string;
  name: string;
  receita: number;
  receitaFechamento: number;
  receitaComplementar: number;
  // INFORMATIVO — "do qual seguro": parcela de comissao de seguro
  // (fechamento_mensal_empresa.valor_seguro, competencia M) JA inclusa em
  // `receita`/`receitaFechamento`. NAO somar ao total — so segregacao visual.
  receitaSeguro: number;
  comissoes: number;
  resultadoBruto: number;
  despesas: number;
  // Só no consolidado: parcela de despesas de ESCOPO GRUPO (sem CNPJ).
  despesasGrupo: number;
  resultadoLiquido: number;
};

export type DrePayload = {
  closed: boolean;
  period: DrePeriod | null;
  periods: DrePeriod[];
  companies: DreLine[];
  group: DreLine | null;
  alerts: string[];
};

type CompanyRow = { id: string; cnpj: string; name: string; active?: boolean | null };
type ExpenseRow = {
  company_id?: string | null;
  scope?: string | null;
  amount?: number | null;
  year: number;
  month: number;
};
type ManualRow = { company_id: string; ano: number; mes: number; valor: number | string | null };

// Meses elegíveis ao DRE = INTERSEÇÃO de duas condições (ambas necessárias):
//   1. mês FECHADO (regime != 'open') => comissões finais consolidadas, não
//      estimativa do motor.
//   2. tem FECHAMENTO real (fechamento_mensal_empresa) => receita existe.
// As duas NÃO coincidem nos dados (mês fechado sem fechamento daria receita 0 +
// comissões cheias = resultado falso). Só meses com os DOIS entram.
//
// MOV 2 (Grupo B): a condição (1) REIMPLEMENTAVA a cobertura, lendo só cms_imports
// e ignorando monthly_closing_imports. Efeito: os meses de regime 'fechamento'
// (abril, junho+) NUNCA apareciam na lista de períodos — o DRE simplesmente não
// sabia que existiam, e o guard de fechamento abaixo era inalcançável para eles.
//
// Agora a cobertura é a CANÔNICA: os candidatos saem das DUAS tabelas de import e
// quem decide é o detectMonthRegime — a mesma função que /promotores, o dashboard e
// o relatório usam. Não há segunda regra de "mês fechado" aqui.
async function listClosedPeriods(supabase: SupabaseClient): Promise<DrePeriod[]> {
  const { data: companiesData, error: companiesError } = await supabase
    .from("companies")
    .select("id, cnpj, active");
  if (companiesError) return [];
  const allCompanies = (companiesData || []) as Array<{ id: string; cnpj: string; active?: boolean | null }>;
  const realCnpjs = new Set(allCompanies.filter((c) => !String(c.cnpj).startsWith("TEMP-")).map((c) => c.cnpj));

  // CANDIDATOS: toda competência que tem QUALQUER import concluído — de cms
  // (jan-mai) ou de fechamento (jun+). Quem filtra é o regime, logo abaixo.
  const candidatos = new Map<string, { year: number; month: number }>();
  try {
    const cms = await fetchAllRows<{ prod_year: number; prod_month: number }>(() =>
      supabase.from("cms_imports").select("prod_year, prod_month").eq("status", "COMPLETED")
    );
    for (const r of cms) candidatos.set(periodKey(r.prod_year, r.prod_month), { year: r.prod_year, month: r.prod_month });
  } catch {
    /* tabela ausente — sem candidatos de cms */
  }
  try {
    const fech = await fetchAllRows<{ year: number; month: number }>(() =>
      supabase.from("monthly_closing_imports").select("year, month").eq("status", "COMPLETED")
    );
    for (const r of fech) candidatos.set(periodKey(r.year, r.month), { year: r.year, month: r.month });
  } catch {
    /* tabela ausente — sem candidatos de fechamento */
  }
  if (candidatos.size === 0) return [];

  // Competências com fechamento real (receita disponível).
  const fechamentoPeriods = new Set<string>();
  try {
    const fme = await fetchAllRows<{ empresa_cnpj: string; ano: number; mes: number }>(() =>
      supabase.from("fechamento_mensal_empresa").select("empresa_cnpj, ano, mes")
    );
    for (const row of fme) {
      if (realCnpjs.has(row.empresa_cnpj)) fechamentoPeriods.add(periodKey(row.ano, row.mes));
    }
  } catch {
    return [];
  }

  // Competências que têm o LADO DA COMISSÃO (PMR consolidado).
  //
  // O simétrico da guarda de receita, e igualmente necessário: alargar a cobertura
  // para os meses de 'fechamento' trouxe competências ANTIGAS (set-dez/2025) que têm
  // fechamento importado mas NENHUMA linha de PMR — o DRE exibiria receita cheia com
  // comissão 0 e um lucro fabricado (ex.: set/2025 daria R$ 239.396,92 de "resultado").
  // "receita 0 + comissões cheias" e "receita cheia + comissões 0" são o MESMO defeito.
  const comissaoPeriods = new Set<string>();
  try {
    const pmr = await fetchAllRows<{ year: number; month: number }>(() =>
      supabase.from("promoter_monthly_results").select("year, month")
    );
    for (const r of pmr) comissaoPeriods.add(periodKey(r.year, r.month));
  } catch {
    return [];
  }

  const periods: DrePeriod[] = [];
  for (const [k, { year, month }] of candidatos) {
    if (!fechamentoPeriods.has(k)) continue; // sem receita realizada: fora
    if (!comissaoPeriods.has(k)) continue; // sem base de comissão: fora
    let regime: MonthRegime = "open";
    try {
      regime = await detectMonthRegime(supabase, year, month);
    } catch {
      regime = "open";
    }
    if (regime === "open") continue; // ainda não fechado
    periods.push({ year, month, key: k, label: periodLabel(year, month) });
  }
  periods.sort((a, b) => b.year - a.year || b.month - a.month);
  return periods;
}

export async function buildDre(
  supabase: SupabaseClient,
  year?: number,
  month?: number
): Promise<DrePayload> {
  const periods = await listClosedPeriods(supabase);

  const selected: DrePeriod | null =
    (year && month
      ? periods.find((p) => p.year === year && p.month === month) || {
          year,
          month,
          key: periodKey(year, month),
          label: periodLabel(year, month),
        }
      : periods[0]) || null;

  if (!selected) {
    return { closed: false, period: null, periods, companies: [], group: null, alerts: [
      "Nenhum mês fechado disponível. O DRE só monta sobre competências com fechamento concluído.",
    ] };
  }

  // Guarda dura: se a competência pedida não está fechada, não monta resultado.
  // MOV 2: enum canônico. `closed` é `regime !== 'open'` (cms E fechamento fecham),
  // NUNCA `=== 'fechamento'` — isso trataria jan-mai como aberto e derrubaria o DRE
  // histórico inteiro.
  let regimeSel: MonthRegime = "open";
  try {
    regimeSel = await detectMonthRegime(supabase, selected.year, selected.month);
  } catch {
    regimeSel = "open";
  }
  const closed = regimeSel !== "open";
  if (!closed) {
    return {
      closed: false,
      period: selected,
      periods,
      companies: [],
      group: null,
      alerts: [
        `Competência ${selected.label} ainda não fechada — aguardando fechamento do mês. ` +
          "A receita só existe após o fechamento; o DRE é de resultado realizado e não exibe número parcial.",
      ],
    };
  }

  const alerts: string[] = [];

  // ---- empresas reais (exclui placeholders TEMP) ----
  const companies = (
    await fetchAllRows<CompanyRow>(() => supabase.from("companies").select("id, cnpj, name, active"))
  ).filter((c) => !String(c.cnpj).startsWith("TEMP-"));
  const byCnpj = new Map(companies.map((c) => [c.cnpj, c]));

  // ---- RECEITA: fechamento (vnf) de produção M ----
  const FME_SELECT =
    "empresa_cnpj, ano, mes, valor_liquido, valor_nota_fiscal, valor_avista, valor_diferido, valor_seguro, valor_estorno, valor_renovacao";
  let fechamentoRows: FechamentoRow[];
  try {
    fechamentoRows = await fetchAllRows<FechamentoRow>(() =>
      supabase.from("fechamento_mensal_empresa").select(FME_SELECT).eq("ano", selected.year).eq("mes", selected.month)
    );
  } catch {
    // pre-migration: sem valor_nota_fiscal
    fechamentoRows = await fetchAllRows<FechamentoRow>(() =>
      supabase
        .from("fechamento_mensal_empresa")
        .select(
          "empresa_cnpj, ano, mes, valor_liquido, valor_avista, valor_diferido, valor_seguro, valor_estorno, valor_renovacao"
        )
        .eq("ano", selected.year)
        .eq("mes", selected.month)
    );
  }
  const receitaFechamentoByCompany = new Map<string, number>();
  // INFORMATIVO: Σ valor_seguro por empresa (parcela JA dentro da receita acima).
  const receitaSeguroByCompany = new Map<string, number>();
  for (const row of fechamentoRows) {
    const company = byCnpj.get(row.empresa_cnpj);
    if (!company) continue; // ignora TEMP/sem match — DRE é das empresas reais
    receitaFechamentoByCompany.set(
      company.id,
      toNum(receitaFechamentoByCompany.get(company.id)) + receitaFechamentoDoMes(row)
    );
    receitaSeguroByCompany.set(
      company.id,
      toNum(receitaSeguroByCompany.get(company.id)) + toNum(row.valor_seguro)
    );
  }

  // Guarda de receita: mês cms-fechado mas SEM fechamento => não há receita
  // realizada. Não monta resultado (evita receita 0 + comissões cheias = número
  // falso). Mostra "aguardando fechamento".
  if (receitaFechamentoByCompany.size === 0) {
    return {
      closed: false,
      period: selected,
      periods,
      companies: [],
      group: null,
      alerts: [
        `Competência ${selected.label} sem fechamento — receita indisponível. ` +
          "O DRE é de resultado realizado e só monta quando o fechamento do mês existe.",
      ],
    };
  }
  if (receitaFechamentoByCompany.size < companies.length) {
    alerts.push(
      `Fechamento parcial em ${selected.label}: ${receitaFechamentoByCompany.size} de ${companies.length} empresas com receita lançada.`
    );
  }

  // ---- RECEITA: complementares de PRODUÇÃO M (lançamentos manuais recebidos em M+1) ----
  // Os complementares (Conta Corrente/BrasilCap/Consórcio/etc.) entram via
  // receita_lancamento_manual, datados em competência de RECEBIMENTO. Produção M
  // é recebida em M+1, então os complementares de produção M = lançamentos de M+1.
  const fiscal = shiftMonth(selected.year, selected.month, 1);
  const receitaComplementarByCompany = new Map<string, number>();
  try {
    const manualRows = await fetchAllRows<ManualRow>(() =>
      supabase
        .from("receita_lancamento_manual")
        .select("company_id, ano, mes, valor")
        .eq("ano", fiscal.year)
        .eq("mes", fiscal.month)
    );
    for (const m of manualRows) {
      receitaComplementarByCompany.set(
        m.company_id,
        toNum(receitaComplementarByCompany.get(m.company_id)) + toNum(m.valor)
      );
    }
  } catch {
    /* tabela ausente — sem complementares */
  }

  // ---- COMISSÕES PAGAS: Σ payable_commission_value dos ATIVOS por CNPJ ----
  // Mesma base/eixo do relatório geral/equipe. DRE só monta para mês FECHADO (guard
  // acima) → CALCULATED (PMR).
  //
  // MOV 2: passa closedSource (via analyticsRegimeArgs, o helper canônico). Sem ele o
  // analytics caía no `.find()` legado — 1 linha do PMR por promotor, sem filtrar
  // source: truncava quem tem linha RR + linha ADS e deixava entrar promotor sem
  // linha no ledger fechado (inclusive CHAVE MASTER).
  const base = await loadPromoterAnalyticsBase(supabase, {
    year: selected.year,
    month: selected.month,
    ...analyticsRegimeArgs(regimeSel),
  });
  // GUARDA DURA (simétrica à guarda de receita): sem base de comissão, o DRE exibiria
  // receita cheia com comissão 0 — um lucro fabricado. Não monta. Antes isto era só um
  // alerta, e o número falso ia para a tela do mesmo jeito. Alcançável quando a
  // competência é pedida direto (year/month na URL), fora da lista de períodos.
  if (base.latestPeriod.year !== selected.year || base.latestPeriod.month !== selected.month) {
    return {
      closed: false,
      period: selected,
      periods,
      companies: [],
      group: null,
      alerts: [
        `Sem produção de promotores em ${selected.label} na base consolidada (PMR) — o DRE não ` +
          "monta: exibir a receita do fechamento com comissão 0 daria um resultado falso.",
      ],
    };
  }
  // A guarda dura acima já garantiu que a base é da competência selecionada.
  const comissaoByCompany = new Map<string, number>();
  for (const row of base.filteredSummaryRows) {
    if (!row.active) continue; // regra do DRE (pré-existente): só promotor ATIVO
    const cid = row.company_id || "";
    if (!cid) continue;
    comissaoByCompany.set(cid, toNum(comissaoByCompany.get(cid)) + toNum(row.payable_commission_value));
  }

  // ---- DESPESAS: financial_expenses do mês, por CNPJ (+ escopo grupo) ----
  const expenses = await fetchAllRows<ExpenseRow>(() =>
    supabase
      .from("financial_expenses")
      .select("company_id, scope, amount, year, month")
      .eq("year", selected.year)
      .eq("month", selected.month)
  );
  const despesaByCompany = new Map<string, number>();
  let despesasGrupo = 0;
  for (const e of expenses) {
    const isGroupScope =
      normalizeText(e.scope) === "GROUP" || normalizeText(e.scope) === "GRUPO" || !e.company_id;
    if (isGroupScope) {
      despesasGrupo += toNum(e.amount);
    } else {
      despesaByCompany.set(e.company_id!, toNum(despesaByCompany.get(e.company_id!)) + toNum(e.amount));
    }
  }
  despesasGrupo = round(despesasGrupo);
  if (despesasGrupo > 0) {
    alerts.push(
      `Há ${despesasGrupo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em despesas de ESCOPO GRUPO ` +
        "(sem CNPJ) — entram apenas no consolidado, não na soma dos CNPJs."
    );
  }

  // ---- empresas SEM receita realizada na competência ----
  // O princípio já está no topo deste arquivo, mas só era aplicado ao MÊS: "receita 0
  // + comissões cheias = resultado falso". Vale igual por CNPJ.
  //
  // Caso real (achado ao ligar o regime 'fechamento'): a ADS Consultoria Negocial tem
  // CNPJ real (não-TEMP), está active=false e NÃO tem linha em fechamento_mensal_empresa
  // — a receita dela não entra por esse caminho. Mas o PMR tem comissão de promotor na
  // ADS (source 'bbts'), e a linha consolidada do promotor carrega o company_id da linha
  // de MAIOR produção: quem só produziu na ADS cai na ADS. Sem esta guarda, o DRE
  // fabricaria um prejuízo (receita 0 − comissão) num CNPJ que não fatura por aqui.
  //
  // A comissão excluída NÃO some em silêncio: vira alerta com o valor.
  const semReceita = companies.filter(
    (c) => toNum(receitaFechamentoByCompany.get(c.id)) === 0 && toNum(receitaComplementarByCompany.get(c.id)) === 0
  );
  const companiesComReceita = companies.filter((c) => !semReceita.some((s) => s.id === c.id));
  for (const c of semReceita) {
    const comissaoFora = round(toNum(comissaoByCompany.get(c.id)));
    if (comissaoFora > 0) {
      alerts.push(
        `${c.name} (${c.cnpj}) tem ${comissaoFora.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ` +
          "em comissões no mês, mas NENHUMA receita realizada em fechamento_mensal_empresa — a receita dessa " +
          "empresa não entra por esse caminho. Ficou FORA do DRE (incluí-la geraria um prejuízo falso: receita 0 " +
          "menos comissão). Esse valor não está no resultado do grupo."
      );
    }
  }

  // ---- monta linhas por CNPJ ----
  const companyLines: DreLine[] = companiesComReceita.map((c) => {
    const receitaFechamento = round(toNum(receitaFechamentoByCompany.get(c.id)));
    const receitaComplementar = round(toNum(receitaComplementarByCompany.get(c.id)));
    const receita = round(receitaFechamento + receitaComplementar);
    // INFORMATIVO — nao entra em `receita`/`resultado` (ja embutido neles).
    const receitaSeguro = round(toNum(receitaSeguroByCompany.get(c.id)));
    const comissoes = round(toNum(comissaoByCompany.get(c.id)));
    const despesas = round(toNum(despesaByCompany.get(c.id)));
    const resultadoBruto = round(receita - comissoes);
    const resultadoLiquido = round(resultadoBruto - despesas);
    return {
      scope: "COMPANY",
      companyId: c.id,
      cnpj: c.cnpj,
      name: c.name,
      receita,
      receitaFechamento,
      receitaComplementar,
      receitaSeguro,
      comissoes,
      resultadoBruto,
      despesas,
      despesasGrupo: 0,
      resultadoLiquido,
    };
  });
  // mostra as empresas com qualquer movimento; ordena por receita desc.
  const visibleCompanies = companyLines
    .filter((l) => l.receita !== 0 || l.comissoes !== 0 || l.despesas !== 0)
    .sort((a, b) => b.receita - a.receita);

  // ---- consolidado: soma dos CNPJs + despesas de escopo grupo ----
  const sum = (sel: (l: DreLine) => number) => round(visibleCompanies.reduce((s, l) => s + sel(l), 0));
  const gReceita = sum((l) => l.receita);
  const gReceitaFech = sum((l) => l.receitaFechamento);
  const gReceitaComp = sum((l) => l.receitaComplementar);
  const gReceitaSeguro = sum((l) => l.receitaSeguro); // seguroTotalGrupo (informativo)
  const gComissoes = sum((l) => l.comissoes);
  const gDespesasEmpresas = sum((l) => l.despesas);
  const gDespesas = round(gDespesasEmpresas + despesasGrupo);
  const gResultadoBruto = round(gReceita - gComissoes);
  const gResultadoLiquido = round(gResultadoBruto - gDespesas);
  const group: DreLine = {
    scope: "GROUP",
    companyId: null,
    cnpj: "",
    name: "Grupo RR (consolidado)",
    receita: gReceita,
    receitaFechamento: gReceitaFech,
    receitaComplementar: gReceitaComp,
    receitaSeguro: gReceitaSeguro,
    comissoes: gComissoes,
    resultadoBruto: gResultadoBruto,
    despesas: gDespesas,
    despesasGrupo,
    resultadoLiquido: gResultadoLiquido,
  };

  return { closed: true, period: selected, periods, companies: visibleCompanies, group, alerts };
}
