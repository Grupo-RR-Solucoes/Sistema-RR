/**
 * Janelas de atividade dos 4 CNPJs do Grupo RR.
 *
 * Datas de início confirmadas:
 *   - audit_v9_enquadramento: cnpjs_ativos = 1 em Dez/2022→Ago/2023; 2 em
 *     Set/2023→Out/2024; 3 em Nov/2024→Ago/2025; 4 em Set/2025+.
 *   - userMemory + gap_analysis.md §1.5: AL desde Dez/22, PE desde Set/23,
 *     AL2 desde Nov/24, AL3 desde Set/25.
 *
 * SRCC NÃO é CNPJ — é uma flag de status de contrato. Esta lib não trata
 * SRCC; o filtro `is_srcc_restricted` deve ser aplicado pelo caller ao
 * agregar produção.
 *
 * Esta lib NÃO depende de Supabase nem do XLSX v9 — é só metadado canônico.
 */
import { KNOWN_COMPANIES_BY_CNPJ } from "./knownCompanies.ts";

/**
 * Identifica um CNPJ do Grupo RR e a partir de quando entra na meta consolidada.
 *
 * `firstActiveYearMonth` é o mês ISO YYYY-MM em que o CNPJ começa a contar
 * para a meta. Antes desse mês, contratos do CNPJ NÃO compõem a produção
 * usada na Camada 1.
 */
export interface CnpjActivePeriod {
  /** Apelido curto usado em logs e relatórios. */
  label: string;
  /** Razão social oficial (igual ao knownCompanies). */
  empresaNome: string;
  /** CNPJ apenas dígitos. */
  cnpj: string;
  /** MCI Banco do Brasil. */
  mci: string;
  /** Código COBAN. */
  coban: string;
  /** Mês ISO YYYY-MM em que o CNPJ entra na meta (inclusivo). */
  firstActiveYearMonth: string;
}

/**
 * Lista canônica das 4 empresas operacionais do Grupo RR.
 *
 * Ordem reflete entrada cronológica (AL → PE → AL2 → AL3).
 */
export const CNPJ_ACTIVE_PERIODS: CnpjActivePeriod[] = [
  {
    label: "RR Alagoas",
    empresaNome: "RR SOLUCOES LTDA",
    cnpj: "48357275000103",
    mci: "847822962",
    coban: "98250",
    firstActiveYearMonth: "2022-12",
  },
  {
    label: "RR Pernambuco",
    empresaNome: "RR SOLUCOES PE LTDA",
    cnpj: "51457289000103",
    mci: "850169280",
    coban: "14692",
    firstActiveYearMonth: "2023-09",
  },
  {
    label: "RR Alagoas 2",
    empresaNome: "RR SOLUCOES AL LTDA",
    cnpj: "56140658000153",
    mci: "873386662",
    coban: "18309",
    firstActiveYearMonth: "2024-11",
  },
  {
    label: "RR Alagoas 3",
    empresaNome: "RR AL SOLUCOES LTDA",
    cnpj: "55867409000100",
    mci: "873298328",
    coban: "20466",
    firstActiveYearMonth: "2025-09",
  },
];

const CNPJ_ACTIVE_PERIODS_BY_CNPJ: Record<string, CnpjActivePeriod> = Object.fromEntries(
  CNPJ_ACTIVE_PERIODS.map((p) => [p.cnpj, p])
);
const CNPJ_ACTIVE_PERIODS_BY_MCI: Record<string, CnpjActivePeriod> = Object.fromEntries(
  CNPJ_ACTIVE_PERIODS.map((p) => [p.mci, p])
);
const CNPJ_ACTIVE_PERIODS_BY_COBAN: Record<string, CnpjActivePeriod> = Object.fromEntries(
  CNPJ_ACTIVE_PERIODS.map((p) => [p.coban, p])
);

/** Retorna "YYYY-MM" a partir de year+month numéricos. */
export function toYm(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * True se o CNPJ está ativo no mês informado (ou seja, entrou no Grupo RR
 * em ou antes desse mês).
 *
 * @param cnpj CNPJ apenas dígitos (14 caracteres). Outros identificadores
 *             (MCI, COBAN, formato pontuado) devem ser resolvidos antes via
 *             `resolveCnpjActivePeriod`.
 * @param year ano (ex.: 2024)
 * @param month mês 1-12
 */
export function isCnpjActive(cnpj: string, year: number, month: number): boolean {
  const period = CNPJ_ACTIVE_PERIODS_BY_CNPJ[cnpj];
  if (!period) return false;
  return toYm(year, month) >= period.firstActiveYearMonth;
}

/**
 * Lista os CNPJs ativos em um determinado mês.
 *
 * Espelha a coluna `cnpjs_ativos` da aba "Mapa Enquadramento" (audit_v9):
 *   - Dez/2022 a Ago/2023: 1 (AL)
 *   - Set/2023 a Out/2024: 2 (AL + PE)
 *   - Nov/2024 a Ago/2025: 3 (AL + PE + AL2)
 *   - Set/2025+         : 4 (AL + PE + AL2 + AL3)
 */
export function activeCnpjsForMonth(year: number, month: number): CnpjActivePeriod[] {
  const ym = toYm(year, month);
  return CNPJ_ACTIVE_PERIODS.filter((p) => ym >= p.firstActiveYearMonth);
}

/** Conta CNPJs ativos no mês (usado para validação contra v9 cnpjs_ativos). */
export function countActiveCnpjs(year: number, month: number): number {
  return activeCnpjsForMonth(year, month).length;
}

/**
 * Resolve um identificador qualquer (CNPJ pontuado, MCI, COBAN) → período.
 * Retorna null se o identificador não bate com nenhum CNPJ do Grupo RR.
 */
export function resolveCnpjActivePeriod(input: {
  cnpj?: unknown;
  mci?: unknown;
  coban?: unknown;
}): CnpjActivePeriod | null {
  const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const cnpj = onlyDigits(input.cnpj);
  if (cnpj && CNPJ_ACTIVE_PERIODS_BY_CNPJ[cnpj]) return CNPJ_ACTIVE_PERIODS_BY_CNPJ[cnpj];
  const mci = onlyDigits(input.mci);
  if (mci && CNPJ_ACTIVE_PERIODS_BY_MCI[mci]) return CNPJ_ACTIVE_PERIODS_BY_MCI[mci];
  const coban = onlyDigits(input.coban);
  if (coban && CNPJ_ACTIVE_PERIODS_BY_COBAN[coban]) return CNPJ_ACTIVE_PERIODS_BY_COBAN[coban];
  return null;
}

/**
 * Sanity check em build/teste: cada CNPJ aqui deve estar em knownCompanies.ts.
 * Lança se houver desalinhamento (defesa contra divergência silenciosa).
 */
export function assertAlignmentWithKnownCompanies(): void {
  for (const p of CNPJ_ACTIVE_PERIODS) {
    const known = KNOWN_COMPANIES_BY_CNPJ[p.cnpj];
    if (!known) {
      throw new Error(
        `[cnpjActivePeriod] CNPJ ${p.cnpj} (${p.label}) não está em knownCompanies.ts`
      );
    }
    if (known.mci !== p.mci || known.coban !== p.coban) {
      throw new Error(
        `[cnpjActivePeriod] divergência MCI/COBAN para CNPJ ${p.cnpj}: ` +
          `knownCompanies={mci:${known.mci}, coban:${known.coban}} ` +
          `vs activePeriod={mci:${p.mci}, coban:${p.coban}}`
      );
    }
  }
}
