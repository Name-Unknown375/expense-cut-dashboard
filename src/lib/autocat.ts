/**
 * Automatic categorization — no manual labeling required.
 * Order: remembered merchant → keyword match → Other.
 */

export type CategoryRef = { id: string; name: string };

/** Lowercase merchant substrings → category name */
const KEYWORD_MAP: { keywords: string[]; category: string }[] = [
  {
    category: "Rent",
    keywords: [
      "landlord",
      "rent",
      "apartment",
      "property mgmt",
      "property management",
      "lease",
      "wealth realty",
    ],
  },
  {
    category: "Utilities",
    keywords: [
      "power",
      "electric",
      "hydro",
      "gas company",
      "utility",
      "water bill",
      "comcast",
      "xfinity",
      "verizon fios",
      "at&t internet",
      "spectrum",
      "pg&e",
      "con edison",
    ],
  },
  {
    category: "Subscriptions",
    keywords: [
      "netflix",
      "spotify",
      "disney+",
      "disney plus",
      "hulu",
      "hbo",
      "max.com",
      "apple.com/bill",
      "apple music",
      "youtube premium",
      "prime video",
      "paramount+",
      "adobe",
      "notion",
      "dropbox",
      "icloud",
      "microsoft 365",
      "openai",
      "chatgpt",
      "cursor",
      "github",
      "patreon",
      "onlyfans",
      "audible",
    ],
  },
  {
    category: "Groceries",
    keywords: [
      "whole foods",
      "trader joe",
      "costco",
      "safeway",
      "kroger",
      "aldi",
      "walmart",
      "grocery",
      "supermarket",
      "market",
      "fresh",
      "foods",
      "sobeys",
      "loblaws",
      "save-on",
      "no frills",
    ],
  },
  {
    category: "Transport",
    keywords: [
      "shell",
      "chevron",
      "exxon",
      "mobil",
      "gas station",
      "petrol",
      "uber",
      "lyft",
      "metro",
      "transit",
      "parking",
      "toll",
      "amtrak",
      "greyhound",
      "air canada",
      "united airlines",
      "delta air",
      "southwest",
    ],
  },
  {
    category: "Health",
    keywords: [
      "cvs",
      "pharmacy",
      "walgreens",
      "rite aid",
      "dentist",
      "dental",
      "clinic",
      "hospital",
      "doctor",
      "medical",
      "optomet",
      "lenscrafters",
      "goodrx",
    ],
  },
  {
    category: "Dining",
    keywords: [
      "starbucks",
      "chipotle",
      "mcdonald",
      "burger",
      "wendy",
      "taco",
      "pizza",
      "domino",
      "uber eats",
      "doordash",
      "grubhub",
      "skipthedishes",
      "restaur",
      "cafe",
      "coffee",
      "sushi",
      "dining",
      "kitchen",
      "grill",
      "bistro",
      "bakery",
      "ice cream",
      "presotea",
      "tim hortons",
      "dunkin",
      "subway",
      "olive garden",
      "food court",
    ],
  },
  {
    category: "Shopping",
    keywords: [
      "amazon",
      "target",
      "best buy",
      "nike",
      "h&m",
      "zara",
      "uniqlo",
      "ikea",
      "home depot",
      "lowes",
      "apple store",
      "ebay",
      "etsy",
      "shopify",
      "sephora",
      "ulta",
      "nordstrom",
      "gap ",
      "old navy",
    ],
  },
  {
    category: "Entertainment",
    keywords: [
      "cinema",
      "theater",
      "theatre",
      "amc",
      "regal",
      "bowling",
      "steam",
      "playstation",
      "xbox",
      "nintendo",
      "ticketmaster",
      "concert",
      "museum",
      "zoo",
      "spotify",
    ],
  },
  {
    category: "Travel",
    keywords: [
      "hotel",
      "airbnb",
      "booking.com",
      "expedia",
      "marriott",
      "hilton",
      "hyatt",
      "airline",
      "airport",
      "travel",
      "vrbo",
    ],
  },
];

/** Account-to-account moves, card payments, and cash withdrawals — not purchases. */
export function isInternalMovement(merchant: string): boolean {
  const m = merchant.toLowerCase().replace(/\s+/g, " ");
  return (
    /internet banking internet transfer/.test(m) ||
    /to card /.test(m) ||
    /to account /.test(m) ||
    /cash advance/.test(m) ||
    /branch transaction withdrawal/.test(m)
  );
}

export function guessCategoryName(merchant: string): string | null {
  const m = merchant.toLowerCase().replace(/\s+/g, " ").trim();
  if (!m) return null;
  if (isInternalMovement(m)) return "Transfers";

  for (const rule of KEYWORD_MAP) {
    for (const kw of rule.keywords) {
      if (m.includes(kw)) return rule.category;
    }
  }
  return null;
}

export function resolveCategoryId(
  merchant: string,
  opts: {
    ruleMap: Map<string, string>;
    catByName: Map<string, string>;
    csvCategory?: string | null;
  }
): { categoryId: string | null; source: "csv" | "memory" | "heuristic" | "other" | "none" } {
  const { ruleMap, catByName, csvCategory } = opts;

  if (csvCategory) {
    const id = catByName.get(csvCategory.trim().toLowerCase());
    if (id) return { categoryId: id, source: "csv" };
  }

  const exact = ruleMap.get(merchant.trim().toLowerCase());
  if (exact) return { categoryId: exact, source: "memory" };

  // Partial memory match (e.g. "STARBUCKS #1234" vs "starbucks")
  const m = merchant.trim().toLowerCase();
  for (const [key, id] of Array.from(ruleMap.entries())) {
    if (key.length >= 4 && (m.includes(key) || key.includes(m))) {
      return { categoryId: id, source: "memory" };
    }
  }

  const guessed = guessCategoryName(merchant);
  if (guessed) {
    const id = catByName.get(guessed.toLowerCase());
    if (id) return { categoryId: id, source: "heuristic" };
  }

  const other = catByName.get("other");
  if (other) return { categoryId: other, source: "other" };

  return { categoryId: null, source: "none" };
}

/** Remember merchant → category for next import */
export async function rememberMerchant(
  prisma: {
    merchantRule: {
      upsert: (args: {
        where: { merchant: string };
        create: { merchant: string; categoryId: string };
        update: { categoryId: string };
      }) => Promise<unknown>;
    };
  },
  merchant: string,
  categoryId: string
) {
  const key = merchant.trim().toLowerCase();
  if (!key || !categoryId) return;
  await prisma.merchantRule.upsert({
    where: { merchant: key },
    create: { merchant: key, categoryId },
    update: { categoryId },
  });
}
