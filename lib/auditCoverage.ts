// Cobertura temporal do motor de auditoria histórica.
//
// Atualmente o motor está validado para o intervalo dez/2022 → mar/2026
// (regimes Volume/Safira + META). Em abr/2026 entrou em vigor a FAIXA 5
// da Promotiva, que ainda não está modelada — meses a partir daí ficam
// bloqueados na UI até a extensão do motor.

export function isHistoricalMonthSupported(
  year: number,
  month: number
): boolean {
  if (year < 2022) return false;
  if (year === 2022 && month < 12) return false;
  if (year > 2026) return false;
  if (year === 2026 && month >= 4) return false;
  return true;
}
