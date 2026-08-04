export function formatRON(value: number): string {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** "azi", "ieri", "acum 3 zile" */
export function relativeDays(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 3600 * 1000));
  if (days <= 0) return "azi";
  if (days === 1) return "ieri";
  return `acum ${days} zile`;
}

export function parseSpecs(json: string | null): [string, string][] {
  if (!json) return [];
  try {
    return Object.entries(JSON.parse(json) as Record<string, string>);
  } catch {
    return [];
  }
}

export const AVAILABILITY_LABELS: Record<string, string> = {
  "in stock": "În stoc",
  "out of stock": "Stoc epuizat",
  preorder: "Precomandă",
};

export function unitLabel(unit: string): string {
  if (unit === "l") return "L";
  if (unit === "kg") return "kg";
  return "buc";
}

/** "6,99 lei/L" — price per base unit. */
export function formatPerUnit(value: number, unit: string): string {
  const n = new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return `${n} lei/${unitLabel(unit)}`;
}
