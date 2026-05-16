import * as XLSX from "xlsx";

import {
  buildClosingAnalytics,
  buildClosingAnalyticsLegacy,
} from "@/lib/closingAnalytics";
import {
  buildFinancialAnalytics,
  buildFinancialAnalyticsLegacy,
} from "@/lib/financialAnalytics";
import {
  buildPromoterAnalytics,
  buildPromoterAnalyticsLegacy,
} from "@/lib/promoterAnalytics";

export type ReportKind = "financeiro" | "fechamento" | "auditoria" | "promotores";
export type ReportFormat = "pdf" | "xlsx";
export type PromoterReportScope = "geral" | "individual";

export type ReportFilters = {
  year?: number;
  month?: number;
  companyId?: string;
  promoterId?: string;
  scope?: string;
};

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

  throw new Error("Tipo de relatorio invalido.");
}

function normalizeReportFormat(input?: string | null): ReportFormat {
  const value = normalizeText(input || "pdf");

  if (value === "pdf") return "pdf";
  if (value === "xlsx" || value === "excel") return "xlsx";

  throw new Error("Formato de exportacao invalido.");
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

async function pdfToBuffer(render: (doc: any) => void) {
  const PDFDocument = require("pdfkit/js/pdfkit.standalone.js");

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
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

function buildPromoterWorkbook(
  data: Awaited<ReturnType<typeof buildPromoterAnalytics>>,
  scope: PromoterReportScope
) {
  const workbook = createWorkbook();
  const selectedPromoter =
    data.summaryRows.find((row) => row.promoter_id === data.selectedPromoterId) || null;

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

async function buildPromoterPdf(
  data: Awaited<ReturnType<typeof buildPromoterAnalytics>>,
  scope: PromoterReportScope
) {
  const selectedPromoter =
    data.summaryRows.find((row) => row.promoter_id === data.selectedPromoterId) || null;

  return pdfToBuffer((doc) => {
    addPdfHeader(
      doc,
      scope === "geral"
        ? `Relatorio Geral de Promotores - ${data.selectedPeriod.label}`
        : `Relatorio Individual de ${selectedPromoter?.promoter_name || "Promotor"} - ${data.selectedPeriod.label}`,
      scope === "geral"
        ? "Grupo RR | consolidado mensal da equipe comercial"
        : "Grupo RR | detalhamento individual para compartilhamento com o promotor"
    );

    if (scope === "geral") {
      addPdfMetrics(doc, "Resumo comercial da equipe", [
        {
          label: "Comissao a pagar",
          value: formatCurrency(data.summary.payableCommission),
        },
        {
          label: "Comissao bruta",
          value: formatCurrency(data.summary.finalCommission),
        },
        {
          label: "Producao do filtro",
          value: formatCurrency(data.summary.production),
        },
        {
          label: "Penetracao media",
          value: formatPercent(data.summary.averageInsurancePenetration),
          detail: `${formatNumber(data.summary.promoters)} promotores no consolidado.`,
        },
      ]);

      addPdfLines(
        doc,
        "Resumo dos promotores",
        data.summaryRows.map(
          (row) =>
            `${row.promoter_name} | ${row.company_name} | Producao ${formatCurrency(
              row.production_value
            )} | A pagar ${formatCurrency(row.payable_commission_value)} | Meta ${row.target_status}`
        )
      );
    } else {
      addPdfMetrics(doc, "Resumo individual", [
        {
          label: "Promotor",
          value: selectedPromoter?.promoter_name || "Nao selecionado",
          detail: selectedPromoter?.company_name || "Sem empresa vinculada.",
        },
        {
          label: "Producao",
          value: formatCurrency(selectedPromoter?.production_value),
        },
        {
          label: "Comissao a pagar",
          value: formatCurrency(selectedPromoter?.payable_commission_value),
        },
        {
          label: "Descontos",
          value: formatCurrency(selectedPromoter?.discount_value),
        },
        {
          label: "Penetracao de seguro",
          value: formatPercent(selectedPromoter?.insurance_penetration_percent),
          detail: `Meta atual: ${selectedPromoter?.target_status || "-"}`,
        },
      ]);

      addPdfLines(
        doc,
        "Acordos comerciais",
        data.agreementRows.map(
          (row) =>
            `${row.agreement_type} | ${row.commission_value.toFixed(2).replace(".", ",")}% | ${
              row.notes || "Sem observacao"
            }`
        ),
        "Sem acordo comercial manual nesta competencia."
      );

      addPdfLines(
        doc,
        "Descontos do promotor",
        data.discountRows.map(
          (row) =>
            `${row.discount_type} | ${row.proposal_number} | Parcela ${row.installment_number}/${row.installments} | ${formatCurrency(
              row.amount
            )} | ${row.apply_to_company ? "Empresa" : "Promotor"}`
        ),
        "Sem descontos lancados nesta competencia."
      );

      addPdfLines(
        doc,
        "Detalhamento das propostas",
        data.proposalRows.map(
          (row) =>
            `${row.contract_number} | ${row.product_description} | PF ${formatCurrency(
              row.company_commission_amount
            )} | Promotor ${formatCurrency(
              row.promoter_commission_amount
            )} | Seguro ${formatCurrency(row.insurance_commission_amount)} | ${
              row.commission_rule_source || "-"
            }`
        )
      );
    }
  });
}

export async function buildReportPreview(
  input: ReportFilters & { type?: string | null }
): Promise<ReportPreviewPayload> {
  const reportType = normalizeReportKind(input.type);

  if (reportType === "financeiro") {
    const data = await buildFinancialAnalyticsLegacy(input);

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
    // TODO Dia 4.2 Etapa 3.7: passar supabase client apos refator do bucket OUTROS (/api/relatorios)
    const data = await buildClosingAnalyticsLegacy(input);

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
    // TODO Dia 4.2 Etapa 3.7: passar supabase client apos refator do bucket OUTROS (/api/relatorios)
    const audit = makeAuditView(await buildClosingAnalyticsLegacy(input));
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

  const data = await buildPromoterAnalyticsLegacy(input);
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
          : data.proposalRows.length === 0
            ? ["O promotor selecionado nao possui propostas detalhadas nesta competencia."]
            : []
        : [],
  };
}

export async function buildReportExport(
  input: ReportFilters & { type?: string | null; format?: string | null }
): Promise<ExportBundle> {
  const reportType = normalizeReportKind(input.type);
  const reportFormat = normalizeReportFormat(input.format);

  if (reportType === "financeiro") {
    const data = await buildFinancialAnalyticsLegacy(input);

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
    // TODO Dia 4.2 Etapa 3.7: passar supabase client apos refator do bucket OUTROS (/api/relatorios/export)
    const data = await buildClosingAnalyticsLegacy(input);

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
    // TODO Dia 4.2 Etapa 3.7: passar supabase client apos refator do bucket OUTROS (/api/relatorios/export)
    const data = makeAuditView(await buildClosingAnalyticsLegacy(input));

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

  const data = await buildPromoterAnalyticsLegacy(input);
  const promoterScope = normalizePromoterReportScope(input.scope);

  if (promoterScope === "individual" && !data.selectedPromoterId) {
    throw new Error("Selecione um promotor antes de exportar o relatorio individual.");
  }

  const selectedPromoter =
    data.summaryRows.find((row) => row.promoter_id === data.selectedPromoterId) || null;

  return {
    buffer:
      reportFormat === "pdf"
        ? await buildPromoterPdf(data, promoterScope)
        : buildPromoterWorkbook(data, promoterScope),
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
