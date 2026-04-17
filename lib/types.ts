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
