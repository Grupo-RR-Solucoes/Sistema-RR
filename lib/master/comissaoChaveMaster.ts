// ============================================================
// comissaoChaveMaster — CHAVE MASTER É BALDE, NÃO RECEBE COMISSÃO.
//
// A taxonomia do sistema: chave master (j_keys key_type=MASTER, refletido em
// promoters.is_master) é o CNPJ, um balde de produção sem dono individual. Ela
// não é promotor e não recebe repasse. Telas, daily, /equipe e projeção já
// aplicam esse filtro; `cmsMonthly.ts:268-275` aplica na ORIGEM, ao derivar o
// PMR do cms.
//
// O QUE FALTAVA: `closingMonthly` (o consolidador da RR, source='fechamento')
// NÃO aplicava. Ele só excluía a chave master da ADS/BBTS — outra coisa. Medido
// em 02/09/2026: 2 linhas vivas em 2026-04, source='fechamento', R$ 164,04
// (JULIANA … CHAVE MASTER, PE, R$ 46,96; RENATA … CHAVE MASTER AL 3, R$ 117,08).
//
// A anotação que existia sobre isso errava em DOIS pontos — dizia "escopo só
// fev/2026, R$ 18,91, source cms". Não é fev (2026-02 tem 5 linhas master, todas
// com R$ 0,00 — aquele caso foi resolvido) e não é cms (o cms já zera). Era o
// fechamento, em abril.
//
// ESCOPO: isto é DEFESA, para o defeito não voltar. Não limpa o fóssil de
// 2026-04 — limpar exigiria reconsolidar mês fechado, que mexe em dinheiro, e é
// decisão à parte.
//
// O QUE NÃO SE ZERA: `production_value`, `proposal_count`, penetração e afins.
// A linha do balde continua existindo com a produção dele; só o REPASSE é zero.
// Apagar a linha esconderia produção real.
// ============================================================

export interface ComissoesDoPromotor {
  productionCommission: number;
  insuranceCommission: number;
  finalCommission: number;
}

/**
 * Zera a comissão quando o promotor é chave master.
 *
 * `isMaster === true` ESTRITO: `is_master` vem `null` para a maioria das linhas
 * antigas, e uma leitura por truthiness (`!isMaster`) inverteria o sentido em
 * metade do cadastro. Mesma disciplina do `trp_multi_versao`.
 *
 * Função pura, para o portão (scripts/gate_master_sem_comissao.cjs) poder mutar
 * a regra sem banco.
 */
export function comissaoDeChaveMaster(
  isMaster: boolean | null | undefined,
  productionCommission: number,
  insuranceCommission: number
): ComissoesDoPromotor {
  const master = isMaster === true;
  const producao = master ? 0 : productionCommission;
  const seguro = master ? 0 : insuranceCommission;
  return {
    productionCommission: producao,
    insuranceCommission: seguro,
    finalCommission: producao + seguro,
  };
}
