import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const updateSchema = z.object({
  date: z.string().optional(),
  amount: z.number().positive().optional(),
  merchant: z.string().min(1).optional(),
  note: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const tx = await prisma.transaction.update({
    where: { id: params.id },
    data: {
      ...(data.date ? { date: new Date(data.date) } : {}),
      ...(data.amount !== undefined ? { amount: data.amount } : {}),
      ...(data.merchant ? { merchant: data.merchant.trim() } : {}),
      ...(data.note !== undefined ? { note: data.note } : {}),
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId || null } : {}),
    },
    include: { category: true },
  });

  if (data.categoryId && tx.merchant) {
    await prisma.merchantRule.upsert({
      where: { merchant: tx.merchant.toLowerCase() },
      create: { merchant: tx.merchant.toLowerCase(), categoryId: data.categoryId },
      update: { categoryId: data.categoryId },
    });
  }

  return NextResponse.json({ transaction: tx });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  await prisma.transaction.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
