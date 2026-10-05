import { NextResponse } from "next/server";
import { aiSuggestCsvMapping, geminiConfigured } from "@/lib/gemini";
import {
  inferDebitCreditFromSamples,
  looksHeaderless,
  toColKey,
} from "@/lib/csv-mapping";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  fileName: z.string().optional(),
  headers: z.array(z.string()).min(1),
  sampleRows: z.array(z.array(z.string())).min(1),
});

function indexOfHeader(headers: string[], value: string | undefined): number {
  if (!value) return -1;
  return headers.findIndex((h) => h === value);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { fileName, headers, sampleRows } = parsed.data;
  const headerlessGuess = looksHeaderless(headers);
  const colCount = Math.max(
    headers.length,
    ...sampleRows.map((r) => r.length),
    0
  );

  const columns = Array.from({ length: colCount }, (_, i) => ({
    key: toColKey(i),
    label: `Column ${i + 1}`,
    sample: String(headers[i] ?? sampleRows[0]?.[i] ?? "").slice(0, 48),
  }));

  const structural = inferDebitCreditFromSamples(sampleRows, colCount);

  if (!geminiConfigured()) {
    if (!headerlessGuess) {
      return NextResponse.json({
        enabled: false,
        headerless: false,
        columns: headers.map((h) => ({ key: h, label: h, sample: h })),
        mapping: null,
      });
    }
    const mapping = {
      headerless: true,
      amountStyle: structural?.amountStyle ?? (colCount >= 4 ? "debit_credit" as const : "signed" as const),
      date: toColKey(0),
      description: toColKey(1),
      amount: structural?.amount ?? (colCount < 4 ? toColKey(2) : undefined),
      debit: structural?.debit ?? (colCount >= 4 ? toColKey(2) : undefined),
      credit: structural?.credit ?? (colCount >= 4 ? toColKey(3) : undefined),
      confidence: 0.45,
      note: "Guessed CIBC-style columns (Gemini unavailable)",
    };
    if (mapping.amountStyle === "debit_credit") {
      mapping.amount = undefined;
    } else {
      mapping.debit = undefined;
      mapping.credit = undefined;
    }
    return NextResponse.json({
      enabled: false,
      headerless: true,
      columns,
      mapping,
    });
  }

  const suggested = await aiSuggestCsvMapping({ fileName, headers, sampleRows });
  if (!suggested) {
    // Fall back to structural inference
    if (headerlessGuess && structural) {
      return NextResponse.json({
        enabled: true,
        headerless: true,
        columns,
        mapping: {
          headerless: true,
          amountStyle: structural.amountStyle,
          date: toColKey(0),
          description: toColKey(1),
          amount: structural.amount,
          debit: structural.debit,
          credit: structural.credit,
          confidence: 0.55,
          note: "Inferred debit/credit from sample rows (Gemini unavailable)",
        },
      });
    }
    return NextResponse.json(
      {
        enabled: true,
        error: "Could not infer mapping",
        headerless: headerlessGuess,
        columns: headerlessGuess
          ? columns
          : headers.map((h) => ({ key: h, label: h, sample: h })),
      },
      { status: 503 }
    );
  }

  const headerless = suggested.headerless || headerlessGuess;

  if (headerless) {
    const mapKey = (exact?: string) => {
      const idx = indexOfHeader(headers, exact);
      return idx >= 0 ? toColKey(idx) : undefined;
    };

    // Prefer structural debit/credit when samples show mutually exclusive cols
    let amountStyle = structural?.amountStyle ?? suggested.amountStyle;
    let amount = structural?.amount ?? mapKey(suggested.amount);
    let debit = structural?.debit ?? mapKey(suggested.debit);
    let credit = structural?.credit ?? mapKey(suggested.credit);

    // If Gemini said debit_credit but only mapped debit (credit cell empty on row 0),
    // still keep debit_credit when a credit column exists (col_3 on 4+ col files).
    if (
      (suggested.amountStyle === "debit_credit" ||
        /debit and credit/i.test(suggested.note || "")) &&
      colCount >= 4
    ) {
      amountStyle = "debit_credit";
      debit = debit || toColKey(2);
      credit = credit || toColKey(3);
      amount = undefined;
    }

    if (amountStyle === "debit_credit") {
      amount = undefined;
      debit = debit || toColKey(2);
      credit = credit || toColKey(3);
    } else {
      debit = undefined;
      credit = undefined;
      amount = amount || toColKey(2);
    }

    const mapping = {
      headerless: true,
      amountStyle,
      date: mapKey(suggested.date) || toColKey(0),
      description: mapKey(suggested.description) || toColKey(1),
      amount,
      debit,
      credit,
      category: mapKey(suggested.category),
      confidence: suggested.confidence,
      note: suggested.note,
    };
    return NextResponse.json({ enabled: true, headerless: true, columns, mapping });
  }

  return NextResponse.json({
    enabled: true,
    headerless: false,
    columns: headers.map((h) => ({ key: h, label: h, sample: h })),
    mapping: { ...suggested, headerless: false },
  });
}
