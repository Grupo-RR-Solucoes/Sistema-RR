import * as XLSX from "xlsx";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildClosingAnalytics } from "@/lib/closingAnalytics";
import { buildFinancialAnalytics } from "@/lib/financialAnalytics";
import {
  buildPromoterAnalytics,
  loadPromoterAnalyticsBase,
  selectPromoterView,
} from "@/lib/promoterAnalytics";
// analyticsRegimeArgs mora em cmsMonthly (ao lado do detectMonthRegime): a derivacao
// de closed/closedSource E parte da regra de regime, e um so lugar a define.
import { detectMonthRegime, analyticsRegimeArgs, type MonthRegime } from "@/lib/cmsMonthly";
import {
  buildCmsProposalRows,
  buildCmsProposalRowsBatch,
  isColetivaJKey,
  COLETIVA_MASK,
} from "@/lib/promoterReportData";
// Linhas do fechamento — a MESMA funcao que /api/promotores:208 e o proposals GET usam.
import { buildClosingProposalRows } from "@/lib/closingProposalRows";
import { construirXlsxNavy, type Aba } from "@/lib/xlsxReport";

export type ReportKind = "financeiro" | "fechamento" | "auditoria" | "promotores" | "seguro";
export type ReportFormat = "pdf" | "xlsx";
export type PromoterReportScope = "geral" | "individual";

export type ReportFilters = {
  year?: number;
  month?: number;
  companyId?: string;
  promoterId?: string;
  scope?: string;
  // ETAPA 7 (geral/equipe) — ordenacao do ranking: "percent" (default) | "receber" | "producao".
  order?: string;
};

export type PromoterTeamOrder = "percent" | "receber" | "producao";

export type ReportPreviewPayload = {
  reportType: ReportKind;
  title: string;
  description: string;
  sourceHref: string;
  sourceLabel: string;
  periods: Array<{ key: string; label: string; year: number; month: number }>;
  selectedPeriod: { key: string; label: string; year: number; month: number } | null;
  selectedCompanyId: string;
  selectedPromoterId: string;
  reportScope: PromoterReportScope | null;
  companies: Array<{ id: string; name: string }>;
  promoters: Array<{ id: string; name: string }>;
  cards: Array<{ label: string; value: string; detail: string }>;
  sections: string[];
  alerts: string[];
};

type ExportBundle = {
  buffer: Buffer;
  contentType: string;
  fileName: string;
};

type AuditView = {
  periods: Array<{ key: string; label: string; year: number; month: number }>;
  selectedPeriod: { key: string; label: string; year: number; month: number } | null;
  summary: {
    periodLabel: string;
    expectedTotal: number;
    actualNet: number;
    deltaTotal: number;
    forecastCoveragePercent: number;
    fullForecastCoveragePercent: number;
  };
  highlights: Array<{
    empresa_nome: string;
    empresa_cnpj: string;
    deltaTotal: number;
    expectedTotal: number;
    actualNet: number;
  }>;
  alerts: string[];
  rows: Array<{
    empresa_nome: string;
    empresa_cnpj: string;
    expectedTotal: number;
    actualNet: number;
    deltaCash: number;
    deltaPrt: number;
    deltaInsurance: number;
    deltaTotal: number;
    forecastCoveragePercent: number;
    severity: "ok" | "atencao" | "critico";
  }>;
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function slugify(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function formatCurrency(value?: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(toNumber(value));
}

function formatPercent(value?: number) {
  return `${toNumber(value).toFixed(1).replace(".", ",")}%`;
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat("pt-BR").format(toNumber(value));
}

function formatDate(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function normalizeStatusLabel(value?: string | null) {
  const status = normalizeText(value);

  if (status === "paid" || status === "pago") return "Paga";
  if (status === "planned" || status === "planejada") return "Planejada";
  if (status === "critico") return "Critico";
  if (status === "atencao") return "Atencao";
  if (status === "ok") return "Ok";

  return String(value || "-");
}

function normalizeReportKind(input?: string | null): ReportKind {
  const value = normalizeText(input || "financeiro");

  if (value === "financeiro") return "financeiro";
  if (value === "fechamento") return "fechamento";
  if (value === "auditoria") return "auditoria";
  if (value === "promotores") return "promotores";
  if (value === "seguro") return "seguro";

  throw new Error("Tipo de relatorio invalido.");
}

function normalizeReportFormat(input?: string | null): ReportFormat {
  const value = normalizeText(input || "pdf");

  if (value === "pdf") return "pdf";
  if (value === "xlsx" || value === "excel") return "xlsx";

  throw new Error("Formato de exportacao invalido.");
}

// Regime do mês p/ os relatórios: ABERTO(false)=LIVE_BASE (daily ao vivo),
// MOV 2 (Grupo B): o relatório passa a resolver o REGIME (enum), não o booleano.
//
// Por que isso muda número: o booleano só dizia "fechado", e o analytics era chamado
// SEM `closedSource`. Sem closedSource, promoterAnalytics cai no `.find()` legado —
// pega UMA linha do PMR por promotor, sem filtrar source. Promotor com linha RR
// (source 'fechamento') E linha ADS (source 'bbts') era TRUNCADO: entrava só uma das
// empresas. Com closedSource, o analytics soma as duas (consolidatedSummaryRows).
//
// Sem year/month explícitos => undefined (mantém o comportamento anterior).
// Erro/tabela ausente => 'open'.
async function resolveReportRegime(
  supabase: SupabaseClient,
  year?: number,
  month?: number
): Promise<MonthRegime | undefined> {
  if (!year || !month) return undefined;
  try {
    return await detectMonthRegime(supabase, year, month);
  } catch {
    return "open";
  }
}

/**
 * Linhas de proposta do mês FECHADO, por regime — o par que o /promotores e o
 * proposals GET já usam:
 *   'cms'        -> buildCmsProposalRows(Batch)   (jan-mai)
 *   'fechamento' -> buildClosingProposalRows      (jun+; é POR PROMOTOR, sem batch,
 *                   então paraleliza em blocos)
 * Antes o relatório mandava QUALQUER mês fechado no cms — e o cms não tem jun+,
 * então o PDF saía sem linha nenhuma nessas competências.
 */
async function buildClosedProposalRowsBatch(
  supabase: SupabaseClient,
  promoterIds: string[],
  year: number,
  month: number,
  regime: MonthRegime
): Promise<Map<string, Awaited<ReturnType<typeof buildCmsProposalRows>>>> {
  if (!promoterIds.length) return new Map();
  if (regime === "cms") {
    return await buildCmsProposalRowsBatch(supabase, promoterIds, year, month);
  }
  const out = new Map<string, Awaited<ReturnType<typeof buildCmsProposalRows>>>();
  for (let i = 0; i < promoterIds.length; i += 8) {
    const bloco = promoterIds.slice(i, i + 8);
    const listas = await Promise.all(
      bloco.map((pid) => buildClosingProposalRows(supabase, pid, year, month))
    );
    listas.forEach((list, k) => out.set(bloco[k], list));
  }
  return out;
}

function normalizePromoterReportScope(input?: string | null): PromoterReportScope {
  const value = normalizeText(input || "geral");

  if (value === "geral" || value === "general") return "geral";
  if (value === "individual" || value === "ind") return "individual";

  return "geral";
}

function makeAuditView(closing: Awaited<ReturnType<typeof buildClosingAnalytics>>): AuditView {
  const rows = closing.companyRows
    .map((row) => {
      const severity: AuditView["rows"][number]["severity"] =
        Math.abs(row.deltaTotal) >= 10000
          ? "critico"
          : Math.abs(row.deltaTotal) >= 3000
            ? "atencao"
            : "ok";

      return {
        empresa_nome: row.empresa_nome,
        empresa_cnpj: row.empresa_cnpj,
        expectedTotal: row.expectedTotal,
        actualNet: row.actualNet,
        deltaCash: row.deltaCash,
        deltaPrt: row.deltaPrt,
        deltaInsurance: row.deltaInsurance,
        deltaTotal: row.deltaTotal,
        forecastCoveragePercent: row.forecastCoveragePercent,
        severity,
      };
    })
    .sort((a, b) => Math.abs(b.deltaTotal) - Math.abs(a.deltaTotal));

  return {
    periods: closing.periods,
    selectedPeriod: closing.selectedPeriod,
    summary: {
      periodLabel: closing.summary.periodLabel,
      expectedTotal: closing.summary.expectedTotal,
      actualNet: closing.summary.actualNet,
      deltaTotal: closing.summary.deltaTotal,
      forecastCoveragePercent: closing.summary.forecastCoveragePercent,
      fullForecastCoveragePercent: closing.summary.fullForecastCoveragePercent,
    },
    highlights: closing.highlights,
    alerts: closing.alerts,
    rows,
  };
}

function createWorkbook() {
  return XLSX.utils.book_new();
}

function buildColumnWidths(rows: Array<Record<string, unknown>>) {
  const sampleRows = rows.length > 0 ? rows : [{ Info: "Sem dados" }];
  const keys = Object.keys(sampleRows[0] || {});

  return keys.map((key) => {
    const contentWidth = sampleRows.reduce((max, row) => {
      const value = row[key];
      const text =
        value === null || value === undefined
          ? ""
          : typeof value === "number"
            ? String(value)
            : String(value);
      return Math.max(max, text.length);
    }, key.length);

    return { wch: Math.min(Math.max(contentWidth + 2, 12), 38) };
  });
}

function appendSheet(
  workbook: XLSX.WorkBook,
  name: string,
  rows: Array<Record<string, unknown>>
) {
  const normalizedRows = rows.length > 0 ? rows : [{ Info: "Sem dados para este relatorio." }];
  const worksheet = XLSX.utils.json_to_sheet(normalizedRows);

  worksheet["!cols"] = buildColumnWidths(normalizedRows);
  XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31));
}

function workbookToBuffer(workbook: XLSX.WorkBook) {
  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;
}

function ensureSpace(doc: any, minHeight = 48) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom - minHeight;
  if (doc.y > bottomLimit) {
    doc.addPage();
  }
}

function addPdfHeader(doc: any, title: string, subtitle: string) {
  doc.font("Helvetica-Bold").fontSize(22).fillColor("#0b1633").text(title);
  doc.moveDown(0.25);
  doc.font("Helvetica").fontSize(10).fillColor("#4b5563").text(subtitle);
  doc.moveDown(1);
}

function addPdfMetrics(
  doc: any,
  title: string,
  metrics: Array<{ label: string; value: string; detail?: string }>
) {
  ensureSpace(doc, 120);

  doc.font("Helvetica-Bold").fontSize(14).fillColor("#0d4de3").text(title);
  doc.moveDown(0.5);

  metrics.forEach((metric) => {
    ensureSpace(doc, 42);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0b1633").text(metric.label);
    doc.font("Helvetica").fontSize(11).fillColor("#111827").text(metric.value);
    if (metric.detail) {
      doc.font("Helvetica").fontSize(9).fillColor("#6b7280").text(metric.detail);
    }
    doc.moveDown(0.6);
  });
}

function addPdfLines(
  doc: any,
  title: string,
  lines: string[],
  emptyMessage = "Sem dados para esta secao."
) {
  ensureSpace(doc, 80);

  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#0d4de3").text(title);
  doc.moveDown(0.45);

  const content = lines.length > 0 ? lines : [emptyMessage];

  content.forEach((line) => {
    ensureSpace(doc, 24);
    doc.font(lines.length > 0 ? "Courier" : "Helvetica")
      .fontSize(lines.length > 0 ? 8.5 : 10)
      .fillColor(lines.length > 0 ? "#111827" : "#6b7280")
      .text(line);
  });

  doc.moveDown(0.8);
}

async function pdfToBuffer(
  render: (doc: any) => void,
  options?: { layout?: "portrait" | "landscape" }
) {
  const PDFDocument = require("pdfkit/js/pdfkit.standalone.js");

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: options?.layout || "portrait",
      margin: 40,
      bufferPages: true,
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Uint8Array | Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    render(doc);
    doc.end();
  });
}

