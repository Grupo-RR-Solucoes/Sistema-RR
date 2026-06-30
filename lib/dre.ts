import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllRows } from "@/lib/queryHelpers";
import { detectClosedMonth } from "@/lib/cmsMonthly";
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
//   1. cms-fechado (detectClosedMonth): cms_imports COMPLETED p/ todas as ativas
//      => comissões finais (cms), não estimativa do motor.
//   2. tem FECHAMENTO real (fechamento_mensal_empresa) => receita existe.
// As duas NÃO coincidem nos dados (ex.: mês cms-fechado sem fechamento daria
// receita 0 + comissões cheias = resultado falso). Só meses com os DOIS entram.
async function listClosedPeriods(supabase: SupabaseClient): Promise<DrePeriod[]> {
  const { data: companiesData, error: companiesError } = await supabase
    .from("companies")
    .select("id, cnpj, active");
  if (companiesError) return [];
  const allCompanies = (companiesData || []) as Array<{ id: string; cnpj: string; active?: boolean | null }>;
  const totalActive = allCompanies.filter((c) => c.active === true).length;
  if (totalActive === 0) return [];
  const realCnpjs = new Set(allCompanies.filter((c) => !String(c.cnpj).startsWith("TEMP-")).map((c) => c.cnpj));

  const { data: imports, error } = await supabase
    .from("cms_imports")
    .select("company_id, prod_year, prod_month")
    .eq("status", "COMPLETED");
  if (error) return [];

  const byPeriod = new Map<string, { year: number; month: number; set: Set<string> }>();
  for (const r of (imports || []) as Array<{ company_id: string; prod_year: number; prod_month: number }>) {
    const k = periodKey(r.prod_year, r.prod_month);
    if (!byPeriod.has(k)) byPeriod.set(k, { year: r.prod_year, month: r.prod_month, set: new Set() });
    byPeriod.get(k)!.set.add(r.company_id);
  }

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

  const periods: DrePeriod[] = [];
  for (const { year, month, set } of byPeriod.values()) {
    const k = periodKey(year, month);
    if (set.size >= totalActive && fechamentoPeriods.has(k)) {
      periods.push({ year, month, key: k, label: periodLabel(year, month) });
    }
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
  let closed = false;
  try {
    closed = await detectClosedMonth(supabase, selected.year, selected.month);
  } catch {
    closed = false;
  }
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
  // Mesma base/eixo do relatório geral/equipe (mês fechado => promoter_monthly_results
  // do cms; respeita a regra cms/motor por construção).
  // DRE só monta para mês FECHADO (guard `if (!closed) return` acima) → CALCULATED (PMR/cms).
  const base = await loadPromoterAnalyticsBase(supabase, { year: selected.year, month: selected.month, closed: true });
  if (base.latestPeriod.year !== selected.year || base.latestPeriod.month !== selected.month) {
    alerts.push(
      `Sem produção de promotores em ${selected.label} na base analítica — comissões exibidas como 0.`
    );
  }
  const comissaoByCompany = new Map<string, number>();
  if (base.latestPeriod.year === selected.year && base.latestPeriod.month === selected.month) {
    for (const row of base.filteredSummaryRows) {
      if (!row.active) continue;
      const cid = row.company_id || "";
      if (!cid) continue;
      comissaoByCompany.set(cid, toNum(comissaoByCompany.get(cid)) + toNum(row.payable_commission_value));
    }
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

  // ---- monta linhas por CNPJ ----
  const companyLines: DreLine[] = companies.map((c) => {
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
