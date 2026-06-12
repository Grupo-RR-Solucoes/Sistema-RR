import fs from "node:fs/promises";
import path from "node:path";

import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

import { getCompanyDisplayIdentity } from "../lib/knownCompanies.ts";
import { resolvePromotivaCashAuditPolicy } from "../lib/promotivaCashPolicy.ts";

const OUTPUT_DIR = path.join(process.cwd(), "runtime", "outputs");
const PERCENT_TOLERANCE = 0.0006;
const MONEY_TOLERANCE = 0.05;

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function round4(value) {
  return Math.round(toNumber(value) * 10_000) / 10_000;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizeKey(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function getPeriodKey(year, month) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function comparePeriods(left, right) {
  if (left.year !== right.year) return left.year - right.year;
  return left.month - right.month;
}

function parsePeriod(value) {
  if (!value) return null;

  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
    };
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;

  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
  };
}

function loadMetadataNumber(metadata, aliases) {
  if (!metadata || typeof metadata !== "object") return 0;

  const entries = Object.entries(metadata);

  for (const alias of aliases) {
    const wanted = normalizeText(alias);
    const found = entries.find(([key]) => normalizeText(key) === wanted);
    if (found) {
      return toNumber(found[1]);
    }
  }

  return 0;
}

function loadMetadataText(metadata, aliases) {
  if (!metadata || typeof metadata !== "object") return "";

  const entries = Object.entries(metadata);

  for (const alias of aliases) {
    const wanted = normalizeText(alias);
    const found = entries.find(([key]) => normalizeText(key) === wanted);
    if (found && found[1] !== null && found[1] !== undefined && found[1] !== "") {
      return String(found[1]).trim();
    }
  }

  return "";
}

function extractOperationId(row) {
  const direct = normalizeKey(row.operation_number || row.contract_number);
  if (direct) return direct;

  return normalizeKey(
    loadMetadataText(row.metadata, [
      "NRO OPERACAO",
      "NUMERO OPERACAO",
      "OPERACAO",
      "CONTRATO",
      "NUMERO CONTRATO",
    ])
  );
}

function isAdjustmentRow(row) {
  const combined = normalizeText(
    [
      row.product_name,
      row.status,
      loadMetadataText(row.metadata, [
        "STATUS",
        "TIPO",
        "HISTORICO",
        "DESCRICAO",
        "DESCRICAO REPASSE",
        "PRODUTO",
      ]),
    ]
      .filter(Boolean)
      .join(" ")
  );

  return (
    combined.includes("ESTORNO") ||
    combined.includes("CANCEL") ||
    combined.includes("LIQUIDAC") ||
    combined.includes("RENOVA")
  );
}

function isIgnoredProduct(row) {
  const combined = normalizeText(
    [
      row.product_name,
      row.status,
      loadMetadataText(row.metadata, [
        "PRODUTO",
        "DESCRICAO",
        "HISTORICO",
        "TIPO",
      ]),
    ]
      .filter(Boolean)
      .join(" ")
  );

  return combined.includes("CONSORC") || combined.includes("BRASILCAP");
}

function readTotalInstallments(metadata) {
  return Math.max(
    0,
    Math.round(
      loadMetadataNumber(metadata, [
        "QTD PARCELAS TOTAL",
        "QTD PARCELAS TOTAIS",
        "PARCELAS TOTAL",
        "PARCELAS TOTAIS",
      ])
    )
  );
}

function readPaidInstallments(metadata) {
  return Math.max(
    0,
    Math.round(
      loadMetadataNumber(metadata, [
        "QTD PARCELAS PGS",
        "QTD PARCELAS PAGAS",
        "PARCELAS PAGAS",
      ])
    )
  );
}

function uniqueSortedNumbers(values) {
  return Array.from(
    new Set(
      values
        .map((value) => round4(value))
        .filter((value) => Number.isFinite(value) && value >= 0)
    )
  ).sort((left, right) => left - right);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "";
  return `${(value * 100).toFixed(2)}%`;
}

function formatPercentList(values) {
  return uniqueSortedNumbers(values).map(formatPercent).join(" | ");
}

function formatMoney(value) {
  return round2(value);
}

function getArgValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return fallback;
  }

  return process.argv[index + 1];
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllRest({ table, select, filters = [], pageSize = 250 }) {
  const rows = [];
  let from = 0;

  while (true) {
    const params = new URLSearchParams();
    params.set("select", select);

    for (const [key, value] of filters) {
      params.append(key, value);
    }

    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${params.toString()}`;
    let response;
    let attempt = 0;

    while (attempt < 4) {
      try {
        response = await fetch(url, {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            // D27: legacy=Bearer+apikey, sb_secret=apikey
            ...(process.env.SUPABASE_SERVICE_ROLE_KEY?.startsWith("sb_")
              ? {}
              : { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }),
            Range: `${from}-${from + pageSize - 1}`,
            Prefer: "count=exact",
          },
        });

        break;
      } catch (error) {
        attempt += 1;
        if (attempt >= 4) {
          throw error;
        }

        await sleep(500 * attempt);
      }
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erro ao buscar ${table}: ${response.status} ${body}`);
    }

    const data = await response.json();
    rows.push(...data);

    if (!Array.isArray(data) || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function excelColumnName(index) {
  let value = index;
  let output = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }

  return output;
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "");
          return /[",;\n]/.test(text)
            ? `"${text.replace(/"/g, '""')}"`
            : text;
        })
        .join(";")
    )
    .join("\n");
}