function buildFileName(
  type: ReportKind,
  format: ReportFormat,
  periodLabel?: string | null,
  suffix?: string
) {
  const periodToken = periodLabel ? slugify(periodLabel) : "sem-competencia";
  const suffixToken = suffix ? `-${slugify(suffix)}` : "";
  const extension = format === "pdf" ? "pdf" : "xlsx";

  return `relatorio-${type}-${periodToken}${suffixToken}.${extension}`;
}

function buildFinanceWorkbook(
  data: Awaited<ReturnType<typeof buildFinancialAnalytics>>
) {
  const workbook = createWorkbook();

  appendSheet(workbook, "Resumo", [
    {
      Competencia: data.selectedPeriod.label,
      SaldoInicial: data.summary.openingBalance,
      RecebidoLiquido: data.summary.receivedNet,
      RecebidoVista: data.summary.actualCash,
      RecebidoPrt: data.summary.actualPrt,
      RecebidoSeguro: data.summary.actualInsurance,
      Estornos: data.summary.actualEstorno,
      Renovacoes: data.summary.actualRenewal,
      DespesasTotais: data.summary.totalExpenses,
      DespesasPagas: data.summary.paidExpenses,
      DespesasPendentes: data.summary.pendingExpenses,
      ResultadoOperacional: data.summary.operatingResult,
      SaldoCaixa: data.summary.cashBalance,
      CarteiraPrtFutura: data.summary.futureDeferredBalance,
    },
  ]);

  appendSheet(
    workbook,
    "Caixa",
    data.companyRows.map((row) => ({
      Escopo: row.scope === "GROUP" ? "Grupo" : "Empresa",
      Nome: row.label,
      CNPJ: row.cnpj || "",
      SaldoInicial: row.openingBalance,
      RecebidoLiquido: row.receivedNet,
      DespesasTotais: row.totalExpenses,
      DespesasPagas: row.paidExpenses,
      Resultado: row.netResult,
      Caixa: row.cashBalance,
    }))
  );

  appendSheet(
    workbook,
    "Despesas",
    data.expenseRows.map((row) => ({
      Descricao: row.description,
      Escopo: row.scope === "GROUP" ? "Grupo" : "Empresa",
      Empresa: row.company_name,
      CNPJ: row.company_cnpj || "",
      Categoria: row.category_name,
      Valor: row.amount,
      Status: normalizeStatusLabel(row.status),
      Vencimento: row.due_date || "",
      Pagamento: row.payment_date || "",
      Observacoes: row.notes || "",
    }))
  );

  appendSheet(
    workbook,
    "Saldos",
    data.openingBalanceRows.map((row) => ({
      Escopo: row.scope === "GROUP" ? "Grupo" : "Empresa",
      Empresa: row.company_name,
      CNPJ: row.company_cnpj || "",
      SaldoInicial: row.opening_balance,
      CriadoEm: row.created_at || "",
    }))
  );

  appendSheet(
    workbook,
    "Categorias",
    data.categoryTotals.map((row) => ({
      Categoria: row.label,
      Valor: row.value,
    }))
  );

  appendSheet(
    workbook,
    "Historico",
    data.cashTrend.map((row) => ({
      Competencia: row.label,
      SaldoInicial: row.openingBalance,
      RecebidoLiquido: row.receivedNet,
      DespesasTotais: row.totalExpenses,
      DespesasPagas: row.paidExpenses,
      Caixa: row.cashBalance,
    }))
  );

  return workbookToBuffer(workbook);
}

function buildClosingWorkbook(
  data: Awaited<ReturnType<typeof buildClosingAnalytics>>
) {
  const workbook = createWorkbook();

  appendSheet(workbook, "Resumo", [
    {
      Competencia: data.selectedPeriod?.label || "Sem competencia",
      PrevistoVista: data.summary.expectedCash,
      PrevistoPrt: data.summary.expectedPrt,
      PrevistoSeguro: data.summary.expectedInsurance,
      PrevistoTotal: data.summary.expectedTotal,
      RealVista: data.summary.actualCash,
      RealPrt: data.summary.actualPrt,
      RealSeguro: data.summary.actualInsurance,
      Estornos: data.summary.actualEstorno,
      Renovacoes: data.summary.actualRenewal,
      RealLiquido: data.summary.actualNet,
      GapTotal: data.summary.deltaTotal,
      ProducaoValida: data.summary.validProduction,
      Empresas: data.summary.companiesCount,
      Operacoes: data.summary.operations,
      CoberturaParcial: data.summary.forecastCoveragePercent,
      CoberturaCompleta: data.summary.fullForecastCoveragePercent,
      CarteiraPrtFutura: data.summary.futureDeferredBalance,
    },
  ]);

  appendSheet(
    workbook,
    "Empresas",
    data.companyRows.map((row) => ({
      Empresa: row.empresa_nome,
      CNPJ: row.empresa_cnpj,
      ProducaoBruta: row.grossProduction,
      ProducaoValida: row.validProduction,
      Operacoes: row.operations,
      PenetracaoSeguro: row.insurancePenetrationPercent,
      CoberturaParcial: row.forecastCoveragePercent,
      CoberturaCompleta: row.fullForecastCoveragePercent,
      PrevistoVista: row.expectedCash,
      PrevistoPrt: row.expectedPrt,
      PrevistoSeguro: row.expectedInsurance,
      PrevistoTotal: row.expectedTotal,
      RealVista: row.actualCash,
      RealPrt: row.actualPrt,
      RealSeguro: row.actualInsurance,
      Estornos: row.actualEstorno,
      Renovacoes: row.actualRenewal,
      RealLiquido: row.actualNet,
      GapVista: row.deltaCash,
      GapPrt: row.deltaPrt,
      GapSeguro: row.deltaInsurance,
      GapTotal: row.deltaTotal,
    }))
  );

  appendSheet(
    workbook,
    "Historico",
    data.trend.map((row) => ({
      Competencia: row.label,
      PrevistoTotal: row.expectedTotal,
      RealLiquido: row.actualNet,
      GapTotal: row.deltaTotal,
      PrevistoPrt: row.expectedPrt,
      RealPrt: row.actualPrt,
    }))
  );

  appendSheet(
    workbook,
    "Divergencias",
    data.highlights.map((row) => ({
      Empresa: row.empresa_nome,
      CNPJ: row.empresa_cnpj,
      PrevistoTotal: row.expectedTotal,
      RealLiquido: row.actualNet,
      GapTotal: row.deltaTotal,
    }))
  );

  return workbookToBuffer(workbook);
}

function buildAuditWorkbook(data: AuditView) {
  const workbook = createWorkbook();

  appendSheet(workbook, "Resumo", [
    {
      Competencia: data.selectedPeriod?.label || "Sem competencia",
      PrevistoTotal: data.summary.expectedTotal,
      RealLiquido: data.summary.actualNet,
      GapTotal: data.summary.deltaTotal,
      CoberturaParcial: data.summary.forecastCoveragePercent,
      CoberturaCompleta: data.summary.fullForecastCoveragePercent,
    },
  ]);

  appendSheet(
    workbook,
    "Fila",
    data.rows.map((row) => ({
      Empresa: row.empresa_nome,
      CNPJ: row.empresa_cnpj,
      Severidade: normalizeStatusLabel(row.severity),
      PrevistoTotal: row.expectedTotal,
      RealLiquido: row.actualNet,
      GapVista: row.deltaCash,
      GapPrt: row.deltaPrt,
      GapSeguro: row.deltaInsurance,
      GapTotal: row.deltaTotal,
      CoberturaParcial: row.forecastCoveragePercent,
    }))
  );

  appendSheet(
    workbook,
    "Top",
    data.highlights.map((row) => ({
      Empresa: row.empresa_nome,
      CNPJ: row.empresa_cnpj,
      PrevistoTotal: row.expectedTotal,
      RealLiquido: row.actualNet,
      GapTotal: row.deltaTotal,
    }))
  );

  return workbookToBuffer(workbook);
}

// ETAPA 7 — aba FIEL ao modelo LUCIANA MATIAS.xlsx (1 aba = a tela): banner
// META + 18 colunas MAIUSCULAS na ordem da tela + 3 linhas de total. Valores
// crus (numeros), data dd/mm/aaaa. Mascaramento da chave coletiva 552710 igual
// ao PromotorView. Espelha exatamente data.proposalRows (cms se mes fechado).
const FAITHFUL_HEADERS = [
  "CONTRATO", "VALOR BRUTO", "VALOR LÍQUIDO", "PARCELA", "AGENCIA", "CHAVE J",
  "PROMOTOR(A)", "DATA CONTRATAÇÃO", "TX JUROS", "DESCRIÇÃO DO PRODUTO",
  "% A VISTA", "COMISSÃO PF", "RESTRIÇÃO SRCC", "VALOR SEGURO", "COMISSÃO SEGURO",
  "% PENETRAÇÃO", "COMISSÃO PROMOTOR", "COMISSÃO SEGURO2",
];

function formatDateBR(value: string | null | undefined): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : v;
}

function appendFaithfulPromoterSheet(
  workbook: XLSX.WorkBook,
  data: Awaited<ReturnType<typeof buildPromoterAnalytics>>,
  selectedPromoter:
    | { promoter_name?: string; target_value?: number; production_value?: number }
    | null,
  // ETAPA 7 (lote, modo abas) — nome da aba ja resolvido pelo chamador (nome
  // reconhecivel + dedup de colisao). No individual fica undefined -> comportamento
  // original (nome do promotor cortado em 31).
  sheetNameOverride?: string
) {
  const proposals: any[] = (data.proposalRows as any[]) || [];
  const promoterName = selectedPromoter?.promoter_name || "";
  const target = Number(selectedPromoter?.target_value || 0);
  const achieved = Number(selectedPromoter?.production_value || 0);

  const metaRow: any[] = [
    target > 0 ? (achieved >= target ? "META ATINGIDA" : "META NÃO ATINGIDA") : "",
  ];

  const dataRows = proposals.map((row) => {
    const coletiva = isColetivaJKey(row.j_key);
    return [
      coletiva ? COLETIVA_MASK : row.contract_number || row.proposal_number || "",
      Number(row.gross_value ?? 0),
      Number(row.net_value ?? 0),
      Number(row.installment_count ?? 0),
      row.agency_code || "",
      coletiva ? COLETIVA_MASK : row.j_key || "",
      row.promoter_name || promoterName,
      coletiva ? COLETIVA_MASK : formatDateBR(row.contract_date || row.movement_date),
      Number(row.interest_rate ?? 0),
      row.product_description || "",
      Number(row.company_received_percent ?? 0),
      Number(row.company_commission_amount ?? 0),
      row.srcc_restriction || "",
      Number(row.insurance_value ?? 0),
      Number(row.company_insurance_commission_amount ?? 0),
      Number(row.insurance_penetration_percent ?? 0),
      Number(row.promoter_commission_amount ?? 0),
      Number(row.insurance_commission_amount ?? 0),
    ];
  });

  const totLiquido = proposals.reduce((s, r) => s + Number(r.net_value ?? 0), 0);
  const totProm = proposals.reduce((s, r) => s + Number(r.promoter_commission_amount ?? 0), 0);
  const totSeg = proposals.reduce((s, r) => s + Number(r.insurance_commission_amount ?? 0), 0);
  const blank = (): any[] => new Array(18).fill(null);
  const t1 = blank(); t1[1] = "TOTAL"; t1[2] = totLiquido;
  const t2 = blank(); t2[15] = "TOTAL"; t2[16] = totProm; t2[17] = totSeg;
  const t3 = blank(); t3[16] = "TOTAL GERAL"; t3[17] = totProm + totSeg;

  const ws = XLSX.utils.aoa_to_sheet([metaRow, FAITHFUL_HEADERS, ...dataRows, t1, t2, t3]);
  const sheetName =
    sheetNameOverride || (promoterName || "Relatorio").slice(0, 31) || "Relatorio";
  XLSX.utils.book_append_sheet(workbook, ws, sheetName);
}

