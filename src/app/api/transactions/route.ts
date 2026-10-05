import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { z } from "zod";
import { periodFromSearchParams, resolvePeriod } from "@/lib/period";

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
  if (merchant) {
    where.merchant = { contains: merchant };
  }
  if (q) {
    where.OR = [{ merchant: { contains: q } }, { note: { contains: q } }];
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true },
    orderBy: { date: "desc" },
    take: 500,
  });
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
  const tx = await prisma.transaction.create({
    data: {
      date: new Date(data.date),
      amount: data.amount,
      merchant: data.merchant.trim(),
      note: data.note ?? null,
      categoryId: data.categoryId || null,
      source: "manual",
    },
    include: { category: true },
  });

  if (data.categoryId) {
    await prisma.merchantRule.upsert({
      where: { merchant: data.merchant.trim().toLowerCase() },
      create: {
        merchant: data.merchant.trim().toLowerCase(),
        categoryId: data.categoryId,
      },
      update: { categoryId: data.categoryId },
    });
  }

  return NextResponse.json({ transaction: tx });
}
