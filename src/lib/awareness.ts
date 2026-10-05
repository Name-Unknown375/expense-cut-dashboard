import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { money } from "./categories";
import {
  gymDisplay,
  isGym,
  isOnlineCluster,
  isTinyTap,
  merchantKey,
  shortMerchant,
  type CapRow,
} from "./insights";

type Tx = {
  date: Date;
  amount: number;
  merchant: string;
  category: { name: string; bucket: string } | null;
};

export type IfThenRule = {
  id: string;
  text: string;
  places: string[];
  weekdaysOnly: boolean;
  capLabel: string;
  seeded?: boolean;
};

export type CutMark = {
  id: string;
  merchantKey: string;
  label: string;
  off: boolean;
};

export type SundayCheck = {
  weekLabel: string;
  cardDays: number;
  noTapDays: number;
  capsLine: string;
  ruleLine: string;
  cutLine: string;
};

export type Awareness = {
  heroLead: string;
  habits: string[];
  overLines: string[];
  ruleLine: string;
  ruleNote: string | null;
  sunday: SundayCheck;
};

export const EXAMPLE_IF_THEN: IfThenRule = {
  id: "example-weekday-treats",
  text: "If it is a weekday and the place is Uber Eats or ice cream, the answer is no",
  places: ["uber eats", "ice cream", "earnest"],
  weekdaysOnly: true,
  capLabel: "Eating out",
  seeded: true,
};

function sum(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0);
}

function monthKey(d: Date) {
  return format(d, "yyyy-MM");
}

