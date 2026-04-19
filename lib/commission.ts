type Operation = {
  valor_liquido: number; // base correta
  taxa_juros: number;
  prazo: number;
};

type CommissionResult = {
  percentual_total: number;
  valor_total: number;

  avista_empresa: number;
  avista_promotor: number;

  spread_empresa: number;
  diferido: number;
};

/**
 * TABELA SIMPLIFICADA (exemplo inicial)
 * Você pode expandir depois conforme produto/taxa/prazo
 */
function getPercentualTabela(taxa: number, prazo: number): number {
  // EXEMPLO baseado no PDF (faixas reais simplificadas)
  if (taxa >= 2.18 && taxa <= 2.27) return 0.0611; // 6.11%
  if (taxa >= 2.28 && taxa <= 2.37) return 0.0692; // 6.92%
  if (taxa >= 2.38 && taxa <= 2.47) return 0.0815; // 8.15%

  return 0.04; // fallback
}

export function calculateCommission(op: Operation): CommissionResult {
  const percentual = getPercentualTabela(op.taxa_juros, op.prazo);

  const valorTotal = op.valor_liquido * percentual;

  // 🔴 REGRA PROMOTIVA
  const avistaEmpresa = Math.min(valorTotal, op.valor_liquido * 0.06);

  // 🔴 REGRA SUA (PROMOTOR 5.8%)
  const avistaPromotor = Math.min(valorTotal, op.valor_liquido * 0.058);

  const diferido = Math.max(valorTotal - avistaEmpresa, 0);

  const spreadEmpresa = avistaEmpresa - avistaPromotor;

  return {
    percentual_total: percentual,
    valor_total: valorTotal,

    avista_empresa: avistaEmpresa,
    avista_promotor: avistaPromotor,

    spread_empresa: spreadEmpresa,
    diferido: diferido,
  };
}

/**
 * Para lista de operações
 */
export function calculateBatch(ops: Operation[]) {
  let total = {
    valor_total: 0,
    avista_empresa: 0,
    avista_promotor: 0,
    diferido: 0,
    spread_empresa: 0,
  };

  const results = ops.map((op) => {
    const r = calculateCommission(op);

    total.valor_total += r.valor_total;
    total.avista_empresa += r.avista_empresa;
    total.avista_promotor += r.avista_promotor;
    total.diferido += r.diferido;
    total.spread_empresa += r.spread_empresa;

    return r;
  });

  return { results, total };
}
