type Operation = {
  valor_liquido: number;
  valor_bruto: number;
  valor_seguro: number;

  taxa_juros: number;
  prazo: number;

  tem_seguro: boolean;
};

/**
 * -------------------------
 * REGRAS PROMOTIVA
 * -------------------------
 */

function getPercentualCredito(taxa: number): number {
  if (taxa >= 2.18 && taxa <= 2.27) return 0.0611;
  if (taxa >= 2.28 && taxa <= 2.37) return 0.0692;
  if (taxa >= 2.38 && taxa <= 2.47) return 0.0815;

  return 0.04;
}

function getPercentualSeguroPrazo(prazo: number): number {
  if (prazo <= 36) return 0.0015;
  if (prazo <= 60) return 0.0025;
  if (prazo <= 84) return 0.0040;
  return 0.0055;
}

/**
 * -------------------------
 * TABELA INTERNA PROMOTOR (SIMPLIFICADA)
 * BASEADA EM PENETRAÇÃO
 * -------------------------
 */

function getComissaoPromotorSeguro(penetracao: number): number {
  if (penetracao >= 0.6) return 0.40;
  if (penetracao >= 0.4) return 0.30;
  if (penetracao >= 0.2) return 0.20;
  return 0.10;
}

/**
 * -------------------------
 * MOTOR PRINCIPAL
 * -------------------------
 */

export function calcularOperacao(op: Operation) {
  /**
   * CRÉDITO
   */
  const percCredito = getPercentualCredito(op.taxa_juros);

  const comissaoTotalCredito = op.valor_liquido * percCredito;

  const avistaEmpresa = Math.min(
    comissaoTotalCredito,
    op.valor_liquido * 0.06
  );

  const avistaPromotor = Math.min(
    comissaoTotalCredito,
    op.valor_liquido * 0.058
  );

  const diferido = Math.max(comissaoTotalCredito - avistaEmpresa, 0);

  const spreadEmpresa = avistaEmpresa - avistaPromotor;

  /**
   * SEGURO (PROMOTIVA)
   */
  let comissaoSeguroEmpresa = 0;

  if (op.tem_seguro) {
    const percSeguro = getPercentualSeguroPrazo(op.prazo);

    comissaoSeguroEmpresa = op.valor_bruto * percSeguro;
  }

  /**
   * PENETRAÇÃO
   */
  const penetracao = op.valor_seguro > 0
    ? op.valor_seguro / op.valor_liquido
    : 0;

  /**
   * SEGURO PROMOTOR (SUA REGRA)
   */
  let comissaoSeguroPromotor = 0;

  if (op.tem_seguro) {
    const percPromotor = getComissaoPromotorSeguro(penetracao);

    comissaoSeguroPromotor =
      op.valor_seguro * percPromotor;
  }

  /**
   * DIFERIDO PARCELADO
   */
  const parcelas = op.prazo;

  const valorParcela = parcelas > 0 ? diferido / parcelas : 0;

  return {
    credito: {
      percentual: percCredito,
      total: comissaoTotalCredito,
      avista_empresa: avistaEmpresa,
      avista_promotor: avistaPromotor,
      diferido,
      spreadEmpresa,
    },

    seguro: {
      empresa: comissaoSeguroEmpresa,
      promotor: comissaoSeguroPromotor,
      penetracao,
    },

    diferido: {
      total: diferido,
      parcelas,
      valorParcela,
    },

    total_geral: {
      empresa:
        avistaEmpresa +
        spreadEmpresa +
        comissaoSeguroEmpresa,

      promotor:
        avistaPromotor +
        comissaoSeguroPromotor,
    },
  };
}