function isWeekday(d: Date) {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

function placeHit(merchant: string, place: string) {
  const needle = place.toLowerCase().trim();
  if (!needle) return false;
  const key = merchantKey(merchant);
  const label = shortMerchant(merchant).toLowerCase();
  return key.includes(needle) || label.includes(needle) || merchant.toLowerCase().includes(needle);
}

export function ruleMisses(rule: IfThenRule, tx: Tx[]) {
  return tx.filter((t) => {
    if (rule.weekdaysOnly && !isWeekday(t.date)) return false;
    return rule.places.some((place) => placeHit(t.merchant, place));
  });
}

function ruleSentence(rule: IfThenRule, tx: Tx[], scope: string) {
  const misses = ruleMisses(rule, tx).sort((a, b) => a.date.getTime() - b.date.getTime());
  if (misses.length === 0) return `The if-then held ${scope}.`;
  const first = misses[0];
  const extra = misses.length > 1 ? ` ${misses.length} taps broke it.` : "";
  return `The if-then did not hold ${scope}: ${shortMerchant(first.merchant)} on ${format(first.date, "MMM d")}.${extra}`;
}

function txsForGroup(tx: Tx[], match: (t: Tx) => boolean) {
  const first = new Map<string, Tx>();
  for (const t of tx) {
    const key = shortMerchant(t.merchant);
    if (!first.has(key)) first.set(key, t);
  }
  const keys = new Set(
    Array.from(first.entries())
      .filter(([, t]) => match(t))
      .map(([key]) => key)
  );
  return tx.filter((t) => keys.has(shortMerchant(t.merchant)));
}

function eating(tx: Tx[]) {
  return txsForGroup(tx, (t) => t.category?.name === "Dining");
}
function costco(tx: Tx[]) {
  return tx.filter((t) => shortMerchant(t.merchant) === "Costco");
}
function gyms(tx: Tx[]) {
  return tx.filter((t) => isGym(shortMerchant(t.merchant)));
}
function tiny(tx: Tx[]) {
  return tx.filter((t) => isTinyTap(shortMerchant(t.merchant)));
}
function online(tx: Tx[]) {
  return tx.filter((t) => isOnlineCluster(shortMerchant(t.merchant)));
}

function usualFor(allTx: Tx[], periodStart: Date, pick: (tx: Tx[]) => Tx[]) {
  const totals: number[] = [];
  for (let i = 1; i <= 18 && totals.length < 3; i++) {
    const month = startOfMonth(subMonths(periodStart, i));
    const key = monthKey(month);
    const inMonth = allTx.filter((t) => monthKey(t.date) === key);
    if (inMonth.length === 0) continue;
    totals.push(sum(pick(inMonth).map((t) => t.amount)));
  }
  if (totals.length === 0) return null;
  return sum(totals) / totals.length;
}

function crossedOn(tx: Tx[], cap: number) {
  const ordered = [...tx].sort((a, b) => a.date.getTime() - b.date.getTime() || b.amount - a.amount);
  let run = 0;
  for (const t of ordered) {
    run += t.amount;
    if (run >= cap) return t.date;
  }
  return null;
}

function nextCharge(tx: Tx[], now: Date) {
  const ordered = [...tx].sort((a, b) => a.date.getTime() - b.date.getTime());
  if (ordered.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    gaps.push(differenceInCalendarDays(ordered[i].date, ordered[i - 1].date));
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const median = sortedGaps[Math.floor(sortedGaps.length / 2)];
  const lastGap = gaps[gaps.length - 1];
  const gap = median >= 20 && median <= 40 ? median : lastGap >= 20 && lastGap <= 40 ? lastGap : null;
  if (gap == null) return null;
  const last = ordered[ordered.length - 1];
  const prev = ordered[ordered.length - 2];
  const next = addDays(last.date, gap);
  const shown = next.getTime() < now.getTime() ? addDays(now, Math.min(gap, 14)) : next;
  const jump = last.amount - prev.amount >= 1 ? last.amount - prev.amount : null;
  return { next: shown, jump, lastAmount: last.amount };
}

function flexiblePick(id: string) {
  if (id === "eating") return eating;
  if (id === "costco") return costco;
  if (id === "gym") return gyms;
  return null;
}

function reviewWindow(start: Date, end: Date, now: Date) {
  const open = now.getTime() >= start.getTime() && now.getTime() <= end.getTime();
  if (open) {
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = now.getTime() < end.getTime() ? now : end;
    const from = weekStart.getTime() < start.getTime() ? start : weekStart;
    return { from, to: weekEnd };
  }
  let cursor = startOfWeek(end, { weekStartsOn: 1 });
  for (let i = 0; i < 6; i++) {
    const weekEnd = endOfWeek(cursor, { weekStartsOn: 1 });
    if (weekEnd.getTime() <= end.getTime() && cursor.getTime() >= start.getTime()) {
      return { from: cursor, to: weekEnd };
    }
    cursor = addDays(cursor, -7);
  }
  return { from: start, to: end };
}

function inWindow(t: Tx, from: Date, to: Date) {
  const time = t.date.getTime();
  return time >= from.getTime() && time <= to.getTime();
}

export function buildAwareness(input: {
  periodStart: Date;
  periodEnd: Date;
  now: Date;
  periodSpend: Tx[];
  allSpend: Tx[];
  caps: CapRow[];
  rules: IfThenRule[];
  cuts: CutMark[];
}): Awareness {
  const { periodStart, periodEnd, now, periodSpend, allSpend, caps, rules, cuts } = input;
  const capById = new Map(caps.map((c) => [c.id, c]));

  const habits: string[] = [];
  const overLines: string[] = [];
  const breaches: Array<{ label: string; when: Date; cap: number }> = [];

  const eatingCap = capById.get("eating");
  const eatingNow = eating(periodSpend);
  const eatingUsual = usualFor(allSpend, periodStart, eating);
  if (eatingNow.length > 0 && eatingCap) {
    const usualBit = eatingUsual != null ? ` Your usual is ${money(eatingUsual)}.` : "";
    habits.push(
      `Eating out is ${money(eatingCap.actual)}.${usualBit} The cap you are testing is ${money(eatingCap.cap)}.`
    );
    const when = crossedOn(eatingNow, eatingCap.cap);
    if (when) breaches.push({ label: "Eating out", when, cap: eatingCap.cap });
    if (eatingCap.actual > eatingCap.cap) {
      overLines.push(
        `Eating out is over ${money(eatingCap.cap)}. The cap still covers the days left: ${money(0)} a day.`
      );
    }
  }

  const costcoCap = capById.get("costco");
  const costcoNow = costco(periodSpend);
  const costcoUsual = usualFor(allSpend, periodStart, costco);
  if (costcoNow.length > 0 && costcoCap) {
    const usualBit = costcoUsual != null ? ` Your usual is ${money(costcoUsual)}.` : "";
    habits.push(
      `Costco is ${money(costcoCap.actual)}.${usualBit} The cap you are testing is ${money(costcoCap.cap)}.`
    );
    const when = crossedOn(costcoNow, costcoCap.cap);
    if (when) breaches.push({ label: "Costco", when, cap: costcoCap.cap });
    if (costcoCap.actual > costcoCap.cap) {
      overLines.push(
        `Costco is over ${money(costcoCap.cap)}. The cap still covers the days left: ${money(0)} a day.`
      );
    }
  }

  const gymNow = gyms(periodSpend);
  const gymCap = capById.get("gym");
  const gymUsual = usualFor(allSpend, periodStart, gyms);
  if (gymNow.length > 0) {
    const byName = new Map<string, { name: string; amount: number; raw: Tx[] }>();
    for (const t of gymNow) {
      const name = gymDisplay(shortMerchant(t.merchant));
      const row = byName.get(name) ?? { name, amount: 0, raw: [] };
      row.amount += t.amount;
      row.raw.push(t);
      byName.set(name, row);
    }
    const members = Array.from(byName.values()).sort((a, b) => b.amount - a.amount);
    const dated = members
      .map((m) => ({
        ...m,
        next: nextCharge(
          allSpend.filter((t) => gymDisplay(shortMerchant(t.merchant)) === m.name),
          now
        ),
      }))
      .sort((a, b) => {
        if (a.next && !b.next) return -1;
        if (!a.next && b.next) return 1;
        return b.amount - a.amount;
      });
    const primary = dated[0];
    const others = members.filter((m) => m.name !== primary.name).map((m) => m.name);
    const usualBit = gymUsual != null ? ` Your usual for gyms is ${money(gymUsual)}.` : "";
    if (primary.next && others.length > 0) {
      const jump =
        primary.next.jump != null ? `, up ${money(primary.next.jump)} from the charge before,` : "";
      const otherBit =
        others.length === 1 ? `${others[0]} is the other gym.` : `${others.join(" and ")} are the other gyms.`;
      habits.push(
        `${primary.name} is ${money(primary.amount)}${jump} and charges again on ${format(primary.next.next, "MMM d")}. ${otherBit}${usualBit} Pick one before that date.`
      );
    } else if (primary.next) {
      habits.push(
        `${primary.name} is ${money(primary.amount)} and charges again on ${format(primary.next.next, "MMM d")}.${usualBit}`
      );
    } else if (gymCap) {
      habits.push(
        `Gyms are ${money(sum(gymNow.map((t) => t.amount)))}.${usualBit} The cap you are testing is ${money(gymCap.cap)}.`
      );
    }
    if (gymCap) {
      const when = crossedOn(gymNow, gymCap.cap);
      if (when) breaches.push({ label: "Gym", when, cap: gymCap.cap });
      if (gymCap.actual > gymCap.cap) {
        overLines.push(`Gym is over ${money(gymCap.cap)}. The cap still covers the days left: ${money(0)} a day.`);
      }
    }
  }

  for (const [label, pick] of [
    ["Food court and vending", tiny],
    ["Online shopping", online],
  ] as const) {
    const nowTx = pick(periodSpend);
    if (nowTx.length === 0) continue;
    const usual = usualFor(allSpend, periodStart, pick);
    const usualBit = usual != null ? ` Your usual is ${money(usual)}.` : "";
    habits.push(`${label} is ${money(sum(nowTx.map((t) => t.amount)))}.${usualBit}`);
  }

  const activeRules = rules.filter((r) => r.text.trim().length > 0);
  let ruleLine: string;
  let ruleNote: string | null = null;
  if (activeRules.length === 0) {
    ruleLine = "Write the rule you already use.";
  } else {
    ruleLine = activeRules.map((rule) => ruleSentence(rule, periodSpend, "in this period")).join(" ");
    if (activeRules.some((rule) => rule.seeded)) {
      ruleNote = "This example was saved because no if-then was written yet. Change it to the rule you already use.";
    }
  }

  breaches.sort((a, b) => a.when.getTime() - b.when.getTime());
  let heroLead: string;
  if (breaches.length > 0) {
    const first = breaches[0];
    heroLead = `${first.label} reached ${money(first.cap)} on ${format(first.when, "MMM d")}.`;
  } else {
    const open = now.getTime() >= periodStart.getTime() && now.getTime() <= periodEnd.getTime();
    const pending = caps
      .filter((c) => flexiblePick(c.id))
      .map((c) => {
        const spent = sum((flexiblePick(c.id)!(periodSpend)).map((t) => t.amount));
        return { ...c, spent };
      })
      .filter((c) => c.spent < c.cap && c.spent > 0);
    if (open && pending.length > 0) {
      const elapsed = Math.max(1, differenceInCalendarDays(now, periodStart) + 1);
      const dayCount = Math.max(1, differenceInCalendarDays(periodEnd, periodStart) + 1);
      const soonest = pending
        .map((c) => {
          const daily = c.spent / elapsed;
          const daysNeeded = c.cap / daily;
          const hit = addDays(periodStart, Math.max(0, Math.floor(daysNeeded) - 1));
          return { ...c, hit, inside: daysNeeded <= dayCount };
        })
        .filter((c) => c.inside)
        .sort((a, b) => a.hit.getTime() - b.hit.getTime())[0];
      heroLead = soonest
        ? `At this pace, ${soonest.label} reaches ${money(soonest.cap)} on ${format(soonest.hit, "MMM d")}.`
        : "The flexible caps hold at this pace.";
    } else {
      heroLead = "The flexible caps hold for this period.";
    }
  }

  const window = reviewWindow(periodStart, periodEnd, now);
  const weekTx = periodSpend.filter((t) => inWindow(t, window.from, window.to));
  const cardDates = Array.from(new Set(weekTx.map((t) => format(t.date, "yyyy-MM-dd")))).sort();
  let noTap = 0;
  for (let d = window.from; d.getTime() <= window.to.getTime(); d = addDays(d, 1)) {
    if (!cardDates.includes(format(d, "yyyy-MM-dd"))) noTap += 1;
  }
  const capBits = caps
    .filter((c) => c.id !== "rent" && c.id !== "etransfer")
    .map((c) => `${c.label} is ${money(c.actual)} of a ${money(c.cap)} cap`);
  const weekRules =
    activeRules.length === 0
      ? "No if-then is written."
      : activeRules.map((rule) => ruleSentence(rule, weekTx, "this week")).join(" ");
  const offCuts = cuts.filter((c) => c.off);
  let cutLine = "No cut is marked off.";
  if (offCuts.length > 0) {
    cutLine = offCuts
      .map((cut) => {
        const back = weekTx.some((t) => merchantKey(t.merchant) === cut.merchantKey || placeHit(t.merchant, cut.label));
        return back ? `${cut.label} came back this week. The cut is not still off.` : `${cut.label} is still off.`;
      })
      .join(" ");
  }

  return {
    heroLead,
    habits,
    overLines,
    ruleLine,
    ruleNote,
    sunday: {
      weekLabel: `${format(window.from, "MMM d")}–${format(window.to, "MMM d")}`,
      cardDays: cardDates.length,
      noTapDays: noTap,
      capsLine: capBits.length > 0 ? capBits.join(". ") + "." : "No flexible cap is set.",
      ruleLine: weekRules,
      cutLine,
    },
  };
}

export function parseIfThen(raw: string | null | undefined): IfThenRule[] {
  if (raw == null) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((row) => row && typeof row.text === "string")
      .map((row) => ({
        id: String(row.id || merchantKey(row.text)),
        text: String(row.text),
        places: Array.isArray(row.places) ? row.places.map((p: unknown) => String(p)) : [],
        weekdaysOnly: Boolean(row.weekdaysOnly),
        capLabel: String(row.capLabel || "Eating out"),
        seeded: Boolean(row.seeded),
      }));
  } catch {
    return [];
  }
}

export function parseCuts(raw: string | null | undefined): CutMark[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((row) => row && row.label)
      .map((row) => ({
        id: String(row.id || merchantKey(String(row.label))),
        merchantKey: String(row.merchantKey || merchantKey(String(row.label))),
        label: String(row.label),
        off: Boolean(row.off),
      }));
  } catch {
    return [];
  }
}
