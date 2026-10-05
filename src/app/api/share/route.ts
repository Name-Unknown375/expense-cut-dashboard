import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { randomBytes } from "crypto";

export async function GET() {
  await ensureSeeded();
  const share = await prisma.shareLink.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ share });
}

export async function POST(request: Request) {
  await ensureSeeded();
  const body = await request.json().catch(() => ({}));
  const action = body.action as string;

  if (action === "revoke") {
    await prisma.shareLink.updateMany({
      where: { active: true },
      data: { active: false },
    });
    return NextResponse.json({ share: null });
  }

  // regenerate
  await prisma.shareLink.updateMany({
    where: { active: true },
    data: { active: false },
  });
  const token = randomBytes(24).toString("hex");
  const share = await prisma.shareLink.create({
    data: { token, active: true },
  });
  return NextResponse.json({ share });
}
