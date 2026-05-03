type PeriodKey = {
  year: number;
  month: number;
};

type PolicyThreshold = {
  minProduction: number;
  percent: number;
};

type PolicySnapshot =
  | {
      effectiveFrom: number;
      type: "fixed";
      percent: number;
      auditPercents?: number[];
      note: string;
    }
  | {
      effectiveFrom: number;
      type: "thresholds";
      thresholds: PolicyThreshold[];
      auditPercents?: number[];
      note: string;
    }
  | {
      effectiveFrom: number;
      type: "fallback";
      percent: number;
      auditPercents?: number[];
      note: string;
    };

type CashPolicyParams = {
  companyCashPercent?: number | null;
  productionValue?: number | null;
  reference_date?: string | null;
  movement_date?: string | null;
  contract_date?: string | null;
  proposal_date?: string | null;
};

export type ResolvedCashPolicy = {
  percent: number;
  source: "proposal" | "policy";
  note: string;
  year: number | null;
  month: number | null;
};

export type ResolvedCashAuditPolicy = {
  selectedPercent: number;
  allowedPercents: number[];
  source: "proposal" | "policy";
  note: string;
  year: number | null;
  month: number | null;
  policyType: PolicySnapshot["type"];
  isAmbiguous: boolean;
};

const PROMOTIVA_CASH_POLICY: PolicySnapshot[] = [
  {
    effectiveFrom: 202212,
    type: "fixed",
    percent: 0.06,
    auditPercents: [0.06],
    note:
      "OPP PR2022/060 e OPP PR2023/006 mantiveram o a vista em 6,00% quando o campo da proposta nao estiver disponivel.",
  },
  {
    effectiveFrom: 202307,
    type: "fallback",
    percent: 0.054,
    auditPercents: [0.054, 0.06],
    note:
      "OPPs de 07/2023 a 12/2023 trouxeram tabelas explicitas de A Vista e PRT. Sem o percentual da proposta, o fallback conservador usa 5,40%.",
  },
  {
    effectiveFrom: 202401,
    type: "fallback",
    percent: 0.054,
    auditPercents: [0.054, 0.06],
    note:
      "TRPs de 01/2024 a 12/2024 alternam entre tabela 1 (5,40%) e tabela 2 (6,00%) conforme meta. Sem o percentual da proposta, o fallback usa a tabela 1.",
  },
  {
    effectiveFrom: 202501,
    type: "fallback",
    percent: 0.054,
    auditPercents: [0.054, 0.056, 0.058, 0.06],
    note:
      "TRPs de 01/2025 a 06/2025 possuem quatro niveis de a vista (5,40%, 5,60%, 5,80% e 6,00%) por atingimento de meta. Sem o percentual da proposta, o fallback usa 5,40%.",
  },
  {
    effectiveFrom: 202507,
    type: "thresholds",
    auditPercents: [0.054, 0.056, 0.057, 0.058, 0.059, 0.06],
    thresholds: [
      { minProduction: 10_000_000, percent: 0.06 },
      { minProduction: 7_000_000, percent: 0.059 },
      { minProduction: 5_000_000, percent: 0.058 },
      { minProduction: 3_000_000, percent: 0.057 },
      { minProduction: 1_000_000, percent: 0.056 },
      { minProduction: 0, percent: 0.054 },
    ],
    note:
      "TRPs de 07/2025 a 12/2025 classificam o a vista por perfil de producao mensal.",
  },
  {
    effectiveFrom: 202601,
    type: "thresholds",
    auditPercents: [0.056, 0.058, 0.06],
    thresholds: [
      { minProduction: 7_000_000, percent: 0.06 },
      { minProduction: 3_000_000, percent: 0.058 },
      { minProduction: 0, percent: 0.056 },
    ],
    note:
      "TRPs de 01/2026 a 03/2026 usam tres categorias: Rubi 5,60%, Safira 5,80% e Diamante 6,00%.",
  },
  {
    effectiveFrom: 202604,
    type: "fixed",
    percent: 0.06,
    auditPercents: [0.06],
    note:
      "TRP 04/2026 voltou a limitar o a vista em ate 6,00% em todas as faixas.",
  },
];

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePercent(value: unknown) {
  const parsed = toNumber(value);
  if (parsed <= 0) return 0;
  return parsed > 1 ? parsed / 100 : parsed;
}

