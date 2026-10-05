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
  | "Watch"
  | "Name this";

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

/** Canonical grouping key shared by insights, dedupe, rules, and filters. */
export function merchantKey(raw: string): string {
  return shortMerchant(raw).toLowerCase();
}

/** Readable label: drop SQ *, PayPal noise, store numbers, and city/province. */
export function shortMerchant(raw: string): string {
  const original = raw.trim();
  const lower = original.toLowerCase();
  if (/costco gas/.test(lower)) return "Costco Gas";
  if (/annual renewal/.test(lower) && /costco/.test(lower)) return "Costco membership";
  if (/costco/.test(lower)) return "Costco";
  if (/wealth realty/.test(lower)) return "Wealth Realty rent";
  if (/ubereats|uber eats/.test(lower)) return "Uber Eats";
  if (/uberonemem|uber one/.test(lower)) return "Uber One";
  if (/ubertrip|uber trip|uber canada\/uber(?!e)/.test(lower)) return "Uber";
  if (/preauthorized debit/.test(lower)) {
    if (/hydro/.test(lower)) return "BC Hydro";
    if (/insurance corporation/.test(lower)) return "ICBC";
    if (/paypal/.test(lower)) return "PayPal";
    if (/interactive/.test(lower)) return "Interactive Brokers";
    if (/cibc loans|prêt cibc|pret cibc/.test(lower)) return "CIBC loan";
    if (/apex climbing/.test(lower)) return "Apex Climbing";
    if (/shaw/.test(lower)) return "Shaw";
    if (/\bcanada\b/.test(lower)) return "PAD Canada";
    if (/\bcsi\b/.test(lower)) return "PAD CSI";
    if (/aviso/.test(lower)) return "Aviso";
    if (/rbcins/.test(lower)) return "RBC Insurance";
  }
  if (/domino/.test(lower)) return "Domino's";
  if (/downlow|dl chicken/.test(lower)) return "Downlow Chicken";
  if (/nayax|vending/.test(lower)) return "Vending";
  if (/haha innovation/.test(lower)) return "HAHA vending";
  if (/nesters/.test(lower)) return "Nesters Market";
  if (/save on foods/.test(lower)) return "Save-On-Foods";
  if (/compass/.test(lower)) return "Compass transit";
  if (/steam/.test(lower)) return "Steam";
  if (/starbucks/.test(lower)) return "Starbucks";
  if (/presotea/.test(lower)) return "Presotea";
  if (/tim horton/.test(lower)) return "Tim Hortons";
  if (/shoppers drug/.test(lower)) return "Shoppers Drug Mart";
  if (/bc hydro|b\.c\. hydro/.test(lower)) return "BC Hydro";

  let s = original
    .replace(/^sq \*\s*/i, "")
    .replace(/^tst-\*?\s*/i, "")
    .replace(/^paypal \*\s*/i, "PayPal ")
    .replace(/\s+#?\d{3,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/,?\s+[A-Za-z .'-]+,\s*[A-Z]{2}\b.*$/, "").trim();
  s = s.replace(/\s{2,}/g, " ");
  if (s.length > 64) s = s.slice(0, 64).trim();
  return s || original.slice(0, 64);
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
    const key = merchantKey(t.merchant);
    const row = map.get(key) ?? {
      merchant: shortMerchant(t.merchant),
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
  if (
    /internet banking e-transfer/.test(g.merchant.toLowerCase()) &&
    !/wealth realty|osteopath|naturopath/.test(g.merchant.toLowerCase()) &&
    g.amount >= 150
  ) {
    return "Name this";
  }
  if (bucket === "Fixed" || /rent|utilities|subscription/.test(name)) return "Fixed";
  if (g.count === 1 && g.amount >= 150) return "One-time";
  if (g.count === 1 && g.amount < 40) return "Fine";
  if (g.count >= 4 && g.avgAmount <= 25 && bucket === "Wants") return "Main leak";
  if (g.count >= 3 && /dining|eat|coffee|uber|door/.test(g.merchant.toLowerCase() + name)) {
    return "Cap it";
  }
  if (g.count >= 2 && g.amount >= 60 && /grocer|costco|market|foods/.test((g.categoryName || "") + g.merchant)) {
    return "Cap it";
  }
  if (g.count >= 2 && g.amount >= 80 && bucket === "Wants") return "Pick one";
  if (g.count >= 2 && bucket === "Needs" && g.amount < 60) return "Keep";
  if (g.count >= 2 && bucket === "Needs") return "Cap it";
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
    case "Name this":
      return `Name ${merchant} or treat it as a transfer — it is not a store.`;
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

  const ranked = [...groups].sort((a, b) => {
    const order = ["Main leak", "Cap it", "Pick one", "Skip next month", "Watch", "One-time", "Fine", "Keep", "Fixed"];
    const d = order.indexOf(verdictForGroup(a)) - order.indexOf(verdictForGroup(b));
    if (d !== 0) return d;
    return b.amount - a.amount;
  });

  for (const g of ranked.slice(0, 14)) {
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

  const nextAction = concreteNextAction(groups);

  let note: string | undefined;
  const rentish = groups.filter((g) => /rent|landlord/i.test(g.merchant + (g.categoryName || "")));
  if (rentish.some((g) => g.count > 1)) {
    note = `Note: rent-like charges appear more than once in ${periodLabel} — totals may double-count if a payment spans months.`;
  } else if (total > 0 && groups.filter((g) => g.count >= 3).length >= 3) {
    note = `Small repeats are doing real damage in ${periodLabel}. Start with the Main leak or Cap it lines.`;
  }

  return { rows, note, nextAction };
}

/** Always name a real merchant and a dollar figure when any spend exists. */
function concreteNextAction(
  groups: Array<{
    merchant: string;
    amount: number;
    count: number;
    bucket: string | null;
    categoryName: string | null;
  }>
): string {
  const live = groups.filter(
    (g) => g.bucket !== "Transfer" && g.bucket !== "Fixed" && !/rent/i.test(g.categoryName || "")
  );
  const repeats = live.filter((g) => g.count >= 2).sort((a, b) => b.amount - a.amount);
  const wants = live
    .filter((g) => g.bucket === "Wants")
    .sort((a, b) => b.amount - a.amount || b.count - a.count);
  const hit = repeats[0] || wants[0] || live.sort((a, b) => b.amount - a.amount)[0];
  if (!hit) {
    const fixed = groups.find((g) => /rent/i.test(g.categoryName || "") || g.bucket === "Fixed");
    if (fixed) {
      return `${shortMerchant(fixed.merchant)} is $${Math.round(fixed.amount)} and fixed. No discretionary leak in this period yet.`;
    }
    return "No purchases in this period yet.";
  }
  const name = shortMerchant(hit.merchant);
  const dollars = Math.round(hit.amount);
  const half = Math.max(1, Math.round(hit.amount / 2));
  if (hit.count >= 2) {
    return `Cap ${name}. ${hit.count} hits are $${dollars} — cut that in half and you keep about $${half}.`;
  }
  if (hit.bucket === "Wants") {
    return `Don't repeat ${name}. That charge was $${dollars}.`;
  }
  return `Watch ${name}: $${dollars} so far. One more trip and it becomes a habit.`;
}

export type StoryLine = { what: string; amount: number; verdict: Verdict; detail?: string };

/** Grok-style period story: rent, eating-out rollup, and the big one-offs kept out of taps. */
export function buildPeriodStory(
  tx: Tx[],
  periodLabel: string
): {
  title: string;
  lede: string;
  rentNote?: string;
  lines: StoryLine[];
  excluded: Array<{ name: string; amount: number }>;
} {
  const groups = groupByMerchant(tx);
  const rent = groups.filter(
    (g) => /rent/i.test(g.categoryName || "") || /wealth realty/i.test(g.merchant)
  );
  const rentCount = rent.reduce((n, g) => n + g.count, 0);
  const rentTotal = sum(rent.map((g) => g.amount));
  const typicalRent = rentCount > 1 ? rentTotal / rentCount : rentTotal;

  const dining = groups.filter((g) => g.categoryName === "Dining");
  const diningTotal = sum(dining.map((g) => g.amount));
  const diningTaps = dining.reduce((n, g) => n + g.count, 0);

  const excluded = groups
    .filter((g) => g.count === 1 && g.amount >= 200 && g.bucket !== "Fixed" && g.categoryName !== "Rent")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4)
    .map((g) => ({ name: g.merchant, amount: g.amount }));

  const lines: StoryLine[] = [];
  if (rentTotal > 0) {
    lines.push({
      what: rentCount > 1 ? `Rent (${rentCount} charges)` : "Rent (one month)",
      amount: rentCount > 1 ? typicalRent : rentTotal,
      verdict: "Fixed",
      detail: rentCount > 1 ? `Export total $${Math.round(rentTotal)}` : undefined,
    });
  }
  if (diningTaps > 0) {
    lines.push({
      what: `Eating out, ${diningTaps} tap${diningTaps === 1 ? "" : "s"}`,
      amount: diningTotal,
      verdict: diningTaps >= 8 ? "Main leak" : diningTaps >= 3 ? "Cap it" : "Fine",
    });
  }
  const named = groups
    .filter((g) => g.categoryName !== "Dining" && g.categoryName !== "Rent")
    .filter((g) => !/wealth realty/i.test(g.merchant))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
  for (const g of named) {
    lines.push({
      what: g.count > 1 ? `${g.merchant}, ${g.phrase}` : g.merchant,
      amount: g.amount,
      verdict: verdictForGroup(g),
    });
  }

  let rentNote: string | undefined;
  let lede = `${periodLabel} is mostly the taps under the big fixed lines.`;
  if (rentCount > 1) {
    rentNote = `Rent was charged ${rentCount} times (${"$"}${Math.round(rentTotal)} combined). A normal month is about ${"$"}${Math.round(typicalRent || rentTotal)}.`;
    lede = rentNote;
  } else if (rentTotal > 0) {
    lede = `One rent payment is about ${"$"}${Math.round(rentTotal)}. The cut is in the taps, not the rent.`;
  } else if (diningTaps >= 3) {
    lede = `Eating out is ${diningTaps} taps, about ${"$"}${Math.round(diningTotal)}. That is the leak to cap.`;
  }

  return {
    title: `What ${periodLabel} actually was`,
    lede,
    rentNote,
    lines,
    excluded,
  };
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
    .filter((g) => g.avgAmount <= 100)
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
