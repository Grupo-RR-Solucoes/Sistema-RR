import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { extractEmpresaFechamentos } from '../../../lib/fechamento';
import { MonthlyImportRow } from '../../../lib/monthlyTypes';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rows = (body.rows || []) as MonthlyImportRow[];

    if (!rows.length) {
      return NextResponse.json(
        { error: 'Nenhum registro mensal recebido.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const payload = rows.map((row) => ({
      external_key: row.externalKey,
      empresa_cnpj: row.empresaCnpj,
      numero_operacao: row.numeroOperacao,
      data_referencia: row.dataReferencia || null,
      tipo_recebimento: row.tipoRecebimento,
      valor_recebido: row.valorRecebido,
      valor_diferido: row.valorDiferido,
      valor_seguro: row.valorSeguro,
      valor_estorno: row.valorEstorno,
      valor_renovacao: row.valorRenovacao,
      status: row.status,
      observacao: row.observacao,
      updated_at: new Date().toISOString(),
    }));

    const { error: recebimentoError } = await supabase
      .from('recebimento_mensal')
      .upsert(payload, { onConflict: 'external_key' });

    if (recebimentoError) {
      return NextResponse.json(
        { error: recebimentoError.message },
        { status: 500 }
      );
    }

    const fechamentos = extractEmpresaFechamentos(rows);

    const { error: fechamentoError } = await supabase
      .from('fechamento_mensal_empresa')
      .upsert(fechamentos, { onConflict: 'empresa_cnpj,ano,mes' });

    if (fechamentoError) {
      return NextResponse.json(
        { error: fechamentoError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      inserted: rows.length,
      empresas: fechamentos.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Erro inesperado.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
