import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { parseCuts, type CutMark } from "@/lib/awareness";
import { merchantKey, shortMerchant } from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  return NextResponse.json({ cuts: parseCuts(settings?.cutsJson) });
}

export async function POST(request: Request) {
  await ensureSeeded();
  const body = await request.json();
  const label = String(body.label || "").trim();
  if (!label) return NextResponse.json({ error: "Name the cut." }, { status: 400 });
  const key = merchantKey(label);
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const list = parseCuts(settings?.cutsJson).filter((cut) => cut.merchantKey !== key);
  const cut: CutMark = {
    id: key,
    merchantKey: key,
    label: shortMerchant(label),
    off: body.off !== false,
  };
  if (cut.off) list.push(cut);
  await prisma.settings.update({
    where: { id: "default" },
    data: { cutsJson: JSON.stringify(list) },
  });
  return NextResponse.json({ cuts: list });
}
