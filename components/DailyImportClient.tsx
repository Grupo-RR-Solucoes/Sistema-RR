'use client';

import React, { useMemo, useState } from 'react';
import { parseDailyWorkbook } from '../lib/parseDaily';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value || 0);
}

function estimateFaixa(total: number) {
  if (total >= 20000000) return 'Faixa 5';
  if (total >= 7000000) return 'Faixa 4';
  if (total >= 3000000) return 'Faixa 3';
  if (total >= 1000000) return 'Faixa 2';
  return 'Faixa 1';
}

type FechamentoItem = {
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
  updated_at?: string;
};

type FechamentoResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  linhasProcessadas?: number;
  recebimentosSalvos?: number;
  fechamentosGerados?: number;
  fechamento?: FechamentoItem[];
};

export default function DailyImportClient() {
  const [summary, setSummary] = useState<ReturnType<typeof parseDailyWorkbook> | null>(null);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState('Nenhum arquivo carregado ainda.');
  const [sending, setSending] = useState(false);
  const [backendMessage, setBackendMessage] = useState('');
  const [backendError, setBackendError] = useState('');
  const [apiResult, setApiResult] = useState<FechamentoResponse | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setBackendMessage('');
      setBackendError('');
      setApiResult(null);

      const buffer = await file.arrayBuffer();
      const parsed = parseDailyWorkbook(buffer);

      setSummary(parsed);
      setFileName(file.name);
      setStatus(
        `${parsed.operacoes.length} registros lidos | ${parsed.quantidadeProducao} em produção | ${parsed.quantidadePendentes} pendentes | ${parsed.quantidadeCanceladas} canceladas.`
      );
    } catch (error) {
      console.error(error);
      setSummary(null);
      setFileName(file.name);
      setStatus('Erro ao ler a planilha.');
      setBackendError('Não foi possível ler a planilha selecionada.');
    }
  }

  async function handleSendToBackend() {
    if (!summary) {
      setBackendError('Selecione uma planilha antes de enviar.');
      setBackendMessage('');
      return;
    }

    try {
      setSending(true);
      setBackendError('');
      setBackendMessage('');
      setApiResult(null);

      const rows = summary.operacoes.map((op) => ({
        externalKey: op.externalKey,
        empresaCnpj: '00000000000000',
        numeroOperacao: op.numeroProposta,
        dataReferencia: op.dataContrato,
        tipoRecebimento: 'producao',
        valorRecebido: Number(op.valorLiquido || 0),
        valorDiferido: 0,
        valorSeguro: 0,
        valorEstorno: 0,
        valorRenovacao: 0,
        status: op.status,
        observacao: '',
      }));

      const response = await fetch('/api/fechamento', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rows }),
      });

      const data: FechamentoResponse = await response.json();

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || data.message || 'Erro ao enviar dados para o backend.');
      }

      setApiResult(data);
      setBackendMessage(data.message || 'Fechamento enviado com sucesso.');
    } catch (error) {
      console.error(error);
      setBackendError(
        error instanceof Error ? error.message : 'Erro inesperado ao enviar os dados.'
      );
    } finally {
      setSending(false);
    }
  }

  const metrics = useMemo(() => {
    if (!summary) {
      return {
        producaoValida: 0,
        valorPendente: 0,
        faixa: 'Faixa 1',
      };
    }

    return {
      producaoValida: summary.producaoValida,
      valorPendente: summary.valorPendente,
      faixa: estimateFaixa(summary.producaoValida),
    };
  }, [summary]);

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section
        style={{
          background: '#fff',
          border: '1px solid #d9dde7',
          borderRadius: 20,
          padding: 24,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 24 }}>Importar produção diária</h2>
        <p style={{ color: '#556070' }}>
          Envie a planilha diária .xlsx. O sistema vai ler a primeira aba e separar
          produção válida, pendentes e canceladas.
        </p>

        <input type="file" accept=".xlsx,.xls" onChange={handleFile} />

        <div style={{ marginTop: 12, color: '#556070' }}>
          <strong>Arquivo:</strong> {fileName || 'Nenhum'}
        </div>

        <div style={{ marginTop: 8, color: '#556070' }}>{status}</div>

        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={handleSendToBackend}
            disabled={!summary || sending}
            style={{
              background: sending ? '#9aa4b2' : '#111827',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              padding: '12px 18px',
              cursor: !summary || sending ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            {sending ? 'Enviando...' : 'Enviar para o fechamento mensal'}
          </button>
        </div>

        {backendMessage ? (
          <div style={{ marginTop: 16, color: '#067647', fontWeight: 600 }}>
            {backendMessage}
          </div>
        ) : null}

        {backendError ? (
          <div style={{ marginTop: 16, color: '#b42318', fontWeight: 600 }}>
            {backendError}
          </div>
        ) : null}
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}
      >
        <Card label="Operações em produção" value={String(summary?.quantidadeProducao ?? 0)} />
        <Card label="Propostas pendentes" value={String(summary?.quantidadePendentes ?? 0)} />
        <Card label="Propostas canceladas" value={String(summary?.quantidadeCanceladas ?? 0)} />
        <Card label="Produção válida" value={formatCurrency(metrics.producaoValida)} />
        <Card label="Valor pendente" value={formatCurrency(metrics.valorPendente)} />
        <Card label="Faixa do grupo" value={metrics.faixa} />
      </section>

      {apiResult?.fechamento && apiResult.fechamento.length > 0 ? (
        <section
          style={{
            background: '#fff',
            border: '1px solid #d9dde7',
            borderRadius: 20,
            padding: 24,
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 24 }}>Retorno do fechamento</h2>

          <div style={{ marginBottom: 16, color: '#556070', display: 'grid', gap: 6 }}>
            <div>
              <strong>Linhas processadas:</strong> {apiResult.linhasProcessadas ?? 0}
            </div>
            <div>
              <strong>Recebimentos salvos:</strong> {apiResult.recebimentosSalvos ?? 0}
            </div>
            <div>
              <strong>Fechamentos gerados:</strong> {apiResult.fechamentosGerados ?? 0}
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Ano</TableHead>
                  <TableHead>Mês</TableHead>
                  <TableHead>À vista</TableHead>
                  <TableHead>Diferido</TableHead>
                  <TableHead>Seguro</TableHead>
                  <TableHead>Estorno</TableHead>
                  <TableHead>Renovação</TableHead>
                  <TableHead>Líquido</TableHead>
                  <TableHead>Operações</TableHead>
                </tr>
              </thead>
              <tbody>
                {apiResult.fechamento.map((item) => (
                  <tr key={`${item.empresa_cnpj}-${item.ano}-${item.mes}`}>
                    <TableCell>{item.empresa_cnpj}</TableCell>
                    <TableCell>{item.ano}</TableCell>
                    <TableCell>{item.mes}</TableCell>
                    <TableCell>{formatCurrency(item.valor_avista)}</TableCell>
                    <TableCell>{formatCurrency(item.valor_diferido)}</TableCell>
                    <TableCell>{formatCurrency(item.valor_seguro)}</TableCell>
                    <TableCell>{formatCurrency(item.valor_estorno)}</TableCell>
                    <TableCell>{formatCurrency(item.valor_renovacao)}</TableCell>
                    <TableCell>{formatCurrency(item.valor_liquido)}</TableCell>
                    <TableCell>{String(item.operacoes)}</TableCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #d9dde7',
        borderRadius: 20,
        padding: 20,
      }}
    >
      <div style={{ color: '#556070', marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function TableHead({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '12px 10px',
        borderBottom: '1px solid #d9dde7',
        fontSize: 14,
      }}
    >
      {children}
    </th>
  );
}

function TableCell({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: '12px 10px',
        borderBottom: '1px solid #eef1f5',
        fontSize: 14,
      }}
    >
      {children}
    </td>
  );
}
