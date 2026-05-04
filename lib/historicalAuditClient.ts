// Client helper para o endpoint /api/auditoria/historico (Sub-etapa 3.2.B).
// Define os tipos do JSON e o fetch usado pela tela /auditoria.

export type CashDivergence =
  | "NONE"
  | "INTERNAL_DIVERGENCE"
  | "PROBABLY_WRONG_BRACKET"
  | "WRONG_BRACKET"
  | "OTHER";

export type PrtStatus =
  | "OK"
  | "OK_DEBITADO"
  | "INTERROMPIDO_SUSPEITO"
  | "INTERROMPIDO_LEGITIMO"
  | "NUNCA_PAGO"
  | "AUSENTE";

export type CashResult = {
  contractNumber: string;
  companyCnpj: string;
  year: number;
  month: number;
  valorLiquido: number;
  valorBruto: number;
  pctTabelaOpp: number;
  pctAVistaPago: number;
  pctAVistaEsperado: number;
  capRegime: number;
  comissaoPaga: number;
  comissaoEsperada: number;
  divergence: CashDivergence;
  recuperavel: number;
  note?: string;
};

export type PrtResult = {
  operationNumber: string;
  companyCnpj: string;
  dataContratacao: string | null;
  parcelasTotal: number;
  parcelasPagas: number;
  primeiroMesPago: { year: number; month: number } | null;
  ultimoMesPago: { year: number; month: number } | null;
  ultimoMesListado: { year: number; month: number } | null;
  status: PrtStatus;
  debitInfo: {
    tipo: "LIQUIDACAO" | "CANCELAMENTO" | "RENOVACAO" | "OUTRO";
    year: number;
    month: number;
  } | null;
  idadeAteUltimoMesPago: number;
  totalPago: number;
  totalListadoNaoPago: number;
  recuperavelEstimado: number;
  observations: string[];
};

export type HistoricalAuditPayload = {
  meta: {
    year: number;
    month: number;
    cached: boolean;
    cachedAt: string | null;
    timing: { cashMs: number; prtMs: number; totalMs: number };
  };
  cash: {
    summary: {
      productionValue: number;
      totalContracts: number;
      totalRecuperavel: number;
      totalSrccExcluded: number;
      byDivergence: Record<CashDivergence, number>;
      recuperavelByDivergence: Record<CashDivergence, number>;
      isMetaRegime: boolean;
      policy: {
        source: string;
        percent: number;
        note: string;
        year: number | null;
        month: number | null;
      };
    };
    results: CashResult[];
  };
  prt: {
    summary: {
      totalContractsAuditados: number;
      byStatus: Record<PrtStatus, number>;
      recuperavelByStatus: Record<PrtStatus, number>;
      totalRecuperavel: number;
      debitsApplied: number;
      totalDebitsParsed: number;
    };
    results: PrtResult[];
  };
};

export async function fetchHistoricalAudit(
  year: number,
  month: number,
  signal?: AbortSignal
): Promise<HistoricalAuditPayload> {
  const url = `/api/auditoria/historico?year=${year}&month=${month}`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(
      body?.error || `Erro ${resp.status} ao buscar auditoria histórica`
    );
  }
  return resp.json();
}

const COMPANY_LABELS: Record<string, string> = {
  "TEMP-847822962-98250": "RR Alagoas",
  "TEMP-873386662-18309": "RR Alagoas 2",
  "TEMP-873298328-20466": "RR Alagoas 3",
  "TEMP-850169280-14692": "RR Pernambuco",
};

export function getCompanyShortName(cnpj: string): string {
  return COMPANY_LABELS[cnpj] || cnpj;
}

export function isVolumeOuSafira(year: number, month: number): boolean {
  return (year === 2025 && month >= 7) || (year === 2026 && month <= 3);
}

export function isMetaRegime(year: number, month: number): boolean {
  if (year < 2025) return year >= 2023; // jul/23 a dez/24 (cobre tb 2023, 2024)
  if (year === 2025) return month <= 6;
  return false;
}

export function shouldShowHistoricalFindings(
  year: number,
  month: number
): boolean {
  return isVolumeOuSafira(year, month);
}

export const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCurrency(value: number | null | undefined): string {
  return moneyFormatter.format(Number(value || 0));
}

export function formatPercent(fraction: number): string {
  return `${(Number(fraction || 0) * 100).toFixed(2).replace(".", ",")}%`;
}

export function formatDateBr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function formatPeriodBr(p: { year: number; month: number } | null): string {
  if (!p) return "—";
  return `${String(p.month).padStart(2, "0")}/${p.year}`;
}