function buildPrtLookupRows(prtRows) {
  const groupedByOperationPeriod = new Map();

  for (const row of prtRows) {
    const operationId = extractOperationId(row);
    if (!operationId) continue;

    const companyCnpj = String(row.company_cnpj || "").trim();
    if (!companyCnpj) continue;

    const periodKey = getPeriodKey(row.year, row.month);
    const key = `${companyCnpj}::${operationId}::${periodKey}`;
    const current = groupedByOperationPeriod.get(key) || {
      companyCnpj,
      operationId,
      year: row.year,
      month: row.month,
      commissionValue: 0,
      metadata: row.metadata || {},
      productName: row.product_name || "",
    };

    current.commissionValue += toNumber(row.commission_value);
    current.productName = current.productName || row.product_name || "";
    current.metadata = current.metadata || row.metadata || {};
    if (!current.metadata || Object.keys(current.metadata).length === 0) {
      current.metadata = row.metadata || {};
    }

    groupedByOperationPeriod.set(key, current);
  }

  const byOperation = new Map();

  for (const entry of groupedByOperationPeriod.values()) {
    const key = `${entry.companyCnpj}::${entry.operationId}`;
    const bucket = byOperation.get(key) || [];
    bucket.push(entry);
    byOperation.set(key, bucket);
  }

  for (const bucket of byOperation.values()) {
    bucket.sort(comparePeriods);
  }

  return byOperation;
}

function compareMoney(actual, expected) {
  return actual - expected;
}

function comparePercent(actual, expected) {
  return actual - expected;
}

function classifyAgainstRange(value, minValue, maxValue, tolerance, labels) {
  if (!Number.isFinite(value)) {
    return labels.missing;
  }

  if (Number.isFinite(maxValue) && value > maxValue + tolerance) {
    return labels.above;
  }

  if (Number.isFinite(minValue) && value < minValue - tolerance) {
    return labels.below;
  }

  return labels.ok;
}

