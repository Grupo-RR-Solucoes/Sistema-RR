// FRENTE DE PRODUTO — regua de repasse dos produtos de EVENTO UNICO (M2a).
//
// A comissao-EMPRESA ja vem pronta no fechamento (coluna COMISSAO da aba, gravada
// pelo M1 em monthly_closing_entries.commission_value). O repasse ao promotor e um
// fator do teto RR. A TRP so serve de AUDITORIA (recalcular e comparar), nunca de
// fonte do valor pago.

// Teto RR: o promotor recebe 58,33% da comissao-empresa (mesmo fator do a-vista).
export const FATOR_REPASSE_PROMOTOR = 0.5833;

export function repassePromotor(comissaoEmpresa: number): number {
  return Math.round(comissaoEmpresa * FATOR_REPASSE_PROMOTOR * 100) / 100;
}

// ----- Auditoria BBCAP (TRP 2026/213) -----
// UNICO 48  = 3,20% sobre o VALOR DO TITULO
// MENSAL 48 = 38,00% sobre a 1a PARCELA (= valor do titulo / 48)
// MENSAL 60 = 16,70% sobre a 1a PARCELA (= valor do titulo / 60)
// Verificado contra o gabarito de junho: 5/5 sem divergencia.
export type Trp213Resultado = {
  regra: string;
  esperado: number | null; // comissao-empresa que a TRP preve; null = produto sem regra mapeada
};

export function auditarBbcapTrp213(
  codigoProduto: string,
  valorTitulo: number
): Trp213Resultado {
  const c = String(codigoProduto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  const round2 = (v: number) => Math.round(v * 100) / 100;
  if (c.includes("UNICO")) {
    return { regra: "UNICO 3,20% x titulo", esperado: round2(0.032 * valorTitulo) };
  }
  if (c.includes("MENSAL") && c.includes("48")) {
    return { regra: "MENSAL 48 38,00% x 1a parcela", esperado: round2(0.38 * (valorTitulo / 48)) };
  }
  if (c.includes("MENSAL") && c.includes("60")) {
    return { regra: "MENSAL 60 16,70% x 1a parcela", esperado: round2(0.167 * (valorTitulo / 60)) };
  }
  return { regra: "(produto BBCAP sem regra mapeada)", esperado: null };
}

// Tolerancia de 1 centavo para a auditoria (arredondamento).
export function bbcapDiverge(comissaoEmpresa: number, esperado: number | null): boolean {
  if (esperado === null) return false; // sem regra -> nao acusa (so produtos conhecidos)
  return Math.abs(comissaoEmpresa - esperado) > 0.01;
}
