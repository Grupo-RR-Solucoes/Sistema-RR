import * as XLSX from "xlsx";
import {
  DailyImportRow,
  EmpresaDetectadaResumo,
  ParsedDailySummary,
} from './types';

function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function onlyNumbers(value: string) {
  return value.replace(/\D/g, '');
}

function pick(row: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(row);

  for (const alias of aliases) {
    const wanted = normalizeKey(alias);
    const found = entries.find(([key]) => normalizeKey(key) === wanted);
    if (found) return found[1];
  }

  return undefined;
}

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;

  if (typeof value === 'string') {
    let cleaned = value.trim();
    if (!cleaned) return 0;

    cleaned = cleaned.replace(/[R$\s]/g, '');

    const hasComma = cleaned.includes(',');
    const hasDot = cleaned.includes('.');

    if (hasComma && hasDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
      cleaned = cleaned.replace(',', '.');
    } else if (hasDot) {
      const parts = cleaned.split('.');
      if (!(parts.length === 2 && parts[1].length <= 2)) {
        cleaned = cleaned.replace(/\./g, '');
      }
    }

    cleaned = cleaned.replace(/[^0-9.-]/g, '');

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatDate(value: unknown): string {
  if (typeof value === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const result = new Date(excelEpoch.getTime() + value * 86400000);
    return result.toISOString().slice(0, 10);
  }

  const text = asString(value);
  if (!text) return '';

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
    const [dd, mm, yyyy] = text.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return '';
}

function normalizeStatus(value: string) {
  const status = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (status === 'producao') return 'producao';
  if (status === 'em aberto') return 'em_aberto';
  if (status === 'cancelado') return 'cancelado';

  return 'outro';
}

const EMPRESAS_POR_MCI: Record<string, { empresaNome: string; empresaCnpj: string }> = {
  '847822962': {
    empresaNome: 'RR SOLUÇÕES LTDA',
    empresaCnpj: '48357275000103',
  },
  '873386662': {
    empresaNome: 'RR SOLUÇÕES AL LTDA',
    empresaCnpj: '56140658000153',
  },
  '873298328': {
    empresaNome: 'RR AL SOLUÇÕES LTDA',
    empresaCnpj: '55867409000100',
  },
  '850169280': {
    empresaNome: 'RR SOLUÇÕES PE LTDA',
    empresaCnpj: '51457289000103',
  },
};

const EMPRESAS_POR_COBAN: Record<string, { empresaNome: string; empresaCnpj: string }> = {
  '98250': {
    empresaNome: 'RR SOLUÇÕES LTDA',
    empresaCnpj: '48357275000103',
  },
  '18309': {
    empresaNome: 'RR SOLUÇÕES AL LTDA',
    empresaCnpj: '56140658000153',
  },
  '20466': {
    empresaNome: 'RR AL SOLUÇÕES LTDA',
    empresaCnpj: '55867409000100',
  },
  '14692': {
    empresaNome: 'RR SOLUÇÕES PE LTDA',
    empresaCnpj: '51457289000103',
  },
};

function detectarEmpresaPorLinha(mciRaw: string, cobanRaw: string) {
  const mci = onlyNumbers(mciRaw);
  if (mci && EMPRESAS_POR_MCI[mci]) {
    const empresa = EMPRESAS_POR_MCI[mci];
    return {
      empresaNome: empresa.empresaNome,
      empresaCnpj: empresa.empresaCnpj,
      identificadorTipo: 'mci' as const,
      identificadorValor: mci,
    };
  }

  const coban = onlyNumbers(cobanRaw);
  if (coban && EMPRESAS_POR_COBAN[coban]) {
    const empresa = EMPRESAS_POR_COBAN[coban];
    return {
      empresaNome: empresa.empresaNome,
      empresaCnpj: empresa.empresaCnpj,
      identificadorTipo: 'coban' as const,
      identificadorValor: coban,
    };
  }

  return {
    empresaNome: '',
    empresaCnpj: '',
    identificadorTipo: '' as const,
    identificadorValor: '',
  };
}

function resumirEmpresas(operacoes: DailyImportRow[]): EmpresaDetectadaResumo[] {
  const mapa = new Map<string, EmpresaDetectadaResumo>();

  for (const row of operacoes) {
    if (!row.empresaCnpj || !row.empresaNome) continue;

    const chave = row.empresaCnpj;

    if (!mapa.has(chave)) {
      mapa.set(chave, {
        empresaNome: row.empresaNome,
        empresaCnpj: row.empresaCnpj,
        quantidadeOperacoes: 0,
        identificadores: [],
      });
    }

    const atual = mapa.get(chave)!;
    atual.quantidadeOperacoes += 1;

    const identificador = row.identificadorTipo && row.identificadorValor
      ? `${row.identificadorTipo.toUpperCase()} ${row.identificadorValor}`
      : '';

    if (identificador && !atual.identificadores.includes(identificador)) {
      atual.identificadores.push(identificador);
    }
  }

  return Array.from(mapa.values()).sort((a, b) =>
    a.empresaNome.localeCompare(b.empresaNome, 'pt-BR')
  );
}

export function parseDailyWorkbook(arrayBuffer: ArrayBuffer): ParsedDailySummary {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
  });

  const operacoes = rows
    .map((row) => {
      const produto = asString(
        pick(row, ['Descrição do Produto', 'Descricao do Produto', 'Produto'])
      );

      const codigoConvenio = asString(
        pick(row, ['Código Convênio', 'Codigo Convenio'])
      );

      const dataProposta = formatDate(
        pick(row, ['Data Proposta'])
      );

      const numeroProposta = asString(
        pick(row, ['Número Proposta', 'Numero Proposta'])
      );

      const parcelas = asNumber(
        pick(row, ['Parcelas', 'Prazo'])
      );

      const valorFinanciado = asNumber(
        pick(row, ['Valor Financiado'])
      );

      const valorLiquido = asNumber(
        pick(row, [
          'Valor Financiado Líquido',
          'Valor Financiado Liquido',
          'Valor Líquido',
          'Valor Liquido',
        ])
      );

      const tipoLiberacao = asString(
        pick(row, ['Tipo de Liberação', 'Tipo de Liberacao'])
      );

      const dataContrato = formatDate(
        pick(row, ['Data Contrato'])
      );

      const status = asString(
        pick(row, ['Status'])
      );

      const mci = asString(
        pick(row, ['MCI', 'Codigo MCI', 'Código MCI'])
      );

      const codigoCoban = asString(
        pick(row, ['Cód. Coban', 'Cod. Coban', 'CÓD COBAN', 'COD COBAN', 'Código Coban', 'Codigo Coban', 'Coban'])
      );

      const empresa = detectarEmpresaPorLinha(mci, codigoCoban);
      const externalKeyBase = numeroProposta || `${mci}-${codigoCoban}-${dataContrato}-${valorLiquido}`;

      return {
        externalKey: externalKeyBase,
        produto,
        codigoConvenio,
        dataProposta,
        numeroProposta,
        parcelas,
        valorFinanciado,
        valorLiquido,
        tipoLiberacao,
        dataContrato,
        status,
        mci,
        codigoCoban,
        empresaNome: empresa.empresaNome,
        empresaCnpj: empresa.empresaCnpj,
        identificadorTipo: empresa.identificadorTipo,
        identificadorValor: empresa.identificadorValor,
      } satisfies DailyImportRow;
    })
    .filter((row) => row.numeroProposta && row.valorLiquido > 0);

  const operacoesProducao = operacoes.filter(
    (row) => normalizeStatus(row.status) === 'producao'
  );

  const operacoesPendentes = operacoes.filter(
    (row) => normalizeStatus(row.status) === 'em_aberto'
  );

  const operacoesCanceladas = operacoes.filter(
    (row) => normalizeStatus(row.status) === 'cancelado'
  );

  const empresasDetectadas = resumirEmpresas(operacoes);
  const quantidadeNaoIdentificadas = operacoes.filter(
    (row) => !row.empresaCnpj || !row.empresaNome
  ).length;

  return {
    operacoes,
    operacoesProducao,
    operacoesPendentes,
    operacoesCanceladas,
    quantidadeProducao: operacoesProducao.length,
    quantidadePendentes: operacoesPendentes.length,
    quantidadeCanceladas: operacoesCanceladas.length,
    producaoValida: operacoesProducao.reduce((acc, row) => acc + row.valorLiquido, 0),
    valorPendente: operacoesPendentes.reduce((acc, row) => acc + row.valorLiquido, 0),
    empresasDetectadas,
    quantidadeNaoIdentificadas,
  };
}
