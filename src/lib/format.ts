export function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function parseRupiah(input: unknown) {
  if (typeof input === "number") {
    return input;
  }

  const text = String(input ?? "")
    .toLowerCase()
    .replace(/rp/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return 0;
  }

  const multiplier = text.includes("juta")
    ? 1_000_000
    : text.includes("ribu")
      ? 1_000
      : 1;
  const numericText = text
    .replace(/juta|ribu/g, "")
    .replace(/[^\d,.-]/g, "")
    .trim();
  const commaAsThousands = /^\d{1,3}(,\d{3})+$/.test(numericText);
  const normalized = commaAsThousands
    ? numericText.replace(/,/g, "")
    : numericText.replace(/\./g, "").replace(",", ".");
  const number = Number.parseFloat(normalized);

  return Number.isFinite(number) ? Math.round(number * multiplier) : 0;
}

export function normalizeDate(input: unknown, fallback: string) {
  if (!input) {
    return fallback;
  }

  if (input instanceof Date) {
    return input.toISOString().slice(0, 10);
  }

  const value = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return fallback;
}
