import { prisma } from "./db";
import { DEFAULT_CATEGORIES } from "./categories";
import { guessCategoryName, rememberMerchant, resolveCategoryId } from "./autocat";
import { subMonths, setDate, startOfMonth } from "date-fns";

let seeding: Promise<void> | null = null;

export async function ensureSeeded() {
  if (seeding) return seeding;
  seeding = (async () => {
    const count = await prisma.category.count();
    if (count === 0) {
      await prisma.category.createMany({ data: DEFAULT_CATEGORIES });
    }
    await prisma.category.upsert({
      where: { name: "Transfers" },
      create: { name: "Transfers", bucket: "Transfer", color: "#94a3b8", sortOrder: 12 },
      update: { bucket: "Transfer" },
    });
    await prisma.category.updateMany({
      where: { name: "Other", bucket: "Needs" },
      data: { bucket: "Other" },
    });
    await reclassifyByHeuristics();

    await prisma.settings.upsert({
      where: { id: "default" },
      create: { id: "default", monthlyIncome: 5200 },
      update: {},
    });

    // Demo transactions are not auto-loaded. They were mixing into real imports
    // and skewing totals. Use `npm run seed` only on an empty local database.

    // Backfill any leftover null categories (never leave spend unlabeled)
    await backfillUncategorized();

    const ruleCount = await prisma.spendingRule.count();
    if (ruleCount === 0) {
      const dining = await prisma.category.findUnique({ where: { name: "Dining" } });
      const shopping = await prisma.category.findUnique({ where: { name: "Shopping" } });
      await prisma.spendingRule.createMany({
        data: [
          {
            name: "Dining under $200/month",
            type: "category_cap",
            categoryId: dining?.id,
            limitAmount: 200,
          },
          {
            name: "No new subscriptions",
            type: "no_new_subs",
            limitAmount: null,
          },
          {
            name: "Shopping only on weekends",
            type: "weekend_only",
            categoryId: shopping?.id,
          },
        ],
      });
    }
  })();
  try {
    await seeding;
  } finally {
    seeding = null;
  }
}

/** Re-apply category rules to imported merchants and refresh remembered labels. */
async function reclassifyByHeuristics() {
  const categories = await prisma.category.findMany();
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const groups = await prisma.transaction.groupBy({
    by: ["merchant", "categoryId"],
  });
  for (const row of groups) {
    const guess = guessCategoryName(row.merchant);
    if (!guess) continue;
    const nextId = byName.get(guess.toLowerCase());
    if (!nextId || nextId === row.categoryId) continue;
    await prisma.transaction.updateMany({
      where: { merchant: row.merchant, categoryId: row.categoryId },
      data: { categoryId: nextId },
    });
    await rememberMerchant(prisma, row.merchant, nextId);
  }
}

/** Assign categories to any transactions still missing one. */
export async function backfillUncategorized() {
  const uncategorized = await prisma.transaction.findMany({
    where: { categoryId: null },
    select: { id: true, merchant: true },
    take: 500,
  });
  if (uncategorized.length === 0) return;

  const [merchantRules, categories] = await Promise.all([
    prisma.merchantRule.findMany(),
    prisma.category.findMany(),
  ]);
  const ruleMap = new Map(merchantRules.map((r) => [r.merchant, r.categoryId]));
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  for (const tx of uncategorized) {
    const resolved = resolveCategoryId(tx.merchant, { ruleMap, catByName });
    if (!resolved.categoryId) continue;
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { categoryId: resolved.categoryId },
    });
    if (resolved.source === "heuristic" || resolved.source === "other") {
      await rememberMerchant(prisma, tx.merchant, resolved.categoryId);
      ruleMap.set(tx.merchant.trim().toLowerCase(), resolved.categoryId);
    }
  }
}

