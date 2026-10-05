import { prisma } from "./db";
import {
  lastCompleteMonths,
  monthBounds,
  monthKey,
  projectMonthEnd,
} from "./dates";
import {
  startOfMonth,
  startOfWeek,
  format,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  endOfWeek,
  differenceInCalendarDays,
  subMonths,
} from "date-fns";
import { resolvePeriod, type PeriodSpec } from "./period";
import { buildDisposition, buildPeriodStory, buildTaps, merchantKey, shortMerchant } from "./insights";
import { buildPace, buildSubscriptions, capDayLabel, pastYouLine } from "./coach";
import { isInternalMovement } from "./autocat";

export type CutItem = {
  id: string;
  title: string;
  detail: string;
  estimatedMonthly: number;
  action: string;
  gapContribution: number;
  kind: "recurring" | "wants" | "rising" | "leak";
};

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

async function ensureBootstrap() {
  const { ensureSeeded } = await import("./seed");
  await ensureSeeded();
}

/** @deprecated prefer PeriodSpec — still accepts a month string for share/compat */
export async function getDashboardData(monthOrPeriod?: string | PeriodSpec) {
  await ensureBootstrap();

  const now = new Date();
  const spec: PeriodSpec =
    typeof monthOrPeriod === "string" || monthOrPeriod === undefined
      ? { mode: "month", month: typeof monthOrPeriod === "string" ? monthOrPeriod : undefined }
      : monthOrPeriod;
  const period = resolvePeriod(spec, now);
  const { start, end, prevStart, prevEnd } = period;

  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });

  const [thisTx, prevTx, allTx] = await Promise.all([
    prisma.transaction.findMany({
      where: { date: { gte: start, lte: end } },
      include: { category: true },
      orderBy: { date: "desc" },
    }),
    prisma.transaction.findMany({
      where: { date: { gte: prevStart, lte: prevEnd } },
      include: { category: true },
    }),
    prisma.transaction.findMany({
      include: { category: true },
      orderBy: { date: "asc" },
    }),
  ]);

  const isSpend = <T extends { merchant: string; category: { bucket: string } | null }>(t: T) =>
    t.category?.bucket !== "Transfer" && !isInternalMovement(t.merchant);
  const thisSpend = thisTx.filter(isSpend);
  const prevSpend = prevTx.filter(isSpend);
  const allSpend = allTx.filter(isSpend);

  const spentThisPeriod = sum(thisSpend.map((t) => t.amount));
  const spentPrevPeriod = sum(prevSpend.map((t) => t.amount));
  const fixedSpent = sum(
    thisSpend.filter((t) => t.category?.bucket === "Fixed").map((t) => t.amount)
  );
  const variableSpent = Math.max(0, spentThisPeriod - fixedSpent);

  const baselineFocus = period.mode === "month" ? start : startOfMonth(now);
  const baseline = await computeBaseline(allSpend, settings?.baselineOverride ?? null, baselineFocus);
  // Scale 50% target to period length vs a typical month (~30.4 days)
  const monthFactor = period.dayCount / 30.44;
  const target = baseline * 0.5 * (period.mode === "month" ? 1 : monthFactor);

  let projected = spentThisPeriod;
  if (period.mode === "month" && period.isCurrentMonth) {
    projected = fixedSpent + projectMonthEnd(variableSpent, now);
  } else if (period.mode === "year" && end.getFullYear() === now.getFullYear()) {
    const elapsed = Math.max(1, differenceInCalendarDays(now, start) + 1);
    const total = period.dayCount;
    projected = fixedSpent + (variableSpent / elapsed) * (total - (fixedSpent > 0 ? 0 : 0));
    // Pace all spend for open year (fixed already included in spent)
    projected = (spentThisPeriod / elapsed) * total;
  }

  const targetUsedPct = target > 0 ? (spentThisPeriod / target) * 100 : 0;
  const remaining = Math.max(0, target - spentThisPeriod);
  const gapToClose = Math.max(0, projected - target);
  const income = settings?.monthlyIncome ?? null;
  const spendOfIncome =
    income && income > 0
      ? (spentThisPeriod / (income * (period.mode === "month" ? 1 : monthFactor))) * 100
      : null;

  const byCategory = rollupByCategory(thisSpend, categories, spentThisPeriod);
  const byBucket = rollupByBucket(byCategory);
  const topMerchants = rollupMerchants(thisSpend);
  const cutList = buildCutList({
    thisTx: thisSpend,
    prevTx: prevSpend,
    allTx: allSpend,
    spentThisMonth: spentThisPeriod,
    target,
    gapToClose,
    byCategory,
    byBucket,
  });
  const monthComparison = buildMonthComparison(thisSpend, prevSpend, allSpend, categories, start);
  const byDay = rollupByDay(thisSpend, start, end);
  const byWeek = rollupByWeek(thisSpend, start, end);
  const byMonth =
    period.mode === "year" || period.dayCount > 45 ? rollupByMonth(thisSpend, start, end) : [];

  const flaggedTransfers = thisTx.filter(
    (t) =>
      /internet banking e-transfer/i.test(t.merchant) &&
      !/wealth realty|osteopath|naturopath/i.test(t.merchant) &&
      t.amount >= 150
  );
  const disposition = buildDisposition([...thisSpend, ...flaggedTransfers], period.label);
  const story = buildPeriodStory([...thisSpend, ...flaggedTransfers], period.label);
  const rentInPeriod = thisTx.filter(isRentLine);
  const rentDoubled = rentInPeriod.length >= 2;
  const taps = buildTaps(thisSpend);

  const rules = await prisma.spendingRule.findMany({
    where: { active: true },
    include: { category: true },
    orderBy: { createdAt: "asc" },
  });
  const capFactor = period.mode === "month" ? 1 : period.dayCount / 30.44;
  const ruleStatus = evaluateRules(rules, thisSpend, topMerchants, capFactor);

  type WatchRow = { id: string; merchantKey: string; label: string; capAmount: number };
  let savedWatch: WatchRow[] = [];
  try {
    savedWatch = JSON.parse(settings?.watchlistsJson || "[]");
    if (!Array.isArray(savedWatch)) savedWatch = [];
  } catch {
    savedWatch = [];
  }
  if (savedWatch.length === 0 && topMerchants.some((m) => merchantKey(m.merchant) === "costco")) {
    savedWatch = [{ id: "suggested-costco", merchantKey: "costco", label: "Costco", capAmount: 400 }];
  }
  const watchlists = savedWatch.map((w) => {
    const mine = thisSpend.filter((t) => merchantKey(t.merchant) === w.merchantKey.toLowerCase());
    const spent = sum(mine.map((t) => t.amount));
    const history = allSpend.filter((t) => merchantKey(t.merchant) === w.merchantKey.toLowerCase());
    const monthTotals: number[] = [];
    for (let i = 1; i <= 12; i++) {
      const m = startOfMonth(subMonths(now, i));
      const { start: ms, end: me } = monthBounds(m);
      const total = sum(history.filter((t) => t.date >= ms && t.date <= me).map((t) => t.amount));
      if (total > 0) monthTotals.push(total);
    }
    const avg12 = monthTotals.length ? sum(monthTotals) / monthTotals.length : 0;
    const elapsed = Math.max(1, differenceInCalendarDays(now < end ? now : end, start) + 1);
    const projected = period.mode === "month" && period.isCurrentMonth ? (spent / elapsed) * period.dayCount : spent;
    return {
      ...w,
      spent,
      avg12,
      projected,
      capDay: capDayLabel(w.label, spent, w.capAmount, start, end, now),
    };
  });
  const capWarnings = [
    ...rules
      .filter((r) => r.type === "category_cap" && r.limitAmount && r.category)
      .map((r) =>
        capDayLabel(
          r.category!.name,
          sum(thisSpend.filter((t) => t.categoryId === r.categoryId).map((t) => t.amount)),
          (r.limitAmount ?? 0) * capFactor,
          start,
          end,
          now
        )
      )
      .filter((x): x is string => Boolean(x)),
    ...watchlists.map((w) => w.capDay).filter((x): x is string => Boolean(x)),
  ];

  const { weekStartKey } = await import("./dates");
  const weekKey = weekStartKey(now);
  let weekly = await prisma.weeklyReview.findUnique({ where: { weekStart: weekKey } });
  if (!weekly) {
    weekly = await prisma.weeklyReview.create({ data: { weekStart: weekKey } });
  }

  return {
    period: {
      mode: period.mode,
      label: period.label,
      start: format(start, "yyyy-MM-dd"),
      end: format(end, "yyyy-MM-dd"),
      query: period.query,
      dayCount: period.dayCount,
    },
    // backwards-compatible aliases used by existing UI
    month: period.query.month || format(start, "yyyy-MM"),
    monthLabel: period.label,
    baseline,
    target,
    spentThisMonth: spentThisPeriod,
    spentLastMonth: spentPrevPeriod,
    spentThisPeriod,
    spentPrevPeriod,
    projected,
    targetUsedPct,
    remaining,
    gapToClose,
    income,
    spendOfIncome,
    byCategory,
    byBucket,
    topMerchants,
    cutList,
    monthComparison,
    byDay,
    byWeek,
    byMonth,
    disposition,
    story,
    rentDoubled,
    fixedSpent,
    pace: buildPace(thisSpend, start, end, target),
    pastYou: pastYouLine(spentThisPeriod, baseline, start, end, now),
    subscriptions: buildSubscriptions(allSpend, now),
    watchlists,
    capWarnings,
    taps,
    ruleStatus,
    weekly,
    categories,
  };
}

