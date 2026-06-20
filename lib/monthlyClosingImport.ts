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

// ETAPA 6 — abas COMPLEMENTARES (dentro do arquivo "Todos") que os 5 baldes
// do importador NAO capturam. A nota "Todos" = valor_liquido + soma da COMISSAO
// destas abas. Coluna de VALOR = header EXATAMENTE "COMISSAO" (descarta
// "% COMISSAO" e "VALOR DO PRODUTO/BEM"). NAO inclui A Vista/PRT/Seguro/Credito/
// Debito (essas o importador ja trata por entries -> nao duplicar).
//
// Portabilidade INSS fica de FORA (seria SUBTRACAO e nao ha amostra != 0) —
// cobrir via lancamento manual (negativo) se aparecer. Notas que vem como
// ARQUIVO proprio (Consorcio/Credito/BBCAP separados) tambem sao lancamento
// manual (competencia fiscal = data de pagamento do portal), NAO entram aqui.
const EXTRA_RESUMO_SHEETS = [
  "CONTA CORRENTE",
  "BBCAP",
  "BB CONSORCIO",
  "BB DENTAL",
  "LOB VEM",
];

function sumComissaoColumn(rows: unknown[][]): number {
  const headerRow = rows.find(
    (row) => Array.isArray(row) && row.some((cell) => normalizeText(cell) === "COMISSAO")
  );
  if (!headerRow) return 0;
  const colIndex = headerRow.findIndex((cell) => normalizeText(cell) === "COMISSAO");
  if (colIndex < 0) return 0;
  let total = 0;
  for (const row of rows) {
    if (row === headerRow || !Array.isArray(row)) continue;
    const v = parseNumber(row[colIndex]);
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

// Soma das abas extras (validadas). Todas entram como POSITIVAS — as que
// seriam negativas (Portabilidade INSS) estao fora por falta de amostra.
export function readExtraResumoComissao(workbook: XLSX.WorkBook): number {
  let total = 0;
  for (const target of EXTRA_RESUMO_SHEETS) {
    const sheetName = workbook.SheetNames.find((n) => normalizeText(n) === target);
    if (!sheetName) continue;
    const rows = sheetToRows<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
    });
    total += sumComissaoColumn(rows);
  }
  return total;
}

// ============================================================
// Fase 2B-3 — detecção de produto por conteúdo + escrita INCREMENTAL nos 6
// campos por produto. NUNCA toca valor_avista/diferido/seguro/liquido/
// nota_fiscal. Espelha o dry-run validado (mesmas abas/colunas/regra).
// ============================================================

// código C = prefixo antes do primeiro "_" (ex: C101846). null se fora do padrão.
function extractCodigoArquivo(fileName: string): string | null {
  const prefix = String(fileName || "").split("_")[0];
  return /^C\d+$/.test(prefix) ? prefix : null;
}

// normalização de header com colapso de espaços (paridade com o dry-run).
function normHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

type ProductValues = {
  avista: number;
  prt: number;
  seguros: number;
  consorcio: number;
  conta_corrente: number;
  bbcap: number;
  dental: number;
  lob: number;
  credito: number;
  debito: number;
};

type FileType = "TODOS" | "AVULSO" | "MISTO" | "VAZIO";

function locateProductCol(rows: unknown[][], headerNorm: string) {
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (normHeader(row[c]) === headerNorm) return { headerRow: r, col: c };
    }
  }
  return null;
}

// soma uma coluna (por header) de uma aba; opcionalmente filtra COD EST == 1 (PRT).
function sumProductColumn(
  workbook: XLSX.WorkBook,
  sheetNameNorm: string,
  headerNorm: string,
  opts: { codEst1?: boolean } = {}
): number {
  const name = workbook.SheetNames.find((n) => normHeader(n) === sheetNameNorm);
  if (!name) return 0;
  const rows = sheetToRows<unknown[]>(workbook.Sheets[name], { header: 1, defval: "" });
  const loc = locateProductCol(rows, headerNorm);
  if (!loc) return 0;
  let codEstCol: number | null = null;
  if (opts.codEst1) {
    const ce = locateProductCol(rows, "COD EST");
    codEstCol = ce ? ce.col : null;
  }
  let total = 0;
  for (let r = loc.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (opts.codEst1 && codEstCol !== null && parseNumber(row[codEstCol]) !== 1) continue;
    total += parseNumber(row[loc.col]);
  }
  return Math.round(total * 100) / 100;
}

