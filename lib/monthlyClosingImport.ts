import * as XLSX from "xlsx";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type CompanyRow = {
  id: string;
  name: string;
  cnpj: string;
};

type EntryType = "CASH" | "PRT" | "INSURANCE" | "CREDIT" | "DEBIT";

type Entry = {
  companyId?: string | null;
  companyCnpj: string;
  year: number;
  month: number;
  sheetName: string;
  entryType: EntryType;
  operationNumber?: string | null;
  contractNumber?: string | null;
  jKey?: string | null;
  productName?: string | null;
  status?: string | null;
  grossValue: number;
  netValue: number;
  insuranceValue: number;
  commissionValue: number;
  operationDate?: string | null;
  cancellationDate?: string | null;
  metadata: Record<string, unknown>;
};

type ClosingTotals = {
  valor_avista: number;
  valor_diferido: number;
  valor_seguro: number;
  valor_estorno: number;
  valor_renovacao: number;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = String(value).trim().replace(/\s/g, "").replace("R$", "");

  let normalized = raw;

  if (raw.includes(",") && raw.includes(".")) {
    normalized =
      raw.lastIndexOf(",") > raw.lastIndexOf(".")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "");
  } else if (raw.includes(",")) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  }

  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: unknown) {
  if (!value) return null;

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;

    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  const text = String(value).trim();

  if (/^\d{2}[./]\d{2}[./]\d{4}$/.test(text)) {
    const [day, month, year] = text.replace(/\./g, "/").split("/");
    return `${year}-${month}-${day}`;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function getActualSheetRange(sheet: XLSX.WorkSheet) {
  let minRow = Number.POSITIVE_INFINITY;
  let minColumn = Number.POSITIVE_INFINITY;
  let maxRow = 0;
  let maxColumn = 0;

  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) {
      continue;
    }

    const cell = XLSX.utils.decode_cell(address);
    minRow = Math.min(minRow, cell.r);
    minColumn = Math.min(minColumn, cell.c);
    maxRow = Math.max(maxRow, cell.r);
    maxColumn = Math.max(maxColumn, cell.c);
  }

  if (!Number.isFinite(minRow) || !Number.isFinite(minColumn)) {
    return sheet["!ref"];
  }

  return XLSX.utils.encode_range({
    s: { r: minRow, c: minColumn },
    e: { r: maxRow, c: maxColumn },
  });
}

function sheetToRows<T>(
  sheet: XLSX.WorkSheet,
  options: XLSX.Sheet2JSONOpts = {}
) {
  return XLSX.utils.sheet_to_json<T>(sheet, {
    ...options,
    range: getActualSheetRange(sheet),
  });
}

function pickField(row: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(row);

  for (const alias of aliases) {
    const wanted = normalizeText(alias);
    const found = entries.find(([key]) => normalizeText(key) === wanted);

    if (found && found[1] !== undefined && found[1] !== null && found[1] !== "") {
      return found[1];
    }
  }

  return null;
}

function inferSheetType(sheetName: string): EntryType | "OTHER" {
  const normalized = normalizeText(sheetName);

  if (normalized.includes("A VISTA") || normalized.includes("AVISTA")) return "CASH";
  if (normalized.includes("SEGURO")) return "INSURANCE";
  if (normalized.includes("DEBIT")) return "DEBIT";
  if (normalized.includes("PRT") || normalized.includes("DIFERID")) return "PRT";
  if (normalized.includes("CREDITO")) return "CREDIT";

  return "OTHER";
}

