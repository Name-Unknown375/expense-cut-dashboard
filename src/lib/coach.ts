import { addDays, differenceInCalendarDays, format } from "date-fns";
import { merchantKey, shortMerchant } from "./insights";

type Row = {
  date: Date;
  amount: number;
  merchant: string;
  category: { name: string; bucket: string } | null;
};

export type PacePoint = {
  label: string;
  variable: number;
  total: number;
  ideal: number;
};

export function buildPace(
  tx: Row[],
  start: Date,
  end: Date,
  target: number
): PacePoint[] {
  const days = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const step = days > 62 ? Math.ceil(days / 40) : 1;
  const points: PacePoint[] = [];
  let variable = 0;
  let fixed = 0;
  for (let i = 0; i < days; i += step) {
    const day = addDays(start, i);
    const next = addDays(start, Math.min(days, i + step));
    for (const t of tx) {
      if (t.date >= day && t.date < next) {
        if (t.category?.bucket === "Fixed") fixed += t.amount;
        else variable += t.amount;
      }
    }
    const elapsed = Math.min(days, i + step);
    points.push({
      label: format(day, days > 62 ? "MMM d" : "d"),
      variable: Math.round(variable),
      total: Math.round(variable + fixed),
      ideal: Math.round((target * elapsed) / days),
    });
  }
  return points;
}

export function pastYouLine(
  spent: number,
  baselineMonthly: number,
  start: Date,
  end: Date,
  now: Date
): string | null {
  const dayCount = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const asOf = now < start ? start : now > end ? end : now;
  const elapsed = Math.max(1, differenceInCalendarDays(asOf, start) + 1);
  if (elapsed < 3 || baselineMonthly <= 0) return null;
  const monthFactor = dayCount / 30.44;
  const usualPace = baselineMonthly * monthFactor * (elapsed / dayCount);
  const delta = spent - usualPace;
  if (Math.abs(delta) < 40) return null;
  if (delta > 0) {
    return `$${Math.round(delta)} above your usual pace for this point in the period.`;
  }
  return `$${Math.round(-delta)} under your usual pace for this point in the period.`;
}

export type SubLine = {
  merchant: string;
  count: number;
  lastAmount: number;
  prevAmount: number | null;
  jump: number | null;
  nextDate: string;
  duplicate: boolean;
};

export function buildSubscriptions(allTx: Row[], now: Date): SubLine[] {
  const map = new Map<string, { merchant: string; amounts: number[]; dates: Date[] }>();
  for (const t of allTx) {
    if (t.category?.bucket === "Transfer") continue;
    const key = merchantKey(t.merchant);
    const row = map.get(key) ?? { merchant: shortMerchant(t.merchant), amounts: [], dates: [] };
    row.amounts.push(t.amount);
    row.dates.push(t.date);
    map.set(key, row);
  }
  const subs: SubLine[] = [];
  for (const row of Array.from(map.values())) {
    if (row.dates.length < 3) continue;
    const dates = [...row.dates].sort((a, b) => a.getTime() - b.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(differenceInCalendarDays(dates[i], dates[i - 1]));
    }
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    if (median < 20 || median > 40) continue;
    const pairs = row.dates
      .map((date: Date, i: number) => ({ date, amount: row.amounts[i] }))
      .sort((a: { date: Date }, b: { date: Date }) => a.date.getTime() - b.date.getTime());
    const last = pairs[pairs.length - 1];
    const prev = pairs.length >= 2 ? pairs[pairs.length - 2] : null;
    const lastAmount = last.amount;
    const prevAmount = prev ? prev.amount : null;
    const jump = prevAmount != null && lastAmount - prevAmount >= 1 ? lastAmount - prevAmount : null;
    const next = addDays(last.date, median);
    subs.push({
      merchant: row.merchant,
      count: row.dates.length,
      lastAmount,
      prevAmount,
      jump,
      nextDate: format(next < now ? addDays(now, Math.min(median, 14)) : next, "MMM d"),
      duplicate: false,
    });
  }
  const byAmount = new Map<number, string[]>();
  for (const s of subs) {
    const bucket = Math.round(s.lastAmount);
    const list = byAmount.get(bucket) ?? [];
    list.push(s.merchant);
    byAmount.set(bucket, list);
  }
  for (const s of subs) {
    const twins = byAmount.get(Math.round(s.lastAmount)) ?? [];
    s.duplicate = twins.length > 1;
  }
  return subs.sort((a, b) => b.lastAmount - a.lastAmount).slice(0, 12);
}

export function capDayLabel(
  name: string,
  spent: number,
  cap: number,
  start: Date,
  end: Date,
  now: Date
): string | null {
  if (cap <= 0) return null;
  const dayCount = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const asOf = now < start ? start : now > end ? end : now;
  const elapsed = Math.max(1, differenceInCalendarDays(asOf, start) + 1);
  if (spent >= cap) return `${name} is already over $${Math.round(cap)}.`;
  const daily = spent / elapsed;
  if (daily <= 0) return `${name} has no spend yet — cap $${Math.round(cap)} holds.`;
  const daysNeeded = cap / daily;
  if (daysNeeded > dayCount) return `${name} stays under $${Math.round(cap)} at this pace.`;
  const hit = addDays(start, Math.max(0, Math.floor(daysNeeded) - 1));
  return `At this pace, ${name} hits $${Math.round(cap)} on ${format(hit, "MMM d")}.`;
}
