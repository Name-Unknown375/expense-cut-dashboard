import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { rememberMerchant, resolveCategoryId } from "@/lib/autocat";
import { aiCategorizeMerchants, geminiConfigured } from "@/lib/gemini";
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
  /** When true, CSV has no header row; fields are col_0, col_1, … */
  headerless: z.boolean().optional().default(false),
});

export type Mapping = z.infer<typeof mappingSchema>;

function dedupeKey(date: Date, amount: number, merchant: string) {
  return `${format(date, "yyyy-MM-dd")}|${amount.toFixed(2)}|${merchant.trim().toLowerCase()}`;
}

function colIndex(key: string | undefined): number {
  if (!key) return -1;
  const m = /^col_(\d+)$/.exec(key);
  return m ? parseInt(m[1], 10) : -1;
}

function rowsAsRecords(
  text: string,
  mapping: Mapping
): { rows: Record<string, string>[]; headers: string[] } {
  if (mapping.headerless) {
    const parsed = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: true,
    });
    const maxCols = Math.max(0, ...parsed.data.map((r) => r.length));
    const headers = Array.from({ length: maxCols }, (_, i) => `col_${i}`);
    const rows = parsed.data.map((arr) => {
      const rec: Record<string, string> = {};
      for (let i = 0; i < maxCols; i++) rec[`col_${i}`] = String(arr[i] ?? "").trim();
      return rec;
    });
    return { rows, headers };
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return {
    rows: parsed.data.map((r) => {
      const rec: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) rec[k] = String(v ?? "").trim();
      return rec;
    }),
    headers: parsed.meta.fields ?? [],
  };
}

export async function GET() {
  await ensureSeeded();
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const mapping = settings?.csvColumnMapping
    ? JSON.parse(settings.csvColumnMapping)
    : null;
  return NextResponse.json({ mapping, aiEnabled: geminiConfigured() });
}

type PendingRow = {
  date: Date;
  amount: number;
  merchant: string;
  categoryId: string | null;
  source: "csv" | "memory" | "heuristic" | "other" | "none" | "ai";
};

async function parseFileRows(
  file: File,
  mapping: Mapping,
  existingKeys: Set<string>,
  ruleMap: Map<string, string>,
  catByName: Map<string, string>
) {
  const text = await file.text();
  const { rows, headers } = rowsAsRecords(text, mapping);

  let skipped = 0;
  let duplicates = 0;
  const pending: PendingRow[] = [];

  // Validate headerless keys reference real columns when possible
  if (mapping.headerless) {
    for (const key of [mapping.date, mapping.description, mapping.amount, mapping.debit, mapping.credit]) {
      if (key && colIndex(key) < 0) {
        /* non col_* keys ignored — rowsAsRecords only exposes col_N */
      }
    }
  }

  for (const row of rows) {
    const dateStr = (row[mapping.date] ?? "").trim();
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
    // Reserve key so later files in the same batch also dedupe
    existingKeys.add(key);

    const csvCategory =
      mapping.category && row[mapping.category] ? row[mapping.category].trim() : null;
    const resolved = resolveCategoryId(merchant, {
      ruleMap,
      catByName,
      csvCategory,
    });

    pending.push({
      date,
      amount,
      merchant,
      categoryId: resolved.categoryId,
      source: resolved.source,
    });
  }

  return {
    fileName: file.name,
    headers,
    skipped,
    duplicates,
    rows: rows.length,
    pending,
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
    update: { csvColumnMapping: JSON.stringify(mapping), aiCacheJson: null },
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
  const categoryNames = categories.map((c) => c.name);

  const existing = await prisma.transaction.findMany({
    select: { date: true, amount: true, merchant: true },
  });
  const existingKeys = new Set(
    existing.map((t) => dedupeKey(t.date, t.amount, t.merchant))
  );

  const parsedFiles = [];
  for (const file of files) {
    parsedFiles.push(await parseFileRows(file, mapping, existingKeys, ruleMap, catByName));
  }

  // AI pass for merchants that only hit Other / none
  const needsAi = new Set<string>();
  for (const f of parsedFiles) {
    for (const row of f.pending) {
      if (row.source === "other" || row.source === "none") {
        needsAi.add(row.merchant);
      }
    }
  }

  let aiLabeled = 0;
  if (needsAi.size > 0 && geminiConfigured()) {
    const aiMap = await aiCategorizeMerchants(Array.from(needsAi), categoryNames);
    for (const f of parsedFiles) {
      for (const row of f.pending) {
        if (row.source !== "other" && row.source !== "none") continue;
        const catName = aiMap.get(row.merchant.trim().toLowerCase());
        if (!catName) continue;
        const id = catByName.get(catName.toLowerCase());
        if (!id) continue;
        row.categoryId = id;
        row.source = "ai";
        aiLabeled += 1;
        await rememberMerchant(prisma, row.merchant, id);
        ruleMap.set(row.merchant.trim().toLowerCase(), id);
      }
    }
  }

  const results = [];
  let totalImported = 0;
  let totalDup = 0;
  let totalSkip = 0;
  let totalAuto = 0;

  for (const f of parsedFiles) {
    let imported = 0;
    let autoCategorized = 0;
    for (const row of f.pending) {
      await prisma.transaction.create({
        data: {
          date: row.date,
          amount: row.amount,
          merchant: row.merchant,
          categoryId: row.categoryId,
          source: "csv",
        },
      });
      imported += 1;
      if (row.categoryId) autoCategorized += 1;
      if (row.source === "csv" || row.source === "heuristic") {
        await rememberMerchant(prisma, row.merchant, row.categoryId!);
        ruleMap.set(row.merchant.trim().toLowerCase(), row.categoryId!);
      }
    }
    results.push({
      fileName: f.fileName,
      headers: f.headers,
      imported,
      duplicates: f.duplicates,
      skipped: f.skipped,
      rows: f.rows,
      autoCategorized,
    });
    totalImported += imported;
    totalDup += f.duplicates;
    totalSkip += f.skipped;
    totalAuto += autoCategorized;
  }

  return NextResponse.json({
    files: results,
    imported: totalImported,
    duplicates: totalDup,
    skipped: totalSkip,
    autoCategorized: totalAuto,
    aiLabeled,
    aiEnabled: geminiConfigured(),
  });
}
