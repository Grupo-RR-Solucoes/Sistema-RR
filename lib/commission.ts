import { DailyImportRow } from './types';

export type CommissionSummary = {
  producaoValida: number;
  valorPendente: number;
  quantidadeProducao: number;
  quantidadePendentes: number;
  quantidadeCanceladas: number;
  faixaGrupo: number;
};

function normalizeStatus(value: string) {
  const status = (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (status === 'producao') return 'producao';
  if (status === 'em aberto') return 'em_aberto';
  if (status === 'cancelado') return 'cancelado';

  return 'outro';
}

export function calculateFaixa(totalLiquido: number): number {
  if (totalLiquido >= 20000000) return 5;
  if (totalLiquido >= 7000000) return 4;
  if (totalLiquido >= 3000000) return 3;
  if (totalLiquido >= 1000000) return 2;
  return 1;
}

export function summarizeDailyRows(rows: DailyImportRow[]): CommissionSummary {
  const operacoesProducao = rows.filter(
    (row) => normalizeStatus(row.status) === 'producao'
  );

  const operacoesPendentes = rows.filter(
    (row) => normalizeStatus(row.status) === 'em_aberto'
  );

  const operacoesCanceladas = rows.filter(
    (row) => normalizeStatus(row.status) === 'cancelado'
  );

  const producaoValida = operacoesProducao.reduce(
    (acc, row) => acc + (row.valorLiquido || 0),
    0
  );

  const valorPendente = operacoesPendentes.reduce(
    (acc, row) => acc + (row.valorLiquido || 0),
    0
  );

  return {
    producaoValida,
    valorPendente,
    quantidadeProducao: operacoesProducao.length,
    quantidadePendentes: operacoesPendentes.length,
    quantidadeCanceladas: operacoesCanceladas.length,
    faixaGrupo: calculateFaixa(producaoValida),
  };
}
