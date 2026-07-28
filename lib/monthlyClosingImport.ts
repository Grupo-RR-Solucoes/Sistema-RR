import * as XLSX from "xlsx";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolverSrccDoFechamento } from "@/lib/srccResolucao";
import { reconsolidarCompetenciaFechada } from "@/lib/reconsolidarCompetencia";

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

// ============================================================
// FRENTE DE PRODUTO — Movimento 1: DESDOBRAMENTO das abas BBCAP / Conta Corrente /
// BB Consorcio em linhas individuais na master (monthly_closing_entries),
// preservando a comissao-EMPRESA que ja vem pronta (coluna COMISSAO da aba).
//
// NAO substitui a soma existente (detectProductValues/readExtraResumoComissao ->
// fechamento_mensal_empresa.valor_*): roda AO LADO dela. As linhas sao ADITIVAS e
// usam entry_type proprios, ignorados pelos consolidadores de PMR (CASH/PRT/...).
// A soma das linhas desdobradas reproduz o total de empresa ja gravado.
//
// Chave da linha (para o Movimento 2 linkar o promotor):
//   BBCAP / Consorcio -> operation_number = PROPOSTA
//   Conta Corrente    -> operation_number = NUMERO DA CONTA  + j_key = CHAVE J
//   Consorcio         -> contract_number  = discriminador da parcela (proposta repete)
// ============================================================

const PRODUCT_ENTRY_TYPES = ["BBCAP", "CONTA_CORRENTE", "CONSORCIO"] as const;

type ProductLine = {
  entryType: string;
  productName: string;
  operationNumber: string;
  contractNumber: string;
  jKey: string | null;
  commissionValue: number;
  grossValue: number;
  operationDate: string | null;
  metadata: Record<string, unknown>;
};

// abre uma aba (por nome normalizado) como matriz de linhas.
function abaRows(workbook: XLSX.WorkBook, sheetNameNorm: string): unknown[][] | null {
  const name = workbook.SheetNames.find((n) => normHeader(n) === sheetNameNorm);
  if (!name) return null;
  return sheetToRows<unknown[]>(workbook.Sheets[name], { header: 1, defval: "" });
}

function cellAt(row: unknown[], col: number | null | undefined): unknown {
  return col === null || col === undefined || col < 0 ? "" : row[col];
}
function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

