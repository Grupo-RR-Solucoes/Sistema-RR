export type DailyImportRow = {
  externalKey: string;
  produto: string;
  codigoConvenio: string;
  dataProposta: string;
  numeroProposta: string;
  parcelas: number;
  valorFinanciado: number;
  valorLiquido: number;
  tipoLiberacao: string;
  dataContrato: string;
  status: string;
};

export type ParsedDailySummary = {
  operacoes: DailyImportRow[];
  operacoesProducao: DailyImportRow[];
  operacoesPendentes: DailyImportRow[];
  operacoesCanceladas: DailyImportRow[];
  quantidadeProducao: number;
  quantidadePendentes: number;
  quantidadeCanceladas: number;
  producaoValida: number;
  valorPendente: number;
};

export type MonthlyImportRow = {
  externalKey: string;
  empresaCnpj: string;
  numeroOperacao: string;
  dataReferencia: string;
  tipoRecebimento: string;
  valorRecebido: number;
  valorDiferido: number;
  valorSeguro: number;
  valorEstorno: number;
  valorRenovacao: number;
  status: string;
  observacao: string;
};
