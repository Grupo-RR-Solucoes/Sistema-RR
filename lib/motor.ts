import { resolvePromotivaCashPolicy } from "./promotivaCashPolicy.ts";

type Operation = {
  valor_liquido: number;
  valor_bruto: number;
  valor_seguro: number;
  taxa_juros: number;
  prazo: number;
  tem_seguro: boolean;
  product_code?: string | number | null;
  product_description?: string | null;
  convenio_code?: string | number | null;
  convenio_type?: string | null;
  convenio_segment?: string | number | null;
  company_cash_percent?: number | null;
  production_value?: number | null;
  insurance_type?: string | null;
  reference_date?: string | null;
  movement_date?: string | null;
  contract_date?: string | null;
  proposal_date?: string | null;
};

type BandKey =
  | "FAIXA_1"
  | "FAIXA_2"
  | "FAIXA_3"
  | "FAIXA_4"
  | "FAIXA_5";

type CreditRule = {
  minRate?: number;
  maxRate?: number | null;
  exactRate?: number;
  minTerm?: number;
  maxTerm?: number | null;
  generalRate?: number;
  bandRates?: [number, number, number, number, number];
};

const BAND_THRESHOLDS: Array<{ key: BandKey; minValue: number }> = [
  { key: "FAIXA_5", minValue: 20_000_000 },
  { key: "FAIXA_4", minValue: 7_000_000 },
  { key: "FAIXA_3", minValue: 3_000_000 },
  { key: "FAIXA_2", minValue: 1_000_000 },
  { key: "FAIXA_1", minValue: 0 },
];

const BAND_INDEX: Record<BandKey, number> = {
  FAIXA_1: 0,
  FAIXA_2: 1,
  FAIXA_3: 2,
  FAIXA_4: 3,
  FAIXA_5: 4,
};

const SP_MG_CONVENIOS = new Set(
  [
    "214598",
    "215298",
    "215305",
    "215406",
    "215407",
    "215408",
    "215409",
    "215410",
    "215411",
    "215412",
    "215413",
    "215416",
    "215417",
    "215418",
    "215420",
    "215421",
    "215423",
    "215427",
    "215430",
    "215431",
    "215432",
    "215434",
    "215439",
    "215440",
    "215441",
    "215444",
    "215447",
    "215448",
    "215452",
    "215460",
    "215465",
    "215675",
    "215725",
    "215726",
    "215727",
    "215974",
    "218603",
    "218622",
    "218624",
    "218625",
    "218878",
    "218947",
    "218949",
    "218958",
    "218982",
    "293022",
    "315753",
    "329278",
    "329481",
    "352410",
    "352411",
    "108643",
    "1976",
    "124676",
    "137706",
    "138920",
    "187087",
    "190503",
    "197377",
    "215415",
    "215424",
    "351979",
    "2308",
    "20085",
    "118151",
    "314075",
    "314076",
    "314077",
    "314078",
    "314079",
    "332305",
    "332444",
    "12242",
    "295785",
    "314080",
    "409692",
  ].map(String)
);

