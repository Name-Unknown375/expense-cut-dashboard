import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

function csvEscape(value: string | number | null | undefined) {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: Request) {
  await ensureSeeded();
  const what = new URL(request.url).searchParams.get("what") || "transactions";
  if (what === "rules") {
    const rules = await prisma.spendingRule.findMany({ include: { category: true } });
    const lines = [
      "name,type,category,limit,active",
      ...rules.map((r) =>
        [r.name, r.type, r.category?.name ?? "", r.limitAmount ?? "", r.active ? "true" : "false"]
          .map(csvEscape)
          .join(",")
      ),
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=spending-rules.csv",
      },
    });
  }
  const txs = await prisma.transaction.findMany({
    include: { category: true },
    orderBy: { date: "desc" },
  });
  const lines = [
    "date,amount,merchant,category,bucket,source",
    ...txs.map((t) =>
      [
        t.date.toISOString().slice(0, 10),
        t.amount.toFixed(2),
        t.merchant,
        t.category?.name ?? "",
        t.category?.bucket ?? "",
        t.source,
      ]
        .map(csvEscape)
        .join(",")
    ),
  ];
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=transactions.csv",
    },
  });
}
