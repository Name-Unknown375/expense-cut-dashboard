import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { EXAMPLE_IF_THEN, parseIfThen, type IfThenRule } from "@/lib/awareness";
import { merchantKey } from "@/lib/insights";

export const dynamic = "force-dynamic";

async function load() {
  await ensureSeeded();
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  if (!settings) return { rules: [] as IfThenRule[], seeded: false };
  if (settings.ifThenJson == null) {
    const rules = [EXAMPLE_IF_THEN];
    await prisma.settings.update({
      where: { id: "default" },
      data: { ifThenJson: JSON.stringify(rules) },
    });
    return { rules, seeded: true };
  }
  return { rules: parseIfThen(settings.ifThenJson), seeded: false };
}

export async function GET() {
  const { rules } = await load();
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  await ensureSeeded();
  const body = await request.json();
  const text = String(body.text || "").trim();
  const places = String(body.places || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!text || places.length === 0) {
    return NextResponse.json({ error: "Write the rule and the places it covers." }, { status: 400 });
  }
  const rule: IfThenRule = {
    id: String(body.id || merchantKey(text)).slice(0, 80),
    text,
    places,
    weekdaysOnly: body.weekdaysOnly !== false,
    capLabel: String(body.capLabel || "Eating out"),
    seeded: false,
  };
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const list = parseIfThen(settings?.ifThenJson).filter((row) => row.id !== rule.id && !row.seeded);
  list.push(rule);
  await prisma.settings.update({
    where: { id: "default" },
    data: { ifThenJson: JSON.stringify(list) },
  });
  return NextResponse.json({ rules: list });
}

export async function DELETE(request: Request) {
  await ensureSeeded();
  const id = new URL(request.url).searchParams.get("id");
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const list = parseIfThen(settings?.ifThenJson).filter((row) => row.id !== id);
  await prisma.settings.update({
    where: { id: "default" },
    data: { ifThenJson: JSON.stringify(list) },
  });
  return NextResponse.json({ rules: list });
}
