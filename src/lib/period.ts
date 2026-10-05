import {
  startOfMonth,
  startOfYear,
  endOfYear,
  parseISO,
  format,
  differenceInCalendarDays,
  subMonths,
  isWithinInterval,
} from "date-fns";
import { monthBounds, monthKey, parseMonth, formatMonthLabel } from "./dates";

export type PeriodMode = "month" | "range" | "year";

export type PeriodSpec = {
  mode?: PeriodMode;
  /** yyyy-MM when mode=month */
  month?: string;
  /** yyyy when mode=year */
  year?: string;
  /** yyyy-MM-dd when mode=range */
  from?: string;
  /** yyyy-MM-dd when mode=range */
  to?: string;
};

export type ResolvedPeriod = {
  mode: PeriodMode;
  start: Date;
  end: Date;
  label: string;
  /** for URL / sticky state */
  query: Record<string, string>;
  /** comparable prior window of same length, ending day before start */
  prevStart: Date;
  prevEnd: Date;
  /** days in period (inclusive) */
  dayCount: number;
  isCurrentMonth: boolean;
};

export function resolvePeriod(spec: PeriodSpec = {}, now = new Date()): ResolvedPeriod {
  const mode = spec.mode || (spec.from && spec.to ? "range" : spec.year ? "year" : "month");

  if (mode === "year") {
    const parsedYear = Number(spec.year);
    const y =
      Number.isFinite(parsedYear) && parsedYear >= 1990 && parsedYear <= 2200
        ? parsedYear
        : Number(format(now, "yyyy"));
    const start = startOfYear(new Date(y, 0, 1));
    const end = endOfYear(new Date(y, 0, 1));
    const prevStart = startOfYear(new Date(y - 1, 0, 1));
    const prevEnd = endOfYear(new Date(y - 1, 0, 1));
    return {
      mode: "year",
      start,
      end,
      label: String(y),
      query: { period: "year", year: String(y) },
      prevStart,
      prevEnd,
      dayCount: differenceInCalendarDays(end, start) + 1,
      isCurrentMonth: false,
    };
  }

  const rangeStart = validDay(spec.from);
  const rangeEnd = validDay(spec.to);
  if (mode === "range" && rangeStart && rangeEnd) {
    let start = rangeStart;
    let end = rangeEnd;
    if (end < start) [start, end] = [end, start];
    // inclusive end of day
    end = new Date(end);
    end.setHours(23, 59, 59, 999);
    start = new Date(start);
    start.setHours(0, 0, 0, 0);
    const dayCount = differenceInCalendarDays(end, start) + 1;
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    prevEnd.setHours(23, 59, 59, 999);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (dayCount - 1));
    prevStart.setHours(0, 0, 0, 0);
    return {
      mode: "range",
      start,
      end,
      label: `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`,
      query: {
        period: "range",
        from: format(start, "yyyy-MM-dd"),
        to: format(end, "yyyy-MM-dd"),
      },
      prevStart,
      prevEnd,
      dayCount,
      isCurrentMonth: false,
    };
  }

  // month (default)
  const focus = spec.month ? parseMonth(spec.month) : startOfMonth(now);
  const { start, end } = monthBounds(focus);
  const prev = monthBounds(subMonths(focus, 1));
  const isCurrent =
    focus.getFullYear() === now.getFullYear() && focus.getMonth() === now.getMonth();
  return {
    mode: "month",
    start,
    end,
    label: formatMonthLabel(focus),
    query: { period: "month", month: monthKey(focus) },
    prevStart: prev.start,
    prevEnd: prev.end,
    dayCount: differenceInCalendarDays(end, start) + 1,
    isCurrentMonth: isCurrent,
  };
}

function validDay(iso?: string): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function periodFromSearchParams(sp: {
  period?: string;
  month?: string;
  year?: string;
  from?: string;
  to?: string;
}): PeriodSpec {
  const period = (sp.period as PeriodMode | undefined) || undefined;
  if (period === "year" || (!period && sp.year && !sp.month)) {
    return { mode: "year", year: sp.year };
  }
  if (period === "range" || (sp.from && sp.to)) {
    return { mode: "range", from: sp.from, to: sp.to };
  }
  return { mode: "month", month: sp.month };
}

export function buildPeriodQuery(query: Record<string, string>): string {
  const params = new URLSearchParams(query);
  return params.toString();
}

export function inPeriod(date: Date, start: Date, end: Date): boolean {
  return isWithinInterval(date, { start, end });
}
