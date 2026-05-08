/**
 * Wrapper read-only sobre RELATORIO_AUDITORIA_FINAL_v9.xlsx.
 *
 * Fonte: auditorias/RELATORIO_AUDITORIA_FINAL_v9.xlsx (15 abas, 23.884 contratos
 * À Vista + 12.612 PRT + 41 meses de Mapa Enquadramento + Reconciliação Caixa).
 *
 * Este módulo é insumo da Fase 4.5 (validação contra v9). Em produção nunca
 * lê o XLSX em runtime — apenas o seed inicial copia para Supabase.
 *
 * Convenção das abas v9: linha 1 = título mesclado, linha 2 = headers, linha 3+ = dados.
 */

import * as XLSX from "xlsx";

const NOME_ABAS = {
  RESUMO_EXECUTIVO: "Resumo Executivo",
  AUDITORIA_AVISTA: "Auditoria À Vista",
  AUDITORIA_PRT: "Auditoria PRT",
  MAPA_ENQUADRAMENTO: "Mapa Enquadramento",
  SOL_REG_2_1: "Solicitação Regularização 2.1",
  SOL_REG_2_2: "Solicitação Regularização 2.2",
  PCT_NAO_DOCUMENTADO: "PCT Não Documentado",
  PRT_CESSADOS: "PRT Cessados",
  PRT_SEM_REGISTRO: "PRT Sem Registro",
  BONUS_FAVORAVEL: "Bônus Favorável",
  SRCC_VALIDADOS: "SRCC Validados",
  DEBITOS: "Débitos",
  RECONCILIACAO_CAIXA: "Reconciliação Caixa",
  RESUMO_POR_MES: "Resumo por Mês",
  RESUMO_POR_CNPJ: "Resumo por CNPJ",
} as const;

// ---------------------------------------------------------------------------
// Tipos das abas críticas (apenas as 4 que vão para audit_v9_*)
// ---------------------------------------------------------------------------

export interface V9Avista {
  contrato: string;
  empresa: string;
  mes: string;
  tipo: string;
  produto: string;
  convenio: string;
  txJuros: number;
  prazo: number;
  catAplicada: string;
  catDevida: string;
  valorLiquido: number;
  pctAplicado: number;
  pctDevido: number;
  comissaoPaga: number;
  comissaoDevida: number;
  diferenca: number;
  statusFase1: string;
  observacoes: string;
}

export interface V9Prt {
  contrato: string;
  empresa: string;
  mesOrigem: string;
  tipo: string;
  produto: string;
  convenio: string;
  tabela: string;
  basePrt: number;
  parcTot: number;
  mesesPagos: number;
  prtPago: number;
  prtListadoNaoPago: number;
  excedenteDevido: number;
  statusFase2: string;
  observacoes: string;
}

export interface V9Enquadramento {
  mes: string;
  cnpjsAtivos: number;
  volBruto: number;
  volLiquido: number;
  qtdContratos: number;
  volPrestamista: number;
  penetracao: number;
  metaDeclarada: number;
  pctAtingido: number;
  regime: string;
  catDevida: string;
  catAplicada: string;
  statusEnquadramento: string;
  impactoEstimado: number;
  observacoes: string;
}

export interface V9Reconciliacao {
  mes: string;
  avistaCalculado: number;
  avistaCaixa: number;
  deltaAvista: number;
  prtPagoCalculado: number;
  prtPagoCaixa: number;
  deltaPrt: number;
  status: string;
}

// Solicitação Regularização 2.1 (Bloco PEDIDO_FIRME_2.1) — colunas extras
export interface V9SolReg21 extends V9Avista {
  bloco: string;
  categoria: string;
  valorSolicitacaoRegularizacao: number;
}
// Solicitação Regularização 2.2 (Bloco PEDIDO_FIRME_2.2)
export interface V9SolReg22 extends V9Prt {
  bloco: string;
  categoria: string;
  valorSolicitacaoRegularizacao: number;
}

export interface V9Data {
  avista: V9Avista[];
  prt: V9Prt[];
  enquadramento: V9Enquadramento[];
  reconciliacao: V9Reconciliacao[];
  solReg21: V9SolReg21[];
  solReg22: V9SolReg22[];
}

// ---------------------------------------------------------------------------
// Helpers de parsing
// ---------------------------------------------------------------------------

