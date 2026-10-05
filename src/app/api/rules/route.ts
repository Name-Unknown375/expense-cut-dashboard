import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
  type: z.enum(["category_cap", "no_new_subs", "weekend_only"]),
  categoryId: z.string().optional().nullable(),
  limitAmount: z.number().optional().nullable(),
  active: z.boolean().optional(),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const rule = await prisma.spendingRule.create({ data: parsed.data });
  return NextResponse.json({ rule });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const rule = await prisma.spendingRule.update({
    where: { id },
    data: {
      ...(body.name ? { name: String(body.name) } : {}),
      ...(body.limitAmount !== undefined ? { limitAmount: body.limitAmount } : {}),
      ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
    },
  });
  return NextResponse.json({ rule });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.spendingRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
