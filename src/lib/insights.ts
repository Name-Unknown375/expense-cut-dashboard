import { format } from "date-fns";

export type Verdict =
  | "Fixed"
  | "One-time"
  | "Main leak"
  | "Cap it"
  | "Pick one"
  | "Fine"
  | "Keep"
  | "Skip next month"
  | "Watch";

export type DispositionRow = {
  id: string;
  what: string;
  amount: number;
  verdict: Verdict;
  note?: string;
  categoryId?: string | null;
  merchant?: string;
  count: number;
};

export type TapLine = {
  id: string;
  merchant: string;
  count: number;
  amount: number;
  phrase: string; // "two visits", "six taps of $1–$10"
  minAmount: number;
  maxAmount: number;
  avgAmount: number;
  categoryId?: string | null;
};

export type CategoryInsight = {
  categoryId: string;
  categoryName: string;
  bucket: string;
  total: number;
  periodLabel: string;
  summary: string;
  repeats: Array<TapLine & { verdict: Verdict }>;
  oneOffs: Array<{ id: string; merchant: string; amount: number; verdict: Verdict; date: string }>;
  nextAction: string;
};

type Tx = {
  id: string;
  date: Date;
  amount: number;
  merchant: string;
  categoryId: string | null;
  category: { id: string; name: string; bucket: string } | null;
};

function sum(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0);
}

function wordCount(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return words[n] ?? String(n);
}

function unitFor(merchant: string, count: number): string {
  const m = merchant.toLowerCase();
  if (/coffee|starbucks|presote|cafe|tea/.test(m)) return count === 1 ? "drink" : "drinks";
  if (/uber eats|doordash|dominos|domino|delivery/.test(m)) return count === 1 ? "order" : "orders";
  if (/costco|grocery|foods|joe/.test(m)) return count === 1 ? "trip" : "trips";
  if (/vending|nayax|haha/.test(m)) return count === 1 ? "tap" : "taps";
  if (count === 1) return "hit";
  return count <= 3 ? "visits" : "taps";
}

function phraseFor(merchant: string, count: number, min: number, max: number, avg: number): string {
  const unit = unitFor(merchant, count);
  const wc = wordCount(count);
  if (count === 1) return `one ${unit}`;
  if (max - min < 1.5 && avg <= 12) {
    return `${wc} ${unit} around $${avg.toFixed(avg < 10 ? 2 : 0)}`;
  }
  if (max <= 15 && min >= 1 && max - min >= 1) {
    return `${wc} ${unit} of $${Math.floor(min)}–$${Math.ceil(max)}`;
  }
  return `${wc} ${unit}`;
}

function groupByMerchant(tx: Tx[]) {
  const map = new Map<
    string,
    {
      merchant: string;
      amounts: number[];
      dates: Date[];
      categoryId: string | null;
      bucket: string | null;
      categoryName: string | null;
    }
  >();
  for (const t of tx) {
    const key = t.merchant.trim().toLowerCase();
    const row = map.get(key) ?? {
      merchant: t.merchant.trim(),
      amounts: [],
      dates: [],
      categoryId: t.categoryId,
      bucket: t.category?.bucket ?? null,
      categoryName: t.category?.name ?? null,
    };
    row.amounts.push(t.amount);
    row.dates.push(t.date);
    map.set(key, row);
  }
  return Array.from(map.values()).map((g) => {
    const amount = sum(g.amounts);
    const count = g.amounts.length;
    const minAmount = Math.min(...g.amounts);
    const maxAmount = Math.max(...g.amounts);
    const avgAmount = amount / count;
    return {
      ...g,
      amount,
      count,
      minAmount,
      maxAmount,
      avgAmount,
      phrase: phraseFor(g.merchant, count, minAmount, maxAmount, avgAmount),
    };
  });
}

