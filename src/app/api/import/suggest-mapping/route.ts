import { NextResponse } from "next/server";
import { aiSuggestCsvMapping, geminiConfigured } from "@/lib/gemini";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  fileName: z.string().optional(),
  headers: z.array(z.string()).min(1),
  sampleRows: z.array(z.array(z.string())).min(1),
});

/** Heuristic: do these "headers" look like real labels or like data? */
function looksHeaderless(headers: string[]): boolean {
  if (!headers.length) return true;
  let dataLike = 0;
  for (const h of headers) {
    const t = h.trim();
    if (!t) {
      dataLike += 1;
      continue;
    }
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(t)) dataLike += 1;
    else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(t)) dataLike += 1;
    else if (/^\$?-?\d+(\.\d+)?$/.test(t.replace(/,/g, ""))) dataLike += 1;
    else if (t.length > 40) dataLike += 1;
    else if (/transfer|debit|credit|purchase|visa|mastercard|pos /i.test(t))
      dataLike += 1;
  }
  return dataLike >= Math.ceil(headers.length / 2);
}

function toColKey(i: number) {
  return `col_${i}`;
}

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

  const columns = headers.map((sample, i) => ({
    key: toColKey(i),
    label: `Column ${i + 1}`,
    sample: sample.slice(0, 48),
  }));

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
      amountStyle:
        headers.length >= 4 ? ("debit_credit" as const) : ("signed" as const),
      date: toColKey(0),
      description: toColKey(1),
      amount: headers.length === 3 ? toColKey(2) : undefined,
      debit: headers.length >= 4 ? toColKey(2) : undefined,
      credit: headers.length >= 4 ? toColKey(3) : undefined,
      confidence: 0.4,
      note: "Guessed CIBC-style columns (Gemini unavailable)",
    };
    return NextResponse.json({
      enabled: false,
      headerless: true,
      columns,
      mapping,
    });
  }

  const suggested = await aiSuggestCsvMapping({ fileName, headers, sampleRows });
  if (!suggested) {
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
    let amountStyle = suggested.amountStyle;
    let amount = mapKey(suggested.amount);
    let debit = mapKey(suggested.debit);
    let credit = mapKey(suggested.credit);

    // CIBC often: Date, Description, Amount, Balance — one amount col, not debit/credit
    if (amountStyle === "debit_credit" && debit && !credit && headers.length >= 3) {
      amountStyle = "signed";
      amount = debit;
      debit = undefined;
      credit = undefined;
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
