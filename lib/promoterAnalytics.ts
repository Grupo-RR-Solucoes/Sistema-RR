import type { SupabaseClient } from "@supabase/supabase-js";

import {
  calculateInsuranceCommissionFromRules,
  fetchInsuranceSlipRules,
} from "@/lib/insuranceCalculator";
import { calcularOperacao } from "@/lib/motor";
import type { TrpRegraProvider } from "@/lib/motor";
import { buildTrpCreditProvider } from "@/lib/trp/creditTrpProvider";
import { getPrazoTrp } from "@/lib/prazoTrp";
import { capAvistaRR } from "@/lib/tetoAvistaRR";
import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
// DELTA vs mes anterior (Fase 3) — calcularDelta e a UNICA fonte de calculo do
// sistema. Aqui so montamos as duas pontas da mesma metrica e chamamos.
import {
  calcularDelta,
  competenciaAnterior,
  resolverJanela,
  type ResultadoDelta,
} from "@/lib/delta/calcularDelta";
import { nowInFortaleza } from "@/lib/dateFortaleza";
import {
  getAgencyCode as getAgencyCodeShared,
  getSrccRestrictionLabel as getSrccRestrictionLabelShared,
} from "@/lib/proposalDetailing";
import { fetchAllRows } from "@/lib/queryHelpers";
import { getSupabaseAdmin, hasSupabaseEnv } from "@/lib/supabaseAdmin";
import { BBTS_COMPANY_ID } from "@/lib/bbtsCompanyId";
import {
  consolidatedInsuranceShare,
  primeInsuranceShareTiers,
} from "@/lib/insurancePenetration";
import { resolveBbtsRegraDb } from "@/lib/bbts/resolveBbtsRegra";
import { seguroRateFromRegra } from "@/lib/bbts/seguroBbts";
// Resolução de escopo (individual/grupo) extraída p/ módulo compartilhado — o
// recálculo (/api/calculate/monthly) reusa o MESMO resolvedor. Re-exporta os
// sentinelas p/ não quebrar quem importa daqui.
import {
  resolveCompanyScope,
  COMPANY_SCOPE_GROUP_RR,
  COMPANY_SCOPE_GROUP_ADS,
} from "@/lib/companyScope";

export { COMPANY_SCOPE_GROUP_RR, COMPANY_SCOPE_GROUP_ADS };

type CompanyRow = {
  id: string;
  name: string;
  cnpj: string;
  group_name?: string | null;
};

type PromoterRow = {
  id: string;
  company_id?: string | null;
  name: string;
  status?: string | null;
  active?: boolean | null;
  is_master?: boolean | null;
  estado?: string | null;
  supervisor_user_id?: string | null;
};

type JKeyRow = {
  id: string;
  promoter_id?: string | null;
};

type TargetRow = {
  promoter_id: string;
  company_id?: string | null;
  year: number;
  month: number;
  meta?: number | null;
  meta_1?: number | null;
  meta_2?: number | null;
};

type MonthlyResultRow = {
  promoter_id: string;
  company_id?: string | null;
  year: number;
  month: number;
  production_value?: number | null;
  proposal_count?: number | null;
  insured_proposal_count?: number | null;
  insured_production_value?: number | null;
  insurance_penetration_percent?: number | null;
  production_commission_value?: number | null;
  insurance_commission_value?: number | null;
  agreement_adjustment_value?: number | null;
  final_commission_value?: number | null;
  discount_value?: number | null;
  target_status?: string | null;
  source?: string | null;
  // Produtos (M2a/M2b): repasse ja somado no final_commission_value.
  bbcap_commission_value?: number | null;
  conta_corrente_commission_value?: number | null;
  consorcio_commission_value?: number | null;
};

type DiscountRow = {
  id: string;
  promoter_id?: string | null;
  company_id?: string | null;
  daily_production_record_id?: string | null;
  year: number;
  month: number;
  discount_type?: string | null;
  amount?: number | null;
  installments?: number | null;
  installment_number?: number | null;
  apply_to_company?: boolean | null;
  notes?: string | null;
};

type AgreementRow = {
  id: string;
  promoter_id: string;
  company_id?: string | null;
  year: number;
  month: number;
  agreement_type: string;
  commission_type?: string | null;
  commission_value?: number | null;
  active?: boolean | null;
  notes?: string | null;
};

type ProductionRow = {
  id: string;
  company_id?: string | null;
  j_key?: string | null;
  assigned_promoter_id?: string | null;
  original_promoter_id?: string | null;
  proposal_number?: string | null;
  contract_number?: string | null;
  product_description?: string | null;
  status?: string | null;
  movement_date?: string | null;
  contract_date?: string | null;
  proposal_date?: string | null;
  net_value?: number | null;
  gross_value?: number | null;
  insurance_value?: number | null;
  insurance_type?: string | null;
  has_insurance?: boolean | null;
  interest_rate?: number | null;
  term_months?: number | null;
  installments?: number | null;
  company_received_percent?: number | null;
  is_srcc_restricted?: boolean | null;
  promoter_commission_percent?: number | null;
  promoter_commission_amount?: number | null;
  insurance_commission_percent?: number | null;
  insurance_commission_amount?: number | null;
  commission_rule_source?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

export type PromoterAnalyticsPayload = {
  periods: Array<{ key: string; label: string; year: number; month: number }>;
  selectedPeriod: { key: string; label: string; year: number; month: number };
  selectedPromoterId: string;
  selectedCompanyId: string;
  /**
   * DELTA vs mês anterior (Fase 3) — SÓ para os 2 cards de topo da /promotores.
   * Já calculado por lib/delta/calcularDelta no servidor; a tela só renderiza
   * via <DeltaBadge/>. A TABELA de promotores não recebe delta (regra
   * transversal: delta só em card de KPI).
   *
   *   deltaProducao — recorta por dia em competência aberta (daily nas 2 pontas).
   *   deltaComissao — sempre cheio-vs-cheio (o PMR não tem data por linha).
   */
  deltaProducao: ResultadoDelta;
  deltaComissao: ResultadoDelta;
  summary: {
    promoters: number;
    production: number;
    // Produção TOTAL do grupo = atribuída (production) + master não atribuído.
    // Bate ao centavo com a "Produção do grupo" do Dashboard/Projeção. Só no
    // consolidado do grupo; com um promotor selecionado, productionUnassigned=0.
    productionTotal: number;
    productionUnassigned: number;
    productionUnassignedCount: number;
    finalCommission: number;
    payableCommission: number;
    discounts: number;
    averageInsurancePenetration: number;
    companyGrossCommission: number;
    unassignedCompanyGrossCommission: number;
    unassignedCount: number;
  };
  summaryRows: Array<{
    promoter_id: string;
    promoter_name: string;
    company_id?: string | null;
    company_name: string;
    company_cnpj: string;
    active: boolean;
    status: string;
    j_keys_count: number;
    production_value: number;
    proposal_count: number;
    insurance_penetration_percent: number;
    target_value: number;
    target_1_value: number;
    target_2_value: number;
    target_status: string;
    production_commission_value: number;
    insurance_commission_value: number;
    agreement_adjustment_value: number;
    bbcap_commission_value: number;
    conta_corrente_commission_value: number;
    consorcio_commission_value: number;
    discount_value: number;
    final_commission_value: number;
    payable_commission_value: number;
    result_source: string;
  }>;
  proposalRows: Array<{
    id: string;
    contract_number: string;
    proposal_number: string;
    agency_code: string;
    j_key: string;
    promoter_name: string;
    product_description: string;
    status: string;
    movement_date?: string | null;
    contract_date?: string | null;
    interest_rate: number;
    installment_count: number;
    company_received_percent: number;
    company_commission_amount: number;
    srcc_restriction: string;
    net_value: number;
    gross_value: number;
    insurance_value: number;
    company_insurance_commission_amount: number;
    insurance_penetration_percent: number;
    promoter_commission_percent: number;
    promoter_commission_amount: number;
    insurance_commission_percent: number;
    insurance_commission_amount: number;
    commission_rule_source: string;
    assigned_promoter_id?: string | null;
    assigned_promoter_name: string;
    original_promoter_id?: string | null;
    original_promoter_name: string;
  }>;
  agreementRows: Array<{
    id: string;
    agreement_type: string;
    commission_type: string;
    commission_value: number;
    notes: string;
  }>;
  discountRows: Array<{
    id: string;
    daily_production_record_id?: string | null;
    proposal_number: string;
    discount_type: string;
    amount: number;
    installments: number;
    installment_number: number;
    apply_to_company: boolean;
    notes: string;
  }>;
  promoterOptions: Array<{ id: string; name: string }>;
  promoterLookup: Array<{ id: string; name: string }>;
  companies: CompanyRow[];
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function toPercentRate(value: unknown) {
  const parsed = toNumber(value);
  if (!parsed) return 0;
  return Math.abs(parsed) > 1 ? parsed / 100 : parsed;
}

// Teto RR 5,80% da VISÃO do promotor. Valor da fonte única versionada.
// "CORRENTE": este caminho não carrega competência (deriva de um record
// avulso). Com um único snapshot é sempre correto — ver a nota em
// lib/tetoAvistaRR.ts antes de acrescentar um segundo.
function capPromoterViewRate(value: number) {
  return capAvistaRR(value, "CORRENTE");
}

function isMeaningfulAgreement(row: AgreementRow) {
  const value = toNumber(row.commission_value);
  return row.active !== false && value > 0;
}

function readRawPayloadValue(
  payload: Record<string, unknown> | null | undefined,
  aliases: string[]
) {
  if (!payload || typeof payload !== "object") return null;

  const normalizedAliases = aliases.map((alias) => normalizeText(alias));

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === "") continue;
    if (normalizedAliases.includes(normalizeText(key))) {
      return value;
    }
  }

  return null;
}

