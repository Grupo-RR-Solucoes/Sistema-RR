import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { calcularOperacao } from "@/lib/motor";

type InputRow = {
  external_key: string;
  empresa_cnpj: string;
  numero_operacao: string;
  data_referencia: string;

  valor_liquido: number;
  valor_bruto: number;
  valor_seguro: number;

  taxa_juros: number;
  prazo: number;

  tem_seguro: boolean;
};

async function salvarParcelasDiferido(
  operacaoId: string,
  prazo: number,
  valorParcela: number
) {
  if (!prazo || valorParcela <= 0) return;

  const hoje = new Date();

  const parcelas = Array.from({ length: prazo }, (_, i) => {
    const data = new Date(hoje);
    data.setMonth(data.getMonth() + (i + 1));

    return {
      operacao_id: operacaoId,
      parcela_numero: i + 1,
      valor: valorParcela,
      data_prevista: data.toISOString(),
      status: "pendente",
    };
  });

  await supabaseAdmin.from("diferido_parcelas").insert(parcelas);
}

export async function processarFechamento(rows: InputRow[]) {
  const registros: any[] = [];

  for (const row of rows) {
    const resultado = calcularOperacao({
      valor_liquido: row.valor_liquido,
      valor_bruto: row.valor_bruto,
      valor_seguro: row.valor_seguro,
      taxa_juros: row.taxa_juros,
      prazo: row.prazo,
      tem_seguro: row.tem_seguro,
    });

    registros.push({
      external_key: row.external_key,
      empresa_cnpj: row.empresa_cnpj,
      numero_operacao: row.numero_operacao,
      data_referencia: row.data_referencia,

      tipo_recebimento: "credito",

      valor_recebido: resultado.credito.avista_empresa,
      valor_diferido: resultado.credito.diferido,
      valor_seguro: resultado.seguro.empresa,
      valor_estorno: 0,
      valor_renovacao: 0,

      status: "processado",
      observacao: "Processado automaticamente",
      _resultado: resultado, // uso interno
    });
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("recebimento_mensal")
    .upsert(registros, { onConflict: "external_key" })
    .select();

  if (error) {
    throw new Error(error.message);
  }

  if (!inserted) {
    throw new Error("Falha ao inserir registros");
  }

  // salvar parcelas diferidas
  for (let i = 0; i < inserted.length; i++) {
    const op = registros[i]._resultado;

    await salvarParcelasDiferido(
      inserted[i].id,
      op.diferido.parcelas,
      op.diferido.valorParcela
    );
  }

  // consolidação
  const fechamentoMap: Record<string, any> = {};

  for (const r of registros) {
    const data = new Date(r.data_referencia);
    const ano = data.getFullYear();
    const mes = data.getMonth() + 1;

    const key = `${r.empresa_cnpj}_${ano}_${mes}`;

    if (!fechamentoMap[key]) {
      fechamentoMap[key] = {
        empresa_cnpj: r.empresa_cnpj,
        ano,
        mes,
        valor_avista: 0,
        valor_diferido: 0,
        valor_seguro: 0,
        valor_estorno: 0,
        valor_renovacao: 0,
        valor_liquido: 0,
        operacoes: 0,
      };
    }

    fechamentoMap[key].valor_avista += r.valor_recebido;
    fechamentoMap[key].valor_diferido += r.valor_diferido;
    fechamentoMap[key].valor_seguro += r.valor_seguro;
    fechamentoMap[key].operacoes += 1;
  }

  const fechamentoArray = Object.values(fechamentoMap).map((f: any) => ({
    ...f,
    valor_liquido:
      f.valor_avista +
      f.valor_diferido +
      f.valor_seguro -
      f.valor_estorno -
      f.valor_renovacao,
  }));

  const { error: fechamentoError } = await supabaseAdmin
    .from("fechamento_mensal_empresa")
    .upsert(fechamentoArray, {
      onConflict: "empresa_cnpj,ano,mes",
    });

  if (fechamentoError) {
    throw new Error(fechamentoError.message);
  }

  return {
    sucesso: true,
    total_operacoes: registros.length,
    fechamento: fechamentoArray,
  };
}
