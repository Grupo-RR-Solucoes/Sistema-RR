import fs from "node:fs/promises";
import path from "node:path";

import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

import { calcularOperacao } from "../lib/motor.ts";
import { getCompanyDisplayIdentity } from "../lib/knownCompanies.ts";
import { resolvePromotivaCashPolicy } from "../lib/promotivaCashPolicy.ts";

const OUTPUT_DIR = path.join(process.cwd(), "runtime", "outputs");

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function getArgValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return fallback;
  }

  return process.argv[index + 1];
}

function getPeriodKey(year, month) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function getPeriodLabel(year, month) {
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

function extractYearMonth(value) {
  if (!value) return null;

  const text = String(value);
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

function readRawPayloadValue(payload, aliases) {
  if (!payload || typeof payload !== "object") return null;

  const wanted = aliases.map((alias) => normalizeText(alias));

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === "") continue;
    if (wanted.includes(normalizeText(key))) {
      return value;
    }
  }

  return null;
}

function isProductionStatus(status) {
  const normalized = normalizeText(status);
  return normalized === "PRODUCAO" || normalized === "PRODUCTION";
}

function getRecordPeriod(record) {
  return (
    extractYearMonth(record.movement_date) ||
    extractYearMonth(record.contract_date) ||
    extractYearMonth(record.proposal_date)
  );
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

async function fetchAllRest({ table, select, filters = [], pageSize = 1000 }) {
  const rows = [];
  let from = 0;

  while (true) {
    const params = new URLSearchParams();
    params.set("select", select);

    for (const [key, value] of filters) {
      params.append(key, value);
    }

    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${params.toString()}`;
    const response = await fetch(url, {
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

async function buildWorkbook({ meta, summaryRows, detailRows, outputPath }) {
  const workbook = Workbook.create();

  const summarySheet = workbook.worksheets.add("Resumo por empresa");
  const detailSheet = workbook.worksheets.add("Propostas auditadas");

  const summaryMatrix = [
    ["Auditoria de a vista, diferido total e PRT mensal por proposta"],
    [
      `Competencia analisada: ${meta.periodLabel}. Base: propostas com status Producao. Quando a diaria informa % a vista, esse valor prevalece; quando nao informa, o sistema aplica a OPP/TRP vigente ou a tabela anterior mais proxima.`,
    ],
    [""],
    [
      "Empresa",
      "CNPJ",
      "Propostas",
      "Base liquida",
      "Comissao total prevista",
      "A vista previsto",
      "Diferido total previsto",
      "PRT mensal previsto",
      "Com % da proposta",
      "Com fallback da tabela",
      "Sem regra de credito",
    ],
    ...summaryRows.map((row) => [
      row.empresaNome,
      row.empresaCnpj,
      row.propostas,
      row.baseLiquida,
      row.comissaoTotalPrevista,
      row.avistaPrevisto,
      row.diferidoTotalPrevisto,
      row.prtMensalPrevisto,
      row.comPercentualDaProposta,
      row.comFallbackTabela,
      row.semRegraCredito,
    ]),
  ];

  const detailHeaders = [
    "EMPRESA",
    "CNPJ",
    "PROMOTOR",
    "CHAVE_J",
    "NUMERO_PROPOSTA",
    "NUMERO_CONTRATO",
    "DATA_MOVIMENTO",
    "PRODUTO",
    "STATUS",
    "TAXA_JUROS",
    "PRAZO",
    "VALOR_LIQUIDO",
    "VALOR_BRUTO",
    "VALOR_SEGURO",
    "PERCENTUAL_TOTAL",
    "COMISSAO_TOTAL_PREVISTA",
    "PERCENTUAL_AVISTA_PROPOSTA",
    "PERCENTUAL_AVISTA_APLICADO",
    "FONTE_PERCENTUAL_AVISTA",
    "OBSERVACAO_PERCENTUAL_AVISTA",
    "AVISTA_PREVISTO",
    "DIFERIDO_TOTAL_PREVISTO",
    "PRT_MENSAL_PREVISTO",
    "REGRA_CREDITO",
    "FAIXA_PRODUCAO",
    "SITUACAO_CALCULO",
    "AGENCIA_BB",
    "MCI",
    "COBAN",
  ];

  const detailMatrix = [
    detailHeaders,
    ...detailRows.map((row) => [
      row.empresaNome,
      row.empresaCnpj,
      row.promotorNome,
      row.chaveJ,
      row.numeroProposta,
      row.numeroContrato,
      row.dataMovimento,
      row.produto,
      row.status,
      row.taxaJuros,
      row.prazo,
      row.valorLiquido,
      row.valorBruto,
      row.valorSeguro,
      row.percentualTotal,
      row.comissaoTotalPrevista,
      row.percentualAvistaProposta,
      row.percentualAvistaAplicado,
      row.fontePercentualAvista,
      row.observacaoPercentualAvista,
      row.avistaPrevisto,
      row.diferidoTotalPrevisto,
      row.prtMensalPrevisto,
      row.regraCredito,
      row.faixaProducao,
      row.situacaoCalculo,
      row.agenciaBb,
      row.mci,
      row.coban,
    ]),
  ];

  summarySheet.getRange(
    `A1:${excelColumnName(summaryMatrix[3].length)}${summaryMatrix.length}`
  ).values = summaryMatrix;
  detailSheet.getRange(
    `A1:${excelColumnName(detailHeaders.length)}${detailMatrix.length}`
  ).values = detailMatrix;

  await workbook.inspect({
    kind: "table",
    range: "Resumo por empresa!A1:K20",
    include: "values",
    tableMaxRows: 20,
    tableMaxCols: 12,
  });

  await workbook.inspect({
    kind: "table",
    range: "Propostas auditadas!A1:AC20",
    include: "values",
    tableMaxRows: 20,
    tableMaxCols: 30,
  });

  await workbook.render({
    sheetName: "Resumo por empresa",
    range: "A1:K20",
    scale: 1.4,
  });

  await workbook.render({
    sheetName: "Propostas auditadas",
    range: "A1:AC20",
    scale: 1.1,
  });

  const exported = await SpreadsheetFile.exportXlsx(workbook);
  await exported.save(outputPath);
}

async function main() {
  const year = Number(getArgValue("--year", "2026"));
  const month = Number(getArgValue("--month", "4"));

  if (!year || !month || month < 1 || month > 12) {
    throw new Error("Informe --year e --month validos.");
  }

  await loadEnv(path.join(process.cwd(), ".env.local"));
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const [companies, promoters, records] = await Promise.all([
    fetchAllRest({
      table: "companies",
      select: "id,name,cnpj",
    }),
    fetchAllRest({
      table: "promoters",
      select: "id,name",
    }),
    fetchAllRest({
      table: "daily_production_records",
      select:
        "id,company_id,assigned_promoter_id,j_key,proposal_number,contract_number,product_code,product_description,status,movement_date,contract_date,proposal_date,net_value,gross_value,insurance_value,insurance_type,has_insurance,interest_rate,term_months,installments,company_received_percent,convenio_code,convenio_type,convenio_segment,raw_payload",
    }),
  ]);

  const companyById = new Map(companies.map((row) => [row.id, row]));
  const promoterById = new Map(promoters.map((row) => [row.id, row]));

  const recordsForPeriod = records.filter((record) => {
    const period = getRecordPeriod(record);
    return period && period.year === year && period.month === month;
  });

  const validRecords = recordsForPeriod.filter(
    (record) =>
      isProductionStatus(record.status) &&
      toNumber(record.net_value) > 0
  );

  const companyProductionMap = new Map();
  for (const record of validRecords) {
    const companyId = record.company_id || "";
    companyProductionMap.set(
      companyId,
      toNumber(companyProductionMap.get(companyId)) + toNumber(record.net_value)
    );
  }

  const detailRows = validRecords
    .map((record) => {
      const company = companyById.get(record.company_id || "");
      const companyIdentity = getCompanyDisplayIdentity({
        cnpj: company?.cnpj,
        name: company?.name,
      });
      const promoter = promoterById.get(record.assigned_promoter_id || "");
      const productionValue = toNumber(companyProductionMap.get(record.company_id || ""));
      const policy = resolvePromotivaCashPolicy({
        companyCashPercent: record.company_received_percent,
        productionValue,
        movement_date: record.movement_date,
        contract_date: record.contract_date,
        proposal_date: record.proposal_date,
      });
      const result = calcularOperacao({
        valor_liquido: toNumber(record.net_value),
        valor_bruto: toNumber(record.gross_value),
        valor_seguro: toNumber(record.insurance_value),
        taxa_juros: toNumber(record.interest_rate),
        prazo: Math.max(
          Math.round(toNumber(record.term_months)),
          Math.round(toNumber(record.installments))
        ),
        tem_seguro:
          toNumber(record.insurance_value) > 0 || Boolean(record.has_insurance),
        product_code: record.product_code,
        product_description: record.product_description,
        convenio_code: record.convenio_code,
        convenio_type: record.convenio_type,
        convenio_segment: record.convenio_segment,
        insurance_type: record.insurance_type,
        company_cash_percent: record.company_received_percent,
        production_value: productionValue,
        movement_date: record.movement_date,
        contract_date: record.contract_date,
        proposal_date: record.proposal_date,
      });

      const rawProposalPercent = toNumber(record.company_received_percent);
      const explicitProposalPercent =
        rawProposalPercent > 0 ? (rawProposalPercent > 1 ? rawProposalPercent : rawProposalPercent * 100) : 0;
      const effectivePercent = round2(result.credito.percentual_avista_empresa * 100);
      const mci =
        String(
          readRawPayloadValue(record.raw_payload, ["MCI", "Mci"]) || ""
        ).trim();
      const coban =
        String(
          readRawPayloadValue(record.raw_payload, ["COD COBAN", "Codigo Coban", "Coban"]) || ""
        ).trim();
      const agenciaBb =
        String(
          readRawPayloadValue(record.raw_payload, [
            "Prefixo Ag. Responsavel",
            "Prefixo Ag. Responsável",
            "Agencia",
            "Agência",
          ]) || ""
        ).trim();
      const situacaoCalculo =
        toNumber(result.credito.total) > 0
          ? "REGRA_ENCONTRADA"
          : "SEM_REGRA_DE_CREDITO";

      return {
        empresaNome: companyIdentity.empresaNome,
        empresaCnpj: companyIdentity.empresaCnpj,
        promotorNome: promoter?.name || "",
        chaveJ: String(record.j_key || ""),
        numeroProposta: String(record.proposal_number || ""),
        numeroContrato: String(record.contract_number || record.proposal_number || ""),
        dataMovimento: String(
          record.movement_date || record.contract_date || record.proposal_date || ""
        ),
        produto: String(record.product_description || ""),
        status: String(record.status || ""),
        taxaJuros: round2(toNumber(record.interest_rate)),
        prazo: Math.max(
          Math.round(toNumber(record.term_months)),
          Math.round(toNumber(record.installments))
        ),
        valorLiquido: round2(toNumber(record.net_value)),
        valorBruto: round2(toNumber(record.gross_value)),
        valorSeguro: round2(toNumber(record.insurance_value)),
        percentualTotal: round2(toNumber(result.credito.percentual) * 100),
        comissaoTotalPrevista: round2(toNumber(result.credito.total)),
        percentualAvistaProposta: round2(explicitProposalPercent),
        percentualAvistaAplicado: effectivePercent,
        fontePercentualAvista:
          policy.source === "proposal" ? "PROPOSTA_DIARIA" : "TABELA_VIGENTE",
        observacaoPercentualAvista: policy.note,
        avistaPrevisto: round2(toNumber(result.credito.avista_empresa)),
        diferidoTotalPrevisto: round2(toNumber(result.credito.diferido)),
        prtMensalPrevisto: round2(toNumber(result.diferido.valorParcela)),
        regraCredito: String(result.credito.regra || ""),
        faixaProducao: String(result.credito.faixa_producao || ""),
        situacaoCalculo,
        agenciaBb,
        mci,
        coban,
      };
    })
    .sort((a, b) => {
      if (a.empresaNome !== b.empresaNome) return a.empresaNome.localeCompare(b.empresaNome);
      if (a.promotorNome !== b.promotorNome) return a.promotorNome.localeCompare(b.promotorNome);
      return a.numeroContrato.localeCompare(b.numeroContrato);
    });

  const summaryMap = new Map();
  for (const row of detailRows) {
    const key = `${row.empresaCnpj}::${row.empresaNome}`;
    const current = summaryMap.get(key) || {
      empresaNome: row.empresaNome,
      empresaCnpj: row.empresaCnpj,
      propostas: 0,
      baseLiquida: 0,
      comissaoTotalPrevista: 0,
      avistaPrevisto: 0,
      diferidoTotalPrevisto: 0,
      prtMensalPrevisto: 0,
      comPercentualDaProposta: 0,
      comFallbackTabela: 0,
      semRegraCredito: 0,
    };

    current.propostas += 1;
    current.baseLiquida += row.valorLiquido;
    current.comissaoTotalPrevista += row.comissaoTotalPrevista;
    current.avistaPrevisto += row.avistaPrevisto;
    current.diferidoTotalPrevisto += row.diferidoTotalPrevisto;
    current.prtMensalPrevisto += row.prtMensalPrevisto;

    if (row.fontePercentualAvista === "PROPOSTA_DIARIA") {
      current.comPercentualDaProposta += 1;
    } else {
      current.comFallbackTabela += 1;
    }

    if (row.situacaoCalculo === "SEM_REGRA_DE_CREDITO") {
      current.semRegraCredito += 1;
    }

    summaryMap.set(key, current);
  }

  const summaryRows = Array.from(summaryMap.values())
    .map((row) => ({
      ...row,
      baseLiquida: round2(row.baseLiquida),
      comissaoTotalPrevista: round2(row.comissaoTotalPrevista),
      avistaPrevisto: round2(row.avistaPrevisto),
      diferidoTotalPrevisto: round2(row.diferidoTotalPrevisto),
      prtMensalPrevisto: round2(row.prtMensalPrevisto),
    }))
    .sort((a, b) => a.empresaNome.localeCompare(b.empresaNome));

  const totals = summaryRows.reduce(
    (acc, row) => {
      acc.propostas += row.propostas;
      acc.baseLiquida += row.baseLiquida;
      acc.comissaoTotalPrevista += row.comissaoTotalPrevista;
      acc.avistaPrevisto += row.avistaPrevisto;
      acc.diferidoTotalPrevisto += row.diferidoTotalPrevisto;
      acc.prtMensalPrevisto += row.prtMensalPrevisto;
      acc.comPercentualDaProposta += row.comPercentualDaProposta;
      acc.comFallbackTabela += row.comFallbackTabela;
      acc.semRegraCredito += row.semRegraCredito;
      return acc;
    },
    {
      propostas: 0,
      baseLiquida: 0,
      comissaoTotalPrevista: 0,
      avistaPrevisto: 0,
      diferidoTotalPrevisto: 0,
      prtMensalPrevisto: 0,
      comPercentualDaProposta: 0,
      comFallbackTabela: 0,
      semRegraCredito: 0,
    }
  );

  summaryRows.push({
    empresaNome: "TOTAL",
    empresaCnpj: "",
    propostas: totals.propostas,
    baseLiquida: round2(totals.baseLiquida),
    comissaoTotalPrevista: round2(totals.comissaoTotalPrevista),
    avistaPrevisto: round2(totals.avistaPrevisto),
    diferidoTotalPrevisto: round2(totals.diferidoTotalPrevisto),
    prtMensalPrevisto: round2(totals.prtMensalPrevisto),
    comPercentualDaProposta: totals.comPercentualDaProposta,
    comFallbackTabela: totals.comFallbackTabela,
    semRegraCredito: totals.semRegraCredito,
  });

  const periodKey = getPeriodKey(year, month);
  const periodLabel = getPeriodLabel(year, month);
  const baseName = `auditoria-propostas-${periodKey}`;
  const jsonPath = path.join(OUTPUT_DIR, `${baseName}.json`);
  const csvPath = path.join(OUTPUT_DIR, `${baseName}.csv`);
  const workbookPath = path.join(OUTPUT_DIR, `${baseName}.xlsx`);

  const payload = {
    meta: {
      year,
      month,
      periodKey,
      periodLabel,
      proposals: detailRows.length,
      generatedAt: new Date().toISOString(),
    },
    summaryRows,
    detailRows,
  };

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(
    csvPath,
    toCsv([
      [
        "EMPRESA",
        "CNPJ",
        "PROMOTOR",
        "CHAVE_J",
        "NUMERO_PROPOSTA",
        "NUMERO_CONTRATO",
        "DATA_MOVIMENTO",
        "PRODUTO",
        "STATUS",
        "TAXA_JUROS",
        "PRAZO",
        "VALOR_LIQUIDO",
        "VALOR_BRUTO",
        "VALOR_SEGURO",
        "PERCENTUAL_TOTAL",
        "COMISSAO_TOTAL_PREVISTA",
        "PERCENTUAL_AVISTA_PROPOSTA",
        "PERCENTUAL_AVISTA_APLICADO",
        "FONTE_PERCENTUAL_AVISTA",
        "OBSERVACAO_PERCENTUAL_AVISTA",
        "AVISTA_PREVISTO",
        "DIFERIDO_TOTAL_PREVISTO",
        "PRT_MENSAL_PREVISTO",
        "REGRA_CREDITO",
        "FAIXA_PRODUCAO",
        "SITUACAO_CALCULO",
        "AGENCIA_BB",
        "MCI",
        "COBAN",
      ],
      ...detailRows.map((row) => [
        row.empresaNome,
        row.empresaCnpj,
        row.promotorNome,
        row.chaveJ,
        row.numeroProposta,
        row.numeroContrato,
        row.dataMovimento,
        row.produto,
        row.status,
        row.taxaJuros,
        row.prazo,
        row.valorLiquido,
        row.valorBruto,
        row.valorSeguro,
        row.percentualTotal,
        row.comissaoTotalPrevista,
        row.percentualAvistaProposta,
        row.percentualAvistaAplicado,
        row.fontePercentualAvista,
        row.observacaoPercentualAvista,
        row.avistaPrevisto,
        row.diferidoTotalPrevisto,
        row.prtMensalPrevisto,
        row.regraCredito,
        row.faixaProducao,
        row.situacaoCalculo,
        row.agenciaBb,
        row.mci,
        row.coban,
      ]),
    ]),
    "utf8"
  );

  await buildWorkbook({
    meta: payload.meta,
    summaryRows,
    detailRows,
    outputPath: workbookPath,
  });

  process.stdout.write(
    JSON.stringify(
      {
        periodKey,
        periodLabel,
        proposals: detailRows.length,
        summaryRows: summaryRows.length,
        jsonPath,
        csvPath,
        workbookPath,
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