function deriveCompanyReceivedRate(
  record: ProductionRow,
  companyProductionValue: number,
  trpProvider?: TrpRegraProvider,
) {
  const netValue = toNumber(record.net_value);
  if (netValue <= 0) return 0;

  const rawProductCode = readRawPayloadValue(record.raw_payload, [
    "Produto",
    "Codigo Produto",
  ]);
  const rawConvenioCode = readRawPayloadValue(record.raw_payload, [
    "Codigo Convenio",
    "Cod Convenio",
    "Convenio",
  ]);
  const rawConvenioType = readRawPayloadValue(record.raw_payload, [
    "Tipo Convenio",
    "Tipo de Convenio",
  ]);
  const rawConvenioSegment = readRawPayloadValue(record.raw_payload, [
    "Segmento Convenio",
    "Convenio Segmento",
  ]);
  const rawInsuranceType = readRawPayloadValue(record.raw_payload, ["Tipo Seguro"]);

  const operation = calcularOperacao({
    valor_liquido: netValue,
    valor_bruto: toNumber(record.gross_value),
    valor_seguro: toNumber(record.insurance_value),
    taxa_juros: toNumber(record.interest_rate),
    // FIX-PRAZO-TRP: regra Promotiva (J/K) — 3100→Prazo, resto→Parcelas.
    prazo:
      getPrazoTrp(record) ??
      toNumber(record.term_months || record.installments),
    tem_seguro:
      toNumber(record.insurance_value) > 0 || Boolean(record.has_insurance),
    product_code:
      typeof rawProductCode === "string" || typeof rawProductCode === "number"
        ? rawProductCode
        : null,
    product_description: record.product_description,
    convenio_code:
      typeof rawConvenioCode === "string" || typeof rawConvenioCode === "number"
        ? rawConvenioCode
        : null,
    convenio_type: typeof rawConvenioType === "string" ? rawConvenioType : null,
    convenio_segment:
      typeof rawConvenioSegment === "string" || typeof rawConvenioSegment === "number"
        ? rawConvenioSegment
        : null,
    insurance_type: typeof rawInsuranceType === "string" ? rawInsuranceType : null,
    production_value: companyProductionValue,
    movement_date: record.movement_date,
    contract_date: record.contract_date,
    proposal_date: record.proposal_date,
  }, { trpProvider });

  const avistaEmpresa = toNumber(operation?.credito?.avista_empresa);
  if (avistaEmpresa <= 0) return 0;

  return avistaEmpresa / netValue;
}

/** Aliases da taxa a vista no raw_payload. Constante porque o PRIMEIRO degrau
 *  e consultado em mais de um ponto, e listas de alias copiadas divergem. */
const ALIASES_AVISTA_BRUTO = [
  "% A VISTA",
  "% À VISTA",
  "% A VISTA EMPRESA",
  "% AVISTA",
  "Percentual A Vista",
];

/**
 * De qual dos TRES DEGRAUS a taxa a vista veio.
 *
 *   bruto   veio do raw_payload da planilha (a fonte original)
 *   coluna  veio de company_received_percent (o que o importador guardou)
 *   derive  nenhum dos dois serviu; a taxa foi DERIVADA da TRP pelo motor
 *
 * "derive" NAO significa "sem comissao" — significa que a resposta veio da
 * regua em vez de vir pronta no registro. A confusao entre as duas coisas e
 * exatamente o defeito que a etiqueta "SEM REGRA TRP" cometia.
 */
export type DegrauTaxaAvista = "bruto" | "coluna" | "derive";

/**
 * Resolve a taxa E diz de onde ela veio, numa passada so.
 *
 * Existe para que ninguem precise perguntar "esta linha tem taxa propria?"
 * por fora, espelhando as guardas — havia um espelho desses aqui mesmo
 * (temTaxaPropria) e havia outro, pior, na tela: a etiqueta lia a coluna crua
 * e concluia "a Promotiva nao comissionou", pulando o terceiro degrau.
 */
function resolverTaxaComOrigem(
  record: ProductionRow,
  companyProductionValue: number,
  trpProvider?: TrpRegraProvider,
): { taxa: number; degrau: DegrauTaxaAvista } {
  const rawRate = toPercentRate(
    readRawPayloadValue(record.raw_payload, ALIASES_AVISTA_BRUTO)
  );
  if (rawRate > 0 && rawRate <= 0.065) {
    return { taxa: rawRate, degrau: "bruto" };
  }

  const storedRate = toPercentRate(record.company_received_percent);
  if (storedRate > 0 && storedRate <= 0.065) {
    return { taxa: storedRate, degrau: "coluna" };
  }

  return {
    taxa: deriveCompanyReceivedRate(record, companyProductionValue, trpProvider),
    degrau: "derive",
  };
}

function getCompanyReceivedRate(
  record: ProductionRow,
  companyProductionValue: number,
  trpProvider?: TrpRegraProvider,
) {
  return resolverTaxaComOrigem(record, companyProductionValue, trpProvider).taxa;
}

function getPromoterViewCompanyRate(
  record: ProductionRow,
  companyProductionValue: number,
  trpProvider?: TrpRegraProvider,
) {
  return capPromoterViewRate(
    getCompanyReceivedRate(record, companyProductionValue, trpProvider)
  );
}

export type TaxaAvistaEfetiva = {
  /** Taxa em FRACAO (0,058 = 5,80%), ja com o teto da visao do promotor. */
  taxa: number;
  /** Degrau que respondeu. Ver DegrauTaxaAvista. */
  degrau: DegrauTaxaAvista;
  /**
   * A Promotiva de fato NAO comissiona esta proposta.
   *
   * So e true quando os TRES degraus falharam — inclusive o derive, que
   * consulta a TRP. E a unica leitura que autoriza dizer "sem regra TRP".
   */
  semRegra: boolean;
};

/**
 * A TAXA A VISTA EFETIVA de um registro — a mesma que o motor usa para pagar.
 *
 * POR QUE ESTA FUNCAO E EXPORTADA. Quem precisa saber se uma proposta foi
 * comissionada estava olhando `company_received_percent` cru, que e o SEGUNDO
 * degrau de tres. Um registro sem a coluna preenchida pode perfeitamente ter
 * taxa — ela vem do raw_payload (1o) ou da TRP pelo derive (3o). Ler so a
 * coluna e concluir "nao comissionou" e afirmacao falsa sobre dinheiro.
 *
 * NAO REIMPLEMENTE ESTA CASCATA no chamador. Foi reimplementando regra de
 * dinheiro "so para medir" que a FRENTE 3 produziu tres numeros invalidados
 * em sequencia (R$ 1,55 mi -> R$ 702 mil -> R$ 12,9 mil -> R$ 0 na medicao
 * real). Se precisar da taxa, chame aqui.
 *
 * @param producaoMensalDoGrupo producao do grupo no MES INTEIRO da
 *   competencia do registro — e a base da FAIXA da TRP, usada so pelo derive.
 *   Ver calcularProducaoMensalDoGrupo. Passar a producao recortada ou zero
 *   muda a faixa e portanto a taxa.
 */
export function resolverTaxaAvistaEfetiva(params: {
  record: ProductionRow;
  producaoMensalDoGrupo: number;
  trpProvider?: TrpRegraProvider;
}): TaxaAvistaEfetiva {
  const { record, producaoMensalDoGrupo, trpProvider } = params;
  const { taxa, degrau } = resolverTaxaComOrigem(
    record,
    producaoMensalDoGrupo,
    trpProvider
  );
  const comTeto = capPromoterViewRate(taxa);
  return { taxa: comTeto, degrau, semRegra: !(comTeto > 0) };
}

// ===========================================================================
// COMISSAO-EMPRESA COM RECORTE POR DIA (variacao vs mes anterior)
//
// POR QUE ESTA FUNCAO EXISTE, E POR QUE ELA MORA AQUI
// ---------------------------------------------------------------------------
// A variacao do card de comissao bruta precisa comparar julho 1..N contra
// junho 1..N. Somar isso do lado de fora exigiria reproduzir a regra de taxa
// (raw_payload -> coluna guardada -> derive da TRP, com teto), e regra de
// dinheiro reproduzida em dois lugares diverge no primeiro caso de borda.
// Entao a soma recortada nasce AQUI, ao lado da regra, e nao na rota.
//
// OS DOIS PARAMETROS SAO SEPARADOS DE PROPOSITO — e este e o ponto todo:
//
//   producaoMensalDoGrupo  a FAIXA. Vem da producao do MES INTEIRO, sempre,
//                          nas duas competencias. Faixa e conceito MENSAL: a
//                          TRP escalona por volume do mes, nao por volume do
//                          pedaco que estamos olhando.
//   ateDia                 o RECORTE. Decide apenas QUAIS LINHAS entram na
//                          soma.
//
// Sem essa separacao o recorte encolheria a producao usada para achar a
// faixa e empurraria parte das operacoes para uma faixa inferior — o corte
// mudaria a TAXA, nao so a janela, e a comparacao viraria aproximacao. Foi
// exatamente por isso que o recorte da comissao bruta chegou a ser recusado
// (26/07/2026) antes deste refinamento.
//
// Vale so para as linhas que caem no derive (~8%): as outras ~92% trazem a
// propria taxa a vista no registro e sao exatas com ou sem faixa.
// ===========================================================================
export type ParametrosComissaoEmpresaRecortada = {
  /** Registros ja carregados. A funcao NAO consulta o banco. */
  records: ProductionRow[];
  /** Competencia a somar. */
  competencia: { year: number; month: number };
  /**
   * Producao do grupo no MES INTEIRO desta competencia — a base da faixa.
   * NAO passe a producao recortada: ver o comentario acima.
   */
  producaoMensalDoGrupo: number;
  /**
   * Dia de corte (1..31). So limita QUAIS linhas somam. `null` = mes inteiro,
   * que reproduz exatamente o total de hoje.
   */
  ateDia: number | null;
  /** Ids de empresa do escopo. Omitir = todas. */
  companyIds?: string[] | null;
  trpProvider?: TrpRegraProvider;
};