function parseYearMonth(value: unknown): PeriodKey | null {
  if (!value) return null;

  const text = String(value).trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})/);
  if (isoMatch) {
    return {
      year: Number(isoMatch[1]),
      month: Number(isoMatch[2]),
    };
  }

  const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    return {
      year: Number(brMatch[3]),
      month: Number(brMatch[2]),
    };
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
  };
}

function resolveReferencePeriod(params: CashPolicyParams): PeriodKey | null {
  return (
    parseYearMonth(params.reference_date) ||
    parseYearMonth(params.movement_date) ||
    parseYearMonth(params.contract_date) ||
    parseYearMonth(params.proposal_date)
  );
}

function getSnapshot(period: PeriodKey | null) {
  if (!period) {
    return PROMOTIVA_CASH_POLICY[PROMOTIVA_CASH_POLICY.length - 1];
  }

  const periodCode = period.year * 100 + period.month;
  let selected = PROMOTIVA_CASH_POLICY[0];

  for (const snapshot of PROMOTIVA_CASH_POLICY) {
    if (snapshot.effectiveFrom <= periodCode) {
      selected = snapshot;
    }
  }

  return selected;
}

export function resolvePromotivaCashPolicy(
  params: CashPolicyParams
): ResolvedCashPolicy {
  const explicitPercent = normalizePercent(params.companyCashPercent);

  if (explicitPercent > 0) {
    return {
      percent: explicitPercent,
      source: "proposal",
      note: "Percentual a vista informado na propria proposta/diaria.",
      year: resolveReferencePeriod(params)?.year ?? null,
      month: resolveReferencePeriod(params)?.month ?? null,
    };
  }

  const period = resolveReferencePeriod(params);
  const snapshot = getSnapshot(period);
  const productionValue = Math.max(toNumber(params.productionValue), 0);

  if (snapshot.type === "fixed" || snapshot.type === "fallback") {
    return {
      percent: snapshot.percent,
      source: "policy",
      note: snapshot.note,
      year: period?.year ?? null,
      month: period?.month ?? null,
    };
  }

  const threshold =
    snapshot.thresholds.find((item) => productionValue >= item.minProduction) ||
    snapshot.thresholds[snapshot.thresholds.length - 1];

  return {
    percent: threshold.percent,
    source: "policy",
    note: snapshot.note,
    year: period?.year ?? null,
    month: period?.month ?? null,
  };
}

export function resolvePromotivaCashAuditPolicy(
  params: CashPolicyParams
): ResolvedCashAuditPolicy {
  const period = resolveReferencePeriod(params);
  const snapshot = getSnapshot(period);
  const productionValue = Math.max(toNumber(params.productionValue), 0);
  const explicitPercent = normalizePercent(params.companyCashPercent);

  let selectedPercent = 0;
  let allowedPercents = snapshot.auditPercents?.slice() || [];

  if (snapshot.type === "fixed" || snapshot.type === "fallback") {
    selectedPercent = snapshot.percent;
    if (!allowedPercents.length) {
      allowedPercents = [snapshot.percent];
    }
  } else {
    const threshold =
      snapshot.thresholds.find((item) => productionValue >= item.minProduction) ||
      snapshot.thresholds[snapshot.thresholds.length - 1];
    selectedPercent = threshold.percent;
    allowedPercents = [threshold.percent];
  }

  if (explicitPercent > 0) {
    selectedPercent = explicitPercent;
  }

  const normalizedAllowed = Array.from(
    new Set(
      allowedPercents
        .map((value) => normalizePercent(value))
        .filter((value) => value > 0)
        .sort((left, right) => left - right)
    )
  );

  return {
    selectedPercent,
    allowedPercents: normalizedAllowed,
    source: explicitPercent > 0 ? "proposal" : "policy",
    note: snapshot.note,
    year: period?.year ?? null,
    month: period?.month ?? null,
    policyType: snapshot.type,
    isAmbiguous: normalizedAllowed.length > 1,
  };
}
