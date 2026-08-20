import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllRows } from "@/lib/queryHelpers";
import { detectMonthRegime, analyticsRegimeArgs, type MonthRegime } from "@/lib/cmsMonthly";
import { loadPromoterAnalyticsBase } from "@/lib/promoterAnalytics";
import { receitaFechamentoDoMes, type FechamentoRow } from "@/lib/rbt12";
// Receita da ADS: ela fatura pela BBTS, não pela Promotiva — não tem linha em
// fechamento_mensal_empresa. A competência da produção ADS sai do MESMO predicado que
// o consolidador usa (movement -> contract -> proposal).
import { BBTS_COMPANY_ID } from "@/lib/bbtsMonthly";
import { getProductionPeriodFromValue, getProductionPeriodKey } from "@/lib/productionPeriod";
// DELTA vs mes anterior (Fase 3) — calcularDelta e a UNICA fonte de calculo.
import {
  calcularDelta,
  competenciaAnterior,
  type ResultadoDelta,
} from "@/lib/delta/calcularDelta";

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
  /**
   * DELTA vs mes anterior das linhas do GRUPO — alimenta os cards do header da
   * aba DRE (KpiBand) e o card informativo de seguro.
   *
   * A TABELA .dre-tbl (uma linha por CNPJ + a do grupo) NAO recebe delta:
   * regra transversal do Diego — delta so em card de KPI, nunca em tabela,
   * grid ou lista.
   *
   * Sempre cheio-vs-cheio (o DRE so monta em mes fechado). Cada campo compara
   * a MESMA linha nos dois meses. null quando o DRE nao monta.
   */
  deltas: {
    receita: ResultadoDelta;
    comissoes: ResultadoDelta;
    resultadoLiquido: ResultadoDelta;
    receitaSeguro: ResultadoDelta;
  } | null;
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
  month?: number,
  // DELTA (Fase 3): quando true, NAO calcula o delta — evita recursao infinita
  // na chamada que busca o M-1. So o buildDre externo (o da tela) calcula.
  opts?: { semDelta?: boolean }
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
    return { closed: false, period: null, periods, companies: [], group: null, deltas: null, alerts: [
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
      deltas: null,
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


  // ---- RECEITA DA ADS: mesmo fluxo do RR, fonte diferente ----
  //
  // A ADS não fatura pela Promotiva — fatura pela BBTS, e por isso NÃO tem linha em
  // fechamento_mensal_empresa. A receita dela é o que a BBTS PAGOU à empresa: o mesmo
  // "realizado" que a auditoria BBTS já captura contra a régua.
  //   AVT    -> daily_production_records.bbts_pag_avista   (à vista, análogo ao valor_avista do RR)
  //   PRT    -> bbts_prt_parcelas.valor_parcela            (parcelas do diferido)
  //   SEGURO -> daily_production_records.bbts_seguro_pago
  // Junho: 7.707,03 + 7,01 + 97,54 = R$ 7.811,58.
  //
  // Sem isto, incluir a comissão da ADS (regra do Diego) fabricaria um prejuízo — que
  // foi exatamente o motivo de o Mov 2 ter deixado a ADS FORA. Com a receita, o
  // resultado da ADS em junho e POSITIVO (+2.616,89): incluir MELHORA o DRE.
  {
    const compKey = periodKey(selected.year, selected.month);
    const adsDaily = await fetchAllRows<{
      bbts_pag_avista: number | null;
      bbts_seguro_pago: number | null;
      movement_date: string | null;
      contract_date: string | null;
      proposal_date: string | null;
    }>(() =>
      supabase
        .from("daily_production_records")
        .select("bbts_pag_avista, bbts_seguro_pago, movement_date, contract_date, proposal_date")
        .eq("company_id", BBTS_COMPANY_ID)
    );
    let receitaAds = 0;
    for (const r of adsDaily) {
      const p =
        getProductionPeriodFromValue(r.movement_date) ||
        getProductionPeriodFromValue(r.contract_date) ||
        getProductionPeriodFromValue(r.proposal_date);
      if (!p || getProductionPeriodKey(p.year, p.month) !== compKey) continue;
      receitaAds += toNum(r.bbts_pag_avista) + toNum(r.bbts_seguro_pago);
    }
    const prtRows = await fetchAllRows<{ valor_parcela: number | null }>(() =>
      supabase
        .from("bbts_prt_parcelas")
        .select("valor_parcela")
        .eq("company_id", BBTS_COMPANY_ID)
        .eq("competencia", `${compKey}-01`)
    );
    for (const r of prtRows) receitaAds += toNum(r.valor_parcela);

    if (receitaAds > 0) {
      receitaFechamentoByCompany.set(
        BBTS_COMPANY_ID,
        toNum(receitaFechamentoByCompany.get(BBTS_COMPANY_ID)) + receitaAds
      );
    }
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
      deltas: null,
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
  //
  // COMPETENCIA CANONICA — O DETECTOR MUDOU, A RECUSA NAO.
  // Isto testava `base.latestPeriod !== selected`: a divergência SÓ existia porque
  // o analytics trocava a competência pedida pela mais recente com dado. Agora ele
  // sintetiza a pedida, `latestPeriod` é SEMPRE igual a `selected` e a comparação
  // seria eternamente falsa — a guarda morreria em silêncio e o lucro fabricado
  // passaria a ser o caminho PADRÃO da tela (o DRE abre no mês corrente, que no
  // dia 1 não tem PMR). O sinal agora é dito em voz alta pela própria base:
  // `competencia.temDado === false` é EXATAMENTE a condição que a comparação
  // detectava — a competência não aparece em periodsMap, isto é, não há linha de
  // PMR, meta nem daily nela. Mesma recusa, mesma mensagem, sem depender de
  // efeito colateral de fallback.
  if (!base.competencia.temDado) {
    return {
      closed: false,
      period: selected,
      periods,
      companies: [],
      group: null,
      deltas: null,
      alerts: [
        `Sem produção de promotores em ${selected.label} na base consolidada (PMR) — o DRE não ` +
          "monta: exibir a receita do fechamento com comissão 0 daria um resultado falso.",
      ],
    };
  }
  // ---- COMISSÕES: direto das linhas do PMR, por CNPJ DA PRÓPRIA LINHA ----
  //
  // REGRA (Diego): o DRE não exclui NADA que saiu ou entrou. Comissão paga é custo
  // real. Duas exclusões caíram aqui:
  //
  // (1) PROMOTOR INATIVO. O filtro `if (!row.active) continue` cortava o custo de quem
  //     saiu — mas a RECEITA da produção dele já está no DRE (vem de
  //     fechamento_mensal_empresa, que não sabe se o promotor saiu depois). Receita sem
  //     o custo correspondente = resultado inflado. Junho: R$ 483,85.
  //
  // (2) ATRIBUIÇÃO PELO CNPJ DOMINANTE. O bloco lia `base.filteredSummaryRows` — as
  //     linhas CONSOLIDADAS, que colapsam o promotor num registro só, com o company_id
  //     da linha de MAIOR produção. Resultado: a comissão ADS de quem produz mais no RR
  //     caía no CNPJ do RR (junho: R$ 2.191,74 deslocados). O grupo fechava, mas o
  //     resultado POR CNPJ mentia.
  //     O PMR já tem UMA LINHA POR (promotor, empresa) — a informação está lá. Basta
  //     não colapsar: source 'fechamento' -> CNPJ do RR; source 'bbts' -> CNPJ da ADS.
  //     Cada CNPJ carrega a comissão que ele realmente gerou.
  //
  // payable = comissão − DESCONTOS: o desconto é retenção da empresa (dinheiro que NÃO
  // sai), então o líquido é o custo. Isso continua — é legítimo.
  //
  // ATENÇÃO (pegadinha real): a coluna promoter_monthly_results.discount_value está
  // ZERADA em produção. O desconto de verdade mora em `promoter_discounts`, e é de lá
  // que promoterAnalytics:688 o lê — com o filtro `apply_to_company !== true` (desconto
  // que se aplica à EMPRESA não reduz o repasse do promotor). Usar a coluna do PMR
  // subtrairia zero e inflaria o custo em R$ 3.041,55 (junho). A tabela já traz
  // company_id, então o desconto é alocado ao CNPJ que o gerou — mesma lógica da
  // comissão.
  const regimeSources = regimeSel === "cms" ? ["cms"] : ["fechamento", "bbts"];
  const pmrRows = await fetchAllRows<{
    promoter_id: string;
    company_id: string | null;
    source: string | null;
    final_commission_value: number | null;
    piso_zerou: boolean | null;
  }>(() =>
    supabase
      .from("promoter_monthly_results")
      .select("promoter_id, company_id, source, final_commission_value, piso_zerou")
      .eq("year", selected.year)
      .eq("month", selected.month)
      .in("source", regimeSources)
  );
  // PISO DE REPASSE: promotores cuja linha foi zerada pelo piso. O desconto deles
  // NAO acontece na competencia (ver a supressao em promoterAnalytics, "PISO
  // ZEROU O REPASSE") — sem isto o custo do CNPJ ficaria NEGATIVO: comissao 0
  // menos desconto. A MESMA formula tem que dar o MESMO numero nas duas telas.
  const pisoZerouPromoters = new Set(
    pmrRows.filter((row) => row.piso_zerou === true).map((row) => row.promoter_id)
  );
  const comissaoByCompany = new Map<string, number>();
  for (const row of pmrRows) {
    const cid = row.company_id || "";
    if (!cid) continue; // linha sem empresa: não há CNPJ onde alocar (0 linhas hoje)
    comissaoByCompany.set(cid, toNum(comissaoByCompany.get(cid)) + toNum(row.final_commission_value));
  }

  const descontoRows = await fetchAllRows<{
    promoter_id: string | null;
    company_id: string | null;
    amount: number | null;
    apply_to_company: boolean | null;
  }>(() =>
    supabase
      .from("promoter_discounts")
      .select("promoter_id, company_id, amount, apply_to_company")
      .eq("year", selected.year)
      .eq("month", selected.month)
  );
  let descontoSemEmpresa = 0;
  for (const row of descontoRows) {
    if (row.apply_to_company === true) continue; // não reduz o repasse do promotor
    // piso zerou o repasse => o desconto NÃO acontece (não é absorvido).
    if (row.promoter_id && pisoZerouPromoters.has(row.promoter_id)) continue;
    const cid = row.company_id || "";
    const amount = toNum(row.amount);
    if (!cid) {
      descontoSemEmpresa += amount; // sem CNPJ: não dá para alocar — vira alerta
      continue;
    }
    comissaoByCompany.set(cid, toNum(comissaoByCompany.get(cid)) - amount);
  }
  if (descontoSemEmpresa > 0) {
    alerts.push(
      `Há ${descontoSemEmpresa.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em descontos ` +
        "de promotor SEM CNPJ (company_id nulo) — não foi possível alocá-los a uma empresa, então NÃO reduzem " +
        "a comissão de nenhum CNPJ. O custo do grupo está superestimado nesse valor."
    );
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

  // ---- empresa COM comissão e SEM receita: inclui + ALERTA DURO ----
  //
  // Esta guarda nasceu no MOV 2 EXCLUINDO a empresa (era a ADS, que não tinha receita
  // no DRE porque a receita dela não estava sendo lida). Agora que a receita da ADS
  // entra (AVT+PRT+seguro), a exclusão perdeu o motivo — e ela VIOLAVA a regra: o DRE
  // não descarta custo que saiu.
  //
  // O que sobra é o caso do DADO INCOMPLETO: a empresa tem comissão mas o fechamento
  // dela não foi importado ainda (ex.: ADS em julho — a diária entrou, o PDF do
  // fechamento não). Aí a receita é 0 por FALTA DE IMPORT, não por não existir.
  //
  // MESMO PRINCÍPIO ANTI-SILÊNCIO DO FORECAST (vintage incompleto AVISA, não descarta):
  // a empresa ENTRA no DRE com o custo real, e um alerta DURO diz que o resultado está
  // incompleto até o PDF ser importado. Descartar em silêncio seria mentir por omissão;
  // incluir sem avisar seria mentir por otimismo. O alerta é o que mantém o número honesto.
  const semReceitaComComissao = companies.filter(
    (c) =>
      toNum(receitaFechamentoByCompany.get(c.id)) === 0 &&
      toNum(receitaComplementarByCompany.get(c.id)) === 0 &&
      round(toNum(comissaoByCompany.get(c.id))) > 0
  );
  for (const c of semReceitaComComissao) {
    const comissao = round(toNum(comissaoByCompany.get(c.id)));
    alerts.push(
      `RESULTADO INCOMPLETO — ${c.name} (${c.cnpj}) tem ` +
        `${comissao.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em comissões nesta ` +
        "competência, mas NENHUMA receita lançada: o fechamento dessa empresa ainda NÃO foi importado. " +
        "A comissão ENTRA no resultado (é custo real que saiu), então o resultado do grupo está " +
        "SUBESTIMADO até o fechamento ser importado. Importe o fechamento dessa competência."
    );
  }

  // ---- monta linhas por CNPJ ----
  // TODAS as empresas reais entram — nenhuma é descartada por não ter receita.
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

  // ==========================================================================
  // DELTA vs mes anterior (Fase 3) — para os CARDS do header da aba DRE.
  //
  // POR QUE O DRE TEM CARD: a regra transversal do Diego ("delta so em card de
  // KPI, nunca em tabela") existe para nao poluir tabela densa — nao para
  // excluir uma tela. O DRE e justamente onde o comparativo mes-a-mes tem mais
  // valor gerencial; so faltava card onde morar. O KpiBand no header e o MESMO
  // padrao do Dashboard e da /equipe, nao UI inventada. A tabela .dre-tbl
  // abaixo segue com os numeros puros.
  //
  // COMO O M-1 E OBTIDO: chamando o PROPRIO buildDre para a competencia
  // anterior (com semDelta, senao recursao infinita). E a unica forma de
  // garantir "linha com a MESMA linha": receita do M-1 sai da mesma soma de
  // fechamento + complementares + ADS, comissoes da mesma agregacao do PMR por
  // CNPJ, resultado da mesma subtracao. Reimplementar um leitor leve de M-1
  // aqui seria exatamente como a divergencia nasce.
  //
  // SEMPRE cheio-vs-cheio: o DRE so monta em mes FECHADO (as duas pontas sao
  // totais finais) e nenhuma das fontes tem data por linha para recortar.
  // M-1 sem DRE montavel => group null => valorAnterior null => o helper
  // esconde o delta daquele card.
  let deltas: DrePayload["deltas"] = null;
  if (!opts?.semDelta) {
    const compAnterior = competenciaAnterior({ year: selected.year, month: selected.month });
    let anterior: DreLine | null = null;
    try {
      const dreAnterior = await buildDre(supabase, compAnterior.year, compAnterior.month, {
        semDelta: true,
      });
      anterior = dreAnterior.closed ? dreAnterior.group : null;
    } catch {
      anterior = null;
    }

    const comp = { year: selected.year, month: selected.month };
    const fonte = "dre-fechado";
    const par = (atual: number, pegar: (l: DreLine) => number) =>
      calcularDelta({
        competencia: comp,
        valorAtual: atual,
        valorAnterior: anterior ? pegar(anterior) : null,
        fonteAtual: fonte,
        fonteAnterior: anterior ? fonte : null,
      });

    deltas = {
      // Cada ponta le a MESMA propriedade da MESMA estrutura nos dois meses.
      // Nunca cruzar linhas (receita x resultado, etc.).
      receita: par(gReceita, (l) => l.receita),
      comissoes: par(gComissoes, (l) => l.comissoes),
      resultadoLiquido: par(gResultadoLiquido, (l) => l.resultadoLiquido),
      receitaSeguro: par(gReceitaSeguro, (l) => l.receitaSeguro),
    };
  }

  return {
    closed: true,
    period: selected,
    periods,
    companies: visibleCompanies,
    group,
    deltas,
    alerts,
  };
}