function rollupByDay(
  tx: { date: Date; amount: number }[],
  start: Date,
  end: Date
) {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const days = eachDayOfInterval({ start, end });
  // Cap chart points for very long ranges — sample by week buckets instead handled elsewhere
  if (days.length > 62) return [];
  const map = new Map<string, number>();
  for (const t of tx) {
    const k = format(t.date, "yyyy-MM-dd");
    map.set(k, (map.get(k) ?? 0) + t.amount);
  }
  return days.map((d) => {
    const key = format(d, "yyyy-MM-dd");
    return { key, label: format(d, "MMM d"), amount: map.get(key) ?? 0 };
  });
}

function rollupByWeek(
  tx: { date: Date; amount: number }[],
  start: Date,
  end: Date
) {
  const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
  return weeks.map((w) => {
    const wStart = startOfWeek(w, { weekStartsOn: 1 });
    const wEnd = endOfWeek(w, { weekStartsOn: 1 });
    const amount = sum(
      tx
        .filter((t) => t.date >= wStart && t.date <= wEnd && t.date >= start && t.date <= end)
        .map((t) => t.amount)
    );
    return {
      key: format(wStart, "yyyy-MM-dd"),
      label: `${format(wStart, "MMM d")}–${format(wEnd > end ? end : wEnd, "MMM d")}`,
      amount,
    };
  });
}