function detectProductValues(workbook: XLSX.WorkBook): ProductValues {
  return {
    avista: sumProductColumn(workbook, "A VISTA", "COMISSAO PF"),
    prt: sumProductColumn(workbook, "PRT", "COMISSAO", { codEst1: true }),
    seguros: sumProductColumn(workbook, "A VISTA", "COMISSAO SEGURO"),
    consorcio:
      Math.round(
        (sumProductColumn(workbook, "BB CONSORCIO", "COMISSAO") +
          sumProductColumn(workbook, "BB CONSORCIO MASTER", "COMISSAO")) *
          100
      ) / 100,
    conta_corrente: sumProductColumn(workbook, "CONTA CORRENTE", "COMISSAO"),
    bbcap: sumProductColumn(workbook, "BBCAP", "COMISSAO"),
    dental: sumProductColumn(workbook, "BB DENTAL", "COMISSAO"),
    lob: sumProductColumn(workbook, "LOB VEM", "REPASSE"),
    credito: sumProductColumn(workbook, "CREDITO", "VALOR"),
    debito: sumProductColumn(workbook, "DEBITO", "VALOR"),
  };
}

// Cautela 3 — classificação endurecida. TODOS = nota "Todos" da Promotiva,
// caracterizada por À Vista OU PRT relevante (acima do ruído de um avulso) —
// NÃO depende mais de Seguro. Assim, um "Todos" legítimo com Seguro=0 continua
// TODOS e escreve os campos antigos (antes cairia em MISTO e os perderia).
// AVULSO = exatamente 1 produto com valor; MISTO = 2+ sem caracterizar TODOS.
const TODOS_LIMIAR = 1000;

function classifyFile(p: ProductValues): FileType {
  if (p.avista > TODOS_LIMIAR || p.prt > TODOS_LIMIAR) return "TODOS";
  const nonZero = (Object.values(p) as number[]).filter((v) => Math.abs(v) > 0.005);
  if (nonZero.length === 0) return "VAZIO";
  if (nonZero.length === 1) return "AVULSO";
  return "MISTO";
}

function buildProductIncrement(p: ProductValues, tipo: FileType) {
  const avulsoOuMisto = tipo === "AVULSO" || tipo === "MISTO";
  return {
    valor_consorcio: p.consorcio,
    valor_bbcap: p.bbcap,
    valor_conta_corrente: p.conta_corrente,
    valor_dental: p.dental,
    valor_lob: p.lob,
    // Crédito de um arquivo TODOS já está no valor_avista (Resumo) — só soma o de
    // arquivos AVULSO/MISTO (notas de crédito separadas).
    valor_credito: avulsoOuMisto ? p.credito : 0,
  };
}

// assinatura dos produtos que ESTE arquivo soma — gravada em
// monthly_closing_imports.produto e usada para detectar re-soma por outro código.
// TODOS = "TODOS"; demais = lista dos campos efetivamente incrementados (>0).
const PRODUTO_LABELS: Record<string, string> = {
  valor_consorcio: "CONSORCIO",
  valor_bbcap: "BBCAP",
  valor_conta_corrente: "CONTA_CORRENTE",
  valor_dental: "DENTAL",
  valor_lob: "LOB",
  valor_credito: "CREDITO",
};

function productSignature(
  tipo: FileType,
  increment: ReturnType<typeof buildProductIncrement>
): string {
  if (tipo === "TODOS") return "TODOS";
  const parts = Object.entries(increment)
    .filter(([, v]) => Math.abs(v) > 0.005)
    .map(([k]) => PRODUTO_LABELS[k] || k)
    .sort();
  return parts.length > 0 ? parts.join("+") : tipo;
}

