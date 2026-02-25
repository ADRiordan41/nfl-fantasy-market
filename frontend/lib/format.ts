const numberFormatCache = new Map<string, Intl.NumberFormat>();
const currencyFormatCache = new Map<string, Intl.NumberFormat>();

function numberFormatter(minimumFractionDigits: number, maximumFractionDigits: number): Intl.NumberFormat {
  const key = `${minimumFractionDigits}:${maximumFractionDigits}`;
  const cached = numberFormatCache.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits,
    maximumFractionDigits,
  });
  numberFormatCache.set(key, formatter);
  return formatter;
}

function currencyFormatter(minimumFractionDigits: number, maximumFractionDigits: number): Intl.NumberFormat {
  const key = `${minimumFractionDigits}:${maximumFractionDigits}`;
  const cached = currencyFormatCache.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
  });
  currencyFormatCache.set(key, formatter);
  return formatter;
}

export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "--";
  return numberFormatter(digits, digits).format(value);
}

export function formatCurrency(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "--";
  return currencyFormatter(digits, digits).format(value);
}

export function formatSignedCurrency(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "--";
  const abs = formatCurrency(Math.abs(value), digits);
  return `${value >= 0 ? "+" : "-"}${abs}`;
}

export function formatSignedNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : "-"}${formatNumber(Math.abs(value), digits)}`;
}

export function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "--";
  return `${formatNumber(value, digits)}%`;
}

export function formatSignedPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : "-"}${formatNumber(Math.abs(value), digits)}%`;
}
