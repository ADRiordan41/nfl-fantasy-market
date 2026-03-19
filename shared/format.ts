const formatCompactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const formatMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const formatPercentBase = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});

export function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000) {
    return formatCompactNumber.format(value);
  }
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatCurrency(value: number): string {
  return formatMoney.format(value);
}

export function formatPercent(value: number): string {
  return formatPercentBase.format(value / 100);
}

export function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPercent(value)}`;
}

export function formatSignedCurrency(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatCurrency(value)}`;
}
