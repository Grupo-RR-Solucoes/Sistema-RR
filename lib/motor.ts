import { resolvePromotivaCashPolicy } from "./promotivaCashPolicy.ts";
// LACUNA DE GLIFO do PDF da BBTS: os matchers de product_description passam a
// tolerar o glifo que o PDF engole. Ver lib/bbts/normalizarTextoPdf.ts.
import { casaExpressao, contemTermo } from "./bbts/normalizarTextoPdf.ts";
import type { RegraMes } from "./regrasData.ts";
import {
  categoriasCandidatasFor,
  getRegime,
  getRegra,
  lookupPctInRegra,
} from "./regrasLoader.ts";
import {
  getProductionPeriodFromValue,
  getProductionPeriodKey,
} from "./productionPeriod.ts";

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

/**
 * Provider SINCRONO da RegraMes por competencia (YYYY-MM). Injetado pelo chamador
 * que ja fez o preload async 1x (createTrpRegraDbPreloader.getRegraSync). Retorna
 * null quando a competencia nao tem versao no DB (ex.: pre-abril/2026) -> o motor
 * cai no JSON embutido (getRegra). Espelha o padrao da a-vista F4 (avistaProducao):
 * pre-carga async fora do motor, lookup sincrono aqui dentro.
 */
export type TrpRegraProvider = (
  competencia: string,
  /**
   * VIGENCIA INTRA-MES (31/08/2026): data do contrato ("YYYY-MM-DD"), usada para
   * escolher a FATIA quando a competencia tem 2+ reguas ativas (ex.: agosto/2026,
   * TRP38 ate 04/08 e TRP39 de 05/08). OPCIONAL de proposito: um provider de 1
   * parametro (todos os anteriores) continua atribuivel a este tipo, entao os 6
   * sitios de calcularOperacao seguem valendo SEM alteracao.
   */
  contractDate?: string,
) => RegraMes | null;

/**
 * Opcoes opcionais de calcularOperacao. Sem opts (ou sem trpProvider) o
 * comportamento e IDENTICO ao historico — le so o JSON embutido. 100% retrocompativel.
 */
export type CalcularOperacaoOpts = {
  trpProvider?: TrpRegraProvider;
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
  // CORRECAO-1: detecta privado tambem pela DESCRICAO ("CONSIGNADO PRIVADO"). No
  // fechamento BB os campos convenio_type/segment nao vem, entao sem isto o
  // privado caia em PUBLICO_GERAL (9,37%) em vez da tabela PRIVADO (TRP 1.7).
  const descriptionText = normalizeText(op.product_description);
  return (
    typeText.includes("PRIVADO") ||
    segmentText === "2" ||
    segmentText.includes("PRIVADO") ||
    descriptionText.includes("PRIVADO")
  );
}

