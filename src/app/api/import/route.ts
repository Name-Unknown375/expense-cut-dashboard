import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import Papa from "papaparse";
import { z } from "zod";

const mappingSchema = z.object({
  date: z.string(),
  amount: z.string().optional(),
  debit: z.string().optional(),
  credit: z.string().optional(),
  description: z.string(),
  category: z.string().optional(),
  amountStyle: z.enum(["signed", "debit_credit"]).default("signed"),
});

export async function GET() {
  await ensureSeeded();
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const mapping = settings?.csvColumnMapping
    ? JSON.parse(settings.csvColumnMapping)
    : null;
  return NextResponse.json({ mapping });
}

export async function POST(request: Request) {
  await ensureSeeded();
  const form = await request.formData();
  const file = form.get("file");
  const mappingRaw = form.get("mapping");
  if (!(file instanceof File) || typeof mappingRaw !== "string") {
    return NextResponse.json({ error: "file and mapping required" }, { status: 400 });
  }

  const mapping = mappingSchema.parse(JSON.parse(mappingRaw));
  await prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", csvColumnMapping: JSON.stringify(mapping) },
    update: { csvColumnMapping: JSON.stringify(mapping) },
  });

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const merchantRules = await prisma.merchantRule.findMany();
  const ruleMap = new Map(merchantRules.map((r) => [r.merchant, r.categoryId]));
  const categories = await prisma.category.findMany();
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  const created = [];
  const review: { id: string; merchant: string; amount: number; date: string }[] = [];

  for (const row of parsed.data) {
    const dateStr = row[mapping.date]?.trim();
    const merchant = (row[mapping.description] ?? "").trim();
    if (!dateStr || !merchant) continue;

    let amount = 0;
    if (mapping.amountStyle === "debit_credit") {
      const debit = parseFloat(String(row[mapping.debit ?? ""] ?? "").replace(/[$,]/g, "")) || 0;
      const credit = parseFloat(String(row[mapping.credit ?? ""] ?? "").replace(/[$,]/g, "")) || 0;
      amount = debit > 0 ? debit : credit > 0 ? credit : 0;
      // Credits (income/refunds) skipped for spend tracking in v1 if only credit
      if (debit <= 0 && credit > 0) continue;
    } else {
      const raw = parseFloat(String(row[mapping.amount ?? ""] ?? "").replace(/[$,]/g, ""));
      if (!Number.isFinite(raw) || raw === 0) continue;
      // Treat negative as spend (common bank export), positive spend also ok
      amount = Math.abs(raw);
      // If positive and looks like income-only row without debit semantics, still count as spend
    }

    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) continue;

    let categoryId: string | null = null;
    if (mapping.category && row[mapping.category]) {
      categoryId = catByName.get(row[mapping.category].trim().toLowerCase()) ?? null;
    }
    if (!categoryId) {
      categoryId = ruleMap.get(merchant.toLowerCase()) ?? null;
    }

    const tx = await prisma.transaction.create({
      data: {
        date,
        amount,
        merchant,
        categoryId,
        source: "csv",
      },
    });
    created.push(tx);
    if (!categoryId) {
      review.push({
        id: tx.id,
        merchant: tx.merchant,
        amount: tx.amount,
        date: tx.date.toISOString(),
      });
    }
  }

  return NextResponse.json({
    imported: created.length,
    needsReview: review,
  });
}
