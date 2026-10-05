import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { periodFromSearchParams, resolvePeriod } from "@/lib/period";
import { buildCategoryInsight } from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const categoryId = searchParams.get("categoryId");
  if (!categoryId) {
    return NextResponse.json({ error: "categoryId required" }, { status: 400 });
  }

  const period = resolvePeriod(
    periodFromSearchParams({
      period: searchParams.get("period") ?? undefined,
      month: searchParams.get("month") ?? undefined,
      year: searchParams.get("year") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    })
  );

  const tx = await prisma.transaction.findMany({
    where: { date: { gte: period.start, lte: period.end } },
    include: { category: true },
    orderBy: { date: "desc" },
  });

  const insight = buildCategoryInsight(tx, categoryId, period.label);
  if (!insight) {
    return NextResponse.json({ error: "No spend in this category for the period" }, { status: 404 });
  }

  return NextResponse.json({
    insight,
    period: {
      mode: period.mode,
      label: period.label,
      query: period.query,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
  });
}
