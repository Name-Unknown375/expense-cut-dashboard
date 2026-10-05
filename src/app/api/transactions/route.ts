import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { z } from "zod";

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
  const month = searchParams.get("month");
  const categoryId = searchParams.get("categoryId");
  const q = searchParams.get("q");

  const where: Record<string, unknown> = {};
  if (month) {
    const start = new Date(`${month}-01T00:00:00`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    end.setMilliseconds(-1);
    where.date = { gte: start, lte: end };
  }
  if (categoryId) {
    if (categoryId === "uncategorized") where.categoryId = null;
    else where.categoryId = categoryId;
  }
  if (q) {
    where.OR = [
      { merchant: { contains: q } },
      { note: { contains: q } },
    ];
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
