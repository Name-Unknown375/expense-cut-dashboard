import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { getDashboardData } from "@/lib/analytics";
import { aiDeepenInsights, geminiConfigured } from "@/lib/gemini";
import { periodFromSearchParams } from "@/lib/period";

export const dynamic = "force-dynamic";

type CachePayload = {
  key: string;
  headline: string;
  brief: string;
  bullets: string[];
  nextAction: string;
  at: string;
};

export async function GET(request: Request) {
  await ensureSeeded();

  if (!geminiConfigured()) {
    return NextResponse.json({
      enabled: false,
      error: "GEMINI_API_KEY not configured",
    });
  }

  const { searchParams } = new URL(request.url);
  const spec = periodFromSearchParams({
    period: searchParams.get("period") ?? undefined,
    month: searchParams.get("month") ?? undefined,
    year: searchParams.get("year") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });
  const data = await getDashboardData(spec);
  const cacheKey = `ai:${data.period.mode}:${data.period.start}:${data.period.end}:${Math.round(data.spentThisPeriod)}`;

  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  if (settings?.aiCacheJson) {
    try {
      const cached = JSON.parse(settings.aiCacheJson) as CachePayload;
      if (cached.key === cacheKey && cached.brief) {
        return NextResponse.json({ enabled: true, cached: true, insight: cached });
      }
    } catch {
      /* ignore bad cache */
    }
  }

  const insight = await aiDeepenInsights({
    periodLabel: data.period.label,
    spent: data.spentThisPeriod,
    target: data.target,
    nextAction: data.disposition.nextAction,
    rows: data.disposition.rows.map((r) => ({
      what: r.what,
      amount: r.amount,
      verdict: r.verdict,
    })),
    taps: data.taps.lines.map((t) => ({
      merchant: t.merchant,
      phrase: t.phrase,
      amount: t.amount,
    })),
  });

  if (!insight) {
    return NextResponse.json({
      enabled: true,
      error: "Gemini unavailable right now",
    }, { status: 503 });
  }

  const payload: CachePayload = {
    key: cacheKey,
    ...insight,
    at: new Date().toISOString(),
  };

  await prisma.settings.update({
    where: { id: "default" },
    data: { aiCacheJson: JSON.stringify(payload) },
  });

  return NextResponse.json({ enabled: true, cached: false, insight: payload });
}
