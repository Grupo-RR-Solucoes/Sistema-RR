/**
 * lib/proposalDetailing.ts
 *
 * Helpers compartilhados para extrair detalhamento de propostas
 * (daily_production_records) e derivar campos exibidos na UI.
 *
 * Extraidos de lib/promoterAnalytics.ts na Etapa 4.4-fix-1.B para que
 * /api/commissions/proposals e qualquer outra rota possam consumir
 * os mesmos derivados sem duplicacao.
 *
 * Subset minimo de ProductionRow definido localmente — qualquer caller
 * pode usar `ProposalRecord` ou um tipo proprio compativel.
 */

export type ProposalRecord = {
  raw_payload?: Record<string, unknown> | null;
  is_srcc_restricted?: boolean | null;
  installments?: number | null;
  term_months?: number | null;
  gross_value?: number | null;
  company_received_percent?: number | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

/**
 * Le valor de raw_payload (jsonb da daily_production_records) tentando
 * varios aliases. Returns null se nenhum bate ou se o valor for vazio.
 *
 * Match e case/acento-insensitive — "Prefixo Ag. Responsavel" bate com
 * "PREFIXO AG. RESPONSÁVEL", "prefixo ag. responsavel", etc.
 */
export function readRawPayloadValue(
  payload: Record<string, unknown> | null | undefined,
  aliases: string[]
): unknown {
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

/**
 * Retorna o codigo/prefixo da agencia bancaria responsavel pela proposta.
 * Tenta varios aliases que aparecem no raw_payload conforme a fonte
 * (Promotiva exporta com encoding/acento variavel).
 */
export function getAgencyCode(record: ProposalRecord): string {
  const raw = readRawPayloadValue(record.raw_payload, [
    "Prefixo Ag. Responsavel",
    "Prefixo Ag. Responsável",
    "Agencia",
    "Agência",
    "Agencia Responsavel",
    "Agência Responsável",
  ]);

  return raw === null || raw === undefined || raw === "" ? "-" : String(raw);
}

/**
 * Retorna label de Restricao SRCC. Preferencia ao valor textual do
 * raw_payload (que pode ter detalhes); fallback para "Sim"/"Nao"
 * derivado do boolean is_srcc_restricted.
 */
export function getSrccRestrictionLabel(record: ProposalRecord): string {
  const raw =
    readRawPayloadValue(record.raw_payload, [
      "Indicador Restricao SRCC",
      "Indicador Restrição SRCC",
      "Restricao SRCC",
      "Restrição SRCC",
    ]) || null;

  if (raw !== null && raw !== undefined && raw !== "") {
    return String(raw);
  }

  return record.is_srcc_restricted ? "Sim" : "Não";
}

/**
 * Retorna numero de parcelas. Prioriza `installments`; fallback para
 * `term_months` (alguns produtos so trazem termo em meses). null se
 * nenhum dos dois esta presente.
 */
export function getInstallmentCount(
  record: ProposalRecord
): number | null {
  const installments = record.installments;
  if (installments !== null && installments !== undefined && Number.isFinite(Number(installments))) {
    return Number(installments);
  }
  const term = record.term_months;
  if (term !== null && term !== undefined && Number.isFinite(Number(term))) {
    return Number(term);
  }
  return null;
}

/**
 * Retorna a comissao da empresa (valor em R$) calculada como
 * gross_value * company_received_percent / 100. null se algum dos 2
 * estiver ausente.
 *
 * Atencao: company_received_percent eh armazenado como percentual
 * inteiro (ex: 12.5 para 12,5%) — dividir por 100 antes de multiplicar.
 */
export function getCompanyCommissionAmount(
  record: ProposalRecord
): number | null {
  const gross = record.gross_value;
  const percent = record.company_received_percent;
  if (
    gross === null ||
    gross === undefined ||
    percent === null ||
    percent === undefined
  ) {
    return null;
  }
  const grossNum = Number(gross);
  const percentNum = Number(percent);
  if (!Number.isFinite(grossNum) || !Number.isFinite(percentNum)) {
    return null;
  }
  return (grossNum * percentNum) / 100;
}

/**
 * Comissao do promotor em R$ apos aplicacao do % de penetracao
 * (override OU default). 4.4-fix-1.C: col 18 da planilha LUCIANA.
 *
 * Formula: COMISSAO PF (base) * % penetracao efetiva / 100.
 * Retorna null quando algum dos 2 esta ausente.
 */
export function computePromoterShareAmount(
  commissionPfAmount: number | null | undefined,
  penetrationPercentEffective: number | null | undefined
): number | null {
  if (
    commissionPfAmount === null ||
    commissionPfAmount === undefined ||
    penetrationPercentEffective === null ||
    penetrationPercentEffective === undefined
  ) {
    return null;
  }
  const baseNum = Number(commissionPfAmount);
  const percentNum = Number(penetrationPercentEffective);
  if (!Number.isFinite(baseNum) || !Number.isFinite(percentNum)) {
    return null;
  }
  return (baseNum * percentNum) / 100;
}

/**
 * Le a "% A VISTA pura" Promotiva direto do raw_payload da
 * daily_production_record. 4.4-fix-1.E (D1): essa eh a regra TRP/OPP
 * original da Promotiva (ex: 5,80% para Consignado Publico tx 2,18%),
 * NAO o valor pos-cascata que esta em promoter_commission_percent.
 *
 * 4.4-fix-1.F: ALIASES expandidos para 12 variacoes; fallback dev-only
 * dumpa as chaves do raw_payload no console quando nenhum bate, para
 * o Diego conseguir descobrir o nome real e me reportar.
 *
 * Normalizacao: planilha Promotiva grava como decimal (0.058) ou
 * percentual (5.8) dependendo da fonte. Heuristica: valores <= 1
 * sao considerados decimal e multiplicados por 100 para unificar
 * a escala 0-100 usada na UI. Match e case/acento-insensitive via
 * readRawPayloadValue → normalizeText.
 */
const A_VISTA_ALIASES = [
  "% A VISTA",
  "%A_VISTA",
  "%A VISTA",
  "% A_VISTA",
  "PCT_A_VISTA",
  "PERCENT_A_VISTA",
  "%AVISTA",
  "% AVISTA",
  "PCTAVISTA",
  "%_A_VISTA",
  "% VISTA",
  "VISTA",
];

export function getAVistaPercent(record: ProposalRecord): number | null {
  if (!record?.raw_payload) return null;

  const raw = readRawPayloadValue(record.raw_payload, A_VISTA_ALIASES);

  if (raw === null || raw === undefined || raw === "") {
    // Fallback dev: lista as chaves do payload (1a vez por sessao
    // bastaria; aqui logamos sempre que falhar — barato e ajuda).
    if (
      typeof record.raw_payload === "object" &&
      record.raw_payload !== null &&
      typeof process !== "undefined" &&
      process.env?.NODE_ENV === "development"
    ) {
      const keys = Object.keys(record.raw_payload);
      if (keys.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          "[getAVistaPercent] Nenhum alias bateu. Chaves do raw_payload:",
          keys.slice(0, 50)
        );
      }
    }
    return null;
  }

  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  // Heuristica de escala: decimais entram em 0..1, percentuais ja em 0..100.
  return num <= 1 ? num * 100 : num;
}

/**
 * Comissao do promotor sobre seguro em R$. 4.4-fix-1.C: col 19 da
 * planilha LUCIANA. Formula: COMISSAO SEGURO (total) * % seguro
 * promotor efetivo / 100. Retorna null quando algum esta ausente.
 *
 * Dia 4.5 (futuro) tornara o % editavel.
 */
export function computePromoterInsuranceAmount(
  insuranceCommissionAmount: number | null | undefined,
  insurancePercentEffective: number | null | undefined
): number | null {
  if (
    insuranceCommissionAmount === null ||
    insuranceCommissionAmount === undefined ||
    insurancePercentEffective === null ||
    insurancePercentEffective === undefined
  ) {
    return null;
  }
  const baseNum = Number(insuranceCommissionAmount);
  const percentNum = Number(insurancePercentEffective);
  if (!Number.isFinite(baseNum) || !Number.isFinite(percentNum)) {
    return null;
  }
  return (baseNum * percentNum) / 100;
}
