import { prisma } from "./db";
import { DEFAULT_CATEGORIES } from "./categories";
import { subMonths, setDate, startOfMonth } from "date-fns";

let seeding: Promise<void> | null = null;

export async function ensureSeeded() {
  if (seeding) return seeding;
  seeding = (async () => {
    const count = await prisma.category.count();
    if (count === 0) {
      await prisma.category.createMany({ data: DEFAULT_CATEGORIES });
    }

    await prisma.settings.upsert({
      where: { id: "default" },
      create: { id: "default", monthlyIncome: 5200 },
      update: {},
    });

    const txCount = await prisma.transaction.count();
    if (txCount === 0) {
      await seedSampleTransactions();
    }

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

async function seedSampleTransactions() {
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
