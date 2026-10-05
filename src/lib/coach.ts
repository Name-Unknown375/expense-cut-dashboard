import { addDays, differenceInCalendarDays, format } from "date-fns";
import { money } from "./categories";
import { isInternalMovement } from "./autocat";
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

export type PaceResult = {
  showChart: boolean;
  points: PacePoint[];
  note: string;
};

function isRent(t: Row): boolean {
  return /rent/i.test(t.category?.name || "") || /wealth realty/i.test(t.merchant);
}

function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** Cumulative card taps. Rent, transfers, card payments, and large one-offs stay off the line. */
export function buildPace(
  tx: Row[],
  start: Date,
  end: Date,
  target: number
): PaceResult {
  const rentTotal = tx.filter(isRent).reduce((s, t) => s + t.amount, 0);
  const candidates = tx.filter((t) => {
    if (t.category?.bucket === "Transfer") return false;
    if (isRent(t)) return false;
    if (isInternalMovement(t.merchant)) return false;
    if (/to card|to account/i.test(t.merchant)) return false;
    return true;
  });
  const byMerchant = new Map<string, { name: string; amount: number; count: number }>();
  for (const t of candidates) {
    const key = merchantKey(t.merchant);
    const row = byMerchant.get(key) ?? { name: shortMerchant(t.merchant), amount: 0, count: 0 };
    row.amount += t.amount;
    row.count += 1;
    byMerchant.set(key, row);
  }
  const oneOffKeys = new Set(
    Array.from(byMerchant.entries())
      .filter(([, g]) => g.count === 1 && g.amount >= 200)
      .map(([key]) => key)
  );
  const kept = candidates.filter((t) => !oneOffKeys.has(merchantKey(t.merchant)));
  const leftOff = [
    ...(rentTotal > 0 ? [`rent (${money(rentTotal)})`] : []),
    ...Array.from(byMerchant.values())
      .filter((g) => g.count === 1 && g.amount >= 200)
      .sort((a, b) => b.amount - a.amount)
      .map((g) => `${g.name} (${money(g.amount)})`),
  ];
  const leftSentence =
    leftOff.length > 0 ? ` Left off this line: ${listJoin(leftOff)}.` : "";

  if (kept.length === 0) {
    return {
      showChart: false,
      points: [],
      note: `No card taps left once rent, transfers, card payments, and one-offs are out.${leftSentence}`,
    };
  }

  const biggest = kept.reduce((m, t) => (t.amount > m.amount ? t : m), kept[0]);
  const total = kept.reduce((s, t) => s + t.amount, 0);
  const distinctDays = new Set(kept.map((t) => format(t.date, "yyyy-MM-dd"))).size;
  if (biggest.amount >= 80 && biggest.amount / total >= 0.4) {
    return {
      showChart: false,
      points: [],
      note: `${shortMerchant(biggest.merchant)} on ${format(biggest.date, "MMM d")} is ${money(biggest.amount)}. That one charge is most of what is left after rent, transfers, card payments, and one-offs, so there is no daily pace to draw.${leftSentence}`,
    };
  }
  if (distinctDays < 4) {
    return {
      showChart: false,
      points: [],
      note: `Card taps land on ${distinctDays} day${distinctDays === 1 ? "" : "s"} in this period. A line would not show a pace.${leftSentence}`,
    };
  }

  const days = Math.max(1, differenceInCalendarDays(end, start) + 1);
  const step = days > 62 ? Math.ceil(days / 40) : 1;
  const points: PacePoint[] = [];
  let variable = 0;
  for (let i = 0; i < days; i += step) {
    const day = addDays(start, i);
    const next = addDays(start, Math.min(days, i + step));
    for (const t of kept) {
      if (t.date >= day && t.date < next) variable += t.amount;
    }
    const elapsed = Math.min(days, i + step);
    points.push({
      label: format(day, days > 62 ? "MMM d" : "d"),
      variable: Math.round(variable),
      total: Math.round(variable),
      ideal: Math.round((target * elapsed) / days),
    });
  }
  return {
    showChart: points.length > 1,
    points,
    note: `Solid line is card taps. Dotted line is the 50% target (${money(target)}). Rent, transfers, card payments, and large one-offs are out.${leftSentence}`,
  };
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
