import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";
import { rememberMerchant, resolveCategoryId } from "@/lib/autocat";
import { aiCategorizeMerchants, geminiConfigured } from "@/lib/gemini";
import {
  colIndex,
  dedupeKey,
  normalizeMerchant,
  parseBankDate,
} from "@/lib/csv-mapping";
import Papa from "papaparse";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const mappingSchema = z.object({
  date: z.string().min(1),
  amount: z.string().optional().nullable(),
  debit: z.string().optional().nullable(),
  credit: z.string().optional().nullable(),
  description: z.string().min(1),
  category: z.string().optional().nullable(),
  amountStyle: z.enum(["signed", "debit_credit"]).default("signed"),
  headerless: z.boolean().optional().default(false),
});

type Mapping = z.infer<typeof mappingSchema>;

function parseMoney(raw: string | undefined): number {
  if (raw == null || !String(raw).trim()) return 0;
  const n = parseFloat(String(raw).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function rowsAsRecords(
  text: string,
  mapping: Mapping
): { rows: Record<string, string>[]; headers: string[] } {
  if (mapping.headerless) {
    const parsed = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: "greedy",
    });
    const maxCols = Math.max(0, ...parsed.data.map((r) => (Array.isArray(r) ? r.length : 0)));
    const headers = Array.from({ length: maxCols }, (_, i) => `col_${i}`);
    const rows = parsed.data
      .filter((arr) => Array.isArray(arr) && arr.some((c) => String(c ?? "").trim()))
      .map((arr) => {
        const rec: Record<string, string> = {};
        for (let i = 0; i < maxCols; i++) rec[`col_${i}`] = String(arr[i] ?? "").trim();
        return rec;
      });
    return { rows, headers };
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
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

function validateMapping(mapping: Mapping): string | null {
  if (mapping.headerless) {
    for (const key of [mapping.date, mapping.description]) {
      if (colIndex(key) < 0) {
        return `Headerless mapping needs col_N keys (got date=${mapping.date}, description=${mapping.description})`;
      }
    }
  }
  if (mapping.amountStyle === "signed") {
    if (!mapping.amount) return "Amount column required for single-amount style";
  } else if (!mapping.debit && !mapping.credit) {
    return "Debit or credit column required for debit/credit style";
  }
  return null;
}

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

  for (const row of rows) {
    const dateStr = (row[mapping.date] ?? "").trim();
    const merchant = (row[mapping.description] ?? "").trim();
    if (!dateStr || !merchant) {
      skipped += 1;
      continue;
    }

    let amount = 0;
    if (mapping.amountStyle === "debit_credit") {
      const debit = parseMoney(row[mapping.debit ?? ""]);
      const credit = parseMoney(row[mapping.credit ?? ""]);
      // Expense tracker: import debits (spend). Skip pure credits (payments/refunds).
      if (debit > 0) amount = debit;
      else if (credit > 0) {
        skipped += 1;
        continue;
      } else {
        skipped += 1;
        continue;
      }
    } else {
      const raw = parseMoney(row[mapping.amount ?? ""]);
      if (!raw) {
        skipped += 1;
        continue;
      }
      amount = Math.abs(raw);
    }

    const date = parseBankDate(dateStr);
    if (!date) {
      skipped += 1;
      continue;
    }

    const key = dedupeKey(date, amount, merchant);
    if (existingKeys.has(key)) {
      duplicates += 1;
      continue;
    }
    // Reserve so later files / rows in this batch also dedupe
    existingKeys.add(key);

    const csvCategory =
      mapping.category && row[mapping.category]
        ? row[mapping.category].trim()
        : null;
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
  try {
    await ensureSeeded();
    const form = await request.formData();
    const mappingRaw = form.get("mapping");
    if (typeof mappingRaw !== "string") {
      return NextResponse.json({ error: "mapping required" }, { status: 400 });
    }

    let mapping: Mapping;
    try {
      mapping = mappingSchema.parse(JSON.parse(mappingRaw));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid mapping JSON";
      return NextResponse.json({ error: `Invalid mapping: ${msg}` }, { status: 400 });
    }

    const mappingError = validateMapping(mapping);
    if (mappingError) {
      return NextResponse.json({ error: mappingError }, { status: 400 });
    }

    // Persist mapping for next time (append-only imports — never wipe transactions)
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

    // Load ALL existing keys for strong cross-import dedupe (append-only)
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

    // AI pass — best-effort, capped so large CSVs don't time out the whole import
    const needsAi = new Set<string>();
    for (const f of parsedFiles) {
      for (const row of f.pending) {
        if (row.source === "other" || row.source === "none") needsAi.add(row.merchant);
      }
    }

    let aiLabeled = 0;
    let aiWarning: string | undefined;
    if (needsAi.size > 0 && geminiConfigured()) {
      const pending = Array.from(needsAi);
      const labeled = new Map<string, string>();
      const batches = Math.min(4, Math.ceil(pending.length / 30));
      for (let i = 0; i < batches; i++) {
        const batch = pending.slice(i * 30, i * 30 + 30);
        if (!batch.length) break;
        try {
          const aiMap = await Promise.race([
            aiCategorizeMerchants(batch, categoryNames),
            new Promise<Map<string, string>>((resolve) => setTimeout(() => resolve(new Map()), 15_000)),
          ]);
          aiMap.forEach((cat, merchant) => labeled.set(merchant, cat));
          if (aiMap.size === 0) {
            aiWarning = "Gemini categorization timed out — rows kept with heuristic/Other labels.";
            break;
          }
        } catch {
          aiWarning = "Gemini categorization timed out — rows kept with heuristic/Other labels.";
          break;
        }
      }
      for (const f of parsedFiles) {
        for (const row of f.pending) {
          if (row.source !== "other" && row.source !== "none") continue;
          const catName = labeled.get(row.merchant.trim().toLowerCase());
          const id = catName ? catByName.get(catName.toLowerCase()) : null;
          if (!id) continue;
          row.categoryId = id;
          row.source = "ai";
          aiLabeled += 1;
          await rememberMerchant(prisma, row.merchant, id);
          ruleMap.set(normalizeMerchant(row.merchant), id);
        }
      }
      if (pending.length > batches * 30) {
        aiWarning = `Labeled ${Math.min(pending.length, batches * 30)} of ${pending.length} unknown merchants. Use Settings → Re-label spend for the rest.`;
      }
    }

    const results = [];
    let totalImported = 0;
    let totalDup = 0;
    let totalSkip = 0;
    let totalAuto = 0;

    for (const f of parsedFiles) {
      // Batch insert — append only; never delete/overwrite existing txs
      const chunkSize = 50;
      for (let i = 0; i < f.pending.length; i += chunkSize) {
        const chunk = f.pending.slice(i, i + chunkSize);
        await prisma.transaction.createMany({
          data: chunk.map((row) => ({
            date: row.date,
            amount: row.amount,
            merchant: row.merchant,
            categoryId: row.categoryId,
            source: "csv",
          })),
        });
      }

      // Remember merchants for future imports (non-fatal)
      for (const row of f.pending) {
        if (!row.categoryId) continue;
        if (row.source === "csv" || row.source === "heuristic" || row.source === "ai") {
          try {
            await rememberMerchant(prisma, row.merchant, row.categoryId);
          } catch {
            /* ignore */
          }
        }
      }

      const imported = f.pending.length;
      const autoCategorized = f.pending.filter((r) => r.categoryId).length;
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

    const other = await prisma.category.findUnique({ where: { name: "Other" } });
    const otherLeft = other
      ? await prisma.transaction.count({ where: { categoryId: other.id } })
      : 0;
    const sampleOther = Array.from(needsAi).slice(0, 8);
    return NextResponse.json({
      files: results,
      imported: totalImported,
      duplicates: totalDup,
      skipped: totalSkip,
      autoCategorized: totalAuto,
      aiLabeled,
      aiEnabled: geminiConfigured(),
      warning: aiWarning,
      quality: {
        imported: totalImported,
        duplicates: totalDup,
        labeled: totalAuto,
        otherLeft,
        sampleOther,
        warning: aiWarning ?? null,
      },
      dedupe: "date+amount+canonical merchant — re-imports skip duplicates; existing data is never wiped",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Import failed";
    console.error("import error", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
