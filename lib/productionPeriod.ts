export type ProductionPeriod = {
  year: number;
  month: number;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDate(date: Date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate()
  )}`;
}

function toDateOnly(value: unknown) {
  if (!value) return null;

  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match) {
    return new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    );
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
  );
}

function addMonths(period: ProductionPeriod, monthsToAdd: number) {
  const date = new Date(Date.UTC(period.year, period.month - 1 + monthsToAdd, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function isBusinessDay(date: Date) {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function getLastBusinessDay(year: number, month: number) {
  const date = new Date(Date.UTC(year, month, 0));

  while (!isBusinessDay(date)) {
    date.setUTCDate(date.getUTCDate() - 1);
  }

  return date;
}

export function getProductionWindow(year: number, month: number) {
  const previousMonth = addMonths({ year, month }, -1);
  const start = getLastBusinessDay(previousMonth.year, previousMonth.month);
  const end = getLastBusinessDay(year, month);

  return {
    start: formatDate(start),
    endExclusive: formatDate(end),
  };
}

export function getProductionPeriodFromValue(value: unknown) {
  const date = toDateOnly(value);
  if (!date) return null;

  const current = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
  const next = addMonths(current, 1);
  const dateKey = formatDate(date);

  for (const candidate of [next, current]) {
    const window = getProductionWindow(candidate.year, candidate.month);

    if (dateKey >= window.start && dateKey < window.endExclusive) {
      return candidate;
    }
  }

  return current;
}

export function getProductionPeriodKey(year: number, month: number) {
  return `${year}-${pad2(month)}`;
}
