// Cobertura temporal do motor de auditoria histórica.
//
// Validado para dez/2022 → mai/2026. O regime VOLUME_5_FAIXAS (FAIXA 1-5) de
// abr/2026+ foi modelado: TRP35 (2026/187, abr) e TRP36 (2026/194, mai — idêntica
// a abr, ver TRP_DIFF_2026.md) estão em MAPA_MES_REGRA e o enquadramento Faixa 1-5
// em regrasLoader (TIERS_VOLUME_5). 2027+ fica fora até as TRPs serem extraídas.

export function isHistoricalMonthSupported(
  year: number,
  month: number
): boolean {
  if (year < 2022) return false;
  if (year === 2022 && month < 12) return false;
  if (year > 2026) return false;
  return true;
}
