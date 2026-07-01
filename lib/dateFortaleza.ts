// "Hoje" no fuso America/Fortaleza (sede do grupo, AL) — fonte ÚNICA para o
// roteamento de competência e o refDate da Projeção/Dashboard. Sem isto o
// cálculo usa UTC e, às 21h BRT (00h+ UTC), o dia/mês já vira o seguinte,
// deslocando a competência e a contagem de dias úteis. Intl resolve o fuso.

export function nowInFortaleza(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: num("year"), month: num("month"), day: num("day") };
}

// Data (UTC-midnight) do dia corrente em America/Fortaleza — para usar como
// refDate nos cálculos que já normalizam via Date.UTC(y, m-1, d).
export function todayInFortaleza(): Date {
  const { year, month, day } = nowInFortaleza();
  return new Date(Date.UTC(year, month - 1, day));
}
