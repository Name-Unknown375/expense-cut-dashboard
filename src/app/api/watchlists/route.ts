import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { merchantKey, shortMerchant } from "@/lib/insights";

export const dynamic = "force-dynamic";

type Watch = { id: string; merchantKey: string; label: string; capAmount: number };

function parse(raw: string | null | undefined): Watch[] {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function GET() {
  await ensureSeeded();
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  return NextResponse.json({ watchlists: parse(settings?.watchlistsJson) });
}

export async function POST(request: Request) {
  await ensureSeeded();
  const body = await request.json();
  const label = String(body.label || "").trim();
  const capAmount = Number(body.capAmount);
  if (!label || !Number.isFinite(capAmount) || capAmount <= 0) {
    return NextResponse.json({ error: "label and cap required" }, { status: 400 });
  }
  const key = merchantKey(label);
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const list = parse(settings?.watchlistsJson).filter((w) => w.merchantKey !== key);
  list.push({ id: key, merchantKey: key, label: shortMerchant(label), capAmount });
  await prisma.settings.update({
    where: { id: "default" },
    data: { watchlistsJson: JSON.stringify(list) },
  });
  return NextResponse.json({ watchlists: list });
}

export async function DELETE(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const list = parse(settings?.watchlistsJson).filter((w) => w.id !== id);
  await prisma.settings.update({
    where: { id: "default" },
    data: { watchlistsJson: JSON.stringify(list) },
  });
  return NextResponse.json({ watchlists: list });
}