/**
 * A BASE DA FAIXA: producao do grupo numa competencia, MES INTEIRO.
 *
 * Existe exportada para que o chamador de calcularComissaoEmpresaRecortada NAO
 * precise montar esta soma a mao. Ela parece trivial — Sigma net das linhas
 * elegiveis — mas "elegivel" e "de qual competencia" sao as MESMAS definicoes
 * que a soma da comissao usa (isEligibleProductionRecord + extractYearMonth).
 * Se o chamador espelhasse isso, um dia as duas leituras discordariam e a faixa
 * sairia de um conjunto diferente do que a soma percorre — divergencia
 * silenciosa, do tipo que so aparece no centavo.
 *
 * Espelha buildPromoterAnalytics:794-805 (groupProductionValue): SEM recorte de
 * dia e SEM filtro de empresa por padrao — o enquadramento Promotiva e por
 * grupo empresarial, nao por CNPJ.
 */
export function calcularProducaoMensalDoGrupo(params: {
  records: ProductionRow[];
  competencia: { year: number; month: number };
  companyIds?: string[] | null;
}): { total: number; linhas: number } {
  const { records, competencia, companyIds } = params;
  let total = 0;
  let linhas = 0;
  for (const record of records) {
    if (!record.company_id) continue;
    if (companyIds && !companyIds.includes(record.company_id)) continue;
    if (!isEligibleProductionRecord(record)) continue;
    const periodo = extractYearMonth(record);
    if (
      !periodo ||
      periodo.year !== competencia.year ||
      periodo.month !== competencia.month
    ) {
      continue;
    }
    total += toNumber(record.net_value);
    linhas += 1;
  }
  return { total: Math.round(total * 100) / 100, linhas };
}

export type ComissaoEmpresaRecortada = {
  /** Σ (net × taxa) das linhas dentro do corte. */
  total: number;
  /** Linhas ELEGIVEIS na competencia, antes do corte de dia. */
  linhasNaCompetencia: number;
  /** Linhas que entraram na soma (dentro do corte). */
  linhasSomadas: number;
  /** Linhas somadas que dependeram do derive (faixa) para achar a taxa. */
  linhasComDerive: number;
};

export function calcularComissaoEmpresaRecortada(
  params: ParametrosComissaoEmpresaRecortada
): ComissaoEmpresaRecortada {
  const { records, competencia, producaoMensalDoGrupo, ateDia, companyIds, trpProvider } =
    params;

  let total = 0;
  let linhasNaCompetencia = 0;
  let linhasSomadas = 0;
  let linhasComDerive = 0;

  for (const record of records) {
    if (companyIds && !companyIds.includes(record.company_id || "")) continue;
    if (!isEligibleProductionRecord(record)) continue;
    const periodo = extractYearMonth(record);
    if (
      !periodo ||
      periodo.year !== competencia.year ||
      periodo.month !== competencia.month
    ) {
      continue;
    }
    linhasNaCompetencia += 1;

    if (ateDia != null) {
      // Mesma cadeia de datas do resto do modulo (movement -> contract ->
      // proposal), para o corte cair no mesmo dia que a producao ja usa.
      const bruta = record.movement_date || record.contract_date || record.proposal_date;
      const dia = Number(String(bruta ?? "").slice(8, 10));
      if (!(dia >= 1 && dia <= ateDia)) continue;
    }

    // A FAIXA usa a producao do mes INTEIRO — o recorte nao entra aqui.
    // Uma passada so devolve a taxa E o degrau: antes isto chamava a cascata
    // duas vezes (getPromoterViewCompanyRate + temTaxaPropria, que espelhava
    // as duas primeiras guardas), rodando o derive a toa e mantendo um espelho
    // que podia divergir da regra que ele dizia espelhar.
    const { taxa: taxaBruta, degrau } = resolverTaxaComOrigem(
      record,
      producaoMensalDoGrupo,
      trpProvider
    );
    const taxa = capPromoterViewRate(taxaBruta);
    if (degrau === "derive") linhasComDerive += 1;
    total += toNumber(record.net_value) * taxa;
    linhasSomadas += 1;
  }

  return {
    total: Math.round(total * 100) / 100,
    linhasNaCompetencia,
    linhasSomadas,
    linhasComDerive,
  };
}

// FIX-3.SEGURO — getInsuranceCompanyRate e calculateCompanyInsuranceCommission
// removidos. Migrados para insurance_slip_rules + calculateInsuranceCommissionFromRules
// (fonte única com route.ts; ver linha company_insurance_commission_amount).

// 4.4-fix-1.B.1: helpers extraidos para lib/proposalDetailing.ts.
// Wrappers locais mantidos com o mesmo nome para preservar
// chamadores internos sem mudar o restante do arquivo.
function getSrccRestrictionLabel(record: ProductionRow) {
  return getSrccRestrictionLabelShared(record);
}

function getAgencyCode(record: ProductionRow) {
  return getAgencyCodeShared(record);
}

function getPeriodKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getPeriodLabel(year: number, month: number) {
  const monthNames = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];

  return `${monthNames[month - 1]}/${String(year).slice(-2)}`;
}

