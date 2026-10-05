import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { weekStartKey } from "@/lib/dates";

export async function GET() {
  await ensureSeeded();
  const weekStart = weekStartKey();
  const weekly = await prisma.weeklyReview.upsert({
    where: { weekStart },
    create: { weekStart },
    update: {},
  });
  return NextResponse.json({ weekly });
}

export async function PATCH(request: Request) {
  await ensureSeeded();
  const body = await request.json();
  const weekStart = String(body.weekStart ?? weekStartKey());
  const weekly = await prisma.weeklyReview.upsert({
    where: { weekStart },
    create: {
      weekStart,
      importDone: Boolean(body.importDone),
      cutDone: Boolean(body.cutDone),
      paceDone: Boolean(body.paceDone),
      notes: body.notes ?? null,
    },
    update: {
      ...(body.importDone !== undefined ? { importDone: Boolean(body.importDone) } : {}),
      ...(body.cutDone !== undefined ? { cutDone: Boolean(body.cutDone) } : {}),
      ...(body.paceDone !== undefined ? { paceDone: Boolean(body.paceDone) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  });
  return NextResponse.json({ weekly });
}
