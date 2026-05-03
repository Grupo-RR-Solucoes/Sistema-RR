import fs from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

const OUTPUT_DIR = path.join(process.cwd(), "runtime", "outputs");

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeKey(value) {
  return String(value ?? "").trim().toUpperCase();
}

function getMetadataNumber(metadata, aliases) {
  if (!metadata) return 0;

  for (const alias of aliases) {
    const wanted = normalizeKey(alias);
    const found = Object.entries(metadata).find(
      ([key]) => normalizeKey(key) === wanted
    );
    if (found) {
      return toNumber(found[1]);
    }
  }

  return 0;
}

function extractOperationIdFromAdjustment(row) {
  const direct = normalizeKey(row.operation_number || row.contract_number);
  if (direct) return direct;

  const metadata = row.metadata || {};
  const combined = [
    metadata["DESCRIÇÃO"],
    metadata["DESCRICAO"],
    metadata["HISTÓRICO"],
    metadata["HISTORICO"],
    metadata["PRODUTO"],
    metadata["TIPO"],
  ]
    .filter(Boolean)
    .join(" ");

  const match = String(combined).match(/\b\d{6,}\b/);
  return normalizeKey(match?.[0] || "");
}

function getPeriodKey(year, month) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function parsePeriodKey(key) {
  const [year, month] = key.split("-").map(Number);
  return { year, month };
}