function comparePeriods(a: { year: number; month: number }, b: { year: number; month: number }) {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function extractYearMonth(record: ProductionRow) {
  return (
    getProductionPeriodFromValue(record.movement_date) ||
    getProductionPeriodFromValue(record.contract_date) ||
    getProductionPeriodFromValue(record.proposal_date)
  );
}

function isProductionStatus(status: unknown) {
  const normalized = normalizeText(status);
  return normalized === "PRODUCAO" || normalized === "PRODUCTION";
}

function isEligibleProductionRecord(record: ProductionRow) {
  return isProductionStatus(record.status) && record.is_srcc_restricted !== true;
}

function resolveTargetStatus(
  productionValue: number,
  target: number,
  target1: number,
  target2: number
) {
  if (target2 > 0 && productionValue >= target2) return "META_2";
  if (target1 > 0 && productionValue >= target1) return "META_1";
  if (target > 0 && productionValue >= target) return "META";
  // BELOW_META e o vocabulario do PMR (o que os 5 consolidadores gravam na
  // coluna target_status). Este caminho vivo devolvia "ABAIXO", entao o MESMO
  // promotor mudava de string conforme o regime do mes (fechado lia BELOW_META
  // do PMR; aberto computava ABAIXO aqui).
  return "BELOW_META";
}

// ETAPA 7 — base fetch-once: as 9 queries + summaryRows de TODOS os promotores
// (independente de promotor selecionado). O lote chama isto 1x e fatia N vezes
// com selectPromoterView, em vez de refazer 9 queries por promotor.
export async function loadPromoterAnalyticsBase(
  supabase: SupabaseClient,
  filters?: {
    year?: number;
    month?: number;
    companyId?: string;
    // Regime do mês: FECHADO (true) ou indefinido => pode usar o PMR (CALCULATED).
    // ABERTO (false) => ignora o PMR (snapshot defasado) e força LIVE_BASE (daily
    // ao vivo). Quem decide é o CHAMADOR (via detectClosedMonth). Default sem
    // closed = comportamento anterior (CALCULATED) — preserva dre/projecao.
    closed?: boolean;
    // VIRADA DE TELA — fonte do mês FECHADO: 'cms' (jan-mai, seed) ou 'fechamento'
    // (jun+). PRESENTE => caminho CONSOLIDADO: soma as linhas do PMR por promotor no
    // escopo (sem filtro = fechamento+bbts; grupo/empresa = só as do escopo), em vez
    // do .find() de UMA linha. AUSENTE => comportamento anterior (dre/projecao intactos).
    closedSource?: "cms" | "fechamento";
    // DELTA (Fase 3) — REGIME DA COMPETÊNCIA ANTERIOR (M-1), detectado por quem
    // chama. Define de qual fonte sai o M-1 do delta ('cms' vs
    // 'fechamento'+'bbts'). Ausente => sem M-1 => o delta some (é o certo:
    // sem o regime não dá para escolher a fonte com segurança).
    previousClosedSource?: "cms" | "fechamento";
  }
) {
  const yearParam = filters?.year;
  const monthParam = filters?.month;
  const companyId = filters?.companyId || "";
  const closedSource = filters?.closedSource;
  const previousClosedSource = filters?.previousClosedSource;

  // companies PRIMEIRO — necessário para resolver o escopo de grupo (Grupo RR / ADS)
  // antes de escopar o daily. Os promotores são buscados SEM filtro de empresa: no
  // fechado a linha vem do PMR (um promotor ADS pode ter home RR), e o recorte por
  // escopo acontece em filteredSummaryRows / na agregação do PMR.
  const companies = await fetchAllRows<CompanyRow>(() =>
    supabase
      .from("companies")
      .select("id, name, cnpj, group_name")
      .order("name", { ascending: true })
  );
  const scope = resolveCompanyScope(companyId, companies);

  const [promoters, jKeys, targets, monthlyResults, discounts, agreements, records, insuranceSlipRules] =
    await Promise.all([
      fetchAllRows<PromoterRow>(() =>
        supabase
          .from("promoters")
          .select("id, company_id, name, status, active, is_master, estado, supervisor_user_id")
          .order("name", { ascending: true })
      ),
      fetchAllRows<JKeyRow>(() => supabase.from("j_keys").select("id, promoter_id")),
      fetchAllRows<TargetRow>(() =>
        supabase
          .from("monthly_targets")
          .select("promoter_id, company_id, year, month, meta, meta_1, meta_2")
      ),
      fetchAllRows<MonthlyResultRow>(() =>
        supabase
          .from("promoter_monthly_results")
          .select(
            "promoter_id, company_id, year, month, production_value, proposal_count, insured_proposal_count, insured_production_value, insurance_penetration_percent, production_commission_value, insurance_commission_value, agreement_adjustment_value, final_commission_value, discount_value, target_status, source, bbcap_commission_value, conta_corrente_commission_value, consorcio_commission_value"
          )
      ),
      fetchAllRows<DiscountRow>(() =>
        supabase
          .from("promoter_discounts")
          .select(
            "id, promoter_id, company_id, daily_production_record_id, year, month, discount_type, amount, installments, installment_number, apply_to_company, notes"
          )
      ),
      fetchAllRows<AgreementRow>(() =>
        supabase
          .from("promoter_agreements")
          .select(
            "id, promoter_id, company_id, year, month, agreement_type, commission_type, commission_value, active, notes"
          )
      ),
      fetchAllRows<ProductionRow>(() => {
        let query = supabase
          .from("daily_production_records")
          .select(
            "id, company_id, j_key, assigned_promoter_id, original_promoter_id, proposal_number, contract_number, product_description, status, movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value, insurance_type, has_insurance, interest_rate, term_months, installments, company_received_percent, is_srcc_restricted, promoter_commission_percent, promoter_commission_amount, insurance_commission_percent, insurance_commission_amount, commission_rule_source, raw_payload"
          )
          .order("movement_date", { ascending: false });

        if (scope.companyIds) {
          query = query.in("company_id", scope.companyIds);
        }

        return query;
      }),
      // FIX-3.SEGURO — carrega TRP §188 / ESTOQUE 1x para passar ao
      // calculateInsuranceCommissionFromRules no loop de records.
      fetchInsuranceSlipRules(supabase),
    ]);

  const periodsMap = new Map<string, { key: string; label: string; year: number; month: number }>();

  for (const row of monthlyResults) {
    periodsMap.set(getPeriodKey(row.year, row.month), {
      key: getPeriodKey(row.year, row.month),
      label: getPeriodLabel(row.year, row.month),
      year: row.year,
      month: row.month,
    });
  }

  for (const row of targets) {
    periodsMap.set(getPeriodKey(row.year, row.month), {
      key: getPeriodKey(row.year, row.month),
      label: getPeriodLabel(row.year, row.month),
      year: row.year,
      month: row.month,
    });
  }

  for (const row of records) {
    const period = extractYearMonth(row);
    if (!period) continue;

    periodsMap.set(getPeriodKey(period.year, period.month), {
      key: getPeriodKey(period.year, period.month),
      label: getPeriodLabel(period.year, period.month),
      year: period.year,
      month: period.month,
    });
  }

  const periods = Array.from(periodsMap.values()).sort((a, b) => comparePeriods(b, a));
  const latestPeriod =
    periods.find((period) => period.year === yearParam && period.month === monthParam) ||
    periods[0] ||
    {
      key: getPeriodKey(new Date().getFullYear(), new Date().getMonth() + 1),
      label: getPeriodLabel(new Date().getFullYear(), new Date().getMonth() + 1),
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
    };

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const promoterById = new Map(promoters.map((promoter) => [promoter.id, promoter]));

  const recordsForPeriod = records.filter((record) => {
    const period = extractYearMonth(record);
    return period && period.year === latestPeriod.year && period.month === latestPeriod.month;
  });

  // TRP self-service: fonte da regra de crédito atrás da flag TRP_SOURCE. Preload
  // async 1x das competências do período (derivadas do contract_date, a MESMA chave
  // do motor); as taxas por registro (getPromoterViewCompanyRate) seguem síncronas.
  // Sem db-source, provider=undefined -> motor lê o JSON (no-op).
  const trpProvider = await buildTrpCreditProvider(
    recordsForPeriod.map((record) => record.contract_date)
  );

  const companyProductionMap = new Map<string, number>();
  // CORREÇÃO A — Produção CONSOLIDADA do grupo no periodo selecionado.
  // O enquadramento Promotiva é por grupo empresarial, nao por CNPJ.
  let groupProductionValue = 0;
  for (const record of recordsForPeriod) {
    if (!record.company_id) continue;
    if (!isEligibleProductionRecord(record)) continue;

    const netValue = toNumber(record.net_value);
    companyProductionMap.set(
      record.company_id,
      toNumber(companyProductionMap.get(record.company_id)) + netValue
    );
    groupProductionValue += netValue;
  }

  // Comissão BRUTA da EMPRESA do grupo no período (company_commission) = ganho
  // da EMPRESA, NÃO o repasse do promotor. net × taxa da empresa, exatamente a
  // mesma getPromoterViewCompanyRate das proposalRows (teto 5,80% + derive TRP
  // p/ registros sem % à vista armazenado). Respeita o filtro de empresa; a
  // derivação da taxa usa a produção CONSOLIDADA do grupo (igual às propostas).
  // unassigned* = parcela do bruto sobre operações AINDA SEM promotor atribuído.
  // Faz parte do bruto (a empresa fatura), mas é o que ainda falta distribuir;
  // encolhe conforme o funcionário atribui na Migração. Exposto p/ o sublabel.
  let companyGrossCommission = 0;
  let unassignedCompanyGrossCommission = 0;
  let unassignedCount = 0;
  // Produção (net) em chave MASTER ainda sem promotor: mesma fonte/criterio do
  // Dashboard (registros PRODUCAO válidos do período, assigned_promoter_id null).
  // Entra só no consolidado do grupo; nenhum promotor individual a recebe.
  let unassignedProduction = 0;
  // Mês FECHADO consolidado (closedSource): esses agregados vêm do PMR, não do
  // daily. Zera aqui — senão a produção master do daily (inclui a SRCC não flagada)
  // vazaria no productionTotal e infla. No fechamento não há órfão (herança resolve).
  if (!closedSource) {
    for (const record of recordsForPeriod) {
      if (scope.companyIds && !scope.companyIds.includes(record.company_id || "")) continue;
      if (!isEligibleProductionRecord(record)) continue;
      const commission =
        toNumber(record.net_value) *
        getPromoterViewCompanyRate(record, groupProductionValue, trpProvider);
      companyGrossCommission += commission;
      if (!record.assigned_promoter_id) {
        unassignedCompanyGrossCommission += commission;
        unassignedProduction += toNumber(record.net_value);
        unassignedCount += 1;
      }
    }
  }

  const summaryRows = promoters.map((promoter) => {
    const promoterRecords = recordsForPeriod.filter(
      (record) => record.assigned_promoter_id === promoter.id
    );
    const validRecords = promoterRecords.filter(isEligibleProductionRecord);
    // Mês ABERTO (filters.closed === false): NÃO usa o PMR (snapshot defasado) —
    // result = undefined força o ramo LIVE_BASE (Σ daily ao vivo), alinhando com a
    // projeção. Fechado (true) ou indefinido: mantém CALCULATED (PMR/cms) — idêntico
    // ao comportamento anterior. Recorte só do mês aberto; não toca histórico fechado.
    const result =
      filters?.closed === false
        ? undefined
        : monthlyResults.find(
            (row) =>
              row.promoter_id === promoter.id &&
              row.year === latestPeriod.year &&
              row.month === latestPeriod.month
          );
    const target = targets.find(
      (row) =>
        row.promoter_id === promoter.id &&
        row.year === latestPeriod.year &&
        row.month === latestPeriod.month
    );
    const discountValue = discounts
      .filter(
        (row) =>
          row.promoter_id === promoter.id &&
          row.year === latestPeriod.year &&
          row.month === latestPeriod.month &&
          row.apply_to_company !== true
      )
      .reduce((sum, row) => sum + toNumber(row.amount), 0);

    const productionValue = result
      ? toNumber(result.production_value)
      : validRecords.reduce((sum, row) => sum + toNumber(row.net_value), 0);
    const grossValue = validRecords.reduce((sum, row) => sum + toNumber(row.gross_value), 0);
    const insuredGrossValue = validRecords
      .filter((row) => toNumber(row.insurance_value) > 0 || row.has_insurance)
      .reduce((sum, row) => sum + toNumber(row.gross_value), 0);

    const productionCommissionValue = result
      ? toNumber(result.production_commission_value)
      : validRecords.reduce((sum, row) => sum + toNumber(row.promoter_commission_amount), 0);
    const insuranceCommissionValue = result
      ? toNumber(result.insurance_commission_value)
      : validRecords.reduce((sum, row) => sum + toNumber(row.insurance_commission_amount), 0);
    const agreementAdjustmentValue = result ? toNumber(result.agreement_adjustment_value) : 0;
    const finalCommissionValue = result
      ? toNumber(result.final_commission_value)
      : productionCommissionValue + insuranceCommissionValue + agreementAdjustmentValue;

    const targetValue = toNumber(target?.meta);
    const target1Value = toNumber(target?.meta_1);
    const target2Value = toNumber(target?.meta_2);
    const targetStatus =
      result?.target_status ||
      resolveTargetStatus(productionValue, targetValue, target1Value, target2Value);

    return {
      promoter_id: promoter.id,
      promoter_name: promoter.name,
      company_id: promoter.company_id,
      company_name: companyById.get(promoter.company_id || "")?.name || "-",
      company_cnpj: companyById.get(promoter.company_id || "")?.cnpj || "",
      estado: promoter.estado ?? null,
      active: promoter.active !== false,
      status: promoter.status || (promoter.active === false ? "DISMISSED" : "ACTIVE"),
      j_keys_count: jKeys.filter((jKey) => jKey.promoter_id === promoter.id).length,
      production_value: productionValue,
      proposal_count: result ? toNumber(result.proposal_count) : validRecords.length,
      insurance_penetration_percent:
        result?.insurance_penetration_percent !== undefined &&
        result?.insurance_penetration_percent !== null
          ? toNumber(result.insurance_penetration_percent)
          : grossValue > 0
            ? (insuredGrossValue / grossValue) * 100
            : 0,
      target_value: targetValue,
      target_1_value: target1Value,
      target_2_value: target2Value,
      target_status: targetStatus,
      production_commission_value: productionCommissionValue,
      insurance_commission_value: insuranceCommissionValue,
      agreement_adjustment_value: agreementAdjustmentValue,
      // Produtos: so existem no PMR (nao ha fallback per-contrato no daily) -> 0 quando
      // nao ha linha de PMR (mes vivo antes do fechamento).
      bbcap_commission_value: result ? toNumber(result.bbcap_commission_value) : 0,
      conta_corrente_commission_value: result ? toNumber(result.conta_corrente_commission_value) : 0,
      consorcio_commission_value: result ? toNumber(result.consorcio_commission_value) : 0,
      discount_value: discountValue || toNumber(result?.discount_value),
      final_commission_value: finalCommissionValue,
      payable_commission_value:
        finalCommissionValue - (discountValue || toNumber(result?.discount_value)),
      result_source: result ? "CALCULATED" : "LIVE_BASE",
    };
  });

  // VIRADA — mês FECHADO consolidado: SOMA as linhas do PMR por promotor no escopo,
  // em vez do .find() de UMA linha (que mostrava metade de quem tem RR + ADS).
  // regime 'cms' => só source='cms' (jan-mai); 'fechamento' => source IN
  // ('fechamento','bbts') (jun+). O escopo (grupo/empresa) filtra pelo company_id da
  // PRÓPRIA linha do PMR (não pelo home do promotor) — assim a ADS aparece mesmo p/
  // promotor de home RR (ex.: Kétley). As linhas source='daily' (valor 0) ficam fora.
  const consolidatedSummaryRows = !closedSource
    ? null
    : (() => {
        const regimeSources = closedSource === "cms" ? ["cms"] : ["fechamento", "bbts"];
        type Agg = {
          production_value: number;
          insured_production_value: number;
          proposal_count: number;
          production_commission_value: number;
          insurance_commission_value: number;
          agreement_adjustment_value: number;
          bbcap_commission_value: number;
          conta_corrente_commission_value: number;
          consorcio_commission_value: number;
          final_commission_value: number;
          discount_value: number;
          target_status: string | null;
          company_id: string | null;
          best_production: number; // p/ escolher company_id/status da linha dominante
        };
        const agg = new Map<string, Agg>();
        for (const row of monthlyResults) {
          if (row.year !== latestPeriod.year || row.month !== latestPeriod.month) continue;
          if (!regimeSources.includes(String(row.source || ""))) continue;
          if (scope.companyIds && !scope.companyIds.includes(row.company_id || "")) continue;
          let a = agg.get(row.promoter_id);
          if (!a) {
            a = {
              production_value: 0,
              insured_production_value: 0,
              proposal_count: 0,
              production_commission_value: 0,
              insurance_commission_value: 0,
              agreement_adjustment_value: 0,
              bbcap_commission_value: 0,
              conta_corrente_commission_value: 0,
              consorcio_commission_value: 0,
              final_commission_value: 0,
              discount_value: 0,
              target_status: null,
              company_id: null,
              best_production: -1,
            };
            agg.set(row.promoter_id, a);
          }
          const prod = toNumber(row.production_value);
          a.production_value += prod;
          a.insured_production_value += toNumber(row.insured_production_value);
          a.proposal_count += toNumber(row.proposal_count);
          a.production_commission_value += toNumber(row.production_commission_value);
          a.insurance_commission_value += toNumber(row.insurance_commission_value);
          a.agreement_adjustment_value += toNumber(row.agreement_adjustment_value);
          a.bbcap_commission_value += toNumber(row.bbcap_commission_value);
          a.conta_corrente_commission_value += toNumber(row.conta_corrente_commission_value);
          a.consorcio_commission_value += toNumber(row.consorcio_commission_value);
          a.final_commission_value += toNumber(row.final_commission_value);
          a.discount_value += toNumber(row.discount_value);
          // company_id/status representativos = os da linha de MAIOR produção
          // (a RR/fechamento domina; a linha ADS não rouba o rótulo).
          if (prod > a.best_production) {
            a.best_production = prod;
            a.company_id = row.company_id ?? null;
            a.target_status = row.target_status ?? a.target_status;
          }
        }
        return [...agg.entries()].map(([pid, a]) => {
          const promoter = promoterById.get(pid);
          const target = targets.find(
            (t) => t.promoter_id === pid && t.year === latestPeriod.year && t.month === latestPeriod.month
          );
          const manualDiscount = discounts
            .filter(
              (d) =>
                d.promoter_id === pid &&
                d.year === latestPeriod.year &&
                d.month === latestPeriod.month &&
                d.apply_to_company !== true
            )
            .reduce((sum, d) => sum + toNumber(d.amount), 0);
          const discountValue = manualDiscount || a.discount_value;
          const targetValue = toNumber(target?.meta);
          const target1Value = toNumber(target?.meta_1);
          const target2Value = toNumber(target?.meta_2);
          return {
            promoter_id: pid,
            promoter_name: promoter?.name ?? "(promotor desconhecido)",
            company_id: a.company_id,
            company_name: companyById.get(a.company_id || "")?.name || "-",
            company_cnpj: companyById.get(a.company_id || "")?.cnpj || "",
            estado: promoter?.estado ?? null,
            active: promoter?.active !== false,
            status: promoter?.status || (promoter?.active === false ? "DISMISSED" : "ACTIVE"),
            j_keys_count: jKeys.filter((jKey) => jKey.promoter_id === pid).length,
            production_value: a.production_value,
            proposal_count: a.proposal_count,
            insurance_penetration_percent:
              a.production_value > 0 ? (a.insured_production_value / a.production_value) * 100 : 0,
            target_value: targetValue,
            target_1_value: target1Value,
            target_2_value: target2Value,
            target_status:
              a.target_status || resolveTargetStatus(a.production_value, targetValue, target1Value, target2Value),
            production_commission_value: a.production_commission_value,
            insurance_commission_value: a.insurance_commission_value,
            agreement_adjustment_value: a.agreement_adjustment_value,
            bbcap_commission_value: a.bbcap_commission_value,
            conta_corrente_commission_value: a.conta_corrente_commission_value,
            consorcio_commission_value: a.consorcio_commission_value,
            discount_value: discountValue,
            final_commission_value: a.final_commission_value,
            payable_commission_value: a.final_commission_value - discountValue,
            result_source: "CALCULATED",
          };
        });
      })();

  // Promotores que PRODUZIRAM no escopo, independentemente da empresa de
  // CADASTRO. recordsForPeriod ja vem restrito por companyId (a query acima),
  // entao ter registro aqui == ter produzido na empresa filtrada.
  const promotoresComProducaoNoEscopo = new Set(
    recordsForPeriod
      .map((record) => record.assigned_promoter_id)
      .filter((id): id is string => Boolean(id))
  );

  // O filtro por empresa segue a empresa de CADASTRO do promotor (row.company_id)
  // MAIS quem produziu no escopo. Sem a segunda metade, um promotor cadastrado em
  // outra empresa que produziu na filtrada sumia INTEIRO da tela: a producao dele
  // nao entrava no rank (fora de summaryRows) nem no balde (o registro TEM
  // assigned_promoter_id, entao nao conta como nao atribuido) -- evaporava.
  // Medido na ADS jul/2026: MARIA LETICIA, cadastrada em RR ALAGOAS 1, produziu
  // R$ 7.150,00 na ADS e a /projecao mostrava 258.499,01 em vez de 265.649,01.
  // A linha do promotor ja era calculada com registros do escopo (promoterRecords
  // sai de recordsForPeriod), entao ela so estava sendo DESCARTADA no fim.
  const filteredSummaryRows = (
    consolidatedSummaryRows ??
    summaryRows.filter((row) =>
      scope.companyIds
        ? scope.companyIds.includes(row.company_id || "") ||
          promotoresComProducaoNoEscopo.has(row.promoter_id)
        : true
    )
  ).sort((a, b) => b.payable_commission_value - a.payable_commission_value);

  // FAIXA DE REPASSE do seguro, por promotor, pela penetração CONSOLIDADA
  // (RR + ADS somadas) — a MESMA regra do BBTS-2d, via a função única
  // consolidatedInsuranceShare. Escopo CONSOLIDADO de propósito: a faixa do
  // promotor não pode mudar só porque a tela está filtrada numa empresa.
  //
  // Por isso a query abaixo NÃO leva scope.companyIds: precisa das duas pontas.
  // É o mesmo critério de "segurado" que o summary usa no ramo LIVE
  // (insurance_value > 0 || has_insurance) sobre base BRUTA.
  // Mesma razao do bbtsRegraSeguro abaixo: share_scale/share_scale_tier tambem
  // sao tabelas de REGUA sob RLS. Com o client do usuario, primeInsuranceShareTiers
  // cai na REDE (literal) sem falhar — a faixa sairia do fallback em vez da
  // tabela versionada. service_role le a fonte canonica.
  const leitorDeRegua = hasSupabaseEnv() ? getSupabaseAdmin() : supabase;
  await primeInsuranceShareTiers(leitorDeRegua as any);
  const seguroShareByPromoter = new Map<string, { penetracao: number; share: number }>();
  {
    const todasEmpresas = await fetchAllRows<any>(() =>
      supabase
        .from("daily_production_records")
        .select(
          "company_id, assigned_promoter_id, gross_value, insurance_value, has_insurance, status, is_srcc_restricted, movement_date, contract_date, proposal_date"
        )
    );
    type Tot = { seguradoRR: number; totalRR: number; seguradoADS: number; totalADS: number };
    const porPromotor = new Map<string, Tot>();
    for (const r of todasEmpresas) {
      const pid = r.assigned_promoter_id as string | null;
      if (!pid) continue;
      const per =
        getProductionPeriodFromValue(r.movement_date) ||
        getProductionPeriodFromValue(r.contract_date) ||
        getProductionPeriodFromValue(r.proposal_date);
      if (!per || per.year !== latestPeriod.year || per.month !== latestPeriod.month) continue;
      if (!isEligibleProductionRecord(r)) continue;
      const t = porPromotor.get(pid) ?? { seguradoRR: 0, totalRR: 0, seguradoADS: 0, totalADS: 0 };
      const bruto = toNumber(r.gross_value);
      const temSeguro = toNumber(r.insurance_value) > 0 || Boolean(r.has_insurance);
      if (r.company_id === BBTS_COMPANY_ID) {
        t.totalADS += bruto;
        if (temSeguro) t.seguradoADS += bruto;
      } else {
        t.totalRR += bruto;
        if (temSeguro) t.seguradoRR += bruto;
      }
      porPromotor.set(pid, t);
    }
    for (const [pid, t] of porPromotor) {
      seguroShareByPromoter.set(pid, consolidatedInsuranceShare(t));
    }
  }

  // SEGURO DA ADS — regua PROPRIA (bbts_rule_versions), NUNCA a do RR
  // (insurance_slip_rules). Sao reguas INDEPENDENTES, com numeros diferentes e
  // gestora diferente: a do RR da ESTOQUE_D0 = gross x 0,15%, a da ADS da 0,10%.
  // Sem isto a coluna por contrato da /promotores mostrava o seguro da ADS pela
  // regua do RR (medido: contrato 219882642, 8.800 x 0,15% = R$ 13,20, quando a
  // regua da ADS manda 8.800 x 0,10% = R$ 8,80) e zerava os "SLIP NOVO", cuja
  // modalidade nao casa com o 'SLIP' da tabela do RR.
  // Carregada 1x por competencia, fora do Promise.all porque depende de
  // latestPeriod. null (regua ausente) => o consumidor NAO chuta: mostra 0.
  // LEITURA COM SERVICE_ROLE, DE PROPOSITO. bbts_rule_versions tem RLS
  // default-deny e ZERO policies (migration 20260712_000001: "authenticated/anon
  // nao leem nem escrevem; service_role ignora RLS"). O GET de /api/promotores
  // roda com withAuthenticatedAnon (JWT do usuario), entao a regua vinha NEGADA
  // (42501) e o seguro da ADS caia a ZERO na tela inteira — inclusive a
  // comissao-empresa. E uma tabela de TAXAS, nao dado de promotor: le-la com
  // service_role nao afrouxa a RLS que protege producao/comissao, que segue
  // valendo para todo o resto desta funcao.
  //
  // Fallback para o client recebido quando nao ha env de service_role (scripts /
  // testes que ja passam o proprio client).
  const bbtsRegraSeguro = await (async () => {
    try {
      const r = await resolveBbtsRegraDb(
        { competencia: `${latestPeriod.year}-${String(latestPeriod.month).padStart(2, "0")}` },
        leitorDeRegua as any
      );
      return r?.regra ?? null;
    } catch (e) {
      // NUNCA silencioso: sem regua, TODO seguro da ADS vira 0 na tela. Antes
      // este catch engolia o erro e o zero passava por "nao tem seguro".
      console.error(
        "[promoterAnalytics] regua BBTS (bbts_rule_versions) NAO carregada — o seguro da ADS vai aparecer ZERADO. Causa:",
        e instanceof Error ? e.message : e
      );
      return null;
    }
  })();

  const recordsById = new Map(recordsForPeriod.map((record) => [record.id, record]));

  // ---- M-1 do DELTA (Fase 3) — PMR da competência anterior ----
  // Agregado AQUI, junto do agregado do mês corrente, para as duas pontas
  // saírem do MESMO `monthlyResults` com o MESMO filtro de escopo. O universo
  // de promotores é recortado depois (em selectPromoterView) pelos próprios
  // summaryRows visíveis — assim o M-1 herda master/escopo/seleção sem
  // reimplementar nenhum filtro.
  //
  // previousClosedSource é o REGIME do M-1 (quem chama detecta e passa). Sem
  // ele o mapa fica vazio e o delta some — que é o certo: sem saber o regime
  // não dá para escolher a fonte, e somar 'cms' com 'fechamento' poderia
  // duplicar uma competência que tenha as duas.
  const compAnteriorPmr = competenciaAnterior({
    year: latestPeriod.year,
    month: latestPeriod.month,
  });
  const fontesAnteriores =
    previousClosedSource === "cms"
      ? ["cms"]
      : previousClosedSource === "fechamento"
        ? ["fechamento", "bbts"]
        : [];
  const pmrAnteriorPorPromotor = new Map<string, { producao: number; comissao: number }>();
  if (fontesAnteriores.length > 0) {
    for (const row of monthlyResults) {
      if (row.year !== compAnteriorPmr.year || row.month !== compAnteriorPmr.month) continue;
      if (!fontesAnteriores.includes(String(row.source || ""))) continue;
      if (scope.companyIds && !scope.companyIds.includes(row.company_id || "")) continue;
      const cur = pmrAnteriorPorPromotor.get(row.promoter_id) ?? { producao: 0, comissao: 0 };
      cur.producao += toNumber(row.production_value);
      cur.comissao += toNumber(row.final_commission_value);
      pmrAnteriorPorPromotor.set(row.promoter_id, cur);
    }
  }

  return {
    periods,
    latestPeriod,
    companyId,
    companies,
    promoters,
    promoterById,
    filteredSummaryRows,
    recordsForPeriod,
    // DELTA (Fase 3): M-1 por promotor + o regime que o produziu.
    pmrAnteriorPorPromotor,
    competenciaAnteriorPmr: compAnteriorPmr,
    previousClosedSource: previousClosedSource ?? null,
    closedSourceAtual: closedSource ?? null,
    // ADITIVO — base crua de TODOS os meses (sem recorte por competência) para
    // consumidores que precisam da série histórica (ex.: drill-down da /projecao).
    // recordsForPeriod continua sendo o recorte do mês selecionado (inalterado).
    records,
    targets,
    recordsById,
    groupProductionValue,
    // TRP self-service: provider (db) pre-carregado 1x; repassado a selectPromoterView
    // para as proposalRows usarem a MESMA fonte de crédito (síncrono). undefined em
    // modo json (motor lê o JSON).
    trpProvider,
    companyGrossCommission,
    unassignedCompanyGrossCommission,
    unassignedProduction,
    unassignedCount,
    agreements,
    discounts,
    insuranceSlipRules,
    bbtsRegraSeguro,
    seguroShareByPromoter,
  };
}

// ETAPA 7 — fatia a base pra UM promotor. Reproduz EXATAMENTE o recorte que o
// buildPromoterAnalytics original fazia (proposalRows/discountRows/agreementRows/
// summary), pra que cada relatorio do lote seja bit-a-bit igual ao individual.
export function selectPromoterView(
  base: Awaited<ReturnType<typeof loadPromoterAnalyticsBase>>,
  promoterId?: string,
  options?: { masterUnassigned?: boolean; allUnassigned?: boolean }
): PromoterAnalyticsPayload {
  const {
    periods,
    latestPeriod,
    companyId,
    companies,
    promoters,
    promoterById,
    filteredSummaryRows,
    recordsForPeriod,
    recordsById,
    groupProductionValue,
    trpProvider,
    companyGrossCommission,
    unassignedCompanyGrossCommission,
    unassignedProduction,
    unassignedCount,
    agreements,
    discounts,
    insuranceSlipRules,
    bbtsRegraSeguro,
    seguroShareByPromoter,
  } = base;

  // Taxa da regua BBTS para UM registro da ADS (0 quando nao resolve — NAO
  // chuta, mesmo contrato do consolidador em lib/bbtsMonthly.ts).
  const seguroTaxaDoRegistro = (record: any): number => {
    if (toNumber(record.insurance_value) <= 0) return 0;
    const meta = (record.raw_payload && record.raw_payload.__bbts_meta) || {};
    const taxa = seguroRateFromRegra(
      bbtsRegraSeguro,
      meta.seguro_tipo ?? record.insurance_type,
      record.term_months
    );
    return taxa.rate === null ? 0 : taxa.rate;
  };

  // Comissao-EMPRESA de seguro de UM registro, pela regua da empresa dona dele:
  // ADS -> bbts_rule_versions; qualquer outra -> insurance_slip_rules (RR).
  const seguroEmpresaDoRegistro = (record: any): number => {
    if (record.company_id === BBTS_COMPANY_ID) {
      return toNumber(record.insurance_value) * seguroTaxaDoRegistro(record);
    }
    return (
      calculateInsuranceCommissionFromRules({
        rules: insuranceSlipRules,
        grossValue: toNumber(record.gross_value),
        premioValue: toNumber(record.insurance_value),
        insuranceType: record.insurance_type,
        termPromotiva:
          getPrazoTrp(record) ?? toNumber(record.term_months || record.installments),
        contractDate: record.contract_date || record.movement_date,
      })?.amount ?? 0
    );
  };

  const requestedPromoterId = promoterId || "";
  const selectedPromoterId =
    requestedPromoterId &&
    filteredSummaryRows.some((row) => row.promoter_id === requestedPromoterId)
      ? requestedPromoterId
      : "";
  const selectedPromoterSummary =
    filteredSummaryRows.find((row) => row.promoter_id === selectedPromoterId) || null;
  const visibleSummaryRows = selectedPromoterId
    ? filteredSummaryRows.filter((row) => row.promoter_id === selectedPromoterId)
    : filteredSummaryRows;

  const agreementRows = agreements
    .filter(
      (row) =>
        row.promoter_id === selectedPromoterId &&
        row.year === latestPeriod.year &&
        row.month === latestPeriod.month &&
        isMeaningfulAgreement(row)
    )
    .map((row) => ({
      id: row.id,
      agreement_type: row.agreement_type,
      commission_type: row.commission_type || "PERCENT",
      commission_value: toNumber(row.commission_value),
      notes: String(row.notes || ""),
    }));

  const discountRows = discounts
    .filter(
      (row) =>
        row.promoter_id === selectedPromoterId &&
        row.year === latestPeriod.year &&
        row.month === latestPeriod.month
    )
    .map((row) => ({
      id: row.id,
      daily_production_record_id: row.daily_production_record_id || null,
      proposal_number:
        recordsById.get(row.daily_production_record_id || "")?.proposal_number || "-",
      discount_type: String(row.discount_type || "OUTROS"),
      amount: toNumber(row.amount),
      installments: Math.max(1, toNumber(row.installments) || 1),
      installment_number: Math.max(1, toNumber(row.installment_number) || 1),
      apply_to_company: row.apply_to_company === true,
      notes: String(row.notes || ""),
    }))
    .sort((a, b) => b.amount - a.amount);

  // Chave MASTER = balde temporário: as propostas digitadas nela entram em
  // daily_production_records com assigned_promoter_id = NULL (o import marca
  // promoter_source = MASTER_REASSIGNED e só preenche o id quando a Chave J é
  // INDIVIDUAL — ver app/api/import/daily/route.ts). O match exato
  // (assigned_promoter_id === id) nunca casa p/ master, por isso a aba Migração
  // vinha vazia justo em quem MAIS precisa redistribuir. Quando o chamador pede
  // (masterUnassigned) e o selecionado é is_master, lista o balde NÃO atribuído.
  // O escopo de empresa segue o filtro da tela: recordsForPeriod já vem
  // restrito por companyId quando há empresa selecionada (loadPromoterAnalyticsBase),
  // então NÃO filtramos por empresa aqui — com "todas" mostra todo o pendente,
  // sem esconder propostas de outra empresa. Promotor real: match exato de
  // sempre, intacto.
  const selectedPromoter = promoterById.get(selectedPromoterId) || null;
  const showMasterBucket =
    options?.masterUnassigned === true && selectedPromoter?.is_master === true;
  // AJUSTE 1 — modo agregado "todas as não atribuídas" (link do Dashboard,
  // ?unassigned=1): SEM promotor selecionado, lista TODO o balde pendente
  // (!assigned_promoter_id) no escopo da empresa atual (recordsForPeriod já
  // vem restrito por companyId). Só vale enquanto NENHUM promotor está
  // selecionado; ao escolher um real/master, volta ao comportamento normal
  // (match exato / PR #27).
  const showAllUnassigned =
    options?.allUnassigned === true && !selectedPromoterId;
  const showBucket = showMasterBucket || showAllUnassigned;

  const matchesProposalScope = (record: ProductionRow) =>
    showBucket
      ? !record.assigned_promoter_id
      : record.assigned_promoter_id === selectedPromoterId;

  const proposalRows = selectedPromoterId || showAllUnassigned
    ? recordsForPeriod
        .filter(
          (record) =>
            matchesProposalScope(record) && isEligibleProductionRecord(record)
        )
        .map((record) => {
          // CORREÇÃO A — usar produção CONSOLIDADA do grupo, nao por CNPJ.
          const promoterViewCompanyRate = getPromoterViewCompanyRate(
            record,
            groupProductionValue,
            trpProvider
          );

          return {
            id: record.id,
            contract_number: record.contract_number || record.proposal_number || "-",
            proposal_number: record.proposal_number || "-",
            agency_code: getAgencyCode(record),
            j_key: record.j_key || "",
            promoter_name:
              promoterById.get(record.assigned_promoter_id || "")?.name || "",
            product_description: record.product_description || "-",
            status: record.status || "-",
            movement_date: record.movement_date,
            contract_date: record.contract_date,
            interest_rate: toNumber(record.interest_rate),
            installment_count: toNumber(record.installments || record.term_months),
            company_received_percent: promoterViewCompanyRate,
            company_commission_amount:
              toNumber(record.net_value) * promoterViewCompanyRate,
            srcc_restriction: getSrccRestrictionLabel(record),
            net_value: toNumber(record.net_value),
            gross_value: toNumber(record.gross_value),
            insurance_value: toNumber(record.insurance_value),
            // FIX-3.SEGURO — fonte única com route.ts: usa TRP §188 +
            // base_field (gross|premio) + Parcelas via getPrazoTrp.
            // Mesma chamada produz o mesmo amount que o motor principal
            // grava em daily_production_records.insurance_commission_amount,
            // garantindo coerência nas duas colunas adjacentes em /promotores.
            // A ADS desvia para a régua BBTS (ver seguroEmpresaDoRegistro).
            company_insurance_commission_amount: seguroEmpresaDoRegistro(record),
            insurance_penetration_percent:
              toNumber(selectedPromoterSummary?.insurance_penetration_percent) / 100,
            promoter_commission_percent: toNumber(record.promoter_commission_percent),
            promoter_commission_amount: toNumber(record.promoter_commission_amount),
            // Estas duas saem CRUAS de daily_production_records — valor que o
            // motor mensal do RR persistiu. Para a ADS esse valor persistido e
            // LIXO da regua errada: foi gravado por app/api/calculate/monthly
            // antes da trava semAds, com insurance_slip_rules (ESTOQUE_D0 =
            // gross x 0,15% -> contrato 219882642 = R$ 13,20) e SEM_REGRA_TRP
            // (=> 0) nos "SLIP NOVO", cuja modalidade nao existe na tabela do
            // RR. E lixo CONGELADO: hoje o motor exclui a ADS, entao ninguem
            // reescreve a coluna, e o BBTS-2d so grava em
            // promoter_monthly_results, nunca em daily_production_records.
            //
            // Esta coluna e o REPASSE AO PROMOTOR ("Comissao seguro promotor"):
            //   comissao-empresa (regua BBTS) x faixa da escala SEGURO_SLIP,
            // com a faixa vindo da penetracao CONSOLIDADA do promotor (RR+ADS)
            // — a mesma regra do BBTS-2d, via seguroShareByPromoter.
            // Ela NAO bate com a coluna vizinha "Comissao seguro"
            // (company_insurance_commission_amount), e nao deve mesmo: aquela e
            // receita da EMPRESA, esta e repasse ao PROMOTOR.
            // Demais empresas continuam lendo o valor persistido, sem
            // recalculo: NADA muda fora da ADS.
            insurance_commission_percent:
              record.company_id === BBTS_COMPANY_ID
                ? seguroTaxaDoRegistro(record) * 100
                : toNumber(record.insurance_commission_percent),
            insurance_commission_amount:
              record.company_id === BBTS_COMPANY_ID
                ? seguroEmpresaDoRegistro(record) *
                  (seguroShareByPromoter.get(record.assigned_promoter_id || "")?.share ?? 0)
                : toNumber(record.insurance_commission_amount),
            commission_rule_source:
              record.company_id === BBTS_COMPANY_ID
                ? "BBTS_RULE_VERSIONS"
                : record.commission_rule_source || "",
            assigned_promoter_id: record.assigned_promoter_id,
            assigned_promoter_name:
              promoterById.get(record.assigned_promoter_id || "")?.name || "",
            original_promoter_id: record.original_promoter_id,
            original_promoter_name:
              promoterById.get(record.original_promoter_id || "")?.name || "",
          };
        })
    : [];

  const summary = visibleSummaryRows.reduce(
    (acc, row) => {
      acc.promoters += 1;
      acc.production += row.production_value;
      acc.finalCommission += row.final_commission_value;
      acc.payableCommission += row.payable_commission_value;
      acc.discounts += row.discount_value;
      acc.insurancePenetration += row.insurance_penetration_percent;
      return acc;
    },
    {
      promoters: 0,
      production: 0,
      finalCommission: 0,
      payableCommission: 0,
      discounts: 0,
      insurancePenetration: 0,
    }
  );

  // ==========================================================================
  // DELTA vs mês anterior (Fase 3) — SÓ os 2 cards de topo.
  // A tabela de promotores NÃO recebe delta (regra transversal: delta só em
  // card de KPI; tabela fica com os números puros).
  //
  // Universo do M-1 = os MESMOS promotores visíveis agora (visibleSummaryRows).
  // Isso faz o M-1 herdar escopo de empresa, exclusão de master e a seleção de
  // promotor sem reimplementar nenhum filtro. Promotor novo (sem linha no M-1)
  // simplesmente não soma — e, quando é o selecionado, o valorAnterior fica
  // null e o helper esconde o delta em vez de mostrar +infinito.
  // ==========================================================================
  const compAtualDelta = { year: latestPeriod.year, month: latestPeriod.month };
  const idsVisiveis = visibleSummaryRows.map((r) => r.promoter_id);
  const temM1 = base.previousClosedSource != null;

  let producaoAnterior = 0;
  let comissaoAnterior = 0;
  let promotoresComM1 = 0;
  for (const pid of idsVisiveis) {
    const p = base.pmrAnteriorPorPromotor.get(pid);
    if (!p) continue;
    promotoresComM1 += 1;
    producaoAnterior += p.producao;
    comissaoAnterior += p.comissao;
  }
  const houveM1 = temM1 && promotoresComM1 > 0;

  // ---- card PRODUÇÃO: recorta por dia quando a competência está aberta ----
  // As duas pontas do recorte saem do MESMO `base.records` (daily), com o MESMO
  // predicado de elegibilidade e o MESMO extractYearMonth — só o filtro de dia
  // muda. Universo idêntico ao dos cards (idsVisiveis).
  const agoraDelta = nowInFortaleza();
  const ehCorrenteDelta =
    latestPeriod.year === agoraDelta.year && latestPeriod.month === agoraDelta.month;
  const universo = new Set(idsVisiveis);

  // FASE 2.1 — dias-do-mes com produção lançada na competência CORRENTE, para o
  // corte virar min(hoje, último dia com dado). Mesmo predicado e mesmo
  // universo da soma abaixo.
  // Só dias do MÊS-CALENDÁRIO da competência: o "dia-cabeça" herdado do mês
  // anterior (30/06 na competência de julho) tem dia-do-mês alto e viraria o
  // máximo, mascarando até onde a diária foi de fato carregada.
  const prefixoMesCorrente = `${compAtualDelta.year}-${String(compAtualDelta.month).padStart(2, "0")}-`;
  const diasComDadoCorrente = new Set<number>();
  for (const record of base.records) {
    const pid = record.assigned_promoter_id || "";
    if (!universo.has(pid)) continue;
    if (!isEligibleProductionRecord(record)) continue;
    const p = extractYearMonth(record);
    if (!p || p.year !== compAtualDelta.year || p.month !== compAtualDelta.month) continue;
    const bruta = String(record.movement_date || record.contract_date || record.proposal_date || "");
    if (!bruta.startsWith(prefixoMesCorrente)) continue;
    const dia = Number(bruta.slice(8, 10));
    if (dia >= 1 && dia <= 31) diasComDadoCorrente.add(dia);
  }

  const janelaProducao = resolverJanela({
    competencia: compAtualDelta,
    modo: !base.closedSourceAtual && ehCorrenteDelta ? "ate-dia-N" : "mes-cheio",
    dia: agoraDelta.day,
    diasComDadoNoMesCorrente: diasComDadoCorrente,
  });
  function somaRecordsRecortado(comp: { year: number; month: number }, ateDia: number | null) {
    let total = 0;
    let linhas = 0;
    for (const record of base.records) {
      const pid = record.assigned_promoter_id || "";
      if (!universo.has(pid)) continue;
      if (!isEligibleProductionRecord(record)) continue;
      const p = extractYearMonth(record);
      if (!p || p.year !== comp.year || p.month !== comp.month) continue;
      linhas += 1;
      if (ateDia != null) {
        const bruta = record.movement_date || record.contract_date || record.proposal_date;
        const dia = Number(String(bruta ?? "").slice(8, 10));
        if (!(dia >= 1 && dia <= ateDia)) continue;
      }
      total += toNumber(record.net_value);
    }
    return { total: Math.round(total * 100) / 100, linhas };
  }

  let deltaProducao;
  if (janelaProducao.modo === "ate-dia-N") {
    const at = somaRecordsRecortado(compAtualDelta, janelaProducao.diaCorteAtual);
    const an = somaRecordsRecortado(
      base.competenciaAnteriorPmr,
      janelaProducao.diaCorteAnterior
    );
    if (at.linhas > 0 && an.linhas > 0) {
      deltaProducao = calcularDelta({
        competencia: compAtualDelta,
        valorAtual: at.total,
        valorAnterior: an.total,
        janela: janelaProducao,
        fonteAtual: "daily",
        fonteAnterior: "daily",
      });
    } else {
      // Sem daily nas duas pontas: cai para mês-cheio (PMR) e o card rotula.
      deltaProducao = calcularDelta({
        competencia: compAtualDelta,
        valorAtual: summary.production + (selectedPromoterId ? 0 : unassignedProduction),
        valorAnterior: houveM1 ? producaoAnterior : null,
        janela: resolverJanela({
          competencia: compAtualDelta,
          modo: "ate-dia-N",
          dia: agoraDelta.day,
          recorteIndisponivel: true,
        }),
        fonteAtual: "daily-vivo",
        fonteAnterior: base.previousClosedSource,
      });
    }
  } else {
    deltaProducao = calcularDelta({
      competencia: compAtualDelta,
      valorAtual: summary.production + (selectedPromoterId ? 0 : unassignedProduction),
      valorAnterior: houveM1 ? producaoAnterior : null,
      fonteAtual: base.closedSourceAtual ?? "daily-vivo",
      fonteAnterior: base.previousClosedSource,
    });
  }

  // ---- card COMISSÃO: sempre cheio-vs-cheio ----
  // O PMR não tem data por linha, então não há dia para cortar no M-1. Em mês
  // aberto o card rotula "mês cheio" em vez de fingir janela igual.
  const deltaComissao = calcularDelta({
    competencia: compAtualDelta,
    valorAtual: summary.finalCommission,
    valorAnterior: houveM1 ? comissaoAnterior : null,
    janela: resolverJanela({
      competencia: compAtualDelta,
      modo: !base.closedSourceAtual && ehCorrenteDelta ? "ate-dia-N" : "mes-cheio",
      dia: agoraDelta.day,
      recorteIndisponivel: !base.closedSourceAtual && ehCorrenteDelta,
    }),
    fonteAtual: base.closedSourceAtual ?? "motor-vivo",
    fonteAnterior: base.previousClosedSource,
  });

  return {
    periods,
    selectedPeriod: latestPeriod,
    selectedPromoterId,
    selectedCompanyId: companyId,
    // DELTA (Fase 3) — pronto, só para o <KpiBand delta=...> dos 2 cards de topo.
    deltaProducao,
    deltaComissao,
    summary: {
      promoters: summary.promoters,
      production: summary.production,
      // Master só entra no CONSOLIDADO do grupo; com um promotor selecionado o
      // KPI mostra os números dele, sem master (productionTotal = production).
      productionUnassigned: selectedPromoterId ? 0 : unassignedProduction,
      productionUnassignedCount: selectedPromoterId ? 0 : unassignedCount,
      productionTotal:
        summary.production + (selectedPromoterId ? 0 : unassignedProduction),
      finalCommission: summary.finalCommission,
      payableCommission: summary.payableCommission,
      discounts: summary.discounts,
      averageInsurancePenetration:
        summary.promoters > 0 ? summary.insurancePenetration / summary.promoters : 0,
      companyGrossCommission,
      unassignedCompanyGrossCommission,
      unassignedCount,
    },
    summaryRows: visibleSummaryRows,
    proposalRows,
    agreementRows,
    discountRows,
    promoterOptions: filteredSummaryRows.map((row) => ({
      id: row.promoter_id,
      name: row.promoter_name,
    })),
    promoterLookup: promoters.map((promoter) => ({
      id: promoter.id,
      name: promoter.name,
    })),
    companies,
  };
}

// Mantem assinatura/comportamento originais: base fetch-once + recorte de 1 promotor.
// Comportamento bit-a-bit identico ao codigo anterior (usado pelo export individual).
export async function buildPromoterAnalytics(
  supabase: SupabaseClient,
  filters?: {
    year?: number;
    month?: number;
    companyId?: string;
    promoterId?: string;
    closed?: boolean; // ver loadPromoterAnalyticsBase: aberto(false)=LIVE_BASE, fechado/indef=CALCULATED
    // VIRADA — fonte do mês fechado (consolida PMR por promotor). Ver loadPromoterAnalyticsBase.
    closedSource?: "cms" | "fechamento";
    // DELTA (Fase 3) — regime da competência ANTERIOR. Ver loadPromoterAnalyticsBase.
    previousClosedSource?: "cms" | "fechamento";
    // Aba Migração: quando o selecionado é is_master, proposalRows lista o balde
    // não atribuído (assigned_promoter_id NULL) p/ redistribuir. Default off =>
    // todos os demais chamadores ficam idênticos (match exato por promoter_id).
    masterUnassigned?: boolean;
    // Modo agregado da Migração: lista todo o balde não atribuído sem promotor
    // selecionado (link do Dashboard). Default off => demais chamadores intactos.
    allUnassigned?: boolean;
  }
): Promise<PromoterAnalyticsPayload> {
  const base = await loadPromoterAnalyticsBase(supabase, filters);
  return selectPromoterView(base, filters?.promoterId, {
    masterUnassigned: filters?.masterUnassigned,
    allUnassigned: filters?.allUnassigned,
  });
}

