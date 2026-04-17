'use client';

import { useMemo, useState } from 'react';
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

export default function DailyImportClient() {
  const [summary, setSummary] = useState<ReturnType<typeof parseDailyWorkbook> | null>(null);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState('Nenhum arquivo carregado ainda.');

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const parsed = parseDailyWorkbook(buffer);

    setSummary(parsed);
    setFileName(file.name);
    setStatus(
      `${parsed.operacoes.length} registros lidos | ${parsed.quantidadeProducao} em produção | ${parsed.quantidadePendentes} pendentes | ${parsed.quantidadeCanceladas} canceladas.`
    );
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
