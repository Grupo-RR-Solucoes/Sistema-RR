// ETAPA 2B — Lookup TRP Crédito PF · ISOLADO, NÃO plugado no motor.
//
// Função pura que, dada a matriz da TRP (linhas de trp_credit_rules) e uma
// operação {tabela_ref, juros, prazo, faixa}, retorna o % à vista que a TRP
// prevê. Usada para CONFERIR o que a Promotiva pagou e (futuro/Etapa 3) para
// eventualmente CALCULAR. O motor atual NÃO usa isto — continua lendo o % do
// import diário (raw_payload).
//
// Convenções:
//   - juros_min/max e prazo_min/max: null = limite aberto ("A partir de",
//     "Acima de"). Ranges fechados batem por <=/>= com tolerância.
//   - faixa: 1..5; null = produto "Geral" (não varia por faixa).
//   - percent: em pontos percentuais (ex.: 2.44 = 2,44%). O TETO à vista (6%,
//     ou o teto efetivo observado) é aplicado FORA desta função (decisão do
//     chamador), porque o % bruto da tabela pode exceder o teto e o excedente
//     é diferido (PRT).

export type TrpCreditRule = {
  competencia: string; // 'YYYY-MM-01'
  tabela_ref: string; // '1.2'..'3.4'
  juros_min: number | null;
  juros_max: number | null;
  prazo_min: number | null;
  prazo_max: number | null;
  faixa: number | null; // 1..5 | null (Geral)
  percent: number; // ex.: 2.44
};

export type TrpLookupInput = {
  competencia: string;
  tabelaRef: string;
  juros: number;
  prazo: number;
  faixa: number; // 1..5
};

export type TrpLookupResult = {
  percent: number | null; // % à vista APLICÁVEL = min(percentRaw, TETO_RR)
  percentRaw: number | null; // % da tabela TRP (antes do teto)
  capped: boolean; // true quando a tabela estourou o teto e foi limitada a 5,80
  matched: TrpCreditRule | null;
  candidates: number;
  reason: string;
};

// Teto efetivo à vista do RR: a Promotiva paga até 6%, o RR limita o promotor
// a 5,80% (o spread de 0,20% fica com a empresa). O lookup já devolve o valor
// limitado; o excedente acima do teto é pago de forma diferida (PRT).
export const TETO_RR = 5.8;

const EPS = 1e-9;

function jurosMatches(r: TrpCreditRule, j: number): boolean {
  return (
    (r.juros_min === null || j >= r.juros_min - EPS) &&
    (r.juros_max === null || j <= r.juros_max + EPS)
  );
}

function prazoMatches(r: TrpCreditRule, p: number): boolean {
  return (
    (r.prazo_min === null || p >= r.prazo_min) &&
    (r.prazo_max === null || p <= r.prazo_max)
  );
}

// Largura do range (para desempate: regra mais específica vence). null = aberto
// => largura "grande" para perder do range fechado mais estreito.
function specificity(r: TrpCreditRule): number {
  const jw =
    r.juros_min !== null && r.juros_max !== null ? r.juros_max - r.juros_min : 1e6;
  const pw =
    r.prazo_min !== null && r.prazo_max !== null ? r.prazo_max - r.prazo_min : 1e6;
  return jw + pw;
}

/**
 * Resolve o % à vista da TRP para uma operação. Não aplica teto.
 * Trata faixas abertas (prazo "Acima de N"/"A partir de N") e ranges de juros.
 */
export function lookupTrpCredit(
  rules: TrpCreditRule[],
  input: TrpLookupInput,
): TrpLookupResult {
  const cands = rules.filter(
    (r) =>
      r.competencia === input.competencia &&
      r.tabela_ref === input.tabelaRef &&
      (r.faixa === null || r.faixa === input.faixa) &&
      jurosMatches(r, input.juros) &&
      prazoMatches(r, input.prazo),
  );

  if (cands.length === 0) {
    return {
      percent: null,
      percentRaw: null,
      capped: false,
      matched: null,
      candidates: 0,
      reason: "nenhuma regra casou (competencia/tabela/juros/prazo/faixa)",
    };
  }

  cands.sort((a, b) => specificity(a) - specificity(b));
  const r = cands[0];
  const applied = Math.min(r.percent, TETO_RR);
  return {
    percent: applied,
    percentRaw: r.percent,
    capped: r.percent > TETO_RR + EPS,
    matched: r,
    candidates: cands.length,
    reason: cands.length > 1 ? "ok (multiplos candidatos; usou o mais especifico)" : "ok",
  };
}

/**
 * Faixa por produção líquida mensal do grupo (desconsiderando SRCC).
 * Limiares TRP: F1 base, F2 1MM, F3 3MM, F4 7MM, F5 20MM.
 * Obs.: a Promotiva pode classificar o grupo num tier contratual fixo
 * (Grupo RR = Faixa 3) que não bate com o net parcial do mês — usar com
 * cautela; preferir o tier confirmado quando houver.
 */
export function faixaPorProducao(producaoLiquidaMensal: number): number {
  if (producaoLiquidaMensal >= 20_000_000) return 5;
  if (producaoLiquidaMensal >= 7_000_000) return 4;
  if (producaoLiquidaMensal >= 3_000_000) return 3;
  if (producaoLiquidaMensal >= 1_000_000) return 2;
  return 1;
}
