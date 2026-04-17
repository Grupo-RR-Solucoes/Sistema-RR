import { MonthlyImportRow } from './types';

type FechamentoEmpresa = {
  empresa_cnpj: string;
  ano: number;
  mes: number;
  valor_avista: number;
  valor_diferido: number;
  valor_seguro: number;
  valor_estorno: number;
  valor_renovacao: number;
  valor_liquido: number;
  operacoes: number;
  updated_at: string;
};

function obterAnoMes(dataValue?: string) {
  const base = dataValue ? new Date(dataValue) : new Date();

  if (Number.isNaN(base.getTime())) {
    const agora = new Date();
    return {
      ano: agora.getFullYear(),
      mes: agora.getMonth() + 1,
    };
  }

  return {
    ano: base.getFullYear(),
    mes: base.getMonth() + 1,
  };
}

export function extractEmpresaFechamentos(
  rows: MonthlyImportRow[]
): FechamentoEmpresa[] {
  const mapa = new Map<string, FechamentoEmpresa>();

  for (const row of rows) {
    const { ano, mes } = obterAnoMes(row.dataReferencia);
    const chave = `${row.empresaCnpj}-${ano}-${mes}`;

    if (!mapa.has(chave)) {
      mapa.set(chave, {
        empresa_cnpj: row.empresaCnpj,
        ano,
        mes,
        valor_avista: 0,
        valor_diferido: 0,
        valor_seguro: 0,
        valor_estorno: 0,
        valor_renovacao: 0,
        valor_liquido: 0,
        operacoes: 0,
        updated_at: new Date().toISOString(),
      });
    }

    const atual = mapa.get(chave)!;

    const valorRecebido = Number(row.valorRecebido || 0);
    const valorDiferido = Number(row.valorDiferido || 0);
    const valorSeguro = Number(row.valorSeguro || 0);
    const valorEstorno = Number(row.valorEstorno || 0);
    const valorRenovacao = Number(row.valorRenovacao || 0);

    atual.valor_avista += valorRecebido;
    atual.valor_diferido += valorDiferido;
    atual.valor_seguro += valorSeguro;
    atual.valor_estorno += valorEstorno;
    atual.valor_renovacao += valorRenovacao;
    atual.valor_liquido +=
      valorRecebido +
      valorDiferido +
      valorSeguro +
      valorRenovacao -
      valorEstorno;
    atual.operacoes += 1;
    atual.updated_at = new Date().toISOString();
  }

  return Array.from(mapa.values());
}