export function inferCreditTable(op: Operation) {
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
    contemTermo(description, "CREDITO SALARIO") ||
    contemTermo(description, "CREDITO BENEFICIO") ||
    contemTermo(description, "CREDITO AUTOMATIC") ||
    // CORRECAO-2: familia "CDC Novo" (Automatico/Salario/Beneficio) e NAO_CONSIGNADO
    // pela DESCRICAO, mesmo com convenio_segment=PRIVADO (2 dos 6 casos ADS). O
    // fechamento ADS traz product_code NULL e nao "CREDITO AUTOMATIC", entao os
    // matchers acima nao pegavam e o contrato caia em PRIVADO/PUBLICO_GERAL (:412).
    // Mesmo principio da CORRECAO-1 (privado por descricao): a DESCRICAO manda, nao
    // o segmento. Matcher ESTREITO — exige o token \bCDC\b — nao colide com nada:
    //   - dispara ANTES do fallback PRIVADO (:412), reroteando os 2 de conv. PRIVADO;
    //   - o check de "13" (:383) dispara ANTES deste, entao "13o salario" (NAO
    //     consignado, mas 13) vai para ADIANTAMENTO_13 e NUNCA cai aqui;
    //   - "CONSIGNADO PRIVADO" (populacao da CORRECAO-1) nao tem \bCDC\b -> intacto.
    // Blast radius medido = 6 registros no banco (os unicos com \bCDC\b + familia).
    // LACUNA DE GLIFO (03/08/2026): estes testes passaram a ser TOLERANTES.
    // O PDF da BBTS engole a ligadura e entrega "CDC Novo Automa<U+FFFD>co" —
    // /AUTOMATIC/ nao casava e os 5 contratos com "Automatico"/"Beneficio"
    // caiam no fallback :427, que decide por segmento. Ver
    // lib/bbts/normalizarTextoPdf.ts. casaExpressao expande a lacuna sobre o
    // conjunto fechado de ligaduras; sem lacuna, e o mesmo test() de antes.
    (casaExpressao(description, /\bCDC\b/) &&
      (casaExpressao(description, /AUTOMATIC/) ||
        casaExpressao(description, /\bSALARIO\b/) ||
        casaExpressao(description, /\bBENEFICIO\b/))) ||
    // FASE C (04/08/2026): "Nao Consignado" pelo NOME DO CONVENIO da BBTS.
    //
    // A ORDEM NAO E PREFERENCIA, E A PARTICAO DA PROPRIA TABELA. O PDF da regua
    // tem EXATAMENTE tres secoes "Nao Consignado -" (parseBbtsPdf.ts:109-111):
    //   "Automatico, Salario e Beneficio" -> NAO_CONSIGNADO
    //   "13o Salario"                     -> NAO_CONSIGNADO_13
    //   "CDC FGTS"                        -> CDC_FGTS
    // Duas delas ja foram decididas ACIMA: FGTS em :382 e o 13 em :386. Entao
    // aqui "Nao Consignado" e o RESIDUAL, e o residual e exatamente a primeira
    // secao. Nao ha terceira leitura possivel.
    //
    // POR ISSO ESTE MATCHER NAO PODE SUBIR. Antes de :386 ele roubaria o 13o:
    // medido no fechamento de julho/2026, os 4 contratos 220187043, 220187219,
    // 220722555 e 221118266 chegam como "Nao Consignado - 13o salario
    // Correntista" e so continuam em ADIANTAMENTO_13 porque o check de "13"
    // dispara primeiro.
    //
    // ANCORA EM "NAO CONSIGNADO", NUNCA EM "AUTOMATICO". A celula chega como
    // "Nao Consignado - Novo Automa<lacuna>Salario e Beneficio": o fragmento
    // "co," fica FORA da banda de x por 0,1 ponto (divida aceita, ver
    // bbtsPdfExtract). Aquela lacuna e FRAGMENTO PERDIDO, nao glifo de ligadura
    // — expandir sobre LIGADURAS nao a recupera, entao /AUTOMATIC/ nunca casa.
    // "\bCDC\b" tambem nao alcanca: o CDC mora na "Linha do Produto", nao no
    // "Nome do Convenio" que vira product_description (bbtsClosingImport:431).
    // "Nao Consignado" e a unica parte que chega INTEIRA, e chega no comeco.
    //
    // contemTermo e nao includes: hoje includes bastaria (a lacuna cai fora da
    // frase), mas a garantia nao pode depender de ONDE a lacuna cai.
    //
    // BLAST RADIUS MEDIDO: censo de inferCreditTable sobre TODAS as descricoes
    // distintas do banco (11 do RR, 6 da ADS, 232 tuplas desc x codigo x
    // convenio x segmento) = ZERO mudancas. Sobre o PDF de julho ja com as
    // Fases A+B = 7 contratos, os da secao Automatico/Salario/Beneficio.
    // "CONSIGNADO NAO CORRENTISTA" do RR nao casa: a ordem das palavras e outra.
    contemTermo(description, "NAO CONSIGNADO")
  ) {
    return "AUTOMATICO_SALARIO_BENEFICIO";
  }

  if (
    productCode === "2787" ||
    productCode === "2887" ||
    // "PORTABILIDADE" contem "ti": mesma exposicao a lacuna dos matchers acima.
    contemTermo(description, "PORTABILIDADE")
  ) {
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

// Tiquete minimo por tableKey. NAO e mais a FONTE do gate — a fonte e a regua
// versionada (tiqueteMinFromRegra le regra_json.<categoria>.tiquete_min). Este
// hardcode virou a REDE (fallback) pra competencia SEM o campo: a TRP38/julho
// nasceu do parser self-service, que extrai so a matriz de pct e descarta os
// escalares (tiquete_min, prazo_min, tx_juros). O dia que o parser passar a
// extrair tiquete_min (ou a Promotiva preencher), o motor passa a respeita-lo
// sozinho — sem tocar aqui. Os valores abaixo reproduzem a regua VIGENTE (2025-07+,
// TRP24 em diante): 11/11 categorias batem em abr/mai/jun. Historicamente ja
// divergiram (CONSIG_PRIVADO era 100 de TRP10 a TRP17; PORTAB_INSS=1000 era
// categoria separada) — por isso a regua, e nao este mapa, e a verdade.
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

// ===========================================================================
// NOVO — fonte da matriz de crédito: TRP versionada por competência.
//
// Substitui CREDIT_RULES (hardcoded) por lookupPctInRegra (regrasLoader) quando o
// regime da competência é VOLUME_5_FAIXAS. Comportamento-idêntico provado por
// scripts/frente2_paridade_cirurgico.cjs (paridade 0 em abr+jun/2026; 4290
// comparações × 5 faixas). CREDIT_RULES é MANTIDO como fallback (regimes !=
// VOLUME_5 e drift inesperado). NÃO re-roteia: tableKey vem de inferCreditTable.
// ===========================================================================

/** Mapa 1:1 validado: tableKey (inferCreditTable) -> categoria do JSON da TRP.
 *  Ausente = mesmo nome (INSS_NOVO 1.2, SIAPE 1.5, ADIANTAMENTO_13 3.3, FGTS 3.4). */
const MAP_TABLEKEY_TO_CATEGORIA: Record<string, string> = {
  PUBLICO_GERAL: "CONSIG_PUBLICO",                 // TRP 1.4
  SP_MG: "CONSIG_SP_MG",                           // TRP 1.6
  PRIVADO: "CONSIG_PRIVADO",                       // TRP 1.7
  PORTABILIDADE_PUBLICO: "PORTAB_PUBLICO",         // TRP 2.2
  PORTABILIDADE_PRIVADO: "PORTAB_PRIVADO",         // TRP 2.3
  AUTOMATICO_SALARIO_BENEFICIO: "NAO_CONSIGNADO",  // TRP 3.2
  INSS_RENOVACAO: "INSS_RENOV",                    // TRP 1.3
};

/**
 * Tiquete minimo (piso do valor_liquido) que a REGUA versionada manda aplicar,
 * por categoria. FONTE = a regua (regra_json.<categoria>.tiquete_min) — o MESMO
 * objeto que ja alimenta o pct e o tx_juros_min (o motor le regra[categoria] em
 * varios pontos; ex.: gate B do ADIANTAMENTO_13). Helper PROPRIO — NAO polui o
 * lookupPctInRegra nem o candidate-list: e leitura de um escalar de metadado, um
 * gate INDEPENDENTE do lookup de pct.
 *
 * REDE (fallback) = getMinimumTicket(tableKey), o hardcode. Ele nao e a fonte, e a
 * rede pra competencia SEM o campo: a TRP38/julho nasceu do parser self-service e
 * nao traz escalares. Sem a rede, julho cairia PRIVADO 2000->100, PORTAB 2500->100,
 * FGTS 1000->100 (deixaria passar contrato que hoje zera).
 *
 * Chaveia no tableKey PRIMARIO (inferCreditTable) via MAP_TABLEKEY_TO_CATEGORIA — o
 * MESMO mapa do lookup, sem duplicar — reproduzindo a semantica atual do gate: o
 * minimo e o da categoria PRIMARIA, NAO o da categoria que o candidate-list (#118)
 * eventualmente resolve pro pct. Sao gates independentes; nao misturar.
 */
export function tiqueteMinFromRegra(
  regra: RegraMes | null | undefined,
  tableKey: string,
): number {
  const categoria = MAP_TABLEKEY_TO_CATEGORIA[tableKey] ?? tableKey;
  const cat = (
    regra as Record<string, { tiquete_min?: number } | undefined> | null | undefined
  )?.[categoria];
  return cat?.tiquete_min ?? getMinimumTicket(tableKey);
}

/** Categorias do JSON sem variação por faixa (só "pct_geral"). */
const CATEGORIAS_PCT_GERAL = new Set(["PORTAB_PUBLICO", "PORTAB_PRIVADO", "FGTS"]);

/** Mesma tolerância de range do regrasLoader (EPS), p/ o gate B. */
const LOOKUP_EPS = 1e-7;

/** Competência (YYYY-MM) de uma data de contrato por VIGÊNCIA (holiday-aware),
 *  reusando a função canônica de lib/productionPeriod.ts — NÃO reimplementada aqui.
 *  Exportada para o chamador PRE-CARREGAR exatamente as competências que o motor
 *  vai consultar no provider (mesma chave do lookup -> sem miss no getRegraSync). */
export function competenciaDaDataContrato(
  contractDate: string | null | undefined,
): string | null {
  const periodo = getProductionPeriodFromValue(contractDate ?? null);
  return periodo ? getProductionPeriodKey(periodo.year, periodo.month) : null;
}

/** Competência (YYYY-MM) do contrato por VIGÊNCIA (holiday-aware). */
function competenciaDoContrato(op: Operation): string | null {
  return competenciaDaDataContrato(op.contract_date);
}

/** Lookup do pct CRU na TRP da competência (caminho VOLUME_5). Replica EXATAMENTE
 *  o getCreditPercentNovo do harness frente2_paridade_cirurgico.cjs (paridade 0).
 *  percent=null => regra do mês ausente ou lookup sem match (caller faz fallback). */
function lookupCreditPercentTrp(
  band: BandKey,
  mes: string,
  tableKey: string,
  rate: number,
  term: number,
  op: Operation,
  trpProvider?: TrpRegraProvider
): { percent: number | null; motivo?: string } {
  const categoria = MAP_TABLEKEY_TO_CATEGORIA[tableKey] || tableKey;
  const faixaLabel = `Faixa ${BAND_INDEX[band] + 1}`;
  const tabLabel = CATEGORIAS_PCT_GERAL.has(categoria)
    ? "pct_geral"
    : faixaLabel;
  const taxaDec = rate > 1 ? rate / 100 : rate;

  // FONTE da RegraMes: DB (trp_rule_versions) quando o chamador injeta o provider
  // E a competencia tem versao (2026-04+); senao JSON embutido (getRegra), que
  // cobre o historico pre-abril. Sem provider -> so JSON (100% retrocompativel).
  const fromDb = trpProvider ? trpProvider(mes, op.contract_date ?? undefined) : null;
  const r = fromDb
    ? { regra: fromDb, jsonRegra: "db:trp_rule_versions", regraInferida: false }
    : getRegra(mes);
  if (!r) return { percent: null, motivo: `getRegra(${mes})=null` };

  // GATE B — ADIANTAMENTO_13: força FORA_DA_TABELA (pct 0) quando taxa < tx_juros_min,
  // lendo cat.tx_juros_min DO DADO (regra do mês — não hardcoded).
  // NOTA (Fase 4.4): o antigo skipTxJurosMin foi REMOVIDO — o lookupPctInRegra hoje
  // aplica tx_juros_min a TODAS as categorias (regrasLoader "Bug #6"). Logo este gate
  // B virou CINTO redundante sobre o suspensório do loader (mantido de propósito;
  // ambos usam a MESMA guarda `typeof tx_juros_min === "number"`, então ambos são
  // no-op quando o campo está ausente). O tx_juros_min de categoria agora é DERIVADO
  // pelo parser self-service (buildTrpDraft.derivarTxJurosMin), não mais só curado.
  if (categoria === "ADIANTAMENTO_13") {
    const cat = (r.regra as Record<string, { tx_juros_min?: number } | undefined>)[categoria];
    const txMin = cat && typeof cat.tx_juros_min === "number" ? cat.tx_juros_min : null;
    if (txMin != null && taxaDec < txMin - LOOKUP_EPS) {
      return { percent: 0, motivo: "ADIANTAMENTO_13 FORA_DA_TABELA (gate B)" };
    }
  }

  const out = lookupPctInRegra(
    r.regra, categoria, taxaDec, term, tabLabel, r.jsonRegra, r.regraInferida
  );
  if (out.pct !== null) {
    return { percent: out.pct, motivo: out.celula ?? undefined };
  }

  // CANDIDATE-LIST DE CATEGORIA (convergencia deliberada com o previsto).
  // O previsto (getMatrizTRPParaContrato) ja fazia isso: itera a lista ORDENADA
  // de categoriasCandidatasFor e tenta a proxima quando uma rejeita. O motor
  // commitava numa UNICA categoria (inferCreditTable) e desistia -> zerava
  // contratos que a Promotiva PAGA. Caso real (fechamento abril/2026): produto
  // "CONSIGNADO" prazo 20-27 cai em CONSIG_PUBLICO, que rejeita (prazo_min 36);
  // a celula REAL esta na irma CONSIG_PRIVADO (tx_min 0.0254, prazo 18-35,
  // Faixa 3 = 0,0081) — o realizado confirma: "% TABELA OPP = 0,0081" no
  // metadata do fechamento e exatamente essa celula. lookupPctInRegra esta
  // CERTO (rejeitar a categoria errada e o comportamento correto); o bug era
  // nao tentar a irma. REUSA categoriasCandidatasFor (regrasLoader) — a MESMA
  // funcao do previsto, nao uma 3a implementacao da lista. Convergencia: as 2
  // implementacoes agora resolvem categoria do MESMO jeito. So roda quando a
  // primaria deu null (quem ja resolvia nao muda de valor).
  const produto = op.product_description ?? null;
  // tipo derivado da descricao, mesmo criterio do previsto (extrairContratoAvista).
  const tipo = produto && /RENOV/i.test(produto) ? "RENOVACAO" : "NOVO";
  const candidatos = categoriasCandidatasFor(
    mes, produto, tipo, op.convenio_code ?? null
  );
  for (const cand of candidatos) {
    if (cand === categoria) continue; // primaria ja tentada acima
    const tabCand = CATEGORIAS_PCT_GERAL.has(cand) ? "pct_geral" : faixaLabel;
    const alt = lookupPctInRegra(
      r.regra, cand, taxaDec, term, tabCand, r.jsonRegra, r.regraInferida
    );
    if (alt.pct !== null) {
      return { percent: alt.pct, motivo: alt.celula ?? undefined };
    }
  }

  return { percent: null, motivo: out.celula ?? undefined };
}

function getCreditPercent(op: Operation, band: BandKey, trpProvider?: TrpRegraProvider) {
  const tableKey = inferCreditTable(op);
  const ticket = toNumber(op.valor_liquido);
  const rate = toNumber(op.taxa_juros);
  const term = Math.trunc(toNumber(op.prazo));

  // Competência + regra resolvidas ANTES do gate: o tiquete mínimo agora NASCE da
  // régua versionada (tiqueteMinFromRegra), não do hardcode. Mesma FONTE do pct —
  // DB (trpProvider) quando há versão, senão JSON embutido (getRegra) — espelhando
  // a resolução do lookupCreditPercentTrp (:492-495). Resolver a régua é
  // side-effect-free (provider = lookup síncrono em cache; getRegra = lookup no
  // mapa), então movê-la pra cima NÃO altera o resultado das outras guardas.
  const mes = competenciaDoContrato(op);
  const regraGate: RegraMes | null =
    (mes && trpProvider ? trpProvider(mes, op.contract_date ?? undefined) : null) ??
    (mes ? getRegra(mes)?.regra ?? null : null);

  // Gates preservados na MESMA ORDEM (tiquete, depois rate, depois term). Só a
  // FONTE do tiquete mínimo mudou (régua -> hardcode como rede): um contrato com
  // rate<=0 ou term<=0 continua zerando exatamente como antes. O gate do tiquete
  // chaveia no tableKey PRIMÁRIO (inferCreditTable), NÃO na categoria que o
  // candidate-list (#118) resolve pro pct — são gates independentes.
  if (ticket < tiqueteMinFromRegra(regraGate, tableKey) || rate <= 0 || term <= 0) {
    return {
      tableKey,
      percent: 0,
    };
  }

  // NOVO — fonte da matriz = TRP por competência quando regime == VOLUME_5_FAIXAS.
  // Fora disso (ou TRP sem célula), fallback p/ CREDIT_RULES (preservado).
  let entrouTrp = false;
  if (mes && getRegime(mes) === "VOLUME_5_FAIXAS") {
    entrouTrp = true;
    const trp = lookupCreditPercentTrp(band, mes, tableKey, rate, term, op, trpProvider);
    if (trp.percent !== null) {
      return { tableKey, percent: trp.percent };
    }
    // TRP null → cai no fallback abaixo. O warning de drift é decidido DEPOIS de
    // calcular o fallback (só loga se for drift REAL — vide abaixo).
  }

  // FALLBACK — CREDIT_RULES hardcoded (regime != VOLUME_5, sem competência, ou
  // TRP sem célula). Lógica original preservada na íntegra.
  const rules = CREDIT_RULES[tableKey] || [];
  const matchedRule = rules.find(
    (rule) => matchesRate(rule, rate) && matchesTerm(rule, term)
  );
  const fallbackPercent = matchedRule ? getBandPercent(matchedRule, band) : 0;

  // DRIFT REAL — só avisa quando o TRP retornou null MAS o CREDIT_RULES paga
  // (fallbackPercent != 0): o lookup TRP perdeu um contrato que o motor original
  // remunerava (sintoma de mapa/tabLabel/regra divergente). Quando ambos dão 0
  // (FORA_DA_TABELA normal), é esperado — silencia. NÃO altera o resultado, só o log.
  if (entrouTrp && fallbackPercent !== 0) {
    console.warn(
      `[motor] getCreditPercent: DRIFT — lookup TRP null mas CREDIT_RULES paga ` +
        `${fallbackPercent} (mes=${mes}, tableKey=${tableKey}, ` +
        `categoria=${MAP_TABLEKEY_TO_CATEGORIA[tableKey] || tableKey}). Usando fallback.`
    );
  }

  return {
    tableKey,
    percent: fallbackPercent,
  };
}

export function calcularOperacao(op: Operation, opts?: CalcularOperacaoOpts) {
  const productionBand = getProductionBandByValue(op.production_value || 0);
  const creditPercentInfo = getCreditPercent(op, productionBand, opts?.trpProvider);
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
  const diferido = Math.max(comissaoTotalCredito - avistaEmpresa, 0);

  const insuranceType = normalizeText(op.insurance_type);
  let comissaoSeguroEmpresa = 0;

  if (op.tem_seguro) {
    const percSeguro = getInsurancePercentByTerm(op.prazo, insuranceType);
    comissaoSeguroEmpresa = op.valor_bruto * percSeguro;
  }

  const penetracao = op.valor_seguro > 0 && op.valor_bruto > 0
    ? op.valor_seguro / op.valor_bruto
    : 0;

  const parcelas = op.prazo > 0 ? op.prazo : 0;
  const valorParcela = parcelas > 0 ? diferido / parcelas : 0;

  return {
    // MOV 3 (faxina) — REMOVIDOS por serem CÓDIGO MORTO (zero leitores, provado por
    // grep nos 6 consumidores de calcularOperacao + scripts):
    //   credito.avista_promotor, credito.spreadEmpresa, seguro.promotor, total_geral.
    // O que sobrou é o que alguém realmente lê: credito.{regra, faixa_producao,
    // percentual, percentual_avista_empresa, total, avista_empresa, diferido},
    // seguro.empresa e diferido.{total, parcelas, valorParcela}.
    //
    // Junto saiu getComissaoPromotorSeguro (cortes 0,6/0,4/0,2) — uma SEGUNDA escala
    // de penetração de seguro, incompatível com a oficial de lib/insurancePenetration
    // (0,30/0,21/0,11). Ela só alimentava seguro.promotor/total_geral.promotor, que
    // ninguém lia. Era uma mina: bastava alguém plugar o campo para pagar seguro pela
    // régua errada. A régua oficial é insuranceShareForPenetration.
    credito: {
      regra: creditPercentInfo.tableKey,
      faixa_producao: productionBand,
      percentual: totalCreditPercent,
      percentual_avista_empresa: cashCapPercent,
      total: comissaoTotalCredito,
      avista_empresa: avistaEmpresa,
      diferido,
    },
    seguro: {
      empresa: comissaoSeguroEmpresa,
      penetracao,
    },
    diferido: {
      total: diferido,
      parcelas,
      valorParcela,
    },
  };
}

export { getProductionBandByValue };
