import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { z } from "zod";

export async function GET() {
  await ensureSeeded();
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json({ categories });
}

const schema = z.object({
  name: z.string().min(1),
  bucket: z.enum(["Needs", "Wants", "Fixed"]),
  color: z.string().optional(),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const max = await prisma.category.aggregate({ _max: { sortOrder: true } });
  const category = await prisma.category.create({
    data: {
      name: parsed.data.name,
      bucket: parsed.data.bucket,
      color: parsed.data.color ?? "#64748b",
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  return NextResponse.json({ category });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const category = await prisma.category.update({
    where: { id },
    data: {
      ...(body.name ? { name: String(body.name) } : {}),
      ...(body.bucket ? { bucket: String(body.bucket) } : {}),
      ...(body.color ? { color: String(body.color) } : {}),
    },
  });
  return NextResponse.json({ category });
}