function rollupByMonth(
  tx: { date: Date; amount: number }[],
  start: Date,
  end: Date
) {
  const months = eachMonthOfInterval({ start, end });
  return months.map((m) => {
    const { start: ms, end: me } = monthBounds(m);
    const amount = sum(
      tx.filter((t) => t.date >= ms && t.date <= me).map((t) => t.amount)
    );
    return {
      key: monthKey(m),
      label: format(m, "MMM yyyy"),
      amount,
    };
  });
}

function sum(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0);
}

function isRentLine(t: { merchant: string; category: { name: string } | null }) {
  return /rent/i.test(t.category?.name || "") || /wealth realty/i.test(t.merchant);
}

/** One rent payment per month, even if the export lists it twice. */
function baselineMonthTotal(
  rows: { amount: number; merchant: string; category: { name: string } | null }[]
) {
  const rent = rows.filter(isRentLine);
  const rest = rows.filter((t) => !isRentLine(t));
  let rentSum = sum(rent.map((t) => t.amount));
  if (rent.length >= 2) rentSum = rentSum / rent.length;
  return sum(rest.map((t) => t.amount)) + rentSum;
}

async function computeBaseline(
  allTx: { date: Date; amount: number; merchant: string; category: { name: string } | null }[],
  override: number | null,
  focus: Date
) {
  if (override && override > 0) return override;

  const months = lastCompleteMonths(3, focus);
  const totals: number[] = [];
  for (const m of months) {
    const { start, end } = monthBounds(m);
    const total = baselineMonthTotal(allTx.filter((t) => t.date >= start && t.date <= end));
    if (total > 0) totals.push(total);
  }

  if (totals.length === 0) {
    // Fall back to any month with spend before focus
    const byMonth = new Map<string, number>();
    for (const t of allTx) {
      if (t.date >= startOfMonth(focus)) continue;
      const k = monthKey(t.date);
      byMonth.set(k, (byMonth.get(k) ?? 0) + t.amount);
    }
    const vals = Array.from(byMonth.values()).filter((v) => v > 0);
    if (vals.length === 0) return 0;
    return sum(vals) / vals.length;
  }

  return sum(totals) / totals.length;
}

