import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import Papa from "papaparse";
import { z } from "zod";
import { format } from "date-fns";

const mappingSchema = z.object({
  date: z.string(),
  amount: z.string().optional(),
  debit: z.string().optional(),
  credit: z.string().optional(),
  description: z.string(),
  category: z.string().optional(),
  amountStyle: z.enum(["signed", "debit_credit"]).default("signed"),
});

export type Mapping = z.infer<typeof mappingSchema>;

function dedupeKey(date: Date, amount: number, merchant: string) {
  return `${format(date, "yyyy-MM-dd")}|${amount.toFixed(2)}|${merchant.trim().toLowerCase()}`;
}

export async function GET() {
  await ensureSeeded();
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const mapping = settings?.csvColumnMapping
    ? JSON.parse(settings.csvColumnMapping)
    : null;
  return NextResponse.json({ mapping });
}

async function importOneFile(
  file: File,
  mapping: Mapping,
  existingKeys: Set<string>,
  ruleMap: Map<string, string>,
  catByName: Map<string, string>
) {
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  let imported = 0;
  let skipped = 0;
  let duplicates = 0;
  const review: { id: string; merchant: string; amount: number; date: string }[] = [];
  const headers = parsed.meta.fields ?? [];

  for (const row of parsed.data) {
    const dateStr = row[mapping.date]?.trim();
    const merchant = (row[mapping.description] ?? "").trim();
    if (!dateStr || !merchant) {
      skipped += 1;
      continue;
    }

    let amount = 0;
    if (mapping.amountStyle === "debit_credit") {
      const debit =
        parseFloat(String(row[mapping.debit ?? ""] ?? "").replace(/[$,]/g, "")) || 0;
      const credit =
        parseFloat(String(row[mapping.credit ?? ""] ?? "").replace(/[$,]/g, "")) || 0;
      amount = debit > 0 ? debit : credit > 0 ? credit : 0;
      if (debit <= 0 && credit > 0) {
        skipped += 1;
        continue;
      }
    } else {
      const raw = parseFloat(String(row[mapping.amount ?? ""] ?? "").replace(/[$,]/g, ""));
      if (!Number.isFinite(raw) || raw === 0) {
        skipped += 1;
        continue;
      }
      amount = Math.abs(raw);
    }

    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      skipped += 1;
      continue;
    }

    const key = dedupeKey(date, amount, merchant);
    if (existingKeys.has(key)) {
      duplicates += 1;
      continue;
    }

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
    existingKeys.add(key);
    imported += 1;
    if (!categoryId) {
      review.push({
        id: tx.id,
        merchant: tx.merchant,
        amount: tx.amount,
        date: tx.date.toISOString(),
      });
    }
  }

  return {
    fileName: file.name,
    headers,
    imported,
    duplicates,
    skipped,
    rows: parsed.data.length,
    needsReview: review,
  };
}

export async function POST(request: Request) {
  await ensureSeeded();
  const form = await request.formData();
  const mappingRaw = form.get("mapping");
  if (typeof mappingRaw !== "string") {
    return NextResponse.json({ error: "mapping required" }, { status: 400 });
  }

  const mapping = mappingSchema.parse(JSON.parse(mappingRaw));
  await prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", csvColumnMapping: JSON.stringify(mapping) },
    update: { csvColumnMapping: JSON.stringify(mapping) },
  });

  const files: File[] = [];
  const multi = form.getAll("files");
  for (const f of multi) {
    if (f instanceof File && f.size > 0) files.push(f);
  }
  const single = form.get("file");
  if (files.length === 0 && single instanceof File) files.push(single);
  if (files.length === 0) {
    return NextResponse.json({ error: "file(s) required" }, { status: 400 });
  }

  const merchantRules = await prisma.merchantRule.findMany();
  const ruleMap = new Map(merchantRules.map((r) => [r.merchant, r.categoryId]));
  const categories = await prisma.category.findMany();
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  // Load existing keys for dedupe (recent + all is fine for personal apps)
  const existing = await prisma.transaction.findMany({
    select: { date: true, amount: true, merchant: true },
  });
  const existingKeys = new Set(
    existing.map((t) => dedupeKey(t.date, t.amount, t.merchant))
  );

  const results = [];
  for (const file of files) {
    const result = await importOneFile(file, mapping, existingKeys, ruleMap, catByName);
    results.push(result);
  }

  const totals = results.reduce(
    (acc, r) => ({
      imported: acc.imported + r.imported,
      duplicates: acc.duplicates + r.duplicates,
      skipped: acc.skipped + r.skipped,
      needsReview: acc.needsReview.concat(r.needsReview),
    }),
    {
      imported: 0,
      duplicates: 0,
      skipped: 0,
      needsReview: [] as { id: string; merchant: string; amount: number; date: string }[],
    }
  );

  return NextResponse.json({
    files: results,
    imported: totals.imported,
    duplicates: totals.duplicates,
    skipped: totals.skipped,
    needsReview: totals.needsReview,
  });
}
