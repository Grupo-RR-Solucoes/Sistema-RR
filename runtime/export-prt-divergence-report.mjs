import fs from "node:fs/promises";
import path from "node:path";

import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const OUTPUT_DIR = path.join(process.cwd(), "runtime", "outputs");

const KNOWN_COMPANIES = [
  {
    empresaNome: "RR SOLUCOES LTDA",
    empresaCnpj: "48357275000103",
    mci: "847822962",
    coban: "98250",
  },
  {
    empresaNome: "RR SOLUCOES AL LTDA",
    empresaCnpj: "56140658000153",
    mci: "873386662",
    coban: "18309",
  },
  {
    empresaNome: "RR AL SOLUCOES LTDA",
    empresaCnpj: "55867409000100",
    mci: "873298328",
    coban: "20466",
  },
  {
    empresaNome: "RR SOLUCOES PE LTDA",
    empresaCnpj: "51457289000103",
    mci: "850169280",
    coban: "14692",
  },
];

function onlyNumbers(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function normalizeKey(value) {
  return String(value ?? "").trim().toUpperCase();
}

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function getPeriodKey(year, month) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function comparePeriods(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function addMonths(year, month, monthsToAdd) {
  const date = new Date(Date.UTC(year, month - 1 + monthsToAdd, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function parseTempIdentifiers(reference) {
  const raw = String(reference ?? "").trim();
  const match = raw.match(/TEMP-(\d+)-(\d+)/i);
  return {
    mci: match?.[1] || "",
    coban: match?.[2] || "",
  };
}

function getCompanyIdentity(reference) {
  const raw = String(reference ?? "").trim();
  const digits = onlyNumbers(raw);
  const temp = parseTempIdentifiers(raw);

  return (
    KNOWN_COMPANIES.find((item) => item.empresaCnpj === digits) ||
    KNOWN_COMPANIES.find((item) => item.mci === temp.mci) ||
    KNOWN_COMPANIES.find((item) => item.coban === temp.coban) || {
      empresaNome: raw || "Empresa sem nome",
      empresaCnpj: digits || raw,
      mci: temp.mci || "",
      coban: temp.coban || "",
    }
  );
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

function getMetadataValue(metadata, aliases) {
  if (!metadata) return "";

  for (const alias of aliases) {
    const wanted = normalizeKey(alias);
    const found = Object.entries(metadata).find(
      ([key]) => normalizeKey(key) === wanted
    );
    if (found && found[1] !== undefined && found[1] !== null && found[1] !== "") {
      return String(found[1]).trim();
    }
  }

  return "";
}

function extractOperationIdFromAdjustment(row) {
  const direct = String(row.operation_number || row.contract_number || "").trim();
  if (direct) return direct;

  const metadata = row.metadata || {};
  const combined = [
    metadata["DESCRIÃ‡ÃƒO"],
    metadata["DESCRICAO"],
    metadata["HISTÃ“RICO"],
    metadata["HISTORICO"],
    metadata["PRODUTO"],
    metadata["TIPO"],
  ]
    .filter(Boolean)
    .join(" ");

  const match = String(combined).match(/\b\d{6,}\b/);
  return String(match?.[0] || "").trim();
}

function detectStatus(expectedAmount, actualAmount) {
  if (actualAmount <= 0.01) return "NAO PAGO";
  if (actualAmount + 0.01 < expectedAmount) return "PAGO PARCIAL";
  return "OK";
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
    if (!process.env[key]) process.env[key] = value;
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
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
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

async function buildWorkbook({ summaryRows, detailRows, outputPath }) {
  const workbook = Workbook.create();

  const summarySheet = workbook.worksheets.add("Resumo mensal");
  const detailSheet = workbook.worksheets.add("Operacoes divergentes");

  const summaryMatrix = [
    ["Relatorio de divergencias PRT por operacao"],
    [
      "Regra usada: PRT parcelado em valores iguais pelo prazo do contrato, interrompido por pagamento observado posterior ou debito de liquidacao/cancelamento/renovacao.",
    ],
    [""],
    [
      "Empresa",
      "CNPJ",
      "Competencia",
      "PRT recebido",
      "PRT esperado parcelado",
      "Diferenca",
      "Operacoes divergentes",
    ],
    ...summaryRows.map((row) => [
      row.empresaNome,
      row.empresaCnpj,
      row.competencia,
      row.actualPrt,
      row.expectedPrt,
      row.diferenca,
      row.operacoesDivergentes,
    ]),
  ];

  const detailHeaders = [
    "EMPRESA",
    "CNPJ",
    "COMPETENCIA",
    "STATUS DIVERGENCIA",
    "MCI",
    "RAZAO SOCIAL",
    "COD LOJA",
    "AGENCIA BB",
    "NRO OPERACAO",
    "CHAVE J",
    "VALOR FINANCIADO",
    "COMISSAO PARCELA",
    "COMISSAO RECEBIDA MES",
    "DIFERENCA",
    "DATA FINAL",
    "QTD PARCELAS PGS",
    "QTD PARCELAS TOTAL",
    "PARCELA ESPERADA NRO",
    "COD OPS",
    "COD EST",
    "MES ORIGEM PRT",
    "PROXIMO PRT OBSERVADO",
    "MES CORTE DEBITO",
    "PRODUTO",
    "STATUS LINHA",
  ];

  const detailMatrix = [
    detailHeaders,
    ...detailRows.map((row) => [
      row.empresaNome,
      row.empresaCnpj,
      row.competencia,
      row.statusDivergencia,
      row.mci,
      row.razaoSocial,
      row.codLoja,
      row.agenciaBb,
      row.nroOperacao,
      row.chaveJ,
      row.valorFinanciado,
      row.comissaoParcela,
      row.comissaoRecebidaMes,
      row.diferenca,
      row.dataFinal,
      row.qtdParcelasPgs,
      row.qtdParcelasTotal,
      row.parcelaEsperadaNro,
      row.codOps,
      row.codEst,
      row.mesOrigemPrt,
      row.proximoPrtObservado,
      row.mesCorteDebito,
      row.produto,
      row.statusLinha,
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
    range: `Resumo mensal!A1:G20`,
    include: "values",
    tableMaxRows: 20,
    tableMaxCols: 8,
  });

  await workbook.inspect({
    kind: "table",
    range: `Operacoes divergentes!A1:Y20`,
    include: "values",
    tableMaxRows: 20,
    tableMaxCols: 25,
  });

  await workbook.render({
    sheetName: "Resumo mensal",
    range: "A1:G20",
    scale: 1.5,
  });

  await workbook.render({
    sheetName: "Operacoes divergentes",
    range: "A1:Y20",
    scale: 1.2,
  });

  const exported = await SpreadsheetFile.exportXlsx(workbook);
  await exported.save(outputPath);
}

async function main() {
  await loadEnv(path.join(process.cwd(), ".env.local"));
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const closings = await fetchAllRest({
    table: "fechamento_mensal_empresa",
    select:
      "empresa_cnpj,ano,mes,valor_avista,valor_diferido,valor_seguro,valor_estorno,valor_renovacao,valor_liquido,operacoes",
  });

  const companyRefs = Array.from(
    new Set(
      closings.map((row) => String(row.empresa_cnpj || "").trim()).filter(Boolean)
    )
  );

  const inFilter = `(${companyRefs.join(",")})`;

  const [prtEntries, debitEntries] = await Promise.all([
    fetchAllRest({
      table: "monthly_closing_entries",
      select:
        "company_cnpj,year,month,operation_number,contract_number,j_key,product_name,status,gross_value,net_value,insurance_value,commission_value,operation_date,cancellation_date,metadata",
      filters: [
        ["company_cnpj", `in.${inFilter}`],
        ["entry_type", "eq.PRT"],
        ["commission_value", "gt.0"],
      ],
    }),
    fetchAllRest({
      table: "monthly_closing_entries",
      select:
        "company_cnpj,year,month,operation_number,contract_number,metadata",
      filters: [
        ["company_cnpj", `in.${inFilter}`],
        ["entry_type", "eq.DEBIT"],
      ],
    }),
  ]);

  const actualClosingPeriods = new Set();
  const actualByCompanyPeriod = new Map();

  for (const row of closings) {
    const rawRef = String(row.empresa_cnpj || "").trim();
    const identity = getCompanyIdentity(rawRef);
    const periodKey = getPeriodKey(row.ano, row.mes);
    const key = `${rawRef}::${periodKey}`;
    actualClosingPeriods.add(key);
    actualByCompanyPeriod.set(key, {
      actualPrt: round2(row.valor_diferido),
    });
    if (identity.empresaCnpj) {
      actualByCompanyPeriod.set(`${identity.empresaCnpj}::${periodKey}`, {
        actualPrt: round2(row.valor_diferido),
      });
    }
  }

  const actualByOperationPeriod = new Map();
  const timelineByOperation = new Map();

  for (const row of prtEntries) {
    const companyRef = String(row.company_cnpj || "").trim();
    const operationId = String(row.operation_number || row.contract_number || "").trim();
    if (!companyRef || !operationId) continue;

    const periodKey = getPeriodKey(row.year, row.month);
    const operationPeriodKey = `${companyRef}::${operationId}::${periodKey}`;
    const currentActual = actualByOperationPeriod.get(operationPeriodKey) || 0;
    actualByOperationPeriod.set(
      operationPeriodKey,
      round2(currentActual + toNumber(row.commission_value))
    );

    const operationKey = `${companyRef}::${operationId}`;
    const bucket = timelineByOperation.get(operationKey) || new Map();
    const current = bucket.get(periodKey) || {
      companyRef,
      operationId,
      year: row.year,
      month: row.month,
      amount: 0,
      jKey: row.j_key || "",
      productName: row.product_name || "",
      status: row.status || "",
      grossValue: toNumber(row.gross_value),
      metadata: row.metadata || {},
    };

    current.amount = round2(current.amount + toNumber(row.commission_value));
    current.metadata = row.metadata || current.metadata || {};
    current.jKey = current.jKey || row.j_key || "";
    current.productName = current.productName || row.product_name || "";
    current.status = current.status || row.status || "";
    current.grossValue = current.grossValue || toNumber(row.gross_value);
    bucket.set(periodKey, current);
    timelineByOperation.set(operationKey, bucket);
  }

  const stopPeriodByOperation = new Map();
  for (const row of debitEntries) {
    const companyRef = String(row.company_cnpj || "").trim();
    const operationId = extractOperationIdFromAdjustment(row);
    if (!companyRef || !operationId) continue;

    const key = `${companyRef}::${operationId}`;
    const current = stopPeriodByOperation.get(key);
    const next = { year: row.year, month: row.month };
    if (!current || comparePeriods(next, current) < 0) {
      stopPeriodByOperation.set(key, next);
    }
  }

  const detailRows = [];

  for (const [operationKey, bucket] of timelineByOperation.entries()) {
    const timeline = Array.from(bucket.values()).sort(comparePeriods);

    for (let index = 0; index < timeline.length; index += 1) {
      const current = timeline[index];
      const next = timeline[index + 1];
      const companyIdentity = getCompanyIdentity(current.companyRef);
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
      const stopPeriod = stopPeriodByOperation.get(operationKey);

      for (let offset = 1; offset <= remainingInstallments; offset += 1) {
        const due = addMonths(current.year, current.month, offset);

        if (
          next &&
          comparePeriods(due, { year: next.year, month: next.month }) >= 0
        ) {
          break;
        }

        if (
          stopPeriod &&
          comparePeriods(due, { year: stopPeriod.year, month: stopPeriod.month }) >= 0
        ) {
          break;
        }

        const companyPeriodKey = `${current.companyRef}::${getPeriodKey(
          due.year,
          due.month
        )}`;
        if (!actualClosingPeriods.has(companyPeriodKey)) {
          continue;
        }

        const actualAmount = round2(
          actualByOperationPeriod.get(
            `${current.companyRef}::${current.operationId}::${getPeriodKey(
              due.year,
              due.month
            )}`
          ) || 0
        );
        const expectedAmount = round2(current.amount);
        if (actualAmount + 0.01 >= expectedAmount) {
          continue;
        }

        const razaoSocial =
          getMetadataValue(current.metadata, ["RAZAO SOCIAL", "RAZÃO SOCIAL"]) ||
          companyIdentity.empresaNome;
        const statusLinha =
          current.status || getMetadataValue(current.metadata, ["STATUS"]);

        detailRows.push({
          empresaNome: companyIdentity.empresaNome,
          empresaCnpj: companyIdentity.empresaCnpj,
          competencia: getPeriodKey(due.year, due.month),
          statusDivergencia: detectStatus(expectedAmount, actualAmount),
          mci:
            getMetadataValue(current.metadata, ["MCI"]) || companyIdentity.mci || "",
          razaoSocial,
          codLoja: getMetadataValue(current.metadata, ["COD LOJA", "CODIGO LOJA"]),
          agenciaBb: getMetadataValue(current.metadata, ["AGENCIA BB", "AGENCIA"]),
          nroOperacao: current.operationId,
          chaveJ:
            current.jKey ||
            getMetadataValue(current.metadata, [
              "CHAVE J",
              "LOGIN DO AGENTE DE CREDITO",
              "LOGIN",
            ]),
          valorFinanciado: round2(
            current.grossValue ||
              getMetadataNumber(current.metadata, ["VALOR FINANCIADO", "VALOR BRUTO"])
          ),
          comissaoParcela: expectedAmount,
          comissaoRecebidaMes: actualAmount,
          diferenca: round2(expectedAmount - actualAmount),
          dataFinal: getMetadataValue(current.metadata, ["DATA FINAL"]),
          qtdParcelasPgs: paidInstallments,
          qtdParcelasTotal: totalInstallments,
          parcelaEsperadaNro: paidInstallments + offset,
          codOps: getMetadataValue(current.metadata, ["COD OPS", "CODIGO OPS"]),
          codEst: getMetadataValue(current.metadata, ["COD EST", "CODIGO EST"]),
          mesOrigemPrt: getPeriodKey(current.year, current.month),
          proximoPrtObservado: next ? getPeriodKey(next.year, next.month) : "",
          mesCorteDebito: stopPeriod
            ? getPeriodKey(stopPeriod.year, stopPeriod.month)
            : "",
          produto:
            current.productName ||
            getMetadataValue(current.metadata, ["PRODUTO", "DESCRICAO", "HISTORICO"]),
          statusLinha,
        });
      }
    }
  }

  detailRows.sort((a, b) => {
    if (b.diferenca !== a.diferenca) return b.diferenca - a.diferenca;
    if (a.empresaCnpj !== b.empresaCnpj) {
      return a.empresaCnpj.localeCompare(b.empresaCnpj);
    }
    if (a.competencia !== b.competencia) {
      return a.competencia.localeCompare(b.competencia);
    }
    return a.nroOperacao.localeCompare(b.nroOperacao);
  });

  const summaryMap = new Map();
  for (const row of detailRows) {
    const key = `${row.empresaCnpj}::${row.competencia}`;
    const current = summaryMap.get(key) || {
      empresaNome: row.empresaNome,
      empresaCnpj: row.empresaCnpj,
      competencia: row.competencia,
      actualPrt: round2(
        actualByCompanyPeriod.get(`${row.empresaCnpj}::${row.competencia}`)?.actualPrt || 0
      ),
      expectedPrt: 0,
      diferenca: 0,
      operacoesDivergentes: 0,
    };
    current.expectedPrt = round2(current.expectedPrt + row.comissaoParcela);
    current.diferenca = round2(current.diferenca + row.diferenca);
    current.operacoesDivergentes += 1;
    summaryMap.set(key, current);
  }

  const summaryRows = Array.from(summaryMap.values()).sort((a, b) => {
    if (b.diferenca !== a.diferenca) return b.diferenca - a.diferenca;
    return a.competencia.localeCompare(b.competencia);
  });

  const jsonPath = path.join(OUTPUT_DIR, "prt-divergencias-detalhado.json");
  const csvPath = path.join(OUTPUT_DIR, "prt-divergencias-detalhado.csv");
  const workbookPath = path.join(OUTPUT_DIR, "prt-divergencias-detalhado.xlsx");

  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summaryRows,
        detailRows,
      },
      null,
      2
    )
  );

  await fs.writeFile(
    csvPath,
    toCsv([
      [
        "EMPRESA",
        "CNPJ",
        "COMPETENCIA",
        "STATUS DIVERGENCIA",
        "MCI",
        "RAZAO SOCIAL",
        "COD LOJA",
        "AGENCIA BB",
        "NRO OPERACAO",
        "CHAVE J",
        "VALOR FINANCIADO",
        "COMISSAO PARCELA",
        "COMISSAO RECEBIDA MES",
        "DIFERENCA",
        "DATA FINAL",
        "QTD PARCELAS PGS",
        "QTD PARCELAS TOTAL",
        "PARCELA ESPERADA NRO",
        "COD OPS",
        "COD EST",
        "MES ORIGEM PRT",
        "PROXIMO PRT OBSERVADO",
        "MES CORTE DEBITO",
        "PRODUTO",
        "STATUS LINHA",
      ],
      ...detailRows.map((row) => [
        row.empresaNome,
        row.empresaCnpj,
        row.competencia,
        row.statusDivergencia,
        row.mci,
        row.razaoSocial,
        row.codLoja,
        row.agenciaBb,
        row.nroOperacao,
        row.chaveJ,
        row.valorFinanciado,
        row.comissaoParcela,
        row.comissaoRecebidaMes,
        row.diferenca,
        row.dataFinal,
        row.qtdParcelasPgs,
        row.qtdParcelasTotal,
        row.parcelaEsperadaNro,
        row.codOps,
        row.codEst,
        row.mesOrigemPrt,
        row.proximoPrtObservado,
        row.mesCorteDebito,
        row.produto,
        row.statusLinha,
      ]),
    ])
  );

  if (process.env.GENERATE_WORKBOOK === "1") {
    await buildWorkbook({
      summaryRows,
      detailRows,
      outputPath: workbookPath,
    });
  }

  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summaryRows: summaryRows.length,
        detailRows: detailRows.length,
        files: {
          workbookPath:
            process.env.GENERATE_WORKBOOK === "1" ? workbookPath : "",
          csvPath,
          jsonPath,
        },
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
