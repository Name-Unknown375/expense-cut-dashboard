import { merchantKey } from "./insights";

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
      "bc hydro",
      "shaw",
      "telus",
      "rogers",
      "fido",
      "koodo",
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
      "uberonemem",
      "uber one",
      "annual renewal",
      "gumroad",
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
      "grocery",
      "supermarket",
      "superstore",
      "save on foods",
      "thrifty foods",
      "buy low foods",
      "freshco",
      "fresh st",
      "t&t",
      "7-eleven",
      "7 eleven",
      "market",
      "foods",
      "sobeys",
      "loblaws",
      "save-on",
      "no frills",
      "nofrills",
      "grocer",
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
      "uber trip",
      "ubertrip",
      "lyft",
      "translink",
      "compass card",
      "costco gas",
      "petro-canada",
      "petro canada",
      "esso",
      "husky",
      "u-haul",
      "uhaul",
      "insurance corporation of bc",
      "bcaa",
      "transit",
      "parking",
      "paybyphone",
      "impark",
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
      "vision source",
      "lenscrafters",
      "goodrx",
      "naturopath",
      "osteopath",
      "concussion",
      "nutrition",
      "doublewood",
      "rmt",
      "tcm",
      "physio",
      "chiro",
      "yoga",
      "lion heart",
      "fitness",
      "niahealth",
      "lifelabs",
      "well.ca",
      "shoppers drug",
      "drug mart",
      "london drugs",
      "dr.",
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
      "ubereats",
      "doordash",
      "ramen",
      "pho",
      "donair",
      "popeyes",
      "poke",
      "bubble tea",
      "tea shop",
      "mochi",
      "gelato",
      "candy",
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
      "amazon.ca",
      "amzn",
      "walmart",
      "wal-mart",
      "wmt supr",
      "suprctr",
      "indigo",
      "marshalls",
      "homesense",
      "winners",
      "dollarama",
      "value village",
      "vivobarefoot",
      "christmas light",
      "jetson home",
      "northernfit",
      "matcha com",
      "indigo",
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
      "innogames",
      "billiard",
      "climbing",
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

/** Account-to-account moves, card payments, cash withdrawals, and personal e-transfers. */
export function isInternalMovement(merchant: string): boolean {
  const m = merchant.toLowerCase().replace(/\s+/g, " ");
  if (/wealth realty|osteopath|physio|naturopath|dental|chiro|massage/.test(m)) return false;
  return (
    /internet banking internet transfer/.test(m) ||
    /internet banking e-transfer/.test(m) ||
    /to card /.test(m) ||
    /to account /.test(m) ||
    /cash advance/.test(m) ||
    /atm withdrawal/.test(m) ||
    /branch transaction withdrawal/.test(m) ||
    /cibc loans/.test(m) ||
    /service charge/.test(m) ||
    /purchase interest/.test(m) ||
    /cash interest/.test(m)
  );
}

function matchesKeyword(merchant: string, keyword: string): boolean {
  let from = 0;
  while (from < merchant.length) {
    const idx = merchant.indexOf(keyword, from);
    if (idx < 0) return false;
    const before = idx === 0 ? " " : merchant[idx - 1];
    const afterIdx = idx + keyword.length;
    const after = afterIdx >= merchant.length ? " " : merchant[afterIdx];
    const boundary = (ch: string) => !/[a-z0-9]/.test(ch);
    if (boundary(before) && boundary(after)) return true;
    from = idx + 1;
  }
  return false;
}

export function guessCategoryName(merchant: string): string | null {
  const m = merchant.toLowerCase().replace(/\s+/g, " ").trim();
  if (!m) return null;
  if (/wealth realty/.test(m)) return "Rent";
  if (/osteopath|naturopath/.test(m)) return "Health";
  if (isInternalMovement(m)) return "Transfers";

  let best: { keyword: string; category: string } | null = null;
  for (const rule of KEYWORD_MAP) {
    for (const kw of rule.keywords) {
      if (!matchesKeyword(m, kw)) continue;
      if (!best || kw.length > best.keyword.length) {
        best = { keyword: kw, category: rule.category };
      }
    }
  }
  return best?.category ?? null;
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

  const exact =
    ruleMap.get(merchant.trim().toLowerCase()) ?? ruleMap.get(merchantKey(merchant));
  if (exact) return { categoryId: exact, source: "memory" };

  // Partial memory match (e.g. "STARBUCKS #1234" vs "starbucks")
  const m = merchant.trim().toLowerCase();
  for (const [key, id] of Array.from(ruleMap.entries())) {
    if (key.length >= 8 && m.includes(key)) {
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
  const key = merchantKey(merchant);
  if (!key || !categoryId) return;
  await prisma.merchantRule.upsert({
    where: { merchant: key },
    create: { merchant: key, categoryId },
    update: { categoryId },
  });
}
