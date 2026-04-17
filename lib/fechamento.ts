import { MonthlyImportRow, MonthlySummary } from './monthlyTypes';

function getYearMonth(dateValue?: string) {
  const base = dateValue ? new Date(dateValue) : new Date();
  return {
    ano: base.getFullYear(),
    mes: base.getMonth() + 1,
  };
}

export function summarizeMonthlyRows(rows: MonthlyImportRow[]): MonthlySummary {
  const porEmpresa: MonthlySummary['porEmpresa'] = {};

  for (const row of rows) {
    if (!porEmpresa[row.empresaCnpj]) {
      porEmpresa[row.empresaCnpj] = {
        quantidade: 0,
        valorAvista: 0,
        valorDiferido: 0,
        valorSeguro: 0,
        valorEstorno: 0,
        valorRenovacao: 0,
        valorLiquido: 0,
      };
    }

    porEmpresa[row.empresaCnpj].quantidade += 1;
    porEmpresa[row.empresaCnpj].valorAvista += row.valorRecebido;
    porEmpresa[row.empresaCnpj].valorDiferido += row.valorDiferido;
    porEmpresa[row.empresaCnpj].valorSeguro += row.valorSeguro;
    porEmpresa[row.empresaCnpj].valorEstorno += row.valorEstorno;
    porEmpresa[row.empresaCnpj].valorRenovacao += row.valorRenovacao;
    porEmpresa[row.empresaCnpj].valorLiquido +=
      row.valorRecebido +
      row.valorDiferido +
      row.valorSeguro -
      row.valorEstorno +
      row.valorRenovacao;
  }

  const totalAvista = rows.reduce((acc, row) => acc + row.valorRecebido, 0);
  const totalDiferido = rows.reduce((acc, row) => acc + row.valorDiferido, 0);
  const totalSeguro = rows.reduce((acc, row) => acc + row.valorSeguro, 0);
  const totalEstorno = rows.reduce((acc, row) => acc + row.valorEstorno, 0);
  const totalRenovacao = rows.reduce((acc, row) => acc + row.valorRenovacao, 0);

  return {
    registros: rows,
    totalAvista,
    totalDiferido,
    totalSeguro,
    totalEstorno,
    totalRenovacao,
    totalLiquido:
      totalAvista + totalDiferido + totalSeguro - totalEstorno + totalRenovacao,
    quantidade: rows.length,
    porEmpresa,
  };
}

export function extractEmpresaFechamentos(rows: MonthlyImportRow[]) {
  const grouped = new Map<string, MonthlyImportRow[]>();

  for (const row of rows) {
    const key = row.empresaCnpj;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }

  return Array.from(grouped.entries()).map(([empresaCnpj, empresaRows]) => {
    const summary = summarizeMonthlyRows(empresaRows);
    const { ano, mes } = getYearMonth(empresaRows[0]?.dataReferencia);

    return {
      empresa_cnpj: empresaCnpj,
      ano,
      mes,
      valor_avista: summary.totalAvista,
      valor_diferido: summary.totalDiferido,
      valor_seguro: summary.totalSeguro,
      valor_estorno: summary.totalEstorno,
      valor_renovacao: summary.totalRenovacao,
      valor_liquido: summary.totalLiquido,
      operacoes: summary.quantidade,
      updated_at: new Date().toISOString(),
    };
  });
}
