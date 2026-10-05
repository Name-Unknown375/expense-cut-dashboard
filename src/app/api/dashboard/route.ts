import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/analytics";
import { periodFromSearchParams } from "@/lib/period";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const spec = periodFromSearchParams({
    period: searchParams.get("period") ?? undefined,
    month: searchParams.get("month") ?? undefined,
    year: searchParams.get("year") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });
  const data = await getDashboardData(spec);
  return NextResponse.json(data);
}