/** Optional local demo only. Not called on app boot. */
export async function seedSampleTransactions() {
  const cats = await prisma.category.findMany();
  const byName = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  const now = new Date();

  type Sample = { day: number; amount: number; merchant: string; category: string; note?: string };
  const monthPatterns: Sample[][] = [
    // current month (partial) — dense early days so demo looks alive mid-month
    [
      { day: 1, amount: 1650, merchant: "Landlord LLC", category: "Rent" },
      { day: 1, amount: 9.5, merchant: "Starbucks", category: "Dining" },
      { day: 1, amount: 18.0, merchant: "Uber Eats", category: "Dining" },
      { day: 2, amount: 118.4, merchant: "City Power", category: "Utilities" },
      { day: 2, amount: 9.5, merchant: "Starbucks", category: "Dining" },
      { day: 2, amount: 64.0, merchant: "Target", category: "Shopping" },
      { day: 3, amount: 15.99, merchant: "Netflix", category: "Subscriptions" },
      { day: 3, amount: 10.99, merchant: "Spotify", category: "Subscriptions" },
      { day: 3, amount: 28.4, merchant: "Chipotle", category: "Dining" },
      { day: 3, amount: 12.0, merchant: "Uber Eats", category: "Dining" },
      { day: 4, amount: 86.22, merchant: "Whole Foods", category: "Groceries" },
      { day: 4, amount: 9.5, merchant: "Starbucks", category: "Dining" },
      { day: 4, amount: 120.0, merchant: "Amazon", category: "Shopping" },
      { day: 5, amount: 42.5, merchant: "Shell Gas", category: "Transport" },
      { day: 5, amount: 35.0, merchant: "DoorDash", category: "Dining" },
      { day: 5, amount: 9.5, merchant: "Starbucks", category: "Dining" },
      { day: 6, amount: 28.4, merchant: "Chipotle", category: "Dining" },
      { day: 7, amount: 12.0, merchant: "Uber Eats", category: "Dining" },
      { day: 8, amount: 64.0, merchant: "Target", category: "Shopping" },
      { day: 9, amount: 9.5, merchant: "Starbucks", category: "Dining" },
      { day: 10, amount: 74.3, merchant: "Trader Joe's", category: "Groceries" },
      { day: 11, amount: 18.0, merchant: "Cinema Club", category: "Entertainment" },
      { day: 12, amount: 9.5, merchant: "Starbucks", category: "Dining" },
      { day: 13, amount: 22.0, merchant: "Uber Eats", category: "Dining" },
      { day: 14, amount: 55.0, merchant: "CVS Pharmacy", category: "Health" },
      { day: 15, amount: 120.0, merchant: "Amazon", category: "Shopping" },
      { day: 16, amount: 9.5, merchant: "Starbucks", category: "Dining" },
      { day: 17, amount: 35.0, merchant: "DoorDash", category: "Dining" },
      { day: 18, amount: 48.0, merchant: "Metro Transit", category: "Transport" },
    ],
    // last month (complete, higher spend)
    [
      { day: 1, amount: 1650, merchant: "Landlord LLC", category: "Rent" },
      { day: 2, amount: 125.0, merchant: "City Power", category: "Utilities" },
      { day: 3, amount: 15.99, merchant: "Netflix", category: "Subscriptions" },
      { day: 3, amount: 10.99, merchant: "Spotify", category: "Subscriptions" },
      { day: 4, amount: 14.99, merchant: "Disney+", category: "Subscriptions" },
      { day: 5, amount: 210.0, merchant: "Costco", category: "Groceries" },
      { day: 6, amount: 95.0, merchant: "Shell Gas", category: "Transport" },
      { day: 7, amount: 68.0, merchant: "Olive Garden", category: "Dining" },
      { day: 8, amount: 45.0, merchant: "Uber Eats", category: "Dining" },
      { day: 9, amount: 180.0, merchant: "Best Buy", category: "Shopping" },
      { day: 10, amount: 32.0, merchant: "Starbucks", category: "Dining" },
      { day: 12, amount: 88.0, merchant: "Whole Foods", category: "Groceries" },
      { day: 14, amount: 55.0, merchant: "DoorDash", category: "Dining" },
      { day: 15, amount: 140.0, merchant: "Amazon", category: "Shopping" },
      { day: 16, amount: 40.0, merchant: "AMC Theaters", category: "Entertainment" },
      { day: 18, amount: 75.0, merchant: "Uber", category: "Transport" },
      { day: 20, amount: 220.0, merchant: "Nike Store", category: "Shopping" },
      { day: 22, amount: 60.0, merchant: "CVS Pharmacy", category: "Health" },
      { day: 24, amount: 95.0, merchant: "Trader Joe's", category: "Groceries" },
      { day: 26, amount: 48.0, merchant: "Chipotle", category: "Dining" },
      { day: 28, amount: 35.0, merchant: "Starbucks", category: "Dining" },
    ],
    // 2 months ago
    [
      { day: 1, amount: 1650, merchant: "Landlord LLC", category: "Rent" },
      { day: 2, amount: 110.0, merchant: "City Power", category: "Utilities" },
      { day: 3, amount: 15.99, merchant: "Netflix", category: "Subscriptions" },
      { day: 3, amount: 10.99, merchant: "Spotify", category: "Subscriptions" },
      { day: 5, amount: 160.0, merchant: "Whole Foods", category: "Groceries" },
      { day: 7, amount: 70.0, merchant: "Shell Gas", category: "Transport" },
      { day: 9, amount: 55.0, merchant: "Dining Out", category: "Dining" },
      { day: 11, amount: 90.0, merchant: "Amazon", category: "Shopping" },
      { day: 13, amount: 25.0, merchant: "Starbucks", category: "Dining" },
      { day: 15, amount: 40.0, merchant: "Uber Eats", category: "Dining" },
      { day: 17, amount: 80.0, merchant: "Trader Joe's", category: "Groceries" },
      { day: 20, amount: 120.0, merchant: "H&M", category: "Shopping" },
      { day: 22, amount: 30.0, merchant: "Cinema Club", category: "Entertainment" },
      { day: 25, amount: 50.0, merchant: "Metro Transit", category: "Transport" },
      { day: 27, amount: 45.0, merchant: "CVS Pharmacy", category: "Health" },
    ],
    // 3 months ago
    [
      { day: 1, amount: 1650, merchant: "Landlord LLC", category: "Rent" },
      { day: 2, amount: 115.0, merchant: "City Power", category: "Utilities" },
      { day: 3, amount: 15.99, merchant: "Netflix", category: "Subscriptions" },
      { day: 3, amount: 10.99, merchant: "Spotify", category: "Subscriptions" },
      { day: 6, amount: 175.0, merchant: "Costco", category: "Groceries" },
      { day: 8, amount: 80.0, merchant: "Shell Gas", category: "Transport" },
      { day: 10, amount: 62.0, merchant: "Sushi Place", category: "Dining" },
      { day: 12, amount: 150.0, merchant: "Amazon", category: "Shopping" },
      { day: 14, amount: 28.0, merchant: "Starbucks", category: "Dining" },
      { day: 16, amount: 38.0, merchant: "DoorDash", category: "Dining" },
      { day: 19, amount: 70.0, merchant: "Whole Foods", category: "Groceries" },
      { day: 21, amount: 95.0, merchant: "Target", category: "Shopping" },
      { day: 24, amount: 55.0, merchant: "Bowling Alley", category: "Entertainment" },
      { day: 26, amount: 40.0, merchant: "Uber", category: "Transport" },
    ],
  ];

  const rows = [];
  const todayDay = now.getDate();
  for (let m = 0; m < monthPatterns.length; m++) {
    const monthDate = startOfMonth(subMonths(now, m));
    for (const s of monthPatterns[m]) {
      // Current month: only seed days that have already happened
      if (m === 0 && s.day > todayDay) continue;
      const date = setDate(monthDate, Math.min(s.day, 28));
      rows.push({
        date,
        amount: s.amount,
        merchant: s.merchant,
        note: s.note ?? null,
        categoryId: byName[s.category] ?? null,
        source: "manual" as const,
      });
    }
  }

  await prisma.transaction.createMany({ data: rows });

  // Merchant memory for common names
  const rules = [
    ["netflix", "Subscriptions"],
    ["spotify", "Subscriptions"],
    ["starbucks", "Dining"],
    ["uber eats", "Dining"],
    ["doordash", "Dining"],
    ["whole foods", "Groceries"],
    ["trader joe's", "Groceries"],
    ["landlord llc", "Rent"],
    ["city power", "Utilities"],
    ["amazon", "Shopping"],
  ] as const;

  for (const [merchant, cat] of rules) {
    if (!byName[cat]) continue;
    await prisma.merchantRule.upsert({
      where: { merchant },
      create: { merchant, categoryId: byName[cat] },
      update: { categoryId: byName[cat] },
    });
  }
}
