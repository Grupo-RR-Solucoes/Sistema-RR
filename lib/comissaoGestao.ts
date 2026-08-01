/**
 * COMISSÃO DE GESTÃO — FONTE ÚNICA DO CÁLCULO.
 *
 * Regra (Diego, 31/07/2026): o gestor recebe 0,10% sobre a PRODUÇÃO LÍQUIDA DA
 * REDE DELE. A mesma régua vale para supervisor e para gerente_regional:
 *   - supervisor       -> sobre a rede dele;
 *   - gerente_regional -> sobre a rede INTEIRA dele, o que inclui os promotores
 *                         dos supervisores abaixo.
 * A sobreposição entre os dois níveis é INTENCIONAL: a mesma produção remunera
 * o supervisor e o gerente acima dele. Não é dupla contagem a corrigir.
 *
 * NINGUÉM RECALCULA ISTO INLINE. Se aparecer um `* 0.001` ou um `/ 1000` em
 * qualquer tela, rota ou script, é bug — chame calcularComissaoGestao.
 *
 * O QUE ESTE MÓDULO NÃO FAZ:
 *   - não soma produção. A base ENTRA pronta, vinda de quem já somou;
 *   - não lê banco, não conhece Supabase, não sabe o que é RLS;
 *   - não tem nada a ver com repasse de PROMOTOR. Comissão de promotor não
 *     passa por aqui e não pode aparecer na tela do gestor.
 */

/**
 * 0,10% — em fração, não em pontos percentuais. Constante NOMEADA de propósito:
 * o número solto espalhado pelo código é o que impede achar todos os pontos de
 * mudança quando a régua mudar.
 */
export const PERCENTUAL_COMISSAO_GESTAO = 0.001;

/** Rótulo pronto para a tela, para não haver duas versões do mesmo texto. */
export const PERCENTUAL_COMISSAO_GESTAO_LABEL = "0,10%";

export type ComissaoGestao = {
  /** A fração aplicada (PERCENTUAL_COMISSAO_GESTAO), ecoada para a tela. */
  percentual: number;
  /** Produção líquida da rede já realizada na competência. */
  base_acumulada: number;
  /** Comissão sobre o realizado. */
  valor_acumulado: number;
  /**
   * Produção líquida projetada para o fim da competência. NULL em mês FECHADO:
   * projeção de mês fechado não existe — o mês já aconteceu.
   */
  base_projetada: number | null;
  /** Comissão sobre a projeção. NULL pelo mesmo motivo. */
  valor_projetado: number | null;
};

/** Arredonda a 2 casas sem herdar erro binário (mesma forma usada no repo). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Aplica a régua sobre uma base JÁ SOMADA.
 *
 * @param baseAcumulada  produção líquida realizada da rede na competência.
 * @param baseProjetada  produção líquida projetada; passe null em mês fechado.
 */
export function calcularComissaoGestao(
  baseAcumulada: number,
  baseProjetada: number | null,
): ComissaoGestao {
  const acumulada = Number.isFinite(baseAcumulada) ? baseAcumulada : 0;
  const projetada =
    baseProjetada != null && Number.isFinite(baseProjetada) ? baseProjetada : null;

  return {
    percentual: PERCENTUAL_COMISSAO_GESTAO,
    base_acumulada: round2(acumulada),
    valor_acumulado: round2(acumulada * PERCENTUAL_COMISSAO_GESTAO),
    base_projetada: projetada == null ? null : round2(projetada),
    valor_projetado:
      projetada == null ? null : round2(projetada * PERCENTUAL_COMISSAO_GESTAO),
  };
}
