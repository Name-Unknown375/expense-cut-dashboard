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
  const before = other
    ? await prisma.transaction.count({ where: { categoryId: other.id } })
    : 0;

  const groups = await prisma.transaction.groupBy({ by: ["merchant", "categoryId"] });
  let heuristic = 0;
  for (const row of groups) {
    const guess = guessCategoryName(row.merchant);
    if (!guess) continue;
    const nextId = byName.get(guess.toLowerCase());
    if (!nextId || nextId === row.categoryId) continue;
    const updated = await prisma.transaction.updateMany({
      where: { merchant: row.merchant, categoryId: row.categoryId },
      data: { categoryId: nextId },
    });
    heuristic += updated.count;
    await rememberMerchant(prisma, row.merchant, nextId);
  }

  let ai = 0;
  if (other && geminiConfigured()) {
    const remaining = await prisma.transaction.findMany({
      where: { categoryId: other.id },
      select: { merchant: true },
      distinct: ["merchant"],
    });
    const names = categories.map((c) => c.name);
    const merchants = remaining.map((r) => r.merchant);
    for (let i = 0; i < merchants.length && i < 120; i += 30) {
      const batch = merchants.slice(i, i + 30);
      const map = await aiCategorizeMerchants(batch, names);
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
  }

  const after = other
    ? await prisma.transaction.count({ where: { categoryId: other.id } })
    : 0;
  const total = await prisma.transaction.count();
  return NextResponse.json({
    before,
    after,
    total,
    otherPct: total ? Math.round((after / total) * 1000) / 10 : 0,
    heuristic,
    ai,
  });
}