// ============================================================
// ETAPA 7 (geral/equipe) — resumo de ranking: 1 linha por promotor ATIVO,
// agrupado por CNPJ com subtotais + total geral. Fonte = summaryRows (mes fechado
// ja reconciliado com cms; bate com cada individual). % atingido = producao/meta.
// ============================================================
type TeamTotals = {
  production_value: number;
  production_commission_value: number;
  insurance_commission_value: number;
  payable_commission_value: number;
  target_value: number;
};
type TeamRow = TeamTotals & {
  promoter_name: string;
  company_id: string;
  company_name: string;
  company_cnpj: string;
};
type TeamGroup = {
  company_id: string;
  company_name: string;
  company_cnpj: string;
  rows: TeamRow[];
  subtotal: TeamTotals;
};

function emptyTeamTotals(): TeamTotals {
  return {
    production_value: 0,
    production_commission_value: 0,
    insurance_commission_value: 0,
    payable_commission_value: 0,
    target_value: 0,
  };
}

function addTeamTotals(acc: TeamTotals, r: TeamTotals) {
  acc.production_value += toNumber(r.production_value);
  acc.production_commission_value += toNumber(r.production_commission_value);
  acc.insurance_commission_value += toNumber(r.insurance_commission_value);
  acc.payable_commission_value += toNumber(r.payable_commission_value);
  acc.target_value += toNumber(r.target_value);
}

// % atingido = producao / meta * 100. Sem meta no mes -> "—" (nao divide por zero).
function teamPercent(production: number, target: number): string {
  return target > 0 ? `${Math.round((production / target) * 100)}%` : "—";
}

function normalizeTeamOrder(order?: string): PromoterTeamOrder {
  if (order === "producao") return "producao";
  if (order === "receber") return "receber";
  return "percent";
}

// Valor de ordenacao por linha/subtotal conforme o criterio. No modo "percent",
// quem NAO tem meta (target=0) recebe -Infinity -> vai pro FIM (do grupo / da lista
// de grupos), sem dividir por zero.
function teamSortValue(t: TeamTotals, order: PromoterTeamOrder): number {
  if (order === "producao") return toNumber(t.production_value);
  if (order === "receber") return toNumber(t.payable_commission_value);
  return toNumber(t.target_value) > 0
    ? toNumber(t.production_value) / toNumber(t.target_value)
    : -Infinity;
}

function buildTeamGroups(
  data: Awaited<ReturnType<typeof buildPromoterAnalytics>>,
  order: PromoterTeamOrder
): { groups: TeamGroup[]; total: TeamTotals } {
  const active = data.summaryRows.filter((row) => row.active);

  const map = new Map<string, TeamGroup>();
  for (const row of active) {
    const key = row.company_id || row.company_cnpj || "—";
    let g = map.get(key);
    if (!g) {
      g = {
        company_id: row.company_id || "",
        company_name: row.company_name || "-",
        company_cnpj: row.company_cnpj || "",
        rows: [],
        subtotal: emptyTeamTotals(),
      };
      map.set(key, g);
    }
    g.rows.push({
      promoter_name: row.promoter_name,
      company_id: row.company_id || "",
      company_name: row.company_name || "-",
      company_cnpj: row.company_cnpj || "",
      production_value: toNumber(row.production_value),
      production_commission_value: toNumber(row.production_commission_value),
      insurance_commission_value: toNumber(row.insurance_commission_value),
      payable_commission_value: toNumber(row.payable_commission_value),
      target_value: toNumber(row.target_value),
    });
  }

  const total = emptyTeamTotals();
  const groups = Array.from(map.values());
  for (const g of groups) {
    // Ordena DENTRO do grupo (sem-meta no fim quando order=percent).
    g.rows.sort((a, b) => teamSortValue(b, order) - teamSortValue(a, order));
    for (const r of g.rows) addTeamTotals(g.subtotal, r);
    addTeamTotals(total, g.subtotal);
  }
  // Ordena os grupos pelo mesmo criterio (subtotal).
  groups.sort((a, b) => teamSortValue(b.subtotal, order) - teamSortValue(a.subtotal, order));

  return { groups, total };
}