function rollupByCategory(
  tx: { amount: number; categoryId: string | null; category: { id: string; name: string; bucket: string; color: string } | null }[],
  categories: { id: string; name: string; bucket: string; color: string }[],
  total: number
) {
  const map = new Map<
    string,
    { id: string; name: string; bucket: string; color: string; amount: number; pct: number }
  >();
  for (const c of categories) {
    map.set(c.id, { id: c.id, name: c.name, bucket: c.bucket, color: c.color, amount: 0, pct: 0 });
  }
  let uncategorized = 0;
  for (const t of tx) {
    if (!t.categoryId || !map.has(t.categoryId)) {
      uncategorized += t.amount;
      continue;
    }
    const row = map.get(t.categoryId)!;
    row.amount += t.amount;
  }
  const rows = Array.from(map.values())
    .map((r) => ({ ...r, pct: total > 0 ? (r.amount / total) * 100 : 0 }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  if (uncategorized > 0) {
    rows.push({
      id: "uncategorized",
      name: "Uncategorized",
      bucket: "Needs",
      color: "#94a3b8",
      amount: uncategorized,
      pct: total > 0 ? (uncategorized / total) * 100 : 0,
    });
  }
  return rows;
}

function rollupByBucket(
  byCategory: { bucket: string; amount: number; pct: number }[]
) {
  const buckets = ["Needs", "Wants", "Fixed"] as const;
  return buckets.map((bucket) => {
    const amount = sum(byCategory.filter((c) => c.bucket === bucket).map((c) => c.amount));
    const pct = sum(byCategory.filter((c) => c.bucket === bucket).map((c) => c.pct));
    return { bucket, amount, pct };
  });
}

function rollupMerchants(
  tx: { merchant: string; amount: number; date: Date; category: { name: string; bucket: string } | null }[]
) {
  const map = new Map<
    string,
    { merchant: string; amount: number; count: number; dates: Date[]; category: string | null; recurring: boolean }
  >();
  for (const t of tx) {
    const key = merchantKey(t.merchant);
    const row = map.get(key) ?? {
      merchant: shortMerchant(t.merchant),
      amount: 0,
      count: 0,
      dates: [],
      category: t.category?.name ?? null,
      recurring: false,
    };
    row.amount += t.amount;
    row.count += 1;
    row.dates.push(t.date);
    map.set(key, row);
  }
  return Array.from(map.values())
    .map((m) => ({
      ...m,
      recurring: detectRecurring(m.dates, m.amount / m.count),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 15);
}

function detectRecurring(dates: Date[], avgAmount: number): boolean {
  if (dates.length < 2) return false;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i].getTime() - sorted[i - 1].getTime()) / (1000 * 60 * 60 * 24));
  }
  const avgGap = sum(gaps) / gaps.length;
  const weekly = avgGap >= 5 && avgGap <= 10;
  const monthly = avgGap >= 25 && avgGap <= 35;
  return (weekly || monthly) && avgAmount > 0;
}

