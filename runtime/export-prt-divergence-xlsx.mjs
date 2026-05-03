import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

const OUTPUT_DIR = path.join(process.cwd(), "runtime", "outputs");
const jsonPath = path.join(OUTPUT_DIR, "prt-divergencias-detalhado.json");
const workbookPath = path.join(OUTPUT_DIR, "prt-divergencias-detalhado.xlsx");

const source = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

const workbook = XLSX.utils.book_new();

const summaryRows = source.summaryRows.map((row) => ({
  EMPRESA: row.empresaNome,
  CNPJ: row.empresaCnpj,
  COMPETENCIA: row.competencia,
  PRT_RECEBIDO_MES: row.actualPrt,
  PRT_ESPERADO_OPERACOES_DIVERGENTES: row.expectedPrt,
  VALOR_DIVERGENTE_IDENTIFICADO: row.diferenca,
  OPERACOES_DIVERGENTES: row.operacoesDivergentes,
}));

const detailRows = source.detailRows.map((row) => ({
  EMPRESA: row.empresaNome,
  CNPJ: row.empresaCnpj,
  COMPETENCIA: row.competencia,
  STATUS_DIVERGENCIA: row.statusDivergencia,
  MCI: row.mci,
  RAZAO_SOCIAL: row.razaoSocial,
  COD_LOJA: row.codLoja,
  AGENCIA_BB: row.agenciaBb,
  NRO_OPERACAO: row.nroOperacao,
  CHAVE_J: row.chaveJ,
  VALOR_FINANCIADO: row.valorFinanciado,
  COMISSAO_PARCELA: row.comissaoParcela,
  COMISSAO_RECEBIDA_MES: row.comissaoRecebidaMes,
  VALOR_DIVERGENTE: row.diferenca,
  DATA_FINAL: row.dataFinal,
  QTD_PARCELAS_PGS: row.qtdParcelasPgs,
  QTD_PARCELAS_TOTAL: row.qtdParcelasTotal,
  PARCELA_ESPERADA_NRO: row.parcelaEsperadaNro,
  COD_OPS: row.codOps,
  COD_EST: row.codEst,
  MES_ORIGEM_PRT: row.mesOrigemPrt,
  PROXIMO_PRT_OBSERVADO: row.proximoPrtObservado,
  MES_CORTE_DEBITO: row.mesCorteDebito,
  PRODUTO: row.produto,
  STATUS_LINHA: row.statusLinha,
}));

const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
const detailSheet = XLSX.utils.json_to_sheet(detailRows);

summarySheet["!freeze"] = { xSplit: 0, ySplit: 1 };
detailSheet["!freeze"] = { xSplit: 0, ySplit: 1 };

summarySheet["!autofilter"] = { ref: summarySheet["!ref"] };
detailSheet["!autofilter"] = { ref: detailSheet["!ref"] };

summarySheet["!cols"] = [
  { wch: 30 },
  { wch: 18 },
  { wch: 12 },
  { wch: 16 },
  { wch: 22 },
  { wch: 16 },
  { wch: 16 },
];

detailSheet["!cols"] = [
  { wch: 26 },
  { wch: 18 },
  { wch: 12 },
  { wch: 16 },
  { wch: 12 },
  { wch: 26 },
  { wch: 12 },
  { wch: 12 },
  { wch: 16 },
  { wch: 14 },
  { wch: 16 },
  { wch: 16 },
  { wch: 18 },
  { wch: 16 },
  { wch: 12 },
  { wch: 14 },
  { wch: 16 },
  { wch: 18 },
  { wch: 10 },
  { wch: 10 },
  { wch: 14 },
  { wch: 18 },
  { wch: 16 },
  { wch: 28 },
  { wch: 18 },
];

XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumo mensal");
XLSX.utils.book_append_sheet(workbook, detailSheet, "Operacoes divergentes");

XLSX.writeFile(workbook, workbookPath, { compression: true });

process.stdout.write(
  JSON.stringify(
    {
      workbookPath,
      summaryRows: summaryRows.length,
      detailRows: detailRows.length,
    },
    null,
    2
  )
);
