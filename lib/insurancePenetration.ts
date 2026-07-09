// ============================================================================
// insurancePenetration — FONTE ÚNICA da penetração de seguro e do share de
// repasse ao promotor (Tabela de Remuneração RR, aba Seguro).
//
// Antes havia 3 caminhos divergentes: motor diário (base BRUTO — BUG),
// cmsMonthly (net) e closingMonthly (share do GRUPO — BUG). Esta lib unifica:
//   - PENETRAÇÃO INDIVIDUAL do promotor = líquido_segurado / líquido_total
//     (base LÍQUIDO, excluindo SRCC; "segurado" pelo FLAG da fonte
//     "PROD. SEGURADA", não por insurance_value>0).
//   - CORTES OFICIAIS (Tabela de Remuneração): < 11% → 10% | 11–20,99% → 25% |
//     21–29,99% → 35% | ≥ 30% → 50%. Ou seja, limiares 0,11 / 0,21 / 0,30.
//
// ATENÇÃO — MIGRATION PENDENTE: a tabela share_scale_tier no banco ainda tem os
// limiares ERRADOS (0,10 / 0,20 / 0,30). Esta lib NÃO lê o banco — usa os cortes
// corretos em código, então o cálculo já sai certo. Mas qualquer consumidor que
// ainda leia share_scale_tier diretamente continuará errado até a migration
// alinhar o banco a 0,11 / 0,21 / 0,30. (Diego roda a migration depois.)
// ============================================================================

// Cortes em ordem DECRESCENTE (primeiro match vence).
export const INSURANCE_SHARE_CUTS: ReadonlyArray<{ min: number; share: number }> = [
  { min: 0.30, share: 0.50 }, // ≥ 30%
  { min: 0.21, share: 0.35 }, // 21–29,99%
  { min: 0.11, share: 0.25 }, // 11–20,99%
  { min: 0.0, share: 0.10 }, // < 11%
];

/** Share de repasse (0..1) para uma penetração decimal (0..1), cortes oficiais. */
export function insuranceShareForPenetration(penetracaoDecimal: number): number {
  const p = Number.isFinite(penetracaoDecimal) ? penetracaoDecimal : 0;
  for (const c of INSURANCE_SHARE_CUTS) {
    if (p >= c.min) return c.share;
  }
  return 0.1;
}

/** Penetração individual (decimal 0..1) = líquido segurado / líquido total. */
export function individualPenetration(liquidoSegurado: number, liquidoTotal: number): number {
  if (!(liquidoTotal > 0)) return 0;
  return liquidoSegurado / liquidoTotal;
}

/** "Segurado" pelo FLAG da fonte ("Sim"). Normaliza acento/espaço/caixa. */
export function isSeguradaFlag(value: unknown): boolean {
  return (
    String(value ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "")
      .trim()
      .toUpperCase() === "SIM"
  );
}