function buildCutList(args: {
  thisTx: { merchant: string; amount: number; date: Date; category: { name: string; bucket: string } | null }[];
  prevTx: { merchant: string; amount: number; category: { name: string; bucket: string } | null }[];
  allTx: { merchant: string; amount: number; date: Date; category: { name: string; bucket: string } | null }[];
  spentThisMonth: number;
  target: number;
  gapToClose: number;
  byCategory: { name: string; bucket: string; amount: number }[];
  byBucket: { bucket: string; amount: number; pct: number }[];
}): CutItem[] {
  const items: CutItem[] = [];
  const gap = Math.max(args.gapToClose, args.spentThisMonth - args.target, 1);

  // Recurring
  const merchants = rollupMerchants(args.thisTx);
  for (const m of merchants.filter((x) => x.recurring || x.count >= 2)) {
    if (m.amount < 5) continue;
    const monthlyEst = m.count >= 2 ? m.amount : m.amount;
    items.push({
      id: `recurring-${m.merchant}`,
      title: m.merchant,
      detail: m.recurring
        ? `Looks like a repeating charge (${m.count} times this period)`
        : `Paid ${m.count} times this period`,
      estimatedMonthly: monthlyEst,
      action:
        m.category === "Subscriptions" || m.recurring
          ? `Cancel — saves about $${Math.round(m.amount)}`
          : `Cut in half — keep about $${Math.round(m.amount / 2)}`,
      gapContribution: Math.min(100, (monthlyEst / gap) * 100),
      kind: "recurring",
    });
  }

  // Want-heavy
  const wants = args.byBucket.find((b) => b.bucket === "Wants");
  if (wants && wants.amount > args.target * 0.3) {
    const over = Math.max(0, wants.amount - args.target * 0.25);
    items.push({
      id: "wants-heavy",
      title: "Want spending is high",
      detail: `Wants are ${Math.round(wants.pct)}% of spend ($${Math.round(wants.amount)})`,
      estimatedMonthly: over,
      action: "Cut wants in half this month",
      gapContribution: Math.min(100, (over / gap) * 100),
      kind: "wants",
    });
  }

  // Rising categories
  const prevByCat = new Map<string, number>();
  for (const t of args.prevTx) {
    const name = t.category?.name ?? "Uncategorized";
    prevByCat.set(name, (prevByCat.get(name) ?? 0) + t.amount);
  }
  for (const c of args.byCategory) {
    const prev = prevByCat.get(c.name) ?? 0;
    const rise = c.amount - prev;
    if (rise >= 40 && c.bucket !== "Fixed") {
      items.push({
        id: `rising-${c.name}`,
        title: `${c.name} rose`,
        detail: `Up $${Math.round(rise)} vs the prior period`,
        estimatedMonthly: rise * 0.5,
        action: "Cut this category back toward the prior period",
        gapContribution: Math.min(100, ((rise * 0.5) / gap) * 100),
        kind: "rising",
      });
    }
  }

  // Small leaks
  const small = args.thisTx.filter((t) => t.amount > 0 && t.amount <= 20);
  const byMerch = new Map<string, { amount: number; count: number; merchant: string }>();
  for (const t of small) {
    const key = t.merchant.toLowerCase();
    const row = byMerch.get(key) ?? { amount: 0, count: 0, merchant: t.merchant };
    row.amount += t.amount;
    row.count += 1;
    byMerch.set(key, row);
  }
  for (const row of Array.from(byMerch.values()).filter((r) => r.count >= 3).sort((a, b) => b.amount - a.amount).slice(0, 3)) {
    const annualizedMonthly = row.amount; // already this month
    items.push({
      id: `leak-${row.merchant}`,
      title: `Small leaks at ${row.merchant}`,
      detail: `${row.count} small purchases totaling $${Math.round(row.amount)}`,
      estimatedMonthly: annualizedMonthly * 0.5,
      action: "Skip half of these trips",
      gapContribution: Math.min(100, ((annualizedMonthly * 0.5) / gap) * 100),
      kind: "leak",
    });
  }

  // Deduplicate by title, keep highest savings
  const best = new Map<string, CutItem>();
  for (const item of items) {
    const existing = best.get(item.title);
    if (!existing || existing.estimatedMonthly < item.estimatedMonthly) {
      best.set(item.title, item);
    }
  }

  return Array.from(best.values())
    .sort((a, b) => b.estimatedMonthly - a.estimatedMonthly)
    .slice(0, 10);
}