// Aba "Equipe" — 8 colunas + subtotais por CNPJ (modo todos) + total geral.
function appendTeamSheet(
  workbook: XLSX.WorkBook,
  data: Awaited<ReturnType<typeof buildPromoterAnalytics>>,
  order: PromoterTeamOrder
) {
  const { groups, total } = buildTeamGroups(data, order);
  const multi = groups.length > 1;
  const header = [
    "Promotor",
    "CNPJ",
    "Producao",
    "Comissao promotor",
    "Comissao seguro",
    "Total a receber",
    "Meta",
    "% atingido",
  ];
  const aoa: any[][] = [header];

  for (const g of groups) {
    for (const r of g.rows) {
      aoa.push([
        r.promoter_name,
        r.company_cnpj,
        r.production_value,
        r.production_commission_value,
        r.insurance_commission_value,
        r.payable_commission_value,
        r.target_value,
        teamPercent(r.production_value, r.target_value),
      ]);
    }
    if (multi) {
      aoa.push([
        `SUBTOTAL ${g.company_name}`,
        g.company_cnpj,
        g.subtotal.production_value,
        g.subtotal.production_commission_value,
        g.subtotal.insurance_commission_value,
        g.subtotal.payable_commission_value,
        g.subtotal.target_value,
        teamPercent(g.subtotal.production_value, g.subtotal.target_value),
      ]);
      aoa.push([]);
    }
  }
  aoa.push([
    "TOTAL GERAL",
    "",
    total.production_value,
    total.production_commission_value,
    total.insurance_commission_value,
    total.payable_commission_value,
    total.target_value,
    teamPercent(total.production_value, total.target_value),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Moeda BRL nas colunas de valor (Producao, Comissao promotor, Comissao seguro,
  // Total a receber, Meta) — MANTEM o numero real na celula (somavel/ordenavel),
  // so aplica formato de exibicao. % atingido (col 7) fica texto.
  const MONEY_FMT = 'R$ #,##0.00';
  const MONEY_COLS = [2, 3, 4, 5, 6];
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  for (let R = 1; R <= range.e.r; R++) {
    for (const C of MONEY_COLS) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === "n") cell.z = MONEY_FMT;
    }
  }
  ws["!cols"] = [
    { wch: 30 }, // Promotor
    { wch: 20 }, // CNPJ
    { wch: 16 }, // Producao
    { wch: 16 }, // Comissao promotor
    { wch: 14 }, // Comissao seguro
    { wch: 16 }, // Total a receber
    { wch: 16 }, // Meta
    { wch: 11 }, // % atingido
  ];

  XLSX.utils.book_append_sheet(workbook, ws, "Equipe");
}

function buildPromoterWorkbook(
  data: Awaited<ReturnType<typeof buildPromoterAnalytics>>,
  scope: PromoterReportScope,
  order: PromoterTeamOrder = "percent"
) {
  const workbook = createWorkbook();
  const selectedPromoter =
    data.summaryRows.find((row) => row.promoter_id === data.selectedPromoterId) || null;

  // ETAPA 7 — PRIMEIRA aba: fiel ao modelo (individual) OU Equipe (geral). As abas
  // Resumo/Promotores/Individual/Detalhamento/Descontos/Acordos vêm depois.
  if (scope === "individual") {
    appendFaithfulPromoterSheet(workbook, data, selectedPromoter);
  } else {
    appendTeamSheet(workbook, data, order);
  }

  appendSheet(workbook, "Resumo", [
    {
      Competencia: data.selectedPeriod.label,
      TipoRelatorio: scope === "geral" ? "Geral" : "Individual",
      EmpresaFiltrada:
        scope === "geral" ? (data.selectedCompanyId ? selectedPromoter?.company_name || "Filtrada" : "Todas") : selectedPromoter?.company_name || "Nao selecionada",
      PromotorDetalhado:
        scope === "individual"
          ? selectedPromoter?.promoter_name || "Nao selecionado"
          : "Equipe consolidada",
      Promotores: data.summary.promoters,
      Producao: data.summary.production,
      ComissaoBruta: data.summary.finalCommission,
      ComissaoPagar: data.summary.payableCommission,
      Descontos: data.summary.discounts,
      PenetracaoMediaSeguro: data.summary.averageInsurancePenetration,
    },
  ]);

  appendSheet(
    workbook,
    "Promotores",
    data.summaryRows.map((row) => ({
      Promotor: row.promoter_name,
      Empresa: row.company_name,
      CNPJ: row.company_cnpj,
      ChavesJ: row.j_keys_count,
      Propostas: row.proposal_count,
      Producao: row.production_value,
      PenetracaoSeguro: row.insurance_penetration_percent,
      Meta: row.target_value,
      Meta1: row.target_1_value,
      Meta2: row.target_2_value,
      StatusMeta: row.target_status,
      ComissaoProducao: row.production_commission_value,
      ComissaoSeguro: row.insurance_commission_value,
      AjusteComercial: row.agreement_adjustment_value,
      Descontos: row.discount_value,
      ComissaoBruta: row.final_commission_value,
      ComissaoPagar: row.payable_commission_value,
      Origem: row.result_source,
      Situacao: row.status,
      Ativo: row.active ? "Sim" : "Nao",
    }))
  );

  if (scope === "individual") {
    appendSheet(workbook, "Individual", [
      {
        Promotor: selectedPromoter?.promoter_name || "Nao selecionado",
        Empresa: selectedPromoter?.company_name || "-",
        CNPJ: selectedPromoter?.company_cnpj || "",
        Producao: selectedPromoter?.production_value || 0,
        Propostas: selectedPromoter?.proposal_count || 0,
        PenetracaoSeguro: selectedPromoter?.insurance_penetration_percent || 0,
        Meta: selectedPromoter?.target_value || 0,
        Meta1: selectedPromoter?.target_1_value || 0,
        Meta2: selectedPromoter?.target_2_value || 0,
        StatusMeta: selectedPromoter?.target_status || "-",
        ComissaoProducao: selectedPromoter?.production_commission_value || 0,
        ComissaoSeguro: selectedPromoter?.insurance_commission_value || 0,
        AjusteComercial: selectedPromoter?.agreement_adjustment_value || 0,
        Descontos: selectedPromoter?.discount_value || 0,
        ComissaoBruta: selectedPromoter?.final_commission_value || 0,
        ComissaoPagar: selectedPromoter?.payable_commission_value || 0,
      },
    ]);

    appendSheet(
      workbook,
      "Detalhamento",
      data.proposalRows.map((row) => ({
        Contrato: row.contract_number,
        ValorBruto: row.gross_value,
        ValorLiquido: row.net_value,
        Parcela: row.installment_count,
        Agencia: row.agency_code,
        ChaveJ: row.j_key,
        Promotor: row.promoter_name,
        DataContratacao: row.contract_date || "",
        TxJuros: row.interest_rate,
        DescricaoProduto: row.product_description,
        PercentualAVista: row.company_received_percent,
        ComissaoPF: row.company_commission_amount,
        RestricaoSRCC: row.srcc_restriction,
        ValorSeguro: row.insurance_value,
        ComissaoSeguroEmpresa: row.company_insurance_commission_amount,
        PercentualPenetracao: row.insurance_penetration_percent,
        ComissaoPromotor: row.promoter_commission_amount,
        ComissaoSeguroPromotor: row.insurance_commission_amount,
        Regra: row.commission_rule_source,
      }))
    );

    appendSheet(
      workbook,
      "Descontos",
      data.discountRows.map((row) => ({
        Tipo: row.discount_type,
        Proposta: row.proposal_number,
        Parcela: `${row.installment_number}/${row.installments}`,
        Valor: row.amount,
        Destino: row.apply_to_company ? "Empresa" : "Promotor",
        Observacao: row.notes,
      }))
    );

    appendSheet(
      workbook,
      "Acordos",
      data.agreementRows.map((row) => ({
        Tipo: row.agreement_type,
        Formato: row.commission_type,
        Valor: row.commission_value,
        Observacao: row.notes,
      }))
    );
  }

  return workbookToBuffer(workbook);
}

async function buildFinancePdf(
  data: Awaited<ReturnType<typeof buildFinancialAnalytics>>
) {
  return pdfToBuffer((doc) => {
    addPdfHeader(
      doc,
      `Relatorio Financeiro - ${data.selectedPeriod.label}`,
      "Grupo RR | consolidado do caixa, despesas e PRT futuro"
    );

    addPdfMetrics(doc, "Resumo financeiro", [
      {
        label: "Saldo inicial",
        value: formatCurrency(data.summary.openingBalance),
      },
      {
        label: "Recebido real",
        value: formatCurrency(data.summary.receivedNet),
      },
      {
        label: "Despesas do mes",
        value: `${formatCurrency(data.summary.totalExpenses)} | pagas ${formatCurrency(
          data.summary.paidExpenses
        )}`,
      },
      {
        label: "Saldo de caixa",
        value: formatCurrency(data.summary.cashBalance),
        detail: `PRT futuro em ${formatCurrency(data.summary.futureDeferredBalance)}`,
      },
    ]);

    addPdfLines(
      doc,
      "Caixa por escopo",
      data.companyRows.map(
        (row) =>
          `${row.label} | Recebido ${formatCurrency(row.receivedNet)} | Despesas ${formatCurrency(
            row.totalExpenses
          )} | Caixa ${formatCurrency(row.cashBalance)}`
      )
    );

    addPdfLines(
      doc,
      "Despesas do mes",
      data.expenseRows.map(
        (row) =>
          `${row.description} | ${row.company_name} | ${row.category_name} | ${formatCurrency(
            row.amount
          )} | ${normalizeStatusLabel(row.status)}`
      )
    );

    addPdfLines(
      doc,
      "Saldos iniciais",
      data.openingBalanceRows.map(
        (row) => `${row.company_name} | ${formatCurrency(row.opening_balance)}`
      )
    );

    addPdfLines(doc, "Alertas", data.alerts);
  });
}

async function buildClosingPdf(
  data: Awaited<ReturnType<typeof buildClosingAnalytics>>
) {
  return pdfToBuffer((doc) => {
    addPdfHeader(
      doc,
      `Relatorio de Fechamento - ${data.selectedPeriod?.label || "Sem competencia"}`,
      "Grupo RR | previsto x recebido por empresa, seguro e PRT"
    );

    addPdfMetrics(doc, "Resumo do mes", [
      {
        label: "Previsto total",
        value: formatCurrency(data.summary.expectedTotal),
      },
      {
        label: "Recebido liquido",
        value: formatCurrency(data.summary.actualNet),
      },
      {
        label: "Gap total",
        value: formatCurrency(data.summary.deltaTotal),
      },
      {
        label: "Carteira futura",
        value: formatCurrency(data.summary.futureDeferredBalance),
      },
    ]);

    addPdfLines(
      doc,
      "Previsto x recebido por empresa",
      data.companyRows.map(
        (row) =>
          `${row.empresa_nome} | Base ${formatCurrency(row.validProduction)} | Prev ${formatCurrency(
            row.expectedTotal
          )} | Real ${formatCurrency(row.actualNet)} | Gap ${formatCurrency(row.deltaTotal)}`
      )
    );

    addPdfLines(
      doc,
      "Historico recente",
      data.trend.map(
        (row) =>
          `${row.label} | Previsto ${formatCurrency(row.expectedTotal)} | Real ${formatCurrency(
            row.actualNet
          )} | Gap ${formatCurrency(row.deltaTotal)}`
      )
    );

    addPdfLines(
      doc,
      "Maiores divergencias",
      data.highlights.map(
        (row) =>
          `${row.empresa_nome} | Prev ${formatCurrency(row.expectedTotal)} | Real ${formatCurrency(
            row.actualNet
          )} | Gap ${formatCurrency(row.deltaTotal)}`
      )
    );

    addPdfLines(doc, "Alertas", data.alerts);
  });
}

async function buildAuditPdf(data: AuditView) {
  return pdfToBuffer((doc) => {
    addPdfHeader(
      doc,
      `Relatorio de Auditoria - ${data.selectedPeriod?.label || "Sem competencia"}`,
      "Grupo RR | fila de conferencia para fechamento, PRT e seguro"
    );

    addPdfMetrics(doc, "Resumo da auditoria", [
      {
        label: "Previsto total",
        value: formatCurrency(data.summary.expectedTotal),
      },
      {
        label: "Real liquido",
        value: formatCurrency(data.summary.actualNet),
      },
      {
        label: "Gap consolidado",
        value: formatCurrency(data.summary.deltaTotal),
      },
      {
        label: "Cobertura completa",
        value: formatPercent(data.summary.fullForecastCoveragePercent),
      },
    ]);

    addPdfLines(
      doc,
      "Fila de verificacao",
      data.rows.map(
        (row) =>
          `${normalizeStatusLabel(row.severity)} | ${row.empresa_nome} | Gap total ${formatCurrency(
            row.deltaTotal
          )} | Gap PRT ${formatCurrency(row.deltaPrt)} | Gap seguro ${formatCurrency(
            row.deltaInsurance
          )}`
      )
    );

    addPdfLines(
      doc,
      "Top divergencias",
      data.highlights.map(
        (row) =>
          `${row.empresa_nome} | Prev ${formatCurrency(row.expectedTotal)} | Real ${formatCurrency(
            row.actualNet
          )} | Gap ${formatCurrency(row.deltaTotal)}`
      )
    );

    addPdfLines(doc, "Alertas", data.alerts);
  });
}

// ETAPA 7 — PDF individual em PAISAGEM (modelo fiel LUCIANA, colunas essenciais
// pra leitura rapida no celular/WhatsApp). 11 colunas escolhidas por Diego; o
// xlsx mantem as 18 completas. Soma das larguras = 762pt (A4 landscape util).
type PdfFaithfulColumn = {
  key: string;
  header: string;
  width: number;
  align: "left" | "right";
  emphasis?: boolean;
};

const PDF_FAITHFUL_COLUMNS: PdfFaithfulColumn[] = [
  { key: "contract", header: "CONTRATO", width: 70, align: "left" },
  { key: "net", header: "VL. LÍQUIDO", width: 70, align: "right" },
  { key: "parcela", header: "PARC.", width: 38, align: "right" },
  { key: "jkey", header: "CHAVE J", width: 70, align: "left" },
  { key: "data", header: "DATA", width: 58, align: "left" },
  { key: "produto", header: "DESCRIÇÃO DO PRODUTO", width: 130, align: "left" },
  { key: "comPf", header: "COM. PF", width: 64, align: "right" },
  { key: "vlSeguro", header: "VL. SEGURO", width: 58, align: "right" },
  { key: "comSeguro", header: "COM. SEGURO", width: 62, align: "right" },
  { key: "comProm", header: "COM. PROMOTOR", width: 72, align: "right", emphasis: true },
  { key: "comSegProm", header: "COM. SEG. PROM.", width: 70, align: "right", emphasis: true },
];

const PDF_TABLE_WIDTH = PDF_FAITHFUL_COLUMNS.reduce((s, c) => s + c.width, 0); // 762

function num2BR(value: unknown) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

// Header das colunas — REPETE em cada pagina (anti-quebra). Retorna o novo y.
function drawPromoterTableHeader(doc: any, y: number, left: number) {
  const h = 20;
  doc.save();
  doc.rect(left, y, PDF_TABLE_WIDTH, h).fill("#0d4de3");
  doc.restore();

  let x = left;
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
  for (const col of PDF_FAITHFUL_COLUMNS) {
    doc.text(col.header, x + 3, y + 4, {
      width: col.width - 6,
      align: col.align,
      lineBreak: true,
    });
    x += col.width;
  }
  return y + h;
}

function drawPromoterTableRow(
  doc: any,
  row: Record<string, string>,
  y: number,
  left: number,
  index: number
) {
  const h = 13;
  if (index % 2 === 1) {
    doc.save();
    doc.rect(left, y, PDF_TABLE_WIDTH, h).fill("#f3f4f6");
    doc.restore();
  }

  let x = left;
  for (const col of PDF_FAITHFUL_COLUMNS) {
    doc.font(col.emphasis ? "Helvetica-Bold" : "Helvetica").fontSize(8);
    const maxW = col.width - 6;
    // Pre-trunca por largura medida + reticencia. Evita o caminho bugado do
    // pdfkit (ellipsis+lineBreak:false quebra texto largo em linhas sobrepostas
    // e embaralha os glifos). Aqui o texto ja entra cabendo numa linha so.
    let val = String(row[col.key] ?? "");
    if (doc.widthOfString(val) > maxW) {
      while (val.length > 1 && doc.widthOfString(val + "…") > maxW) {
        val = val.slice(0, -1);
      }
      val = `${val}…`;
    }
    doc
      .fillColor(col.emphasis ? "#0b1633" : "#111827")
      .text(val, x + 3, y + 3, { width: maxW, align: col.align, lineBreak: false });
    x += col.width;
  }

  doc.save();
  doc
    .lineWidth(0.3)
    .strokeColor("#e5e7eb")
    .moveTo(left, y + h)
    .lineTo(left + PDF_TABLE_WIDTH, y + h)
    .stroke();
  doc.restore();
  return y + h;
}

// Rodape: lista de DESCONTOS do promotor (esquerda) + caixa de totais (direita)
// terminando no LÍQUIDO A RECEBER = comissao bruta - descontos do promotor. O
// promotor ve o que recebe DE FATO, nao o bruto. Descontos com destino Empresa
// sao listados mas NAO reduzem o liquido do promotor (igual ao calculo do sistema:
// payable = final - descontos com apply_to_company !== true).
function drawPromoterFooter(
  doc: any,
  y: number,
  left: number,
  d: {
    totLiquido: number;
    totProm: number;
    totSeg: number;
    descPromotor: number;
    discounts: any[];
  }
) {
  const bruto = d.totProm + d.totSeg;
  const liquido = bruto - d.descPromotor;

  // Caixa de totais (direita).
  const boxW = 300;
  const lines: Array<[string, string, boolean]> = [
    ["TOTAL LÍQUIDO (produção)", num2BR(d.totLiquido), false],
    ["COMISSÃO PROMOTOR", num2BR(d.totProm), false],
    ["COMISSÃO SEGURO", num2BR(d.totSeg), false],
    ["COMISSÃO BRUTA", num2BR(bruto), false],
    ["(-) DESCONTOS", num2BR(d.descPromotor), false],
    ["LÍQUIDO A RECEBER", num2BR(liquido), true],
  ];
  const boxH = lines.length * 12 + 18;
  const bx = left + PDF_TABLE_WIDTH - boxW;

  doc.save();
  doc.roundedRect(bx, y, boxW, boxH, 4).lineWidth(0.6).strokeColor("#0d4de3").stroke();
  doc.restore();

  const pad = 12;
  const labelX = bx + pad;
  const valW = boxW - 2 * pad;
  let ty = y + 9;
  for (const [label, val, emph] of lines) {
    if (emph) {
      doc.save();
      doc.rect(bx + 1, ty - 3, boxW - 2, 16).fill("#eef2ff");
      doc.restore();
    }
    doc
      .font(emph ? "Helvetica-Bold" : "Helvetica")
      .fontSize(emph ? 11 : 9)
      .fillColor(emph ? "#0b1633" : "#374151");
    doc.text(label, labelX, ty, { width: valW * 0.62, align: "left", lineBreak: false });
    doc.text(val, labelX, ty, { width: valW, align: "right", lineBreak: false });
    ty += emph ? 15 : 12;
  }

  // Lista de descontos (esquerda).
  const lx = left;
  const listW = PDF_TABLE_WIDTH - boxW - 18;
  let ly = y;
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#0b1633")
    .text("DESCONTOS DO PROMOTOR", lx, ly);
  ly += 15;
  if (!d.discounts || d.discounts.length === 0) {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#6b7280")
      .text("Sem descontos lancados nesta competencia.", lx, ly, { width: listW });
  } else {
    doc.font("Helvetica").fontSize(9).fillColor("#374151");
    for (const row of d.discounts) {
      const destino = row.apply_to_company ? "Empresa" : "Promotor";
      const linha = `${row.discount_type || "OUTROS"}  |  ${row.proposal_number || "-"}  |  Parc ${row.installment_number}/${row.installments}  |  ${num2BR(row.amount)}  (${destino})`;
      doc.text(linha, lx, ly, { width: listW, lineBreak: false });
      ly += 12;
    }
  }
}

function buildPromoterIndividualPdf(
  data: Awaited<ReturnType<typeof buildPromoterAnalytics>>,
  selectedPromoter: { promoter_name?: string; company_name?: string; target_value?: number; production_value?: number; target_status?: string } | null
) {
  const proposals: any[] = (data.proposalRows as any[]) || [];
  const promoterName = selectedPromoter?.promoter_name || "Promotor";
  const target = Number(selectedPromoter?.target_value || 0);
  const achieved = Number(selectedPromoter?.production_value || 0);
  const metaLabel =
    target > 0 ? (achieved >= target ? "META ATINGIDA" : "META NÃO ATINGIDA") : "";

  // Mascaramento 552710 igual a aba fiel (PromotorView): oculta contrato, chave
  // J e data da chave coletiva. Os VALORES contam normalmente.
  const rows = proposals.map((row) => {
    const coletiva = isColetivaJKey(row.j_key);
    return {
      contract: coletiva
        ? COLETIVA_MASK
        : row.contract_number || row.proposal_number || "",
      net: num2BR(row.net_value),
      parcela: String(toNumber(row.installment_count) || ""),
      jkey: coletiva ? COLETIVA_MASK : row.j_key || "",
      data: coletiva ? COLETIVA_MASK : formatDateBR(row.contract_date || row.movement_date),
      produto: row.product_description || "",
      comPf: num2BR(row.company_commission_amount),
      vlSeguro: num2BR(row.insurance_value),
      comSeguro: num2BR(row.company_insurance_commission_amount),
      comProm: num2BR(row.promoter_commission_amount),
      comSegProm: num2BR(row.insurance_commission_amount),
    };
  });

  const totLiquido = proposals.reduce((s, r) => s + toNumber(r.net_value), 0);
  const totProm = proposals.reduce((s, r) => s + toNumber(r.promoter_commission_amount), 0);
  const totSeg = proposals.reduce((s, r) => s + toNumber(r.insurance_commission_amount), 0);

  return pdfToBuffer(
    (doc) => {
      const left = doc.page.margins.left;
      const topMargin = doc.page.margins.top;
      const bottom = doc.page.height - doc.page.margins.bottom;
      const ROW_H = 13;

      // Cabecalho do relatorio (so na 1a pagina).
      doc
        .font("Helvetica-Bold")
        .fontSize(16)
        .fillColor("#0b1633")
        .text(`Relatorio do Promotor — ${promoterName}`, left, topMargin, {
          width: PDF_TABLE_WIDTH,
        });
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#4b5563")
        .text(
          `Grupo RR  |  Competencia ${data.selectedPeriod.label}${
            selectedPromoter?.company_name ? `  |  ${selectedPromoter.company_name}` : ""
          }`,
          { width: PDF_TABLE_WIDTH }
        );
      doc.moveDown(0.4);

      if (metaLabel) {
        const atingida = metaLabel === "META ATINGIDA";
        const bw = 170;
        const bh = 18;
        const by = doc.y;
        doc.save();
        doc.roundedRect(left, by, bw, bh, 4).fill(atingida ? "#16a34a" : "#9ca3af");
        doc.restore();
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor("#ffffff")
          .text(metaLabel, left, by + 5, { width: bw, align: "center" });
        doc.y = by + bh + 8;
      } else {
        doc.moveDown(0.4);
      }

      // Tabela.
      let y = drawPromoterTableHeader(doc, doc.y, left);
      for (let i = 0; i < rows.length; i++) {
        if (y + ROW_H > bottom) {
          doc.addPage(); // herda landscape
          y = drawPromoterTableHeader(doc, topMargin, left);
        }
        y = drawPromoterTableRow(doc, rows[i], y, left, i);
      }
      if (rows.length === 0) {
        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#6b7280")
          .text("Sem propostas nesta competencia.", left + 3, y + 4, {
            width: PDF_TABLE_WIDTH,
          });
        y += 20;
      }

      // Rodape: descontos + liquido a receber. Garante espaco; senao, nova pagina.
      const discounts = (data.discountRows as any[]) || [];
      const descPromotor = discounts
        .filter((row) => row.apply_to_company !== true)
        .reduce((s, row) => s + toNumber(row.amount), 0);
      const footerH = Math.max(100, 40 + discounts.length * 12);
      if (y + footerH > bottom) {
        doc.addPage();
        y = topMargin;
      }
      drawPromoterFooter(doc, y + 8, left, {
        totLiquido,
        totProm,
        totSeg,
        descPromotor,
        discounts,
      });
    },
    { layout: "landscape" }
  );
}

// ETAPA 7 — PDF GERAL/EQUIPE em paisagem: tabela de ranking (8 colunas), agrupada
// por CNPJ com subtotais + total geral. Header das colunas repete em cada pagina.
const PDF_GERAL_COLUMNS: PdfFaithfulColumn[] = [
  { key: "promotor", header: "PROMOTOR", width: 198, align: "left" },
  { key: "cnpj", header: "CNPJ", width: 116, align: "left" },
  { key: "producao", header: "PRODUÇÃO", width: 82, align: "right" },
  { key: "comProm", header: "COM. PROMOTOR", width: 80, align: "right" },
  { key: "comSeg", header: "COM. SEGURO", width: 72, align: "right" },
  { key: "receber", header: "TOTAL A RECEBER", width: 92, align: "right", emphasis: true },
  { key: "meta", header: "META", width: 82, align: "right" },
  { key: "pct", header: "%", width: 40, align: "right" },
];
const PDF_GERAL_WIDTH = PDF_GERAL_COLUMNS.reduce((s, c) => s + c.width, 0); // 762
const GERAL_ROW_H = 14;

function drawGeralColumnsHeader(doc: any, y: number, left: number) {
  const h = 20;
  doc.save();
  doc.rect(left, y, PDF_GERAL_WIDTH, h).fill("#0d4de3");
  doc.restore();
  let x = left;
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
  for (const col of PDF_GERAL_COLUMNS) {
    doc.text(col.header, x + 3, y + 5, { width: col.width - 6, align: col.align, lineBreak: true });
    x += col.width;
  }
  return y + h;
}

function drawGeralRow(
  doc: any,
  cells: string[],
  y: number,
  left: number,
  style: { bg?: string | null; bold?: boolean; topBorder?: boolean; color?: string }
) {
  const h = GERAL_ROW_H;
  if (style.bg) {
    doc.save();
    doc.rect(left, y, PDF_GERAL_WIDTH, h).fill(style.bg);
    doc.restore();
  }
  let x = left;
  for (let i = 0; i < PDF_GERAL_COLUMNS.length; i++) {
    const col = PDF_GERAL_COLUMNS[i];
    doc.font(style.bold || col.emphasis ? "Helvetica-Bold" : "Helvetica").fontSize(8);
    const maxW = col.width - 6;
    let val = String(cells[i] ?? "");
    if (doc.widthOfString(val) > maxW) {
      while (val.length > 1 && doc.widthOfString(val + "…") > maxW) val = val.slice(0, -1);
      val = `${val}…`;
    }
    doc.fillColor(style.color || "#111827").text(val, x + 3, y + 3, {
      width: maxW,
      align: col.align,
      lineBreak: false,
    });
    x += col.width;
  }
  doc.save();
  if (style.topBorder) {
    doc.lineWidth(0.6).strokeColor("#9ca3af").moveTo(left, y).lineTo(left + PDF_GERAL_WIDTH, y).stroke();
  } else {
    doc.lineWidth(0.3).strokeColor("#e5e7eb").moveTo(left, y + h).lineTo(left + PDF_GERAL_WIDTH, y + h).stroke();
  }
  doc.restore();
  return y + h;
}

function drawGeralGroupHeader(doc: any, label: string, y: number, left: number) {
  const h = 16;
  doc.save();
  doc.rect(left, y, PDF_GERAL_WIDTH, h).fill("#eef2ff");
  doc.restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor("#0b1633")
    .text(label, left + 4, y + 4, { width: PDF_GERAL_WIDTH - 8, lineBreak: false });
  return y + h;
}

function buildPromoterGeralPdf(
  data: Awaited<ReturnType<typeof buildPromoterAnalytics>>,
  order: PromoterTeamOrder
) {
  const { groups, total } = buildTeamGroups(data, order);
  const multi = groups.length > 1;
  const orderLabel =
    order === "producao" ? "produção" : order === "receber" ? "total a receber" : "% atingido";
  const nPromotores = groups.reduce((s, g) => s + g.rows.length, 0);

  const cellsFor = (r: TeamTotals & { name: string; cnpj: string }) => [
    r.name,
    r.cnpj,
    num2BR(r.production_value),
    num2BR(r.production_commission_value),
    num2BR(r.insurance_commission_value),
    num2BR(r.payable_commission_value),
    num2BR(r.target_value),
    teamPercent(r.production_value, r.target_value),
  ];

  return pdfToBuffer(
    (doc) => {
      const left = doc.page.margins.left;
      const topMargin = doc.page.margins.top;
      const bottom = doc.page.height - doc.page.margins.bottom;

      doc
        .font("Helvetica-Bold")
        .fontSize(16)
        .fillColor("#0b1633")
        .text(`Relatorio Geral de Promotores — ${data.selectedPeriod.label}`, left, topMargin, {
          width: PDF_GERAL_WIDTH,
        });
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#4b5563")
        .text(
          `Grupo RR  |  ${nPromotores} promotores ativos  |  ordenado por ${orderLabel}  |  total a receber ${num2BR(total.payable_commission_value)}`,
          { width: PDF_GERAL_WIDTH }
        );
      doc.moveDown(0.5);

      let y = drawGeralColumnsHeader(doc, doc.y, left);
      const ensure = (need: number) => {
        if (y + need > bottom) {
          doc.addPage();
          y = drawGeralColumnsHeader(doc, topMargin, left);
        }
      };

      let idx = 0;
      for (const g of groups) {
        if (multi) {
          ensure(16 + GERAL_ROW_H);
          y = drawGeralGroupHeader(doc, `${g.company_name}  —  ${g.company_cnpj}`, y, left);
        }
        for (const r of g.rows) {
          ensure(GERAL_ROW_H);
          y = drawGeralRow(doc, cellsFor({ ...r, name: r.promoter_name, cnpj: r.company_cnpj }), y, left, {
            bg: idx % 2 === 1 ? "#f3f4f6" : null,
          });
          idx++;
        }
        if (multi) {
          ensure(GERAL_ROW_H);
          y = drawGeralRow(
            doc,
            cellsFor({ ...g.subtotal, name: `Subtotal ${g.company_name}`, cnpj: g.company_cnpj }),
            y,
            left,
            { bold: true, topBorder: true, color: "#0b1633" }
          );
          y += 4;
        }
      }

      ensure(GERAL_ROW_H + 4);
      y = drawGeralRow(doc, cellsFor({ ...total, name: "TOTAL GERAL", cnpj: "" }), y, left, {
        bold: true,
        topBorder: true,
        bg: "#eef2ff",
        color: "#0b1633",
      });
    },
    { layout: "landscape" }
  );
}

async function buildPromoterPdf(
  data: Awaited<ReturnType<typeof buildPromoterAnalytics>>,
  scope: PromoterReportScope,
  order: PromoterTeamOrder = "percent"
) {
  const selectedPromoter =
    data.summaryRows.find((row) => row.promoter_id === data.selectedPromoterId) || null;

  // ETAPA 7 — ambos em paisagem: individual = tabela fiel; geral = ranking da equipe.
  if (scope === "individual") {
    return buildPromoterIndividualPdf(data, selectedPromoter);
  }
  return buildPromoterGeralPdf(data, order);
}

export async function buildReportPreview(
  supabase: SupabaseClient,
  input: ReportFilters & { type?: string | null }
): Promise<ReportPreviewPayload> {
  const reportType = normalizeReportKind(input.type);

  if (reportType === "financeiro") {
    const data = await buildFinancialAnalytics(supabase, input);

    return {
      reportType,
      title: "Financeiro consolidado",
      description:
        "Saida executiva para acompanhar caixa, despesas, recebido real e carteira futura de PRT.",
      sourceHref: "/financeiro",
      sourceLabel: "Abrir Financeiro",
      periods: data.periods,
      selectedPeriod: data.selectedPeriod,
      selectedCompanyId: "",
      selectedPromoterId: "",
      reportScope: null,
      companies: data.companies.map((company) => ({
        id: company.id,
        name: company.name,
      })),
      promoters: [],
      cards: [
        {
          label: "Recebido real",
          value: formatCurrency(data.summary.receivedNet),
          detail: "Fechamento liquido consolidado desta competencia.",
        },
        {
          label: "Despesas",
          value: formatCurrency(data.summary.totalExpenses),
          detail: `Pagas ${formatCurrency(data.summary.paidExpenses)} e pendentes ${formatCurrency(
            data.summary.pendingExpenses
          )}.`,
        },
        {
          label: "Saldo de caixa",
          value: formatCurrency(data.summary.cashBalance),
          detail: "Saldo inicial + recebido real - despesas pagas.",
        },
        {
          label: "Carteira PRT",
          value: formatCurrency(data.summary.futureDeferredBalance),
          detail: "Saldo futuro ainda nao liquidado.",
        },
      ],
      sections: [
        "Resumo financeiro consolidado do grupo.",
        "Caixa por empresa e por grupo.",
        "Despesas do mes com categoria, status e datas.",
        "Saldos iniciais e historico de caixa.",
      ],
      alerts: data.alerts,
    };
  }

  if (reportType === "fechamento") {
    const data = await buildClosingAnalytics(supabase, input);

    return {
      reportType,
      title: "Fechamento mensal",
      description:
        "Relatorio de previsto x recebido, separando a vista, seguro, PRT e gap por empresa.",
      sourceHref: "/fechamento",
      sourceLabel: "Abrir Fechamento",
      periods: data.periods,
      selectedPeriod: data.selectedPeriod,
      selectedCompanyId: "",
      selectedPromoterId: "",
      reportScope: null,
      companies: [],
      promoters: [],
      cards: [
        {
          label: "Previsto total",
          value: formatCurrency(data.summary.expectedTotal),
          detail: "Soma da previsao a vista, seguro e PRT.",
        },
        {
          label: "Recebido liquido",
          value: formatCurrency(data.summary.actualNet),
          detail: "Valor efetivamente recebido no fechamento real.",
        },
        {
          label: "Gap do mes",
          value: formatCurrency(data.summary.deltaTotal),
          detail: "Diferenca entre previsto total e real liquido.",
        },
        {
          label: "Carteira PRT futura",
          value: formatCurrency(data.summary.futureDeferredBalance),
          detail: "Saldo pendente do PRT ainda nao liquidado.",
        },
      ],
      sections: [
        "Resumo executivo da competencia.",
        "Detalhamento por empresa com previsto e realizado.",
        "Historico recente da evolucao mensal.",
        "Lista das maiores divergencias.",
      ],
      alerts: data.alerts,
    };
  }

  if (reportType === "auditoria") {
    const audit = makeAuditView(await buildClosingAnalytics(supabase, input));
    const criticalCount = audit.rows.filter((row) => row.severity === "critico").length;

    return {
      reportType,
      title: "Auditoria de fechamento",
      description:
        "Fila de conferencia priorizando gaps relevantes, divergencias de PRT e cobertura da previsao.",
      sourceHref: "/auditoria",
      sourceLabel: "Abrir Auditoria",
      periods: audit.periods,
      selectedPeriod: audit.selectedPeriod,
      selectedCompanyId: "",
      selectedPromoterId: "",
      reportScope: null,
      companies: [],
      promoters: [],
      cards: [
        {
          label: "Gap consolidado",
          value: formatCurrency(audit.summary.deltaTotal),
          detail: "Diferenca total entre previsto e recebido liquido.",
        },
        {
          label: "Empresas auditadas",
          value: formatNumber(audit.rows.length),
          detail: `${formatNumber(criticalCount)} com severidade critica.`,
        },
        {
          label: "Cobertura parcial",
          value: formatPercent(audit.summary.forecastCoveragePercent),
          detail: "Parte da base com previsao suficiente para auditoria.",
        },
        {
          label: "Cobertura completa",
          value: formatPercent(audit.summary.fullForecastCoveragePercent),
          detail: "Operacoes com taxa e prazo suficientes para previsao integral.",
        },
      ],
      sections: [
        "Resumo consolidado da auditoria.",
        "Fila priorizada por severidade e gap total.",
        "Comparativo de gap por camada: a vista, PRT e seguro.",
        "Top divergencias para verificacao imediata.",
      ],
      alerts: audit.alerts,
    };
  }

  // ============================================================
  // SEGURO / SEGURIDADE — relatorio dedicado, SO fontes DB-driven:
  //   Por promotor  -> buildPromoterAnalytics (PMR via loadPromoterAnalyticsBase)
  //   Por empresa   -> fechamento_mensal_empresa.valor_seguro (query direta)
  //   Por contrato  -> proposalRows (daily_production_records via insurance_slip_rules)
  // NUNCA buildClosingAnalytics / getInsurancePercentByTerm (legado proibido).
  // ============================================================
  if (reportType === "seguro") {
    const regime = await resolveReportRegime(supabase, input.year, input.month);
    const data = await buildPromoterAnalytics(supabase, {
      year: input.year,
      month: input.month,
      companyId: input.companyId,
      promoterId: input.promoterId,
      ...analyticsRegimeArgs(regime),
    });
    const year = data.selectedPeriod?.year ?? input.year;
    const month = data.selectedPeriod?.month ?? input.month;

    // Por promotor (DB-driven: PMR). summaryRows ja respeita companyId e o
    // promoterId opcional (visibleSummaryRows). Filtra ativos p/ casar com o
    // dashboard/projecao. §188 empresa por promotor (LIVE_BASE no aberto) = base
    // do total-empresa do grupo no aberto.
    const promoterRows = data.summaryRows.filter((row) => row.active !== false);
    const seguro188Empresa = promoterRows.reduce(
      (sum, row) => sum + toNumber(row.insurance_commission_value),
      0
    );
    const comProm = promoterRows.filter(
      (row) => toNumber(row.insurance_penetration_percent) > 0
    ).length;
    // Penetracao ponderada pela producao (nao media simples).
    let penNum = 0;
    let penDen = 0;
    for (const row of promoterRows) {
      const prod = toNumber(row.production_value);
      if (prod > 0) {
        penNum += toNumber(row.insurance_penetration_percent) * prod;
        penDen += prod;
      }
    }
    const penetracaoMedia = penDen > 0 ? penNum / penDen : 0;

    // Por empresa (DB-driven: fechamento_mensal_empresa.valor_seguro, competencia M).
    // Filtra pelo CNPJ da empresa selecionada, se houver companyId.
    const companyCnpj = (
      data.companies.find((company) => company.id === input.companyId) as
        | { cnpj?: string }
        | undefined
    )?.cnpj;
    let seguroEmpresas = 0;
    if (year && month) {
      let fechQuery = supabase
        .from("fechamento_mensal_empresa")
        .select("empresa_cnpj, valor_seguro")
        .eq("ano", year)
        .eq("mes", month);
      if (companyCnpj) fechQuery = fechQuery.eq("empresa_cnpj", companyCnpj);
      const { data: fechRows } = await fechQuery;
      seguroEmpresas = (fechRows || []).reduce(
        (sum, row: { valor_seguro?: number | null }) => sum + toNumber(row.valor_seguro),
        0
      );
    }

    // TOTAL do grupo = comissao-EMPRESA, regime-aware (igual dashboard/projecao):
    // aberto = Σ §188 por promotor; fechado = Σ fechamento.valor_seguro.
    const seguroEmpresaTotal = closed ? seguroEmpresas : seguro188Empresa;

    return {
      reportType,
      title: "Seguro / Seguridade",
      description:
        "Comissao de seguro do mes por promotor, por empresa e por contrato — fontes DB-driven (PMR, fechamento mensal e propostas).",
      sourceHref: "/dashboard",
      sourceLabel: "Abrir Dashboard",
      periods: data.periods,
      selectedPeriod: data.selectedPeriod,
      selectedCompanyId: data.selectedCompanyId,
      selectedPromoterId: data.selectedPromoterId,
      reportScope: null,
      companies: data.companies.map((company) => ({ id: company.id, name: company.name })),
      promoters: (data.promoterOptions.length > 0
        ? data.promoterOptions
        : data.promoterLookup
      ).map((promoter) => ({ id: promoter.id, name: promoter.name })),
      cards: [
        {
          label: "Comissao de seguro (empresa)",
          value: formatCurrency(seguroEmpresaTotal),
          detail: "Ganho do grupo — aberto §188 (daily); fechado fechamento mensal.",
        },
        {
          label: "Penetracao media",
          value: formatPercent(penetracaoMedia),
          detail: "Ponderada pela producao dos promotores no filtro atual.",
        },
        {
          label: "Promotores com seguro",
          value: formatNumber(comProm),
          detail: `De ${formatNumber(promoterRows.length)} promotores no filtro.`,
        },
      ],
      sections: [
        "Por promotor: penetracao e producao segurada (sem comissao por promotor).",
        "Por empresa: comissao de seguro do fechamento mensal (valor_seguro).",
        "Por contrato: premio e indicador de seguro (sem comissao por contrato).",
      ],
      alerts: [],
    };
  }

  const data = await buildPromoterAnalytics(supabase, {
    year: input.year,
    month: input.month,
    companyId: input.companyId,
    promoterId: input.promoterId,
    ...analyticsRegimeArgs(await resolveReportRegime(supabase, input.year, input.month)),
  });
  const promoterScope = normalizePromoterReportScope(input.scope);
  const selectedPromoter =
    data.summaryRows.find((row) => row.promoter_id === data.selectedPromoterId) || null;
  const topPromoter = data.summaryRows[0] || null;

  return {
    reportType,
    title:
      promoterScope === "geral"
        ? "Comissoes dos promotores - Geral"
        : "Comissoes dos promotores - Individual",
    description:
      promoterScope === "geral"
        ? "Saida operacional do comercial com ranking geral da equipe para diretoria e conferencia interna."
        : "Saida individual pronta para compartilhar com cada promotor, com resumo e detalhamento das propostas.",
    sourceHref: "/promotores",
    sourceLabel: "Abrir Promotores",
    periods: data.periods,
    selectedPeriod: data.selectedPeriod,
    selectedCompanyId: data.selectedCompanyId,
    selectedPromoterId: data.selectedPromoterId,
    reportScope: promoterScope,
    companies: data.companies.map((company) => ({
      id: company.id,
      name: company.name,
    })),
    promoters: (data.promoterOptions.length > 0 ? data.promoterOptions : data.promoterLookup).map(
      (promoter) => ({
        id: promoter.id,
        name: promoter.name,
      })
    ),
    cards: [
      {
        label: promoterScope === "geral" ? "Comissao a pagar" : "Promotor",
        value:
          promoterScope === "geral"
            ? formatCurrency(data.summary.payableCommission)
            : selectedPromoter?.promoter_name || "Nao selecionado",
        detail:
          promoterScope === "geral"
            ? "Valor ja descontado para repasse dos promotores."
            : `${selectedPromoter?.company_name || "-"} | ${selectedPromoter?.target_status || "-"}.`,
      },
      {
        label: promoterScope === "geral" ? "Comissao bruta" : "Comissao a pagar",
        value:
          promoterScope === "geral"
            ? formatCurrency(data.summary.finalCommission)
            : formatCurrency(selectedPromoter?.payable_commission_value),
        detail:
          promoterScope === "geral"
            ? "Soma antes dos descontos do promotor."
            : "Valor individual pronto para compartilhar.",
      },
      {
        label: "Producao",
        value:
          promoterScope === "geral"
            ? formatCurrency(data.summary.production)
            : formatCurrency(selectedPromoter?.production_value),
        detail:
          promoterScope === "geral"
            ? "Produzido com base no valor financiado liquido."
            : "Producao individual do promotor selecionado.",
      },
      {
        label: promoterScope === "geral" ? "Top promotor" : "Penetracao de seguro",
        value:
          promoterScope === "geral"
            ? topPromoter?.promoter_name || "Sem dados"
            : formatPercent(selectedPromoter?.insurance_penetration_percent),
        detail:
          promoterScope === "geral"
            ? topPromoter
              ? `${formatCurrency(topPromoter.payable_commission_value)} a pagar no ranking atual.`
              : "Sem promotores no filtro."
            : selectedPromoter
              ? `${selectedPromoter.proposal_count} propostas detalhadas no individual.`
              : "Escolha um promotor para gerar o individual.",
      },
    ],
    sections:
      promoterScope === "geral"
        ? [
            "Resumo mensal por promotor com producao, metas e comissao.",
            "Ranking geral da equipe para diretoria e conferencia interna.",
            "Base pronta para PDF e Excel em consolidado do mes.",
            "Uso ideal para controle geral e comparativo entre promotores.",
          ]
        : [
            "Resumo individual do promotor selecionado.",
            "Detalhamento das propostas do promotor para compartilhamento direto.",
            "Base pronta para PDF e Excel no modelo operacional individual.",
            "Conferencia de descontos, seguro e origem da regra aplicada.",
          ],
    alerts:
      promoterScope === "individual"
        ? !data.selectedPromoterId
          ? ["Selecione um promotor antes de gerar a saida individual."]
          : // Etapa 8 fix: usa proposal_count (vem do monthlyResults/cms no mes
            // FECHADO), nao proposalRows do daily — que fica vazio no fechado e
            // dava alerta falso. O export ja sai completo do cms (ex.: Luciana
            // mai = 23 registros).
            (selectedPromoter?.proposal_count ?? 0) === 0
            ? ["O promotor selecionado nao possui propostas detalhadas nesta competencia."]
            : []
        : [],
  };
}

// ============================================================
// SEGURO / SEGURIDADE — export (xlsx navy + PDF). SO fontes DB-driven:
//   Por promotor -> PMR (buildPromoterAnalytics.summaryRows + insured_production_value)
//   Por empresa  -> fechamento_mensal_empresa.valor_seguro
//   Por contrato -> cms_promoter_entries (buildCmsProposalRowsBatch, mes fechado)
// NUNCA buildClosingAnalytics / getInsurancePercentByTerm (legado proibido).
// ============================================================
async function buildSeguroDatasets(
  supabase: SupabaseClient,
  input: ReportFilters
) {
  const regime = await resolveReportRegime(supabase, input.year, input.month);
  const closed = regime === undefined ? undefined : regime !== "open";
  const data = await buildPromoterAnalytics(supabase, {
    year: input.year,
    month: input.month,
    companyId: input.companyId,
    promoterId: input.promoterId,
    ...analyticsRegimeArgs(regime),
  });
  const year = data.selectedPeriod?.year ?? input.year;
  const month = data.selectedPeriod?.month ?? input.month;
  const periodLabel = data.selectedPeriod?.label ?? null;

  // ---- Por promotor (DB-driven: PMR). summaryRows ja respeita company/promoter.
  // Por promotor mostra so PENETRACAO + PRODUCAO SEGURADA (sem comissao — comissao
  // de seguro e EMPRESA, agregada no total do grupo, nao por promotor).
  const promoterRows = data.summaryRows.filter((row) => row.active !== false);
  // §188 empresa por promotor (LIVE_BASE no aberto) = base do total-empresa no aberto.
  const seguro188Empresa = promoterRows.reduce(
    (s, r) => s + toNumber(r.insurance_commission_value),
    0
  );
  // insured_production_value nao vem em summaryRows — busca direto no PMR.
  const insuredByPromoter = new Map<string, number>();
  if (year && month) {
    const { data: pmr } = await supabase
      .from("promoter_monthly_results")
      .select("promoter_id, insured_production_value")
      .eq("year", year)
      .eq("month", month);
    for (const row of pmr || []) {
      insuredByPromoter.set(
        String((row as { promoter_id: string }).promoter_id),
        toNumber((row as { insured_production_value?: number | null }).insured_production_value)
      );
    }
  }
  const porPromotor = promoterRows.map((row) => ({
    promotor: row.promoter_name,
    cnpj: row.company_cnpj || "",
    penetracao: toNumber(row.insurance_penetration_percent) / 100, // fracao p/ formato percent
    producao_segurada: insuredByPromoter.get(row.promoter_id) ?? 0,
  }));
  const totPromotor = {
    promotor: "TOTAL",
    cnpj: "",
    producao_segurada: porPromotor.reduce((s, x) => s + x.producao_segurada, 0),
  };

  // ---- Por empresa (DB-driven: fechamento_mensal_empresa.valor_seguro).
  const companyNameByCnpj = new Map(
    data.companies.map((c) => [(c as { cnpj?: string }).cnpj ?? "", c.name])
  );
  const companyCnpjFilter = (
    data.companies.find((c) => c.id === input.companyId) as { cnpj?: string } | undefined
  )?.cnpj;
  const porEmpresa: Array<{ cnpj: string; empresa: string; comissao_seguro: number }> = [];
  if (year && month) {
    let q = supabase
      .from("fechamento_mensal_empresa")
      .select("empresa_cnpj, valor_seguro")
      .eq("ano", year)
      .eq("mes", month);
    if (companyCnpjFilter) q = q.eq("empresa_cnpj", companyCnpjFilter);
    const { data: fech } = await q;
    for (const row of fech || []) {
      const cnpj = String((row as { empresa_cnpj?: string }).empresa_cnpj ?? "");
      porEmpresa.push({
        cnpj,
        empresa: companyNameByCnpj.get(cnpj) || "—",
        comissao_seguro: toNumber((row as { valor_seguro?: number | null }).valor_seguro),
      });
    }
  }
  porEmpresa.sort((a, b) => b.comissao_seguro - a.comissao_seguro);
  const totEmpresa = {
    cnpj: "",
    empresa: "TOTAL",
    comissao_seguro: porEmpresa.reduce((s, x) => s + x.comissao_seguro, 0),
  };

  // TOTAL do grupo = comissao-EMPRESA, regime-aware: aberto Σ§188, fechado Σ fechamento.
  const seguroEmpresaTotal = closed ? totEmpresa.comissao_seguro : seguro188Empresa;

  // ---- Por contrato (DB-driven: cms_promoter_entries, mes fechado). So contratos
  // com seguro: chave/proposta, promotor, premio, tem seguro. SEM comissao por
  // contrato (empresa nao e rastreada por contrato no cms; share nao cabe em
  // relatorio de gestao).
  const porContrato: Array<{
    chave: string;
    proposta: string;
    promotor: string;
    premio: number;
    tem_seguro: string;
  }> = [];
  if (closed === true && regime) {
    const nameById = new Map(promoterRows.map((r) => [r.promoter_id, r.promoter_name]));
    // Fonte por REGIME: cms (jan-mai) ou fechamento (jun+). Antes ia sempre no cms.
    const batch = await buildClosedProposalRowsBatch(
      supabase,
      promoterRows.map((r) => r.promoter_id),
      year as number,
      month as number,
      regime
    );
    for (const [pid, rows] of batch) {
      for (const row of rows) {
        const premio = toNumber(row.insurance_value);
        porContrato.push({
          chave: row.j_key || "—",
          proposta: row.proposal_number || "—",
          promotor: nameById.get(pid) || "—",
          premio,
          tem_seguro: premio > 0 ? "Sim" : "Não",
        });
      }
    }
  }

  return {
    year,
    month,
    periodLabel,
    seguroEmpresaTotal,
    porPromotor,
    totPromotor,
    porEmpresa,
    totEmpresa,
    porContrato,
  };
}

async function buildSeguroWorkbook(
  ds: Awaited<ReturnType<typeof buildSeguroDatasets>>
): Promise<Buffer> {
  const sufixo = ds.periodLabel ? ` — ${ds.periodLabel}` : "";
  const abas: Aba[] = [
    {
      nome: "Por promotor",
      titulo: `Seguro · por promotor${sufixo}`,
      modo: "tabela",
      colunas: [
        { chave: "promotor", titulo: "Promotor", formato: "texto" },
        { chave: "cnpj", titulo: "CNPJ", formato: "texto" },
        { chave: "penetracao", titulo: "Penetração", formato: "percent" },
        { chave: "producao_segurada", titulo: "Produção segurada", formato: "moeda" },
      ],
      linhas: ds.porPromotor,
      totais: ds.totPromotor,
    },
    {
      nome: "Por empresa",
      titulo: `Seguro · por empresa${sufixo}`,
      modo: "tabela",
      colunas: [
        { chave: "cnpj", titulo: "CNPJ", formato: "texto" },
        { chave: "empresa", titulo: "Empresa", formato: "texto" },
        { chave: "comissao_seguro", titulo: "Comissão seguro", formato: "moeda" },
      ],
      linhas: ds.porEmpresa,
      totais: ds.totEmpresa,
    },
    {
      nome: "Por contrato",
      titulo: `Seguro · por contrato${sufixo}`,
      modo: "tabela",
      colunas: [
        { chave: "chave", titulo: "Chave", formato: "texto" },
        { chave: "proposta", titulo: "Proposta", formato: "texto" },
        { chave: "promotor", titulo: "Promotor", formato: "texto" },
        { chave: "premio", titulo: "Prêmio", formato: "moeda" },
        { chave: "tem_seguro", titulo: "Tem seguro", formato: "texto", alinhamento: "centro" },
      ],
      linhas: ds.porContrato,
    },
  ];
  return construirXlsxNavy({ abas });
}

async function buildSeguroPdf(
  ds: Awaited<ReturnType<typeof buildSeguroDatasets>>
): Promise<Buffer> {
  const padE = (v: string, n: number) => (v.length > n ? v.slice(0, n - 1) + "…" : v).padEnd(n);
  const padS = (v: string, n: number) => (v.length > n ? v.slice(0, n) : v).padStart(n);

  return pdfToBuffer(
    (doc) => {
      addPdfHeader(
        doc,
        "Seguro / Seguridade",
        `Grupo RR | comissão de seguro por promotor e empresa${ds.periodLabel ? ` — ${ds.periodLabel}` : ""}`
      );
      addPdfMetrics(doc, "Resumo", [
        {
          label: "Comissão de seguro (empresa)",
          value: formatCurrency(ds.seguroEmpresaTotal),
          detail: "Ganho do grupo — aberto §188 (daily); fechado fechamento mensal.",
        },
      ]);

      const promLines = ds.porPromotor.map(
        (r) =>
          `${padE(r.promotor, 34)} ${padE(r.cnpj, 18)} ${padS(formatPercent(r.penetracao * 100), 10)} ${padS(formatCurrency(r.producao_segurada), 18)}`
      );
      promLines.push(
        `${padE("TOTAL", 34)} ${padE("", 18)} ${padS("", 10)} ${padS(formatCurrency(ds.totPromotor.producao_segurada), 18)}`
      );
      addPdfLines(doc, "Por promotor (penetração / produção segurada)", promLines, "Sem promotores com seguro nesta competência.");

      const empLines = ds.porEmpresa.map(
        (r) => `${padE(r.empresa, 34)} ${padE(r.cnpj, 18)} ${padS(formatCurrency(r.comissao_seguro), 16)}`
      );
      empLines.push(
        `${padE("TOTAL", 34)} ${padE("", 18)} ${padS(formatCurrency(ds.totEmpresa.comissao_seguro), 16)}`
      );
      addPdfLines(doc, "Por empresa", empLines, "Sem seguro no fechamento desta competência.");

      // Por contrato fica SO no xlsx (pode ser extenso); aqui só o ponteiro.
      addPdfLines(
        doc,
        "Por contrato",
        [`${ds.porContrato.length} contrato(s) com detalhamento de seguro disponível no Excel.`],
        "Detalhamento por contrato disponível no Excel (mês fechado)."
      );
    },
    { layout: "landscape" }
  );
}

export async function buildReportExport(
  supabase: SupabaseClient,
  input: ReportFilters & { type?: string | null; format?: string | null }
): Promise<ExportBundle> {
  const reportType = normalizeReportKind(input.type);
  const reportFormat = normalizeReportFormat(input.format);

  // SEGURO — export DB-driven (xlsx navy 3 abas / PDF paisagem). Guarda explicita
  // p/ NAO cair no fallthrough de promotores.
  if (reportType === "seguro") {
    const ds = await buildSeguroDatasets(supabase, input);
    return {
      buffer:
        reportFormat === "pdf"
          ? await buildSeguroPdf(ds)
          : await buildSeguroWorkbook(ds),
      contentType:
        reportFormat === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: buildFileName("seguro", reportFormat, ds.periodLabel),
    };
  }

  if (reportType === "financeiro") {
    const data = await buildFinancialAnalytics(supabase, input);

    return {
      buffer:
        reportFormat === "pdf"
          ? await buildFinancePdf(data)
          : buildFinanceWorkbook(data),
      contentType:
        reportFormat === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: buildFileName(reportType, reportFormat, data.selectedPeriod.label),
    };
  }

  if (reportType === "fechamento") {
    const data = await buildClosingAnalytics(supabase, input);

    return {
      buffer:
        reportFormat === "pdf"
          ? await buildClosingPdf(data)
          : buildClosingWorkbook(data),
      contentType:
        reportFormat === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: buildFileName(
        reportType,
        reportFormat,
        data.selectedPeriod?.label || null
      ),
    };
  }

  if (reportType === "auditoria") {
    const data = makeAuditView(await buildClosingAnalytics(supabase, input));

    return {
      buffer:
        reportFormat === "pdf" ? await buildAuditPdf(data) : buildAuditWorkbook(data),
      contentType:
        reportFormat === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: buildFileName(
        reportType,
        reportFormat,
        data.selectedPeriod?.label || null
      ),
    };
  }

  // Regime do mês (1 resolução): aberto=LIVE_BASE, fechado=CALCULATED. Reusado no
  // swap das proposalRows abaixo (evita 2ª chamada ao detector).
  const regimeExport = await resolveReportRegime(supabase, input.year, input.month);
  const closedForExport =
    regimeExport === undefined ? undefined : regimeExport !== "open";
  let data = await buildPromoterAnalytics(supabase, {
    year: input.year,
    month: input.month,
    companyId: input.companyId,
    promoterId: input.promoterId,
    ...analyticsRegimeArgs(regimeExport),
  });
  const promoterScope = normalizePromoterReportScope(input.scope);
  const teamOrder = normalizeTeamOrder(input.order);

  if (promoterScope === "individual" && !data.selectedPromoterId) {
    throw new Error("Selecione um promotor antes de exportar o relatorio individual.");
  }

  // ETAPA 7 — mes FECHADO: o relatorio espelha o cms (ground truth pago), igual
  // ao PromotorView. Troca SO as proposalRows (summary segue do motor, como na
  // tela). Sem recalcular.
  if (
    promoterScope === "individual" &&
    input.year &&
    input.month &&
    data.selectedPromoterId
  ) {
    const closed = closedForExport === true; // reusa a resolução acima
    if (closed && regimeExport) {
      // Fonte por REGIME: cms (jan-mai) ou fechamento (jun+). Antes ia sempre no cms —
      // e o cms não tem jun+, então o PDF do promotor saía sem linha nenhuma.
      const closedRows =
        regimeExport === "cms"
          ? await buildCmsProposalRows(supabase, data.selectedPromoterId, input.year, input.month)
          : await buildClosingProposalRows(
              supabase,
              data.selectedPromoterId,
              input.year,
              input.month
            );
      data = { ...data, proposalRows: closedRows as typeof data.proposalRows };
    }
  }

  const selectedPromoter =
    data.summaryRows.find((row) => row.promoter_id === data.selectedPromoterId) || null;

  return {
    buffer:
      reportFormat === "pdf"
        ? await buildPromoterPdf(data, promoterScope, teamOrder)
        : buildPromoterWorkbook(data, promoterScope, teamOrder),
    contentType:
      reportFormat === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileName: buildFileName(
      reportType,
      reportFormat,
      data.selectedPeriod.label,
      promoterScope === "geral" ? "geral" : selectedPromoter?.promoter_name || "individual"
    ),
  };
}

// ============================================================
// ETAPA 7 — EXPORT EM LOTE de relatorios de promotor.
// Orquestra o buildPromoterWorkbook/appendFaithfulPromoterSheet EXISTENTES sobre
// N promotores, reusando a base fetch-once (loadPromoterAnalyticsBase) + o mesmo
// switch cms/motor por competencia + o mesmo mascaramento 552710. Cada relatorio
// no lote e identico ao export individual do mesmo promotor.
// ============================================================

export type PromoterBatchMode = "zip" | "abas";

// Conectivos de nome (preposicoes/artigos) — nao servem como "sobrenome".
const NAME_CONNECTORS = new Set([
  "DE", "DA", "DO", "DAS", "DOS", "E", "DI", "DU", "DEL", "DELLA",
  "VON", "VAN", "LA", "LAS", "LOS", "Y",
]);

// Nome reconhecivel: primeiro nome + primeiro sobrenome REAL, pulando conectivos
// (ex.: "LUCIANA MATIAS DA SILVA" -> "LUCIANA MATIAS"; "EDIVANIA DE SOUZA" ->
// "EDIVANIA SOUZA"). Nunca corta no meio da palavra.
function promoterShortName(fullName?: string | null): string {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "PROMOTOR";
  const first = parts[0];
  let surname = "";
  for (let i = 1; i < parts.length; i++) {
    if (!NAME_CONNECTORS.has(parts[i].toUpperCase())) {
      surname = parts[i];
      break;
    }
  }
  if (!surname && parts.length > 1) surname = parts[1];
  return (surname ? `${first} ${surname}` : first).toUpperCase();
}

// Excel proibe : \ / ? * [ ] em nome de aba.
function sanitizeSheetName(name: string): string {
  return name
    .replace(/[:\\\/?*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Aba unica: <=31 chars + desambiguacao de colisao/homonimo (sufixo " 2", " 3"...).
function uniqueSheetName(rawName: string, used: Set<string>): string {
  const clean = sanitizeSheetName(rawName) || "Promotor";
  const base = clean.slice(0, 31);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let i = 2; i < 1000; i++) {
    const suffix = ` ${i}`;
    const candidate = clean.slice(0, 31 - suffix.length) + suffix;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  used.add(base);
  return base;
}

// Nome de arquivo unico no zip (sufixo -2, -3... em colisao).
function uniqueFileName(rawBase: string, used: Set<string>): string {
  const base = rawBase || "relatorio-promotor";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  used.add(base);
  return base;
}

export async function buildPromoterBatchExport(
  supabase: SupabaseClient,
  input: ReportFilters & { mode?: string | null }
): Promise<ExportBundle> {
  const mode: PromoterBatchMode = input.mode === "abas" ? "abas" : "zip";

  // Fetch-once: 1 base com TODAS as 9 queries; fatiamos N vezes em memoria.
  // closed: aberto=LIVE_BASE, fechado=CALCULATED (resolvido do período do input).
  const regimeLote = await resolveReportRegime(supabase, input.year, input.month);
  const base = await loadPromoterAnalyticsBase(supabase, {
    year: input.year,
    month: input.month,
    companyId: input.companyId,
    ...analyticsRegimeArgs(regimeLote),
  });

  const period = base.latestPeriod;
  const periodLabel = period.label;

  // ABRANGENCIA: TODOS os ATIVOS da competencia (companyId ja aplicado na base).
  // ZERADOS incluidos — quem nao produziu sai com relatorio vazio/zerado.
  // Ordem = filteredSummaryRows (maior comissao a pagar primeiro, igual a tela).
  const promotersInScope = base.filteredSummaryRows.filter((row) => row.active);

  // Mes FECHADO -> proposalRows da fonte da competencia (cms OU fechamento), igual
  // ao individual. Agrupado, em vez de N round-trips.
  const regimePeriodo = await resolveReportRegime(supabase, period.year, period.month);
  const closed = regimePeriodo !== undefined && regimePeriodo !== "open";
  const cmsByPromoter =
    closed && regimePeriodo && promotersInScope.length > 0
      ? await buildClosedProposalRowsBatch(
          supabase,
          promotersInScope.map((row) => row.promoter_id),
          period.year,
          period.month,
          regimePeriodo
        )
      : new Map<string, Awaited<ReturnType<typeof buildCmsProposalRows>>>();

  // Recorte de 1 promotor + (se fechado) troca das proposalRows pelo cms.
  // Espelha EXATAMENTE o caminho do export individual em buildReportExport.
  const promoterDataFor = (promoterId: string) => {
    const data = selectPromoterView(base, promoterId);
    if (closed) {
      return {
        ...data,
        proposalRows: (cmsByPromoter.get(promoterId) ||
          []) as typeof data.proposalRows,
      };
    }
    return data;
  };

  if (mode === "abas") {
    // 1 xlsx UNICO: 1 aba fiel (modelo LUCIANA) por promotor.
    const workbook = createWorkbook();
    const usedSheetNames = new Set<string>();
    for (const summaryRow of promotersInScope) {
      const data = promoterDataFor(summaryRow.promoter_id);
      const selected =
        data.summaryRows.find((row) => row.promoter_id === summaryRow.promoter_id) ||
        null;
      const sheetName = uniqueSheetName(
        promoterShortName(summaryRow.promoter_name),
        usedSheetNames
      );
      appendFaithfulPromoterSheet(workbook, data, selected, sheetName);
    }
    if (promotersInScope.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([
        ["Nenhum promotor ativo nesta competencia."],
      ]);
      XLSX.utils.book_append_sheet(workbook, ws, "Sem promotores");
    }

    return {
      buffer: workbookToBuffer(workbook),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: buildFileName("promotores", "xlsx", periodLabel, "lote-abas"),
    };
  }

  // modo ZIP: 1 xlsx (individual completo, 7 abas) por promotor.
  const zip = new JSZip();
  const usedFileNames = new Set<string>();
  for (const summaryRow of promotersInScope) {
    const data = promoterDataFor(summaryRow.promoter_id);
    const buffer = buildPromoterWorkbook(data, "individual");
    const fileName = uniqueFileName(
      `relatorio-promotor-${slugify(promoterShortName(summaryRow.promoter_name))}`,
      usedFileNames
    );
    zip.file(`${fileName}.xlsx`, buffer);
  }

  const zipBuffer = (await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  })) as Buffer;

  return {
    buffer: zipBuffer,
    contentType: "application/zip",
    fileName: `relatorios-promotores-lote-${slugify(periodLabel)}.zip`,
  };
}