function isAdjustmentRow(sheetType: EntryType, row: Record<string, unknown>) {
  const combined = normalizeText(
    [
      pickField(row, ["Status"]),
      pickField(row, ["Tipo"]),
      pickField(row, ["Historico"]),
      pickField(row, ["Descricao"]),
      pickField(row, ["Descricao Repasse"]),
      pickField(row, ["Produto"]),
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (sheetType === "DEBIT") return true;
  if (combined.includes("ESTORNO")) return true;
  if (combined.includes("CANCEL")) return true;
  if (combined.includes("LIQUIDAC")) return true;
  if (combined.includes("RENOVA")) return true;

  return false;
}

function isInsurancePrtRow(row: Record<string, unknown>) {
  const combined = normalizeText(
    [
      pickField(row, ["Status"]),
      pickField(row, ["Tipo"]),
      pickField(row, ["Historico"]),
      pickField(row, ["Descricao"]),
      pickField(row, ["Produto"]),
    ]
      .filter(Boolean)
      .join(" ")
  );

  return combined.includes("ESTOQUE PRT") || combined.includes("PRT ESTOQUE");
}

function isPayablePrtRow(row: Record<string, unknown>) {
  const codEst = pickField(row, ["COD EST", "Cod Est", "Codigo Est", "Codigo EST"]);

  if (codEst === null || codEst === undefined || codEst === "") {
    return true;
  }

  return parseNumber(codEst) === 1;
}

function readResumoAmount(row: unknown[], labelIndex: number) {
  return (
    parseNumber(row[labelIndex + 2]) ||
    parseNumber(row[labelIndex + 1]) ||
    parseNumber(row[labelIndex + 3])
  );
}

function readResumoTotals(workbook: XLSX.WorkBook): ClosingTotals | null {
  const resumoSheetName = workbook.SheetNames.find(
    (sheetName) => normalizeText(sheetName) === "RESUMO"
  );

  if (!resumoSheetName) {
    return null;
  }

  const rows = sheetToRows<unknown[]>(workbook.Sheets[resumoSheetName], {
    header: 1,
    defval: "",
  });

  const values = new Map<string, number>();

  for (const row of rows) {
    row.forEach((cell, index) => {
      const label = normalizeText(cell);

      if (!label) {
        return;
      }

      if (
        [
          "COMISSAO A VISTA",
          "COMISSAO SEGUROS",
          "COMISSAO PRT",
          "CANCELAMENTO SEGURO",
          "PRT ESTOQUE SEGURO",
          "CREDITO",
          "DEBITO",
        ].includes(label)
      ) {
        values.set(label, readResumoAmount(row, index));
      }
    });
  }

  const valorAvista =
    (values.get("COMISSAO A VISTA") || 0) + (values.get("CREDITO") || 0);
  const valorDiferido = values.get("COMISSAO PRT") || 0;
  const valorSeguro =
    (values.get("COMISSAO SEGUROS") || 0) + (values.get("PRT ESTOQUE SEGURO") || 0);
  const valorEstorno = values.get("CANCELAMENTO SEGURO") || 0;
  const valorRenovacao = values.get("DEBITO") || 0;

  if (
    !valorAvista &&
    !valorDiferido &&
    !valorSeguro &&
    !valorEstorno &&
    !valorRenovacao
  ) {
    return null;
  }

  return {
    valor_avista: valorAvista,
    valor_diferido: valorDiferido,
    valor_seguro: valorSeguro,
    valor_estorno: valorEstorno,
    valor_renovacao: valorRenovacao,
  };
}

function inferCompanyFromFileName(fileName: string, companies: CompanyRow[]) {
  const digits = String(fileName || "").replace(/\D/g, "");

  return (
    companies.find((company) => digits.includes(company.cnpj.replace(/\D/g, ""))) || null
  );
}

function resolveCompany({
  companyId,
  fileName,
  companies,
}: {
  companyId?: string | null;
  fileName?: string;
  companies: CompanyRow[];
}) {
  if (companyId) {
    return companies.find((company) => company.id === companyId) || null;
  }

  return inferCompanyFromFileName(fileName || "", companies);
}

function buildBaseEntry(
  row: Record<string, unknown>,
  options: {
    company: CompanyRow | null;
    year: number;
    month: number;
    sheetName: string;
    entryType: EntryType;
    commissionValue: number;
  }
): Entry | null {
  const grossValue = parseNumber(
    pickField(row, [
      "Valor Bruto",
      "Valor Financiado",
      "Producao",
      "Valor Operacao",
      "Valor Comissao Bruta",
    ])
  );

  const netValue = parseNumber(
    pickField(row, [
      "Valor Liquido",
      "Valor Recebido",
      "Liquido",
      "Base",
      "Valor",
      "Valor Comissao",
    ])
  );

  const insuranceValue = parseNumber(
    pickField(row, ["Valor Seguro", "Seguro", "Seguros", "VALOR_SEGURO"])
  );

  const primaryValue = options.commissionValue;

  if (!primaryValue) {
    return null;
  }

  return {
    companyId: options.company?.id || null,
    companyCnpj: options.company?.cnpj || "",
    year: options.year,
    month: options.month,
    sheetName: options.sheetName,
    entryType: options.entryType,
    operationNumber:
      String(
        pickField(row, [
          "Numero Operacao",
          "Numero Operacao ",
          "Operacao",
          "Nro Operacao",
          "OPERACAO",
          "NRO OPERACAO",
        ]) || ""
      ).trim() || null,
    contractNumber:
      String(
        pickField(row, ["Contrato", "Numero Contrato", "Numero Seguro"]) || ""
      ).trim() || null,
    jKey:
      String(
        pickField(row, ["Chave J", "Login", "Usuario", "Promotor", "Login do Agente de Credito"]) ||
          ""
      ).trim() || null,
    productName:
      String(
        pickField(row, [
          "Produto",
          "Descricao",
          "Historico",
          "Nome do Produto",
          "Descricao do Produto",
        ]) || ""
      ).trim() || null,
    status:
      String(
        pickField(row, [
          "Status",
          "Tipo",
          "Historico",
          "Status Comissao PF",
          "Status Contrato",
        ]) || ""
      ).trim() || null,
    grossValue,
    netValue,
    insuranceValue,
    commissionValue: primaryValue,
    operationDate: parseDate(
      pickField(row, [
        "Data",
        "Data Operacao",
        "Data Referencia",
        "Data Contratacao",
        "Data Operacacao",
        "Data Venda",
      ])
    ),
    cancellationDate: parseDate(
      pickField(row, ["Data Cancelamento", "Data Estorno", "Data Debito"])
    ),
    metadata: row,
  };
}

function buildEntriesForRow(
  row: Record<string, unknown>,
  options: {
    company: CompanyRow | null;
    year: number;
    month: number;
    sheetName: string;
    sheetType: EntryType;
  }
) {
  if (options.sheetType === "CASH") {
    const cashCommission = parseNumber(
      pickField(row, [
        "Comissao PF",
        "Comissao PF ",
        "COMISSAO PF",
        "Comissao",
        "COMISSAO",
      ])
    );
    const insuranceCommission = parseNumber(
      pickField(row, ["Comissao Seguro", "COMISSAO SEGURO"])
    );

    return [
      buildBaseEntry(row, {
        ...options,
        entryType: "CASH",
        commissionValue: cashCommission,
      }),
      buildBaseEntry(row, {
        ...options,
        entryType: "INSURANCE",
        commissionValue: insuranceCommission,
      }),
    ].filter(Boolean) as Entry[];
  }

  if (options.sheetType === "PRT") {
    const commissionValue = parseNumber(pickField(row, ["Comissao", "Valor"]));

    return [
      buildBaseEntry(row, {
        ...options,
        entryType: "PRT",
        commissionValue,
      }),
    ].filter(Boolean) as Entry[];
  }

  if (options.sheetType === "INSURANCE") {
    const commissionValue = parseNumber(pickField(row, ["Comissao", "Valor"]));

    return [
      buildBaseEntry(row, {
        ...options,
        entryType: "INSURANCE",
        commissionValue,
      }),
    ].filter(Boolean) as Entry[];
  }

  if (options.sheetType === "CREDIT" || options.sheetType === "DEBIT") {
    const commissionValue = parseNumber(pickField(row, ["Valor", "Comissao"]));

    return [
      buildBaseEntry(row, {
        ...options,
        entryType: options.sheetType,
        commissionValue,
      }),
    ].filter(Boolean) as Entry[];
  }

  return [];
}

// FIX-1.E.6.PRE.D — janela em que um PROCESSING anterior bloqueia novo
// upload para a mesma (company, year, month). Acima disso, considera
// presumido travado e libera (mas o registro antigo continua na tabela
// ate cancelamento manual via /api/import/closing/cancel).
const IN_FLIGHT_WINDOW_MINUTES = 30;

export class DuplicateImportInFlightError extends Error {
  readonly status = 409;
  readonly importId: string;
  readonly startedAt: string;
  constructor(importId: string, startedAt: string) {
    super(
      `Ja existe um import em andamento para essa competencia (id ${importId} iniciado em ${startedAt}). ` +
        `Aguarde finalizar ou cancele antes de tentar novamente.`
    );
    this.name = "DuplicateImportInFlightError";
    this.importId = importId;
    this.startedAt = startedAt;
  }
}

export async function importMonthlyClosingWorkbook(input: {
  fileBase64: string;
  fileName: string;
  year: number;
  month: number;
  companyId?: string | null;
  createdBy?: string | null;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  const companies = await supabaseAdmin
    .from("companies")
    .select("id, name, cnpj")
    .order("name", { ascending: true });

  if (companies.error) {
    throw new Error(companies.error.message);
  }

  const company = resolveCompany({
    companyId: input.companyId,
    fileName: input.fileName,
    companies: companies.data || [],
  });

  if (!company) {
    throw new Error(
      "Nao foi possivel identificar a empresa deste fechamento. Selecione a empresa manualmente."
    );
  }

  const targetYear = input.year;
  const targetMonth = input.month;

  // PRE.D.C — bloqueia novo upload se ja existe PROCESSING recente para a
  // mesma competencia. Evita os 4 zumbis simultaneos que vimos em abr/2026.
  const inFlightCutoff = new Date(
    Date.now() - IN_FLIGHT_WINDOW_MINUTES * 60_000
  ).toISOString();
  const { data: inFlight, error: inFlightError } = await supabaseAdmin
    .from("monthly_closing_imports")
    .select("id, created_at")
    .eq("company_id", company.id)
    .eq("year", targetYear)
    .eq("month", targetMonth)
    .eq("status", "PROCESSING")
    .gte("created_at", inFlightCutoff)
    .limit(1)
    .maybeSingle();

  if (inFlightError) {
    throw new Error(inFlightError.message);
  }

  if (inFlight) {
    throw new DuplicateImportInFlightError(inFlight.id, inFlight.created_at);
  }

  const { data: importLog, error: importLogError } = await supabaseAdmin
    .from("monthly_closing_imports")
    .insert({
      company_id: company.id,
      year: targetYear,
      month: targetMonth,
      file_name: input.fileName,
      source_type: "MONTHLY_CLOSING",
      status: "PROCESSING",
    })
    .select("id")
    .single();

  if (importLogError || !importLog) {
    throw new Error(importLogError?.message || "Falha ao registrar a importacao.");
  }

  // PRE.D.B — wrap entre INSERT inicial e UPDATE COMPLETED final.
  // Qualquer throw aqui dentro vira status='FAILED' + error_message + audit.
  try {
    return await runImportPipeline({
      supabaseAdmin,
      input,
      company,
      targetYear,
      targetMonth,
      importId: importLog.id,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erro desconhecido durante o import.";
    const stack = err instanceof Error && err.stack ? err.stack : "";
    const errorPayload = `${message}\n${stack.slice(0, 2000)}`.trim();

    // Best-effort: marca FAILED + grava audit. Erros aqui sao engolidos pra
    // nao mascarar o erro original que vai pro client.
    try {
      await supabaseAdmin
        .from("monthly_closing_imports")
        .update({
          status: "FAILED",
          error_message: errorPayload,
          error_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        })
        .eq("id", importLog.id);
    } catch {
      // silencioso
    }

    try {
      await supabaseAdmin.from("audit_logs").insert({
        entity_name: "monthly_closing_imports",
        entity_id: importLog.id,
        action: "IMPORT_FAILED",
        description: `Import de fechamento ${targetMonth}/${targetYear} (${company.name}) falhou.`,
        payload: {
          error: message,
          stack: stack.slice(0, 1000),
          fileName: input.fileName,
          year: targetYear,
          month: targetMonth,
          companyId: company.id,
          companyCnpj: company.cnpj,
        },
        created_by: input.createdBy || "sistema",
      });
    } catch {
      // silencioso
    }

    throw err;
  }
}

type ImportContext = {
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  input: {
    fileBase64: string;
    fileName: string;
    year: number;
    month: number;
    companyId?: string | null;
    createdBy?: string | null;
  };
  company: CompanyRow;
  targetYear: number;
  targetMonth: number;
  importId: string;
};

async function runImportPipeline(ctx: ImportContext) {
  const { supabaseAdmin, input, company, targetYear, targetMonth, importId } = ctx;

  const workbook = XLSX.read(Buffer.from(input.fileBase64, "base64"), { type: "buffer" });
  const entries: Entry[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheetType = inferSheetType(sheetName);

    if (sheetType === "OTHER") {
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = sheetToRows<Record<string, unknown>>(sheet, { defval: "" });

    for (const row of rows) {
      entries.push(
        ...buildEntriesForRow(row, {
          company,
          year: targetYear,
          month: targetMonth,
          sheetName,
          sheetType,
        })
      );
    }
  }

  const closingTotals: ClosingTotals = {
    valor_avista: 0,
    valor_diferido: 0,
    valor_seguro: 0,
    valor_estorno: 0,
    valor_renovacao: 0,
  };

  const rowsToInsert = entries.map((entry) => {
    const amount =
      entry.commissionValue || entry.netValue || entry.insuranceValue || entry.grossValue;
    const adjustment = isAdjustmentRow(entry.entryType, entry.metadata);

    if (entry.entryType === "CASH") {
      if (adjustment || amount < 0) {
        closingTotals.valor_estorno += Math.abs(amount);
      } else {
        closingTotals.valor_avista += amount;
      }
    } else if (entry.entryType === "PRT") {
      if (!isPayablePrtRow(entry.metadata)) {
        // The Resumo sheet counts only COD EST = 1 for "Comissao PRT".
      } else if (adjustment || amount < 0) {
        closingTotals.valor_estorno += Math.abs(amount);
      } else {
        closingTotals.valor_diferido += amount;
      }
    } else if (entry.entryType === "INSURANCE") {
      if (isInsurancePrtRow(entry.metadata) && amount > 0) {
        closingTotals.valor_seguro += amount;
      } else if (adjustment || amount < 0) {
        closingTotals.valor_estorno += Math.abs(amount);
      } else {
        closingTotals.valor_seguro += amount;
      }
    } else if (entry.entryType === "DEBIT") {
      closingTotals.valor_renovacao += Math.abs(amount);
    } else if (adjustment || amount < 0) {
      closingTotals.valor_estorno += Math.abs(amount);
    } else {
      closingTotals.valor_avista += amount;
    }

    return {
      monthly_closing_import_id: importId,
      company_id: company.id,
      company_cnpj: company.cnpj,
      year: targetYear,
      month: targetMonth,
      sheet_name: entry.sheetName,
      operation_number: entry.operationNumber,
      contract_number: entry.contractNumber,
      j_key: entry.jKey,
      product_name: entry.productName,
      entry_type: entry.entryType,
      status: entry.status,
      gross_value: entry.grossValue,
      net_value: entry.netValue,
      insurance_value: entry.insuranceValue,
      commission_value: amount,
      operation_date: entry.operationDate,
      cancellation_date: entry.cancellationDate,
      metadata: entry.metadata,
    };
  });

  const resumoTotals = readResumoTotals(workbook);

  if (resumoTotals) {
    Object.assign(closingTotals, resumoTotals);
  }

  const { error: deleteEntriesError } = await supabaseAdmin
    .from("monthly_closing_entries")
    .delete()
    .eq("company_id", company.id)
    .eq("year", targetYear)
    .eq("month", targetMonth);

  if (deleteEntriesError) {
    throw new Error(deleteEntriesError.message);
  }

  if (rowsToInsert.length > 0) {
    const { error: entriesError } = await supabaseAdmin
      .from("monthly_closing_entries")
      .insert(rowsToInsert);

    if (entriesError) {
      throw new Error(entriesError.message);
    }
  }

  const valorLiquido =
    closingTotals.valor_avista +
    closingTotals.valor_diferido +
    closingTotals.valor_seguro -
    closingTotals.valor_estorno -
    closingTotals.valor_renovacao;

  const operationKeys = new Set(
    rowsToInsert.map(
      (row, index) =>
        row.operation_number ||
        row.contract_number ||
        `${row.sheet_name}:${row.entry_type}:${index}`
    )
  );

  const { error: closingError } = await supabaseAdmin
    .from("fechamento_mensal_empresa")
    .upsert(
      {
        empresa_cnpj: company.cnpj,
        ano: targetYear,
        mes: targetMonth,
        valor_avista: closingTotals.valor_avista,
        valor_diferido: closingTotals.valor_diferido,
        valor_seguro: closingTotals.valor_seguro,
        valor_estorno: closingTotals.valor_estorno,
        valor_renovacao: closingTotals.valor_renovacao,
        valor_liquido: valorLiquido,
        operacoes: operationKeys.size,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "empresa_cnpj,ano,mes",
      }
    );

  if (closingError) {
    throw new Error(closingError.message);
  }

  const { error: finishError } = await supabaseAdmin
    .from("monthly_closing_imports")
    .update({
      status: "COMPLETED",
      finished_at: new Date().toISOString(),
    })
    .eq("id", importId);

  if (finishError) {
    throw new Error(finishError.message);
  }

  return {
    success: true,
    importId,
    company: {
      id: company.id,
      name: company.name,
      cnpj: company.cnpj,
    },
    processedSheets: workbook.SheetNames.length,
    processedEntries: rowsToInsert.length,
    totals: {
      ...closingTotals,
      valor_liquido: valorLiquido,
    },
  };
}