async function buildWorkbook({
  coverRows,
  monthlyRows,
  divergentRows,
  detailRows,
  pendingRows,
  outputPath,
}) {
  const workbook = Workbook.create();

  const coverSheet = workbook.worksheets.add("Resumo empresas");
  const monthlySheet = workbook.worksheets.add("Resumo mensal");
  const divergenceSheet = workbook.worksheets.add("Operacoes divergentes");
  const detailSheet = workbook.worksheets.add("Operacoes auditadas");
  const pendingSheet = workbook.worksheets.add("Pendencias");

  const coverHeaders = [
    "EMPRESA",
    "CNPJ",
    "COMPETENCIA INICIAL",
    "COMPETENCIA FINAL",
    "OPERACOES CASH",
    "OPERACOES AUDITORIA COMPLETA",
    "DIVERGENCIAS",
    "AVISTA ACIMA",
    "AVISTA ABAIXO",
    "PRT ACIMA",
    "PRT ABAIXO",
    "DIFERIDO ACIMA",
    "DIFERIDO ABAIXO",
  ];

  const coverMatrix = [
    ["Auditoria historica do a vista, diferido total e PRT mensal"],
    [
      "Criterio: o enquadramento do a vista segue a OPP/TRP vigente do mes. Quando a politica historica admite mais de uma faixa e nao ha dado suficiente de meta, o relatorio trata a regra como intervalo valido. O PRT mensal e o diferido total sao avaliados a partir da carteira observada por operacao.",
    ],
    [""],
    coverHeaders,
    ...coverRows.map((row) => [
      row.empresaNome,
      row.empresaCnpj,
      row.primeiraCompetencia,
      row.ultimaCompetencia,
      row.operacoesCash,
      row.operacoesAuditoriaCompleta,
      row.divergencias,
      row.avistaAcima,
      row.avistaAbaixo,
      row.prtAcima,
      row.prtAbaixo,
      row.diferidoAcima,
      row.diferidoAbaixo,
    ]),
  ];

  const monthlyHeaders = [
    "EMPRESA",
    "CNPJ",
    "COMPETENCIA",
    "PRODUCAO BASE MES",
    "POLITICA AVISTA MES",
    "OPERACOES CASH",
    "OPERACOES AUDITORIA COMPLETA",
    "OPERACOES DIVERGENTES",
    "AVISTA REAL",
    "EXCESSO AVISTA",
    "FALTA AVISTA",
    "DIFERIDO REAL",
    "EXCESSO DIFERIDO",
    "FALTA DIFERIDO",
    "PRT MENSAL REAL",
    "EXCESSO PRT",
    "FALTA PRT",
  ];

  const monthlyMatrix = [
    monthlyHeaders,
    ...monthlyRows.map((row) => [
      row.empresaNome,
      row.empresaCnpj,
      row.competencia,
      row.producaoBaseMes,
      row.politicaAvistaMes,
      row.operacoesCash,
      row.operacoesAuditoriaCompleta,
      row.operacoesDivergentes,
      row.avistaReal,
      row.excessoAvista,
      row.faltaAvista,
      row.diferidoReal,
      row.excessoDiferido,
      row.faltaDiferido,
      row.prtMensalReal,
      row.excessoPrt,
      row.faltaPrt,
    ]),
  ];

  const detailHeaders = [
    "EMPRESA",
    "CNPJ",
    "COMPETENCIA",
    "NRO OPERACAO",
    "CONTRATO",
    "CHAVE J",
    "PRODUTO",
    "STATUS LINHA",
    "VALOR LIQUIDO",
    "COMISSAO AVISTA REAL",
    "% AVISTA REAL",
    "POLITICA AVISTA MES",
    "% AVISTA MIN VALIDO",
    "% AVISTA MAX VALIDO",
    "COMISSAO AVISTA MIN VALIDA",
    "COMISSAO AVISTA MAX VALIDA",
    "COMISSAO TOTAL OBSERVADA",
    "% COMISSAO TOTAL OBSERVADA",
    "DIFERIDO TOTAL OBSERVADO",
    "DIFERIDO TOTAL MIN VALIDO",
    "DIFERIDO TOTAL MAX VALIDO",
    "PRT MENSAL OBSERVADO",
    "PRT MENSAL MIN VALIDO",
    "PRT MENSAL MAX VALIDO",
    "QTD PARCELAS TOTAL",
    "QTD PARCELAS PGS",
    "ORIGEM PRT",
    "STATUS AVISTA",
    "STATUS DIFERIDO",
    "STATUS PRT",
    "STATUS GERAL",
    "OBSERVACAO",
    "MCI",
    "COD LOJA",
    "AGENCIA BB",
    "DATA FINAL",
  ];

  const detailMatrix = [
    detailHeaders,
    ...detailRows.map((row) => [
      row.empresaNome,
      row.empresaCnpj,
      row.competencia,
      row.numeroOperacao,
      row.numeroContrato,
      row.chaveJ,
      row.produto,
      row.statusLinha,
      row.valorLiquido,
      row.comissaoAvistaReal,
      row.percentualAvistaReal,
      row.politicaAvistaMes,
      row.percentualAvistaMinValido,
      row.percentualAvistaMaxValido,
      row.comissaoAvistaMinValida,
      row.comissaoAvistaMaxValida,
      row.comissaoTotalObservada,
      row.percentualComissaoTotalObservada,
      row.diferidoTotalObservado,
      row.diferidoTotalMinValido,
      row.diferidoTotalMaxValido,
      row.prtMensalObservado,
      row.prtMensalMinValido,
      row.prtMensalMaxValido,
      row.qtdParcelasTotal,
      row.qtdParcelasPgs,
      row.origemPrt,
      row.statusAvista,
      row.statusDiferido,
      row.statusPrt,
      row.statusGeral,
      row.observacao,
      row.mci,
      row.codLoja,
      row.agenciaBb,
      row.dataFinal,
    ]),
  ];

  const pendingHeaders = [
    "EMPRESA",
    "CNPJ",
    "COMPETENCIA",
    "NRO OPERACAO",
    "CONTRATO",
    "PRODUTO",
    "VALOR LIQUIDO",
    "COMISSAO AVISTA REAL",
    "% AVISTA REAL",
    "POLITICA AVISTA MES",
    "PENDENCIA",
    "OBSERVACAO",
  ];

  const pendingMatrix = [
    pendingHeaders,
    ...pendingRows.map((row) => [
      row.empresaNome,
      row.empresaCnpj,
      row.competencia,
      row.numeroOperacao,
      row.numeroContrato,
      row.produto,
      row.valorLiquido,
      row.comissaoAvistaReal,
      row.percentualAvistaReal,
      row.politicaAvistaMes,
      row.statusGeral,
      row.observacao,
    ]),
  ];

  const divergenceMatrix = [
    detailHeaders,
    ...divergentRows.map((row) => [
      row.empresaNome,
      row.empresaCnpj,
      row.competencia,
      row.numeroOperacao,
      row.numeroContrato,
      row.chaveJ,
      row.produto,
      row.statusLinha,
      row.valorLiquido,
      row.comissaoAvistaReal,
      row.percentualAvistaReal,
      row.politicaAvistaMes,
      row.percentualAvistaMinValido,
      row.percentualAvistaMaxValido,
      row.comissaoAvistaMinValida,
      row.comissaoAvistaMaxValida,
      row.comissaoTotalObservada,
      row.percentualComissaoTotalObservada,
      row.diferidoTotalObservado,
      row.diferidoTotalMinValido,
      row.diferidoTotalMaxValido,
      row.prtMensalObservado,
      row.prtMensalMinValido,
      row.prtMensalMaxValido,
      row.qtdParcelasTotal,
      row.qtdParcelasPgs,
      row.origemPrt,
      row.statusAvista,
      row.statusDiferido,
      row.statusPrt,
      row.statusGeral,
      row.observacao,
      row.mci,
      row.codLoja,
      row.agenciaBb,
      row.dataFinal,
    ]),
  ];

  coverSheet.getRange(
    `A1:${excelColumnName(coverHeaders.length)}${coverMatrix.length}`
  ).values = coverMatrix;
  monthlySheet.getRange(
    `A1:${excelColumnName(monthlyHeaders.length)}${monthlyMatrix.length}`
  ).values = monthlyMatrix;
  divergenceSheet.getRange(
    `A1:${excelColumnName(detailHeaders.length)}${divergenceMatrix.length}`
  ).values = divergenceMatrix;
  detailSheet.getRange(
    `A1:${excelColumnName(detailHeaders.length)}${detailMatrix.length}`
  ).values = detailMatrix;
  pendingSheet.getRange(
    `A1:${excelColumnName(pendingHeaders.length)}${pendingMatrix.length}`
  ).values = pendingMatrix;

  await workbook.inspect({
    kind: "table",
    range: "Resumo empresas!A1:M20",
    include: "values",
    tableMaxRows: 20,
    tableMaxCols: 13,
  });

  await workbook.inspect({
    kind: "table",
    range: "Resumo mensal!A1:Q20",
    include: "values",
    tableMaxRows: 20,
    tableMaxCols: 17,
  });

  await workbook.render({
    sheetName: "Resumo empresas",
    range: "A1:M20",
    scale: 1.2,
  });

  await workbook.render({
    sheetName: "Resumo mensal",
    range: "A1:Q20",
    scale: 1.1,
  });

  const exported = await SpreadsheetFile.exportXlsx(workbook);
  await exported.save(outputPath);
}

