import * as XLSX from 'xlsx';
import { DailyImportRow, ParsedDailySummary } from './types';

function normalizeKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
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
        pick(row, ['Valor Financiado Líquido', 'Valor Financiado Liquido'])
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

      const externalKey = numeroProposta;

      return {
        externalKey,
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
      } satisfies DailyImportRow;
    })
    .filter((row) => row.numeroProposta && row.valorFinanciado > 0);

  const operacoesProducao = operacoes.filter(
    (row) => normalizeStatus(row.status) === 'producao'
  );

  const operacoesPendentes = operacoes.filter(
    (row) => normalizeStatus(row.status) === 'em_aberto'
  );

  const operacoesCanceladas = operacoes.filter(
    (row) => normalizeStatus(row.status) === 'cancelado'
  );

  return {
    operacoes,
    operacoesProducao,
    operacoesPendentes,
    operacoesCanceladas,
    quantidadeProducao: operacoesProducao.length,
    quantidadePendentes: operacoesPendentes.length,
    quantidadeCanceladas: operacoesCanceladas.length,
    producaoValida: operacoesProducao.reduce((acc, row) => acc + row.valorFinanciado, 0),
    valorPendente: operacoesPendentes.reduce((acc, row) => acc + row.valorFinanciado, 0),
  };
}
