export type Bucket = "Needs" | "Wants" | "Fixed" | "Transfer";

export const DEFAULT_CATEGORIES: {
  name: string;
  bucket: Bucket;
  color: string;
  sortOrder: number;
}[] = [
  { name: "Rent", bucket: "Fixed", color: "#0f766e", sortOrder: 1 },
  { name: "Utilities", bucket: "Fixed", color: "#0891b2", sortOrder: 2 },
  { name: "Subscriptions", bucket: "Fixed", color: "#6366f1", sortOrder: 3 },
  { name: "Groceries", bucket: "Needs", color: "#16a34a", sortOrder: 4 },
  { name: "Transport", bucket: "Needs", color: "#2563eb", sortOrder: 5 },
  { name: "Health", bucket: "Needs", color: "#059669", sortOrder: 6 },
  { name: "Dining", bucket: "Wants", color: "#ea580c", sortOrder: 7 },
  { name: "Shopping", bucket: "Wants", color: "#db2777", sortOrder: 8 },
  { name: "Entertainment", bucket: "Wants", color: "#9333ea", sortOrder: 9 },
  { name: "Travel", bucket: "Wants", color: "#d97706", sortOrder: 10 },
  { name: "Other", bucket: "Needs", color: "#64748b", sortOrder: 11 },
  { name: "Transfers", bucket: "Transfer", color: "#94a3b8", sortOrder: 12 },
];

export function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function moneyExact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}