async function main() {
  const yearFrom = Number(getArgValue("--yearFrom", "2022"));
  const monthFrom = Number(getArgValue("--monthFrom", "12"));
  const yearTo = Number(getArgValue("--yearTo", "2026"));
  const monthTo = Number(getArgValue("--monthTo", "3"));

  await loadEnv(path.join(process.cwd(), ".env.local"));
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const closings = await fetchAllRest({
    table: "fechamento_mensal_empresa",
    select: "empresa_cnpj,ano,mes",
    filters: [
      ["ano", `gte.${yearFrom}`],
      ["ano", `lte.${yearTo}`],
    ],
  });

  const companyCnpjs = Array.from(
    new Set(
      closings
        .map((row) => String(row.empresa_cnpj || "").trim())
        .filter(Boolean)
    )
  ).sort();

  const entries = [];
  for (const companyCnpj of companyCnpjs) {
    for (let year = yearFrom; year <= yearTo; year += 1) {
      const filters = [
        ["company_cnpj", `eq.${companyCnpj}`],
        ["year", `eq.${year}`],
        ["entry_type", "in.(CASH,PRT)"],
      ];

      if (year === yearFrom) {
        filters.push(["month", `gte.${monthFrom}`]);
      }

      if (year === yearTo) {
        filters.push(["month", `lte.${monthTo}`]);
      }

      const chunk = await fetchAllRest({
        table: "monthly_closing_entries",
        select:
          "company_cnpj,year,month,operation_number,contract_number,j_key,product_name,status,gross_value,net_value,insurance_value,commission_value,operation_date,metadata,entry_type",
        filters,
      });

      entries.push(...chunk);
    }
  }

  const filteredEntries = entries.filter((row) => {
    const period = { year: Number(row.year), month: Number(row.month) };
    if (comparePeriods(period, { year: yearFrom, month: monthFrom }) < 0) return false;
    if (comparePeriods(period, { year: yearTo, month: monthTo }) > 0) return false;
    return true;
  });

  const cashRows = filteredEntries.filter(
    (row) =>
      row.entry_type === "CASH" &&
      toNumber(row.commission_value) > 0 &&
      toNumber(row.net_value) > 0 &&
      !isAdjustmentRow(row) &&
      !isIgnoredProduct(row)
  );

  const prtRows = filteredEntries.filter(
    (row) =>
      row.entry_type === "PRT" &&
      toNumber(row.commission_value) > 0 &&
      !isAdjustmentRow(row) &&
      !isIgnoredProduct(row)
  );

  const companyProductionByPeriod = new Map();
  for (const row of cashRows) {
    const key = `${row.company_cnpj}::${getPeriodKey(row.year, row.month)}`;
    companyProductionByPeriod.set(
      key,
      round2((companyProductionByPeriod.get(key) || 0) + toNumber(row.net_value))
    );
  }

  const prtLookup = buildPrtLookupRows(prtRows);

  const detailRows = [];

  for (const row of cashRows) {
    const companyIdentity = getCompanyDisplayIdentity({
      cnpj: row.company_cnpj,
    });
    const competencia = getPeriodKey(row.year, row.month);
    const companyPeriodKey = `${row.company_cnpj}::${competencia}`;
    const productionValue = toNumber(companyProductionByPeriod.get(companyPeriodKey));
    const operationId = extractOperationId(row);
    const prtTimeline = prtLookup.get(`${row.company_cnpj}::${operationId}`) || [];
    const firstPrt = prtTimeline.find(
      (candidate) =>
        comparePeriods(candidate, { year: row.year, month: row.month }) >= 0
    );

    const baseValue = toNumber(row.net_value);
    const cashAmount = toNumber(row.commission_value);
    const actualCashPercent = baseValue > 0 ? cashAmount / baseValue : 0;
    const totalInstallments = firstPrt ? readTotalInstallments(firstPrt.metadata) : 0;
    const paidInstallments = firstPrt ? readPaidInstallments(firstPrt.metadata) : 0;
    const prtMonthlyObserved = firstPrt ? toNumber(firstPrt.commissionValue) : 0;
    const deferredTotalObserved =
      totalInstallments > 0 ? prtMonthlyObserved * totalInstallments : 0;
    const totalCommissionObserved =
      totalInstallments > 0 ? cashAmount + deferredTotalObserved : 0;
    const totalPercentObserved =
      totalInstallments > 0 && baseValue > 0
        ? totalCommissionObserved / baseValue
        : null;

    const policy = resolvePromotivaCashAuditPolicy({
      productionValue,
      reference_date: `${row.year}-${String(row.month).padStart(2, "0")}-01`,
    });

    const rawAllowedPercents = uniqueSortedNumbers(
      policy.allowedPercents.length ? policy.allowedPercents : [policy.selectedPercent]
    );

    const validCashPercents =
      totalPercentObserved && totalPercentObserved > 0
        ? uniqueSortedNumbers(
            rawAllowedPercents.map((percent) =>
              Math.min(percent, totalPercentObserved)
            )
          )
        : [];

    const validCashAmounts = validCashPercents.map((percent) => baseValue * percent);
    const validDeferredTotals =
      totalPercentObserved && totalInstallments > 0
        ? validCashAmounts.map(
            (amount) => Math.max(totalCommissionObserved - amount, 0)
          )
        : [];
    const validPrtMonthly =
      totalInstallments > 0
        ? validDeferredTotals.map((value) => value / totalInstallments)
        : [];

    const minValidCashPercent =
      validCashPercents.length > 0 ? validCashPercents[0] : null;
    const maxValidCashPercent =
      validCashPercents.length > 0
        ? validCashPercents[validCashPercents.length - 1]
        : rawAllowedPercents.length > 0
          ? rawAllowedPercents[rawAllowedPercents.length - 1]
          : null;

    const minValidCashAmount =
      validCashAmounts.length > 0 ? Math.min(...validCashAmounts) : null;
    const maxValidCashAmount =
      validCashAmounts.length > 0 ? Math.max(...validCashAmounts) : null;
    const minValidDeferredTotal =
      validDeferredTotals.length > 0 ? Math.min(...validDeferredTotals) : null;
    const maxValidDeferredTotal =
      validDeferredTotals.length > 0 ? Math.max(...validDeferredTotals) : null;
    const minValidPrtMonthly =
      validPrtMonthly.length > 0 ? Math.min(...validPrtMonthly) : null;
    const maxValidPrtMonthly =
      validPrtMonthly.length > 0 ? Math.max(...validPrtMonthly) : null;

    const avistaStatus =
      totalPercentObserved && totalPercentObserved > 0
        ? classifyAgainstRange(
            actualCashPercent,
            minValidCashPercent,
            maxValidCashPercent,
            PERCENT_TOLERANCE,
            {
              ok: "ENQUADRADO",
              above: "ACIMA_DA_FAIXA",
              below: "ABAIXO_DA_FAIXA",
              missing: "SEM_BASE",
            }
          )
        : maxValidCashPercent !== null &&
            actualCashPercent > maxValidCashPercent + PERCENT_TOLERANCE
          ? "ACIMA_DO_TETO"
          : "DENTRO_DO_TETO_SEM_PRT";

    const diferidoStatus =
      totalInstallments > 0
        ? classifyAgainstRange(
            deferredTotalObserved,
            minValidDeferredTotal,
            maxValidDeferredTotal,
            MONEY_TOLERANCE,
            {
              ok: "ENQUADRADO",
              above: "ACIMA_DA_FAIXA",
              below: "ABAIXO_DA_FAIXA",
              missing: "SEM_BASE",
            }
          )
        : "SEM_PRT_OBSERVADO";

    const prtStatus =
      totalInstallments > 0
        ? classifyAgainstRange(
            prtMonthlyObserved,
            minValidPrtMonthly,
            maxValidPrtMonthly,
            MONEY_TOLERANCE,
            {
              ok: "ENQUADRADO",
              above: "ACIMA_DA_FAIXA",
              below: "ABAIXO_DA_FAIXA",
              missing: "SEM_BASE",
            }
          )
        : "SEM_PRT_OBSERVADO";

    const overallStatus =
      avistaStatus === "ENQUADRADO" &&
      (diferidoStatus === "ENQUADRADO" || diferidoStatus === "SEM_PRT_OBSERVADO") &&
      (prtStatus === "ENQUADRADO" || prtStatus === "SEM_PRT_OBSERVADO")
        ? totalInstallments > 0
          ? "ENQUADRADO"
          : "PARCIAL_SEM_PRT"
        : totalInstallments > 0
          ? "DIVERGENTE"
          : "PENDENTE_SEM_PRT";

    const overCash = maxValidCashAmount !== null ? Math.max(cashAmount - maxValidCashAmount, 0) : 0;
    const underCash = minValidCashAmount !== null ? Math.max(minValidCashAmount - cashAmount, 0) : 0;
    const overDeferred =
      maxValidDeferredTotal !== null
        ? Math.max(deferredTotalObserved - maxValidDeferredTotal, 0)
        : 0;
    const underDeferred =
      minValidDeferredTotal !== null
        ? Math.max(minValidDeferredTotal - deferredTotalObserved, 0)
        : 0;
    const overPrt =
      maxValidPrtMonthly !== null
        ? Math.max(prtMonthlyObserved - maxValidPrtMonthly, 0)
        : 0;
    const underPrt =
      minValidPrtMonthly !== null
        ? Math.max(minValidPrtMonthly - prtMonthlyObserved, 0)
        : 0;

    const observacaoParts = [];
    if (policy.isAmbiguous) {
      observacaoParts.push(
        `Mes com faixas validas de a vista: ${formatPercentList(rawAllowedPercents)}.`
      );
    } else {
      observacaoParts.push(
        `Faixa vigente de a vista no mes: ${formatPercentList(rawAllowedPercents)}.`
      );
    }

    if (totalInstallments <= 0) {
      observacaoParts.push(
        "Nao foi localizada parcela PRT suficiente para reconstruir o diferido total observado."
      );
    } else {
      observacaoParts.push(
        `PRT observado em ${firstPrt ? getPeriodKey(firstPrt.year, firstPrt.month) : ""} com ${totalInstallments} parcelas totais.`
      );
    }

    const detail = {
      empresaNome: companyIdentity.empresaNome,
      empresaCnpj: companyIdentity.empresaCnpj,
      competencia,
      numeroOperacao: operationId,
      numeroContrato: String(row.contract_number || ""),
      chaveJ:
        String(
          row.j_key ||
            loadMetadataText(row.metadata, [
              "CHAVE J",
              "LOGIN",
              "LOGIN DO AGENTE DE CREDITO",
            ])
        ).trim(),
      produto: String(row.product_name || ""),
      statusLinha: String(row.status || ""),
      valorLiquido: formatMoney(baseValue),
      comissaoAvistaReal: formatMoney(cashAmount),
      percentualAvistaReal: round4(actualCashPercent),
      politicaAvistaMes: formatPercentList(rawAllowedPercents),
      percentualAvistaMinValido:
        minValidCashPercent !== null ? round4(minValidCashPercent) : "",
      percentualAvistaMaxValido:
        maxValidCashPercent !== null ? round4(maxValidCashPercent) : "",
      comissaoAvistaMinValida:
        minValidCashAmount !== null ? formatMoney(minValidCashAmount) : "",
      comissaoAvistaMaxValida:
        maxValidCashAmount !== null ? formatMoney(maxValidCashAmount) : "",
      comissaoTotalObservada:
        totalInstallments > 0 ? formatMoney(totalCommissionObserved) : "",
      percentualComissaoTotalObservada:
        totalPercentObserved !== null ? round4(totalPercentObserved) : "",
      diferidoTotalObservado:
        totalInstallments > 0 ? formatMoney(deferredTotalObserved) : "",
      diferidoTotalMinValido:
        minValidDeferredTotal !== null ? formatMoney(minValidDeferredTotal) : "",
      diferidoTotalMaxValido:
        maxValidDeferredTotal !== null ? formatMoney(maxValidDeferredTotal) : "",
      prtMensalObservado:
        totalInstallments > 0 ? formatMoney(prtMonthlyObserved) : "",
      prtMensalMinValido:
        minValidPrtMonthly !== null ? formatMoney(minValidPrtMonthly) : "",
      prtMensalMaxValido:
        maxValidPrtMonthly !== null ? formatMoney(maxValidPrtMonthly) : "",
      qtdParcelasTotal: totalInstallments,
      qtdParcelasPgs: paidInstallments,
      origemPrt: firstPrt ? getPeriodKey(firstPrt.year, firstPrt.month) : "",
      statusAvista: avistaStatus,
      statusDiferido: diferidoStatus,
      statusPrt: prtStatus,
      statusGeral: overallStatus,
      observacao: observacaoParts.join(" "),
      mci: loadMetadataText(row.metadata, ["MCI"]),
      codLoja: loadMetadataText(row.metadata, ["COD LOJA", "CODIGO LOJA"]),
      agenciaBb: loadMetadataText(row.metadata, [
        "AGENCIA BB",
        "PREFIXO AG. RESPONSAVEL",
        "PREFIXO AG. RESPONSAVEL ",
        "AGENCIA",
      ]),
      dataFinal: firstPrt
        ? loadMetadataText(firstPrt.metadata, ["DATA FINAL", "DATA_FINAL"])
        : "",
      producaoBaseMes: formatMoney(productionValue),
      excessoAvista: formatMoney(overCash),
      faltaAvista: formatMoney(underCash),
      excessoDiferido: formatMoney(overDeferred),
      faltaDiferido: formatMoney(underDeferred),
      excessoPrt: formatMoney(overPrt),
      faltaPrt: formatMoney(underPrt),
    };

    detailRows.push(detail);
  }

  detailRows.sort((left, right) => {
    if (left.empresaNome !== right.empresaNome) {
      return left.empresaNome.localeCompare(right.empresaNome);
    }

    if (left.competencia !== right.competencia) {
      return left.competencia.localeCompare(right.competencia);
    }

    return String(left.numeroOperacao).localeCompare(String(right.numeroOperacao));
  });

  const monthlyMap = new Map();
  const companyMap = new Map();
  const divergentRows = [];
  const pendingRows = [];

  for (const row of detailRows) {
    const monthlyKey = `${row.empresaCnpj}::${row.competencia}`;
    const monthly = monthlyMap.get(monthlyKey) || {
      empresaNome: row.empresaNome,
      empresaCnpj: row.empresaCnpj,
      competencia: row.competencia,
      producaoBaseMes: row.producaoBaseMes,
      politicaAvistaMes: row.politicaAvistaMes,
      operacoesCash: 0,
      operacoesAuditoriaCompleta: 0,
      operacoesDivergentes: 0,
      avistaReal: 0,
      excessoAvista: 0,
      faltaAvista: 0,
      diferidoReal: 0,
      excessoDiferido: 0,
      faltaDiferido: 0,
      prtMensalReal: 0,
      excessoPrt: 0,
      faltaPrt: 0,
    };

    monthly.operacoesCash += 1;
    if (row.statusGeral !== "PENDENTE_SEM_PRT" && row.statusGeral !== "PARCIAL_SEM_PRT") {
      monthly.operacoesAuditoriaCompleta += 1;
    }
    if (row.statusGeral === "DIVERGENTE") {
      monthly.operacoesDivergentes += 1;
      divergentRows.push(row);
    }

    if (row.statusGeral === "PENDENTE_SEM_PRT" || row.statusGeral === "PARCIAL_SEM_PRT") {
      pendingRows.push(row);
    }

    monthly.avistaReal += toNumber(row.comissaoAvistaReal);
    monthly.excessoAvista += toNumber(row.excessoAvista);
    monthly.faltaAvista += toNumber(row.faltaAvista);
    monthly.diferidoReal += toNumber(row.diferidoTotalObservado);
    monthly.excessoDiferido += toNumber(row.excessoDiferido);
    monthly.faltaDiferido += toNumber(row.faltaDiferido);
    monthly.prtMensalReal += toNumber(row.prtMensalObservado);
    monthly.excessoPrt += toNumber(row.excessoPrt);
    monthly.faltaPrt += toNumber(row.faltaPrt);
    monthlyMap.set(monthlyKey, monthly);

    const company = companyMap.get(row.empresaCnpj) || {
      empresaNome: row.empresaNome,
      empresaCnpj: row.empresaCnpj,
      primeiraCompetencia: row.competencia,
      ultimaCompetencia: row.competencia,
      operacoesCash: 0,
      operacoesAuditoriaCompleta: 0,
      divergencias: 0,
      avistaAcima: 0,
      avistaAbaixo: 0,
      prtAcima: 0,
      prtAbaixo: 0,
      diferidoAcima: 0,
      diferidoAbaixo: 0,
    };

    company.primeiraCompetencia =
      company.primeiraCompetencia.localeCompare(row.competencia) <= 0
        ? company.primeiraCompetencia
        : row.competencia;
    company.ultimaCompetencia =
      company.ultimaCompetencia.localeCompare(row.competencia) >= 0
        ? company.ultimaCompetencia
        : row.competencia;
    company.operacoesCash += 1;
    if (row.statusGeral !== "PENDENTE_SEM_PRT" && row.statusGeral !== "PARCIAL_SEM_PRT") {
      company.operacoesAuditoriaCompleta += 1;
    }
    if (row.statusGeral === "DIVERGENTE") company.divergencias += 1;
    if (row.statusAvista === "ACIMA_DA_FAIXA" || row.statusAvista === "ACIMA_DO_TETO") {
      company.avistaAcima += 1;
    }
    if (row.statusAvista === "ABAIXO_DA_FAIXA") {
      company.avistaAbaixo += 1;
    }
    if (row.statusPrt === "ACIMA_DA_FAIXA") company.prtAcima += 1;
    if (row.statusPrt === "ABAIXO_DA_FAIXA") company.prtAbaixo += 1;
    if (row.statusDiferido === "ACIMA_DA_FAIXA") company.diferidoAcima += 1;
    if (row.statusDiferido === "ABAIXO_DA_FAIXA") company.diferidoAbaixo += 1;
    companyMap.set(row.empresaCnpj, company);
  }

  const monthlyRows = Array.from(monthlyMap.values())
    .map((row) => ({
      ...row,
      avistaReal: formatMoney(row.avistaReal),
      excessoAvista: formatMoney(row.excessoAvista),
      faltaAvista: formatMoney(row.faltaAvista),
      diferidoReal: formatMoney(row.diferidoReal),
      excessoDiferido: formatMoney(row.excessoDiferido),
      faltaDiferido: formatMoney(row.faltaDiferido),
      prtMensalReal: formatMoney(row.prtMensalReal),
      excessoPrt: formatMoney(row.excessoPrt),
      faltaPrt: formatMoney(row.faltaPrt),
    }))
    .sort((left, right) => {
      if (left.empresaNome !== right.empresaNome) {
        return left.empresaNome.localeCompare(right.empresaNome);
      }

      return left.competencia.localeCompare(right.competencia);
    });

  const coverRows = Array.from(companyMap.values()).sort((left, right) =>
    left.empresaNome.localeCompare(right.empresaNome)
  );

  const meta = {
    generatedAt: new Date().toISOString(),
    yearFrom,
    monthFrom,
    yearTo,
    monthTo,
    operationsCash: detailRows.length,
    operationsDivergent: divergentRows.length,
    operationsPending: pendingRows.length,
  };

  const jsonPath = path.join(
    OUTPUT_DIR,
    `auditoria-historica-avista-prt-${yearFrom}-${String(monthFrom).padStart(2, "0")}-${yearTo}-${String(monthTo).padStart(2, "0")}.json`
  );
  const csvPath = path.join(
    OUTPUT_DIR,
    `auditoria-historica-avista-prt-${yearFrom}-${String(monthFrom).padStart(2, "0")}-${yearTo}-${String(monthTo).padStart(2, "0")}.csv`
  );
  const workbookPath = path.join(
    OUTPUT_DIR,
    `auditoria-historica-avista-prt-${yearFrom}-${String(monthFrom).padStart(2, "0")}-${yearTo}-${String(monthTo).padStart(2, "0")}.xlsx`
  );

  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        meta,
        coverRows,
        monthlyRows,
        divergentRows,
        pendingRows,
        detailRows,
      },
      null,
      2
    ),
    "utf8"
  );

  await fs.writeFile(
    csvPath,
    toCsv([
      [
        "EMPRESA",
        "CNPJ",
        "COMPETENCIA",
        "NRO OPERACAO",
        "CONTRATO",
        "PRODUTO",
        "VALOR LIQUIDO",
        "COMISSAO AVISTA REAL",
        "PERCENTUAL AVISTA REAL",
        "POLITICA AVISTA MES",
        "STATUS AVISTA",
        "STATUS DIFERIDO",
        "STATUS PRT",
        "STATUS GERAL",
        "OBSERVACAO",
      ],
      ...detailRows.map((row) => [
        row.empresaNome,
        row.empresaCnpj,
        row.competencia,
        row.numeroOperacao,
        row.numeroContrato,
        row.produto,
        row.valorLiquido,
        row.comissaoAvistaReal,
        row.percentualAvistaReal,
        row.politicaAvistaMes,
        row.statusAvista,
        row.statusDiferido,
        row.statusPrt,
        row.statusGeral,
        row.observacao,
      ]),
    ]),
    "utf8"
  );

  await buildWorkbook({
    coverRows,
    monthlyRows,
    divergentRows,
    detailRows,
    pendingRows,
    outputPath: workbookPath,
  });

  process.stdout.write(
    JSON.stringify(
      {
        meta,
        files: {
          jsonPath,
          csvPath,
          workbookPath,
        },
        companies: coverRows.length,
        monthlyRows: monthlyRows.length,
        divergentRows: divergentRows.length,
        pendingRows: pendingRows.length,
        operationsCash: detailRows.length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
