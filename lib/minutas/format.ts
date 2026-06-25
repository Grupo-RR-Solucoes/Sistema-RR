// Helpers de formatação para minutas (pt-BR). Standalone, sem dependência de
// componente cliente — pode rodar em rota Node serverless.

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Valor monetário em R$ (pt-BR). null/NaN → R$ 0,00. */
export function brl(v: number | null | undefined): string {
  return BRL.format(Number.isFinite(Number(v)) ? Number(v) : 0);
}

/** Dígitos de CNPJ → "XX.XXX.XXX/XXXX-XX". Inválido/null → "—". */
export function formatCnpj(cnpj: string | null | undefined): string {
  const d = String(cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14) return d || "—";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Fração decimal (0.1234) → "12,34%". null → "—". */
export function pct(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(Number(fraction))) return "—";
  return `${(Number(fraction) * 100).toFixed(2).replace(".", ",")}%`;
}

/** Taxa de juros (já em unidade percentual, ex. 1.65) → "1,65%". */
export function pctUnidade(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(2).replace(".", ",")}%`;
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** ISO "YYYY-MM" → "abril/2026". */
export function competenciaLabel(ym: string): string {
  const [y, m] = ym.split("-").map((x) => Number.parseInt(x, 10));
  if (!y || !m || m < 1 || m > 12) return ym;
  return `${MESES[m - 1]}/${y}`;
}

/** ISO "YYYY-MM" → "MM/AAAA" (numérico, p/ Ref.). */
export function competenciaNumerica(ym: string): string {
  const [y, m] = ym.split("-");
  return `${String(m).padStart(2, "0")}/${y}`;
}

/**
 * Data por extenso a partir de uma Date já construída pelo caller.
 * Ex.: new Date("2026-06-25") → "25 de junho de 2026".
 * O caller passa a Date (não usamos Date.now() aqui — facilita teste e SSR).
 */
export function dataPorExtenso(d: Date, cidade?: string): string {
  const dia = d.getUTCDate();
  const mes = MESES[d.getUTCMonth()];
  const ano = d.getUTCFullYear();
  const corpo = `${dia} de ${mes} de ${ano}`;
  return cidade ? `${cidade}, ${corpo}` : corpo;
}