// Le as 3 abas de produto e devolve UMA linha por proposta/conta/parcela, com a
// comissao-EMPRESA pronta. Le a mesma matriz que a soma legada usa; nao a altera.
// Exportada para o dry-run/regressao (scripts/dryrun_produtos_desdobra.cjs).
export function buildProductLines(
  workbook: XLSX.WorkBook,
  codigoArquivo: string
): ProductLine[] {
  const lines: ProductLine[] = [];

  // ---- BBCAP (chave: PROPOSTA) ----
  {
    const rows = abaRows(workbook, "BBCAP");
    const kProp = rows ? locateProductCol(rows, "PROPOSTA") : null;
    const kCom = rows ? locateProductCol(rows, "COMISSAO") : null;
    if (rows && kProp && kCom) {
      const cProd = locateProductCol(rows, "CODIGO DO PRODUTO");
      const cVal = locateProductCol(rows, "VALOR DO PRODUTO");
      const cData = locateProductCol(rows, "DATA DA VENDA");
      const cCpf = locateProductCol(rows, "CPF DO CLIENTE");
      const cLogin = locateProductCol(rows, "LOGIN DO AGENTE DE CREDITO");
      const cMci = locateProductCol(rows, "MCI");
      for (let r = kProp.headerRow + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const proposta = trimStr(cellAt(row, kProp.col));
        if (proposta === "") continue;
        lines.push({
          entryType: "BBCAP",
          productName: "BBCAP",
          operationNumber: proposta,
          contractNumber: "",
          jKey: null,
          commissionValue: parseNumber(cellAt(row, kCom.col)),
          grossValue: parseNumber(cellAt(row, cVal?.col)),
          operationDate: parseDate(cellAt(row, cData?.col)),
          metadata: {
            codigo_produto: trimStr(cellAt(row, cProd?.col)) || null,
            valor_produto: parseNumber(cellAt(row, cVal?.col)),
            cpf_cliente: trimStr(cellAt(row, cCpf?.col)) || null,
            login_agente: trimStr(cellAt(row, cLogin?.col)) || null,
            mci: trimStr(cellAt(row, cMci?.col)) || null,
            codigo_arquivo: codigoArquivo,
          },
        });
      }
    }
  }

  // ---- BB CONSORCIO (+ MASTER) (chave: PROPOSTA + parcela) ----
  for (const abaName of ["BB CONSORCIO", "BB CONSORCIO MASTER"]) {
    const rows = abaRows(workbook, abaName);
    const kProp = rows ? locateProductCol(rows, "PROPOSTA") : null;
    const kCom = rows ? locateProductCol(rows, "COMISSAO") : null;
    if (!rows || !kProp || !kCom) continue;
    const cParc = locateProductCol(rows, "PARCELA LIBERACAO");
    const cSeg = locateProductCol(rows, "SEGMENTO");
    const cBem = locateProductCol(rows, "VALOR BEM");
    const cPct = locateProductCol(rows, "% COMISSAO");
    const cData = locateProductCol(rows, "DATA");
    const cMci = locateProductCol(rows, "MCI");
    const isMaster = abaName.includes("MASTER");
    for (let r = kProp.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const proposta = trimStr(cellAt(row, kProp.col));
      if (proposta === "") continue;
      const parcela = trimStr(cellAt(row, cParc?.col));
      lines.push({
        entryType: "CONSORCIO",
        productName: "CONSORCIO",
        operationNumber: proposta,
        // discrimina regular/master + parcela para a chave de conteudo nao colidir
        // (a mesma proposta tem PARC1/PARC2...). Parcela crua fica no metadata.
        contractNumber: `${isMaster ? "M" : "R"}|${parcela || "0"}`,
        jKey: null,
        commissionValue: parseNumber(cellAt(row, kCom.col)),
        grossValue: parseNumber(cellAt(row, cBem?.col)),
        operationDate: parseDate(cellAt(row, cData?.col)),
        metadata: {
          segmento: trimStr(cellAt(row, cSeg?.col)) || null,
          valor_bem: parseNumber(cellAt(row, cBem?.col)),
          parcela_liberacao: parcela || null,
          pct_comissao: parseNumber(cellAt(row, cPct?.col)),
          master: isMaster,
          mci: trimStr(cellAt(row, cMci?.col)) || null,
          codigo_arquivo: codigoArquivo,
        },
      });
    }
  }

  // ---- CONTA CORRENTE (chave: NUMERO DA CONTA; balde se vazio; j_key = CHAVE J) ----
  {
    const rows = abaRows(workbook, "CONTA CORRENTE");
    const kConta = rows ? locateProductCol(rows, "CONTA CORRENTE") : null;
    const kCom = rows ? locateProductCol(rows, "COMISSAO") : null;
    if (rows && kConta && kCom) {
      const kJ = locateProductCol(rows, "CHAVE J");
      const cModal = locateProductCol(rows, "MODALIDADE");
      const cData = locateProductCol(rows, "DATA");
      const cAg = locateProductCol(rows, "AGENCIA");
      const cLoja = locateProductCol(rows, "LOJA");
      const cMci = locateProductCol(rows, "MCI");
      // ha DUAS colunas "PRODUTO" (codigo numerico + texto "Ativacao ... PF/PJ").
      const hdr = rows[kConta.headerRow] || [];
      const prodCols: number[] = [];
      for (let c = 0; c < hdr.length; c++) {
        if (normHeader(hdr[c]) === "PRODUTO") prodCols.push(c);
      }
      const prodCodCol = prodCols[0] ?? -1;
      const prodTxtCol = prodCols.length > 1 ? prodCols[prodCols.length - 1] : -1;
      let seq = 0;
      for (let r = kConta.headerRow + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const conta = trimStr(cellAt(row, kConta.col));
        const chaveJ = trimStr(cellAt(row, kJ?.col));
        const comissao = parseNumber(cellAt(row, kCom.col));
        if (conta === "" && chaveJ === "" && comissao === 0) continue; // linha vazia
        seq += 1;
        // balde = linha sem numero de conta (ex.: "S/ IDENTIFICACAO"): vira linha
        // na master SEM promotor (nao e erro). Chave sintetica estavel por arquivo.
        const balde = conta === "" || normHeader(conta).includes("IDENTIFICAC");
        lines.push({
          entryType: "CONTA_CORRENTE",
          productName: "CONTA CORRENTE",
          operationNumber: balde ? `SEMID|${codigoArquivo}|${seq}` : conta,
          contractNumber: "",
          jKey: chaveJ || null,
          commissionValue: comissao,
          grossValue: 0,
          operationDate: parseDate(cellAt(row, cData?.col)),
          metadata: {
            numero_conta: balde ? null : conta,
            balde,
            modalidade: trimStr(cellAt(row, cModal?.col)) || null,
            produto_cod: trimStr(cellAt(row, prodCodCol)) || null,
            produto_texto: trimStr(cellAt(row, prodTxtCol)) || null,
            agencia: trimStr(cellAt(row, cAg?.col)) || null,
            loja: trimStr(cellAt(row, cLoja?.col)) || null,
            mci: trimStr(cellAt(row, cMci?.col)) || null,
            codigo_arquivo: codigoArquivo,
          },
        });
      }
    }
  }

  return lines;
}