function comparePeriods(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function addMonths(year, month, monthsToAdd) {
  const date = new Date(Date.UTC(year, month - 1 + monthsToAdd, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

async function loadEnv(envPath) {
  const raw = await fs.readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function fetchAll(supabase, table, select, extra = (query) => query) {
  const rows = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await extra(
      supabase.from(table).select(select).range(from, from + pageSize - 1)
    );

    if (error) {
      throw error;
    }

    rows.push(...(data || []));

    if (!data || data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  await loadEnv(path.join(process.cwd(), ".env.local"));

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const closings = await fetchAll(
    supabase,
    "fechamento_mensal_empresa",
    "empresa_cnpj, ano, mes, valor_avista, valor_diferido, valor_seguro, valor_estorno, valor_renovacao, valor_liquido, operacoes",
    (query) => query.order("empresa_cnpj").order("ano").order("mes")
  );

  const companyCnpjs = Array.from(
    new Set(
      closings
        .map((row) => String(row.empresa_cnpj || "").trim())
        .filter(Boolean)
    )
  );

  const prtEntries =
    companyCnpjs.length > 0
      ? await fetchAll(
          supabase,
          "monthly_closing_entries",
          "company_cnpj, year, month, entry_type, operation_number, contract_number, commission_value, metadata",
          (query) =>
            query
              .in("company_cnpj", companyCnpjs)
              .eq("entry_type", "PRT")
              .gt("commission_value", 0)
        )
      : [];

  const debitEntries =
    companyCnpjs.length > 0
      ? await fetchAll(
          supabase,
          "monthly_closing_entries",
          "company_cnpj, year, month, entry_type, operation_number, contract_number, metadata",
          (query) =>
            query
              .in("company_cnpj", companyCnpjs)
              .eq("entry_type", "DEBIT")
        )
      : [];

  const companies = new Map();
  for (const row of closings) {
    companies.set(row.empresa_cnpj, true);
  }

  const actualByCompanyPeriod = new Map();
  for (const row of closings) {
    const key = `${row.empresa_cnpj}::${getPeriodKey(row.ano, row.mes)}`;
    actualByCompanyPeriod.set(key, {
      companyCnpj: row.empresa_cnpj,
      year: row.ano,
      month: row.mes,
      actualPrt: toNumber(row.valor_diferido),
      actualCash: toNumber(row.valor_avista),
      actualInsurance: toNumber(row.valor_seguro),
      actualEstorno: toNumber(row.valor_estorno),
      actualRenewal: toNumber(row.valor_renovacao),
      actualNet: toNumber(row.valor_liquido),
      operations: Number(row.operacoes || 0),
    });
  }

  const timelineByOperation = new Map();
  let entriesWithoutKey = 0;
  const stopPeriodByOperation = new Map();

  for (const row of prtEntries) {
    const rawId = normalizeKey(row.operation_number || row.contract_number);
    if (!rawId) {
      entriesWithoutKey += 1;
      continue;
    }

    const monthKey = getPeriodKey(row.year, row.month);
    const operationKey = `${row.company_cnpj}::${rawId}`;
    const bucket = timelineByOperation.get(operationKey) || new Map();
    const current = bucket.get(monthKey) || {
      companyCnpj: row.company_cnpj,
      year: row.year,
      month: row.month,
      amount: 0,
      operationId: rawId,
      metadata: row.metadata || {},
    };
    current.amount += toNumber(row.commission_value);
    current.metadata = row.metadata || current.metadata || {};
    bucket.set(monthKey, current);
    timelineByOperation.set(operationKey, bucket);
  }

  for (const row of debitEntries) {
    const operationId = extractOperationIdFromAdjustment(row);
    if (!operationId) continue;

    const key = `${row.company_cnpj}::${operationId}`;
    const current = stopPeriodByOperation.get(key);
    const next = { year: row.year, month: row.month };
    if (!current || comparePeriods(next, current) < 0) {
      stopPeriodByOperation.set(key, next);
    }
  }

  const scheduleRows = [];
  const expectedByCompanyPeriod = new Map();

  function addToMap(map, companyCnpj, year, month, amount) {
    const key = `${companyCnpj}::${getPeriodKey(year, month)}`;
    map.set(key, round2((map.get(key) || 0) + amount));
  }

  for (const [operationKey, bucket] of timelineByOperation.entries()) {
    const timeline = Array.from(bucket.values()).sort(comparePeriods);

    for (let index = 0; index < timeline.length; index += 1) {
      const current = timeline[index];
      const next = timeline[index + 1];
      const paidInstallments = Math.max(
        1,
        Math.round(
          getMetadataNumber(current.metadata, [
            "QTD PARCELAS PGS",
            "QTD PARCELAS PAGAS",
            "PARCELAS PAGAS",
          ])
        )
      );
      const totalInstallments = Math.max(
        paidInstallments,
        Math.round(
          getMetadataNumber(current.metadata, [
            "QTD PARCELAS TOTAL",
            "QTD PARCELAS TOTAIS",
            "PARCELAS TOTAL",
            "PARCELAS TOTAIS",
          ])
        )
      );
      const remainingInstallments = Math.max(totalInstallments - paidInstallments, 0);

      for (let offset = 1; offset <= remainingInstallments; offset += 1) {
        const due = addMonths(current.year, current.month, offset);
        const stopPeriod = stopPeriodByOperation.get(operationKey);
        if (
          next &&
          comparePeriods(due, { year: next.year, month: next.month }) >= 0
        ) {
          break;
        }

        if (
          stopPeriod &&
          comparePeriods(due, {
            year: stopPeriod.year,
            month: stopPeriod.month,
          }) >= 0
        ) {
          break;
        }

        addToMap(
          expectedByCompanyPeriod,
          current.companyCnpj,
          due.year,
          due.month,
          current.amount
        );
        scheduleRows.push({
          companyCnpj: current.companyCnpj,
          operationId: current.operationId,
          sourcePeriod: getPeriodKey(current.year, current.month),
          duePeriod: getPeriodKey(due.year, due.month),
          nextObservedPeriod: next ? getPeriodKey(next.year, next.month) : "",
          stopPeriod: stopPeriod ? getPeriodKey(stopPeriod.year, stopPeriod.month) : "",
          installmentAmount: round2(current.amount),
          paidInstallments,
          totalInstallments,
          remainingInstallments,
        });
      }
    }
  }

  const allPeriodKeys = new Set();
  for (const key of actualByCompanyPeriod.keys()) allPeriodKeys.add(key);
  for (const key of expectedByCompanyPeriod.keys()) allPeriodKeys.add(key);
  const actualPeriodKeys = new Set(actualByCompanyPeriod.keys());

  const summaryRows = Array.from(allPeriodKeys)
    .map((key) => {
      const [companyCnpj, periodKey] = key.split("::");
      const { year, month } = parsePeriodKey(periodKey);
      const actual = actualByCompanyPeriod.get(key) || {
        companyCnpj,
        year,
        month,
        actualPrt: 0,
        actualCash: 0,
        actualInsurance: 0,
        actualEstorno: 0,
        actualRenewal: 0,
        actualNet: 0,
        operations: 0,
      };
      const expectedInstallmentPrt = round2(expectedByCompanyPeriod.get(key) || 0);
      return {
        companyCnpj,
        year,
        month,
        period: periodKey,
        hasActualClosing: actualPeriodKeys.has(key),
        actualPrt: round2(actual.actualPrt),
        expectedInstallmentPrt,
        deltaAgainstInstallmentSchedule: round2(
          actual.actualPrt - expectedInstallmentPrt
        ),
        actualCash: round2(actual.actualCash),
        actualInsurance: round2(actual.actualInsurance),
        actualEstorno: round2(actual.actualEstorno),
        actualRenewal: round2(actual.actualRenewal),
        actualNet: round2(actual.actualNet),
        operations: actual.operations,
      };
    })
    .sort((left, right) => {
      if (left.companyCnpj !== right.companyCnpj) {
        return left.companyCnpj.localeCompare(right.companyCnpj);
      }
      return comparePeriods(left, right);
    });

  const severeHistoricalMonths = summaryRows
    .filter(
      (row) =>
        row.hasActualClosing &&
        row.expectedInstallmentPrt > 0 &&
        row.actualPrt + 0.01 < row.expectedInstallmentPrt
    )
    .sort((left, right) => {
      const deltaLeft = left.expectedInstallmentPrt - left.actualPrt;
      const deltaRight = right.expectedInstallmentPrt - right.actualPrt;
      return deltaRight - deltaLeft;
    });

  const projectedFutureMonths = summaryRows
    .filter(
      (row) =>
        !row.hasActualClosing &&
        row.expectedInstallmentPrt > 0
    )
    .sort(comparePeriods);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const summaryPath = path.join(OUTPUT_DIR, "prt-audit-summary.json");
  const gapsPath = path.join(OUTPUT_DIR, "prt-audit-gaps.json");
  const csvPath = path.join(OUTPUT_DIR, "prt-audit-summary.csv");

  await fs.writeFile(
    summaryPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        companiesAudited: companies.size,
        closingRows: closings.length,
        prtRows: prtEntries.length,
        debitRows: debitEntries.length,
        prtRowsWithoutOperationKey: entriesWithoutKey,
        severeMonthsCount: severeHistoricalMonths.length,
        severeMonths: severeHistoricalMonths.slice(0, 50),
        projectedFutureMonthsCount: projectedFutureMonths.length,
        projectedFutureMonths: projectedFutureMonths.slice(0, 50),
        summaryRows,
      },
      null,
      2
    )
  );

  await fs.writeFile(
    gapsPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scheduleRowsCount: scheduleRows.length,
        stopEventsCount: stopPeriodByOperation.size,
        scheduleRows,
      },
      null,
      2
    )
  );

  const csvLines = [
    [
      "company_cnpj",
      "period",
      "has_actual_closing",
      "actual_prt",
      "expected_installment_prt",
      "delta_against_installment_schedule",
      "actual_cash",
      "actual_insurance",
      "actual_estorno",
      "actual_renewal",
      "actual_net",
      "operations",
    ].join(";"),
    ...summaryRows.map((row) =>
      [
        row.companyCnpj,
        row.period,
        row.hasActualClosing ? "1" : "0",
        row.actualPrt,
        row.expectedInstallmentPrt,
        row.deltaAgainstInstallmentSchedule,
        row.actualCash,
        row.actualInsurance,
        row.actualEstorno,
        row.actualRenewal,
        row.actualNet,
        row.operations,
      ]
        .map(csvEscape)
        .join(";")
    ),
  ];

  await fs.writeFile(csvPath, csvLines.join("\n"));

  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        companiesAudited: companies.size,
        closingRows: closings.length,
        prtRows: prtEntries.length,
        debitRows: debitEntries.length,
        prtRowsWithoutOperationKey: entriesWithoutKey,
        severeMonthsCount: severeHistoricalMonths.length,
        severeMonths: severeHistoricalMonths.slice(0, 20),
        projectedFutureMonthsCount: projectedFutureMonths.length,
        files: {
          summaryPath,
          gapsPath,
          csvPath,
        },
      },
      null,
      2
    )
  );
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