function verdictForGroup(g: {
  count: number;
  amount: number;
  avgAmount: number;
  bucket: string | null;
  categoryName: string | null;
  merchant: string;
}): Verdict {
  const name = (g.categoryName || "").toLowerCase();
  const bucket = g.bucket || "";
  if (bucket === "Fixed" || /rent|utilities|subscription/.test(name)) return "Fixed";
  if (g.count === 1 && g.amount >= 150) return "One-time";
  if (g.count === 1 && g.amount < 40) return "Fine";
  if (g.count >= 4 && g.avgAmount <= 25 && bucket === "Wants") return "Main leak";
  if (g.count >= 3 && /dining|eat|coffee|uber|door/.test(g.merchant.toLowerCase() + name)) {
    return "Cap it";
  }
  if (g.count >= 2 && g.amount >= 80 && bucket === "Wants") return "Pick one";
  if (g.count >= 2 && bucket === "Needs") return "Keep";
  if (g.count === 1 && bucket === "Wants" && g.amount >= 60) return "Skip next month";
  if (g.count >= 2) return "Watch";
  return "Fine";
}

function actionForVerdict(verdict: Verdict, merchant: string): string {
  switch (verdict) {
    case "Main leak":
      return `Cut ${merchant} in half this period.`;
    case "Cap it":
      return `Set a hard cap on ${merchant}.`;
    case "Pick one":
      return `Pick one ${merchant} trip — skip the rest.`;
    case "Skip next month":
      return `Skip ${merchant} next period.`;
    case "One-time":
      return `Treat as one-time — don't let it become a habit.`;
    case "Fixed":
      return `Fixed cost — leave alone unless you renegotiate.`;
    case "Keep":
      return `Keep — this looks like a need.`;
    case "Fine":
      return `Fine as-is.`;
    case "Watch":
      return `Watch ${merchant} — heading toward a leak.`;
    default:
      return `Review ${merchant}.`;
  }
}

/** Period-level disposition rows (What | Amount | Verdict) */
export function buildDisposition(tx: Tx[], periodLabel: string): {
  rows: DispositionRow[];
  note?: string;
  nextAction: string;
} {
  const groups = groupByMerchant(tx).sort((a, b) => b.amount - a.amount);
  const total = sum(groups.map((g) => g.amount));
  const rows: DispositionRow[] = [];

  for (const g of groups.slice(0, 18)) {
    const verdict = verdictForGroup(g);
    const countBit =
      g.count > 1
        ? `, ${g.phrase}`
        : g.bucket === "Fixed" || /rent/i.test(g.categoryName || "")
          ? " (one month)"
          : "";
    const what =
      g.count > 1
        ? `${g.merchant}${countBit.startsWith(",") ? countBit : `, ${g.phrase}`}`
        : /rent/i.test(g.merchant + (g.categoryName || ""))
          ? `${g.merchant} (one month)`
          : g.merchant;

    rows.push({
      id: `disp-${g.merchant.toLowerCase()}`,
      what: what.replace(/^, /, ""),
      amount: g.amount,
      verdict,
      categoryId: g.categoryId,
      merchant: g.merchant,
      count: g.count,
      note:
        g.count === 1 && verdict === "Fixed"
          ? undefined
          : undefined,
    });
  }

  // Prefer actionable next step from worst verdict
  const priority: Verdict[] = ["Main leak", "Cap it", "Pick one", "Skip next month", "Watch"];
  let nextAction = "Import more spend or tighten one Want category.";
  for (const v of priority) {
    const hit = rows.find((r) => r.verdict === v);
    if (hit?.merchant) {
      nextAction = actionForVerdict(v, hit.merchant);
      break;
    }
  }

  let note: string | undefined;
  const rentish = groups.filter((g) => /rent|landlord/i.test(g.merchant + (g.categoryName || "")));
  if (rentish.some((g) => g.count > 1)) {
    note = `Note: rent-like charges appear more than once in ${periodLabel} — totals may double-count if a payment spans months.`;
  } else if (total > 0 && groups.filter((g) => g.count >= 3).length >= 3) {
    note = `Small repeats are doing real damage in ${periodLabel}. Start with the Main leak or Cap it lines.`;
  }

  return { rows, note, nextAction };
}