function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const s = v.replace(/R\$/gi, "").replace(/%/g, "").replace(/\s/g, "").trim();
    const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function loadSheet(
  wb: XLSX.WorkBook,
  sheetName: string
): { headers: string[]; rows: Record<string, unknown>[] } {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Aba ausente no XLSX v9: ${sheetName}`);
  if (!ws["!ref"]) return { headers: [], rows: [] };
  const range = XLSX.utils.decode_range(ws["!ref"]);
  // Pula a linha 1 (título mesclado) — header é a linha 2 (índice range.s.r + 1).
  const all = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    range: { s: { r: range.s.r + 1, c: range.s.c }, e: range.e },
    raw: true,
    blankrows: false,
    defval: null,
  });
  if (all.length === 0) return { headers: [], rows: [] };
  const headers = (all[0] as unknown[]).map((h) => (h == null ? "" : String(h)));
  const rows = all.slice(1).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => (obj[h] = (row as unknown[])[i]));
    return obj;
  });
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Mapeamento aba → tipo
// ---------------------------------------------------------------------------

function mapAvista(r: Record<string, unknown>): V9Avista {
  return {
    contrato: toStr(r["Contrato"]),
    empresa: toStr(r["Empresa"]),
    mes: toStr(r["Mês"]),
    tipo: toStr(r["Tipo"]),
    produto: toStr(r["Produto"]),
    convenio: toStr(r["Convênio"]),
    txJuros: toNum(r["Tx Juros (%)"]),
    prazo: toNum(r["Prazo"]),
    catAplicada: toStr(r["Cat Aplicada"]),
    catDevida: toStr(r["Cat Devida"]),
    valorLiquido: toNum(r["Valor Líquido (R$)"]),
    pctAplicado: toNum(r["% Aplicado"]),
    pctDevido: toNum(r["% Devido"]),
    comissaoPaga: toNum(r["Comissão Paga (R$)"]),
    comissaoDevida: toNum(r["Comissão Devida (R$)"]),
    diferenca: toNum(r["Diferença (R$)"]),
    statusFase1: toStr(r["Status Fase 1"]),
    observacoes: toStr(r["Observações"]),
  };
}

function mapPrt(r: Record<string, unknown>): V9Prt {
  return {
    contrato: toStr(r["Contrato"]),
    empresa: toStr(r["Empresa"]),
    mesOrigem: toStr(r["Mês Origem"]),
    tipo: toStr(r["Tipo"]),
    produto: toStr(r["Produto"]),
    convenio: toStr(r["Convênio"]),
    tabela: toStr(r["Tabela"]),
    basePrt: toNum(r["Base PRT (R$)"]),
    parcTot: toNum(r["Parc Tot"]),
    mesesPagos: toNum(r["# Meses Pagos"]),
    prtPago: toNum(r["PRT Pago (R$)"]),
    prtListadoNaoPago: toNum(r["PRT Listado mas Não Pago (R$)"]),
    excedenteDevido: toNum(r["Excedente Devido (R$)"]),
    statusFase2: toStr(r["Status Fase 2"]),
    observacoes: toStr(r["Observações"]),
  };
}

function mapEnquadramento(r: Record<string, unknown>): V9Enquadramento {
  return {
    mes: toStr(r["Mês"]),
    cnpjsAtivos: toNum(r["CNPJs Ativos"]),
    volBruto: toNum(r["Vol Bruto (R$)"]),
    volLiquido: toNum(r["Vol Líquido (R$)"]),
    qtdContratos: toNum(r["Qtd Contratos"]),
    volPrestamista: toNum(r["Vol Prestamista (penetração)"]),
    penetracao: toNum(r["Penetração %"]),
    metaDeclarada: toNum(r["Meta Declarada (R$)"]),
    pctAtingido: toNum(r["% Atingido"]),
    regime: toStr(r["Regime"]),
    catDevida: toStr(r["Cat Devida"]),
    catAplicada: toStr(r["Cat Aplicada"]),
    statusEnquadramento: toStr(r["Status Enquadramento"]),
    impactoEstimado: toNum(r["Impacto Estimado (R$)"]),
    observacoes: toStr(r["Observações"]),
  };
}

function mapReconciliacao(r: Record<string, unknown>): V9Reconciliacao {
  return {
    mes: toStr(r["Mês"]),
    avistaCalculado: toNum(r["À Vista Calculado (R$)"]),
    avistaCaixa: toNum(r["À Vista Caixa (R$)"]),
    deltaAvista: toNum(r["Δ À Vista (R$)"]),
    prtPagoCalculado: toNum(r["PRT Pago Calculado (R$)"]),
    prtPagoCaixa: toNum(r["PRT Pago Caixa (R$)"]),
    deltaPrt: toNum(r["Δ PRT (R$)"]),
    status: toStr(r["Status"]),
  };
}

function mapSolReg21(r: Record<string, unknown>): V9SolReg21 {
  return {
    contrato: toStr(r["Contrato"]),
    empresa: toStr(r["Empresa"]),
    mes: toStr(r["Mês"]),
    tipo: toStr(r["Tipo"]),
    produto: toStr(r["Produto"]),
    convenio: toStr(r["Convênio"]),
    txJuros: toNum(r["Tx Juros (%)"]),
    prazo: toNum(r["Prazo"]),
    catAplicada: toStr(r["Categoria Aplicada"]),
    catDevida: toStr(r["Categoria Devida"]),
    valorLiquido: toNum(r["Valor Líquido (R$)"]),
    pctAplicado: toNum(r["% Aplicado"]),
    pctDevido: toNum(r["% Devido"]),
    comissaoPaga: toNum(r["Comissão Paga (R$)"]),
    comissaoDevida: toNum(r["Comissão Devida (R$)"]),
    diferenca: toNum(r["Diferença (R$)"]),
    statusFase1: toStr(r["Status Fase 1"]),
    observacoes: "",
    bloco: toStr(r["Bloco"]),
    categoria: toStr(r["Categoria"]),
    valorSolicitacaoRegularizacao: toNum(r["Valor Solicitação Regularização (R$)"]),
  };
}

function mapSolReg22(r: Record<string, unknown>): V9SolReg22 {
  return {
    contrato: toStr(r["Contrato"]),
    empresa: toStr(r["Empresa"]),
    mesOrigem: toStr(r["Mês Origem"]),
    tipo: toStr(r["Tipo"]),
    produto: toStr(r["Produto"]),
    convenio: toStr(r["Convênio"]),
    tabela: toStr(r["Tabela"]),
    basePrt: toNum(r["Base PRT (R$)"]),
    parcTot: toNum(r["Parc Tot"]),
    mesesPagos: toNum(r["# Meses Pagos"]),
    prtPago: toNum(r["PRT Pago (R$)"]),
    prtListadoNaoPago: toNum(r["PRT Listado mas Não Pago (R$)"]),
    excedenteDevido: 0,
    statusFase2: toStr(r["Status v8"]),
    observacoes: "",
    bloco: toStr(r["Bloco"]),
    categoria: toStr(r["Categoria"]),
    valorSolicitacaoRegularizacao: toNum(r["Valor Solicitação Regularização (R$)"]),
  };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Carrega o XLSX v9 em memória e retorna estrutura tipada.
 *
 * @param xlsxPath caminho absoluto para auditorias/RELATORIO_AUDITORIA_FINAL_v9.xlsx
 * @throws Error se arquivo não existe ou aba esperada está ausente
 *
 * Validações de sanidade (warnings via console.warn, não throw):
 * - 41 linhas em V9Enquadramento (1 por mês de Dez/2022 a Abr/2026)
 * - 23.884 ± 100 linhas em V9Avista (tolerância para evolução do dataset)
 * - delta_avista==0 e delta_prt==0 em todas linhas de V9Reconciliacao
 */
export function loadV9(xlsxPath: string): V9Data {
  const wb = XLSX.readFile(xlsxPath, { dense: true, cellDates: false });

  const avista = loadSheet(wb, NOME_ABAS.AUDITORIA_AVISTA).rows.map(mapAvista);
  const prt = loadSheet(wb, NOME_ABAS.AUDITORIA_PRT).rows.map(mapPrt);
  const enquadramento = loadSheet(wb, NOME_ABAS.MAPA_ENQUADRAMENTO).rows.map(mapEnquadramento);
  const reconciliacao = loadSheet(wb, NOME_ABAS.RECONCILIACAO_CAIXA).rows.map(mapReconciliacao);
  const solReg21 = loadSheet(wb, NOME_ABAS.SOL_REG_2_1).rows.map(mapSolReg21);
  const solReg22 = loadSheet(wb, NOME_ABAS.SOL_REG_2_2).rows.map(mapSolReg22);

  // Sanidade
  if (enquadramento.length !== 41) {
    console.warn(`[v9Dataset] Enquadramento esperado=41 linhas, obtido=${enquadramento.length}`);
  }
  if (Math.abs(avista.length - 23884) > 100) {
    console.warn(`[v9Dataset] Avista esperado≈23884, obtido=${avista.length}`);
  }
  const reconcViolacoes = reconciliacao.filter(
    (r) => Math.abs(r.deltaAvista) > 0.01 || Math.abs(r.deltaPrt) > 0.01
  );
  if (reconcViolacoes.length > 0) {
    console.warn(
      `[v9Dataset] Reconciliação Δ≠0 em ${reconcViolacoes.length} linhas (esperado 0)`
    );
  }

  return { avista, prt, enquadramento, reconciliacao, solReg21, solReg22 };
}

/**
 * Resumo estatístico do dataset carregado (auditoria/diagnóstico).
 */
export function resumoV9(data: V9Data): {
  totalAvista: number;
  totalPrt: number;
  mesesEnquadramento: number;
  reconciliacaoOk: boolean;
  totalSolReg21: number;
  totalSolReg22: number;
} {
  const reconcOk = data.reconciliacao.every(
    (r) => Math.abs(r.deltaAvista) <= 0.01 && Math.abs(r.deltaPrt) <= 0.01
  );
  return {
    totalAvista: data.avista.length,
    totalPrt: data.prt.length,
    mesesEnquadramento: data.enquadramento.length,
    reconciliacaoOk: reconcOk,
    totalSolReg21: data.solReg21.length,
    totalSolReg22: data.solReg22.length,
  };
}

export { NOME_ABAS };
