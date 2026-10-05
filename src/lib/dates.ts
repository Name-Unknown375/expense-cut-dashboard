import {
  startOfMonth,
  endOfMonth,
  subMonths,
  format,
  startOfWeek,
  parseISO,
  differenceInCalendarDays,
  getDaysInMonth,
  isSameMonth,
} from "date-fns";

export function monthKey(d: Date): string {
  return format(d, "yyyy-MM");
}

export function parseMonth(key: string): Date {
  return parseISO(`${key}-01`);
}

export function monthBounds(d: Date) {
  return { start: startOfMonth(d), end: endOfMonth(d) };
}

export function lastCompleteMonths(count: number, from = new Date()): Date[] {
  const months: Date[] = [];
  // Prefer complete months: if today is mid-month, start from previous month
  let cursor = startOfMonth(from);
  if (from.getDate() < getDaysInMonth(from)) {
    cursor = startOfMonth(subMonths(from, 1));
  }
  for (let i = 0; i < count; i++) {
    months.push(startOfMonth(subMonths(cursor, i)));
  }
  return months;
}

export function weekStartKey(d = new Date()): string {
  return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export function daysElapsedInMonth(d = new Date()): number {
  return d.getDate();
}

export function daysInMonth(d = new Date()): number {
  return getDaysInMonth(d);
}

export function projectMonthEnd(spent: number, d = new Date()): number {
  const elapsed = Math.max(1, daysElapsedInMonth(d));
  const total = daysInMonth(d);
  return (spent / elapsed) * total;
}

export function formatMonthLabel(d: Date): string {
  return format(d, "MMMM yyyy");
}

export function isCurrentMonth(d: Date, now = new Date()): boolean {
  return isSameMonth(d, now);
}

export function dayProgress(d = new Date()): number {
  return differenceInCalendarDays(d, startOfMonth(d)) + 1;
}
