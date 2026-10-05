/**
 * Gemini (AI Studio) client — categorization + deeper spend insights.
 * Key from GEMINI_API_KEY only; never hardcode.
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const FALLBACK_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
];

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function extractText(data: unknown): string {
  const d = data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = d.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("").trim();
}

export async function geminiGenerateJson<T>(
  prompt: string,
  opts?: { model?: string; temperature?: number }
): Promise<T | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;

  const models = [opts?.model || DEFAULT_MODEL, ...FALLBACK_MODELS].filter(
    (m, i, arr) => arr.indexOf(m) === i
  );

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: opts?.temperature ?? 0.2,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
          },
        }),
      });
      if (res.status === 503 || res.status === 429) continue;
      if (!res.ok) continue;
      const data = await res.json();
      const text = extractText(data);
      if (!text) continue;
      return JSON.parse(text) as T;
    } catch {
      continue;
    }
  }
  return null;
}

/** Map unknown merchants → category names from the allowed list. */
export async function aiCategorizeMerchants(
  merchants: string[],
  categoryNames: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(
    new Set(merchants.map((m) => m.trim()).filter(Boolean))
  ).slice(0, 40);
  if (!unique.length || !geminiConfigured()) return out;

  const allowed = categoryNames.filter((n) => n.toLowerCase() !== "other");
  const prompt = `You categorize bank transaction merchants for a personal expense tracker.
Allowed categories (pick exactly one name from this list for each merchant):
${allowed.map((n) => `- ${n}`).join("\n")}
- Other  (only if nothing fits)

Merchants:
${unique.map((m, i) => `${i + 1}. ${m}`).join("\n")}

Return JSON only:
{"items":[{"merchant":"<exact merchant string>","category":"<category name>"}]}
Use the merchant string exactly as given. Prefer specific categories over Other.`;

  const result = await geminiGenerateJson<{
    items?: Array<{ merchant?: string; category?: string }>;
  }>(prompt, { temperature: 0.1 });

  const byLower = new Map(categoryNames.map((n) => [n.toLowerCase(), n]));
  for (const item of result?.items ?? []) {
    if (!item?.merchant || !item.category) continue;
    const cat = byLower.get(item.category.trim().toLowerCase());
    if (!cat) continue;
    out.set(item.merchant.trim().toLowerCase(), cat);
  }
  return out;
}

export type AiSpendBrief = {
  headline: string;
  brief: string;
  bullets: string[];
  nextAction: string;
};

export type AiCsvMapping = {
  headerless: boolean;
  amountStyle: "signed" | "debit_credit";
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  category?: string;
  confidence: number;
  note?: string;
};

/** Infer bank CSV column mapping from headers + sample rows. */
export async function aiSuggestCsvMapping(input: {
  fileName?: string;
  headers: string[];
  sampleRows: string[][];
}): Promise<AiCsvMapping | null> {
  if (!geminiConfigured()) return null;
  const headers = input.headers;
  if (!headers.length) return null;

  const preview = input.sampleRows
    .slice(0, 8)
    .map((r, i) => `row${i}: ${JSON.stringify(r)}`)
    .join("\n");

  const prompt = `You map bank CSV columns for an expense importer (CIBC and similar Canadian banks are common).
File: ${input.fileName || "statement.csv"}

Column headers (may be real names OR the first data row if the file has no header):
${headers.map((h, i) => `${i}: ${JSON.stringify(h)}`).join("\n")}

Sample rows (arrays aligned to columns; if headerless, row0 may be the first transaction):
${preview}

Decide:
1. headerless — true if "headers" are clearly data values (dates, amounts, long merchant text), not labels like Date/Description/Debit.
2. amountStyle — "signed" if one amount column (signed or absolute), or "debit_credit" if separate debit and credit columns.
3. Pick the exact header string from the list above for each role.

Return JSON only:
{
  "headerless": true|false,
  "amountStyle": "signed"|"debit_credit",
  "date": "<exact header string>",
  "description": "<exact header string>",
  "amount": "<exact header or empty>",
  "debit": "<exact header or empty>",
  "credit": "<exact header or empty>",
  "category": "<exact header or empty>",
  "confidence": 0.0-1.0,
  "note": "short reason"
}

Rules:
- Prefer description/merchant/memo over account numbers.
- For CIBC-style 4-column no-header files, typical order is Date, Description, Debit, Credit (or Amount, Balance).
- Ignore balance columns for amount.
- Use empty string for unused fields.
- Headers you return MUST be exact copies from the header list.`;

  const result = await geminiGenerateJson<Partial<AiCsvMapping>>(prompt, {
    temperature: 0.1,
  });
  if (!result?.date || !result?.description) return null;

  const allow = new Set(headers);
  const pick = (v?: string) => {
    const s = (v ?? "").trim();
    return s && allow.has(s) ? s : "";
  };

  const amountStyle =
    result.amountStyle === "debit_credit" ? "debit_credit" : "signed";
  const date = pick(result.date);
  const description = pick(result.description);
  if (!date || !description) return null;

  const amount = pick(result.amount);
  const debit = pick(result.debit);
  const credit = pick(result.credit);
  const category = pick(result.category) || undefined;

  if (amountStyle === "signed" && !amount && !(debit || credit)) return null;

  return {
    headerless: Boolean(result.headerless),
    amountStyle:
      amountStyle === "signed" && !amount && (debit || credit)
        ? "debit_credit"
        : amountStyle,
    date,
    description,
    amount: amount || undefined,
    debit: debit || undefined,
    credit: credit || undefined,
    category,
    confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0.7)),
    note: result.note ? String(result.note).slice(0, 160) : undefined,
  };
}

/** Deeper period insight on top of rule-based disposition. */
export async function aiDeepenInsights(input: {
  periodLabel: string;
  spent: number;
  target: number;
  nextAction: string;
  rows: Array<{ what: string; amount: number; verdict: string }>;
  taps: Array<{ merchant: string; phrase: string; amount: number }>;
}): Promise<AiSpendBrief | null> {
  if (!geminiConfigured()) return null;

  const prompt = `You are a blunt personal CFO for someone cutting expenses (50% of usual spend target).
Period: ${input.periodLabel}
Spent: $${input.spent.toFixed(2)} · Target: $${input.target.toFixed(2)}
Rule-based next action: ${input.nextAction}

Disposition (what / amount / verdict):
${input.rows
  .slice(0, 14)
  .map((r) => `- ${r.what}: $${r.amount.toFixed(2)} → ${r.verdict}`)
  .join("\n")}

Small taps:
${input.taps
  .slice(0, 8)
  .map((t) => `- ${t.merchant} (${t.phrase}): $${t.amount.toFixed(2)}`)
  .join("\n") || "(none)"}

Write sharper, actionable advice. No fluff, no shame, no emojis.
Return JSON only:
{
  "headline": "≤8 words",
  "brief": "2-3 sentences on the real leak this period",
  "bullets": ["3 concrete moves, each under 14 words"],
  "nextAction": "one imperative sentence they can do this week"
}`;

  const result = await geminiGenerateJson<AiSpendBrief>(prompt, {
    temperature: 0.35,
  });
  if (!result?.headline || !result?.brief || !result?.nextAction) return null;
  return {
    headline: String(result.headline).slice(0, 80),
    brief: String(result.brief).slice(0, 600),
    bullets: (result.bullets ?? []).map((b) => String(b).slice(0, 120)).slice(0, 5),
    nextAction: String(result.nextAction).slice(0, 200),
  };
}
