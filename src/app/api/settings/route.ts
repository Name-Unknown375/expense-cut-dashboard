import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { z } from "zod";

export async function GET() {
  await ensureSeeded();
  const [settings, categories, rules, share] = await Promise.all([
    prisma.settings.findUnique({ where: { id: "default" } }),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.spendingRule.findMany({ include: { category: true }, orderBy: { createdAt: "asc" } }),
    prisma.shareLink.findFirst({ where: { active: true }, orderBy: { createdAt: "desc" } }),
  ]);
  return NextResponse.json({ settings, categories, rules, share });
}

const patchSchema = z.object({
  monthlyIncome: z.number().nullable().optional(),
  baselineOverride: z.number().nullable().optional(),
});

export async function PATCH(request: Request) {
  await ensureSeeded();
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const settings = await prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", ...parsed.data },
    update: parsed.data,
  });
  return NextResponse.json({ settings });
}