// Grava as linhas desdobradas na master de forma IDEMPOTENTE: remove versoes
// anteriores DESTAS linhas (mesma proposta/conta) — cobre reimport do mesmo arquivo
// e re-envio por outro codigo C — e insere as atuais. Preserva as linhas de OUTROS
// produtos/propostas da competencia (aditivo). O indice unico parcial da migracao
// e a rede de seguranca contra corrida/bug.
async function syncProductLines(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  ctx: { company: CompanyRow; year: number; month: number; importId: string },
  lines: ProductLine[]
): Promise<number> {
  if (lines.length === 0) return 0;
  const { company, year, month, importId } = ctx;

  const opsByType = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!opsByType.has(l.entryType)) opsByType.set(l.entryType, new Set());
    opsByType.get(l.entryType)!.add(l.operationNumber);
  }
  for (const [entryType, ops] of opsByType) {
    const opList = [...ops];
    for (let i = 0; i < opList.length; i += 200) {
      const slice = opList.slice(i, i + 200);
      const { error } = await supabaseRetry(async () =>
        supabaseAdmin
          .from("monthly_closing_entries")
          .delete()
          .eq("company_id", company.id)
          .eq("year", year)
          .eq("month", month)
          .eq("entry_type", entryType)
          .in("operation_number", slice)
      );
      if (error) throw new Error(`produto delete (${entryType}): ${error.message}`);
    }
  }

  const rows = lines.map((l) => ({
    monthly_closing_import_id: importId,
    company_id: company.id,
    company_cnpj: company.cnpj,
    year,
    month,
    sheet_name: l.productName,
    operation_number: l.operationNumber,
    contract_number: l.contractNumber,
    j_key: l.jKey,
    product_name: l.productName,
    entry_type: l.entryType,
    status: null,
    gross_value: l.grossValue,
    net_value: 0,
    insurance_value: 0,
    commission_value: l.commissionValue,
    operation_date: l.operationDate,
    cancellation_date: null,
    metadata: l.metadata,
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += ENTRIES_INSERT_CHUNK_SIZE) {
    const slice = rows.slice(i, i + ENTRIES_INSERT_CHUNK_SIZE);
    const { error } = await supabaseRetry(async () =>
      supabaseAdmin.from("monthly_closing_entries").insert(slice)
    );
    if (error) throw new Error(`produto insert: ${error.message}`);
    inserted += slice.length;
  }
  return inserted;
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
  const contractNumber =
    String(
      pickField(row, ["Contrato", "Numero Contrato", "Numero Seguro"]) || ""
    ).trim() || null;

  // CASH (aba "A Vista"): preserva a PROPOSTA REAL (tem contrato + VALOR LÍQUIDO
  // > 0) mesmo com COMISSÃO PF = 0. Toda proposta SRCC="Sim" tem PF=0 (não pagou,
  // "FATURAR") — descartá-las escondia as restritas do banco e da tela. O metadata
  // completo (incl. RESTRIÇÃO SRCC) é preservado. Demais abas (PRT/INSURANCE/
  // CREDIT/DEBIT) seguem descartando comissão-zero.
  const isRealCashProposal =
    options.entryType === "CASH" && netValue > 0 && !!contractNumber;
  if (!primaryValue && !isRealCashProposal) {
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
    contractNumber,
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
    // Não toca valor_avista/diferido/seguro/liquido/nota_fiscal nem as entries
    // legadas. Mantém a soma incremental dos campos por produto…
    await applyProductIncrement({
      supabaseAdmin,
      company,
      year: targetYear,
      month: targetMonth,
      increment,
    });
    // …e DESDOBRA as abas de produto em linhas na master (é por aqui que entra o
    // consórcio avulso). Aditivo e idempotente; não conflita com o incremento.
    const produtoLinhas = await syncProductLines(
      supabaseAdmin,
      { company, year: targetYear, month: targetMonth, importId },
      buildProductLines(workbook, codigoArquivo)
    );
    await markImportCompleted(supabaseAdmin, importId);
    return {
      success: true,
      importId,
      company: { id: company.id, name: company.name, cnpj: company.cnpj },
      fileType,
      productValues,
      increment,
      processedEntries: 0,
      produtoLinhas,
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
    // CASH: amount = COMISSÃO PF (pode ser 0 na restrita/FATURAR). NÃO cai para
    // netValue — senão a linha SRCC/FATURAR gravaria commission_value=netValue e
    // (a) inflaria valor_avista, (b) o closingMonthly leria comissaoEmpresaAvista
    // = netValue e comissionaria a proposta não-paga. Demais abas: fallback antigo.
    const amount =
      entry.entryType === "CASH"
        ? entry.commissionValue
        : entry.commissionValue || entry.netValue || entry.insuranceValue || entry.grossValue;
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

  // Apaga as entries LEGADAS (crédito/cash/prt/seguro/débito e legado sem tipo)
  // desta competência antes de reinserir. NÃO apaga as linhas de PRODUTO
  // (BBCAP/CONTA_CORRENTE/CONSORCIO): elas podem vir de OUTRO arquivo Todos da
  // mesma empresa (ex.: CC num arquivo, BBCAP em outro) e são geridas por
  // syncProductLines pela própria chave — o blanket delete as perderia.
  const { error: deleteEntriesError } = await supabaseRetry(async () =>
    supabaseAdmin
      .from("monthly_closing_entries")
      .delete()
      .eq("company_id", company.id)
      .eq("year", targetYear)
      .eq("month", targetMonth)
      .or("entry_type.is.null,entry_type.not.in.(BBCAP,CONTA_CORRENTE,CONSORCIO)")
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

  // FRENTE DE PRODUTO (Movimento 1) — além da soma acima, desdobra as abas
  // BBCAP/Conta Corrente/BB Consórcio deste arquivo Todos em linhas individuais na
  // master (sem promotor; comissão-EMPRESA pronta). Aditivo: não entra em
  // rowsToInsert/operacoes nem no valor_nota_fiscal — só grava as linhas.
  const produtoLinhas = await syncProductLines(
    supabaseAdmin,
    { company, year: targetYear, month: targetMonth, importId },
    buildProductLines(workbook, codigoArquivo)
  );
  console.log(`[import ${importId}] produtos desdobrados: ${produtoLinhas} linhas`);

  // FRENTE DÉBITOS (tipo A) — o fechamento acabou de gravar as entries, entre elas a
  // aba Seguro. Agora o resolvedor lê os estornos CANCELADOS, resolve OPERAÇÃO → PRT
  // → chave J → promotor, aplica a regra VERSIONADA da competência e grava as parcelas;
  // os MASTER não resolvidos vão pra fila. Espelha o que o ADS já faz no
  // bbtsClosingImport. NÃO derruba o import: falha aqui vira aviso no retorno.
  const debitosAuto = await persistAutoInsuranceDebits({
    supabaseAdmin,
    year: targetYear,
    month: targetMonth,
    createdBy: input.createdBy ?? null,
  });

  // ============================================================
  // MOVIMENTO 1 — LEDGER: o PMR FECHADO passa a ser escrito PELA ROTA.
  //
  // Roda ANTES de markImportCompleted e NAO e best-effort: se a consolidacao
  // falhar, o erro sobe, o import NAO e marcado COMPLETED e a competencia NAO
  // fica "fechada" para os leitores. Invariante: regime fechado => PMR fechado
  // existe. (Antes disto o PMR fechado dependia de alguem rodar
  // scripts/rodarClosingMonthly + rodarBbtsOrchestrator na mao.)
  //
  // empresaEmVoo: o import e POR EMPRESA e este COMPLETED esta a 1 linha de
  // acontecer. Sem antecipa-lo, a ULTIMA empresa da competencia nao veria o mes
  // fechar (ela mesma ainda nao esta marcada) e o PMR jamais seria escrito.
  //
  // Nao perturba a ordem do Forecast: reconsolidar le monthly_closing_entries +
  // daily + monthly_targets e escreve promoter_monthly_results. NAO le nem
  // escreve carteira_contrato/producao_contrato/previsao_snapshot. A cadeia
  // materializar -> congelarPrevisao (na rota) segue intacta e na mesma ordem.
  // ============================================================
  const pmrFechado = await reconsolidarCompetenciaFechada(supabaseAdmin, {
    year: targetYear,
    month: targetMonth,
    dryRun: false,
    empresaEmVoo: company.id,
  });
  console.log(
    `[import ${importId}] PMR fechado: ${
      pmrFechado.ran
        ? `regime=${pmrFechado.regime}, ${pmrFechado.gravadas} linhas, ` +
          `reconciliacao(daily=${pmrFechado.reconciliacao?.apagadas_daily}, ` +
          `orfaos=${pmrFechado.reconciliacao?.apagadas_orfaos})`
        : `nao rodou (regime=${pmrFechado.regime}) — ${pmrFechado.motivo}`
    }`
  );

  // ============================================================
  // RESOLUCAO DO SRCC — o fechamento responde o que a diaria deixou em aberto.
  //
  // DEPOIS da consolidacao, de proposito. O PMR fechado nao le o SRCC da diaria
  // do RR (o unico ponto que le esta atras de .eq(company_id, BBTS) no
  // bbtsOrchestrator), entao a ordem e indiferente para o numero — e rodar
  // depois torna isso DEMONSTRAVEL: o PMR acima foi construido do mesmo estado
  // de antes desta mudanca.
  //
  // BEST-EFFORT: falha aqui NAO derruba o import. O fechamento ja esta gravado
  // e o PMR ja esta consolidado; perder a resolucao do SRCC e um sintoma de
  // tela, e a proxima importacao tenta de novo (o passo e idempotente).
  let srccResolucao: Awaited<ReturnType<typeof resolverSrccDoFechamento>> | null = null;
  let srccResolucaoAviso: string | null = null;
  try {
    srccResolucao = await resolverSrccDoFechamento(supabaseAdmin, {
      year: targetYear,
      month: targetMonth,
      companyId: company.id,
    });
    console.log(
      `[import ${importId}] SRCC resolvido: ${srccResolucao.resolvidas}/${srccResolucao.candidatas} ` +
        `(SIM=${srccResolucao.porValor.SIM}, NAO=${srccResolucao.porValor.NAO}, ` +
        `NAO_SE_APLICA=${srccResolucao.porValor.NAO_SE_APLICA}); sem resposta: ` +
        `ausentes=${srccResolucao.semResposta.ausenteDoFechamento}, ` +
        `sem coluna=${srccResolucao.semResposta.semColuna}, ` +
        `desconhecido=${srccResolucao.semResposta.valorDesconhecido}`
    );
  } catch (e: any) {
    srccResolucaoAviso = `Falha ao resolver o SRCC pelo fechamento: ${e?.message || e}`;
    console.error(`[import ${importId}] ${srccResolucaoAviso}`);
  }

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
    produtoLinhas,
    totals: {
      ...closingTotals,
      valor_liquido: valorLiquido,
    },
    productIncrement: increment,
    warning: resomaWarning,
    debitosAuto,
    // REPORTADO, nao silenciado: quantas o fechamento resolveu, para cada valor,
    // e quantas ficaram sem resposta. O silencio era o defeito.
    srccResolucao,
    srccResolucaoAviso,
  };
}

/**
 * Primeira competência em que o débito automático de seguro roda pelo IMPORT do
 * fechamento RR. Competências anteriores ficam CONGELADAS: jun/2026 foi lançado à
 * mão sob a regra SUM_100 (15 débitos AUTO, 27 estornos, 3 na fila) e não se
 * recalcula — reimportar o fechamento de junho não pode mexer neles.
 */
const DEBITO_AUTO_PRIMEIRA_COMPETENCIA = "2026-07";

/**
 * Gera/atualiza os débitos automáticos de cancelamento de seguro da competência a
 * partir do fechamento recém-importado.
 *
 * IDEMPOTÊNCIA: resolveInsuranceDebits faz delete-and-replace dos débitos AUTO/
 * CANCELAMENTO_SEGURO da competência (parcelas e sources caem por CASCADE) antes de
 * regravar, e a fila é upsert por (year, month, operation). Reimportar o mesmo
 * fechamento — ou importar as empresas uma a uma — converge no mesmo estado, sem
 * duplicar. Atribuições que o Diego já fez (status ASSIGNED) são respeitadas.
 *
 * DUAS TRAVAS, porque o delete-and-replace é destrutivo:
 *   1. competência < DEBITO_AUTO_PRIMEIRA_COMPETENCIA → não roda (junho congelado).
 *   2. competência com parcela já APLICADA (paga) → não roda. Sem isso, reimportar um
 *      fechamento de um mês já pago apagaria a parcela APPLIED e a recriaria PENDING,
 *      ressuscitando um débito já quitado.
 * Em ambos os casos devolve o motivo — o import segue normal.
 */
async function persistAutoInsuranceDebits(params: {
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  year: number;
  month: number;
  createdBy: string | null;
}): Promise<{ executado: boolean; motivo?: string; criados?: number; fila?: number; aviso?: string }> {
  const { supabaseAdmin, year, month, createdBy } = params;
  const competencia = `${year}-${String(month).padStart(2, "0")}`;

  if (competencia < DEBITO_AUTO_PRIMEIRA_COMPETENCIA) {
    return {
      executado: false,
      motivo: `competencia ${competencia} congelada (anterior a ${DEBITO_AUTO_PRIMEIRA_COMPETENCIA}); debitos automaticos preservados`,
    };
  }

  try {
    const { data: pagas, error: pagasError } = await supabaseAdmin
      .from("promoter_discounts")
      .select("id")
      .eq("year", year)
      .eq("month", month)
      .eq("discount_type", "CANCELAMENTO_SEGURO")
      .eq("status", "APPLIED")
      .limit(1);
    if (pagasError) throw pagasError;

    if ((pagas || []).length > 0) {
      return {
        executado: false,
        motivo: `competencia ${competencia} ja tem parcela de cancelamento APLICADA; debitos automaticos nao reprocessados`,
      };
    }

    const { resolveInsuranceDebits } = await import("./debitInsuranceResolver.ts");
    const plan = await resolveInsuranceDebits(supabaseAdmin as any, {
      year,
      month,
      dryRun: false,
      createdBy: createdBy ?? "import-fechamento",
    });
    return { executado: true, criados: plan.debits.length, fila: plan.fila.length };
  } catch (e: any) {
    return { executado: false, aviso: `Falha ao persistir debitos automaticos: ${e?.message || e}` };
  }
}
