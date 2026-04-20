export function calcularComissaoPromotor(
  valorBase: number,
  percentualRepasse: number
) {
  const comissao = valorBase * percentualRepasse;

  const teto = valorBase * 0.058; // 5,8%

  return Math.min(comissao, teto);
}
