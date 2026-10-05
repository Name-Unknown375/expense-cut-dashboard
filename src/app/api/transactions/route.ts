import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { rememberMerchant, resolveCategoryId } from "@/lib/autocat";
import { aiCategorizeMerchants, geminiConfigured } from "@/lib/gemini";
import { z } from "zod";
import { periodFromSearchParams, resolvePeriod } from "@/lib/period";
import { merchantKey } from "@/lib/insights";

const createSchema = z.object({
  date: z.string(),
  amount: z.number().positive(),
  merchant: z.string().min(1),
  note: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
});

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get("categoryId");
  const merchant = searchParams.get("merchant");
  const q = searchParams.get("q");

  const hasPeriod =
    searchParams.get("period") ||
    searchParams.get("from") ||
    searchParams.get("to") ||
    searchParams.get("year") ||
    searchParams.get("month");

  const where: Record<string, unknown> = {};
  if (hasPeriod) {
    const period = resolvePeriod(
      periodFromSearchParams({
        period: searchParams.get("period") ?? undefined,
        month: searchParams.get("month") ?? undefined,
        year: searchParams.get("year") ?? undefined,
        from: searchParams.get("from") ?? undefined,
        to: searchParams.get("to") ?? undefined,
      })
    );
    where.date = { gte: period.start, lte: period.end };
  }

  if (categoryId) {
    if (categoryId === "uncategorized") where.categoryId = null;
    else where.categoryId = categoryId;
  }
  const merchantFilter = merchant;
  if (q) {
    where.OR = [{ merchant: { contains: q } }, { note: { contains: q } }];
  }

  let transactions = await prisma.transaction.findMany({
    where,
    include: { category: true },
    orderBy: { date: "desc" },
    take: merchantFilter ? 2000 : 500,
  });
  if (merchantFilter) {
    const key = merchantKey(merchantFilter);
    const needle = merchantFilter.toLowerCase();
    transactions = transactions
      .filter(
        (t) => merchantKey(t.merchant) === key || t.merchant.toLowerCase().includes(needle)
      )
      .slice(0, 500);
  }
  return NextResponse.json({ transactions });
}

export async function POST(request: Request) {
  await ensureSeeded();
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const merchant = data.merchant.trim();

  let categoryId = data.categoryId || null;
  if (!categoryId) {
    const [merchantRules, categories] = await Promise.all([
      prisma.merchantRule.findMany(),
      prisma.category.findMany(),
    ]);
    const ruleMap = new Map(merchantRules.map((r) => [r.merchant, r.categoryId]));
    const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    const resolved = resolveCategoryId(merchant, { ruleMap, catByName });
    categoryId = resolved.categoryId;

    if (
      geminiConfigured() &&
      (resolved.source === "other" || resolved.source === "none")
    ) {
      const aiMap = await aiCategorizeMerchants(
        [merchant],
        categories.map((c) => c.name)
      );
      const catName = aiMap.get(merchant.toLowerCase());
      const aiId = catName ? catByName.get(catName.toLowerCase()) : null;
      if (aiId) categoryId = aiId;
    }

    if (categoryId) {
      await rememberMerchant(prisma, merchant, categoryId);
    }
  } else {
    await rememberMerchant(prisma, merchant, categoryId);
  }

  const tx = await prisma.transaction.create({
    data: {
      date: new Date(data.date),
      amount: data.amount,
      merchant,
      note: data.note ?? null,
      categoryId,
      source: "manual",
    },
    include: { category: true },
  });

  return NextResponse.json({ transaction: tx });
}