// Cautela 2 — AVISO (não bloqueia) de RE-SOMA: já existe, para a mesma
// (empresa, ano, mes), um import COMPLETED com a MESMA assinatura de produto e
// código C DIFERENTE. Reemissão é legítima, mas a soma acumularia — então
// registra um warning rastreável no resultado e em audit_logs. A soma prossegue.
async function detectResomaWarning(args: {
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  company: CompanyRow;
  year: number;
  month: number;
  signature: string;
  codigoArquivo: string;
  createdBy?: string | null;
}): Promise<string | null> {
  const { supabaseAdmin, company, year, month, signature, codigoArquivo, createdBy } = args;
  if (signature === "VAZIO") return null;

  const { data: prior, error } = await supabaseRetry<{
    id: string;
    codigo_arquivo: string | null;
  }>(async () =>
    supabaseAdmin
      .from("monthly_closing_imports")
      .select("id, codigo_arquivo")
      .eq("company_id", company.id)
      .eq("year", year)
      .eq("month", month)
      .eq("status", "COMPLETED")
      .eq("produto", signature)
      .neq("codigo_arquivo", codigoArquivo)
      .limit(1)
      .maybeSingle()
  );
  if (error) throw new Error(error.message);
  if (!prior) return null;

  const warning =
    `Produto "${signature}" desta competência (${month}/${year}, ${company.name}) já foi somado por ` +
    `outro código C (${prior.codigo_arquivo ?? "?"}) — possível re-soma, revisar.`;

  try {
    await supabaseAdmin.from("audit_logs").insert({
      entity_name: "fechamento_mensal_empresa",
      action: "PRODUCT_RESUM_WARNING",
      description: warning,
      payload: {
        company_id: company.id,
        company_cnpj: company.cnpj,
        year,
        month,
        produto: signature,
        codigo_atual: codigoArquivo,
        codigo_anterior: prior.codigo_arquivo,
      },
      created_by: createdBy || "sistema",
    });
  } catch {
    // trilha best-effort — não interrompe a soma.
  }

  return warning;
}

