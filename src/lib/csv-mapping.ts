import { merchantKey } from "./insights";

/** Shared CSV mapping helpers for CIBC-style bank exports. */

export type AmountStyle = "signed" | "debit_credit";

export function toColKey(i: number) {
  return `col_${i}`;
}

export function colIndex(key: string | undefined): number {
  if (!key) return -1;
  const m = /^col_(\d+)$/.exec(key);
  return m ? parseInt(m[1], 10) : -1;
}

export function looksHeaderless(headers: string[]): boolean {
  if (!headers.length) return true;
  let dataLike = 0;
  for (const h of headers) {
    const t = h.trim();
    if (!t) {
      dataLike += 1;
      continue;
    }
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(t)) dataLike += 1;
    else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(t)) dataLike += 1;
    else if (/^\$?-?\d+(\.\d+)?$/.test(t.replace(/,/g, ""))) dataLike += 1;
    else if (t.length > 40) dataLike += 1;
    else if (/transfer|debit|credit|purchase|visa|mastercard|pos /i.test(t))
      dataLike += 1;
  }
  return dataLike >= Math.ceil(headers.length / 2);
}

function parseMoney(raw: string | undefined): number | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Detect separate debit/credit columns from sample values.
 * Classic CIBC: Date, Description, Debit, Credit, [Card#|Balance]
 * — only one of debit/credit is filled per row.
 */
export function inferDebitCreditFromSamples(
  sampleRows: string[][],
  colCount: number
): { amountStyle: AmountStyle; debit?: string; credit?: string; amount?: string } | null {
  if (colCount < 4) return null;

  // Prefer cols 2/3 (0-indexed) as debit/credit for 4+ column bank files
  const debitIdx = 2;
  const creditIdx = 3;
  let either = 0;
  let both = 0;
  let debitOnly = 0;
  let creditOnly = 0;

  for (const row of sampleRows) {
    const d = parseMoney(row[debitIdx]);
    const c = parseMoney(row[creditIdx]);
    const hasD = d != null && d !== 0;
    const hasC = c != null && c !== 0;
    if (!hasD && !hasC) continue;
    either += 1;
    if (hasD && hasC) both += 1;
    else if (hasD) debitOnly += 1;
    else creditOnly += 1;
  }

  // Mutual exclusivity strongly indicates debit/credit (not amount+balance)
  if (either >= 2 && both === 0 && (debitOnly >= 1 || creditOnly >= 1)) {
    return {
      amountStyle: "debit_credit",
      debit: toColKey(debitIdx),
      credit: toColKey(creditIdx),
    };
  }

  // Amount + balance: col3 often larger running balance, both filled
  if (either >= 2 && both >= either - 1) {
    return {
      amountStyle: "signed",
      amount: toColKey(debitIdx),
    };
  }

  return null;
}

/** Normalize merchant for dedupe — collapse whitespace, strip card noise. */
export function normalizeMerchant(merchant: string): string {
  return merchant
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\*+/g, "*")
    // trailing city/province noise kept — same string must match on re-import
    ;
}

/** Strong dedupe key: calendar date + amount + canonical merchant (Costco, SQ *, store #). */
export function dedupeKey(date: Date, amount: number, merchant: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}|${amount.toFixed(2)}|${merchantKey(merchant)}`;
}

/** Parse common bank date strings into a Date (local calendar day). */
export function parseBankDate(raw: string): Date | null {
  const t = raw.trim();
  if (!t) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(t);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // MM/DD/YYYY or DD/MM/YYYY — prefer ISO-ambiguous as MM/DD for NA banks
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    // If first > 12, treat as DD/MM
    const month = a > 12 ? b : a;
    const day = a > 12 ? a : b;
    const d = new Date(y, month - 1, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}