const CREDIT_RULES: Record<string, CreditRule[]> = {
  INSS_NOVO: [
    {
      exactRate: 1.85,
      minTerm: 48,
      maxTerm: 60,
      bandRates: [1.96, 1.97, 2.03, 2.12, 2.15],
    },
    {
      exactRate: 1.85,
      minTerm: 61,
      maxTerm: 84,
      bandRates: [2.35, 2.37, 2.44, 2.55, 2.58],
    },
    {
      exactRate: 1.85,
      minTerm: 85,
      maxTerm: null,
      bandRates: [3.21, 3.23, 3.34, 3.48, 3.52],
    },
  ],
  INSS_RENOVACAO: [
    {
      minRate: 1.0,
      maxRate: null,
      minTerm: 48,
      maxTerm: 60,
      bandRates: [1.96, 1.97, 2.03, 2.12, 2.15],
    },
    {
      minRate: 1.0,
      maxRate: null,
      minTerm: 61,
      maxTerm: 84,
      bandRates: [2.35, 2.37, 2.44, 2.55, 2.58],
    },
    {
      minRate: 1.0,
      maxRate: null,
      minTerm: 85,
      maxTerm: null,
      bandRates: [3.21, 3.23, 3.34, 3.48, 3.52],
    },
  ],
  PUBLICO_GERAL: [
    { minRate: 1.75, maxRate: 1.77, minTerm: 36, maxTerm: null, bandRates: [0.78, 0.79, 0.81, 0.85, 0.86] },
    { minRate: 1.78, maxRate: 1.87, minTerm: 36, maxTerm: null, bandRates: [2.35, 2.37, 2.44, 2.55, 2.58] },
    { minRate: 1.88, maxRate: 1.97, minTerm: 36, maxTerm: null, bandRates: [3.53, 3.55, 3.66, 3.82, 3.87] },
    { minRate: 1.98, maxRate: 2.07, minTerm: 36, maxTerm: null, bandRates: [4.31, 4.34, 4.48, 4.67, 4.73] },
    { minRate: 2.08, maxRate: 2.17, minTerm: 36, maxTerm: null, bandRates: [4.71, 4.74, 4.89, 5.1, 5.16] },
    { minRate: 2.18, maxRate: 2.27, minTerm: 36, maxTerm: null, bandRates: [5.88, 5.92, 6.11, 6.37, 6.45] },
    { minRate: 2.28, maxRate: 2.37, minTerm: 36, maxTerm: null, bandRates: [6.67, 6.71, 6.92, 7.22, 7.31] },
    { minRate: 2.38, maxRate: 2.47, minTerm: 36, maxTerm: null, bandRates: [7.85, 7.9, 8.15, 8.5, 8.6] },
    { minRate: 2.48, maxRate: null, minTerm: 36, maxTerm: null, bandRates: [9.02, 9.08, 9.37, 9.77, 9.89] },
  ],
  SIAPE: [
    { minRate: 1.64, maxRate: 1.67, minTerm: 48, maxTerm: null, bandRates: [0.94, 0.95, 0.97, 1.02, 1.03] },
    { minRate: 1.68, maxRate: 1.79, minTerm: 48, maxTerm: null, bandRates: [2.35, 2.37, 2.44, 2.55, 2.58] },
    { exactRate: 1.8, minTerm: 48, maxTerm: null, bandRates: [3.21, 3.23, 3.34, 3.48, 3.52] },
  ],
  SP_MG: [
    { minRate: 1.72, maxRate: 1.79, minTerm: 36, maxTerm: null, bandRates: [1.25, 1.26, 1.3, 1.36, 1.37] },
    { minRate: 1.8, maxRate: 1.89, minTerm: 36, maxTerm: null, bandRates: [2.43, 2.44, 2.52, 2.63, 2.66] },
    { minRate: 1.9, maxRate: 1.99, minTerm: 36, maxTerm: null, bandRates: [3.53, 3.55, 3.66, 3.82, 3.87] },
    { minRate: 2.0, maxRate: 2.09, minTerm: 36, maxTerm: null, bandRates: [4.31, 4.34, 4.48, 4.67, 4.73] },
    { minRate: 2.1, maxRate: 2.19, minTerm: 36, maxTerm: null, bandRates: [5.1, 5.13, 5.29, 5.52, 5.59] },
    { minRate: 2.2, maxRate: 2.29, minTerm: 36, maxTerm: null, bandRates: [5.88, 5.92, 6.11, 6.37, 6.45] },
    { minRate: 2.3, maxRate: 2.39, minTerm: 36, maxTerm: null, bandRates: [6.67, 6.71, 6.92, 7.22, 7.31] },
    { minRate: 2.4, maxRate: 2.49, minTerm: 36, maxTerm: null, bandRates: [7.85, 7.9, 8.15, 8.5, 8.6] },
    { minRate: 2.5, maxRate: null, minTerm: 36, maxTerm: null, bandRates: [9.02, 9.08, 9.37, 9.77, 9.89] },
  ],
  PRIVADO: [
    { minRate: 2.54, maxRate: null, minTerm: 18, maxTerm: 35, bandRates: [0.78, 0.79, 0.81, 0.85, 0.86] },
    { minRate: 2.54, maxRate: 2.99, minTerm: 36, maxTerm: null, bandRates: [2.35, 2.37, 2.44, 2.55, 2.58] },
    { minRate: 3.0, maxRate: 3.5, minTerm: 36, maxTerm: null, bandRates: [3.14, 3.16, 3.26, 3.4, 3.44] },
    { minRate: 3.51, maxRate: null, minTerm: 36, maxTerm: null, bandRates: [3.92, 3.95, 4.07, 4.25, 4.3] },
  ],
  PORTABILIDADE_PUBLICO: [
    { minRate: 1.73, maxRate: 1.89, minTerm: 48, maxTerm: null, generalRate: 0.72 },
    { minRate: 1.9, maxRate: null, minTerm: 48, maxTerm: null, generalRate: 2.25 },
  ],
  PORTABILIDADE_PRIVADO: [
    { minRate: 2.54, maxRate: 2.99, minTerm: 36, maxTerm: null, generalRate: 0.45 },
    { minRate: 3.0, maxRate: null, minTerm: 36, maxTerm: null, generalRate: 1.8 },
  ],
  AUTOMATICO_SALARIO_BENEFICIO: [
    { minRate: 2.92, maxRate: 3.37, minTerm: 13, maxTerm: null, bandRates: [1.96, 1.97, 2.03, 2.12, 2.15] },
    { minRate: 3.38, maxRate: 3.83, minTerm: 13, maxTerm: null, bandRates: [2.74, 2.76, 2.85, 2.97, 3.01] },
    { minRate: 3.84, maxRate: 4.29, minTerm: 13, maxTerm: null, bandRates: [3.53, 3.55, 3.66, 3.82, 3.87] },
    { minRate: 4.3, maxRate: 4.75, minTerm: 13, maxTerm: null, bandRates: [4.31, 4.34, 4.48, 4.67, 4.73] },
    { minRate: 4.76, maxRate: 5.38, minTerm: 13, maxTerm: null, bandRates: [5.49, 5.53, 5.7, 5.95, 6.02] },
    { minRate: 5.39, maxRate: null, minTerm: 13, maxTerm: null, bandRates: [8.24, 8.29, 8.55, 8.92, 9.03] },
  ],
  ADIANTAMENTO_13: [
    { minRate: 3.25, maxRate: null, minTerm: 5, maxTerm: null, bandRates: [2.35, 2.37, 2.44, 2.55, 2.58] },
  ],
  FGTS: [
    { exactRate: 1.79, minTerm: 36, maxTerm: 84, generalRate: 4.2 },
  ],
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePercent(value: unknown) {
  const parsed = toNumber(value);
  if (parsed <= 0) return 0;
  return parsed > 1 ? parsed / 100 : parsed;
}

function getProductionBandByValue(value: number): BandKey {
  const productionValue = toNumber(value);
  return (
    BAND_THRESHOLDS.find((band) => productionValue >= band.minValue)?.key ||
    "FAIXA_1"
  );
}

function getInsurancePercentByTerm(prazo: number, insuranceType: string) {
  if (insuranceType.includes("ESTOQUE")) return 0.0015;
  if (prazo >= 85) return 0.0055;
  if (prazo >= 61) return 0.004;
  if (prazo >= 37) return 0.0025;
  return 0.0015;
}

function getComissaoPromotorSeguro(penetracao: number): number {
  if (penetracao >= 0.6) return 0.4;
  if (penetracao >= 0.4) return 0.3;
  if (penetracao >= 0.2) return 0.2;
  return 0.1;
}

function getBandPercent(rule: CreditRule, band: BandKey) {
  if (rule.generalRate !== undefined) {
    return rule.generalRate / 100;
  }

  if (!rule.bandRates) {
    return 0;
  }

  return rule.bandRates[BAND_INDEX[band]] / 100;
}

function matchesRate(rule: CreditRule, rate: number) {
  if (rule.exactRate !== undefined) {
    return Math.abs(rate - rule.exactRate) <= 0.005;
  }

  if (rule.minRate !== undefined && rate + 1e-9 < rule.minRate) {
    return false;
  }

  if (rule.maxRate !== null && rule.maxRate !== undefined && rate - 1e-9 > rule.maxRate) {
    return false;
  }

  return true;
}

function matchesTerm(rule: CreditRule, term: number) {
  if (rule.minTerm !== undefined && term < rule.minTerm) {
    return false;
  }

  if (rule.maxTerm !== null && rule.maxTerm !== undefined && term > rule.maxTerm) {
    return false;
  }

  return true;
}

function normalizeProductCode(value: unknown) {
  const numeric = Math.trunc(toNumber(value));
  return numeric > 0 ? String(numeric) : "";
}

function normalizeConvenioCode(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const numeric = Math.trunc(Number(text));
  return Number.isFinite(numeric) && numeric >= 0 ? String(numeric) : text;
}

function isPrivateConvenio(op: Operation) {
  const typeText = normalizeText(op.convenio_type);
  const segmentText = normalizeText(op.convenio_segment);
  return (
    typeText.includes("PRIVADO") ||
    segmentText === "2" ||
    segmentText.includes("PRIVADO")
  );
}

function inferCreditTable(op: Operation) {
  const productCode = normalizeProductCode(op.product_code);
  const description = normalizeText(op.product_description);
  const convenioCode = normalizeConvenioCode(op.convenio_code);
  const privateConvenio = isPrivateConvenio(op);
  const isRenewal =
    ["2881", "2891", "2890", "2996"].includes(productCode) ||
    description.includes("RENOVA") ||
    description.includes("REFIN");

  if (productCode === "2096" || productCode === "2097" || description.includes("FGTS")) {
    return "FGTS";
  }

  if (productCode === "3100" || productCode === "3101" || description.includes("13")) {
    return "ADIANTAMENTO_13";
  }

  if (
    ["2991", "2992", "2996", "2997", "2889", "2890"].includes(productCode) ||
    description.includes("CREDITO SALARIO") ||
    description.includes("CREDITO BENEFICIO") ||
    description.includes("CREDITO AUTOMATIC")
  ) {
    return "AUTOMATICO_SALARIO_BENEFICIO";
  }

  if (productCode === "2787" || productCode === "2887" || description.includes("PORTABILIDADE")) {
    return privateConvenio ? "PORTABILIDADE_PRIVADO" : "PORTABILIDADE_PUBLICO";
  }

  if (convenioCode === "1640" || description.includes("INSS")) {
    return isRenewal ? "INSS_RENOVACAO" : "INSS_NOVO";
  }

  if (convenioCode === "1078" || description.includes("SIAPE") || description.includes("MPDG")) {
    return "SIAPE";
  }

  if (SP_MG_CONVENIOS.has(convenioCode)) {
    return "SP_MG";
  }

  return privateConvenio ? "PRIVADO" : "PUBLICO_GERAL";
}

function getMinimumTicket(tableKey: string) {
  if (tableKey === "FGTS") return 1000;
  if (tableKey === "PORTABILIDADE_PUBLICO" || tableKey === "PORTABILIDADE_PRIVADO") {
    return 2500;
  }
  if (tableKey === "PRIVADO") {
    return 2000;
  }
  return 100;
}

function getCreditPercent(op: Operation, band: BandKey) {
  const tableKey = inferCreditTable(op);
  const ticket = toNumber(op.valor_liquido);
  const rate = toNumber(op.taxa_juros);
  const term = Math.trunc(toNumber(op.prazo));
  const rules = CREDIT_RULES[tableKey] || [];

  if (ticket < getMinimumTicket(tableKey) || rate <= 0 || term <= 0) {
    return {
      tableKey,
      percent: 0,
    };
  }

  const matchedRule = rules.find(
    (rule) => matchesRate(rule, rate) && matchesTerm(rule, term)
  );

  return {
    tableKey,
    percent: matchedRule ? getBandPercent(matchedRule, band) : 0,
  };
}

export function calcularOperacao(op: Operation) {
  const productionBand = getProductionBandByValue(op.production_value || 0);
  const creditPercentInfo = getCreditPercent(op, productionBand);
  const totalCreditPercent = creditPercentInfo.percent;
  const cashPolicy = resolvePromotivaCashPolicy({
    companyCashPercent: op.company_cash_percent,
    productionValue: op.production_value,
    reference_date: op.reference_date,
    movement_date: op.movement_date,
    contract_date: op.contract_date,
    proposal_date: op.proposal_date,
  });
  const cashCapPercent = cashPolicy.percent;
  const comissaoTotalCredito = op.valor_liquido * totalCreditPercent;
  const avistaEmpresa = Math.min(comissaoTotalCredito, op.valor_liquido * cashCapPercent);
  const avistaPromotor = Math.min(comissaoTotalCredito, op.valor_liquido * 0.058);
  const diferido = Math.max(comissaoTotalCredito - avistaEmpresa, 0);
  const spreadEmpresa = Math.max(avistaEmpresa - avistaPromotor, 0);

  const insuranceType = normalizeText(op.insurance_type);
  let comissaoSeguroEmpresa = 0;

  if (op.tem_seguro) {
    const percSeguro = getInsurancePercentByTerm(op.prazo, insuranceType);
    comissaoSeguroEmpresa = op.valor_bruto * percSeguro;
  }

  const penetracao = op.valor_seguro > 0 && op.valor_bruto > 0
    ? op.valor_seguro / op.valor_bruto
    : 0;

  let comissaoSeguroPromotor = 0;

  if (op.tem_seguro) {
    const percPromotor = getComissaoPromotorSeguro(penetracao);
    comissaoSeguroPromotor = comissaoSeguroEmpresa * percPromotor;
  }

  const parcelas = op.prazo > 0 ? op.prazo : 0;
  const valorParcela = parcelas > 0 ? diferido / parcelas : 0;

  return {
    credito: {
      regra: creditPercentInfo.tableKey,
      faixa_producao: productionBand,
      percentual: totalCreditPercent,
      percentual_avista_empresa: cashCapPercent,
      total: comissaoTotalCredito,
      avista_empresa: avistaEmpresa,
      avista_promotor: avistaPromotor,
      diferido,
      spreadEmpresa,
    },
    seguro: {
      empresa: comissaoSeguroEmpresa,
      promotor: comissaoSeguroPromotor,
      penetracao,
    },
    diferido: {
      total: diferido,
      parcelas,
      valorParcela,
    },
    total_geral: {
      empresa: avistaEmpresa + spreadEmpresa + comissaoSeguroEmpresa,
      promotor: avistaPromotor + comissaoSeguroPromotor,
    },
  };
}

export { getProductionBandByValue };