// SOMA incremental nos 6 campos novos do registro (empresa, ano, mes). Cria o
// registro com os campos antigos zerados se ele ainda não existir (ex: avulso
// de consórcio sem o "Todos" importado). Read-modify-write — seguro porque o
// in-flight lock impede import concorrente da mesma competência.
async function applyProductIncrement(args: {
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  company: CompanyRow;
  year: number;
  month: number;
  increment: ReturnType<typeof buildProductIncrement>;
}) {
  const { supabaseAdmin, company, year, month, increment } = args;
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const toNum = (v: unknown) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const { data: existing, error: selError } = await supabaseRetry<{
    id: string;
    valor_consorcio: number | null;
    valor_bbcap: number | null;
    valor_conta_corrente: number | null;
    valor_dental: number | null;
    valor_lob: number | null;
    valor_credito: number | null;
  }>(async () =>
    supabaseAdmin
      .from("fechamento_mensal_empresa")
      .select(
        "id, valor_consorcio, valor_bbcap, valor_conta_corrente, valor_dental, valor_lob, valor_credito"
      )
      .eq("empresa_cnpj", company.cnpj)
      .eq("ano", year)
      .eq("mes", month)
      .maybeSingle()
  );
  if (selError) throw new Error(selError.message);

  if (!existing) {
    const { error: insError } = await supabaseRetry(async () =>
      supabaseAdmin.from("fechamento_mensal_empresa").insert({
        empresa_cnpj: company.cnpj,
        ano: year,
        mes: month,
        valor_avista: 0,
        valor_diferido: 0,
        valor_seguro: 0,
        valor_estorno: 0,
        valor_renovacao: 0,
        valor_liquido: 0,
        valor_consorcio: increment.valor_consorcio,
        valor_bbcap: increment.valor_bbcap,
        valor_conta_corrente: increment.valor_conta_corrente,
        valor_dental: increment.valor_dental,
        valor_lob: increment.valor_lob,
        valor_credito: increment.valor_credito,
      })
    );
    if (insError) throw new Error(insError.message);
    return;
  }

  const { error: updError } = await supabaseRetry(async () =>
    supabaseAdmin
      .from("fechamento_mensal_empresa")
      .update({
        valor_consorcio: round2(toNum(existing.valor_consorcio) + increment.valor_consorcio),
        valor_bbcap: round2(toNum(existing.valor_bbcap) + increment.valor_bbcap),
        valor_conta_corrente: round2(
          toNum(existing.valor_conta_corrente) + increment.valor_conta_corrente
        ),
        valor_dental: round2(toNum(existing.valor_dental) + increment.valor_dental),
        valor_lob: round2(toNum(existing.valor_lob) + increment.valor_lob),
        valor_credito: round2(toNum(existing.valor_credito) + increment.valor_credito),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
  );
  if (updError) throw new Error(updError.message);
}

async function markImportCompleted(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  importId: string
) {
  const { error } = await supabaseRetry(async () =>
    supabaseAdmin
      .from("monthly_closing_imports")
      .update({
        status: "COMPLETED",
        finished_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", importId)
  );
  if (error) throw new Error(error.message);
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

// FIX-1.E.6.PRE.E — bulk insert de monthly_closing_entries em chunks pra
// evitar 'fetch failed' do undici quando o payload PostgREST passa do
// limite de transacao/timeout. AL_1 abr/2026 (~6k rows) falhava sempre;
// outros CNPJs (530-2770 rows) funcionavam num insert so.
const ENTRIES_INSERT_CHUNK_SIZE = 500;

// FIX-1.E.6.PRE.E.B — retry com backoff exponencial em chamadas Supabase
// que sofrem erro transiente. Apenas erros de rede (fetch failed,
// ETIMEDOUT, ECONNRESET) sao retentados; erros de validacao (constraint,
// RLS, sintaxe) propagam imediatamente.
async function supabaseRetry<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
  maxRetries = 3
): Promise<{ data: T | null; error: any }> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (!result.error) return result;
      lastError = result.error;
      if (!isTransientError(result.error) || attempt === maxRetries) {
        return result;
      }
    } catch (err: any) {
      lastError = err;
      if (!isTransientError(err) || attempt === maxRetries) {
        throw err;
      }
    }
    const delayMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
    console.log(`[import] retry ${attempt}/${maxRetries} apos ${delayMs}ms (erro: ${lastError?.message || lastError})`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { data: null, error: lastError };
}

function isTransientError(err: any): boolean {
  const message = String(err?.message || err || "");
  return (
    message.includes("fetch failed") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("EAI_AGAIN")
  );
}

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

  // Fase 2B-3 — código C é obrigatório para a trava de idempotência por arquivo.
  // Sem código no padrão C\d+ (prefixo antes do 1º "_"), o import é BLOQUEADO.
  const codigoArquivo = extractCodigoArquivo(input.fileName);
  if (!codigoArquivo) {
    throw new Error(
      `Arquivo sem código C no nome ("${input.fileName}"). O código (prefixo "C#####" antes do primeiro "_") ` +
        `é obrigatório para a trava de idempotência por arquivo. Renomeie o arquivo e tente novamente.`
    );
  }

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

  // Fase 2B-3 — IDEMPOTÊNCIA por arquivo: se este código C já foi processado
  // (COMPLETED) para esta empresa/competência, NÃO soma de novo.
  const { data: alreadyDone, error: alreadyDoneError } = await supabaseAdmin
    .from("monthly_closing_imports")
    .select("id, created_at")
    .eq("company_id", company.id)
    .eq("year", targetYear)
    .eq("month", targetMonth)
    .eq("codigo_arquivo", codigoArquivo)
    .eq("status", "COMPLETED")
    .limit(1)
    .maybeSingle();

  if (alreadyDoneError) {
    throw new Error(alreadyDoneError.message);
  }

  if (alreadyDone) {
    return {
      success: true,
      alreadyProcessed: true,
      importId: alreadyDone.id,
      codigoArquivo,
      company: { id: company.id, name: company.name, cnpj: company.cnpj },
      processedEntries: 0,
      message: `Arquivo ${codigoArquivo} já foi processado para ${company.name} ${targetMonth}/${targetYear} — soma ignorada (idempotência).`,
    };
  }

  const { data: importLog, error: importLogError } = await supabaseAdmin
    .from("monthly_closing_imports")
    .insert({
      company_id: company.id,
      year: targetYear,
      month: targetMonth,
      file_name: input.fileName,
      codigo_arquivo: codigoArquivo,
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
      codigoArquivo,
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
  codigoArquivo: string;
};

async function runImportPipeline(ctx: ImportContext) {
  const { supabaseAdmin, input, company, targetYear, targetMonth, importId, codigoArquivo } = ctx;

  const workbook = XLSX.read(Buffer.from(input.fileBase64, "base64"), { type: "buffer" });

  // Fase 2B-3 — detecta produtos por conteúdo e classifica o arquivo. O TIPO
  // decide o caminho de escrita: TODOS roda o pipeline legado (campos antigos +
  // entries) e ainda soma os produtos; AVULSO/MISTO/VAZIO só somam os campos por
  // produto (sem tocar campos antigos nem entries).
  const productValues = detectProductValues(workbook);
  const fileType = classifyFile(productValues);
  const increment = buildProductIncrement(productValues, fileType);
  const signature = productSignature(fileType, increment);

  await supabaseRetry(async () =>
    supabaseAdmin
      .from("monthly_closing_imports")
      .update({ produto: signature })
      .eq("id", importId)
  );

  // Cautela 2 — detecta (sem bloquear) re-soma por outro código C nesta competência.
  const resomaWarning = await detectResomaWarning({
    supabaseAdmin,
    company,
    year: targetYear,
    month: targetMonth,
    signature,
    codigoArquivo,
    createdBy: input.createdBy,
  });

  if (fileType !== "TODOS") {
    // Não toca valor_avista/diferido/seguro/liquido/nota_fiscal nem entries.
    await applyProductIncrement({
      supabaseAdmin,
      company,
      year: targetYear,
      month: targetMonth,
      increment,
    });
    await markImportCompleted(supabaseAdmin, importId);
    return {
      success: true,
      importId,
      company: { id: company.id, name: company.name, cnpj: company.cnpj },
      fileType,
      productValues,
      increment,
      processedEntries: 0,
      warning: resomaWarning,
    };
  }

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

  const { error: deleteEntriesError } = await supabaseRetry(async () =>
    supabaseAdmin
      .from("monthly_closing_entries")
      .delete()
      .eq("company_id", company.id)
      .eq("year", targetYear)
      .eq("month", targetMonth)
  );

  if (deleteEntriesError) {
    throw new Error(deleteEntriesError.message);
  }

  // PRE.E.A — bulk insert em chunks. Cada chunk vai com retry de rede.
  // PRE.E.C — atualiza error_message com progresso a cada chunk; Diego
  // pode acompanhar via SELECT em monthly_closing_imports.
  if (rowsToInsert.length > 0) {
    let totalInserted = 0;
    for (let i = 0; i < rowsToInsert.length; i += ENTRIES_INSERT_CHUNK_SIZE) {
      const slice = rowsToInsert.slice(i, i + ENTRIES_INSERT_CHUNK_SIZE);

      const { error: chunkError } = await supabaseRetry(async () =>
        supabaseAdmin.from("monthly_closing_entries").insert(slice)
      );

      if (chunkError) {
        throw new Error(
          `Falha ao inserir chunk ${i}-${i + slice.length} de ${rowsToInsert.length}: ${chunkError.message}`
        );
      }

      totalInserted += slice.length;
      console.log(
        `[import ${importId}] chunk OK: ${totalInserted}/${rowsToInsert.length}`
      );

      // Progresso visivel ao usuario via tabela. Best-effort: erro aqui nao
      // interrompe o import (so perde observabilidade).
      try {
        await supabaseAdmin
          .from("monthly_closing_imports")
          .update({
            error_message: `PROGRESSO: ${totalInserted}/${rowsToInsert.length} entries inseridas`,
          })
          .eq("id", importId);
      } catch {
        // silencioso
      }
    }
  }

  const valorLiquido =
    closingTotals.valor_avista +
    closingTotals.valor_diferido +
    closingTotals.valor_seguro -
    closingTotals.valor_estorno -
    closingTotals.valor_renovacao;

  // ETAPA 6 — nota "Todos" = valor_liquido + abas COMPLEMENTARES in-file
  // (Conta Corrente/BBCAP/Consorcio/Dental/LOB Vem). Validado contra a regua
  // do portal (AL1: abril 70.156,06; maio 60.915,54). Notas que vem como
  // arquivo proprio (Consorcio/Credito separados) entram por lancamento manual.
  const extraComissao = readExtraResumoComissao(workbook);
  const valorNotaFiscal = valorLiquido + extraComissao;

  const operationKeys = new Set(
    rowsToInsert.map(
      (row, index) =>
        row.operation_number ||
        row.contract_number ||
        `${row.sheet_name}:${row.entry_type}:${index}`
    )
  );

  const { error: closingError } = await supabaseRetry(async () =>
    supabaseAdmin
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
          valor_nota_fiscal: valorNotaFiscal,
          operacoes: operationKeys.size,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "empresa_cnpj,ano,mes",
        }
      )
  );

  if (closingError) {
    throw new Error(closingError.message);
  }

  // Fase 2B-3 — além dos campos antigos (acima), o arquivo TODOS também carrega
  // produtos (Conta Corrente/BBCAP/etc) → soma incremental nos 6 campos novos.
  // Crédito NÃO entra aqui (já está no valor_avista do Resumo) — ver
  // buildProductIncrement (só soma crédito de AVULSO/MISTO).
  await applyProductIncrement({
    supabaseAdmin,
    company,
    year: targetYear,
    month: targetMonth,
    increment,
  });

  await markImportCompleted(supabaseAdmin, importId);

  return {
    success: true,
    importId,
    fileType,
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
    productIncrement: increment,
    warning: resomaWarning,
  };
}
