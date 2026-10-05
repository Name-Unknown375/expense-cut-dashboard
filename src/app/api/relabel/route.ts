import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { guessCategoryName, rememberMerchant } from "@/lib/autocat";
import { aiCategorizeMerchants, geminiConfigured } from "@/lib/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  await ensureSeeded();
  const categories = await prisma.category.findMany();
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const other = categories.find((c) => c.name === "Other");
  if (!other) return NextResponse.json({ error: "Other category missing" }, { status: 500 });

  const before = await prisma.transaction.count({ where: { categoryId: other.id } });
  const total = await prisma.transaction.count();
  const rows = await prisma.transaction.findMany({
    where: { categoryId: other.id },
    select: { merchant: true },
    distinct: ["merchant"],
  });

  const buckets = new Map<string, string[]>();
  const unknown: string[] = [];
  for (const row of rows) {
    const guess = guessCategoryName(row.merchant);
    const id = guess ? byName.get(guess.toLowerCase()) : undefined;
    if (!id || id === other.id) {
      unknown.push(row.merchant);
      continue;
    }
    const list = buckets.get(id) ?? [];
    list.push(row.merchant);
    buckets.set(id, list);
  }

  let heuristic = 0;
  for (const [categoryId, merchants] of Array.from(buckets.entries())) {
    const updated = await prisma.transaction.updateMany({
      where: { categoryId: other.id, merchant: { in: merchants } },
      data: { categoryId },
    });
    heuristic += updated.count;
    const name = categories.find((c) => c.id === categoryId)?.name;
    if (name) {
      for (const merchant of merchants.slice(0, 30)) {
        await rememberMerchant(prisma, merchant, categoryId);
      }
    }
  }

  let ai = 0;
  if (geminiConfigured() && unknown.length) {
    const batch = unknown.slice(0, 25);
    const map = await Promise.race([
      aiCategorizeMerchants(batch, categories.map((c) => c.name)),
      new Promise<Map<string, string>>((resolve) => setTimeout(() => resolve(new Map()), 12_000)),
    ]);
    for (const merchant of batch) {
      const cat = map.get(merchant.trim().toLowerCase());
      const id = cat ? byName.get(cat.toLowerCase()) : undefined;
      if (!id || id === other.id) continue;
      const updated = await prisma.transaction.updateMany({
        where: { merchant, categoryId: other.id },
        data: { categoryId: id },
      });
      ai += updated.count;
      await rememberMerchant(prisma, merchant, id);
    }
  }

  const after = await prisma.transaction.count({ where: { categoryId: other.id } });
  return NextResponse.json({
    before,
    after,
    total,
    otherPct: total ? Math.round((after / total) * 1000) / 10 : 0,
    heuristic,
    ai,
    remainingUnknown: Math.max(0, unknown.length - 25),
  });
}
