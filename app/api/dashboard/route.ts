import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withAuthenticatedAnon } from "@/lib/auth/guards";
import { buildClosingAnalytics } from "@/lib/closingAnalytics";
import { getCompanyDisplayIdentity } from "@/lib/knownCompanies";
import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import { fetchAllRows } from "@/lib/queryHelpers";

const MONTH_NAMES = [
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

const PRODUCT_COLORS = [
  "#0d4de3",
  "#1d63e9",
  "#f0b53f",
  "#fff000",
  "#0b1633",
  "#6f88d9",
];

type ProductionRow = {
  assigned_promoter_id?: string | null;
  status?: string | null;
  net_value?: number | null;
  product_description?: string | null;
  convenio_type?: string | null;
  convenio_segment?: string | null;
  is_srcc_restricted?: boolean | null;
  movement_date?: string | null;
  contract_date?: string | null;
  proposal_date?: string | null;
};

type PromoterRow = {
  id: string;
};

type DashboardResponsePayload = {
  summary: {
    forecastPeriodLabel: string;
    actualPeriodLabel: string;
    productionPeriodLabel?: string;
    expectedCash: number;
    expectedPrt: number;
    generatedPrt: number;
    expectedInsurance: number;
    expectedTotal: number;
    futureDeferredBalance: number;
    productionTotal: number;
    activePromoters: number;
    companiesCount: number;
  };
  monthlyRevenue: Array<{
    label: string;
    expectedTotal: number;
    actualTotal: number;
  }>;
  forecastComposition: Array<{
    label: string;
    value: number;
    color: string;
  }>;
  productShare: Array<{
    label: string;
    value: number;
    percent: number;
    color: string;
  }>;
  companyRows: Array<{
    empresa_nome: string;
    empresa_cnpj: string;
    expectedCash: number;
    expectedGeneratedPrt: number;
    expectedPrt: number;
    expectedInsurance: number;
    expectedTotal: number;
  }>;
  alerts: string[];
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hasLetters(value: unknown) {
  return /[A-Z]/i.test(String(value ?? ""));
}

function isValidProductionStatus(status: unknown) {
  const normalized = normalizeText(status);
  return normalized === "PRODUCAO" || normalized === "PRODUCTION";
}

function isEligibleProductionRow(row: ProductionRow) {
  return isValidProductionStatus(row.status) && row.is_srcc_restricted !== true;
}

function getRowProductionPeriod(row: ProductionRow) {
  return (
    getProductionPeriodFromValue(row.movement_date) ||
    getProductionPeriodFromValue(row.contract_date) ||
    getProductionPeriodFromValue(row.proposal_date)
  );
}

function getPeriodKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getPeriodLabel(year: number, month: number) {
  return `${MONTH_NAMES[month - 1]}/${String(year).slice(-2)}`;
}

function comparePeriods(a: { year: number; month: number }, b: { year: number; month: number }) {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function classifyProduct(record: {
  convenio_segment?: string | null;
  convenio_type?: string | null;
  product_description?: string | null;
}) {
  const source = [
    record.convenio_segment,
    record.convenio_type,
    record.product_description,
  ]
    .filter(Boolean)
    .join(" ");

  const normalized = normalizeText(source);

  if (normalized.includes("INSS")) return "Convenio INSS";
  if (normalized.includes("SIAPE")) return "Convenio SIAPE";
  if (
    normalized.includes("PUBLIC") ||
    normalized.includes("PREFEITURA") ||
    normalized.includes("ESTADO") ||
    normalized.includes("MUNICIP") ||
    normalized.includes("CAMARA") ||
    normalized.includes("ASSEMBLEIA")
  ) {
    return "Convenios Publicos";
  }
  if (normalized.includes("FGTS")) return "FGTS";
  if (normalized.includes("LOAS") || normalized.includes("BPC")) {
    return "Beneficio Assistencial";
  }
  if (
    normalized.includes("MILITAR") ||
    normalized.includes("EXERCITO") ||
    normalized.includes("MARINHA") ||
    normalized.includes("AERONAUTICA")
  ) {
    return "Forcas";
  }
  if (normalized.includes("CORRENTISTA")) return "Corrente";
  if (normalized.includes("CARTAO")) return "Cartao";

  const labelCandidates = [
    record.convenio_segment,
    record.product_description,
    record.convenio_type,
  ].filter(Boolean);

  const preferredLabel =
    labelCandidates.find((item) => hasLetters(item)) ||
    labelCandidates[0] ||
    "Nao identificado";

  const rawLabel =
    preferredLabel;

  return titleCase(String(rawLabel));
}

export async function GET(request: Request) {
  try {
    const { supabase } = await withAuthenticatedAnon();

    const { searchParams } = new URL(request.url);
    const yearParam = Number(searchParams.get("year"));
    const monthParam = Number(searchParams.get("month"));
    const year =
      Number.isInteger(yearParam) && yearParam >= 2000 ? yearParam : undefined;
    const month =
      Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12
        ? monthParam
        : undefined;

        const [closingPayload, productionRows, promoters] = await Promise.all([
          buildClosingAnalytics(supabase, {
            year,
            month,
            fastDashboardMode: true,
          }),
          fetchAllRows<ProductionRow>(() =>
            supabase
              .from("daily_production_records")
              .select(
                "assigned_promoter_id, status, net_value, product_description, convenio_type, convenio_segment, is_srcc_restricted, movement_date, contract_date, proposal_date"
              )
              .order("id", { ascending: true })
          ),
          fetchAllRows<PromoterRow>(() =>
            supabase
              .from("promoters")
              .select("id")
              .eq("active", true)
              .order("id", { ascending: true })
          ),
        ]);

    const validProductionRows = productionRows.filter(isEligibleProductionRow);

    const productionPeriods = new Map<string, { year: number; month: number; total: number }>();

    for (const row of validProductionRows) {
      const period = getRowProductionPeriod(row);

      if (!period) continue;

      const key = getPeriodKey(period.year, period.month);
      const current = productionPeriods.get(key) || {
        year: period.year,
        month: period.month,
        total: 0,
      };

      current.total += toNumber(row.net_value);
      productionPeriods.set(key, current);
    }

    const sortedProductionPeriods = Array.from(productionPeriods.values()).sort(comparePeriods);
    const latestProductionPeriod = sortedProductionPeriods.at(-1) || null;

    const productionRowsForCurrentPeriod = latestProductionPeriod
      ? validProductionRows.filter((row) => {
          const period = getRowProductionPeriod(row);

          return (
            period &&
            period.year === latestProductionPeriod.year &&
            period.month === latestProductionPeriod.month
          );
        })
      : [];

    const productionTotal = productionRowsForCurrentPeriod.reduce(
      (sum, row) => sum + toNumber(row.net_value),
      0
    );

    const productTotals = new Map<string, number>();

    for (const row of productionRowsForCurrentPeriod) {
      const label = classifyProduct(row);
      productTotals.set(label, (productTotals.get(label) || 0) + toNumber(row.net_value));
    }

    const sortedProductShare = Array.from(productTotals.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    const collapsedProductShare =
      sortedProductShare.length > 6
        ? [
            ...sortedProductShare.slice(0, 5),
            {
              label: "Outros",
              value: sortedProductShare.slice(5).reduce((sum, item) => sum + item.value, 0),
            },
          ]
        : sortedProductShare;

    const productShare = collapsedProductShare.map((item, index) => ({
      ...item,
      percent: productionTotal > 0 ? (item.value / productionTotal) * 100 : 0,
      color: PRODUCT_COLORS[index % PRODUCT_COLORS.length],
    }));

    const selectedPeriod = closingPayload.selectedPeriod;
    const selectedCompanyRows = selectedPeriod
      ? closingPayload.companyRows.filter(
          (row) => row.year === selectedPeriod.year && row.month === selectedPeriod.month
        )
      : [];

    const companyRollup = new Map<
      string,
      {
        empresa_nome: string;
        empresa_cnpj: string;
        expectedCash: number;
        expectedGeneratedPrt: number;
        expectedPrt: number;
        expectedInsurance: number;
        expectedTotal: number;
      }
    >();

    for (const row of selectedCompanyRows) {
      const identity = getCompanyDisplayIdentity({
        cnpj: row.empresa_cnpj,
        name: row.empresa_nome,
      });
      const key = identity.empresaCnpj || row.companyId || identity.empresaNome;
      const current = companyRollup.get(key) || {
        empresa_nome: identity.empresaNome,
        empresa_cnpj: identity.empresaCnpj,
        expectedCash: 0,
        expectedGeneratedPrt: 0,
        expectedPrt: 0,
        expectedInsurance: 0,
        expectedTotal: 0,
      };

      current.expectedCash += toNumber(row.expectedCash);
      current.expectedGeneratedPrt += toNumber(row.expectedGeneratedPrt);
      current.expectedPrt += toNumber(row.expectedPrt);
      current.expectedInsurance += toNumber(row.expectedInsurance);
      current.expectedTotal +=
        toNumber(row.expectedCash) +
        toNumber(row.expectedPrt) +
        toNumber(row.expectedInsurance);

      companyRollup.set(key, current);
    }

    const companyRows = Array.from(companyRollup.values())
      .map((row) => ({
        ...row,
        expectedCash: roundMoney(row.expectedCash),
        expectedGeneratedPrt: roundMoney(row.expectedGeneratedPrt),
        expectedPrt: roundMoney(row.expectedPrt),
        expectedInsurance: roundMoney(row.expectedInsurance),
        expectedTotal: roundMoney(row.expectedTotal),
      }))
      .sort(
      (a, b) => b.expectedTotal - a.expectedTotal
    );

    const latestActualPoint =
      [...closingPayload.trend]
        .reverse()
        .find((point) => toNumber(point.actualNet) > 0) || null;

    const monthlyRevenue = closingPayload.trend
      .map((point) => ({
        label: point.label,
        expectedTotal: roundMoney(point.expectedTotal),
        actualTotal: roundMoney(point.actualNet),
      }));

    const activePromoters =
      promoters.length > 0
        ? promoters.length
        : new Set(
            productionRowsForCurrentPeriod
              .map((row) => row.assigned_promoter_id)
              .filter(Boolean)
          ).size;

        const payload: DashboardResponsePayload = {
          summary: {
            forecastPeriodLabel: closingPayload.summary.periodLabel,
            actualPeriodLabel: latestActualPoint?.label || "",
            productionPeriodLabel: latestProductionPeriod
              ? getPeriodLabel(latestProductionPeriod.year, latestProductionPeriod.month)
              : undefined,
            expectedCash: roundMoney(closingPayload.summary.expectedCash),
            expectedPrt: roundMoney(closingPayload.summary.expectedPrt),
            generatedPrt: roundMoney(closingPayload.summary.generatedPrt),
            expectedInsurance: roundMoney(closingPayload.summary.expectedInsurance),
            expectedTotal: roundMoney(
              closingPayload.summary.expectedCash +
              closingPayload.summary.expectedPrt +
              closingPayload.summary.expectedInsurance
            ),
            futureDeferredBalance: roundMoney(closingPayload.summary.futureDeferredBalance),
            productionTotal: roundMoney(productionTotal),
            activePromoters,
            companiesCount: companyRows.length,
          },
          monthlyRevenue,
          forecastComposition: [
            {
              label: "A vista",
              value: closingPayload.summary.expectedCash,
              color: "#0d4de3",
            },
            {
              label: "PRT do mes",
              value: closingPayload.summary.expectedPrt,
              color: "#f0b53f",
            },
            {
              label: "Seguro",
              value: closingPayload.summary.expectedInsurance,
              color: "#fff000",
            },
          ],
          productShare,
          companyRows,
          alerts: closingPayload.alerts,
        };

    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
