import { Nav } from "@/components/Nav";
import { CategoryInsightView } from "@/components/CategoryInsightView";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { periodFromSearchParams, resolvePeriod } from "@/lib/period";
import { buildCategoryInsight } from "@/lib/insights";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    period?: string;
    month?: string;
    year?: string;
    from?: string;
    to?: string;
  };
}) {
  await ensureSeeded();
  const period = resolvePeriod(periodFromSearchParams(searchParams));
  const qs = new URLSearchParams(period.query).toString();

  if (params.id !== "uncategorized") {
    const cat = await prisma.category.findUnique({ where: { id: params.id } });
    if (!cat) notFound();
  }

  const tx = await prisma.transaction.findMany({
    where: { date: { gte: period.start, lte: period.end } },
    include: { category: true },
    orderBy: { date: "desc" },
  });

  const insight = buildCategoryInsight(tx, params.id, period.label);
  if (!insight) {
    return (
      <>
        <Nav />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <Link href={`/?${qs}`} className="text-sm text-[var(--accent)] hover:underline">
            ← Back to dashboard
          </Link>
          <h1 className="font-display mt-4 text-3xl text-[var(--ink)]">No spend here</h1>
          <p className="mt-2 text-[var(--muted)]">
            Nothing in this category for {period.label}.
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav />
      <CategoryInsightView insight={insight} periodQuery={qs} />
    </>
  );
}