/** "Where the taps are" — frequent small/mid repeats, excluding big one-offs */
export function buildTaps(tx: Tx[]): {
  intro: string;
  lines: TapLine[];
  total: number;
  outro: string;
} {
  const groups = groupByMerchant(tx);
  const bigOneOffs = groups.filter((g) => g.count === 1 && g.amount >= 200);
  const bigIds = new Set(bigOneOffs.map((g) => g.merchant.toLowerCase()));

  const taps = groups
    .filter((g) => !bigIds.has(g.merchant.toLowerCase()))
    .filter((g) => g.count >= 2 || (g.count >= 1 && g.avgAmount <= 45 && g.amount <= 120))
    .filter((g) => g.avgAmount <= 80)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12);

  const tapTx = tx.filter((t) => taps.some((x) => x.merchant.toLowerCase() === t.merchant.toLowerCase()));
  const days = new Set(tapTx.map((t) => format(t.date, "yyyy-MM-dd")));
  const total = sum(taps.map((t) => t.amount));
  const excludeNote =
    bigOneOffs.length > 0
      ? ` not counting the ${bigOneOffs[0].merchant} order`
      : "";

  const intro = `You used the card on ${days.size} day${days.size === 1 ? "" : "s"}, ${tapTx.length} time${tapTx.length === 1 ? "" : "s"}${excludeNote}. That is the small-tap problem. The hits that add up:`;

  const lines: TapLine[] = taps.map((g) => ({
    id: `tap-${g.merchant.toLowerCase()}`,
    merchant: g.merchant,
    count: g.count,
    amount: g.amount,
    phrase: g.phrase,
    minAmount: g.minAmount,
    maxAmount: g.maxAmount,
    avgAmount: g.avgAmount,
    categoryId: g.categoryId,
  }));

  const outro =
    total >= 40
      ? `None of those felt like a decision. Together they are about $${Math.round(total)}.`
      : `Still small — keep them from growing.`;

  return { intro, lines, total, outro };
}

export function buildCategoryInsight(
  tx: Tx[],
  categoryId: string,
  periodLabel: string
): CategoryInsight | null {
  const filtered =
    categoryId === "uncategorized"
      ? tx.filter((t) => !t.categoryId)
      : tx.filter((t) => t.categoryId === categoryId);
  if (filtered.length === 0) return null;

  const catName =
    categoryId === "uncategorized"
      ? "Uncategorized"
      : filtered[0].category?.name || "Category";
  const bucket =
    categoryId === "uncategorized" ? "Needs" : filtered[0].category?.bucket || "Needs";
  const total = sum(filtered.map((t) => t.amount));
  const groups = groupByMerchant(filtered).sort((a, b) => b.amount - a.amount);

  const repeats = groups
    .filter((g) => g.count >= 2)
    .map((g) => {
      const verdict = verdictForGroup(g);
      return {
        id: `rep-${g.merchant.toLowerCase()}`,
        merchant: g.merchant,
        count: g.count,
        amount: g.amount,
        phrase: g.phrase,
        minAmount: g.minAmount,
        maxAmount: g.maxAmount,
        avgAmount: g.avgAmount,
        categoryId: g.categoryId,
        verdict,
      };
    });

  const oneOffs = groups
    .filter((g) => g.count === 1)
    .map((g) => ({
      id: `one-${g.merchant.toLowerCase()}`,
      merchant: g.merchant,
      amount: g.amount,
      verdict: verdictForGroup(g),
      date: format(g.dates[0], "MMM d"),
    }));

  const tapCount = sum(repeats.map((r) => r.count));
  const smallTotal = sum(
    filtered.filter((t) => t.amount <= 25).map((t) => t.amount)
  );
  const summary = `${tapCount || filtered.length} tap${(tapCount || filtered.length) === 1 ? "" : "s"} across ${groups.length} merchant${groups.length === 1 ? "" : "s"} · $${Math.round(smallTotal)} of small stuff`;

  const worst =
    repeats.find((r) => r.verdict === "Main leak") ||
    repeats.find((r) => r.verdict === "Cap it") ||
    repeats.find((r) => r.verdict === "Pick one") ||
    oneOffs.find((o) => o.verdict === "Skip next month") ||
    repeats[0];

  const nextAction = worst
    ? "merchant" in worst && worst.merchant
      ? actionForVerdict(
          "verdict" in worst ? worst.verdict : "Watch",
          worst.merchant
        )
      : `Cut ${catName} by 25% next period.`
    : `Hold ${catName} flat next period.`;

  return {
    categoryId,
    categoryName: catName,
    bucket,
    total,
    periodLabel,
    summary,
    repeats,
    oneOffs,
    nextAction,
  };
}
