import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { merchantKey } from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureSeeded();
  const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  const rules = await prisma.merchantRule.findMany({
    include: { category: true },
    orderBy: { merchant: "asc" },
    take: 400,
  });
  const filtered = q ? rules.filter((r) => r.merchant.includes(q)) : rules.slice(0, 40);
  return NextResponse.json({
    rules: filtered.map((r) => ({
      id: r.id,
      merchant: r.merchant,
      categoryId: r.categoryId,
      category: r.category.name,
    })),
  });
}

export async function PATCH(request: Request) {
  await ensureSeeded();
  const body = await request.json();
  const rule = await prisma.merchantRule.findUnique({ where: { id: String(body.id) } });
  if (!rule) return NextResponse.json({ error: "not found" }, { status: 404 });
  const categoryId = String(body.categoryId || "");
  if (!categoryId) return NextResponse.json({ error: "categoryId required" }, { status: 400 });
  await prisma.merchantRule.update({ where: { id: rule.id }, data: { categoryId } });
  if (body.applyAll) {
    const key = merchantKey(rule.merchant);
    const txs = await prisma.transaction.findMany({ select: { id: true, merchant: true } });
    const ids = txs.filter((t) => merchantKey(t.merchant) === key).map((t) => t.id);
    if (ids.length) {
      await prisma.transaction.updateMany({
        where: { id: { in: ids } },
        data: { categoryId },
      });
    }
    return NextResponse.json({ ok: true, updated: ids.length });
  }
  return NextResponse.json({ ok: true, updated: 0 });
}

export async function DELETE(request: Request) {
  await ensureSeeded();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.merchantRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