function buildMonthComparison(
  thisTx: { amount: number; date: Date; category: { name: string } | null }[],
  prevTx: { amount: number; category: { name: string } | null }[],
  allTx: { amount: number; date: Date; category: { name: string } | null }[],
  categories: { name: string }[],
  periodStart: Date
) {
  const names = new Set([
    ...categories.map((c) => c.name),
    ...thisTx.map((t) => t.category?.name ?? "Uncategorized"),
    ...prevTx.map((t) => t.category?.name ?? "Uncategorized"),
  ]);
  const thisMap = new Map<string, number>();
  const prevMap = new Map<string, number>();
  for (const t of thisTx) {
    const n = t.category?.name ?? "Uncategorized";
    thisMap.set(n, (thisMap.get(n) ?? 0) + t.amount);
  }
  for (const t of prevTx) {
    const n = t.category?.name ?? "Uncategorized";
    prevMap.set(n, (prevMap.get(n) ?? 0) + t.amount);
  }
  const priorMonths = lastCompleteMonths(3, periodStart);
  const usualByCat = new Map<string, number>();
  for (const name of Array.from(names)) {
    const totals: number[] = [];
    for (const m of priorMonths) {
      const { start: ms, end: me } = monthBounds(m);
      const total = sum(
        allTx
          .filter(
            (t) =>
              (t.category?.name ?? "Uncategorized") === name && t.date >= ms && t.date <= me
          )
          .map((t) => t.amount)
      );
      if (total > 0) totals.push(total);
    }
    usualByCat.set(name, totals.length ? sum(totals) / totals.length : 0);
  }
  return Array.from(names)
    .map((name) => {
      const thisAmt = thisMap.get(name) ?? 0;
      const lastAmt = prevMap.get(name) ?? 0;
      const usual = usualByCat.get(name) ?? 0;
      return {
        name,
        thisMonth: thisAmt,
        lastMonth: lastAmt,
        usual,
        usualShare: usual,
      };
    })
    .filter((r) => r.thisMonth > 0 || r.lastMonth > 0)
    .sort((a, b) => b.thisMonth - a.thisMonth);
}

function evaluateRules(
  rules: {
    id: string;
    name: string;
    type: string;
    limitAmount: number | null;
    categoryId: string | null;
    category: { name: string } | null;
  }[],
  thisTx: { amount: number; date: Date; merchant: string; categoryId: string | null; category: { name: string } | null }[],
  merchants: { merchant: string; recurring: boolean; count: number }[],
  capFactor = 1
) {
  return rules.map((rule) => {
    let spent = 0;
    let status: "on_track" | "over" = "on_track";
    let detail = "";

    if (rule.type === "category_cap" && rule.categoryId) {
      spent = sum(thisTx.filter((t) => t.categoryId === rule.categoryId).map((t) => t.amount));
      const limit = (rule.limitAmount ?? 0) * capFactor;
      status = spent > limit ? "over" : "on_track";
      detail = `$${Math.round(spent)} of $${Math.round(limit)} on ${rule.category?.name ?? "category"}`;
    } else if (rule.type === "no_new_subs") {
      const subHits = thisTx.filter(
        (t) =>
          t.category?.name === "Subscriptions" ||
          merchants.some((m) => m.merchant.toLowerCase() === t.merchant.toLowerCase() && m.recurring)
      );
      // Heuristic: more than 1 distinct subscription merchant this month counts as pressure
      const distinct = new Set(subHits.map((t) => t.merchant.toLowerCase()));
      spent = sum(subHits.map((t) => t.amount));
      status = distinct.size > 3 ? "over" : "on_track";
      detail = `${distinct.size} subscription-like merchants this month`;
    } else if (rule.type === "weekend_only") {
      const weekdayShop = thisTx.filter((t) => {
        if (t.category?.name !== "Shopping" && rule.categoryId && t.categoryId !== rule.categoryId) {
          return rule.categoryId ? t.categoryId === rule.categoryId && ![0, 6].includes(t.date.getDay()) : false;
        }
        const isShop = rule.categoryId ? t.categoryId === rule.categoryId : t.category?.name === "Shopping";
        const weekday = t.date.getDay() !== 0 && t.date.getDay() !== 6;
        return isShop && weekday;
      });
      spent = sum(weekdayShop.map((t) => t.amount));
      status = weekdayShop.length > 0 ? "over" : "on_track";
      detail =
        weekdayShop.length > 0
          ? `$${Math.round(spent)} shopping on weekdays`
          : "No weekday shopping this month";
    } else {
      detail = "Rule active";
    }

    return {
      id: rule.id,
      name: rule.name,
      type: rule.type,
      status,
      detail,
      spent,
      limitAmount: rule.limitAmount,
    };
  });
}
